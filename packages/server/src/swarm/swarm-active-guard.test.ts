import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

const tmpDbPath = path.join(
  os.tmpdir(),
  `entity-swarm-active-guard-${process.pid}-${randomUUID()}.db`,
);
const originalDbPath = process.env.ENTITY_TASK_DB_PATH;
const originalMcPath = process.env.MISSION_CONTROL_DB_PATH;

let createActiveTaskSwarmJob: typeof import('./db').createActiveTaskSwarmJob;
let createSwarmJob: typeof import('./db').createSwarmJob;
let updateSwarmJob: typeof import('./db').updateSwarmJob;
let listSwarmJobs: typeof import('./db').listSwarmJobs;
let getEntityDatabase: typeof import('../../../db/src/entity-db').getEntityDatabase;

beforeEach(async () => {
  vi.resetModules();
  process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
  process.env.MISSION_CONTROL_DB_PATH = path.join(os.tmpdir(), `missing-mc-${randomUUID()}.db`);
  ({ createActiveTaskSwarmJob, createSwarmJob, updateSwarmJob, listSwarmJobs } = await import('./db'));
  ({ getEntityDatabase } = await import('../../../db/src/entity-db'));
  // Ensure schema (and the active-task uniqueness index) exists, then start clean.
  listSwarmJobs({});
  getEntityDatabase().exec('DELETE FROM swarm_jobs');
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const file of [tmpDbPath, `${tmpDbPath}-wal`, `${tmpDbPath}-shm`]) {
    fs.rmSync(file, { force: true });
  }
  if (originalDbPath === undefined) delete process.env.ENTITY_TASK_DB_PATH;
  else process.env.ENTITY_TASK_DB_PATH = originalDbPath;
  if (originalMcPath === undefined) delete process.env.MISSION_CONTROL_DB_PATH;
  else process.env.MISSION_CONTROL_DB_PATH = originalMcPath;
});

const ACTIVE_INPUT = {
  title: 'Run: T',
  spec: 'spec',
  repo: 'https://github.com/acme/mono',
  branch: 'main',
  provider: 'acp',
  task_id: 4242,
};

describe('createActiveTaskSwarmJob — atomic duplicate-active guard', () => {
  it('creates the first active job for a task', () => {
    const result = createActiveTaskSwarmJob(ACTIVE_INPUT);
    expect(result.created).toBe(true);
    expect(result.job.task_id).toBe(4242);
    expect(result.job.status).toBe('draft');
    expect(listSwarmJobs({ task_id: 4242 })).toHaveLength(1);
  });

  it('returns the existing active job (created:false) on a concurrent/second attempt — no duplicate row', () => {
    const first = createActiveTaskSwarmJob(ACTIVE_INPUT);
    expect(first.created).toBe(true);

    // Simulate a concurrent winner: a second attempt must not insert a second row.
    const second = createActiveTaskSwarmJob(ACTIVE_INPUT);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    expect(listSwarmJobs({ task_id: 4242 })).toHaveLength(1);
  });

  it('still guards after the job is queued/dispatched/running (all active statuses)', () => {
    const first = createActiveTaskSwarmJob(ACTIVE_INPUT);
    updateSwarmJob(first.job.id, { status: 'queued' });
    const second = createActiveTaskSwarmJob(ACTIVE_INPUT);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    expect(listSwarmJobs({ task_id: 4242 })).toHaveLength(1);
  });

  it('allows a new active job once the previous one reaches a terminal status', () => {
    const first = createActiveTaskSwarmJob(ACTIVE_INPUT);
    updateSwarmJob(first.job.id, { status: 'done' });

    const second = createActiveTaskSwarmJob(ACTIVE_INPUT);
    expect(second.created).toBe(true);
    expect(second.job.id).not.toBe(first.job.id);
    expect(listSwarmJobs({ task_id: 4242 })).toHaveLength(2);
  });

  it('enforces the invariant at the DB layer even when a row is inserted directly (race winner)', () => {
    // A concurrent writer inserts an active draft row out-of-band.
    createSwarmJob({ ...ACTIVE_INPUT });

    // The guarded creator must observe the winner and return it instead of duplicating.
    const result = createActiveTaskSwarmJob(ACTIVE_INPUT);
    expect(result.created).toBe(false);
    expect(listSwarmJobs({ task_id: 4242 })).toHaveLength(1);
  });

  it('does not guard unlinked (task_id null) jobs — those remain free-form', () => {
    const a = createActiveTaskSwarmJob({ title: 'global a', spec: 's', repo: 'r' });
    const b = createActiveTaskSwarmJob({ title: 'global b', spec: 's', repo: 'r' });
    expect(a.created).toBe(true);
    expect(b.created).toBe(true);
    expect(a.job.id).not.toBe(b.job.id);
  });
});
