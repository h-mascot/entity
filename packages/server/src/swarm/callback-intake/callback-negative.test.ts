/**
 * EEPC-A-07 / THE-895 — Unauthorized/malformed callback negative-path security proofs.
 *
 * Proves: malformed payloads, missing/invalid provider/job ids, unsupported
 * status/proof/event shapes, and unauthorized attempts fail safely without
 * creating ActivityEvents/proof records, without leaking secrets/private paths,
 * and with stable public-safe errors.
 */
import express from 'express';
import http from 'http';
import { describe, expect, it } from 'vitest';
import {
  authorizeExecutionCallback,
  createExecutionCallbackIntakeRouter,
  createExecutionCallbackIntakeService,
  getValidatedManifestByProvider,
  isCallbackAuthRequired,
  parseCallbackPayloadShape,
  resolveCallbackAuthSecretFromEnv,
  scrubPublicSafeText,
  toPublicCallbackErrorBody,
  validateExecutionCallback,
  type CallbackIntakeDependencies,
  type ExecutionCallbackJobRef,
} from './index';
import { TEST_AUTH, TEST_CALLBACK_SECRET } from './test-helpers';

const SYMPHONY_JOB: ExecutionCallbackJobRef = {
  id: 'job-symphony-neg-1',
  provider: 'symphony',
  task_id: 99,
  status: 'running',
};

function deps(overrides: Partial<CallbackIntakeDependencies> = {}): CallbackIntakeDependencies {
  const jobs = new Map<string, ExecutionCallbackJobRef>([[SYMPHONY_JOB.id, SYMPHONY_JOB]]);
  return {
    getManifest: getValidatedManifestByProvider,
    getJob: (jobId) => jobs.get(jobId),
    getCallbackAuthSecret: () => TEST_CALLBACK_SECRET,
    ...overrides,
  };
}

async function listen(app: express.Express): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind test server');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function assertPublicSafe(body: unknown): void {
  const serialized = JSON.stringify(body);
  expect(serialized).not.toMatch(/Bearer\s+[A-Za-z0-9_\-.+/=]{8,}/i);
  expect(serialized).not.toMatch(/sk-[A-Za-z0-9]{10,}/i);
  expect(serialized).not.toMatch(/\/Users\/|\/home\/|\/var\/|\/tmp\/|\\\\Users\\\\/i);
  expect(serialized).not.toContain(TEST_CALLBACK_SECRET);
}

describe('EEPC-A-07 unauthorized/malformed callback negative path', () => {
  it('requires auth for symphony status/proof intake mappings and emits-only events', () => {
    const manifest = getValidatedManifestByProvider('symphony');
    expect(manifest).toBeTruthy();
    if (!manifest) return;
    expect(isCallbackAuthRequired('status', manifest)).toBe(true);
    expect(isCallbackAuthRequired('proof', manifest)).toBe(true);
    // plan/progress/blocker are emits-only on symphony → fail-closed authRequired
    expect(isCallbackAuthRequired('plan', manifest)).toBe(true);
    expect(isCallbackAuthRequired('progress', manifest)).toBe(true);
    expect(isCallbackAuthRequired('blocker', manifest)).toBe(true);
  });

  it('rejects unauthorized callbacks (missing / wrong credential) with 401', async () => {
    const appended: unknown[] = [];
    const service = createExecutionCallbackIntakeService(
      deps({
        appendTaskEvent: async (taskId, input) => {
          appended.push({ taskId, input });
          return { ok: true, value: { id: 1 } };
        },
      }),
    );

    const missing = await service.intake({
      event: 'status',
      provider: 'symphony',
      jobId: SYMPHONY_JOB.id,
      summary: 'should not land',
      status: 'running',
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.status).toBe(401);
    expect(missing.code).toBe('unauthorized');
    assertPublicSafe(missing);

    const wrong = await service.intake(
      {
        event: 'proof',
        provider: 'symphony',
        jobId: SYMPHONY_JOB.id,
        summary: 'forged proof',
        test_result: 'pass',
      },
      { authorization: 'Bearer totally-wrong-callback-token-zzzzzzzz' },
    );
    expect(wrong.ok).toBe(false);
    if (wrong.ok) return;
    expect(wrong.status).toBe(401);
    expect(wrong.code).toBe('unauthorized');
    assertPublicSafe(wrong);

    // No ActivityEvent / proof side effects on unauthorized attempts.
    expect(appended).toHaveLength(0);
  });

  it('fail-closes with 503 when authRequired but secret is not configured', async () => {
    const appended: unknown[] = [];
    const service = createExecutionCallbackIntakeService(
      deps({
        getCallbackAuthSecret: () => undefined,
        appendTaskEvent: async (taskId, input) => {
          appended.push({ taskId, input });
          return { ok: true, value: { id: 1 } };
        },
      }),
    );

    const result = await service.intake(
      {
        event: 'status',
        provider: 'symphony',
        jobId: SYMPHONY_JOB.id,
        summary: 'no secret configured',
        status: 'running',
      },
      TEST_AUTH,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(503);
    expect(result.code).toBe('auth_misconfigured');
    expect(appended).toHaveLength(0);
    assertPublicSafe(result);
  });

  it('accepts X-Entity-Callback-Token when Authorization is absent', async () => {
    const service = createExecutionCallbackIntakeService(deps());
    const result = await service.intake(
      {
        event: 'progress',
        provider: 'symphony',
        jobId: SYMPHONY_JOB.id,
        summary: 'token header ok',
        percent: 12,
      },
      { callbackToken: TEST_CALLBACK_SECRET },
    );
    expect(result.ok).toBe(true);
  });

  it('rejects malformed payloads and missing provider/job identifiers without side effects', async () => {
    const appended: unknown[] = [];
    const service = createExecutionCallbackIntakeService(
      deps({
        appendTaskEvent: async (taskId, input) => {
          appended.push({ taskId, input });
          return { ok: true, value: { id: 1 } };
        },
      }),
    );

    const cases: Array<{ input: unknown; code: string }> = [
      { input: null, code: 'malformed_payload' },
      { input: [], code: 'malformed_payload' },
      { input: 'not-an-object', code: 'malformed_payload' },
      { input: { event: 'plan', jobId: SYMPHONY_JOB.id, summary: 'x' }, code: 'missing_provider' },
      { input: { event: 'plan', provider: 'symphony', summary: 'x' }, code: 'missing_job_id' },
      { input: { event: 'plan', provider: '   ', jobId: SYMPHONY_JOB.id, summary: 'x' }, code: 'missing_provider' },
      { input: { event: 'plan', provider: 'symphony', jobId: '   ', summary: 'x' }, code: 'missing_job_id' },
      {
        input: { event: 'nope', provider: 'symphony', jobId: SYMPHONY_JOB.id, summary: 'x' },
        code: 'invalid_event',
      },
    ];

    for (const entry of cases) {
      const result = await service.intake(entry.input, TEST_AUTH);
      expect(result.ok, `expected fail for ${entry.code}`).toBe(false);
      if (result.ok) continue;
      expect(result.code).toBe(entry.code);
      expect(result.status).toBe(400);
      assertPublicSafe(result);
    }

    expect(appended).toHaveLength(0);
  });

  it('rejects unsupported status/proof/event shapes', () => {
    const invalidStatus = parseCallbackPayloadShape({
      event: 'status',
      provider: 'symphony',
      jobId: SYMPHONY_JOB.id,
      summary: 'bad',
      status: 'ready',
    });
    expect(invalidStatus.ok).toBe(false);
    if (!invalidStatus.ok) {
      expect(invalidStatus.issues.some((i) => i.code === 'invalid_status')).toBe(true);
    }

    const invalidProof = parseCallbackPayloadShape({
      event: 'proof',
      provider: 'symphony',
      jobId: SYMPHONY_JOB.id,
      summary: 'bad proof',
      test_result: 'maybe',
    });
    expect(invalidProof.ok).toBe(false);
    if (!invalidProof.ok) {
      expect(invalidProof.issues.some((i) => i.code === 'invalid_test_result')).toBe(true);
    }

    const invalidPercent = parseCallbackPayloadShape({
      event: 'progress',
      provider: 'symphony',
      jobId: SYMPHONY_JOB.id,
      summary: 'over',
      percent: 150,
    });
    expect(invalidPercent.ok).toBe(false);
    if (!invalidPercent.ok) {
      expect(invalidPercent.issues.some((i) => i.code === 'invalid_percent')).toBe(true);
    }

    const malformedData = parseCallbackPayloadShape({
      event: 'plan',
      provider: 'symphony',
      jobId: SYMPHONY_JOB.id,
      summary: 'ok',
      data: ['not', 'an', 'object'],
    });
    expect(malformedData.ok).toBe(false);
    if (!malformedData.ok) {
      expect(malformedData.issues.some((i) => i.code === 'malformed_data')).toBe(true);
    }
  });

  it('rejects private filesystem paths and does not echo them in public errors', () => {
    const shape = parseCallbackPayloadShape({
      event: 'proof',
      provider: 'symphony',
      jobId: SYMPHONY_JOB.id,
      summary: 'leaky path',
      artifact_refs: ['/Users/synth/secrets/proof.log'],
    });
    expect(shape.ok).toBe(false);
    if (shape.ok) return;
    expect(shape.issues.some((i) => i.code === 'private_path_forbidden')).toBe(true);

    const validated = validateExecutionCallback(
      {
        event: 'proof',
        provider: 'symphony',
        jobId: SYMPHONY_JOB.id,
        summary: 'leaky path',
        data: { note: 'see /home/ops/.ssh/id_rsa' },
      },
      deps(),
      TEST_AUTH,
    );
    expect(validated.ok).toBe(false);
    if (validated.ok) return;

    const publicBody = toPublicCallbackErrorBody({
      code: validated.code,
      message: `${validated.message} /Users/synth/Code/entity/.env`,
      issues: [
        ...validated.issues,
        {
          path: 'payload',
          code: 'probe',
          message: `secret=${TEST_CALLBACK_SECRET} path=/var/lib/entity/private.db`,
        },
      ],
    });
    assertPublicSafe(publicBody);
    expect(publicBody.message).not.toContain('/Users/');
    expect(scrubPublicSafeText('Bearer abcdefghijklmnopqrstuvwxyz01234567')).toContain('[redacted]');
  });

  it('HTTP: unauthorized / invalid event / malformed do not persist and stay public-safe', async () => {
    const appended: unknown[] = [];
    const app = express();
    app.use(express.json());
    app.use(
      createExecutionCallbackIntakeRouter(
        createExecutionCallbackIntakeService(
          deps({
            appendTaskEvent: async (taskId, input) => {
              appended.push({ taskId, input });
              return { ok: true, value: { id: 7 } };
            },
          }),
        ),
      ),
    );
    const { baseUrl, close } = await listen(app);
    try {
      const unauth = await fetch(`${baseUrl}/jobs/${SYMPHONY_JOB.id}/callbacks/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'symphony',
          summary: 'unauth status',
          status: 'running',
        }),
      });
      expect(unauth.status).toBe(401);
      const unauthBody = await unauth.json();
      expect(unauthBody.error).toBe('unauthorized');
      assertPublicSafe(unauthBody);

      const badEvent = await fetch(`${baseUrl}/jobs/${SYMPHONY_JOB.id}/callbacks/explode`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${TEST_CALLBACK_SECRET}`,
        },
        body: JSON.stringify({ provider: 'symphony', summary: 'nope' }),
      });
      expect(badEvent.status).toBe(400);
      const badEventBody = await badEvent.json();
      expect(badEventBody.error).toBe('invalid_event');
      assertPublicSafe(badEventBody);

      const badProof = await fetch(`${baseUrl}/jobs/${SYMPHONY_JOB.id}/callbacks/proof`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-entity-callback-token': TEST_CALLBACK_SECRET,
        },
        body: JSON.stringify({
          provider: 'symphony',
          summary: 'bad shape',
          test_result: 'wat',
        }),
      });
      expect(badProof.status).toBe(400);
      const badProofBody = await badProof.json();
      expect(badProofBody.error).toBe('invalid_test_result');
      assertPublicSafe(badProofBody);

      const unknownJob = await fetch(`${baseUrl}/jobs/missing-job-xyz/callbacks/plan`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${TEST_CALLBACK_SECRET}`,
        },
        body: JSON.stringify({ provider: 'symphony', summary: 'ghost job' }),
      });
      expect(unknownJob.status).toBe(404);
      const unknownJobBody = await unknownJob.json();
      expect(unknownJobBody.error).toBe('unknown_job');
      // Public-safe: do not echo raw job id probing details beyond stable code.
      assertPublicSafe(unknownJobBody);

      expect(appended).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it('authorizeExecutionCallback rejects wrong bearer without revealing expected secret', () => {
    const manifest = getValidatedManifestByProvider('symphony');
    expect(manifest).toBeTruthy();
    if (!manifest) return;

    const decision = authorizeExecutionCallback({
      event: 'status',
      provider: 'symphony',
      manifest,
      auth: { authorization: 'Bearer wrong-token-aaaaaaaaaaaaaaaaaaaa' },
      getCallbackAuthSecret: () => TEST_CALLBACK_SECRET,
    });
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.code).toBe('unauthorized');
    assertPublicSafe(decision);
  });

  it('resolveCallbackAuthSecretFromEnv prefers ENTITY_EEPC_CALLBACK_TOKEN', () => {
    const manifest = getValidatedManifestByProvider('symphony');
    expect(manifest).toBeTruthy();
    if (!manifest) return;

    const secret = resolveCallbackAuthSecretFromEnv('symphony', manifest, {
      ENTITY_EEPC_CALLBACK_TOKEN: 'global-callback-token-aaaaaaaaaaaa',
      SYMPHONY_API_KEY: 'should-not-win-bbbbbbbbbbbbbbbbbbbb',
    } as NodeJS.ProcessEnv);
    expect(secret).toBe('global-callback-token-aaaaaaaaaaaa');

    const fromBinding = resolveCallbackAuthSecretFromEnv('symphony', manifest, {
      SYMPHONY_API_KEY: 'binding-secret-cccccccccccccccccccc',
    } as NodeJS.ProcessEnv);
    expect(fromBinding).toBe('binding-secret-cccccccccccccccccccc');

    const missing = resolveCallbackAuthSecretFromEnv('symphony', manifest, {} as NodeJS.ProcessEnv);
    expect(missing).toBeUndefined();
  });
});
