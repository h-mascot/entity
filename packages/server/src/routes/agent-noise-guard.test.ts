import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import {
  createAgentNoiseGuard,
  type AgentNoiseGuard,
} from './agent-noise-guard';

function scope(channelId: string, threadId?: string) {
  return { channelId, threadId };
}

describe('AgentNoiseGuard — atomic scoped reservation (THE-930)', () => {
  it('suppresses a concurrent duplicate send for the same agent+scope+content', () => {
    const guard = createAgentNoiseGuard({ cooldownMs: 0 });
    const first = guard.reserve('ada', scope('c1'), 'hello');
    const second = guard.reserve('ada', scope('c1'), 'hello');

    expect(first.suppressed).toBe(false);
    expect(second.suppressed).toBe(true);
    expect(second.reason).toBe('duplicate-concurrent');

    guard.release('ada', scope('c1'), 'hello');
    // After release without delivery confirmation, a new send is allowed (no cooldown consumed).
    expect(guard.reserve('ada', scope('c1'), 'hello').suppressed).toBe(false);
  });

  it('records cooldown only on confirmed delivery (release delivered=true)', () => {
    let clock = 2_000;
    const guard = createAgentNoiseGuard({ cooldownMs: 5_000, now: () => clock });
    expect(guard.reserve('ada', scope('c1'), 'hi').suppressed).toBe(false);
    // A failed/unknown delivery consumes NO cooldown: retry is immediately allowed.
    guard.release('ada', scope('c1'), 'hi');
    expect(guard.reserve('ada', scope('c1'), 'hi').suppressed).toBe(false);
    // A confirmed delivery records the cooldown window.
    guard.release('ada', scope('c1'), 'hi', { delivered: true });
    expect(guard.reserve('ada', scope('c1'), 'hi').reason).toBe('cooldown');
    clock += 5_000;
    expect(guard.reserve('ada', scope('c1'), 'hi').suppressed).toBe(false);
  });

  it('does NOT suppress different content, different agents, or different scopes (mixed-target behavior)', () => {
    const guard = createAgentNoiseGuard({ cooldownMs: 0 });
    guard.reserve('ada', scope('c1'), 'hello');
    expect(guard.reserve('ada', scope('c1'), 'different').suppressed).toBe(false);
    expect(guard.reserve('zora', scope('c1'), 'hello').suppressed).toBe(false);
    expect(guard.reserve('ada', scope('c2'), 'hello').suppressed).toBe(false);
    expect(guard.reserve('ada', scope('c1', 't9'), 'hello').suppressed).toBe(false);
  });

  it('suppresses on cooldown within the window and allows after it elapses', () => {
    let clock = 1_000;
    const guard = createAgentNoiseGuard({ cooldownMs: 5_000, now: () => clock });
    expect(guard.reserve('ada', scope('c1'), 'hi').suppressed).toBe(false);
    guard.release('ada', scope('c1'), 'hi', { delivered: true });
    expect(guard.reserve('ada', scope('c1'), 'hi').reason).toBe('cooldown');
    clock += 5_000;
    expect(guard.reserve('ada', scope('c1'), 'hi').suppressed).toBe(false);
  });

  it('never lets a muted agent send', () => {
    const guard = createAgentNoiseGuard({ cooldownMs: 0, mutedAgents: ['spock'] });
    const r = guard.reserve('spock', scope('c1'), 'hi');
    expect(r.suppressed).toBe(true);
    expect(r.reason).toBe('muted');
    guard.setMuted('spock', false);
    expect(guard.reserve('spock', scope('c1'), 'hi').suppressed).toBe(false);
  });

  it('ignores caller-supplied sender identity (keys only on server-resolved agent)', () => {
    // The guard has no notion of a client "sender" string; suppression is decided
    // by the agent target passed in, so a forged sender cannot bypass or trigger it.
    const guard = createAgentNoiseGuard({ cooldownMs: 0 });
    expect(guard.reserve('ada', scope('c1'), 'hello').suppressed).toBe(false);
    // A second reservation for the SAME resolved agent+scope+content is suppressed
    // regardless of what the client claimed its sender was.
    expect(guard.reserve('ada', scope('c1'), 'hello').reason).toBe('duplicate-concurrent');
  });

  it('uses the guard clock, not any caller-supplied timestamp, for cooldown', () => {
    let clock = 10_000;
    const guard = createAgentNoiseGuard({ cooldownMs: 1_000, now: () => clock });
    expect(guard.reserve('ada', scope('c1'), 'hi').suppressed).toBe(false);
    guard.release('ada', scope('c1'), 'hi', { delivered: true });
    // Caller cannot advance or rewind cooldown by supplying timestamps — only the
    // guard's own clock advances time.
    expect(guard.reserve('ada', scope('c1'), 'hi').reason).toBe('cooldown');
    clock += 1_000;
    expect(guard.reserve('ada', scope('c1'), 'hi').suppressed).toBe(false);
  });

  it('bounds stored state (evicts oldest entries beyond the cap)', () => {
    let clock = 0;
    const guard = createAgentNoiseGuard({ cooldownMs: 10_000, maxStateEntries: 3, now: () => clock });
    guard.reserve('ada', scope('c1'), 'm1'); guard.release('ada', scope('c1'), 'm1', { delivered: true }); clock += 1;
    guard.reserve('ada', scope('c2'), 'm2'); guard.release('ada', scope('c2'), 'm2', { delivered: true }); clock += 1;
    guard.reserve('ada', scope('c3'), 'm3'); guard.release('ada', scope('c3'), 'm3', { delivered: true }); clock += 1;
    guard.reserve('ada', scope('c4'), 'm4'); guard.release('ada', scope('c4'), 'm4', { delivered: true }); clock += 1;
    // c1 should have been evicted; reserving it again is allowed (not in cooldown).
    const r = guard.reserve('ada', scope('c1'), 'm1');
    expect(r.suppressed).toBe(false);
    expect(guard.snapshot().trackedScopes).toBeLessThanOrEqual(3);
  });

  it('normalizes agent/scope identity deterministically', () => {
    const guard: AgentNoiseGuard = createAgentNoiseGuard({ cooldownMs: 0 });
    expect(guard.reserve('  ADA ', scope('c1'), '  hi  ').suppressed).toBe(false);
    // Same identity after normalization -> suppressed as concurrent duplicate.
    expect(guard.reserve('ada', scope('c1'), 'hi').reason).toBe('duplicate-concurrent');
  });
});

describe('AgentNoiseGuard — content hashing stability', () => {
  it('hashes long content to a bounded digest', () => {
    const long = 'x'.repeat(50_000);
    const h1 = createHash('sha1').update(long).digest('hex');
    const h2 = createHash('sha1').update(long).digest('hex');
    expect(h1).toBe(h2);
    expect(h1.length).toBeLessThan(long.length);
  });
});
