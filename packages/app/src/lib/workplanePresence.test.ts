import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialPresenceLoadState,
  formatLastSeen,
  panelSummary,
  parseWorkplanePresencePanel,
  presenceBeginLoad,
  presenceFromError,
  presenceFromSuccess,
  presenceStatusLabel,
  presenceToneClass,
} from './workplanePresence.ts';

test('parse panel keeps missing/stale explicit and never invents live agents', () => {
  const panel = parseWorkplanePresencePanel({
    workplaneId: 'wp-a',
    staleAfterMs: 90000,
    evaluatedAt: '2026-07-31T06:00:00.000Z',
    agents: [
      {
        agentId: 'invite:inv-1',
        inviteId: 'inv-1',
        agentName: 'Scout',
        role: 'worker',
        presenceStatus: 'missing',
        lastSeenAt: null,
        heartbeatFreshnessLabel: 'No heartbeat yet',
        currentTaskId: 3,
        currentWorkplaneId: 'wp-a',
        currentWorkLabel: 'Task 3 · Workplane wp-a',
        runtime: null,
        sessionId: null,
        capabilities: [],
        cardCompleteness: 'partial',
        degradedReasons: ['presence_missing'],
        source: 'invite_missing',
      },
      {
        agentId: 'agent-stale',
        inviteId: null,
        agentName: 'Ada',
        role: 'chief',
        presenceStatus: 'stale',
        lastSeenAt: '2026-07-31T05:50:00.000Z',
        heartbeatFreshnessLabel: 'Stale · last seen 2026-07-31T05:50:00.000Z',
        currentTaskId: null,
        currentWorkplaneId: 'wp-a',
        currentWorkLabel: 'Workplane wp-a',
        runtime: 'mac',
        sessionId: 's1',
        capabilities: ['review'],
        cardCompleteness: 'partial',
        degradedReasons: ['presence_stale'],
        source: 'heartbeat',
      },
    ],
    counts: {
      total: 2,
      live: 0,
      idle: 0,
      stale: 1,
      offline: 0,
      missing: 1,
      unknown: 0,
      degraded: 2,
    },
  });

  assert.ok(panel);
  assert.equal(panel!.agents.length, 2);
  assert.equal(panel!.counts.live, 0);
  assert.equal(panel!.agents[0]!.presenceStatus, 'missing');
  assert.equal(panel!.agents[1]!.presenceStatus, 'stale');
  assert.match(panelSummary(panel!), /1 stale/);
  assert.match(panelSummary(panel!), /1 missing/);
  assert.ok(!panelSummary(panel!).includes('live'));
});

test('empty panel and load-state helpers', () => {
  const empty = parseWorkplanePresencePanel({
    workplaneId: 'wp-empty',
    evaluatedAt: '2026-07-31T06:00:00.000Z',
    agents: [],
    counts: {
      total: 0,
      live: 0,
      idle: 0,
      stale: 0,
      offline: 0,
      missing: 0,
      unknown: 0,
      degraded: 0,
    },
  });
  assert.ok(empty);
  assert.equal(panelSummary(empty!), 'No agents bound to this workplane yet.');

  let state = createInitialPresenceLoadState();
  state = presenceBeginLoad(state, 'wp-empty');
  assert.equal(state.status, 'loading');
  state = presenceFromSuccess(empty!);
  assert.equal(state.status, 'empty');
  state = presenceFromError('wp-empty', 'boom');
  assert.equal(state.status, 'error');
});

test('labels and tones cover presence states', () => {
  assert.equal(presenceStatusLabel('missing'), 'Missing');
  assert.equal(presenceStatusLabel('stale'), 'Stale');
  assert.equal(presenceStatusLabel('live'), 'Live');
  assert.equal(formatLastSeen(null), 'Never');
  assert.match(presenceToneClass('live'), /success/);
  assert.match(presenceToneClass('stale'), /warning|error|text/);
  assert.match(presenceToneClass('missing'), /text-secondary/);
});

test('invalid payload returns null (degraded parse path)', () => {
  assert.equal(parseWorkplanePresencePanel(null), null);
  assert.equal(parseWorkplanePresencePanel({ agents: [] }), null);
});
