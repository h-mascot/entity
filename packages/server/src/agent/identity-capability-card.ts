/**
 * THE-882 / WP2-B-01 — Agent identity/capability card field schema.
 *
 * Canonical plain fields for Agent Desk / invite onboarding surface (Q57):
 * identity, permissions, runtime/model, capabilities, heartbeat, current task/workplane.
 *
 * Presence values stay explicit missing/unknown until WP2-B-02 heartbeat endpoint.
 * Compatible with durable invite views from THE-879 / THE-880 / THE-881.
 */

import type { AgentCapabilityCard } from './agent-capability-card';
import type { AgentInviteStatus, ChiefRoutingMode } from './invite-kit/types';

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

/** Stable field keys for schema review + UI smoke bindings. */
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

export interface AgentIdentityCapabilityCard {
  agentId: string | null;
  agentName: string;
  role: string;
  identityLabel: string | null;
  inviteId: string | null;
  inviteStatus: AgentInviteStatus | null;
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
  chiefRoutingMode: ChiefRoutingMode | null;
  cardCompleteness: CardCompleteness;
  degradedReasons: string[];
}

export interface IdentityCapabilityInviteSource {
  id?: string | null;
  agentId?: string | null;
  agentName?: string | null;
  role?: string | null;
  status?: AgentInviteStatus | null;
  selectedBundle?: string | null;
  selectedModules?: readonly string[] | null;
  permissionsScope?: readonly string[] | null;
  workplaneId?: string | null;
  taskId?: number | null;
  providerProfileId?: string | null;
  chiefRoutingMode?: ChiefRoutingMode | null;
  progress?: readonly { status?: string | null }[] | null;
}

export interface IdentityCapabilityPresenceSource {
  agentId?: string | null;
  runtime?: string | null;
  sessionId?: string | null;
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
  /** Optional registry capability card (THE-73 era) — labels merge, never invent secrets. */
  registryCapabilities?: AgentCapabilityCard | null;
  /** Clock for stale evaluation; defaults to Date.now(). */
  nowMs?: number;
  /** Presence older than this (ms) becomes stale when status was live/idle. */
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
  if (value == null || value === '') {
    return 'missing';
  }
  if (typeof value !== 'string') {
    return 'unknown';
  }
  const normalized = value.trim().toLowerCase();
  if (isAgentPresenceStatus(normalized)) {
    return normalized;
  }
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
  if (input.taskId != null) {
    return `Task ${input.taskId}`;
  }
  if (input.workplaneId) {
    return `Workplane ${input.workplaneId}`;
  }
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
  if (status !== 'live' && status !== 'idle') {
    return status;
  }
  if (!lastSeenAt) {
    return 'unknown';
  }
  const seenMs = Date.parse(lastSeenAt);
  if (Number.isNaN(seenMs)) {
    return 'unknown';
  }
  if (nowMs - seenMs > staleAfterMs) {
    return 'stale';
  }
  return status;
}

/**
 * Build a plain identity/capability card from invite + optional presence/runtime.
 * Missing presence is explicit (`missing`), never coerced to healthy/live.
 */
export function buildAgentIdentityCapabilityCard(
  input: BuildIdentityCapabilityCardInput = {},
): AgentIdentityCapabilityCard {
  const invite = input.invite ?? null;
  const presence = input.presence ?? null;
  const runtime = input.runtime ?? null;
  const registry = input.registryCapabilities ?? null;
  const nowMs = input.nowMs ?? Date.now();
  const staleAfterMs = input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const degradedReasons: string[] = [];

  const agentName = present(invite?.agentName) ?? 'Unnamed agent';
  const role = present(invite?.role) ?? 'worker';
  const inviteId = present(invite?.id);
  const agentId = present(invite?.agentId) ?? present(presence?.agentId);

  if (!invite && !presence && !runtime && !registry) {
    degradedReasons.push('card_source_missing');
  }
  if (!inviteId && !agentId) {
    degradedReasons.push('identity_unbound');
  }

  let presenceStatus = presence
    ? normalizePresenceStatus(presence.status)
    : 'missing';
  if (!presence) {
    degradedReasons.push('presence_missing');
  } else if (presenceStatus === 'unknown') {
    degradedReasons.push('presence_unknown');
  }

  const lastSeenAt = present(presence?.lastSeenAt);
  presenceStatus = applyStaleness(presenceStatus, lastSeenAt, nowMs, staleAfterMs);
  if (presenceStatus === 'stale') {
    degradedReasons.push('presence_stale');
  }

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
    ...(registry?.capabilityLabels ?? []),
    ...(presence?.capabilities ?? []),
    ...(invite?.selectedModules ?? []),
  ]);
  const permissionLabels = uniqueLabels([
    ...(runtime?.permissionLabels ?? []),
    ...(registry?.permissionLabels ?? []),
    ...(invite?.permissionsScope ?? []),
  ]);
  const scopeLabels = uniqueLabels([
    ...(runtime?.scopeLabels ?? []),
    ...(registry?.scopeLabels ?? []),
  ]);

  const adapterType = present(runtime?.adapterType) ?? present(registry?.adapterType);
  const runtimeType =
    present(runtime?.runtimeType)
    ?? present(registry?.runtimeType)
    ?? present(presence?.runtime);
  const runtimeLabel =
    present(runtime?.runtimeLabel)
    ?? present(registry?.runtimeLabel)
    ?? (adapterType || runtimeType
      ? [adapterType, runtimeType].filter(Boolean).join(' · ')
      : null);

  if (!runtimeLabel) {
    degradedReasons.push('runtime_unbound');
  }

  const modelLabel = present(runtime?.modelLabel);
  const providerProfileId =
    present(runtime?.providerProfileId) ?? present(invite?.providerProfileId);
  if (!modelLabel && !providerProfileId) {
    degradedReasons.push('model_unbound');
  }

  const verificationLabel =
    present(runtime?.verificationLabel)
    ?? present(registry?.verificationLabel)
    ?? deriveVerificationFromInvite(invite);

  const ownerLabel = present(runtime?.ownerLabel) ?? present(registry?.ownerLabel) ?? 'Entity';
  const identityLabel =
    present(runtime?.identityLabel)
    ?? present(registry?.identityLabel)
    ?? (invite ? `${agentName} · ${role}` : null);

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
    identityLabel,
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
    verificationLabel,
    ownerLabel,
    chiefRoutingMode: invite?.chiefRoutingMode ?? null,
    cardCompleteness,
    degradedReasons: uniqueDegraded,
  };
}
