/**
 * THE-883 / WP2-B-02 — Workplane presence panel client model.
 *
 * Renders live / last-seen / stale / missing / degraded without inventing activity.
 */

import {
  normalizePresenceStatus,
  presenceToneClass,
  type AgentPresenceStatus,
  type CardCompleteness,
} from './agentIdentityCapabilityCard.ts';

export type PresenceSource = 'heartbeat' | 'invite_missing';

export interface WorkplanePresenceAgent {
  agentId: string;
  inviteId: string | null;
  agentName: string;
  role: string;
  presenceStatus: AgentPresenceStatus;
  lastSeenAt: string | null;
  heartbeatFreshnessLabel: string;
  currentTaskId: number | null;
  currentWorkplaneId: string | null;
  currentWorkLabel: string;
  runtime: string | null;
  sessionId: string | null;
  capabilities: string[];
  cardCompleteness: CardCompleteness;
  degradedReasons: string[];
  source: PresenceSource;
}

export interface WorkplanePresenceCounts {
  total: number;
  live: number;
  idle: number;
  stale: number;
  offline: number;
  missing: number;
  unknown: number;
  degraded: number;
}

export interface WorkplanePresencePanel {
  workplaneId: string;
  staleAfterMs: number;
  evaluatedAt: string;
  agents: WorkplanePresenceAgent[];
  counts: WorkplanePresenceCounts;
}

export type WorkplanePresenceLoadState =
  | { status: 'idle' }
  | { status: 'loading'; workplaneId: string }
  | { status: 'ready'; panel: WorkplanePresencePanel }
  | { status: 'empty'; workplaneId: string; panel: WorkplanePresencePanel }
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

function asCompleteness(value: unknown): CardCompleteness {
  if (value === 'complete' || value === 'partial' || value === 'degraded') return value;
  return 'degraded';
}

function asSource(value: unknown): PresenceSource {
  return value === 'heartbeat' ? 'heartbeat' : 'invite_missing';
}

export function parseWorkplanePresenceAgent(raw: unknown): WorkplanePresenceAgent | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const agentId = asNullableString(row.agentId ?? row.agent_id);
  const agentName = asNullableString(row.agentName ?? row.agent_name);
  if (!agentId || !agentName) return null;
  return {
    agentId,
    inviteId: asNullableString(row.inviteId ?? row.invite_id),
    agentName,
    role: asNullableString(row.role) ?? 'worker',
    presenceStatus: normalizePresenceStatus(row.presenceStatus ?? row.presence_status),
    lastSeenAt: asNullableString(row.lastSeenAt ?? row.last_seen_at),
    heartbeatFreshnessLabel:
      asNullableString(row.heartbeatFreshnessLabel ?? row.heartbeat_freshness_label)
      ?? 'No heartbeat yet',
    currentTaskId: asTaskId(row.currentTaskId ?? row.current_task_id),
    currentWorkplaneId: asNullableString(row.currentWorkplaneId ?? row.current_workplane_id),
    currentWorkLabel:
      asNullableString(row.currentWorkLabel ?? row.current_work_label)
      ?? 'No current work attached',
    runtime: asNullableString(row.runtime),
    sessionId: asNullableString(row.sessionId ?? row.session_id),
    capabilities: asStringArray(row.capabilities),
    cardCompleteness: asCompleteness(row.cardCompleteness ?? row.card_completeness),
    degradedReasons: asStringArray(row.degradedReasons ?? row.degraded_reasons),
    source: asSource(row.source),
  };
}

export function parseWorkplanePresencePanel(raw: unknown): WorkplanePresencePanel | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const workplaneId = asNullableString(row.workplaneId ?? row.workplane_id);
  if (!workplaneId) return null;
  const agentsRaw = Array.isArray(row.agents) ? row.agents : [];
  const agents = agentsRaw
    .map((item) => parseWorkplanePresenceAgent(item))
    .filter((item): item is WorkplanePresenceAgent => item != null);
  const countsRaw = row.counts && typeof row.counts === 'object'
    ? row.counts as Record<string, unknown>
    : {};
  const counts: WorkplanePresenceCounts = {
    total: typeof countsRaw.total === 'number' ? countsRaw.total : agents.length,
    live: typeof countsRaw.live === 'number' ? countsRaw.live : 0,
    idle: typeof countsRaw.idle === 'number' ? countsRaw.idle : 0,
    stale: typeof countsRaw.stale === 'number' ? countsRaw.stale : 0,
    offline: typeof countsRaw.offline === 'number' ? countsRaw.offline : 0,
    missing: typeof countsRaw.missing === 'number' ? countsRaw.missing : 0,
    unknown: typeof countsRaw.unknown === 'number' ? countsRaw.unknown : 0,
    degraded: typeof countsRaw.degraded === 'number' ? countsRaw.degraded : 0,
  };
  return {
    workplaneId,
    staleAfterMs: typeof row.staleAfterMs === 'number' ? row.staleAfterMs : 90_000,
    evaluatedAt: asNullableString(row.evaluatedAt ?? row.evaluated_at) ?? new Date(0).toISOString(),
    agents,
    counts,
  };
}

export function presenceStatusLabel(status: AgentPresenceStatus): string {
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

export function formatLastSeen(lastSeenAt: string | null | undefined): string {
  if (!lastSeenAt) return 'Never';
  const ms = Date.parse(lastSeenAt);
  if (Number.isNaN(ms)) return lastSeenAt;
  return new Date(ms).toLocaleString();
}

export function panelSummary(panel: WorkplanePresencePanel): string {
  const { counts } = panel;
  if (counts.total === 0) {
    return 'No agents bound to this workplane yet.';
  }
  const parts = [
    counts.live ? `${counts.live} live` : null,
    counts.idle ? `${counts.idle} idle` : null,
    counts.stale ? `${counts.stale} stale` : null,
    counts.offline ? `${counts.offline} offline` : null,
    counts.missing ? `${counts.missing} missing` : null,
    counts.unknown ? `${counts.unknown} unknown` : null,
  ].filter(Boolean);
  return parts.join(' · ') || `${counts.total} agent${counts.total === 1 ? '' : 's'}`;
}

export { presenceToneClass };

export function createInitialPresenceLoadState(): WorkplanePresenceLoadState {
  return { status: 'idle' };
}

export function presenceBeginLoad(
  _prev: WorkplanePresenceLoadState,
  workplaneId: string,
): WorkplanePresenceLoadState {
  return { status: 'loading', workplaneId };
}

export function presenceFromSuccess(
  panel: WorkplanePresencePanel,
): WorkplanePresenceLoadState {
  if (panel.agents.length === 0) {
    return { status: 'empty', workplaneId: panel.workplaneId, panel };
  }
  return { status: 'ready', panel };
}

export function presenceFromError(
  workplaneId: string | null,
  error: string,
): WorkplanePresenceLoadState {
  return { status: 'error', workplaneId, error };
}
