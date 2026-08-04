/**
 * THE-885 / WP2-B-04 — Chief-of-Staff routing policy surface (claim/assign).
 *
 * Policy + durable chief assignment for Workplanes. Full ASK claim/resolve
 * remains WP2-B-05; this surface gates claim/assign with chief priority and
 * stale-chief fallback using attach + presence primitives.
 */

import type { AgentPresenceStatus } from '../identity-capability-card';

/** Default chief priority window before workers may claim (5 minutes). */
export const DEFAULT_CHIEF_PRIORITY_WINDOW_MS = 5 * 60 * 1000;

export const ROUTING_CLAIM_MODES = ['claim', 'assign'] as const;
export type RoutingClaimMode = (typeof ROUTING_CLAIM_MODES)[number];

export const ROUTING_CLAIM_STATUSES = ['active', 'released'] as const;
export type RoutingClaimStatus = (typeof ROUTING_CLAIM_STATUSES)[number];

export const ROUTING_DENY_CODES = [
  'not_attached',
  'target_not_attached',
  'chief_priority',
  'already_claimed',
  'chief_required',
  'invalid_input',
  'chief_not_attached',
  'no_active_claim',
] as const;
export type RoutingDenyCode = (typeof ROUTING_DENY_CODES)[number];

export const ROUTING_ALLOW_CODES = [
  'chief_claim',
  'worker_claim_no_chief',
  'worker_claim_after_window',
  'worker_claim_chief_unavailable',
  'idempotent_claim',
  'chief_assign',
  'operator_assign_no_chief',
  'operator_assign_chief_unavailable',
] as const;
export type RoutingAllowCode = (typeof ROUTING_ALLOW_CODES)[number];

export interface RoutingReason {
  source: string;
  decision: string;
  value: string | number | boolean | null;
  detail: string;
}

export interface WorkplaneChiefAssignment {
  workplaneId: string;
  chiefAgentId: string;
  chiefInviteId: string | null;
  chiefAgentName: string;
  assignedAt: string;
  assignedBy: string | null;
  priorityWindowMs: number;
  updatedAt: string;
}

export interface WorkplaneRoutingWindow {
  id: string;
  workplaneId: string;
  taskId: number | null;
  openedAt: string;
  priorityWindowMs: number;
  expiresAt: string;
}

export interface WorkplaneRoutingClaim {
  id: string;
  workplaneId: string;
  taskId: number | null;
  agentId: string;
  agentName: string;
  claimMode: RoutingClaimMode;
  status: RoutingClaimStatus;
  requestId: string | null;
  policyCode: string;
  policyReason: string;
  reasonChain: RoutingReason[];
  claimedAt: string;
  claimedBy: string | null;
  releasedAt: string | null;
}

export interface AssignChiefInput {
  workplaneId: string;
  agentId: string;
  assignedBy?: string | null;
  priorityWindowMs?: number | null;
}

export interface ClaimRoutingInput {
  workplaneId: string;
  agentId: string;
  taskId?: number | null;
  requestId?: string | null;
}

export interface AssignRoutingInput {
  workplaneId: string;
  agentId: string;
  /** Who is performing the assign (chief agent id or operator id). */
  assignedBy: string;
  taskId?: number | null;
  requestId?: string | null;
  /** When true, treat assignedBy as a human operator (not an attached agent). */
  asOperator?: boolean;
}

export interface PolicyEvaluation {
  allowed: boolean;
  code: RoutingAllowCode | RoutingDenyCode;
  policyReason: string;
  reasonChain: RoutingReason[];
  chiefAvailable: boolean;
  priorityWindowOpen: boolean;
  windowOpenedAt: string | null;
  windowExpiresAt: string | null;
}

export interface ChiefPresenceOverlay {
  agentId: string;
  agentName: string;
  presenceStatus: AgentPresenceStatus;
  available: boolean;
  lastSeenAt: string | null;
  heartbeatFreshnessLabel: string;
}

export interface WorkplaneRoutingPanel {
  workplaneId: string;
  evaluatedAt: string;
  chief: WorkplaneChiefAssignment | null;
  chiefPresence: ChiefPresenceOverlay | null;
  activeClaim: WorkplaneRoutingClaim | null;
  priorityWindow: {
    open: boolean;
    openedAt: string | null;
    expiresAt: string | null;
    priorityWindowMs: number;
  };
  policy: {
    chiefRequired: false;
    workersMayClaim: boolean;
    claimGate: 'open' | 'chief_priority' | 'blocked_claimed';
    summary: string;
  };
  attachedAgentIds: string[];
}
