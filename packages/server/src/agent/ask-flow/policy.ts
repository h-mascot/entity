/**
 * Pure ASK claim/resolve policy (THE-886 / WP2-B-05).
 *
 * Reuses chief priority / worker fallback semantics from WP2-B-04 claim policy.
 * CAS version checks are enforced by the service before calling these helpers.
 */

import {
  evaluateClaimPolicy,
  type PolicyActor,
  type PolicyChiefContext,
} from '../chief-routing/policy';
import type { WorkplaneRoutingClaim } from '../chief-routing/types';
import type {
  AskAllowCode,
  AskDenyCode,
  AskReason,
  AskStatus,
  WorkplaneAsk,
} from './types';

export interface AskPolicyEvaluation {
  allowed: boolean;
  code: AskAllowCode | AskDenyCode;
  policyReason: string;
  reasonChain: AskReason[];
  nextStatus?: AskStatus;
}

function reason(
  source: string,
  decision: string,
  value: string | number | boolean | null,
  detail: string,
): AskReason {
  return { source, decision, value, detail };
}

export function isTerminalAskStatus(status: AskStatus): boolean {
  return status === 'resolved' || status === 'blocked';
}

export function isClaimableAskStatus(status: AskStatus): boolean {
  return status === 'open' || status === 'chief_review' || status === 'stale';
}

export function initialAskStatus(input: {
  chiefAssigned: boolean;
  chiefAvailable: boolean;
}): AskStatus {
  if (input.chiefAssigned && input.chiefAvailable) {
    return 'chief_review';
  }
  return 'open';
}

export function evaluateCreateAskStatus(input: {
  chiefAssigned: boolean;
  chiefAvailable: boolean;
}): AskPolicyEvaluation {
  const status = initialAskStatus(input);
  const chain: AskReason[] = [
    reason(
      'chief',
      input.chiefAssigned ? 'assigned' : 'absent',
      input.chiefAssigned,
      input.chiefAssigned ? 'chief assignment present' : 'no chief assigned',
    ),
    reason(
      'presence',
      input.chiefAvailable ? 'available' : 'unavailable',
      input.chiefAvailable,
      input.chiefAvailable ? 'chief live/idle' : 'chief missing/stale/offline or absent',
    ),
  ];
  if (status === 'chief_review') {
    return {
      allowed: true,
      code: 'created_chief_review',
      policyReason: 'ASK opens in chief_review while live chief is assigned',
      reasonChain: chain,
      nextStatus: status,
    };
  }
  return {
    allowed: true,
    code: 'created_open',
    policyReason: input.chiefAssigned
      ? 'ASK opens as open — chief unavailable, workers may claim (fallback)'
      : 'ASK opens as open — no chief gate',
    reasonChain: chain,
    nextStatus: status,
  };
}

export function evaluateAskClaimPolicy(input: {
  ask: WorkplaneAsk;
  actor: PolicyActor;
  chief: PolicyChiefContext;
  nowMs: number;
  windowOpenedAtMs: number | null;
  windowExpiresAtMs: number | null;
}): AskPolicyEvaluation {
  const chain: AskReason[] = [
    reason('ask', 'status', input.ask.status, 'current ASK status before claim'),
    reason('ask', 'version', input.ask.version, 'CAS version already matched'),
  ];

  if (isTerminalAskStatus(input.ask.status)) {
    chain.push(reason('ask', 'deny', input.ask.status, 'terminal ASK cannot be claimed'));
    return {
      allowed: false,
      code: 'already_terminal',
      policyReason: `ASK is ${input.ask.status} and cannot be claimed`,
      reasonChain: chain,
    };
  }

  if (input.ask.status === 'claimed' && input.ask.claimantAgentId === input.actor.agentId) {
    chain.push(reason('claim', 'idempotent', input.actor.agentId, 'actor already claims this ASK'));
    return {
      allowed: true,
      code: 'idempotent_claim',
      policyReason: 'Actor already holds this ASK claim (idempotent)',
      reasonChain: chain,
      nextStatus: 'claimed',
    };
  }

  if (input.ask.status === 'claimed' && input.ask.claimantAgentId !== input.actor.agentId) {
    chain.push(reason(
      'claim',
      'deny',
      input.ask.claimantAgentId,
      'ASK already claimed by another agent',
    ));
    return {
      allowed: false,
      code: 'already_claimed',
      policyReason: `ASK already claimed by ${input.ask.claimantAgentId}`,
      reasonChain: chain,
    };
  }

  if (!isClaimableAskStatus(input.ask.status)) {
    chain.push(reason('ask', 'deny', input.ask.status, 'status is not claimable'));
    return {
      allowed: false,
      code: 'not_claimable',
      policyReason: `ASK status ${input.ask.status} is not claimable`,
      reasonChain: chain,
    };
  }

  // Map ASK claim onto workplane claim policy (chief priority + fallback).
  // Use a synthetic active routing claim only when ASK is already claimed by another.
  const activeClaim: WorkplaneRoutingClaim | null = null;
  const routing = evaluateClaimPolicy({
    actor: input.actor,
    chief: input.chief,
    activeClaim,
    nowMs: input.nowMs,
    windowOpenedAtMs: input.windowOpenedAtMs,
    windowExpiresAtMs: input.windowExpiresAtMs,
  });
  chain.push(...routing.reasonChain);

  if (!routing.allowed) {
    return {
      allowed: false,
      code: routing.code as AskDenyCode,
      policyReason: routing.policyReason,
      reasonChain: chain,
    };
  }

  const allowCode = (routing.code === 'idempotent_claim'
    ? 'idempotent_claim'
    : routing.code) as AskAllowCode;

  return {
    allowed: true,
    code: allowCode,
    policyReason: routing.policyReason,
    reasonChain: chain,
    nextStatus: 'claimed',
  };
}

export function evaluateAskResolvePolicy(input: {
  ask: WorkplaneAsk;
  resolverId: string;
  asOperator: boolean;
  chiefAgentId: string | null;
  resolverAttached: boolean;
}): AskPolicyEvaluation {
  const chain: AskReason[] = [
    reason('ask', 'status', input.ask.status, 'current ASK status before resolve'),
    reason('ask', 'version', input.ask.version, 'CAS version already matched'),
  ];

  if (input.ask.status === 'resolved') {
    chain.push(reason('resolve', 'deny', input.ask.resolvedBy, 'ASK already resolved'));
    return {
      allowed: false,
      code: 'double_resolve',
      policyReason: 'ASK is already resolved (double resolution rejected)',
      reasonChain: chain,
    };
  }

  if (input.ask.status === 'blocked') {
    chain.push(reason('resolve', 'deny', 'blocked', 'blocked ASK cannot be resolved without unblock'));
    return {
      allowed: false,
      code: 'already_terminal',
      policyReason: 'Blocked ASK cannot be resolved',
      reasonChain: chain,
    };
  }

  if (input.ask.status !== 'claimed' && input.ask.status !== 'stale') {
    chain.push(reason('resolve', 'deny', input.ask.status, 'only claimed/stale ASKs resolve'));
    return {
      allowed: false,
      code: 'not_resolvable',
      policyReason: `ASK status ${input.ask.status} is not resolvable`,
      reasonChain: chain,
    };
  }

  if (input.asOperator) {
    chain.push(reason('operator', 'resolve', input.resolverId, 'operator resolve override'));
    return {
      allowed: true,
      code: 'resolved_by_operator',
      policyReason: 'Operator may resolve ASK',
      reasonChain: chain,
      nextStatus: 'resolved',
    };
  }

  if (input.chiefAgentId && input.resolverId === input.chiefAgentId) {
    if (!input.resolverAttached) {
      chain.push(reason('attachment', 'deny', input.resolverId, 'chief resolver not attached'));
      return {
        allowed: false,
        code: 'not_attached',
        policyReason: 'Chief must be attached to resolve',
        reasonChain: chain,
      };
    }
    chain.push(reason('role', 'chief', input.resolverId, 'assigned chief resolves ASK'));
    return {
      allowed: true,
      code: 'resolved_by_chief',
      policyReason: 'Assigned chief may resolve ASK',
      reasonChain: chain,
      nextStatus: 'resolved',
    };
  }

  if (input.ask.claimantAgentId && input.resolverId === input.ask.claimantAgentId) {
    if (!input.resolverAttached) {
      chain.push(reason('attachment', 'deny', input.resolverId, 'claimant not attached'));
      return {
        allowed: false,
        code: 'not_attached',
        policyReason: 'Claimant must be attached to resolve',
        reasonChain: chain,
      };
    }
    chain.push(reason('role', 'claimant', input.resolverId, 'claimant resolves own ASK'));
    return {
      allowed: true,
      code: 'resolved_by_claimant',
      policyReason: 'Claimant may resolve their ASK',
      reasonChain: chain,
      nextStatus: 'resolved',
    };
  }

  chain.push(reason('role', 'deny', input.resolverId, 'resolver is neither claimant, chief, nor operator'));
  return {
    allowed: false,
    code: 'not_claimant',
    policyReason: 'Only claimant, assigned chief, or operator may resolve',
    reasonChain: chain,
  };
}

export function evaluateAskBlockPolicy(input: {
  ask: WorkplaneAsk;
  blockedBy: string;
  asOperator: boolean;
  chiefAgentId: string | null;
}): AskPolicyEvaluation {
  const chain: AskReason[] = [
    reason('ask', 'status', input.ask.status, 'current ASK status before block'),
  ];

  if (isTerminalAskStatus(input.ask.status)) {
    return {
      allowed: false,
      code: 'already_terminal',
      policyReason: `ASK is already ${input.ask.status}`,
      reasonChain: chain,
    };
  }

  if (input.asOperator || (input.chiefAgentId && input.blockedBy === input.chiefAgentId)) {
    chain.push(reason(
      input.asOperator ? 'operator' : 'chief',
      'block',
      input.blockedBy,
      'authorized block',
    ));
    return {
      allowed: true,
      code: 'blocked',
      policyReason: 'ASK blocked',
      reasonChain: chain,
      nextStatus: 'blocked',
    };
  }

  return {
    allowed: false,
    code: 'not_claimant',
    policyReason: 'Only chief or operator may block an ASK',
    reasonChain: chain,
  };
}
