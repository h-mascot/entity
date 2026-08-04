/**
 * THE-930 (R2 split) — tokenless stale release must be a no-op.
 *
 * Reproduced blocker: A reserves, A's lease expires, B reacquires the same
 * scope (replacing the held owner token), then A calls the *supported*
 * tokenless `release(...)`. The guard substituted B's latest token, cleared
 * B's lease, and could write A's success cooldown. Fail-closed fix: release
 * without the EXACT token returned by that reserve is a no-op. The guard must
 * never infer "latest owner" from the scope key alone.
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

function newDb() {
  const dbPath = path.join(os.tmpdir(), `entity-noise-tokenless-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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

const cleanups: Array<() => void> = [];
afterAll(() => { for (const c of cleanups) c(); });

describe('THE-930 (R2) — tokenless stale release is a no-op', () => {
  it('DB backend: tokenless release after B reacquires leaves B intact; C still blocked', () => {
    const { db, cleanup } = newDb();
    cleanups.push(cleanup);
    let clock = 1_000;
    const leaseMs = 1_000;
    const cooldownMs = 2_000;
    const guardA = createAgentNoiseGuard({ db, cooldownMs, leaseMs, now: () => clock });
    const guardB = createAgentNoiseGuard({ db, cooldownMs, leaseMs, now: () => clock });
    const guardC = createAgentNoiseGuard({ db, cooldownMs, leaseMs, now: () => clock });

    // A acquires.
    const aRes = guardA.reserve('ada', scope('c1'), 'hello');
    expect(aRes.suppressed).toBe(false);
    // B blocked while A holds the lease.
    expect(guardB.reserve('ada', scope('c1'), 'hello').reason).toBe('duplicate-concurrent');

    // A's lease expires; B reacquires the same key.
    clock += leaseMs + 1;
    const bRes = guardB.reserve('ada', scope('c1'), 'hello');
    expect(bRes.suppressed).toBe(false);

    // A calls the *supported* tokenless release. This MUST be a no-op: it must
    // NOT clear B's lease, NOT write any cooldown, and NOT let C sneak in.
    guardA.release('ada', scope('c1'), 'hello');
    // C must still be blocked while B owns.
    const cBlocked = guardC.reserve('ada', scope('c1'), 'hello');
    expect(cBlocked.suppressed).toBe(true);
    expect(cBlocked.reason).toBe('duplicate-concurrent');

    // The DB row must reflect B's ownership: lease_until advanced to B's
    // acquisition + leaseMs, last_sent_at still null (A's tokenless delivered
    // release wrote no cooldown), and no cooldown is recorded.
    const row = db.prepare('SELECT lease_until, last_sent_at FROM agent_noise_reservations').get() as
      | { lease_until: number; last_sent_at: number | null } | undefined;
    expect(row).toBeDefined();
    expect(row!.last_sent_at).toBeNull();
    expect(row!.lease_until).toBe(clock + leaseMs);

    // Only after B releases with its OWN token (delivered) is the cooldown
    // recorded and C then permitted after the window elapses.
    guardB.release('ada', scope('c1'), 'hello', { delivered: true, ownerToken: bRes.ownerToken! });
    const cooldownRow = db.prepare('SELECT last_sent_at FROM agent_noise_reservations').get() as { last_sent_at: number | null };
    expect(cooldownRow.last_sent_at).toBe(clock);
    expect(guardC.reserve('ada', scope('c1'), 'hello').reason).toBe('cooldown');
    clock += cooldownMs;
    expect(guardC.reserve('ada', scope('c1'), 'hello').suppressed).toBe(false);
  });

  it('DB backend: a tokenless release is a no-op even with no concurrent owner (no cooldown written, lease held)', () => {
    const { db, cleanup } = newDb();
    cleanups.push(cleanup);
    let clock = 5_000;
    const guard = createAgentNoiseGuard({ db, cooldownMs: 5_000, leaseMs: 30_000, now: () => clock });
    const res = guard.reserve('ada', scope('c2'), 'hi');
    expect(res.suppressed).toBe(false);
    // Tokenless release must NOT touch state.
    guard.release('ada', scope('c2'), 'hi');
    const row = db.prepare('SELECT lease_until, last_sent_at FROM agent_noise_reservations').get() as
      | { lease_until: number; last_sent_at: number | null } | undefined;
    expect(row).toBeDefined();
    expect(row!.last_sent_at).toBeNull();
    expect(row!.lease_until).toBe(clock + 30_000);
  });

  it('in-memory backend: tokenless release is a no-op (does not clear the in-flight lease)', () => {
    const guard = createAgentNoiseGuard({ cooldownMs: 0 });
    expect(guard.reserve('ada', scope('c3'), 'hello').suppressed).toBe(false);
    // Tokenless release cannot clear the in-flight slot.
    guard.release('ada', scope('c3'), 'hello');
    expect(guard.reserve('ada', scope('c3'), 'hello').reason).toBe('duplicate-concurrent');
  });
});
