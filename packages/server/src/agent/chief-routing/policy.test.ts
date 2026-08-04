import { describe, expect, it } from 'vitest';
import {
  evaluateAssignPolicy,
  evaluateClaimPolicy,
  isChiefPresenceAvailable,
  isPriorityWindowOpen,
} from './policy';
import type { WorkplaneChiefAssignment, WorkplaneRoutingClaim } from './types';

const chiefAssignment: WorkplaneChiefAssignment = {
  workplaneId: 'wp-1',
  chiefAgentId: 'chief-1',
  chiefInviteId: null,
  chiefAgentName: 'Chief Ada',
  assignedAt: '2026-07-31T07:00:00.000Z',
  assignedBy: 'operator',
  priorityWindowMs: 60_000,
  updatedAt: '2026-07-31T07:00:00.000Z',
};

function claim(agentId: string): WorkplaneRoutingClaim {
  return {
    id: 'c1',
    workplaneId: 'wp-1',
    taskId: 42,
    agentId,
    agentName: agentId,
    claimMode: 'claim',
    status: 'active',
    requestId: null,
    policyCode: 'chief_claim',
    policyReason: 'test',
    reasonChain: [],
    claimedAt: '2026-07-31T07:00:00.000Z',
    claimedBy: agentId,
    releasedAt: null,
  };
}

describe('chief routing policy (THE-885 / WP2-B-04)', () => {
  it('treats live/idle as available and stale/missing as unavailable', () => {
    expect(isChiefPresenceAvailable('live')).toBe(true);
    expect(isChiefPresenceAvailable('idle')).toBe(true);
    expect(isChiefPresenceAvailable('stale')).toBe(false);
    expect(isChiefPresenceAvailable('offline')).toBe(false);
    expect(isChiefPresenceAvailable('missing')).toBe(false);
    expect(isChiefPresenceAvailable(null)).toBe(false);
  });

  it('detects open priority windows with exclusive end bound', () => {
    expect(isPriorityWindowOpen(100, 0, 100)).toBe(false);
    expect(isPriorityWindowOpen(99, 0, 100)).toBe(true);
    expect(isPriorityWindowOpen(50, null, 100)).toBe(false);
  });

  it('denies claim when actor is not attached', () => {
    const result = evaluateClaimPolicy({
      actor: { agentId: 'w1', attached: false },
      chief: { assignment: null, presenceStatus: null },
      activeClaim: null,
      nowMs: 0,
      windowOpenedAtMs: null,
      windowExpiresAtMs: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('not_attached');
  });

  it('allows attached worker claim when no chief is assigned', () => {
    const result = evaluateClaimPolicy({
      actor: { agentId: 'w1', attached: true },
      chief: { assignment: null, presenceStatus: null },
      activeClaim: null,
      nowMs: 0,
      windowOpenedAtMs: null,
      windowExpiresAtMs: null,
    });
    expect(result.allowed).toBe(true);
    expect(result.code).toBe('worker_claim_no_chief');
  });

  it('blocks workers during chief priority window when chief is available', () => {
    const result = evaluateClaimPolicy({
      actor: { agentId: 'w1', attached: true },
      chief: { assignment: chiefAssignment, presenceStatus: 'live' },
      activeClaim: null,
      nowMs: 10_000,
      windowOpenedAtMs: 0,
      windowExpiresAtMs: 60_000,
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('chief_priority');
    expect(result.priorityWindowOpen).toBe(true);
    expect(result.chiefAvailable).toBe(true);
  });

  it('allows chief claim during priority window', () => {
    const result = evaluateClaimPolicy({
      actor: { agentId: 'chief-1', attached: true },
      chief: { assignment: chiefAssignment, presenceStatus: 'idle' },
      activeClaim: null,
      nowMs: 10_000,
      windowOpenedAtMs: 0,
      windowExpiresAtMs: 60_000,
    });
    expect(result.allowed).toBe(true);
    expect(result.code).toBe('chief_claim');
  });

  it('allows worker claim after priority window expires', () => {
    const result = evaluateClaimPolicy({
      actor: { agentId: 'w1', attached: true },
      chief: { assignment: chiefAssignment, presenceStatus: 'live' },
      activeClaim: null,
      nowMs: 60_000,
      windowOpenedAtMs: 0,
      windowExpiresAtMs: 60_000,
    });
    expect(result.allowed).toBe(true);
    expect(result.code).toBe('worker_claim_after_window');
  });

  it('allows worker claim when chief is stale (fallback)', () => {
    const result = evaluateClaimPolicy({
      actor: { agentId: 'w1', attached: true },
      chief: { assignment: chiefAssignment, presenceStatus: 'stale' },
      activeClaim: null,
      nowMs: 10_000,
      windowOpenedAtMs: 0,
      windowExpiresAtMs: 60_000,
    });
    expect(result.allowed).toBe(true);
    expect(result.code).toBe('worker_claim_chief_unavailable');
  });

  it('denies claim when another agent already holds active claim', () => {
    const result = evaluateClaimPolicy({
      actor: { agentId: 'w2', attached: true },
      chief: { assignment: null, presenceStatus: null },
      activeClaim: claim('w1'),
      nowMs: 0,
      windowOpenedAtMs: null,
      windowExpiresAtMs: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('already_claimed');
  });

  it('treats re-claim by holder as idempotent allow', () => {
    const result = evaluateClaimPolicy({
      actor: { agentId: 'w1', attached: true },
      chief: { assignment: null, presenceStatus: null },
      activeClaim: claim('w1'),
      nowMs: 0,
      windowOpenedAtMs: null,
      windowExpiresAtMs: null,
    });
    expect(result.allowed).toBe(true);
    expect(result.code).toBe('idempotent_claim');
  });

  it('allows chief assign of attached target when chief is live', () => {
    const result = evaluateAssignPolicy({
      target: { agentId: 'w1', attached: true },
      assigner: { id: 'chief-1', asOperator: false, attached: true },
      chief: { assignment: chiefAssignment, presenceStatus: 'live' },
      activeClaim: null,
      nowMs: 0,
      windowOpenedAtMs: null,
      windowExpiresAtMs: null,
    });
    expect(result.allowed).toBe(true);
    expect(result.code).toBe('chief_assign');
  });

  it('denies assign when target is not attached', () => {
    const result = evaluateAssignPolicy({
      target: { agentId: 'w1', attached: false },
      assigner: { id: 'op', asOperator: true, attached: false },
      chief: { assignment: null, presenceStatus: null },
      activeClaim: null,
      nowMs: 0,
      windowOpenedAtMs: null,
      windowExpiresAtMs: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('target_not_attached');
  });

  it('allows operator assign when chief is unavailable', () => {
    const result = evaluateAssignPolicy({
      target: { agentId: 'w1', attached: true },
      assigner: { id: 'op', asOperator: true, attached: false },
      chief: { assignment: chiefAssignment, presenceStatus: 'missing' },
      activeClaim: null,
      nowMs: 0,
      windowOpenedAtMs: null,
      windowExpiresAtMs: null,
    });
    expect(result.allowed).toBe(true);
    expect(result.code).toBe('operator_assign_chief_unavailable');
  });

  it('denies non-chief agent assigner', () => {
    const result = evaluateAssignPolicy({
      target: { agentId: 'w1', attached: true },
      assigner: { id: 'w2', asOperator: false, attached: true },
      chief: { assignment: chiefAssignment, presenceStatus: 'live' },
      activeClaim: null,
      nowMs: 0,
      windowOpenedAtMs: null,
      windowExpiresAtMs: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('chief_required');
  });
});
