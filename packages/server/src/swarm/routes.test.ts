import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDbPath = path.join(os.tmpdir(), `entity-swarm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const originalEnv = process.env.ENTITY_TASK_DB_PATH;
const originalMcPath = process.env.MISSION_CONTROL_DB_PATH;
const originalEforgeQueueDir = process.env.EFORGE_QUEUE_DIR;
const originalEforgeApiUrl = process.env.EFORGE_API_URL;
const originalEforgeWebUrl = process.env.EFORGE_WEB_URL;
const originalAcpBaseUrl = process.env.ACP_BASE_URL;

process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
process.env.MISSION_CONTROL_DB_PATH = '/tmp/nonexistent-mc.db';
process.env.ACP_BASE_URL = 'http://127.0.0.1:9';

let baseUrl = '';
let server: Awaited<ReturnType<express.Express['listen']>>;
let createSwarmRouter: typeof import('./routes').createSwarmRouter;
let createSwarmJob: typeof import('./db').createSwarmJob;
let getSwarmJob: typeof import('./db').getSwarmJob;
let createSwarmProof: typeof import('./db').createSwarmProof;
let listSwarmJobs: typeof import('./db').listSwarmJobs;
let getEntityDatabase: typeof import('../../../db/src/entity-db').getEntityDatabase;

beforeAll(async () => {
  ({ createSwarmRouter } = await import('./routes'));
  ({ createSwarmJob, getSwarmJob, createSwarmProof, listSwarmJobs } = await import('./db'));
  ({ getEntityDatabase } = await import('../../../db/src/entity-db'));

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

beforeEach(() => {
  delete process.env.EFORGE_API_URL;
  delete process.env.EFORGE_WEB_URL;
  delete process.env.EFORGE_QUEUE_DIR;

  const db = getEntityDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS swarm_jobs (
      id TEXT PRIMARY KEY,
      task_id INTEGER,
      title TEXT NOT NULL,
      spec TEXT NOT NULL,
      repo TEXT NOT NULL,
      branch TEXT,
      provider TEXT NOT NULL DEFAULT 'acp',
      status TEXT NOT NULL DEFAULT 'draft',
      priority TEXT NOT NULL DEFAULT 'medium',
      context_file TEXT,
      run_handle TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      feedback TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      dispatched_at TEXT,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS swarm_proofs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES swarm_jobs(id),
      provider TEXT NOT NULL,
      commit_sha TEXT,
      branch TEXT,
      build_log TEXT,
      test_result TEXT,
      test_output TEXT,
      screenshots TEXT,
      artifacts TEXT,
      duration_sec INTEGER,
      proof_type TEXT NOT NULL DEFAULT 'artifact',
      proof_ref TEXT NOT NULL DEFAULT 'proof',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS plugin_settings (
      plugin_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      settings_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    DELETE FROM swarm_proofs;
    DELETE FROM swarm_jobs;
    DELETE FROM plugin_settings;
  `);
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

  if (originalEnv !== undefined) process.env.ENTITY_TASK_DB_PATH = originalEnv;
  else delete process.env.ENTITY_TASK_DB_PATH;

  if (originalMcPath !== undefined) process.env.MISSION_CONTROL_DB_PATH = originalMcPath;
  else delete process.env.MISSION_CONTROL_DB_PATH;

  if (originalEforgeQueueDir !== undefined) process.env.EFORGE_QUEUE_DIR = originalEforgeQueueDir;
  else delete process.env.EFORGE_QUEUE_DIR;

  if (originalEforgeApiUrl !== undefined) process.env.EFORGE_API_URL = originalEforgeApiUrl;
  else delete process.env.EFORGE_API_URL;

  if (originalEforgeWebUrl !== undefined) process.env.EFORGE_WEB_URL = originalEforgeWebUrl;
  else delete process.env.EFORGE_WEB_URL;

  if (originalAcpBaseUrl !== undefined) process.env.ACP_BASE_URL = originalAcpBaseUrl;
  else delete process.env.ACP_BASE_URL;

  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(tmpDbPath + suffix);
    } catch {}
  }
});

describe('Geordi Swarm tracker API', () => {
  it('auto-dispatches queued jobs when plugin autoDispatch is enabled', async () => {
    const db = getEntityDatabase();
    db.exec(`
      CREATE TABLE IF NOT EXISTS plugin_settings (
        plugin_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        settings_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.prepare(
      `INSERT OR REPLACE INTO plugin_settings (plugin_id, enabled, settings_json, updated_at)
       VALUES (?, 1, ?, datetime('now'))`
    ).run('geordi-swarm', JSON.stringify({ autoDispatch: true, maxConcurrentJobs: 2 }));

    const response = await fetch(`${baseUrl}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Auto dispatch me',
        spec: 'Test auto dispatch',
        repo: 'repo-auto',
        provider: 'acp',
        status: 'queued',
      }),
    });
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(['queued', 'running', 'failed']).toContain(data.job.status);
    expect(data.job.status).not.toBe('draft');
  });

  it('maps status=ready to queued jobs', async () => {
    createSwarmJob({
      title: 'Queued job',
      spec: 'Ship it',
      repo: 'repo-a',
      provider: 'symphony',
    });
    createSwarmJob({
      title: 'Draft job',
      spec: 'Still drafting',
      repo: 'repo-b',
      provider: 'symphony',
    });

    const queued = listSwarmJobs({ status: 'queued' });
    const draft = listSwarmJobs({ status: 'draft' });
    expect(queued).toHaveLength(0);
    expect(draft.length).toBeGreaterThan(0);

    const draftJob = draft[0];
    await fetch(`${baseUrl}/jobs/${draftJob.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'queued' }),
    });

    const response = await fetch(`${baseUrl}/jobs?status=ready`);
    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.jobs).toHaveLength(1);
    expect(data.jobs[0].id).toBe(draftJob.id);
    expect(data.jobs[0].status).toBe('queued');
  });

  it('stores unlinked jobs with null task_id and accepts spec-only create payloads', async () => {
    const response = await fetch(`${baseUrl}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spec: 'Spec-only job',
        provider: 'symphony',
      }),
    });
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.job.task_id).toBeNull();
    expect(data.job.title).toBe('Spec-only job');
    expect(data.job.spec).toBe('Spec-only job');
  });

  it('returns graceful eforge provider status in queue mode and includes configured web url', async () => {
    const queueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-eforge-status-'));
    process.env.EFORGE_QUEUE_DIR = queueDir;
    process.env.EFORGE_WEB_URL = 'http://localhost:4567/monitor/';

    const response = await fetch(`${baseUrl}/providers/eforge/status`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.available).toBe(true);
    expect(data.mode).toBe('queue');
    expect(data.queueDir).toBe(queueDir);
    expect(data.webUrl).toBe('http://localhost:4567/monitor');
    expect(data.monitorUrl).toBe('http://localhost:4567/monitor');
    expect(data.message).toContain(queueDir);
  });

  it('saves edited spec before eforge dispatch and writes a queue artifact from the saved content', async () => {
    const queueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-eforge-queue-'));
    process.env.EFORGE_QUEUE_DIR = queueDir;

    const createResponse = await fetch(`${baseUrl}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Restore eforge dispatch',
        spec: 'original spec',
        repo: 'repo-eforge',
        provider: 'eforge',
      }),
    });
    const createData = await createResponse.json();
    const jobId = createData.job.id as string;

    const patchResponse = await fetch(`${baseUrl}/jobs/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec: 'edited spec for queue dispatch' }),
    });
    const patchData = await patchResponse.json();

    expect(patchResponse.status).toBe(200);
    expect(patchData.job.spec).toBe('edited spec for queue dispatch');

    const dispatchResponse = await fetch(`${baseUrl}/jobs/${jobId}/dispatch`, {
      method: 'POST',
    });
    const dispatchData = await dispatchResponse.json();

    expect(dispatchResponse.status).toBe(200);
    expect(dispatchData.job.status).toBe('queued');
    expect(dispatchData.job.run_handle).toBe(`eforge:${jobId}`);

    const queueFiles = fs.readdirSync(queueDir);
    expect(queueFiles).toHaveLength(1);

    const queuePath = path.join(queueDir, queueFiles[0]);
    const queueBody = fs.readFileSync(queuePath, 'utf8');
    expect(queueBody).toContain('edited spec for queue dispatch');
    expect(queueBody).not.toContain('original spec');

    const statusResponse = await fetch(`${baseUrl}/providers/eforge/status?job_id=${jobId}`);
    const statusData = await statusResponse.json();

    expect(statusResponse.status).toBe(200);
    expect(statusData.jobId).toBe(jobId);
    expect(statusData.runHandle).toBe(`eforge:${jobId}`);
    expect(statusData.jobStatus).toBe('queued');
  });

  it('rejects unsupported PATCH fields without mutating the job', async () => {
    const job = createSwarmJob({
      title: 'Guard me',
      spec: 'Only allowlisted updates should work',
      repo: 'repo-guard',
      provider: 'symphony',
    });

    const response = await fetch(`${baseUrl}/jobs/${job.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: 'Legacy summary alias' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.job.spec).toBe('Legacy summary alias');

    const rejected = await fetch(`${baseUrl}/jobs/${job.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: 999, mystery_field: 'nope' }),
    });
    const rejectedData = await rejected.json();

    expect(rejected.status).toBe(400);
    expect(rejectedData.error).toBe('No supported fields provided');
    expect(getSwarmJob(job.id)?.task_id).toBeNull();
  });

  it('claims a queued job once and rejects the second claim with structured conflict', async () => {
    const job = createSwarmJob({
      title: 'Claim me',
      spec: 'Test claim path',
      repo: 'repo-claim',
      provider: 'symphony',
    });

    await fetch(`${baseUrl}/jobs/${job.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'queued' }),
    });

    const first = await fetch(`${baseUrl}/jobs/${job.id}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimed_by: 'symphony-runner', run_handle: 'run-123' }),
    });
    const firstData = await first.json();

    expect(first.status).toBe(200);
    expect(firstData.claimed).toBe(true);
    expect(firstData.job.status).toBe('dispatched');
    expect(firstData.job.run_handle).toBe('run-123');

    const second = await fetch(`${baseUrl}/jobs/${job.id}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimed_by: 'another-runner', run_handle: 'run-456' }),
    });
    const secondData = await second.json();

    expect(second.status).toBe(409);
    expect(secondData.code).toBe('JOB_NOT_CLAIMABLE');
    expect(secondData.claimed).toBe(false);
    expect(secondData.job.status).toBe('dispatched');
  });

  it('releases only dispatched/running jobs and clears run handle', async () => {
    const job = createSwarmJob({
      title: 'Release me',
      spec: 'Test release path',
      repo: 'repo-release',
      provider: 'symphony',
    });

    await fetch(`${baseUrl}/jobs/${job.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'queued', run_handle: 'run-before-release' }),
    });
    await fetch(`${baseUrl}/jobs/${job.id}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run_handle: 'run-before-release' }),
    });

    const response = await fetch(`${baseUrl}/jobs/${job.id}/release`, { method: 'POST' });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.released).toBe(true);
    expect(data.job.status).toBe('queued');
    expect(data.job.run_handle).toBe(null);
  });

  it('cancels queued ACP jobs even when no run handle exists yet', async () => {
    const job = createSwarmJob({
      title: 'Cancel me before ACP is ready',
      spec: 'Exercise local cancel fallback',
      repo: 'repo-cancel',
      provider: 'acp',
    });

    await fetch(`${baseUrl}/jobs/${job.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'queued' }),
    });

    const response = await fetch(`${baseUrl}/jobs/${job.id}/cancel`, { method: 'POST' });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.job.status).toBe('cancelled');
    expect(data.job.feedback).toMatch(/Cancelled by user/);
    expect(data.job.completed_at).toBeTruthy();
  });


  it('appends proof artifacts without breaking proof reads', async () => {
    const job = createSwarmJob({
      title: 'Proof me',
      spec: 'Capture proof',
      repo: 'repo-proof',
      provider: 'symphony',
    });

    createSwarmProof({
      job_id: job.id,
      provider: 'symphony',
      commit_sha: 'abc123',
      branch: 'feat/test',
      build_log: 'build ok',
      test_result: 'pass',
      test_output: 'all green',
      screenshots: ['shot.png'],
      artifacts: { log: 'artifact.txt' },
      duration_sec: 42,
    });

    const response = await fetch(`${baseUrl}/jobs/${job.id}/proofs`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.proofs).toHaveLength(1);
    expect(data.proofs[0].commit_sha).toBe('abc123');
    expect(data.proofs[0].test_result).toBe('pass');
  });

  it('marks complete and fail through tracker writeback endpoints', async () => {
    const doneJob = createSwarmJob({
      title: 'Complete me',
      spec: 'Finish',
      repo: 'repo-done',
      provider: 'symphony',
    });
    await fetch(`${baseUrl}/jobs/${doneJob.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'running' }),
    });

    const complete = await fetch(`${baseUrl}/jobs/${doneJob.id}/complete`, { method: 'POST' });
    const completeData = await complete.json();
    expect(complete.status).toBe(200);
    expect(completeData.job.status).toBe('done');
    expect(getSwarmJob(doneJob.id)?.completed_at).toBeTruthy();

    const failedJob = createSwarmJob({
      title: 'Fail me',
      spec: 'Break',
      repo: 'repo-fail',
      provider: 'symphony',
    });
    const fail = await fetch(`${baseUrl}/jobs/${failedJob.id}/fail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'boom' }),
    });
    const failData = await fail.json();
    expect(fail.status).toBe(200);
    expect(failData.job.status).toBe('failed');
    expect(failData.job.feedback).toBe('boom');
  });
});
