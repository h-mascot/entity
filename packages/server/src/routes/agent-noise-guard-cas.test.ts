/**
 * THE-930 (blockers 1-3) — tokenized lease CAS, bounded state, fail-closed policy.
 *
 * Each case uses its OWN temp DB + synthetic clock so the suite cannot mask a
 * defect via shared state or incompatible clocks (the original review found the
 * committed bounded-state test passed only because it ran after other cases on
 * a shared DB).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { createAgentNoiseGuard } from './agent-noise-guard';

function scope(channelId: string, threadId?: string) {
  return { channelId, threadId };
}

function newDb(): { db: Database.Database; cleanup: () => void } {
  const dbPath = path.join(os.tmpdir(), `entity-noise-cas-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  const cleanup = () => {
    try { db.close(); } catch {}
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.rmSync(dbPath + suffix, { force: true }); } catch {}
    }
  };
  return { db, cleanup };
}

// A shared SQLite file with several independent connections, mirroring multiple
// Entity server processes (or guard instances) on the same DB. Cross-instance
// CAS semantics only hold when every instance talks to the same store.
function sharedDbPool(n: number): { connections: Database.Database[]; cleanup: () => void } {
  const dbPath = path.join(os.tmpdir(), `entity-noise-shared-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const connections: Database.Database[] = [];
  for (let i = 0; i < n; i += 1) {
    const c = new Database(dbPath);
    c.pragma('journal_mode = WAL');
    c.pragma('synchronous = NORMAL');
    c.pragma('busy_timeout = 5000');
    connections.push(c);
  }
  const cleanup = () => {
    for (const c of connections) {
      try { c.close(); } catch {}
    }
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.rmSync(dbPath + suffix, { force: true }); } catch {}
    }
  };
  return { connections, cleanup };
}

const cleanups: Array<() => void> = [];
afterAll(() => {
  for (const cleanup of cleanups) cleanup();
});

describe('THE-930 — tokenized lease CAS (stale owner cannot release a reacquired lease)', () => {
  it('a stale owner releasing after reacquisition leaves the new owner intact', () => {
    const { connections, cleanup } = sharedDbPool(3);
    cleanups.push(cleanup);
    const [dbA, dbB, dbC] = connections;
    let clock = 1_000;
    const guardA = createAgentNoiseGuard({ db: dbA, cooldownMs: 0, leaseMs: 1_000, now: () => clock });
    const guardB = createAgentNoiseGuard({ db: dbB, cooldownMs: 0, leaseMs: 1_000, now: () => clock });
    const guardC = createAgentNoiseGuard({ db: dbC, cooldownMs: 0, leaseMs: 1_000, now: () => clock });

    // A acquires.
    const aRes = guardA.reserve('ada', scope('c1'), 'hello');
    expect(aRes.suppressed).toBe(false);
    expect(aRes.ownerToken).toBeTruthy();
    const tokenA = aRes.ownerToken!;
    // B is blocked while A holds the lease.
    expect(guardB.reserve('ada', scope('c1'), 'hello').reason).toBe('duplicate-concurrent');

    // A's lease expires; B reacquires the same key (new owner token).
    clock += 1_001;
    const bRes = guardB.reserve('ada', scope('c1'), 'hello');
    expect(bRes.suppressed).toBe(false);
    expect(bRes.ownerToken).toBeTruthy();
    const tokenB = bRes.ownerToken!;
    expect(tokenB).not.toBe(tokenA);

    // Late A releases with its STALE token. This must NOT clear B's lease nor
    // record A's cooldown. C (a third instance on the same shared store) must
    // remain blocked while B owns.
    guardA.release('ada', scope('c1'), 'hello', { delivered: false, ownerToken: tokenA });
    expect(guardC.reserve('ada', scope('c1'), 'hello').reason).toBe('duplicate-concurrent');

    // B legitimately releases; now C may acquire.
    guardB.release('ada', scope('c1'), 'hello', { delivered: false, ownerToken: tokenB });
    expect(guardC.reserve('ada', scope('c1'), 'hello').suppressed).toBe(false);
  });

  it('two reservations of the same key cannot confuse the ownerToken release flow', () => {
    const { db, cleanup } = newDb();
    cleanups.push(cleanup);
    let clock = 2_000;
    const guard = createAgentNoiseGuard({ db, cooldownMs: 0, leaseMs: 30_000, now: () => clock });

    const first = guard.reserve('bob', scope('c2'), 'dup');
    expect(first.suppressed).toBe(false);
    const token1 = first.ownerToken!;
    // A second reservation of the SAME key is a concurrent duplicate (no token).
    const second = guard.reserve('bob', scope('c2'), 'dup');
    expect(second.suppressed).toBe(true);
    expect(second.reason).toBe('duplicate-concurrent');
    expect(second.ownerToken).toBeUndefined();

    // Releasing with the genuine owner token clears the lease.
    guard.release('bob', scope('c2'), 'dup', { delivered: false, ownerToken: token1 });
    expect(guard.reserve('bob', scope('c2'), 'dup').suppressed).toBe(false);

    // A release with the now-stale first token is a no-op (lease already cleared
    // and a new reservation has a different token).
    const third = guard.reserve('bob', scope('c2'), 'dup');
    const token3 = third.ownerToken!;
    guard.release('bob', scope('c2'), 'dup', { delivered: false, ownerToken: token1 });
    // token3 holder still owns; a fresh reservation is blocked.
    expect(guard.reserve('bob', scope('c2'), 'dup').reason).toBe('duplicate-concurrent');
    guard.release('bob', scope('c2'), 'dup', { delivered: false, ownerToken: token3 });
  });
});

describe('THE-930 — truly bounded state (isolated DB/clock)', () => {
  it('never exceeds maxStateEntries and fails closed when nothing is safely evictable', () => {
    const { db, cleanup } = newDb();
    cleanups.push(cleanup);
    let clock = 3_000;
    // maxStateEntries = 3. Long cooldown so delivered rows stay "live" (protected).
    const guard = createAgentNoiseGuard({
      db,
      cooldownMs: 100_000,
      leaseMs: 30_000,
      maxStateEntries: 3,
      now: () => clock,
    });

    // Fill to the cap with delivered (cooldown-protected) rows.
    for (let i = 0; i < 3; i += 1) {
      const r = guard.reserve('g', scope(`cap${i}`), `m${i}`);
      expect(r.suppressed).toBe(false);
      guard.release('g', scope(`cap${i}`), `m${i}`, { delivered: true, ownerToken: r.ownerToken! });
      clock += 1;
    }
    // At cap with 3 live-cooldown rows. A 4th reservation must FAIL CLOSED with
    // the capacity reason rather than evicting a live cooldown / exceeding max.
    const blocked = guard.reserve('g', scope('cap3'), 'm3');
    expect(blocked.suppressed).toBe(true);
    expect(blocked.reason).toBe('capacity');
    // State never exceeds the cap.
    expect(guard.snapshot().trackedScopes).toBeLessThanOrEqual(3);
  });

  it('preserves a live cooldown under pressure (does not evict an active cooldown row)', () => {
    const { db, cleanup } = newDb();
    cleanups.push(cleanup);
    let clock = 4_000;
    const guard = createAgentNoiseGuard({
      db,
      cooldownMs: 10_000,
      leaseMs: 30_000,
      maxStateEntries: 2,
      now: () => clock,
    });

    // Two delivered rows fill the cap; both are within the 10s cooldown window.
    for (let i = 0; i < 2; i += 1) {
      const r = guard.reserve('g', scope(`p${i}`), `m${i}`);
      guard.release('g', scope(`p${i}`), `m${i}`, { delivered: true, ownerToken: r.ownerToken! });
    }
    // A 3rd distinct scope at capacity with no safely-evictable row fails closed.
    const blocked = guard.reserve('g', scope('p2'), 'm2');
    expect(blocked.reason).toBe('capacity');
    // The original cooldown is still enforced: re-reserving p0 within the window
    // is suppressed by cooldown, proving the live cooldown was NOT evicted.
    const retry = guard.reserve('g', scope('p0'), 'm0');
    expect(retry.reason).toBe('cooldown');
  });

  it('evicts only fully-stale rows (expired lease AND elapsed cooldown) to stay bounded', () => {
    const { db, cleanup } = newDb();
    cleanups.push(cleanup);
    let clock = 5_000;
    const guard = createAgentNoiseGuard({
      db,
      cooldownMs: 1_000,
      leaseMs: 30_000,
      maxStateEntries: 2,
      now: () => clock,
    });

    // Fill cap, then let cooldowns fully elapse so rows become safely evictable.
    for (let i = 0; i < 2; i += 1) {
      const r = guard.reserve('g', scope(`e${i}`), `m${i}`);
      guard.release('g', scope(`e${i}`), `m${i}`, { delivered: true, ownerToken: r.ownerToken! });
    }
    clock += 2_000; // cooldown (1s) has elapsed -> rows are stale.
    // New reservation should succeed by evicting a fully-stale row, staying <= cap.
    const ok = guard.reserve('g', scope('e2'), 'm2');
    expect(ok.suppressed).toBe(false);
    expect(guard.snapshot().trackedScopes).toBeLessThanOrEqual(2);
  });
});

describe('THE-930 — shared policy reads fail closed (never mute=[]/cooldown=0 on error)', () => {
  it('suppresses with degraded-policy when the policy reader throws', () => {
    const { db, cleanup } = newDb();
    cleanups.push(cleanup);
    const guard = createAgentNoiseGuard({
      db,
      cooldownMs: 0,
      leaseMs: 30_000,
      policy: () => { throw new Error('settings store unavailable'); },
    });
    const r = guard.reserve('ada', scope('c9'), 'hello');
    expect(r.suppressed).toBe(true);
    expect(r.reason).toBe('degraded-policy');
  });

  it('does not silently clear mutes/cooldown on a transient policy failure', () => {
    const { db, cleanup } = newDb();
    cleanups.push(cleanup);
    let policy: { cooldownMs: number; mutedAgents: string[] } = { cooldownMs: 0, mutedAgents: ['spock'] };
    const guard = createAgentNoiseGuard({
      db,
      leaseMs: 30_000,
      policy: () => {
        const p = policy;
        if (p === null) throw new Error('policy unavailable');
        return p;
      },
    });
    // Initially spock is muted.
    expect(guard.reserve('spock', scope('c10'), 'hi').reason).toBe('muted');
    // A transient policy failure must fail closed (degraded-policy), NOT clear
    // the mute by returning an empty policy.
    policy = null as unknown as { cooldownMs: number; mutedAgents: string[] };
    expect(guard.reserve('spock', scope('c10'), 'hi').reason).toBe('degraded-policy');
  });
});
