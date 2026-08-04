/**
 * THE-886 / WP2-B-05 — Workplane ASK claim/resolve client model.
 *
 * Never invents live chief presence or secret fields. CAS versions stay explicit.
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

export type WorkplaneAskLoadState =
  | { status: 'idle' }
  | { status: 'loading'; workplaneId: string }
  | { status: 'ready'; panel: WorkplaneAskPanel }
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

function asStatus(value: unknown): AskStatus {
  if (typeof value === 'string' && (ASK_STATUSES as readonly string[]).includes(value)) {
    return value as AskStatus;
  }
  return 'open';
}

function parseReasons(value: unknown): AskReason[] {
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

export function parseWorkplaneAsk(raw: unknown): WorkplaneAsk | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = asNullableString(row.id);
  const workplaneId = asNullableString(row.workplaneId ?? row.workplane_id);
  const title = asNullableString(row.title);
  if (!id || !workplaneId || !title) return null;
  return {
    id,
    workplaneId,
    taskId: asTaskId(row.taskId ?? row.task_id),
    title,
    body: asNullableString(row.body),
    status: asStatus(row.status),
    version: asNumber(row.version, 1),
    createdBy: asNullableString(row.createdBy ?? row.created_by),
    createdAt: asString(row.createdAt ?? row.created_at),
    updatedAt: asString(row.updatedAt ?? row.updated_at),
    claimantAgentId: asNullableString(row.claimantAgentId ?? row.claimant_agent_id),
    claimantAgentName: asNullableString(row.claimantAgentName ?? row.claimant_agent_name),
    claimedAt: asNullableString(row.claimedAt ?? row.claimed_at),
    claimPolicyCode: asNullableString(row.claimPolicyCode ?? row.claim_policy_code),
    resolvedBy: asNullableString(row.resolvedBy ?? row.resolved_by),
    resolvedAt: asNullableString(row.resolvedAt ?? row.resolved_at),
    resolutionNote: asNullableString(row.resolutionNote ?? row.resolution_note),
    blockedReason: asNullableString(row.blockedReason ?? row.blocked_reason),
    reasonChain: parseReasons(row.reasonChain ?? row.reason_chain),
  };
}

export function parseWorkplaneAskPanel(raw: unknown): WorkplaneAskPanel | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const workplaneId = asNullableString(row.workplaneId ?? row.workplane_id);
  if (!workplaneId) return null;
  const asks = Array.isArray(row.asks)
    ? row.asks.map(parseWorkplaneAsk).filter((ask): ask is WorkplaneAsk => Boolean(ask))
    : [];
  return {
    workplaneId,
    evaluatedAt: asString(row.evaluatedAt ?? row.evaluated_at, new Date().toISOString()),
    asks,
    openCount: asNumber(row.openCount ?? row.open_count, asks.filter((a) => a.status === 'open' || a.status === 'chief_review').length),
    claimedCount: asNumber(row.claimedCount ?? row.claimed_count, asks.filter((a) => a.status === 'claimed').length),
    resolvedCount: asNumber(row.resolvedCount ?? row.resolved_count, asks.filter((a) => a.status === 'resolved').length),
    staleCount: asNumber(row.staleCount ?? row.stale_count, asks.filter((a) => a.status === 'stale').length),
    summary: asString(row.summary, asks.length ? `${asks.length} ASK(s)` : 'No ASKs on this workplane'),
  };
}

export function createInitialAskLoadState(): WorkplaneAskLoadState {
  return { status: 'idle' };
}

export function askBeginLoad(
  _prev: WorkplaneAskLoadState,
  workplaneId: string,
): WorkplaneAskLoadState {
  return { status: 'loading', workplaneId };
}

export function askFromSuccess(panel: WorkplaneAskPanel): WorkplaneAskLoadState {
  return { status: 'ready', panel };
}

export function askFromError(
  workplaneId: string | null,
  error: string,
): WorkplaneAskLoadState {
  return { status: 'error', workplaneId, error };
}

export function askStatusLabel(status: AskStatus): string {
  switch (status) {
    case 'chief_review':
      return 'Chief review';
    case 'claimed':
      return 'Claimed';
    case 'blocked':
      return 'Blocked';
    case 'resolved':
      return 'Resolved';
    case 'stale':
      return 'Stale';
    default:
      return 'Open';
  }
}

export function askStatusToneClass(status: AskStatus): string {
  switch (status) {
    case 'resolved':
      return 'text-[var(--success)]';
    case 'blocked':
    case 'stale':
      return 'text-[var(--warning)]';
    case 'claimed':
    case 'chief_review':
      return 'text-[var(--text-secondary)]';
    default:
      return 'text-[var(--text-primary)]';
  }
}

export function askPanelSummary(panel: WorkplaneAskPanel): string {
  return panel.summary || 'No ASKs on this workplane';
}
