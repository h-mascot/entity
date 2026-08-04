import { describe, expect, it } from 'vitest';
import {
  applyExpiryIfNeeded,
  applyRegenerate,
  canAccessTokenizedEndpoints,
  canTransition,
  hasCompletionEvidence,
  isInvitePastExpiry,
  isTerminalInviteStatus,
  listAllowedTransitions,
  planRegenerate,
  transitionInvite,
  type AgentInviteDomain,
  type AgentInviteProgressItem,
} from './index';

function baseInvite(overrides: Partial<AgentInviteDomain> = {}): AgentInviteDomain {
  const now = Date.parse('2026-07-31T12:00:00.000Z');
  return {
    id: 'inv_test_1',
    tokenHash: 'a'.repeat(64),
    previousTokenHash: null,
    generation: 1,
    status: 'created',
    agentId: null,
    agentName: 'Scout',
    role: 'worker',
    createdAt: new Date(now).toISOString(),
    openedAt: null,
    completedAt: null,
    expiresAt: new Date(now + 30 * 60 * 1000).toISOString(),
    revokedAt: null,
    revokedBy: null,
    createdBy: 'henry',
    creationSource: 'agents_invite',
    workspaceId: null,
    projectId: null,
    workplaneId: null,
    taskId: null,
    selectedBundle: 'default',
    selectedModules: ['entity-mc'],
    selectedModuleConfig: {},
    permissionsScope: ['tasks:read'],
    safeStopConditions: ['Stop if revoked'],
    providerProfileId: null,
    chiefRoutingMode: 'none',
    progress: [
      {
        stepId: 'install-entity-mc',
        label: 'Install Entity MC',
        moduleId: 'entity-mc',
        status: 'pending',
        updatedAt: new Date(now).toISOString(),
      },
    ],
    ...overrides,
  };
}

function doneProgress(): AgentInviteProgressItem[] {
  return [
    {
      stepId: 'install-entity-mc',
      label: 'Install Entity MC',
      moduleId: 'entity-mc',
      status: 'done',
      updatedAt: '2026-07-31T12:05:00.000Z',
      evidenceUrl: 'https://example.test/receipt',
    },
  ];
}

describe('invite-kit status machine — allowed transitions', () => {
  it('created → opened on open_manifest and records openedAt', () => {
    const invite = baseInvite();
    const now = new Date('2026-07-31T12:01:00.000Z');
    const result = transitionInvite(invite, 'open_manifest', { now });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.from).toBe('created');
    expect(result.to).toBe('opened');
    expect(result.invite.status).toBe('opened');
    expect(result.invite.openedAt).toBe(now.toISOString());
  });

  it('opened → in_progress on report_progress', () => {
    const result = transitionInvite(baseInvite({ status: 'opened' }), 'report_progress');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.to).toBe('in_progress');
  });

  it('created → in_progress on report_progress (progress without prior manifest)', () => {
    const result = transitionInvite(baseInvite({ status: 'created' }), 'report_progress');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.to).toBe('in_progress');
  });

  it('in_progress → completed when checklist evidence is present', () => {
    const result = transitionInvite(
      baseInvite({ status: 'in_progress', progress: doneProgress() }),
      'complete',
      { now: new Date('2026-07-31T12:10:00.000Z') },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.to).toBe('completed');
    expect(result.invite.completedAt).toBe('2026-07-31T12:10:00.000Z');
  });

  it('lists a non-empty explicit transition table', () => {
    const rows = listAllowedTransitions();
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.some((r) => r.event === 'open_manifest' && r.from === 'created' && r.to === 'opened')).toBe(true);
    expect(rows.some((r) => r.event === 'revoke' && r.to === 'revoked')).toBe(true);
  });
});

describe('invite-kit status machine — forbidden transitions', () => {
  it('rejects completed → in_progress', () => {
    expect(canTransition('completed', 'report_progress', 'in_progress')).toBe(false);
    const result = transitionInvite(baseInvite({ status: 'completed' }), 'report_progress');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('terminal_status');
  });

  it('rejects expired → opened', () => {
    expect(canTransition('expired', 'open_manifest', 'opened')).toBe(false);
    const result = transitionInvite(baseInvite({ status: 'expired' }), 'open_manifest');
    expect(result.ok).toBe(false);
  });

  it('rejects revoked → in_progress', () => {
    const result = transitionInvite(baseInvite({ status: 'revoked' }), 'report_progress');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('terminal_status');
  });

  it('rejects complete without checklist evidence', () => {
    const result = transitionInvite(baseInvite({ status: 'in_progress' }), 'complete');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('missing_completion_evidence');
  });

  it('rejects complete with empty progress', () => {
    expect(hasCompletionEvidence([])).toBe(false);
    const result = transitionInvite(
      baseInvite({ status: 'opened', progress: [] }),
      'complete',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('missing_completion_evidence');
  });

  it('does not treat transitionInvite(regenerate) as a direct status edge', () => {
    const result = transitionInvite(baseInvite(), 'regenerate');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/planRegenerate/);
  });
});

describe('invite-kit status machine — expiry / revoke / regenerate', () => {
  it('expire promotes active statuses and blocks tokenized access', () => {
    const expiredAt = '2026-07-31T11:00:00.000Z';
    const now = new Date('2026-07-31T12:00:00.000Z');
    const invite = baseInvite({ status: 'opened', expiresAt: expiredAt });
    expect(isInvitePastExpiry(invite, now)).toBe(true);

    const expired = applyExpiryIfNeeded(invite, now);
    expect(expired.ok).toBe(true);
    if (!expired.ok) return;
    expect(expired.to).toBe('expired');
    expect(canAccessTokenizedEndpoints(expired.invite, now).allowed).toBe(false);
    expect(canAccessTokenizedEndpoints(expired.invite, now).reason).toBe('invite_expired');
  });

  it('blocks tokenized access when past expiresAt even before status promotion', () => {
    const invite = baseInvite({
      status: 'opened',
      expiresAt: '2026-07-31T11:59:00.000Z',
    });
    const access = canAccessTokenizedEndpoints(invite, new Date('2026-07-31T12:00:00.000Z'));
    expect(access.allowed).toBe(false);
    expect(access.reason).toBe('invite_past_expires_at');
  });

  it('revoke blocks tokenized endpoints from any active status', () => {
    const now = new Date('2026-07-31T12:02:00.000Z');
    const result = transitionInvite(baseInvite({ status: 'in_progress' }), 'revoke', {
      now,
      revokedBy: 'henry',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invite.status).toBe('revoked');
    expect(result.invite.revokedBy).toBe('henry');
    expect(result.invite.revokedAt).toBe(now.toISOString());
    expect(canAccessTokenizedEndpoints(result.invite, now)).toEqual({
      allowed: false,
      reason: 'invite_revoked',
    });
  });

  it('regenerate revokes prior token hash semantics and resets to created', () => {
    const invite = baseInvite({
      status: 'in_progress',
      openedAt: '2026-07-31T12:01:00.000Z',
      generation: 2,
      tokenHash: 'old-token-hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    const plan = planRegenerate(invite);
    expect('ok' in plan).toBe(false);
    if ('ok' in plan) return;
    expect(plan.revokePreviousToken).toBe(true);
    expect(plan.previousTokenHash).toBe(invite.tokenHash);
    expect(plan.nextStatus).toBe('created');

    const nextHash = 'b'.repeat(64);
    const applied = applyRegenerate(invite, nextHash, {
      expiresAt: '2026-07-31T13:00:00.000Z',
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.event).toBe('regenerate');
    expect(applied.invite.status).toBe('created');
    expect(applied.invite.tokenHash).toBe(nextHash);
    expect(applied.invite.tokenHash).not.toBe(invite.tokenHash);
    expect(applied.invite.previousTokenHash).toBe(invite.tokenHash);
    expect(applied.invite.generation).toBe(3);
    expect(applied.invite.openedAt).toBeNull();
    expect(applied.invite.completedAt).toBeNull();
    expect(applied.invite.revokedAt).toBeNull();
    expect(canAccessTokenizedEndpoints(applied.invite, new Date('2026-07-31T12:05:00.000Z')).allowed).toBe(true);
  });

  it('regenerate rejects reusing the same token hash', () => {
    const invite = baseInvite({ status: 'expired' });
    const result = applyRegenerate(invite, invite.tokenHash);
    expect(result.ok).toBe(false);
  });

  it('allows regenerate from revoked and expired', () => {
    for (const status of ['revoked', 'expired'] as const) {
      const plan = planRegenerate(baseInvite({ status }));
      expect('ok' in plan).toBe(false);
      if ('ok' in plan) continue;
      expect(plan.nextStatus).toBe('created');
    }
  });

  it('marks terminal helpers correctly', () => {
    expect(isTerminalInviteStatus('completed')).toBe(true);
    expect(isTerminalInviteStatus('expired')).toBe(true);
    expect(isTerminalInviteStatus('revoked')).toBe(true);
    expect(isTerminalInviteStatus('opened')).toBe(false);
  });
});

describe('invite-kit tokenized access — success paths', () => {
  it('allows created/opened/in_progress/completed before expiry', () => {
    const now = new Date('2026-07-31T12:05:00.000Z');
    for (const status of ['created', 'opened', 'in_progress', 'completed'] as const) {
      expect(canAccessTokenizedEndpoints(baseInvite({ status }), now).allowed).toBe(true);
    }
  });
});
