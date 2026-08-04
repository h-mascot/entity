import {
  type AgentInviteDomain,
  type AgentInviteProgressItem,
  type AgentInviteStatus,
  type InviteTransitionEvent,
  type InviteTransitionFailure,
  type InviteTransitionResult,
  type RegeneratePlan,
  TERMINAL_INVITE_STATUSES,
} from './types';

/** Explicit allowed (from → to) edges keyed by event. */
const ALLOWED_TRANSITIONS: Record<InviteTransitionEvent, ReadonlyArray<readonly [AgentInviteStatus, AgentInviteStatus]>> = {
  open_manifest: [
    ['created', 'opened'],
    // Idempotent re-open while already opened / in progress / completed.
    ['opened', 'opened'],
    ['in_progress', 'in_progress'],
    ['completed', 'completed'],
  ],
  report_progress: [
    ['created', 'in_progress'],
    ['opened', 'in_progress'],
    ['in_progress', 'in_progress'],
  ],
  complete: [
    ['opened', 'completed'],
    ['in_progress', 'completed'],
  ],
  expire: [
    ['created', 'expired'],
    ['opened', 'expired'],
    ['in_progress', 'expired'],
  ],
  revoke: [
    ['created', 'revoked'],
    ['opened', 'revoked'],
    ['in_progress', 'revoked'],
    ['completed', 'revoked'],
    ['expired', 'revoked'],
  ],
  regenerate: [
    // regenerate is handled specially — listed for canTransition inspection
    ['created', 'created'],
    ['opened', 'created'],
    ['in_progress', 'created'],
    ['completed', 'created'],
    ['expired', 'created'],
    ['revoked', 'created'],
  ],
};

function fail(
  partial: Omit<InviteTransitionFailure, 'ok'>,
): InviteTransitionFailure {
  return { ok: false, ...partial };
}

export function isTerminalInviteStatus(status: AgentInviteStatus): boolean {
  return (TERMINAL_INVITE_STATUSES as readonly string[]).includes(status);
}

export function isInvitePastExpiry(invite: Pick<AgentInviteDomain, 'expiresAt'>, now: Date = new Date()): boolean {
  const expiresMs = Date.parse(invite.expiresAt);
  if (Number.isNaN(expiresMs)) {
    return true;
  }
  return expiresMs < now.getTime();
}

/**
 * Whether checklist evidence is sufficient to mark completed.
 * Required: at least one progress step, and every step is `done` (no pending/running/error).
 */
export function hasCompletionEvidence(progress: readonly AgentInviteProgressItem[]): boolean {
  if (progress.length === 0) {
    return false;
  }
  return progress.every((step) => step.status === 'done');
}

export function canTransition(
  from: AgentInviteStatus,
  event: InviteTransitionEvent,
  to?: AgentInviteStatus,
): boolean {
  const edges = ALLOWED_TRANSITIONS[event];
  if (!edges) return false;
  if (to === undefined) {
    return edges.some(([edgeFrom]) => edgeFrom === from);
  }
  return edges.some(([edgeFrom, edgeTo]) => edgeFrom === from && edgeTo === to);
}

export function resolveTransitionTarget(
  from: AgentInviteStatus,
  event: InviteTransitionEvent,
): AgentInviteStatus | null {
  const edge = ALLOWED_TRANSITIONS[event].find(([edgeFrom]) => edgeFrom === from);
  return edge ? edge[1] : null;
}

/**
 * Tokenized onboarding endpoints must reject revoked/expired invites.
 * Past `expiresAt` also blocks even if status has not been promoted yet.
 */
export function canAccessTokenizedEndpoints(
  invite: Pick<AgentInviteDomain, 'status' | 'expiresAt'>,
  now: Date = new Date(),
): { allowed: boolean; reason?: string } {
  if (invite.status === 'revoked') {
    return { allowed: false, reason: 'invite_revoked' };
  }
  if (invite.status === 'expired') {
    return { allowed: false, reason: 'invite_expired' };
  }
  if (isInvitePastExpiry(invite, now)) {
    return { allowed: false, reason: 'invite_past_expires_at' };
  }
  if (
    invite.status === 'created'
    || invite.status === 'opened'
    || invite.status === 'in_progress'
    || invite.status === 'completed'
  ) {
    return { allowed: true };
  }
  return { allowed: false, reason: 'invite_status_blocked' };
}

export function applyExpiryIfNeeded(
  invite: AgentInviteDomain,
  now: Date = new Date(),
): InviteTransitionResult {
  if (invite.status === 'expired' || invite.status === 'revoked' || invite.status === 'completed') {
    return {
      ok: true,
      invite,
      from: invite.status,
      to: invite.status,
      event: 'expire',
    };
  }
  if (!isInvitePastExpiry(invite, now)) {
    return {
      ok: true,
      invite,
      from: invite.status,
      to: invite.status,
      event: 'expire',
    };
  }
  return transitionInvite(invite, 'expire', { now });
}

export interface TransitionOptions {
  now?: Date;
  revokedBy?: string | null;
  /** Override evidence check for complete (tests / trusted server paths). */
  forceComplete?: boolean;
}

export function transitionInvite(
  invite: AgentInviteDomain,
  event: InviteTransitionEvent,
  options: TransitionOptions = {},
): InviteTransitionResult {
  if (event === 'regenerate') {
    return fail({
      error: 'Use planRegenerate() / applyRegenerate() for regenerate semantics',
      code: 'forbidden_transition',
      from: invite.status,
      event,
    });
  }

  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const from = invite.status;
  const to = resolveTransitionTarget(from, event);

  if (!to) {
    return fail({
      error: `Transition ${event} is not allowed from status ${from}`,
      code: isTerminalInviteStatus(from) ? 'terminal_status' : 'forbidden_transition',
      from,
      event,
    });
  }

  if (event === 'complete') {
    const evidenceOk = options.forceComplete === true || hasCompletionEvidence(invite.progress);
    if (!evidenceOk) {
      return fail({
        error: 'Completion requires checklist evidence (all progress steps done)',
        code: 'missing_completion_evidence',
        from,
        event,
        to,
      });
    }
  }

  if (!canTransition(from, event, to)) {
    return fail({
      error: `Transition ${from} → ${to} via ${event} is forbidden`,
      code: 'forbidden_transition',
      from,
      event,
      to,
    });
  }

  const next: AgentInviteDomain = {
    ...invite,
    status: to,
    openedAt: event === 'open_manifest' && from === 'created' ? nowIso : invite.openedAt,
    completedAt: event === 'complete' ? nowIso : invite.completedAt,
    revokedAt: event === 'revoke' ? nowIso : invite.revokedAt,
    revokedBy: event === 'revoke' ? (options.revokedBy ?? invite.revokedBy) : invite.revokedBy,
  };

  return { ok: true, invite: next, from, to, event };
}

/**
 * Pure regenerate plan: revoke prior token semantics and reset to `created`.
 * Caller must mint a new raw token (show-once) and persist the new hash.
 */
export function planRegenerate(invite: AgentInviteDomain): RegeneratePlan | InviteTransitionFailure {
  if (!canTransition(invite.status, 'regenerate', 'created')) {
    return fail({
      error: `Regenerate is not allowed from status ${invite.status}`,
      code: 'forbidden_transition',
      from: invite.status,
      event: 'regenerate',
      to: 'created',
    });
  }

  return {
    nextStatus: 'created',
    previousStatus: invite.status,
    previousTokenHash: invite.tokenHash,
    revokePreviousToken: true,
    clearOpenedAt: true,
    clearCompletedAt: true,
    clearRevokedAt: true,
    incrementGeneration: true,
    requiresNewTokenHash: true,
  };
}

export function applyRegenerate(
  invite: AgentInviteDomain,
  newTokenHash: string,
  options: { now?: Date; expiresAt?: string } = {},
): InviteTransitionResult {
  const plan = planRegenerate(invite);
  if ('ok' in plan && plan.ok === false) {
    return plan;
  }
  const regeneratePlan = plan as RegeneratePlan;
  if (!newTokenHash || newTokenHash.trim().length < 8) {
    return fail({
      error: 'Regenerate requires a new token hash',
      code: 'forbidden_transition',
      from: invite.status,
      event: 'regenerate',
      to: 'created',
    });
  }
  if (newTokenHash === regeneratePlan.previousTokenHash) {
    return fail({
      error: 'Regenerate must rotate token hash',
      code: 'forbidden_transition',
      from: invite.status,
      event: 'regenerate',
      to: 'created',
    });
  }

  const now = options.now ?? new Date();
  const next: AgentInviteDomain = {
    ...invite,
    tokenHash: newTokenHash,
    previousTokenHash: regeneratePlan.previousTokenHash,
    generation: invite.generation + 1,
    status: 'created',
    openedAt: null,
    completedAt: null,
    revokedAt: null,
    revokedBy: null,
    expiresAt: options.expiresAt ?? invite.expiresAt,
    createdAt: invite.createdAt,
  };

  // Touch createdAt? Keep original createdAt for invite lineage; generation tracks rotations.
  void now;

  return {
    ok: true,
    invite: next,
    from: regeneratePlan.previousStatus,
    to: 'created',
    event: 'regenerate',
  };
}

/** Snapshot of allowed edges for tests / docs. */
export function listAllowedTransitions(): ReadonlyArray<{
  event: InviteTransitionEvent;
  from: AgentInviteStatus;
  to: AgentInviteStatus;
}> {
  const rows: Array<{ event: InviteTransitionEvent; from: AgentInviteStatus; to: AgentInviteStatus }> = [];
  for (const event of Object.keys(ALLOWED_TRANSITIONS) as InviteTransitionEvent[]) {
    for (const [from, to] of ALLOWED_TRANSITIONS[event]) {
      rows.push({ event, from, to });
    }
  }
  return rows;
}
