import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  askFromSuccess,
  askPanelSummary,
  askStatusLabel,
  parseWorkplaneAsk,
  parseWorkplaneAskPanel,
} from './workplaneAskFlow.ts';

describe('workplaneAskFlow (WP2-B-05)', () => {
  it('parses ASK panel and keeps CAS version + truthful statuses', () => {
    const panel = parseWorkplaneAskPanel({
      workplaneId: 'wp-a',
      evaluatedAt: '2026-07-31T09:00:00.000Z',
      openCount: 1,
      claimedCount: 1,
      resolvedCount: 0,
      staleCount: 0,
      summary: '1 open · 1 claimed',
      asks: [
        {
          id: 'ask-1',
          workplaneId: 'wp-a',
          taskId: 3,
          title: 'Review proof',
          body: null,
          status: 'chief_review',
          version: 1,
          createdBy: 'operator',
          createdAt: '2026-07-31T08:00:00.000Z',
          updatedAt: '2026-07-31T08:00:00.000Z',
          claimantAgentId: null,
          claimantAgentName: null,
          claimedAt: null,
          claimPolicyCode: null,
          resolvedBy: null,
          resolvedAt: null,
          resolutionNote: null,
          blockedReason: null,
          reasonChain: [],
        },
        {
          id: 'ask-2',
          workplane_id: 'wp-a',
          task_id: 3,
          title: 'Worker fallback',
          status: 'claimed',
          version: 2,
          claimant_agent_id: 'worker-1',
          claimant_agent_name: 'Worker',
          claim_policy_code: 'worker_claim_chief_unavailable',
          created_at: '2026-07-31T08:30:00.000Z',
          updated_at: '2026-07-31T08:31:00.000Z',
        },
      ],
    });

    assert.ok(panel);
    assert.equal(panel!.asks.length, 2);
    assert.equal(panel!.asks[0]!.status, 'chief_review');
    assert.equal(panel!.asks[1]!.version, 2);
    assert.equal(panel!.asks[1]!.claimantAgentId, 'worker-1');
    assert.equal(askPanelSummary(panel!), '1 open · 1 claimed');
    assert.equal(askStatusLabel('chief_review'), 'Chief review');
    assert.equal(askFromSuccess(panel!).status, 'ready');
  });

  it('rejects invalid ASK payloads without inventing ids', () => {
    assert.equal(parseWorkplaneAsk(null), null);
    assert.equal(parseWorkplaneAsk({ title: 'x' }), null);
    assert.equal(parseWorkplaneAskPanel({ asks: [] }), null);
  });
});
