import { describe, expect, it } from 'vitest';
import {
  hashInviteToken,
  isLegacyInProgressSessionStatus,
  legacyVerifiedImpliesHealthyCompleted,
  mapInviteStatusToOnboardingSession,
  mapOnboardingSessionStatusToInvite,
  mintInviteToken,
  ONBOARDING_AGENT_SESSION_STATUSES,
  shouldMutateGlobalOnboardingState,
  type AgentInviteStatus,
  type OnboardingAgentSessionStatus,
} from './index';

describe('invite-kit compatibility mapping', () => {
  it('maps every legacy onboarding session status to an invite status', () => {
    const expected: Record<OnboardingAgentSessionStatus, AgentInviteStatus> = {
      created: 'created',
      opened: 'opened',
      installing: 'in_progress',
      configured: 'in_progress',
      verified: 'completed',
      expired: 'expired',
    };

    for (const status of ONBOARDING_AGENT_SESSION_STATUSES) {
      expect(mapOnboardingSessionStatusToInvite(status)).toBe(expected[status]);
    }
  });

  it('maps invite statuses back to legacy session statuses, with revoked → null', () => {
    expect(mapInviteStatusToOnboardingSession('created')).toBe('created');
    expect(mapInviteStatusToOnboardingSession('opened')).toBe('opened');
    expect(mapInviteStatusToOnboardingSession('in_progress')).toBe('installing');
    expect(mapInviteStatusToOnboardingSession('completed')).toBe('verified');
    expect(mapInviteStatusToOnboardingSession('expired')).toBe('expired');
    expect(mapInviteStatusToOnboardingSession('revoked')).toBeNull();
  });

  it('treats installing and configured as legacy in-progress aliases', () => {
    expect(isLegacyInProgressSessionStatus('installing')).toBe(true);
    expect(isLegacyInProgressSessionStatus('configured')).toBe(true);
    expect(isLegacyInProgressSessionStatus('opened')).toBe(false);
  });

  it('does not coerce verified → healthy completed without checklist evidence', () => {
    expect(
      legacyVerifiedImpliesHealthyCompleted({
        sessionStatus: 'verified',
        hasCompletionEvidence: false,
      }),
    ).toBe(false);
    expect(
      legacyVerifiedImpliesHealthyCompleted({
        sessionStatus: 'verified',
        hasCompletionEvidence: true,
      }),
    ).toBe(true);
    expect(
      legacyVerifiedImpliesHealthyCompleted({
        sessionStatus: 'opened',
        hasCompletionEvidence: true,
      }),
    ).toBe(false);
  });

  it('mutates global onboarding.state only for first-run creation source', () => {
    expect(shouldMutateGlobalOnboardingState('onboarding_first_run')).toBe(true);
    expect(shouldMutateGlobalOnboardingState('agents_invite')).toBe(false);
  });
});

describe('invite-kit token hashing', () => {
  it('mints raw tokens and hashes without storing the raw value in the hash helper output', () => {
    const raw = mintInviteToken();
    expect(raw.length).toBeGreaterThanOrEqual(16);
    const hash = hashInviteToken(raw);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(raw);
    expect(hashInviteToken(raw)).toBe(hash);
  });

  it('rejects short tokens', () => {
    expect(() => hashInviteToken('short')).toThrow(/length >= 8/);
  });
});
