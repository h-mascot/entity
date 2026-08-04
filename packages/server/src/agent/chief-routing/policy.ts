/**
 * Pure Chief-of-Staff claim/assign policy evaluation (THE-885 / WP2-B-04).
 *
 * No I/O — callers supply attachment, chief assignment, presence, and window.
 */

import type { AgentPresenceStatus } from '../identity-capability-card';
import type {
  PolicyEvaluation,
  RoutingReason,
  WorkplaneChiefAssignment,
  WorkplaneRoutingClaim,
} from './types';

export interface PolicyActor {
  agentId: string;
  agentName?: string;
  attached: boolean;
}

export interface PolicyChiefContext {
  assignment: WorkplaneChiefAssignment | null;
  /** Presence when assigned; null when no chief. */
  presenceStatus: AgentPresenceStatus | null;
}

export interface EvaluateClaimPolicyInput {
  actor: PolicyActor;
  chief: PolicyChiefContext;
  activeClaim: WorkplaneRoutingClaim | null;
  nowMs: number;
  windowOpenedAtMs: number | null;
  windowExpiresAtMs: number | null;
}

export interface EvaluateAssignPolicyInput {
  target: PolicyActor;
  assigner: {
    id: string;
    /** Operator path bypasses attachment for the assigner. */
    asOperator: boolean;
    attached: boolean;
  };
  chief: PolicyChiefContext;
  activeClaim: WorkplaneRoutingClaim | null;
  nowMs: number;
  windowOpenedAtMs: number | null;
  windowExpiresAtMs: number | null;
}

function reason(
  source: string,
  decision: string,
  value: string | number | boolean | null,
  detail: string,
): RoutingReason {
  return { source, decision, value, detail };
}

export function isChiefPresenceAvailable(status: AgentPresenceStatus | null | undefined): boolean {
  return status === 'live' || status === 'idle';
}

export function isPriorityWindowOpen(
  nowMs: number,
  windowOpenedAtMs: number | null,
  windowExpiresAtMs: number | null,
): boolean {
  if (windowOpenedAtMs == null || windowExpiresAtMs == null) return false;
  return nowMs >= windowOpenedAtMs && nowMs < windowExpiresAtMs;
}

export function evaluateClaimPolicy(input: EvaluateClaimPolicyInput): PolicyEvaluation {
  const chain: RoutingReason[] = [];
  const chiefAvailable = isChiefPresenceAvailable(input.chief.presenceStatus);
  const priorityWindowOpen = isPriorityWindowOpen(
    input.nowMs,
    input.windowOpenedAtMs,
    input.windowExpiresAtMs,
  );
  const windowOpenedAt = input.windowOpenedAtMs != null
    ? new Date(input.windowOpenedAtMs).toISOString()
    : null;
  const windowExpiresAt = input.windowExpiresAtMs != null
    ? new Date(input.windowExpiresAtMs).toISOString()
    : null;

  const base = {
    chiefAvailable,
    priorityWindowOpen,
    windowOpenedAt,
    windowExpiresAt,
  };

  if (!input.actor.attached) {
    chain.push(reason('attachment', 'deny', input.actor.agentId, 'actor is not attached to workplane'));
    return {
      allowed: false,
      code: 'not_attached',
      policyReason: 'Agent must be attached to the workplane before claiming',
      reasonChain: chain,
      ...base,
    };
  }
  chain.push(reason('attachment', 'pass', input.actor.agentId, 'actor is attached'));

  if (input.activeClaim && input.activeClaim.agentId !== input.actor.agentId) {
    chain.push(reason(
      'claim',
      'deny',
      input.activeClaim.agentId,
      'workplane/task already has an active claim by another agent',
    ));
    return {
      allowed: false,
      code: 'already_claimed',
      policyReason: `Already claimed by ${input.activeClaim.agentId}`,
      reasonChain: chain,
      ...base,
    };
  }
  if (input.activeClaim && input.activeClaim.agentId === input.actor.agentId) {
    chain.push(reason('claim', 'idempotent', input.actor.agentId, 'actor already holds active claim'));
    return {
      allowed: true,
      code: 'idempotent_claim',
      policyReason: 'Actor already holds the active claim (idempotent)',
      reasonChain: chain,
      ...base,
    };
  }

  const chiefId = input.chief.assignment?.chiefAgentId ?? null;
  const isChief = Boolean(chiefId && chiefId === input.actor.agentId);

  if (!chiefId) {
    chain.push(reason('chief', 'absent', null, 'no chief assigned — workers may claim'));
    return {
      allowed: true,
      code: 'worker_claim_no_chief',
      policyReason: 'No chief assigned; attached worker may claim',
      reasonChain: chain,
      ...base,
    };
  }

  chain.push(reason('chief', 'assigned', chiefId, 'chief is assigned on workplane'));

  if (isChief) {
    chain.push(reason('role', 'chief', chiefId, 'actor is the assigned chief'));
    return {
      allowed: true,
      code: 'chief_claim',
      policyReason: 'Assigned chief may claim',
      reasonChain: chain,
      ...base,
    };
  }

  if (!chiefAvailable) {
    chain.push(reason(
      'presence',
      'chief_unavailable',
      input.chief.presenceStatus,
      'chief missing/stale/offline — worker fallback open',
    ));
    return {
      allowed: true,
      code: 'worker_claim_chief_unavailable',
      policyReason: 'Chief unavailable; attached worker may claim (fallback)',
      reasonChain: chain,
      ...base,
    };
  }

  chain.push(reason('presence', 'chief_available', input.chief.presenceStatus, 'chief is live/idle'));

  if (priorityWindowOpen) {
    chain.push(reason(
      'priority_window',
      'deny',
      windowExpiresAt,
      'chief priority window still open for workers',
    ));
    return {
      allowed: false,
      code: 'chief_priority',
      policyReason: 'Chief priority window is open; only the chief may claim',
      reasonChain: chain,
      ...base,
    };
  }

  chain.push(reason('priority_window', 'expired_or_absent', windowExpiresAt, 'workers may claim after window'));
  return {
    allowed: true,
    code: 'worker_claim_after_window',
    policyReason: 'Chief priority window closed; attached worker may claim',
    reasonChain: chain,
    ...base,
  };
}

export function evaluateAssignPolicy(input: EvaluateAssignPolicyInput): PolicyEvaluation {
  const chain: RoutingReason[] = [];
  const chiefAvailable = isChiefPresenceAvailable(input.chief.presenceStatus);
  const priorityWindowOpen = isPriorityWindowOpen(
    input.nowMs,
    input.windowOpenedAtMs,
    input.windowExpiresAtMs,
  );
  const windowOpenedAt = input.windowOpenedAtMs != null
    ? new Date(input.windowOpenedAtMs).toISOString()
    : null;
  const windowExpiresAt = input.windowExpiresAtMs != null
    ? new Date(input.windowExpiresAtMs).toISOString()
    : null;
  const base = {
    chiefAvailable,
    priorityWindowOpen,
    windowOpenedAt,
    windowExpiresAt,
  };

  if (!input.target.attached) {
    chain.push(reason('attachment', 'deny', input.target.agentId, 'target is not attached'));
    return {
      allowed: false,
      code: 'target_not_attached',
      policyReason: 'Target agent must be attached to the workplane',
      reasonChain: chain,
      ...base,
    };
  }
  chain.push(reason('attachment', 'pass', input.target.agentId, 'target is attached'));

  if (input.activeClaim && input.activeClaim.agentId !== input.target.agentId) {
    chain.push(reason(
      'claim',
      'deny',
      input.activeClaim.agentId,
      'cannot assign over another agent active claim',
    ));
    return {
      allowed: false,
      code: 'already_claimed',
      policyReason: `Already claimed by ${input.activeClaim.agentId}`,
      reasonChain: chain,
      ...base,
    };
  }

  const chiefId = input.chief.assignment?.chiefAgentId ?? null;

  if (input.assigner.asOperator) {
    if (!chiefId) {
      chain.push(reason('operator', 'assign', input.assigner.id, 'operator assign with no chief'));
      return {
        allowed: true,
        code: 'operator_assign_no_chief',
        policyReason: 'Operator may assign when no chief is set',
        reasonChain: chain,
        ...base,
      };
    }
    if (!chiefAvailable) {
      chain.push(reason('operator', 'assign_fallback', input.assigner.id, 'operator assign; chief unavailable'));
      return {
        allowed: true,
        code: 'operator_assign_chief_unavailable',
        policyReason: 'Operator may assign when chief is unavailable',
        reasonChain: chain,
        ...base,
      };
    }
    // Operator can still assign when chief is available (explicit human override).
    chain.push(reason('operator', 'assign_override', input.assigner.id, 'operator override while chief available'));
    return {
      allowed: true,
      code: 'operator_assign_no_chief',
      policyReason: 'Operator may assign (explicit override)',
      reasonChain: chain,
      ...base,
    };
  }

  if (!chiefId) {
    chain.push(reason('chief', 'absent', null, 'no chief — agent assigners need operator flag'));
    return {
      allowed: false,
      code: 'chief_required',
      policyReason: 'Assign requires chief or operator when no chief is set for agent assigners',
      reasonChain: chain,
      ...base,
    };
  }

  if (input.assigner.id !== chiefId) {
    chain.push(reason('role', 'deny', input.assigner.id, 'assigner is not the assigned chief'));
    return {
      allowed: false,
      code: 'chief_required',
      policyReason: 'Only the assigned chief (or an operator) may assign',
      reasonChain: chain,
      ...base,
    };
  }

  if (!input.assigner.attached) {
    chain.push(reason('attachment', 'deny', input.assigner.id, 'chief assigner is not attached'));
    return {
      allowed: false,
      code: 'not_attached',
      policyReason: 'Chief must be attached to assign',
      reasonChain: chain,
      ...base,
    };
  }

  if (!chiefAvailable) {
    // Spec: fallback if Chief unavailable — operator path handles human fallback;
    // chief themselves when stale cannot assign as live authority.
    chain.push(reason('presence', 'chief_unavailable', input.chief.presenceStatus, 'stale chief cannot assign'));
    return {
      allowed: false,
      code: 'chief_required',
      policyReason: 'Chief presence is unavailable; use operator assign or wait for live chief',
      reasonChain: chain,
      ...base,
    };
  }

  chain.push(reason('role', 'chief', chiefId, 'live chief assigns attached agent'));
  return {
    allowed: true,
    code: 'chief_assign',
    policyReason: 'Assigned chief may assign an attached agent',
    reasonChain: chain,
    ...base,
  };
}
