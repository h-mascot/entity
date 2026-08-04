/**
 * THE-932 — Persist/expose last background healer result/time/error.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
});
