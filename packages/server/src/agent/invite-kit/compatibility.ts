import {
  type AgentInviteStatus,
  type InviteCreationSource,
  type OnboardingAgentSessionStatus,
} from './types';

/**
 * Map legacy onboarding agent-session status → invite-kit product status.
 *
 * Gaps from THE-876 audit:
 * - installing | configured → in_progress
 * - verified → completed (mapping only; completion evidence is enforced by the status machine)
 * - revoked has no legacy equivalent
 */
export function mapOnboardingSessionStatusToInvite(
  status: OnboardingAgentSessionStatus,
): AgentInviteStatus {
  switch (status) {
    case 'created':
      return 'created';
    case 'opened':
      return 'opened';
    case 'installing':
    case 'configured':
      return 'in_progress';
    case 'verified':
      return 'completed';
    case 'expired':
      return 'expired';
    default: {
      const _exhaustive: never = status;
      throw new Error(`Unknown onboarding session status: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Map invite-kit status → closest legacy onboarding session status for
 * compatibility writes. `revoked` has no legacy enum — returns null so callers
 * must fail-closed on tokenized endpoints instead of coercing.
 */
export function mapInviteStatusToOnboardingSession(
  status: AgentInviteStatus,
): OnboardingAgentSessionStatus | null {
  switch (status) {
    case 'created':
      return 'created';
    case 'opened':
      return 'opened';
    case 'in_progress':
      // Canonical legacy write for in-progress; configured remains a read-side alias.
      return 'installing';
    case 'completed':
      return 'verified';
    case 'expired':
      return 'expired';
    case 'revoked':
      return null;
    default: {
      const _exhaustive: never = status;
      throw new Error(`Unknown invite status: ${String(_exhaustive)}`);
    }
  }
}

export function isLegacyInProgressSessionStatus(status: OnboardingAgentSessionStatus): boolean {
  return status === 'installing' || status === 'configured';
}

/**
 * Agents-created invites must not mutate global first-run `onboarding.state`.
 * First-run onboarding sessions may continue to.
 */
export function shouldMutateGlobalOnboardingState(source: InviteCreationSource): boolean {
  return source === 'onboarding_first_run';
}

/**
 * Do not treat a legacy `verified` session as healthy completed without checklist
 * evidence. Mapping alone is not a readiness receipt.
 */
export function legacyVerifiedImpliesHealthyCompleted(options: {
  sessionStatus: OnboardingAgentSessionStatus;
  hasCompletionEvidence: boolean;
}): boolean {
  if (options.sessionStatus !== 'verified') {
    return false;
  }
  return options.hasCompletionEvidence;
}
