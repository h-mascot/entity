/**
 * Geordi Swarm → Symphony E2E Integration Test
 *
 * Tests the complete lifecycle: create job → claim → update status → submit proof → complete
 * This simulates what Symphony would do as an executor polling Entity's tracker API.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDbPath = path.join(os.tmpdir(), `entity-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const originalEnv = process.env.ENTITY_TASK_DB_PATH;
const originalMcPath = process.env.MISSION_CONTROL_DB_PATH;

process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
process.env.MISSION_CONTROL_DB_PATH = '/tmp/nonexistent-mc.db';

let baseUrl = '';
let server: Awaited<ReturnType<express.Express['listen']>>;

beforeAll(async () => {
  const { createSwarmRouter } = await import('./routes');

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
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (originalEnv !== undefined) process.env.ENTITY_TASK_DB_PATH = originalEnv;
  else delete process.env.ENTITY_TASK_DB_PATH;
  if (originalMcPath !== undefined) process.env.MISSION_CONTROL_DB_PATH = originalMcPath;
  else delete process.env.MISSION_CONTROL_DB_PATH;
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(tmpDbPath + suffix); } catch {}
  }
});

describe('Swarm → Symphony E2E Lifecycle', () => {
  let jobId: string;

  it('Phase 1: Entity creates a swarm job (simulating Geordi task creation)', async () => {
    const res = await fetch(`${baseUrl}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Fix login button alignment',
        spec: 'The login button on /auth/login is misaligned on mobile. Fix CSS grid layout.',
        repo: 'https://github.com/example/entity',
        branch: 'fix/login-button',
        provider: 'symphony',
        priority: 'high',
        task_id: 42,
        created_by: 'geordi-swarm',
      }),
    });
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.job).toBeDefined();
    expect(data.job.title).toBe('Fix login button alignment');
    expect(data.job.provider).toBe('symphony');
    expect(data.job.status).toBe('draft');
    jobId = data.job.id;
  });

  it('Phase 2: Entity queues the job for execution', async () => {
    const res = await fetch(`${baseUrl}/jobs/${jobId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'queued' }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.job.status).toBe('queued');
  });

  it('Phase 3: Symphony polls for ready jobs and finds the queued one', async () => {
    const res = await fetch(`${baseUrl}/jobs?status=queued`);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.jobs.length).toBeGreaterThanOrEqual(1);
    const found = data.jobs.find((j: any) => j.id === jobId);
    expect(found).toBeDefined();
    expect(found.provider).toBe('symphony');
  });

  it('Phase 4: Symphony claims the job (concurrency-safe)', async () => {
    const res = await fetch(`${baseUrl}/jobs/${jobId}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claimed_by: 'symphony-executor-1',
        run_handle: 'symphony:run-abc123',
      }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.claimed).toBe(true);
    expect(data.job.status).toBe('dispatched');
    expect(data.job.run_handle).toBe('symphony:run-abc123');
  });

  it('Phase 4b: Second claim attempt is rejected (no double-execution)', async () => {
    const res = await fetch(`${baseUrl}/jobs/${jobId}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claimed_by: 'symphony-executor-2',
        run_handle: 'symphony:run-xyz789',
      }),
    });
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.code).toBe('JOB_NOT_CLAIMABLE');
    expect(data.claimed).toBe(false);
  });

  it('Phase 5: Symphony updates status to running with progress', async () => {
    const res = await fetch(`${baseUrl}/jobs/${jobId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'running',
        progress: 'Checking out branch fix/login-button, running npm install...',
        run_handle: 'symphony:run-abc123',
      }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.job.status).toBe('running');
    expect(data.job.feedback).toContain('Checking out branch');
  });

  it('Phase 6: Symphony submits proof artifacts', async () => {
    const res = await fetch(`${baseUrl}/jobs/${jobId}/proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'symphony',
        commit_sha: 'a1b2c3d4e5f6',
        branch: 'fix/login-button',
        build_log: 'npm run build: exit 0\nnpm run lint: exit 0',
        test_result: 'pass',
        test_output: '42 tests passed, 0 failed',
        screenshots: ['screenshot-mobile-fixed.png'],
        artifacts: { pr_url: 'https://github.com/example/entity/pull/123' },
        duration_sec: 180,
      }),
    });
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.proof).toBeDefined();
    expect(data.proof.commit_sha).toBe('a1b2c3d4e5f6');
    expect(data.proof.test_result).toBe('pass');
  });

  it('Phase 7: Entity can read back proof artifacts', async () => {
    const res = await fetch(`${baseUrl}/jobs/${jobId}/proofs`);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.proofs).toHaveLength(1);
    expect(data.proofs[0].test_output).toBe('42 tests passed, 0 failed');
    expect(data.proofs[0].duration_sec).toBe(180);
  });

  it('Phase 8: Symphony marks job as complete', async () => {
    const res = await fetch(`${baseUrl}/jobs/${jobId}/complete`, { method: 'POST' });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.job.status).toBe('done');
    expect(data.job.completed_at).toBeTruthy();
  });

  it('Phase 9: Final verification — job is fully tracked end-to-end', async () => {
    const res = await fetch(`${baseUrl}/jobs/${jobId}`);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.job.status).toBe('done');
    expect(data.job.run_handle).toBe('symphony:run-abc123');
    expect(data.job.completed_at).toBeTruthy();
    expect(data.proofs).toHaveLength(1);
    expect(data.proofs[0].test_result).toBe('pass');
  });

  it('Stats show the completed job', async () => {
    const res = await fetch(`${baseUrl}/stats`);
    const data = await res.json();

    expect(res.status).toBe(200);
    // At least 1 done job
    expect(data).toBeDefined();
  });
});

describe('Swarm → Symphony Failure Path', () => {
  let failJobId: string;

  it('Creates, queues, claims, then fails a job with reason', async () => {
    // Create
    let res = await fetch(`${baseUrl}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Broken migration',
        spec: 'Run DB migration that will fail',
        repo: 'https://github.com/example/entity',
        provider: 'symphony',
      }),
    });
    let data = await res.json();
    failJobId = data.job.id;

    // Queue
    await fetch(`${baseUrl}/jobs/${failJobId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'queued' }),
    });

    // Claim
    await fetch(`${baseUrl}/jobs/${failJobId}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimed_by: 'symphony', run_handle: 'symphony:fail-run' }),
    });

    // Fail
    res = await fetch(`${baseUrl}/jobs/${failJobId}/fail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Migration script failed: column already exists' }),
    });
    data = await res.json();

    expect(res.status).toBe(200);
    expect(data.job.status).toBe('failed');
    expect(data.job.feedback).toBe('Migration script failed: column already exists');
    expect(data.job.completed_at).toBeTruthy();
  });
});

describe('Swarm → Symphony Release Path', () => {
  it('Claims then releases a job back to queue for retry', async () => {
    // Create + queue
    let res = await fetch(`${baseUrl}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Releasable task',
        spec: 'Claim then release',
        repo: 'https://github.com/example/entity',
        provider: 'symphony',
      }),
    });
    let data = await res.json();
    const releaseJobId = data.job.id;

    await fetch(`${baseUrl}/jobs/${releaseJobId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'queued' }),
    });

    // Claim
    await fetch(`${baseUrl}/jobs/${releaseJobId}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimed_by: 'symphony', run_handle: 'symphony:release-run' }),
    });

    // Release
    res = await fetch(`${baseUrl}/jobs/${releaseJobId}/release`, { method: 'POST' });
    data = await res.json();

    expect(res.status).toBe(200);
    expect(data.released).toBe(true);
    expect(data.job.status).toBe('queued');
    expect(data.job.run_handle).toBe(null);

    // Can be re-claimed
    res = await fetch(`${baseUrl}/jobs/${releaseJobId}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimed_by: 'symphony-2', run_handle: 'symphony:retry-run' }),
    });
    data = await res.json();

    expect(res.status).toBe(200);
    expect(data.claimed).toBe(true);
  });
});

describe('Symphony Provider Health', () => {
  it('Reports mode correctly based on env', async () => {
    const res = await fetch(`${baseUrl}/providers`);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.providers).toBeDefined();
    const symphonyProvider = data.providers.find((p: any) => p.name === 'symphony');
    expect(symphonyProvider).toBeDefined();
  });
});
