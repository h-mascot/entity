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

process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
process.env.MISSION_CONTROL_DB_PATH = path.join(os.tmpdir(), `missing-mc-${randomUUID()}.db`);
process.env.ACP_BASE_URL = 'http://127.0.0.1:9';
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
  for (const file of [tmpDbPath, `${tmpDbPath}-wal`, `${tmpDbPath}-shm`]) {
    fs.rmSync(file, { force: true });
  }
});

beforeEach(() => {
  // Ensure the swarm schema exists on the shared temp DB before clearing rows.
  listSwarmJobs({});
  const db = getEntityDatabase();
  db.exec('DELETE FROM swarm_jobs');
});

async function json(method: string, url: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
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
  it('creates a task-linked queued job for an eligible task', async () => {
    const task = createTask('Fix login redirect', 'Blank page after SSO');
    const { status, payload } = await json('POST', `/tasks/${task.id}/run`);
    expect(status).toBe(201);
    const job = (payload as { job: { task_id: number; status: string; title: string } }).job;
    expect(job.task_id).toBe(task.id);
    expect(['queued', 'draft', 'dispatched']).toContain(job.status);
    expect(job.title).toBe('Run: Fix login redirect');
  });

  it('does not create a duplicate job when an active run already exists', async () => {
    const task = createTask('One at a time');
    const first = await json('POST', `/tasks/${task.id}/run`);
    expect(first.status).toBe(201);
    const firstId = (first.payload as { job: { id: string } }).job.id;

    const second = await json('POST', `/tasks/${task.id}/run`);
    expect(second.status).toBe(200);
    expect((second.payload as { alreadyActive: boolean }).alreadyActive).toBe(true);
    expect((second.payload as { job: { id: string } }).job.id).toBe(firstId);

    // Still exactly one job row for this task.
    expect(listSwarmJobs({ task_id: task.id })).toHaveLength(1);
  });

  it('allows a new run after the previous job reaches a terminal status', async () => {
    const task = createTask('Run again');
    const first = await json('POST', `/tasks/${task.id}/run`);
    const firstId = (first.payload as { job: { id: string } }).job.id;
    // Force the prior job to a terminal status directly via the repository boundary.
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
});
