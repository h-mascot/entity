import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  attachedFromSuccess,
  attachedSummary,
  parseWorkplaneAttachedAgentsPanel,
} from './workplaneAttachedAgents.ts';

describe('workplaneAttachedAgents (WP2-B-03)', () => {
  it('parses attach panel and summarizes missing vs live', () => {
    const panel = parseWorkplaneAttachedAgentsPanel({
      workplaneId: 'wp-a',
      evaluatedAt: '2026-07-31T07:00:00.000Z',
      counts: {
        total: 2,
        live: 1,
        idle: 0,
        stale: 0,
        offline: 0,
        missing: 1,
        unknown: 0,
        degraded: 1,
      },
      agents: [
        {
          attachmentId: 'att-1',
          workplaneId: 'wp-a',
          agentId: 'agent-live',
          inviteId: null,
          taskId: 9,
          agentName: 'Live One',
          role: 'worker',
          attachedAt: '2026-07-31T06:00:00.000Z',
          attachedBy: null,
          presenceStatus: 'live',
          lastSeenAt: '2026-07-31T07:00:00.000Z',
          heartbeatFreshnessLabel: 'Just now',
          currentWorkLabel: 'Task 9 · Workplane wp-a',
          degradedReasons: [],
          source: 'heartbeat',
        },
        {
          attachmentId: 'att-2',
          workplaneId: 'wp-a',
          agentId: 'invite:x',
          inviteId: 'x',
          taskId: 9,
          agentName: 'Missing One',
          role: 'worker',
          attachedAt: '2026-07-31T06:00:00.000Z',
          attachedBy: null,
          presenceStatus: 'missing',
          lastSeenAt: null,
          heartbeatFreshnessLabel: 'No heartbeat yet',
          currentWorkLabel: 'Task 9 · Workplane wp-a',
          degradedReasons: ['presence_missing'],
          source: 'invite_missing',
        },
      ],
    });

    assert.ok(panel);
    assert.equal(panel!.agents.length, 2);
    assert.equal(attachedSummary(panel!), '1 live · 1 missing');
    assert.equal(attachedFromSuccess(panel!).status, 'ready');
  });

  it('empty panel stays empty — never invents attached agents', () => {
    const panel = parseWorkplaneAttachedAgentsPanel({
      workplaneId: 'wp-empty',
      evaluatedAt: '2026-07-31T07:00:00.000Z',
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
    assert.ok(panel);
    assert.equal(attachedFromSuccess(panel!).status, 'empty');
    assert.equal(
      attachedSummary(panel!),
      'No agents attached to this workplane yet.',
    );
  });

  it('rejects invalid payloads', () => {
    assert.equal(parseWorkplaneAttachedAgentsPanel(null), null);
    assert.equal(parseWorkplaneAttachedAgentsPanel({ agents: [] }), null);
  });
});
