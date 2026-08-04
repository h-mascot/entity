/**
 * THE-932 — Persist/expose last background healer result/time/error.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureSwarmSchema, getSwarmJobOn, updateSwarmJobOn } from './db';
import { randomUUID } from 'crypto';

function insertStuckJob(db: Database.Database, overrides: Partial<{ id: string; status: string; retry_count: number; max_retries: number; dispatched_at: string }> = {}): string {
  const id = overrides.id ?? randomUUID();
  ensureSwarmSchema(db);
  db.prepare(`
    INSERT INTO swarm_jobs (id, task_id, title, spec, repo, branch, provider, status, priority, context_file, run_handle, retry_count, max_retries, feedback, created_by, created_at, updated_at, dispatched_at, completed_at)
    VALUES (@id, NULL, @title, @spec, @repo, NULL, 'acp', @status, 'medium', NULL, NULL, @retry_count, @max_retries, NULL, NULL, datetime('now'), datetime('now'), @dispatched_at, NULL)
  `).run({
    id,
    title: 'stuck-job',
    spec: 'spec',
    repo: 'repo',
    status: overrides.status ?? 'running',
    retry_count: overrides.retry_count ?? 0,
    max_retries: overrides.max_retries ?? 3,
    dispatched_at: overrides.dispatched_at ?? new Date(Date.now() - 120 * 60 * 1000).toISOString(),
  });
  return id;
}

const tmpDbPath = path.join(os.tmpdir(), `entity-healer-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const originalDbPath = process.env.ENTITY_TASK_DB_PATH;

beforeEach(() => {
  process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
});

afterEach(() => {
  if (originalDbPath !== undefined) process.env.ENTITY_TASK_DB_PATH = originalDbPath;
  else delete process.env.ENTITY_TASK_DB_PATH;
  try {
    fs.rmSync(tmpDbPath, { force: true });
  } catch {}
});

describe('swarm healer — last result/time/error (THE-932)', () => {
  it('records the last successful heal result with a timestamp and no error', async () => {
    const { healStuckJobs, getLastHealOutcome } = await import('./healer');
    const result = await healStuckJobs();
    expect(result.stuckJobs).toBe(0);

    const outcome = getLastHealOutcome();
    expect(outcome).not.toBeNull();
    expect(outcome!.error).toBeNull();
    expect(outcome!.result).not.toBeNull();
    expect(outcome!.result!.stuckJobs).toBe(0);
    expect(typeof outcome!.timestamp).toBe('string');
    expect(new Date(outcome!.timestamp).getTime()).not.toBeNaN();
  });

  it('records the error message and time when a heal cycle throws', async () => {
    const { healStuckJobs, getLastHealOutcome } = await import('./healer');
    await expect(
      healStuckJobs({ getDatabase: () => { throw new Error('database exploded'); } }),
    ).rejects.toThrow('database exploded');

    const outcome = getLastHealOutcome();
    expect(outcome).not.toBeNull();
    expect(outcome!.error).toBe('database exploded');
    expect(outcome!.result).toBeNull();
    expect(typeof outcome!.timestamp).toBe('string');
  });

  it('exposes the last outcome through getHealerStatus', async () => {
    const { healStuckJobs, getHealerStatus } = await import('./healer');
    await healStuckJobs();
    const status = getHealerStatus();
    expect(status.lastResult).toBeDefined();
    expect(status.lastResult!.error).toBeNull();
  });

  it('persists status through the injected getDatabase (consistent dependency boundary)', async () => {
    const { healStuckJobs } = await import('./healer');
    const { ensureAppSettingsTable, getSettingJson } = await import('../config/settings-store');
    // A separate in-memory database stands in for a non-default target.
    const injected = new Database(':memory:');
    try {
      const result = await healStuckJobs({ getDatabase: () => injected });
      expect(result.stuckJobs).toBe(0);
      ensureAppSettingsTable(injected);
      const stored = getSettingJson(injected, 'swarm.healerStatus') as { error: string | null } | null;
      expect(stored).not.toBeNull();
      expect(stored!.error).toBeNull();
    } finally {
      injected.close();
    }
  });

  it('heals a stuck job in the injected DB and leaves the default/global DB untouched (THE-932 blocker 4)', async () => {
    const { healStuckJobs } = await import('./healer');
    const { createSwarmJob, updateSwarmJob, getSwarmJob } = await import('./db');

    // Default/global database holds a DIFFERENT retryable stuck job that must never be touched.
    const globalJob = createSwarmJob({ title: 'global-stuck', spec: 's', repo: 'r' });
    updateSwarmJob(globalJob.id, {
      status: 'running',
      dispatched_at: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
    });
    expect(getSwarmJob(globalJob.id)!.status).toBe('running');

    // Injected (non-default) in-memory database holds its own retryable stuck job.
    const injected = new Database(':memory:');
    try {
      const injectedStuckId = insertStuckJob(injected, { retry_count: 0, max_retries: 3 });
      expect(getSwarmJobOn(injected, injectedStuckId)!.status).toBe('running');

      const result = await healStuckJobs({ getDatabase: () => injected });
      expect(result.stuckJobs).toBe(1);
      expect(result.retriedJobs).toBe(1);

      // The injected row was healed (re-queued for retry).
      const healed = getSwarmJobOn(injected, injectedStuckId)!;
      expect(healed.status).toBe('queued');
      expect(healed.retry_count).toBe(1);

      // The default/global database was NOT mutated: its stuck job is still running.
      const globalStillStuck = getSwarmJob(globalJob.id);
      expect(globalStillStuck).toBeDefined();
      expect(globalStillStuck!.status).toBe('running');
      expect(globalStillStuck!.retry_count).toBe(0);
    } finally {
      injected.close();
    }
  });
});
