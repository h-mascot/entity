/**
 * THE-882 / WP2-B-01 — Client identity/capability card field model.
 *
 * Mirrors server schema for Agent Desk UI smoke. Presence stays explicit
 * missing/unknown until WP2-B-02 heartbeat endpoint lands.
 */

export const AGENT_PRESENCE_STATUSES = [
  'live',
  'idle',
  'stale',
  'offline',
  'unknown',
  'missing',
] as const;

export type AgentPresenceStatus = (typeof AGENT_PRESENCE_STATUSES)[number];

export const CARD_COMPLETENESS_STATES = ['complete', 'partial', 'degraded'] as const;
export type CardCompleteness = (typeof CARD_COMPLETENESS_STATES)[number];

export const AGENT_IDENTITY_CAPABILITY_CARD_FIELDS = [
  'agentId',
  'agentName',
  'role',
  'identityLabel',
  'inviteId',
  'inviteStatus',
  'capabilityLabels',
  'permissionLabels',
  'scopeLabels',
  'selectedModules',
  'selectedBundle',
  'runtimeLabel',
  'adapterType',
  'runtimeType',
  'modelLabel',
  'providerProfileId',
  'presenceStatus',
  'lastSeenAt',
  'heartbeatFreshnessLabel',
  'currentTaskId',
  'currentWorkplaneId',
  'currentWorkLabel',
  'verificationLabel',
  'ownerLabel',
  'chiefRoutingMode',
  'cardCompleteness',
  'degradedReasons',
] as const;

export type AgentIdentityCapabilityCardField =
  (typeof AGENT_IDENTITY_CAPABILITY_CARD_FIELDS)[number];

export type InviteStatusForCard =
  | 'created'
  | 'opened'
  | 'in_progress'
  | 'completed'
  | 'expired'
  | 'revoked';

export interface AgentIdentityCapabilityCard {
  agentId: string | null;
  agentName: string;
  role: string;
  identityLabel: string | null;
  inviteId: string | null;
  inviteStatus: InviteStatusForCard | null;
  capabilityLabels: string[];
  permissionLabels: string[];
  scopeLabels: string[];
  selectedModules: string[];
  selectedBundle: string | null;
  runtimeLabel: string | null;
  adapterType: string | null;
  runtimeType: string | null;
  modelLabel: string | null;
  providerProfileId: string | null;
  presenceStatus: AgentPresenceStatus;
  lastSeenAt: string | null;
  heartbeatFreshnessLabel: string;
  currentTaskId: number | null;
  currentWorkplaneId: string | null;
  currentWorkLabel: string;
  verificationLabel: string | null;
  ownerLabel: string | null;
  chiefRoutingMode: 'none' | 'chief' | 'worker' | null;
  cardCompleteness: CardCompleteness;
  degradedReasons: string[];
}

export interface IdentityCapabilityInviteSource {
  id?: string | null;
  agentId?: string | null;
  agentName?: string | null;
  role?: string | null;
  status?: InviteStatusForCard | null;
  selectedBundle?: string | null;
  selectedModules?: readonly string[] | null;
  permissionsScope?: readonly string[] | null;
  workplaneId?: string | null;
  taskId?: number | null;
  providerProfileId?: string | null;
  chiefRoutingMode?: 'none' | 'chief' | 'worker' | null;
  progress?: readonly { status?: string | null }[] | null;
}

export interface IdentityCapabilityPresenceSource {
  agentId?: string | null;
  runtime?: string | null;
  currentTaskId?: number | null;
  currentWorkplaneId?: string | null;
  status?: string | null;
  lastSeenAt?: string | null;
  capabilities?: readonly string[] | null;
}

export interface IdentityCapabilityRuntimeSource {
  adapterType?: string | null;
  runtimeType?: string | null;
  runtimeLabel?: string | null;
  modelLabel?: string | null;
  providerProfileId?: string | null;
  ownerLabel?: string | null;
  verificationLabel?: string | null;
  identityLabel?: string | null;
  capabilityLabels?: readonly string[] | null;
  permissionLabels?: readonly string[] | null;
  scopeLabels?: readonly string[] | null;
}

export interface BuildIdentityCapabilityCardInput {
  invite?: IdentityCapabilityInviteSource | null;
  presence?: IdentityCapabilityPresenceSource | null;
  runtime?: IdentityCapabilityRuntimeSource | null;
  nowMs?: number;
  staleAfterMs?: number;
}

const DEFAULT_STALE_AFTER_MS = 90_000;

function present(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function uniqueLabels(values: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const label = present(value);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

export function isAgentPresenceStatus(value: unknown): value is AgentPresenceStatus {
  return typeof value === 'string'
    && (AGENT_PRESENCE_STATUSES as readonly string[]).includes(value);
}

export function normalizePresenceStatus(value: unknown): AgentPresenceStatus {
  if (value == null || value === '') return 'missing';
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.trim().toLowerCase();
  if (isAgentPresenceStatus(normalized)) return normalized;
  return 'unknown';
}

function deriveHeartbeatFreshness(
  status: AgentPresenceStatus,
  lastSeenAt: string | null,
): string {
  switch (status) {
    case 'live':
      return lastSeenAt ? `Live · last seen ${lastSeenAt}` : 'Live';
    case 'idle':
      return lastSeenAt ? `Idle · last seen ${lastSeenAt}` : 'Idle';
    case 'stale':
      return lastSeenAt ? `Stale · last seen ${lastSeenAt}` : 'Stale';
    case 'offline':
      return lastSeenAt ? `Offline · last seen ${lastSeenAt}` : 'Offline';
    case 'unknown':
      return 'Presence unknown';
    case 'missing':
    default:
      return 'No heartbeat yet';
  }
}

function deriveCurrentWorkLabel(input: {
  taskId: number | null;
  workplaneId: string | null;
}): string {
  if (input.taskId != null && input.workplaneId) {
    return `Task ${input.taskId} · Workplane ${input.workplaneId}`;
  }
  if (input.taskId != null) return `Task ${input.taskId}`;
  if (input.workplaneId) return `Workplane ${input.workplaneId}`;
  return 'No current work attached';
}

function deriveVerificationFromInvite(
  invite: IdentityCapabilityInviteSource | null | undefined,
): string | null {
  if (!invite) return null;
  const progress = invite.progress ?? [];
  if (progress.length === 0) {
    return invite.status ? `Invite ${invite.status}` : null;
  }
  const done = progress.filter((step) => step?.status === 'done').length;
  const errored = progress.filter((step) => step?.status === 'error').length;
  if (errored > 0) {
    return `Verification degraded · ${errored} error${errored === 1 ? '' : 's'}`;
  }
  return `Verification ${done}/${progress.length} done`;
}

function applyStaleness(
  status: AgentPresenceStatus,
  lastSeenAt: string | null,
  nowMs: number,
  staleAfterMs: number,
): AgentPresenceStatus {
  if (status !== 'live' && status !== 'idle') return status;
  if (!lastSeenAt) return 'unknown';
  const seenMs = Date.parse(lastSeenAt);
  if (Number.isNaN(seenMs)) return 'unknown';
  if (nowMs - seenMs > staleAfterMs) return 'stale';
  return status;
}

export function buildAgentIdentityCapabilityCard(
  input: BuildIdentityCapabilityCardInput = {},
): AgentIdentityCapabilityCard {
  const invite = input.invite ?? null;
  const presence = input.presence ?? null;
  const runtime = input.runtime ?? null;
  const nowMs = input.nowMs ?? Date.now();
  const staleAfterMs = input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const degradedReasons: string[] = [];

  const agentName = present(invite?.agentName) ?? 'Unnamed agent';
  const role = present(invite?.role) ?? 'worker';
  const inviteId = present(invite?.id);
  const agentId = present(invite?.agentId) ?? present(presence?.agentId);

  if (!invite && !presence && !runtime) degradedReasons.push('card_source_missing');
  if (!inviteId && !agentId) degradedReasons.push('identity_unbound');

  let presenceStatus = presence ? normalizePresenceStatus(presence.status) : 'missing';
  if (!presence) degradedReasons.push('presence_missing');
  else if (presenceStatus === 'unknown') degradedReasons.push('presence_unknown');

  const lastSeenAt = present(presence?.lastSeenAt);
  presenceStatus = applyStaleness(presenceStatus, lastSeenAt, nowMs, staleAfterMs);
  if (presenceStatus === 'stale') degradedReasons.push('presence_stale');

  const currentTaskId =
    presence?.currentTaskId != null && Number.isFinite(presence.currentTaskId)
      ? Number(presence.currentTaskId)
      : invite?.taskId != null && Number.isFinite(invite.taskId)
        ? Number(invite.taskId)
        : null;
  const currentWorkplaneId =
    present(presence?.currentWorkplaneId) ?? present(invite?.workplaneId);
  if (currentTaskId == null && !currentWorkplaneId) {
    degradedReasons.push('current_work_unattached');
  }

  const capabilityLabels = uniqueLabels([
    ...(runtime?.capabilityLabels ?? []),
    ...(presence?.capabilities ?? []),
    ...(invite?.selectedModules ?? []),
  ]);
  const permissionLabels = uniqueLabels([
    ...(runtime?.permissionLabels ?? []),
    ...(invite?.permissionsScope ?? []),
  ]);
  const scopeLabels = uniqueLabels(runtime?.scopeLabels ?? []);

  const adapterType = present(runtime?.adapterType);
  const runtimeType = present(runtime?.runtimeType) ?? present(presence?.runtime);
  const runtimeLabel =
    present(runtime?.runtimeLabel)
    ?? (adapterType || runtimeType
      ? [adapterType, runtimeType].filter(Boolean).join(' · ')
      : null);
  if (!runtimeLabel) degradedReasons.push('runtime_unbound');

  const modelLabel = present(runtime?.modelLabel);
  const providerProfileId =
    present(runtime?.providerProfileId) ?? present(invite?.providerProfileId);
  if (!modelLabel && !providerProfileId) degradedReasons.push('model_unbound');

  const uniqueDegraded = uniqueLabels(degradedReasons);
  let cardCompleteness: CardCompleteness = 'complete';
  if (uniqueDegraded.length > 0) {
    cardCompleteness = uniqueDegraded.includes('card_source_missing')
      || uniqueDegraded.includes('identity_unbound')
      ? 'degraded'
      : 'partial';
  }

  return {
    agentId,
    agentName,
    role,
    identityLabel: present(runtime?.identityLabel) ?? (invite ? `${agentName} · ${role}` : null),
    inviteId,
    inviteStatus: invite?.status ?? null,
    capabilityLabels,
    permissionLabels,
    scopeLabels,
    selectedModules: uniqueLabels(invite?.selectedModules ?? []),
    selectedBundle: present(invite?.selectedBundle),
    runtimeLabel,
    adapterType,
    runtimeType,
    modelLabel,
    providerProfileId,
    presenceStatus,
    lastSeenAt,
    heartbeatFreshnessLabel: deriveHeartbeatFreshness(presenceStatus, lastSeenAt),
    currentTaskId,
    currentWorkplaneId,
    currentWorkLabel: deriveCurrentWorkLabel({
      taskId: currentTaskId,
      workplaneId: currentWorkplaneId,
    }),
    verificationLabel:
      present(runtime?.verificationLabel) ?? deriveVerificationFromInvite(invite),
    ownerLabel: present(runtime?.ownerLabel) ?? 'Entity',
    chiefRoutingMode: invite?.chiefRoutingMode ?? null,
    cardCompleteness,
    degradedReasons: uniqueDegraded,
  };
}

export function presenceToneClass(status: AgentPresenceStatus): string {
  switch (status) {
    case 'live':
      return 'text-[var(--success)]';
    case 'idle':
      return 'text-[var(--accent)]';
    case 'stale':
    case 'offline':
    case 'unknown':
    case 'missing':
    default:
      return 'text-[var(--text-secondary)]';
  }
}

export function completenessLabel(value: CardCompleteness): string {
  switch (value) {
    case 'complete':
      return 'Complete';
    case 'partial':
      return 'Partial';
    case 'degraded':
      return 'Degraded';
    default:
      return 'Unknown';
  }
}
