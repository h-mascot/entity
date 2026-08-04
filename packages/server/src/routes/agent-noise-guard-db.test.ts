/**
 * THE-930 (matrix gap) — DB-backed atomic reservation.
 *
 * The reservation/cooldown state is backed by a shared SQLite table so two
 * independent Entity server processes (or two guard instances) using the same DB
 * cannot both win a concurrent scoped reservation. The DB path uses a
 * transactional compare-and-set with lease expiry, success-only cooldown, bounded
 * cleanup, and an injectable clock. In-process behavior (the default, no DB) and
 * settings are preserved by the sibling in-memory suite.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAgentNoiseGuard } from './agent-noise-guard';

function scope(channelId: string, threadId?: string) {
  return { channelId, threadId };
}

function configure(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
}

const tmpDbPath = path.join(
  os.tmpdir(),
  `entity-noise-db-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);

let db1: Database.Database;
let db2: Database.Database;

beforeAll(() => {
  db1 = new Database(tmpDbPath);
  configure(db1);
  db2 = new Database(tmpDbPath);
  configure(db2);
});

afterAll(() => {
  try { db1.close(); } catch {}
  try { db2.close(); } catch {}
  try { fs.rmSync(tmpDbPath, { force: true }); } catch {}
  try { fs.rmSync(`${tmpDbPath}-wal`, { force: true }); } catch {}
  try { fs.rmSync(`${tmpDbPath}-shm`, { force: true }); } catch {}
});

describe('AgentNoiseGuard — DB-backed atomic reservation (THE-930 matrix gap)', () => {
  it('only one of two independent instances wins a concurrent scoped reservation', () => {
    let clock = 5_000;
    const guard1 = createAgentNoiseGuard({ db: db1, cooldownMs: 0, leaseMs: 30_000, now: () => clock });
    const guard2 = createAgentNoiseGuard({ db: db2, cooldownMs: 0, leaseMs: 30_000, now: () => clock });

    const r1 = guard1.reserve('ada', scope('c1'), 'hello');
    const r2 = guard2.reserve('ada', scope('c1'), 'hello');

    // Exactly one wins; the other is suppressed as a concurrent duplicate.
    const winners = [r1, r2].filter((r) => !r.suppressed);
    expect(winners).toHaveLength(1);
    const suppressed = [r1, r2].find((r) => r.suppressed)!;
    expect(suppressed.reason).toBe('duplicate-concurrent');
  });

  it('releases the in-flight lease so a retry can win after the holder releases (no cooldown on non-delivery)', () => {
    let clock = 6_000;
    const guard1 = createAgentNoiseGuard({ db: db1, cooldownMs: 0, leaseMs: 30_000, now: () => clock });
    const guard2 = createAgentNoiseGuard({ db: db2, cooldownMs: 0, leaseMs: 30_000, now: () => clock });

    expect(guard1.reserve('bob', scope('c2'), 'retry-me').suppressed).toBe(false);
    expect(guard2.reserve('bob', scope('c2'), 'retry-me').reason).toBe('duplicate-concurrent');
    // Failed delivery: release without consuming cooldown.
    guard1.release('bob', scope('c2'), 'retry-me');
    // The other instance can now acquire immediately.
    expect(guard2.reserve('bob', scope('c2'), 'retry-me').suppressed).toBe(false);
  });

  it('expires a held lease after leaseMs so a crashed holder does not block forever', () => {
    let clock = 7_000;
    const guard1 = createAgentNoiseGuard({ db: db1, cooldownMs: 0, leaseMs: 1_000, now: () => clock });
    const guard2 = createAgentNoiseGuard({ db: db2, cooldownMs: 0, leaseMs: 1_000, now: () => clock });

    expect(guard1.reserve('cara', scope('c3'), 'lease').suppressed).toBe(false);
    expect(guard2.reserve('cara', scope('c3'), 'lease').reason).toBe('duplicate-concurrent');
    // Simulate the holder crashing (never releases). After the lease elapses, a
    // new reservation wins.
    clock += 1_001;
    expect(guard2.reserve('cara', scope('c3'), 'lease').suppressed).toBe(false);
  });

  it('records a success-only cooldown visible across instances', () => {
    let clock = 8_000;
    const guard1 = createAgentNoiseGuard({ db: db1, cooldownMs: 5_000, leaseMs: 30_000, now: () => clock });
    const guard2 = createAgentNoiseGuard({ db: db2, cooldownMs: 5_000, leaseMs: 30_000, now: () => clock });

    expect(guard1.reserve('dan', scope('c4'), 'cooldown').suppressed).toBe(false);
    guard1.release('dan', scope('c4'), 'cooldown', { delivered: true });
    // Within the cooldown window, the OTHER instance is suppressed.
    expect(guard2.reserve('dan', scope('c4'), 'cooldown').reason).toBe('cooldown');
    // After the window elapses, it is allowed.
    clock += 5_000;
    expect(guard2.reserve('dan', scope('c4'), 'cooldown').suppressed).toBe(false);
  });

  it('does not suppress different agents, scopes, or content (mixed-target behavior)', () => {
    let clock = 9_000;
    const guard1 = createAgentNoiseGuard({ db: db1, cooldownMs: 0, leaseMs: 30_000, now: () => clock });
    const guard2 = createAgentNoiseGuard({ db: db2, cooldownMs: 0, leaseMs: 30_000, now: () => clock });

    guard1.reserve('eve', scope('c5'), 'hello');
    expect(guard2.reserve('eve', scope('c5'), 'different').suppressed).toBe(false);
    expect(guard2.reserve('frank', scope('c5'), 'hello').suppressed).toBe(false);
    expect(guard2.reserve('eve', scope('c6'), 'hello').suppressed).toBe(false);
    expect(guard2.reserve('eve', scope('c5', 't1'), 'hello').suppressed).toBe(false);
  });

  it('honors the mute set independent of the DB backend', () => {
    const guard1 = createAgentNoiseGuard({ db: db1, cooldownMs: 0, leaseMs: 30_000, mutedAgents: ['spock'] });
    const r = guard1.reserve('spock', scope('c7'), 'hi');
    expect(r.suppressed).toBe(true);
    expect(r.reason).toBe('muted');
  });

  it('bounds stored state (cleanup keeps the table from growing unbounded)', () => {
    let clock = 10_000;
    const guard = createAgentNoiseGuard({
      db: db1,
      cooldownMs: 1_000,
      leaseMs: 30_000,
      maxStateEntries: 3,
      now: () => clock,
    });
    for (let i = 0; i < 6; i += 1) {
      guard.reserve('g', scope(`cb${i}`), `m${i}`);
      guard.release('g', scope(`cb${i}`), `m${i}`, { delivered: true });
      clock += 1;
    }
    expect(guard.snapshot().trackedScopes).toBeLessThanOrEqual(3);
  });
});
