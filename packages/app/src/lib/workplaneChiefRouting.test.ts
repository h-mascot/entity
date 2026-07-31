import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseWorkplaneRoutingPanel,
  routingFromSuccess,
  routingGateLabel,
  routingSummary,
} from './workplaneChiefRouting.ts';

describe('workplaneChiefRouting (WP2-B-04)', () => {
  it('parses panel and summarizes chief priority without inventing live', () => {
    const panel = parseWorkplaneRoutingPanel({
      workplaneId: 'wp-r',
      evaluatedAt: '2026-07-31T08:00:00.000Z',
      chief: {
        workplaneId: 'wp-r',
        chiefAgentId: 'chief-1',
        chiefInviteId: null,
        chiefAgentName: 'Chief Ada',
        assignedAt: '2026-07-31T07:00:00.000Z',
        assignedBy: 'operator',
        priorityWindowMs: 300000,
        updatedAt: '2026-07-31T07:00:00.000Z',
      },
      chiefPresence: {
        agentId: 'chief-1',
        agentName: 'Chief Ada',
        presenceStatus: 'missing',
        available: false,
        lastSeenAt: null,
        heartbeatFreshnessLabel: 'No heartbeat',
      },
      activeClaim: null,
      priorityWindow: {
        open: false,
        openedAt: null,
        expiresAt: null,
        priorityWindowMs: 300000,
      },
      policy: {
        chiefRequired: false,
        workersMayClaim: true,
        claimGate: 'open',
        summary: 'Chief unavailable — attached workers may claim (fallback).',
      },
      attachedAgentIds: ['chief-1', 'worker-1'],
    });

    assert.ok(panel);
    assert.equal(panel!.chief?.chiefAgentId, 'chief-1');
    assert.equal(panel!.chiefPresence?.available, false);
    assert.equal(panel!.chiefPresence?.presenceStatus, 'missing');
    assert.equal(routingSummary(panel!), 'Chief unavailable · workers open');
    assert.equal(routingFromSuccess(panel!).status, 'ready');
  });

  it('summarizes active claim and chief priority gate labels', () => {
    const claimed = parseWorkplaneRoutingPanel({
      workplaneId: 'wp-r',
      evaluatedAt: '2026-07-31T08:00:00.000Z',
      chief: null,
      chiefPresence: null,
      activeClaim: {
        id: 'c1',
        workplaneId: 'wp-r',
        taskId: 3,
        agentId: 'worker-1',
        agentName: 'Worker One',
        claimMode: 'assign',
        status: 'active',
        requestId: null,
        policyCode: 'operator_assign_no_chief',
        policyReason: 'Operator may assign when no chief is set',
        reasonChain: [],
        claimedAt: '2026-07-31T08:00:00.000Z',
        claimedBy: 'operator',
        releasedAt: null,
      },
      priorityWindow: {
        open: false,
        openedAt: null,
        expiresAt: null,
        priorityWindowMs: 300000,
      },
      policy: {
        chiefRequired: false,
        workersMayClaim: false,
        claimGate: 'blocked_claimed',
        summary: 'Active claim held by worker-1.',
      },
      attachedAgentIds: ['worker-1'],
    });
    assert.ok(claimed);
    assert.equal(routingSummary(claimed!), 'Claimed · Worker One');
    assert.equal(routingGateLabel('chief_priority'), 'Chief priority window');
    assert.equal(routingGateLabel('open'), 'Open for claim');
  });

  it('returns null for invalid payloads — never invents a workplane', () => {
    assert.equal(parseWorkplaneRoutingPanel(null), null);
    assert.equal(parseWorkplaneRoutingPanel({ evaluatedAt: 'x' }), null);
  });
});
