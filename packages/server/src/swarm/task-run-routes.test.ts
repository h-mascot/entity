import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

const tmpDbPath = path.join(
  os.tmpdir(),
  `entity-swarm-task-run-${process.pid}-${randomUUID()}.db`,
);
const originalDbPath = process.env.ENTITY_TASK_DB_PATH;
const originalMcPath = process.env.MISSION_CONTROL_DB_PATH;
const originalAcpBaseUrl = process.env.ACP_BASE_URL;
const originalRunRepo = process.env.ENTITY_SWARM_RUN_REPO;

// Governed execution target for happy-path Run-with-agents tests (BRD-004: the
// dispatch target must come from governed config / request / task metadata, and
// never an example placeholder).
process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
process.env.MISSION_CONTROL_DB_PATH = path.join(os.tmpdir(), `missing-mc-${randomUUID()}.db`);
process.env.ACP_BASE_URL = 'http://127.0.0.1:9';
process.env.ENTITY_SWARM_RUN_REPO = 'https://github.com/acme/entity';
delete process.env.EFORGE_API_URL;
delete process.env.EFORGE_WEB_URL;
delete process.env.EFORGE_QUEUE_DIR;

let baseUrl = '';
let server: Awaited<ReturnType<express.Express['listen']>>;
let createSwarmRouter: typeof import('./routes').createSwarmRouter;
let createTaskRepository: typeof import('../../../db/src').createTaskRepository;
let listSwarmJobs: typeof import('./db').listSwarmJobs;
let getEntityDatabase: typeof import('../../../db/src/entity-db').getEntityDatabase;

beforeAll(async () => {
  ({ createSwarmRouter } = await import('./routes'));
  ({ createTaskRepository } = await import('../../../db/src'));
  ({ listSwarmJobs } = await import('./db'));
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

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  if (originalDbPath === undefined) delete process.env.ENTITY_TASK_DB_PATH;
  else process.env.ENTITY_TASK_DB_PATH = originalDbPath;
  if (originalMcPath === undefined) delete process.env.MISSION_CONTROL_DB_PATH;
  else process.env.MISSION_CONTROL_DB_PATH = originalMcPath;
  if (originalAcpBaseUrl === undefined) delete process.env.ACP_BASE_URL;
  else process.env.ACP_BASE_URL = originalAcpBaseUrl;
  if (originalRunRepo === undefined) delete process.env.ENTITY_SWARM_RUN_REPO;
  else process.env.ENTITY_SWARM_RUN_REPO = originalRunRepo;
  for (const file of [tmpDbPath, `${tmpDbPath}-wal`, `${tmpDbPath}-shm`]) {
    fs.rmSync(file, { force: true });
  }
});

beforeEach(() => {
  listSwarmJobs({});
  const db = getEntityDatabase();
  db.exec('DELETE FROM swarm_jobs');
});

async function json(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let payload: unknown = undefined;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  return { status: res.status, payload };
}

function createTask(name: string, description?: string) {
  const repo = createTaskRepository();
  return repo.createTask({ name, description });
}

describe('POST /api/swarm/tasks/:taskId/run (Run with agents)', () => {
  it('creates a task-linked queued job for an eligible task using the configured target', async () => {
    const task = createTask('Fix login redirect', 'Blank page after SSO');
    const { status, payload } = await json('POST', `/tasks/${task.id}/run`);
    expect(status).toBe(201);
    const job = (payload as { job: { task_id: number; status: string; title: string; repo: string } }).job;
    expect(job.task_id).toBe(task.id);
    expect(['queued', 'draft', 'dispatched']).toContain(job.status);
    expect(job.title).toBe('Run: Fix login redirect');
    // Governed target is used verbatim — never the example placeholder.
    expect(job.repo).toBe('https://github.com/acme/entity');
  });

  it('does not create a duplicate job when an active run already exists (atomic guard)', async () => {
    const task = createTask('One at a time');
    const first = await json('POST', `/tasks/${task.id}/run`);
    expect(first.status).toBe(201);
    const firstId = (first.payload as { job: { id: string } }).job.id;

    // Fire a burst of concurrent requests; the atomic DB invariant must keep
    // exactly one active job regardless of arrival order.
    const concurrent = await Promise.all([
      json('POST', `/tasks/${task.id}/run`),
      json('POST', `/tasks/${task.id}/run`),
      json('POST', `/tasks/${task.id}/run`),
    ]);
    for (const r of concurrent) {
      expect(r.status).toBe(200);
      expect((r.payload as { alreadyActive: boolean }).alreadyActive).toBe(true);
      expect((r.payload as { job: { id: string } }).job.id).toBe(firstId);
    }

    expect(listSwarmJobs({ task_id: task.id })).toHaveLength(1);
  });

  it('allows a new run after the previous job reaches a terminal status', async () => {
    const task = createTask('Run again');
    const first = await json('POST', `/tasks/${task.id}/run`);
    const firstId = (first.payload as { job: { id: string } }).job.id;
    const { updateSwarmJob } = await import('./db');
    updateSwarmJob(firstId, { status: 'done' });

    const second = await json('POST', `/tasks/${task.id}/run`);
    expect(second.status).toBe(201);
    expect((second.payload as { job: { id: string } }).job.id).not.toBe(firstId);
    expect(listSwarmJobs({ task_id: task.id })).toHaveLength(2);
  });

  it('returns 404 for a missing task and 400 for an invalid id', async () => {
    expect((await json('POST', '/tasks/999999/run')).status).toBe(404);
    expect((await json('POST', '/tasks/abc/run')).status).toBe(400);
    expect((await json('POST', '/tasks/0/run')).status).toBe(400);
  });

  it('rejects an ineligible (done) task with 409 TASK_NOT_ELIGIBLE', async () => {
    const task = createTask('Already shipped');
    const repo = createTaskRepository();
    repo.updateTask(task.id, { column: 'done' });

    const { status, payload } = await json('POST', `/tasks/${task.id}/run`);
    expect(status).toBe(409);
    expect((payload as { code: string }).code).toBe('TASK_NOT_ELIGIBLE');
    expect(listSwarmJobs({ task_id: task.id })).toHaveLength(0);
  });

  it('fails closed with 400 NO_EXECUTION_TARGET when no governed target is configured', async () => {
    const task = createTask('Needs a target');
    const prev = process.env.ENTITY_SWARM_RUN_REPO;
    delete process.env.ENTITY_SWARM_RUN_REPO;
    try {
      const { status, payload } = await json('POST', `/tasks/${task.id}/run`);
      expect(status).toBe(400);
      expect((payload as { code: string }).code).toBe('NO_EXECUTION_TARGET');
      expect(listSwarmJobs({ task_id: task.id })).toHaveLength(0);
    } finally {
      process.env.ENTITY_SWARM_RUN_REPO = prev;
    }
  });

  it('fails closed (404) for a task outside the request org scope', async () => {
    const task = createTask('Scoped task');
    const { status } = await json('POST', `/tasks/${task.id}/run`, undefined, {
      'x-entity-org-id': 'some-other-org',
    });
    expect(status).toBe(404);
    expect(listSwarmJobs({ task_id: task.id })).toHaveLength(0);
  });

  it('honours an explicit request-body repo override over governed config', async () => {
    const task = createTask('Override target');
    const { status, payload } = await json('POST', `/tasks/${task.id}/run`, {
      repo: 'https://github.com/acme/override',
      branch: 'feat',
    });
    expect(status).toBe(201);
    expect((payload as { job: { repo: string; branch: string } }).job.repo).toBe(
      'https://github.com/acme/override',
    );
  });
});
