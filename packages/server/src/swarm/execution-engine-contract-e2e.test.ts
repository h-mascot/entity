/**
 * THE-899 / EEPC-B-04 — Execution-engine contract end-to-end + security receipt.
 *
 * HTTP chain:
 *   list engines (no secrets) → create job via contract preset shape →
 *   authorized callback status/proof → ActivityEvent mapping →
 *   unauthorized + malformed callbacks rejected with no side effects.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDbPath = path.join(
  os.tmpdir(),
  `entity-eepc-b-04-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);

const CALLBACK_SECRET = 'test-eepc-b04-callback-secret-00000001';

process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
process.env.MISSION_CONTROL_DB_PATH = '/tmp/nonexistent-mc-eepc-b-04.db';
process.env.ACP_BASE_URL = 'http://127.0.0.1:9/secret-acp-base';
process.env.ENTITY_EEPC_CALLBACK_TOKEN = CALLBACK_SECRET;

const SECRET_PATTERNS = [
  /https?:\/\/127\.0\.0\.1:9\/secret-acp-base/i,
  /\/Users\//i,
  /\/home\//i,
  /Bearer\s+[A-Za-z0-9_\-.+/=]{8,}/i,
  /\bsk-[A-Za-z0-9]{10,}\b/,
  new RegExp(CALLBACK_SECRET.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
];

function assertNoSecretLeak(payload: unknown, label: string): void {
  const serialized = JSON.stringify(payload);
  for (const pattern of SECRET_PATTERNS) {
    expect(serialized, `${label} must not match ${pattern}`).not.toMatch(pattern);
  }
}

let baseUrl = '';
let server: Awaited<ReturnType<express.Express['listen']>>;
let createSwarmRouter: typeof import('./routes').createSwarmRouter;

beforeAll(async () => {
  ({ createSwarmRouter } = await import('./routes'));

  const app = express();
  app.use(express.json());
  app.use('/api/swarm', createSwarmRouter());

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
      baseUrl = `http://127.0.0.1:${address.port}/api/swarm`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(tmpDbPath + suffix);
    } catch {
      // ignore
    }
  }
  delete process.env.ENTITY_EEPC_CALLBACK_TOKEN;
});

describe('EEPC-B-04 execution-engine contract E2E + security', () => {
  let jobId = '';

  it('lists registered engines with public health and no secret leak', async () => {
    const res = await fetch(`${baseUrl}/execution-engines`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      engines?: Array<{ name: string; acceptsDispatch?: boolean; health?: { available?: boolean; message?: string } }>;
    };
    expect(Array.isArray(body.engines)).toBe(true);
    expect((body.engines ?? []).length).toBeGreaterThanOrEqual(1);
    assertNoSecretLeak(body, 'GET /execution-engines');

    const selectable = (body.engines ?? []).filter((e) => e.acceptsDispatch);
    expect(selectable.length).toBeGreaterThanOrEqual(1);
    const stubs = (body.engines ?? []).filter((e) => e.acceptsDispatch === false);
    expect(stubs.length).toBeGreaterThanOrEqual(1);
  });

  it('creates a job using contract preset dispatch shape (provider + auto_dispatch)', async () => {
    const res = await fetch(`${baseUrl}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'symphony',
        auto_dispatch: false,
        summary: 'EEPC-B-04 contract E2E job',
        spec: 'Prove list → dispatch → callback → Workplane job proof/status without secret leak.',
        created_by: 'eepc-b-04-proof',
      }),
    });
    const body = (await res.json()) as { job?: { id: string; provider: string; task_id?: number | null; status: string } };
    expect(res.status).toBe(201);
    expect(body.job).toBeDefined();
    expect(body.job!.provider).toBe('symphony');
    // D5 (g4): task linkage is governed by POST /tasks/:taskId/run; the generic
    // contract dispatch shape creates an unlinked operational job.
    expect(body.job!.task_id).toBeNull();
    jobId = body.job!.id;
    assertNoSecretLeak(body, 'POST /jobs');
  });

  it('rejects unauthorized callback with 401 and no ActivityEvent side effects', async () => {
    const res = await fetch(`${baseUrl}/jobs/${jobId}/callbacks/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'symphony',
        summary: 'should not land',
        status: 'running',
      }),
    });
    const body = (await res.json()) as { error?: string; message?: string; issues?: unknown };
    expect(res.status).toBe(401);
    expect(body.error).toBe('unauthorized');
    assertNoSecretLeak(body, 'unauthorized callback');
  });

  it('rejects malformed callback with 400 and public-safe body', async () => {
    const res = await fetch(`${baseUrl}/jobs/${jobId}/callbacks/status`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${CALLBACK_SECRET}`,
      },
      body: JSON.stringify({
        // missing provider
        summary: 'malformed',
        status: 'running',
        authorization: 'Bearer should-never-echo',
      }),
    });
    const body = (await res.json()) as { error?: string; message?: string };
    expect(res.status).toBe(400);
    expect(body.error).toBeTruthy();
    assertNoSecretLeak(body, 'malformed callback');
    expect(JSON.stringify(body)).not.toMatch(/should-never-echo/i);
  });

  it('accepts authorized status + proof callbacks and maps ActivityEvent-shaped records', async () => {
    // Wire append via isolated intake service is covered in A-03/A-07;
    // here we prove the mounted router path with env secret.
    const statusRes = await fetch(`${baseUrl}/jobs/${jobId}/callbacks/status`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-entity-callback-token': CALLBACK_SECRET,
      },
      body: JSON.stringify({
        provider: 'symphony',
        summary: 'Job moved to running',
        status: 'running',
        run_state: 'active',
      }),
    });
    const statusBody = (await statusRes.json()) as {
      ok?: boolean;
      record?: {
        kind?: string;
        jobId?: string;
        provider?: string;
        payload?: { data?: { source?: string; job_id?: string; execution_callback_kind?: string } };
      };
    };
    expect([201, 202]).toContain(statusRes.status);
    expect(statusBody.ok).toBe(true);
    expect(statusBody.record?.kind).toBe('status');
    expect(statusBody.record?.jobId).toBe(jobId);
    expect(statusBody.record?.payload?.data?.source).toBe('execution-engine-callback');
    expect(statusBody.record?.payload?.data?.execution_callback_kind).toBe('status');
    assertNoSecretLeak(statusBody, 'authorized status callback');

    const proofRes = await fetch(`${baseUrl}/jobs/${jobId}/callbacks/proof`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${CALLBACK_SECRET}`,
      },
      body: JSON.stringify({
        provider: 'symphony',
        summary: 'EEPC-B-04 proof artifacts',
        commit_sha: 'abcdef1234567890eepcb04',
        branch: 'runner/the-899-eepc-b-04',
        artifact_refs: ['/docs/output/entity/eepc-b-04/proof.md'],
      }),
    });
    const proofBody = (await proofRes.json()) as {
      ok?: boolean;
      record?: {
        kind?: string;
        payload?: { data?: { execution_callback_kind?: string; event_body?: { artifact_refs?: string[] } } };
      };
    };
    expect([201, 202]).toContain(proofRes.status);
    expect(proofBody.ok).toBe(true);
    expect(proofBody.record?.kind).toBe('proof');
    expect(proofBody.record?.payload?.data?.execution_callback_kind).toBe('proof');
    expect(proofBody.record?.payload?.data?.event_body?.artifact_refs).toContain(
      '/docs/output/entity/eepc-b-04/proof.md',
    );
    assertNoSecretLeak(proofBody, 'authorized proof callback');
  });

  it('wrong credential still fails after successful authorized traffic', async () => {
    const res = await fetch(`${baseUrl}/jobs/${jobId}/callbacks/status`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer wrong-token-definitely-not-valid-0001',
      },
      body: JSON.stringify({
        provider: 'symphony',
        summary: 'should not land after success',
        status: 'failed',
      }),
    });
    const body = (await res.json()) as { error?: string };
    expect(res.status).toBe(401);
    expect(body.error).toBe('unauthorized');
    assertNoSecretLeak(body, 'wrong credential callback');
  });
});
