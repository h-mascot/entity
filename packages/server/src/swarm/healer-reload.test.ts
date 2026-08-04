/**
 * THE-932 (blocker 3) — healer successful-state restore across module reload.
 *
 * A successful heal outcome is persisted with `error: null`. On module load the
 * healer must restore `{ result, timestamp, error: null }` from the persisted
 * store, not discard it because `error` is not a string. This exercises the real
 * module-load restore path (process restart boundary), not an in-memory shortcut.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-healer-reload-'));
const tmpDbPath = path.join(tmpDir, `healer-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const originalDbPath = process.env.ENTITY_TASK_DB_PATH;

beforeAll(() => {
  process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
});

afterAll(() => {
  if (originalDbPath !== undefined) process.env.ENTITY_TASK_DB_PATH = originalDbPath;
  else delete process.env.ENTITY_TASK_DB_PATH;
  try {
    fs.rmSync(tmpDbPath, { force: true });
  } catch {}
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe('swarm healer — successful outcome restored after module reload (THE-932)', () => {
  beforeEach(() => {
    // Each verification starts from a clean module registry so the top-level
    // restore path genuinely re-runs against the persisted store.
    vi.resetModules();
  });

  it('persists a successful outcome and restores {result,timestamp,error:null} on reload', async () => {
    // Phase 1: run a successful heal cycle against the file DB and capture it.
    const phase1 = await import('./healer');
    const result = await phase1.healStuckJobs();
    expect(result.stuckJobs).toBe(0);
    const before = phase1.getLastHealOutcome();
    expect(before).not.toBeNull();
    expect(before!.error).toBeNull();
    expect(before!.result).not.toBeNull();
    const persistedTimestamp = before!.timestamp;
    const persistedStuckJobs = before!.result!.stuckJobs;

    // Phase 2: simulate a process/module restart. The healer module's top-level
    // restore must read the persisted success and expose it (error: null).
    vi.resetModules();
    const phase2 = await import('./healer');
    const restored = phase2.getLastHealOutcome();
    expect(restored).not.toBeNull();
    expect(restored!.error).toBeNull();
    expect(restored!.result).not.toBeNull();
    expect(restored!.result!.stuckJobs).toBe(persistedStuckJobs);
    expect(restored!.timestamp).toBe(persistedTimestamp);
  });
});
