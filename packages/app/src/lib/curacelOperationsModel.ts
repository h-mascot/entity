export type CuracelPolicyArea = 'claims' | 'finance' | 'customer-communications';
export type CuracelAuditKind = 'action' | 'approval' | 'output' | 'error' | 'recovery';
export type CuracelConnectorKind = 'email' | 'gmail' | 'sms' | 'erp' | 'ticket';

export interface CuracelReviewPolicy {
  id: string;
  area: CuracelPolicyArea;
  label: string;
  reviewRequired: true;
  bypassBlocked: true;
  reviewerRoles: string[];
  updatedAt: string | null;
}

export interface CuracelAuditEvent {
  id: string;
  occurredAt: string;
  actorId: string;
  actorName: string;
  kind: CuracelAuditKind;
  action: string;
  status: string;
  summary: string;
  orgId: string;
  teamId: string;
  agentId: string;
  taskId: string;
}

export interface CuracelConnector {
  id: string;
  kind: CuracelConnectorKind;
  label: string;
  state: 'disabled';
  mode: 'draft' | 'dry-run';
  credentialReference: string;
  reviewRequired: true;
  lastDraftAt: string | null;
}

export interface CuracelTeamDashboard {
  id: string;
  name: string;
  queueOpen: number;
  queueAtRisk: number;
  approvalsPending: number;
  slaLabel: string;
  policies: string[];
  permissions: string[];
}

export interface CuracelAgentReliability {
  agentId: string;
  agentName: string;
  volume: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  averageLatencyMs: number | null;
  retryCount: number;
  muteEvents: number;
  rateLimitEvents: number;
  reviewApproved: number;
  reviewRejected: number;
  reviewPending: number;
}

export interface CuracelOperationsData {
  orgId: string;
  teamId: string;
  generatedAt: string | null;
  policies: CuracelReviewPolicy[];
  audit: CuracelAuditEvent[];
  connectors: CuracelConnector[];
  teams: CuracelTeamDashboard[];
  reliability: CuracelAgentReliability[];
}

export interface CuracelAuditFilters {
  query?: string;
  kind?: CuracelAuditKind | 'all';
  orgId?: string;
  teamId?: string;
  agentId?: string;
  taskId?: string;
}

const POLICY_DEFAULTS: Array<Pick<CuracelReviewPolicy, 'id' | 'area' | 'label' | 'reviewerRoles'>> = [
  { id: 'claims-external', area: 'claims', label: 'Claims external actions', reviewerRoles: ['Claims lead'] },
  { id: 'finance-external', area: 'finance', label: 'Finance external actions', reviewerRoles: ['Finance approver'] },
  {
    id: 'customer-communications',
    area: 'customer-communications',
    label: 'Customer communications',
    reviewerRoles: ['Customer Success lead'],
  },
];

const CONNECTOR_DEFAULTS: Array<Pick<CuracelConnector, 'id' | 'kind' | 'label' | 'mode'>> = [
  { id: 'email-draft', kind: 'email', label: 'Email draft', mode: 'draft' },
  { id: 'gmail-draft', kind: 'gmail', label: 'Gmail draft', mode: 'draft' },
  { id: 'sms-draft', kind: 'sms', label: 'SMS draft', mode: 'draft' },
  { id: 'erp-draft', kind: 'erp', label: 'ERP transaction draft', mode: 'dry-run' },
  { id: 'ticket-draft', kind: 'ticket', label: 'Ticketing draft', mode: 'dry-run' },
];

const TEAM_DEFAULTS = ['Claims', 'Customer Success', 'Finance', 'AI Ops'];
const AUDIT_KINDS = new Set<CuracelAuditKind>(['action', 'approval', 'output', 'error', 'recovery']);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function integer(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function optionalDate(value: unknown): string | null {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

function stringList(value: unknown): string[] {
  return list(value).map((item) => text(item)).filter(Boolean);
}

function policyArea(value: unknown): CuracelPolicyArea | null {
  const normalized = text(value).toLowerCase().replace(/_/g, '-');
  if (normalized.includes('claim')) return 'claims';
  if (normalized.includes('finance') || normalized.includes('financial')) return 'finance';
  if (normalized.includes('customer') || normalized.includes('external-communication')) return 'customer-communications';
  return null;
}

function connectorKind(value: unknown): CuracelConnectorKind | null {
  const normalized = text(value).toLowerCase().replace(/_/g, '-');
  if (normalized === 'email' || normalized === 'gmail' || normalized === 'sms') return normalized;
  if (normalized === 'ticketing' || normalized === 'ticket') return 'ticket';
  if (normalized === 'erp') return 'erp';
  return null;
}

function credentialReference(value: unknown, fallback: string): string {
  const candidate = text(value);
  return /^(vault|secret-ref|secret|env|aws-secretsmanager|gcp-secret|azure-keyvault):\/\/[a-z0-9_./:@-]+$/i.test(candidate)
    ? candidate
    : fallback;
}

function auditKind(value: unknown): CuracelAuditKind {
  const normalized = text(value, 'action').toLowerCase().replace(/-/g, '_');
  if (normalized === 'agent_output' || normalized === 'output') return 'output';
  return AUDIT_KINDS.has(normalized as CuracelAuditKind) ? normalized as CuracelAuditKind : 'action';
}

function displayList(value: unknown): string[] {
  const fromList = stringList(value);
  if (fromList.length) return fromList;
  const entries = Object.entries(record(value));
  return entries.map(([key, item]) => {
    if (typeof item === 'boolean') return `${key.replace(/_/g, ' ')}: ${item ? 'on' : 'off'}`;
    if (typeof item === 'string' || typeof item === 'number') return `${key.replace(/_/g, ' ')}: ${item}`;
    return key.replace(/_/g, ' ');
  });
}

function normalizePolicies(value: unknown): CuracelReviewPolicy[] {
  const supplied = new Map<CuracelPolicyArea, Record<string, unknown>>();
  for (const item of list(value)) {
    const entry = record(item);
    const area = policyArea(entry.area ?? entry.category ?? entry.action);
    if (area) supplied.set(area, entry);
  }
  return POLICY_DEFAULTS.map((fallback) => {
    const entry = supplied.get(fallback.area) ?? {};
    return {
      id: text(entry.id, fallback.id),
      area: fallback.area,
      label: text(entry.label ?? entry.name, fallback.label),
      reviewRequired: true,
      bypassBlocked: true,
      reviewerRoles: stringList(entry.reviewerRoles ?? entry.reviewer_roles).length
        ? stringList(entry.reviewerRoles ?? entry.reviewer_roles)
        : fallback.reviewerRoles,
      updatedAt: optionalDate(entry.updatedAt ?? entry.updated_at),
    };
  });
}

function normalizeAudit(value: unknown): CuracelAuditEvent[] {
  return list(value).flatMap((item, index) => {
    const entry = record(item);
    const actor = record(entry.actor);
    const kind = auditKind(entry.kind ?? entry.category ?? entry.eventType ?? entry.event_type);
    const occurredAt = optionalDate(entry.occurredAt ?? entry.occurred_at ?? entry.createdAt ?? entry.created_at);
    if (!occurredAt) return [];
    return [{
      id: text(entry.id, `audit-${index + 1}`),
      occurredAt,
      actorId: text(entry.actorId ?? entry.actor_id ?? entry.actorPrincipalId ?? entry.actor_principal_id ?? actor.id, 'system'),
      actorName: text(entry.actorName ?? entry.actor_name ?? actor.name, 'System'),
      kind,
      action: text(entry.action, kind),
      status: text(entry.status ?? entry.outcome, 'recorded'),
      summary: text(entry.summary ?? entry.message, text(record(entry.detail).summary, 'Operational event recorded.')),
      orgId: text(entry.orgId ?? entry.org_id),
      teamId: text(entry.teamId ?? entry.team_id),
      agentId: text(entry.agentId ?? entry.agent_id),
      taskId: text(entry.taskId ?? entry.task_id),
    }];
  }).sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
}

function normalizeConnectors(value: unknown): CuracelConnector[] {
  const supplied = new Map<CuracelConnectorKind, Record<string, unknown>>();
  for (const item of list(value)) {
    const entry = record(item);
    const kind = connectorKind(entry.kind ?? entry.type ?? entry.connectorType ?? entry.connector_type);
    if (kind) supplied.set(kind, entry);
  }
  return CONNECTOR_DEFAULTS.map((fallback) => {
    const entry = supplied.get(fallback.kind) ?? {};
    return {
      id: text(entry.id, fallback.id),
      kind: fallback.kind,
      label: text(entry.label ?? entry.name, fallback.label),
      state: 'disabled',
      mode: entry.mode === 'dry-run' || entry.mode === 'dry_run' ? 'dry-run' : fallback.mode,
      credentialReference: credentialReference(
        entry.credentialReference ?? entry.credential_reference ?? entry.credential_ref,
        `vault://curacel/${fallback.kind}/sandbox`,
      ),
      reviewRequired: true,
      lastDraftAt: optionalDate(entry.lastDraftAt ?? entry.last_draft_at),
    };
  });
}

function normalizeTeams(value: unknown): CuracelTeamDashboard[] {
  const supplied = new Map<string, Record<string, unknown>>();
  for (const item of list(value)) {
    const entry = record(item);
    const teamType = text(entry.teamType ?? entry.team_type).replace(/_/g, ' ');
    const name = text(entry.name, teamType);
    if (name) supplied.set(name.toLowerCase(), entry);
  }
  return TEAM_DEFAULTS.map((name) => {
    const entry = supplied.get(name.toLowerCase()) ?? {};
    const slaMinutes = integer(entry.approvalSlaMinutes ?? entry.approval_sla_minutes);
    return {
      id: text(entry.id, name.toLowerCase().replace(/\s+/g, '-')),
      name,
      queueOpen: integer(entry.queueOpen ?? entry.queue_open),
      queueAtRisk: integer(entry.queueAtRisk ?? entry.queue_at_risk),
      approvalsPending: integer(entry.approvalsPending ?? entry.approvals_pending),
      slaLabel: text(entry.slaLabel ?? entry.sla_label, slaMinutes ? `${slaMinutes} minute approval SLA` : 'No SLA sample yet'),
      policies: displayList(entry.policies),
      permissions: displayList(entry.permissions ?? entry.agentPermissions ?? entry.agent_permissions),
    };
  });
}

function normalizeReliability(value: unknown): CuracelAgentReliability[] {
  return list(value).flatMap((item) => {
    const entry = record(item);
    const agentId = text(entry.agentId ?? entry.agent_id ?? entry.id);
    if (!agentId) return [];
    const successCount = integer(entry.successCount ?? entry.success_count ?? entry.successes);
    const errorCount = integer(entry.errorCount ?? entry.error_count ?? entry.errors);
    const volume = integer(entry.volume ?? entry.requestCount ?? entry.request_count) || successCount + errorCount;
    const suppliedRate = typeof entry.successRate === 'number'
      ? entry.successRate
      : typeof entry.success_rate === 'number' ? entry.success_rate : null;
    const successRate = suppliedRate === null
      ? (volume ? successCount / volume : 0)
      : Math.min(1, Math.max(0, suppliedRate > 1 ? suppliedRate / 100 : suppliedRate));
    const latency = entry.averageLatencyMs ?? entry.average_latency_ms;
    return [{
      agentId,
      agentName: text(entry.agentName ?? entry.agent_name ?? entry.name, agentId),
      volume,
      successCount,
      errorCount,
      successRate,
      averageLatencyMs: typeof latency === 'number' && Number.isFinite(latency) ? Math.max(0, Math.round(latency)) : null,
      retryCount: integer(entry.retryCount ?? entry.retry_count ?? entry.totalRetries ?? entry.total_retries),
      muteEvents: integer(entry.muteEvents ?? entry.mute_events),
      rateLimitEvents: integer(entry.rateLimitEvents ?? entry.rate_limit_events),
      reviewApproved: integer(entry.reviewApproved ?? entry.review_approved ?? record(entry.reviewOutcomes ?? entry.review_outcomes).approved),
      reviewRejected: integer(entry.reviewRejected ?? entry.review_rejected ?? record(entry.reviewOutcomes ?? entry.review_outcomes).rejected),
      reviewPending: integer(entry.reviewPending ?? entry.review_pending ?? record(entry.reviewOutcomes ?? entry.review_outcomes).pending),
    }];
  });
}

export function normalizeCuracelOperationsData(
  payload: unknown,
  context: { orgId?: string; teamId?: string } = {},
): CuracelOperationsData {
  const root = record(payload);
  const source = record(root.operationsCenter ?? root.operations ?? root.data ?? root);
  return {
    orgId: text(source.orgId ?? source.org_id, context.orgId ?? ''),
    teamId: text(source.teamId ?? source.team_id, context.teamId ?? ''),
    generatedAt: optionalDate(source.generatedAt ?? source.generated_at),
    policies: normalizePolicies(source.policies),
    audit: normalizeAudit(source.audit ?? source.auditEvents ?? source.audit_events),
    connectors: normalizeConnectors(source.connectors),
    teams: normalizeTeams(source.teams ?? source.teamDashboards ?? source.team_dashboards),
    reliability: normalizeReliability(source.reliability ?? source.agentReliability ?? source.agent_reliability),
  };
}

export function filterCuracelAudit(
  events: CuracelAuditEvent[],
  filters: CuracelAuditFilters,
): CuracelAuditEvent[] {
  const query = text(filters.query).toLowerCase();
  return events.filter((event) => {
    if (filters.kind && filters.kind !== 'all' && event.kind !== filters.kind) return false;
    if (filters.orgId && event.orgId !== filters.orgId) return false;
    if (filters.teamId && event.teamId !== filters.teamId) return false;
    if (filters.agentId && event.agentId !== filters.agentId) return false;
    if (filters.taskId && event.taskId !== filters.taskId) return false;
    if (!query) return true;
    return [
      event.actorId,
      event.actorName,
      event.action,
      event.status,
      event.summary,
      event.agentId,
      event.taskId,
    ].some((candidate) => candidate.toLowerCase().includes(query));
  });
}
