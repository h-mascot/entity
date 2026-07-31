/**
 * THE-884 / WP2-B-03 — Attached agents on task Workplanes (client model).
 *
 * Lists assigned/attached agents with truthful presence overlay.
 */

import {
  normalizePresenceStatus,
  type AgentPresenceStatus,
} from './agentIdentityCapabilityCard.ts';

export type AttachmentPresenceSource =
  | 'attachment'
  | 'heartbeat'
  | 'invite_missing';

export interface WorkplaneAttachedAgent {
  attachmentId: string;
  workplaneId: string;
  agentId: string;
  inviteId: string | null;
  taskId: number | null;
  agentName: string;
  role: string;
  attachedAt: string;
  attachedBy: string | null;
  presenceStatus: AgentPresenceStatus;
  lastSeenAt: string | null;
  heartbeatFreshnessLabel: string;
  currentWorkLabel: string;
  degradedReasons: string[];
  source: AttachmentPresenceSource;
}

export interface WorkplaneAttachedAgentsCounts {
  total: number;
  live: number;
  idle: number;
  stale: number;
  offline: number;
  missing: number;
  unknown: number;
  degraded: number;
}

export interface WorkplaneAttachedAgentsPanel {
  workplaneId: string;
  evaluatedAt: string;
  agents: WorkplaneAttachedAgent[];
  counts: WorkplaneAttachedAgentsCounts;
}

export type WorkplaneAttachedLoadState =
  | { status: 'idle' }
  | { status: 'loading'; workplaneId: string }
  | { status: 'ready'; panel: WorkplaneAttachedAgentsPanel }
  | { status: 'empty'; workplaneId: string; panel: WorkplaneAttachedAgentsPanel }
  | { status: 'error'; workplaneId: string | null; error: string };

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asTaskId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function asSource(value: unknown): AttachmentPresenceSource {
  if (value === 'heartbeat' || value === 'invite_missing' || value === 'attachment') {
    return value;
  }
  return 'attachment';
}

export function parseWorkplaneAttachedAgent(raw: unknown): WorkplaneAttachedAgent | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const attachmentId = asNullableString(row.attachmentId ?? row.attachment_id);
  const workplaneId = asNullableString(row.workplaneId ?? row.workplane_id);
  const agentId = asNullableString(row.agentId ?? row.agent_id);
  const agentName = asNullableString(row.agentName ?? row.agent_name);
  if (!attachmentId || !workplaneId || !agentId || !agentName) return null;
  return {
    attachmentId,
    workplaneId,
    agentId,
    inviteId: asNullableString(row.inviteId ?? row.invite_id),
    taskId: asTaskId(row.taskId ?? row.task_id),
    agentName,
    role: asNullableString(row.role) ?? 'worker',
    attachedAt: asNullableString(row.attachedAt ?? row.attached_at) ?? '',
    attachedBy: asNullableString(row.attachedBy ?? row.attached_by),
    presenceStatus: normalizePresenceStatus(row.presenceStatus ?? row.presence_status),
    lastSeenAt: asNullableString(row.lastSeenAt ?? row.last_seen_at),
    heartbeatFreshnessLabel:
      asNullableString(row.heartbeatFreshnessLabel ?? row.heartbeat_freshness_label) ?? 'No heartbeat yet',
    currentWorkLabel:
      asNullableString(row.currentWorkLabel ?? row.current_work_label) ?? 'No current work attached',
    degradedReasons: asStringArray(row.degradedReasons ?? row.degraded_reasons),
    source: asSource(row.source),
  };
}

export function parseWorkplaneAttachedAgentsPanel(raw: unknown): WorkplaneAttachedAgentsPanel | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const workplaneId = asNullableString(row.workplaneId ?? row.workplane_id);
  if (!workplaneId) return null;
  const agentsRaw = Array.isArray(row.agents) ? row.agents : [];
  const agents = agentsRaw
    .map((item) => parseWorkplaneAttachedAgent(item))
    .filter((item): item is WorkplaneAttachedAgent => Boolean(item));
  const countsRaw = row.counts && typeof row.counts === 'object'
    ? row.counts as Record<string, unknown>
    : {};
  const num = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return {
    workplaneId,
    evaluatedAt: asNullableString(row.evaluatedAt ?? row.evaluated_at) ?? '',
    agents,
    counts: {
      total: num(countsRaw.total) || agents.length,
      live: num(countsRaw.live),
      idle: num(countsRaw.idle),
      stale: num(countsRaw.stale),
      offline: num(countsRaw.offline),
      missing: num(countsRaw.missing),
      unknown: num(countsRaw.unknown),
      degraded: num(countsRaw.degraded),
    },
  };
}

export function attachedSummary(panel: WorkplaneAttachedAgentsPanel): string {
  if (panel.counts.total === 0) {
    return 'No agents attached to this workplane yet.';
  }
  const parts: string[] = [];
  if (panel.counts.live) parts.push(`${panel.counts.live} live`);
  if (panel.counts.missing) parts.push(`${panel.counts.missing} missing`);
  if (panel.counts.stale) parts.push(`${panel.counts.stale} stale`);
  if (panel.counts.offline) parts.push(`${panel.counts.offline} offline`);
  if (panel.counts.idle) parts.push(`${panel.counts.idle} idle`);
  return parts.length > 0 ? parts.join(' · ') : `${panel.counts.total} attached`;
}

export function createInitialAttachedLoadState(): WorkplaneAttachedLoadState {
  return { status: 'idle' };
}

export function attachedBeginLoad(
  _prev: WorkplaneAttachedLoadState,
  workplaneId: string,
): WorkplaneAttachedLoadState {
  return { status: 'loading', workplaneId };
}

export function attachedFromSuccess(
  panel: WorkplaneAttachedAgentsPanel,
): WorkplaneAttachedLoadState {
  if (panel.agents.length === 0) {
    return { status: 'empty', workplaneId: panel.workplaneId, panel };
  }
  return { status: 'ready', panel };
}

export function attachedFromError(
  workplaneId: string | null,
  error: string,
): WorkplaneAttachedLoadState {
  return { status: 'error', workplaneId, error };
}

export function attachedPresenceLabel(status: AgentPresenceStatus): string {
  switch (status) {
    case 'live':
      return 'Live';
    case 'idle':
      return 'Idle';
    case 'stale':
      return 'Stale';
    case 'offline':
      return 'Offline';
    case 'unknown':
      return 'Unknown';
    case 'missing':
    default:
      return 'Missing';
  }
}

export function attachedPresenceToneClass(status: AgentPresenceStatus): string {
  switch (status) {
    case 'live':
      return 'entity-ops-chip px-2 py-1 text-[11px] text-[var(--success)]';
    case 'idle':
      return 'entity-ops-chip px-2 py-1 text-[11px] text-[var(--accent)]';
    case 'stale':
    case 'offline':
      return 'entity-ops-chip px-2 py-1 text-[11px] text-[var(--warning)]';
    case 'missing':
    case 'unknown':
    default:
      return 'entity-ops-chip px-2 py-1 text-[11px] text-[var(--text-muted)]';
  }
}
