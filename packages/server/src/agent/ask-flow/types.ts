/**
 * THE-886 / WP2-B-05 — Workplane ASK claim/resolve model.
 *
 * Builds on WP2-B-04 chief priority / worker fallback. Claim and resolve are
 * compare-and-swap (expectedVersion) so stale/double resolution is rejected.
 */

export const ASK_STATUSES = [
  'open',
  'chief_review',
  'claimed',
  'blocked',
  'resolved',
  'stale',
] as const;
export type AskStatus = (typeof ASK_STATUSES)[number];

export const ASK_EVENT_TYPES = [
  'created',
  'claimed',
  'resolved',
  'blocked',
  'marked_stale',
  'cas_rejected',
] as const;
export type AskEventType = (typeof ASK_EVENT_TYPES)[number];

export const ASK_DENY_CODES = [
  'invalid_input',
  'not_found',
  'not_attached',
  'chief_priority',
  'already_claimed',
  'not_claimable',
  'not_resolvable',
  'stale_version',
  'double_resolve',
  'not_claimant',
  'already_terminal',
] as const;
export type AskDenyCode = (typeof ASK_DENY_CODES)[number];

export const ASK_ALLOW_CODES = [
  'created_open',
  'created_chief_review',
  'chief_claim',
  'worker_claim_no_chief',
  'worker_claim_after_window',
  'worker_claim_chief_unavailable',
  'idempotent_claim',
  'resolved_by_claimant',
  'resolved_by_chief',
  'resolved_by_operator',
  'blocked',
  'marked_stale',
] as const;
export type AskAllowCode = (typeof ASK_ALLOW_CODES)[number];

export interface AskReason {
  source: string;
  decision: string;
  value: string | number | boolean | null;
  detail: string;
}

export interface WorkplaneAsk {
  id: string;
  workplaneId: string;
  taskId: number | null;
  title: string;
  body: string | null;
  status: AskStatus;
  /** Monotonic CAS token; increments on every successful mutation. */
  version: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  claimantAgentId: string | null;
  claimantAgentName: string | null;
  claimedAt: string | null;
  claimPolicyCode: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  blockedReason: string | null;
  reasonChain: AskReason[];
}

export interface WorkplaneAskEvent {
  id: string;
  askId: string;
  workplaneId: string;
  eventType: AskEventType;
  actorId: string | null;
  fromStatus: AskStatus | null;
  toStatus: AskStatus | null;
  fromVersion: number | null;
  toVersion: number | null;
  code: string;
  detail: string;
  createdAt: string;
}

export interface CreateAskInput {
  workplaneId: string;
  title: string;
  body?: string | null;
  taskId?: number | null;
  createdBy?: string | null;
}

export interface ClaimAskInput {
  workplaneId: string;
  askId: string;
  agentId: string;
  /** Required CAS token from last known ask.version. */
  expectedVersion: number;
  expectedStatus?: AskStatus | null;
}

export interface ResolveAskInput {
  workplaneId: string;
  askId: string;
  /** Resolver agent id (claimant/chief) or operator id when asOperator. */
  resolvedBy: string;
  expectedVersion: number;
  note?: string | null;
  asOperator?: boolean;
}

export interface BlockAskInput {
  workplaneId: string;
  askId: string;
  blockedBy: string;
  expectedVersion: number;
  reason?: string | null;
  asOperator?: boolean;
}

export interface WorkplaneAskPanel {
  workplaneId: string;
  evaluatedAt: string;
  asks: WorkplaneAsk[];
  openCount: number;
  claimedCount: number;
  resolvedCount: number;
  staleCount: number;
  summary: string;
}
