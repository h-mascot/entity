/**
 * THE-932 — healer DB access must NOT happen at module-import time.
 *
 * Production import order: `packages/server/src/index.ts` statically imports the
 * swarm seam (`import { createSwarmRouter } from "./swarm"`) and later dynamically
 * imports `./swarm/healer` during startup. If the healer touched the DB at module
 * load, it would resolve the fallback DB path before dotenv/bootstrap has set
 * ENTITY_TASK_DB_PATH. The fix defers persisted-state restoration to first use.
 *
 * This test reproduces that order with a real filesystem probe: a configured DB
 * path that does NOT exist yet must remain non-existent after importing the seam,
 * and a later lazy read must restore state from the CONFIGURED db only.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const originalDbPath = process.env.ENTITY_TASK_DB_PATH;

function uniqueDb(label: string): string {
  return path.join(os.tmpdir(), `entity-healer-prod-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

afterAll(() => {
  if (originalDbPath !== undefined) process.env.ENTITY_TASK_DB_PATH = originalDbPath;
  else delete process.env.ENTITY_TASK_DB_PATH;
});

describe('THE-932 — production-order healer DB boundary', () => {
  it('does not touch the DB when the swarm seam is imported before env resolves', async () => {
    // A configured DB path that does NOT exist yet. If importing the swarm seam
    // or healer performed any DB I/O, this file would be created on disk.
    const probeDb = uniqueDb('probe');
    process.env.ENTITY_TASK_DB_PATH = probeDb;
    expect(fs.existsSync(probeDb)).toBe(false);

    vi.resetModules();
    // Mirror server/index.ts: static swarm seam import, then dynamic healer import.
    await import('./index');
    await import('./healer');

    // Import performed ZERO database I/O — the probe file was never created.
    expect(fs.existsSync(probeDb)).toBe(false);
  });

  it('restores persisted state lazily, only from the configured DB', async () => {
    // Phase 1: seed a known successful outcome into a configured temp DB.
    const configuredDb = uniqueDb('configured');
    process.env.ENTITY_TASK_DB_PATH = configuredDb;
    vi.resetModules();
    const healerSeed = await import('./healer');
    const result = await healerSeed.healStuckJobs();
    expect(result.stuckJobs).toBe(0);
    const seeded = healerSeed.getLastHealOutcome();
    expect(seeded).not.toBeNull();
    expect(seeded!.error).toBeNull();
    expect(seeded!.result).not.toBeNull();
    const seededTimestamp = seeded!.timestamp;
    const seededStuck = seeded!.result!.stuckJobs;

    // Phase 2: simulate a process restart with a DIFFERENT configured path that
    // does not exist. Importing the fresh healer module must not read it.
    const restartProbe = uniqueDb('restart');
    process.env.ENTITY_TASK_DB_PATH = restartProbe;
    vi.resetModules();
    const healerRestart = await import('./healer');
    expect(fs.existsSync(restartProbe)).toBe(false); // no DB I/O on import

    // Phase 3: point env back at the configured DB and lazily read state. The
    // healer restores the seeded outcome from the CONFIGURED db — proving it
    // reads the configured store, not a checkout-local fallback.
    process.env.ENTITY_TASK_DB_PATH = configuredDb;
    const restored = healerRestart.getLastHealOutcome();
    expect(restored).not.toBeNull();
    expect(restored!.error).toBeNull();
    expect(restored!.result).not.toBeNull();
    expect(restored!.timestamp).toBe(seededTimestamp);
    expect(restored!.result!.stuckJobs).toBe(seededStuck);
    // The restart probe was never created: lazy restore used the configured db.
    expect(fs.existsSync(restartProbe)).toBe(false);

    // Cleanup configured db + sqlite sidecars.
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.rmSync(configuredDb + suffix, { force: true }); } catch {}
    }
  });
});
