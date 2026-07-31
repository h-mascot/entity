/**
 * THE-885 / WP2-B-04 — Chief-of-Staff routing policy client model.
 *
 * Claim/assign gate summary for Workplanes. Never invents live chief presence.
 */

import {
  normalizePresenceStatus,
  type AgentPresenceStatus,
} from './agentIdentityCapabilityCard.ts';

export type RoutingClaimGate = 'open' | 'chief_priority' | 'blocked_claimed';

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

export interface ChiefPresenceOverlay {
  agentId: string;
  agentName: string;
  presenceStatus: AgentPresenceStatus;
  available: boolean;
  lastSeenAt: string | null;
  heartbeatFreshnessLabel: string;
}

export interface WorkplaneRoutingClaim {
  id: string;
  workplaneId: string;
  taskId: number | null;
  agentId: string;
  agentName: string;
  claimMode: 'claim' | 'assign';
  status: 'active' | 'released';
  requestId: string | null;
  policyCode: string;
  policyReason: string;
  reasonChain: RoutingReason[];
  claimedAt: string;
  claimedBy: string | null;
  releasedAt: string | null;
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
    claimGate: RoutingClaimGate;
    summary: string;
  };
  attachedAgentIds: string[];
}

export type WorkplaneRoutingLoadState =
  | { status: 'idle' }
  | { status: 'loading'; workplaneId: string }
  | { status: 'ready'; panel: WorkplaneRoutingPanel }
  | { status: 'error'; workplaneId: string | null; error: string };

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asTaskId(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asClaimGate(value: unknown): RoutingClaimGate {
  if (value === 'chief_priority' || value === 'blocked_claimed' || value === 'open') {
    return value;
  }
  return 'open';
}

function parseReasons(value: unknown): RoutingReason[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    const source = asNullableString(row.source);
    const decision = asNullableString(row.decision);
    const detail = asNullableString(row.detail);
    if (!source || !decision || !detail) return [];
    const rawValue = row.value;
    const normalizedValue =
      typeof rawValue === 'string'
      || typeof rawValue === 'number'
      || typeof rawValue === 'boolean'
      || rawValue === null
        ? rawValue
        : null;
    return [{ source, decision, value: normalizedValue, detail }];
  });
}

export function parseWorkplaneRoutingClaim(raw: unknown): WorkplaneRoutingClaim | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = asNullableString(row.id);
  const workplaneId = asNullableString(row.workplaneId ?? row.workplane_id);
  const agentId = asNullableString(row.agentId ?? row.agent_id);
  const agentName = asNullableString(row.agentName ?? row.agent_name);
  if (!id || !workplaneId || !agentId || !agentName) return null;
  const claimMode = row.claimMode === 'assign' || row.claim_mode === 'assign' ? 'assign' : 'claim';
  const status = row.status === 'released' ? 'released' : 'active';
  return {
    id,
    workplaneId,
    taskId: asTaskId(row.taskId ?? row.task_id),
    agentId,
    agentName,
    claimMode,
    status,
    requestId: asNullableString(row.requestId ?? row.request_id),
    policyCode: asString(row.policyCode ?? row.policy_code, 'unknown'),
    policyReason: asString(row.policyReason ?? row.policy_reason, ''),
    reasonChain: parseReasons(row.reasonChain ?? row.reason_chain),
    claimedAt: asString(row.claimedAt ?? row.claimed_at),
    claimedBy: asNullableString(row.claimedBy ?? row.claimed_by),
    releasedAt: asNullableString(row.releasedAt ?? row.released_at),
  };
}

export function parseWorkplaneRoutingPanel(raw: unknown): WorkplaneRoutingPanel | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const workplaneId = asNullableString(row.workplaneId ?? row.workplane_id);
  if (!workplaneId) return null;

  let chief: WorkplaneChiefAssignment | null = null;
  if (row.chief && typeof row.chief === 'object') {
    const c = row.chief as Record<string, unknown>;
    const chiefAgentId = asNullableString(c.chiefAgentId ?? c.chief_agent_id);
    const chiefAgentName = asNullableString(c.chiefAgentName ?? c.chief_agent_name);
    if (chiefAgentId && chiefAgentName) {
      chief = {
        workplaneId: asNullableString(c.workplaneId ?? c.workplane_id) ?? workplaneId,
        chiefAgentId,
        chiefInviteId: asNullableString(c.chiefInviteId ?? c.chief_invite_id),
        chiefAgentName,
        assignedAt: asString(c.assignedAt ?? c.assigned_at),
        assignedBy: asNullableString(c.assignedBy ?? c.assigned_by),
        priorityWindowMs: asNumber(c.priorityWindowMs ?? c.priority_window_ms, 300_000),
        updatedAt: asString(c.updatedAt ?? c.updated_at),
      };
    }
  }

  let chiefPresence: ChiefPresenceOverlay | null = null;
  if (row.chiefPresence && typeof row.chiefPresence === 'object') {
    const p = row.chiefPresence as Record<string, unknown>;
    const agentId = asNullableString(p.agentId ?? p.agent_id);
    const agentName = asNullableString(p.agentName ?? p.agent_name);
    if (agentId && agentName) {
      chiefPresence = {
        agentId,
        agentName,
        presenceStatus: normalizePresenceStatus(p.presenceStatus ?? p.presence_status),
        available: p.available === true,
        lastSeenAt: asNullableString(p.lastSeenAt ?? p.last_seen_at),
        heartbeatFreshnessLabel: asString(
          p.heartbeatFreshnessLabel ?? p.heartbeat_freshness_label,
          'No heartbeat',
        ),
      };
    }
  }

  const windowRaw = row.priorityWindow && typeof row.priorityWindow === 'object'
    ? row.priorityWindow as Record<string, unknown>
    : {};
  const policyRaw = row.policy && typeof row.policy === 'object'
    ? row.policy as Record<string, unknown>
    : {};

  const attached = Array.isArray(row.attachedAgentIds)
    ? row.attachedAgentIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : [];

  return {
    workplaneId,
    evaluatedAt: asString(row.evaluatedAt ?? row.evaluated_at, new Date().toISOString()),
    chief,
    chiefPresence,
    activeClaim: parseWorkplaneRoutingClaim(row.activeClaim ?? row.active_claim),
    priorityWindow: {
      open: windowRaw.open === true,
      openedAt: asNullableString(windowRaw.openedAt ?? windowRaw.opened_at),
      expiresAt: asNullableString(windowRaw.expiresAt ?? windowRaw.expires_at),
      priorityWindowMs: asNumber(windowRaw.priorityWindowMs ?? windowRaw.priority_window_ms, 300_000),
    },
    policy: {
      chiefRequired: false,
      workersMayClaim: policyRaw.workersMayClaim !== false && policyRaw.workers_may_claim !== false,
      claimGate: asClaimGate(policyRaw.claimGate ?? policyRaw.claim_gate),
      summary: asString(policyRaw.summary, 'Routing policy unavailable'),
    },
    attachedAgentIds: attached,
  };
}

export function createInitialRoutingLoadState(): WorkplaneRoutingLoadState {
  return { status: 'idle' };
}

export function routingBeginLoad(
  _prev: WorkplaneRoutingLoadState,
  workplaneId: string,
): WorkplaneRoutingLoadState {
  return { status: 'loading', workplaneId };
}

export function routingFromSuccess(panel: WorkplaneRoutingPanel): WorkplaneRoutingLoadState {
  return { status: 'ready', panel };
}

export function routingFromError(
  workplaneId: string | null,
  error: string,
): WorkplaneRoutingLoadState {
  return { status: 'error', workplaneId, error };
}

export function routingSummary(panel: WorkplaneRoutingPanel): string {
  if (panel.activeClaim) {
    return `Claimed · ${panel.activeClaim.agentName}`;
  }
  switch (panel.policy.claimGate) {
    case 'chief_priority':
      return 'Chief priority';
    case 'blocked_claimed':
      return 'Claimed';
    default:
      if (panel.chief && panel.chiefPresence && !panel.chiefPresence.available) {
        return 'Chief unavailable · workers open';
      }
      if (panel.chief) {
        return `Chief · ${panel.chief.chiefAgentName}`;
      }
      return 'No chief · workers open';
  }
}

export function routingGateLabel(gate: RoutingClaimGate): string {
  switch (gate) {
    case 'chief_priority':
      return 'Chief priority window';
    case 'blocked_claimed':
      return 'Active claim';
    default:
      return 'Open for claim';
  }
}

export function chiefPresenceToneClass(status: AgentPresenceStatus | null | undefined): string {
  switch (status) {
    case 'live':
    case 'idle':
      return 'text-[var(--success)]';
    case 'stale':
    case 'offline':
      return 'text-[var(--warning)]';
    case 'missing':
    case 'unknown':
    default:
      return 'text-[var(--text-muted)]';
  }
}
