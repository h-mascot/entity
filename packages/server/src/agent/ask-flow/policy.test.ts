import { describe, expect, it } from 'vitest';
import {
  evaluateAskClaimPolicy,
  evaluateAskResolvePolicy,
  evaluateCreateAskStatus,
  initialAskStatus,
  isClaimableAskStatus,
  isTerminalAskStatus,
} from './policy';
import type { WorkplaneAsk } from './types';

function ask(overrides: Partial<WorkplaneAsk> = {}): WorkplaneAsk {
  return {
    id: 'ask-1',
    workplaneId: 'wp-a',
    taskId: 1,
    title: 'Need review',
    body: null,
    status: 'open',
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
    ...overrides,
  };
}

describe('ask-flow policy (THE-886 / WP2-B-05)', () => {
  it('opens chief_review only when live chief is assigned', () => {
    expect(initialAskStatus({ chiefAssigned: true, chiefAvailable: true })).toBe('chief_review');
    expect(initialAskStatus({ chiefAssigned: true, chiefAvailable: false })).toBe('open');
    expect(initialAskStatus({ chiefAssigned: false, chiefAvailable: false })).toBe('open');
    expect(evaluateCreateAskStatus({ chiefAssigned: true, chiefAvailable: true }).code)
      .toBe('created_chief_review');
  });

  it('classifies claimable and terminal statuses', () => {
    expect(isClaimableAskStatus('open')).toBe(true);
    expect(isClaimableAskStatus('chief_review')).toBe(true);
    expect(isClaimableAskStatus('stale')).toBe(true);
    expect(isClaimableAskStatus('claimed')).toBe(false);
    expect(isTerminalAskStatus('resolved')).toBe(true);
    expect(isTerminalAskStatus('blocked')).toBe(true);
    expect(isTerminalAskStatus('claimed')).toBe(false);
  });

  it('blocks workers during chief priority and allows chief claim', () => {
    const nowMs = Date.parse('2026-07-31T08:00:00.000Z');
    const chief = {
      assignment: {
        workplaneId: 'wp-a',
        chiefAgentId: 'chief-1',
        chiefInviteId: null,
        chiefAgentName: 'Chief',
        assignedAt: '2026-07-31T07:00:00.000Z',
        assignedBy: 'operator',
        priorityWindowMs: 60_000,
        updatedAt: '2026-07-31T07:00:00.000Z',
      },
      presenceStatus: 'live' as const,
    };

    const workerDenied = evaluateAskClaimPolicy({
      ask: ask({ status: 'chief_review' }),
      actor: { agentId: 'worker-1', attached: true },
      chief,
      nowMs,
      windowOpenedAtMs: nowMs,
      windowExpiresAtMs: nowMs + 60_000,
    });
    expect(workerDenied.allowed).toBe(false);
    expect(workerDenied.code).toBe('chief_priority');

    const chiefOk = evaluateAskClaimPolicy({
      ask: ask({ status: 'chief_review' }),
      actor: { agentId: 'chief-1', attached: true },
      chief,
      nowMs,
      windowOpenedAtMs: nowMs,
      windowExpiresAtMs: nowMs + 60_000,
    });
    expect(chiefOk.allowed).toBe(true);
    expect(chiefOk.code).toBe('chief_claim');
  });

  it('allows worker fallback when chief unavailable', () => {
    const nowMs = Date.parse('2026-07-31T08:00:00.000Z');
    const result = evaluateAskClaimPolicy({
      ask: ask({ status: 'open' }),
      actor: { agentId: 'worker-1', attached: true },
      chief: {
        assignment: {
          workplaneId: 'wp-a',
          chiefAgentId: 'chief-1',
          chiefInviteId: null,
          chiefAgentName: 'Chief',
          assignedAt: '2026-07-31T07:00:00.000Z',
          assignedBy: 'operator',
          priorityWindowMs: 60_000,
          updatedAt: '2026-07-31T07:00:00.000Z',
        },
        presenceStatus: 'stale',
      },
      nowMs,
      windowOpenedAtMs: nowMs,
      windowExpiresAtMs: nowMs + 60_000,
    });
    expect(result.allowed).toBe(true);
    expect(result.code).toBe('worker_claim_chief_unavailable');
  });

  it('rejects double resolve and allows claimant resolve', () => {
    const double = evaluateAskResolvePolicy({
      ask: ask({
        status: 'resolved',
        claimantAgentId: 'worker-1',
        resolvedBy: 'worker-1',
      }),
      resolverId: 'worker-1',
      asOperator: false,
      chiefAgentId: 'chief-1',
      resolverAttached: true,
    });
    expect(double.allowed).toBe(false);
    expect(double.code).toBe('double_resolve');

    const ok = evaluateAskResolvePolicy({
      ask: ask({ status: 'claimed', claimantAgentId: 'worker-1' }),
      resolverId: 'worker-1',
      asOperator: false,
      chiefAgentId: 'chief-1',
      resolverAttached: true,
    });
    expect(ok.allowed).toBe(true);
    expect(ok.code).toBe('resolved_by_claimant');
  });
});
