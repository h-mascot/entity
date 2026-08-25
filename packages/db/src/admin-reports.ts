import type Database from 'better-sqlite3';
import { getEntityDatabase } from './entity-db';
import { ensureAccessTokensSchema } from './access-tokens';
import { ensurePrincipalsSchema } from './principals';
import type { ActivityFilterInput } from './index';

export interface AdminReportFilterInput extends ActivityFilterInput {
  model?: string;
  status?: 'active' | 'disabled' | 'all';
}

export interface UsageReportRow {
  actor: string;
  runs: number;
  tokens: number;
}

export interface UsageReportModelRow {
  model: string;
  runs: number;
  tokens: number;
}

export interface UsageReportDayRow {
  day: string;
  runs: number;
  tokens: number;
}

export interface UsageReportEventRow {
  event: string;
  runs: number;
  tokens: number;
}

export interface UsageReport {
  totals: {
    runs: number;
    tokens: number;
  };
  byActor: UsageReportRow[];
  byModel: UsageReportModelRow[];
  byDay: UsageReportDayRow[];
  byEvent: UsageReportEventRow[];
}

export type AuditOutcome = 'success' | 'failure' | 'observed';

export interface AuditReportEvent {
  id: number;
  orgId: string | null;
  teamId: string | null;
  actor: string;
  actorType: string;
  taskId: number | null;
  eventType: string;
  action: string;
  outcome: AuditOutcome;
  description: string;
  createdAt: string;
}

export interface AuditReportCountRow {
  label: string;
  count: number;
}

export interface AuditReport {
  totals: {
    events: number;
    successes: number;
    failures: number;
    observed: number;
  };
  events: AuditReportEvent[];
  total: number;
  byOutcome: Array<AuditReportCountRow & { label: AuditOutcome }>;
  byActor: AuditReportCountRow[];
}

export interface AccessReportGrant {
  id: string;
  role: string;
  orgId: string | null;
  teamId: string | null;
  projectId: number | null;
  sensitivityCategories: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AccessReportToken {
  id: string;
  label: string | null;
  tokenPrefix: string;
  status: 'active' | 'revoked';
  lastUsedAt: string | null;
  createdAt: string;
}

export interface AccessReportPrincipal {
  id: string;
  displayName: string;
  principalType: string;
  email: string | null;
  status: 'active' | 'disabled';
  grants: AccessReportGrant[];
  tokens: AccessReportToken[];
}

export interface AccessReportCount {
  label: string;
  count: number;
}

export interface AccessReport {
  totals: {
    principals: number;
    activePrincipals: number;
    grants: number;
    activeTokens: number;
  };
  principals: AccessReportPrincipal[];
  total: number;
  byOrg: AccessReportCount[];
  byTeam: AccessReportCount[];
  byRole: AccessReportCount[];
}

export interface AdminReportRepository {
  getUsageReport: (filters?: AdminReportFilterInput) => UsageReport;
  getAuditReport: (filters?: AdminReportFilterInput) => AuditReport;
  getAccessReport: (filters?: AdminReportFilterInput) => AccessReport;
}

const DEFAULT_REPORT_LIMIT = 100;
const MAX_REPORT_LIMIT = 200;

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function trimmed(value: unknown): string | undefined {
  const normalized = text(value).trim();
  return normalized || undefined;
}

function safeLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_REPORT_LIMIT;
  return Math.min(MAX_REPORT_LIMIT, Math.max(1, Math.floor(parsed)));
}

function safeOffset(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function safeJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

const ACTIVITY_ACTOR_SQL =
  "COALESCE(CASE WHEN activities.activity_event_payload_json IS NOT NULL " +
  "AND json_valid(activities.activity_event_payload_json) " +
  "THEN json_extract(activities.activity_event_payload_json, '$.actor_principal_id') END, " +
  "activities.agent_name, 'unknown')";

const ACTIVITY_ACTOR_TYPE_SQL =
  "COALESCE(CASE WHEN activities.activity_event_payload_json IS NOT NULL " +
  "AND json_valid(activities.activity_event_payload_json) " +
  "THEN json_extract(activities.activity_event_payload_json, '$.actor_type') END, 'unknown')";

const USAGE_ACTOR_SQL =
  "COALESCE(NULLIF(tasks.executor_principal_id, ''), NULLIF(tasks.owner_principal_id, ''), " +
  "NULLIF(tasks.created_by_principal_id, ''), 'unassigned')";

function buildActivityConditions(filters: AdminReportFilterInput): {
  sql: string;
  params: Array<string | number>;
} {
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  const orgId = trimmed(filters.orgId);
  const teamId = trimmed(filters.teamId);
  const actor = trimmed(filters.actor);
  const source = trimmed(filters.source);
  const type = trimmed(filters.type);
  const from = trimmed(filters.from);
  const to = trimmed(filters.to);

  if (orgId) {
    conditions.push('tasks.org_id = ?');
    params.push(orgId);
  }
  if (teamId) {
    conditions.push('tasks.team_id = ?');
    params.push(teamId);
  }
  if (actor) {
    conditions.push(`(${ACTIVITY_ACTOR_SQL} = ? OR activities.agent_name = ?)`);
    params.push(actor, actor);
  }
  if (source) {
    conditions.push('activities.source = ?');
    params.push(source);
  }
  if (type) {
    conditions.push('activities.type = ?');
    params.push(type);
  }
  if (typeof filters.taskId === 'number' && Number.isInteger(filters.taskId)) {
    conditions.push('activities.task_id = ?');
    params.push(filters.taskId);
  }
  if (from) {
    conditions.push("date(activities.created_at) >= date(?)");
    params.push(from);
  }
  if (to) {
    conditions.push("date(activities.created_at) <= date(?)");
    params.push(to);
  }

  return {
    sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

function buildUsageConditions(filters: AdminReportFilterInput): {
  sql: string;
  params: Array<string | number>;
} {
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  const orgId = trimmed(filters.orgId);
  const teamId = trimmed(filters.teamId);
  const actor = trimmed(filters.actor);
  const model = trimmed(filters.model);
  const from = trimmed(filters.from);
  const to = trimmed(filters.to);

  if (orgId) {
    conditions.push('tasks.org_id = ?');
    params.push(orgId);
  }
  if (teamId) {
    conditions.push('tasks.team_id = ?');
    params.push(teamId);
  }
  if (actor) {
    conditions.push(`${USAGE_ACTOR_SQL} = ?`);
    params.push(actor);
  }
  if (model) {
    conditions.push("COALESCE(NULLIF(agent_log.model, ''), 'unknown') = ?");
    params.push(model);
  }
  if (from) {
    conditions.push("date(agent_log.timestamp) >= date(?)");
    params.push(from);
  }
  if (to) {
    conditions.push("date(agent_log.timestamp) <= date(?)");
    params.push(to);
  }

  return {
    sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

function auditOutcomeSql(): string {
  return `CASE
    WHEN lower(COALESCE(activities.activity_event_type, activities.type, '') || ' ' || activities.action) LIKE '%fail%'
      OR lower(COALESCE(activities.activity_event_type, activities.type, '') || ' ' || activities.action) LIKE '%error%'
      OR lower(COALESCE(activities.activity_event_type, activities.type, '') || ' ' || activities.action) LIKE '%denied%'
      OR lower(COALESCE(activities.activity_event_type, activities.type, '') || ' ' || activities.action) LIKE '%reject%'
      OR lower(COALESCE(activities.activity_event_type, activities.type, '') || ' ' || activities.action) LIKE '%block%'
      THEN 'failure'
    WHEN lower(COALESCE(activities.activity_event_type, activities.type, '') || ' ' || activities.action) LIKE '%success%'
      OR lower(COALESCE(activities.activity_event_type, activities.type, '') || ' ' || activities.action) LIKE '%complete%'
      OR lower(COALESCE(activities.activity_event_type, activities.type, '') || ' ' || activities.action) LIKE '%approv%'
      OR lower(COALESCE(activities.activity_event_type, activities.type, '') || ' ' || activities.action) LIKE '%accept%'
      THEN 'success'
    ELSE 'observed'
  END`;
}

function buildAccessPrincipalConditions(filters: AdminReportFilterInput, principalAlias = 'p'): {
  sql: string;
  params: string[];
} {
  const conditions: string[] = [];
  const params: string[] = [];
  const actor = trimmed(filters.actor);
  const status = filters.status && filters.status !== 'all' ? filters.status : undefined;

  if (actor) {
    conditions.push(`(${principalAlias}.id = ? OR ${principalAlias}.handle = ? OR lower(${principalAlias}.display_name) LIKE lower(?) OR lower(COALESCE(${principalAlias}.email, '')) LIKE lower(?))`);
    params.push(actor, actor, `%${actor}%`, `%${actor}%`);
  }
  if (status) {
    conditions.push(`${principalAlias}.status = ?`);
    params.push(status);
  }

  return { sql: conditions.join(' AND '), params };
}

function buildGrantScopeConditions(filters: AdminReportFilterInput, grantAlias = 'g'): {
  sql: string;
  params: string[];
} {
  const conditions: string[] = [];
  const params: string[] = [];
  const orgId = trimmed(filters.orgId);
  const teamId = trimmed(filters.teamId);

  if (orgId) {
    conditions.push(`(${grantAlias}.org_id = ? OR (${grantAlias}.org_id IS NULL AND ${grantAlias}.role = 'admin'))`);
    params.push(orgId);
  }
  if (teamId) {
    conditions.push(`(${grantAlias}.team_id = ? OR ${grantAlias}.team_id IS NULL)`);
    params.push(teamId);
  }

  return { sql: conditions.join(' AND '), params };
}

function grantScopeWhere(filters: AdminReportFilterInput, principalAlias = 'p', grantAlias = 'g'): {
  sql: string;
  params: string[];
} {
  const principal = buildAccessPrincipalConditions(filters, principalAlias);
  const grant = buildGrantScopeConditions(filters, grantAlias);
  const conditions = [principal.sql, grant.sql].filter(Boolean);
  return { sql: conditions.join(' AND '), params: [...principal.params, ...grant.params] };
}

function mapAuditEvent(row: Record<string, unknown>): AuditReportEvent {
  const payload = safeJsonObject(row.activity_event_payload_json);
  const actor = text(row.actor, 'unknown') || 'unknown';
  const actorType = text(row.actor_type, 'unknown') || 'unknown';
  const outcome = row.outcome === 'success' || row.outcome === 'failure' ? row.outcome : 'observed';
  return {
    id: Number(row.id),
    orgId: row.org_id == null ? null : text(row.org_id),
    teamId: row.team_id == null ? null : text(row.team_id),
    actor,
    actorType,
    taskId: row.task_id == null ? null : Number(row.task_id),
    eventType: text(row.event_type, 'legacy_event_observed'),
    action: text(row.action),
    outcome,
    description: text(row.description),
    createdAt: text(row.created_at),
    ...(Object.keys(payload).length === 0 ? {} : {}),
  };
}

function mapAccessGrant(row: Record<string, unknown>): AccessReportGrant {
  return {
    id: text(row.id),
    role: text(row.role),
    orgId: row.org_id == null ? null : text(row.org_id),
    teamId: row.team_id == null ? null : text(row.team_id),
    projectId: row.project_id == null ? null : Number(row.project_id),
    sensitivityCategories: safeStringArray(
      (() => {
        try {
          return JSON.parse(text(row.sensitivity_categories_json, '[]')) as unknown;
        } catch {
          return [];
        }
      })(),
    ),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function mapAccessToken(row: Record<string, unknown>): AccessReportToken {
  return {
    id: text(row.id),
    label: row.label == null ? null : text(row.label),
    tokenPrefix: text(row.token_prefix),
    status: row.status === 'revoked' ? 'revoked' : 'active',
    lastUsedAt: row.last_used_at == null ? null : text(row.last_used_at),
    createdAt: text(row.created_at),
  };
}

function mapPrincipal(row: Record<string, unknown>, grants: AccessReportGrant[], tokens: AccessReportToken[]): AccessReportPrincipal {
  return {
    id: text(row.id),
    displayName: text(row.display_name),
    principalType: text(row.principal_type),
    email: row.email == null ? null : text(row.email),
    status: row.status === 'disabled' ? 'disabled' : 'active',
    grants,
    tokens,
  };
}

export function ensureAdminReportsSchema(db: Database.Database): void {
  ensurePrincipalsSchema(db);
  ensureAccessTokensSchema(db);
}

export function createAdminReportRepository(database?: Database.Database): AdminReportRepository {
  const db = database ?? getEntityDatabase();
  ensureAdminReportsSchema(db);

  return {
    getUsageReport(filters: AdminReportFilterInput = {}): UsageReport {
      const { sql, params } = buildUsageConditions(filters);
      const total = db.prepare(`
        SELECT COUNT(*) AS runs, COALESCE(SUM(agent_log.tokens_used), 0) AS tokens
        FROM agent_log
        LEFT JOIN tasks ON agent_log.task_id = tasks.id
        ${sql}
      `).get(...params) as Record<string, unknown>;
      const grouped = <T extends string>(projection: string, label: T): Array<Record<T, string> & { runs: number; tokens: number }> => db.prepare(`
        SELECT ${projection} AS label, COUNT(*) AS runs, COALESCE(SUM(agent_log.tokens_used), 0) AS tokens
        FROM agent_log
        LEFT JOIN tasks ON agent_log.task_id = tasks.id
        ${sql}
        GROUP BY label
        ORDER BY runs DESC, label ASC
      `).all(...params).map((row) => ({
        [label]: text((row as Record<string, unknown>).label, 'unknown') || 'unknown',
        runs: Number((row as Record<string, unknown>).runs ?? 0),
        tokens: Number((row as Record<string, unknown>).tokens ?? 0),
      } as Record<T, string> & { runs: number; tokens: number }));

      return {
        totals: {
          runs: Number(total.runs ?? 0),
          tokens: Number(total.tokens ?? 0),
        },
        byActor: grouped(USAGE_ACTOR_SQL, 'actor'),
        byModel: grouped("COALESCE(NULLIF(agent_log.model, ''), 'unknown')", 'model'),
        byDay: grouped("date(agent_log.timestamp)", 'day'),
        byEvent: grouped("COALESCE(NULLIF(agent_log.event, ''), 'unknown')", 'event'),
      };
    },

    getAuditReport(filters: AdminReportFilterInput = {}): AuditReport {
      const { sql, params } = buildActivityConditions(filters);
      const outcomeSql = auditOutcomeSql();
      const totalRow = db.prepare(`
        SELECT COUNT(*) AS events,
          SUM(CASE WHEN ${outcomeSql} = 'success' THEN 1 ELSE 0 END) AS successes,
          SUM(CASE WHEN ${outcomeSql} = 'failure' THEN 1 ELSE 0 END) AS failures,
          SUM(CASE WHEN ${outcomeSql} = 'observed' THEN 1 ELSE 0 END) AS observed
        FROM activities
        LEFT JOIN tasks ON activities.task_id = tasks.id
        ${sql}
      `).get(...params) as Record<string, unknown>;
      const events = db.prepare(`
        SELECT activities.id, tasks.org_id, tasks.team_id,
          ${ACTIVITY_ACTOR_SQL} AS actor,
          ${ACTIVITY_ACTOR_TYPE_SQL} AS actor_type,
          activities.task_id,
          COALESCE(activities.activity_event_type, activities.type, 'legacy_event_observed') AS event_type,
          activities.action, ${outcomeSql} AS outcome, activities.description, activities.created_at,
          activities.activity_event_payload_json
        FROM activities
        LEFT JOIN tasks ON activities.task_id = tasks.id
        ${sql}
        ORDER BY datetime(activities.created_at) DESC, activities.id DESC
        LIMIT ? OFFSET ?
      `).all(...params, safeLimit(filters.limit), safeOffset(filters.offset)) as Array<Record<string, unknown>>;
      const byOutcome = db.prepare(`
        SELECT ${outcomeSql} AS label, COUNT(*) AS count
        FROM activities
        LEFT JOIN tasks ON activities.task_id = tasks.id
        ${sql}
        GROUP BY label
        ORDER BY count DESC, label ASC
      `).all(...params).map((row) => ({
        label: text((row as Record<string, unknown>).label, 'observed') as AuditOutcome,
        count: Number((row as Record<string, unknown>).count ?? 0),
      }));
      const byActor = db.prepare(`
        SELECT ${ACTIVITY_ACTOR_SQL} AS label, COUNT(*) AS count
        FROM activities
        LEFT JOIN tasks ON activities.task_id = tasks.id
        ${sql}
        GROUP BY label
        ORDER BY count DESC, label ASC
      `).all(...params).map((row) => ({
        label: text((row as Record<string, unknown>).label, 'unknown') || 'unknown',
        count: Number((row as Record<string, unknown>).count ?? 0),
      }));

      return {
        totals: {
          events: Number(totalRow.events ?? 0),
          successes: Number(totalRow.successes ?? 0),
          failures: Number(totalRow.failures ?? 0),
          observed: Number(totalRow.observed ?? 0),
        },
        events: events.map(mapAuditEvent),
        total: Number(totalRow.events ?? 0),
        byOutcome,
        byActor,
      };
    },

    getAccessReport(filters: AdminReportFilterInput = {}): AccessReport {
      const principal = buildAccessPrincipalConditions(filters);
      const grantScope = buildGrantScopeConditions(filters);
      const principalScopeWhere = [principal.sql, grantScope.sql].filter(Boolean).join(' AND ');
      const principalScopeParams = [...principal.params, ...grantScope.params];
      const scopeExists = grantScope.sql
        ? `EXISTS (SELECT 1 FROM principal_grants scoped_grant WHERE scoped_grant.principal_id = p.id AND ${buildGrantScopeConditions(filters, 'scoped_grant').sql})`
        : '';
      const scopeExistsParams = grantScope.sql ? buildGrantScopeConditions(filters, 'scoped_grant').params : [];
      const principalWhere = [principal.sql, scopeExists].filter(Boolean).join(' AND ');
      const principalParams = [...principal.params, ...scopeExistsParams];

      const totalRow = db.prepare(`
        SELECT COUNT(*) AS principals,
          SUM(CASE WHEN p.status = 'active' THEN 1 ELSE 0 END) AS active_principals
        FROM entity_principals p
        ${principalWhere ? `WHERE ${principalWhere}` : ''}
      `).get(...principalParams) as Record<string, unknown>;
      const grantTotalRow = db.prepare(`
        SELECT COUNT(*) AS grants
        FROM principal_grants g
        INNER JOIN entity_principals p ON p.id = g.principal_id
        ${principalScopeWhere ? `WHERE ${principalScopeWhere}` : ''}
      `).get(...principalScopeParams) as Record<string, unknown>;
      const tokenWhere = [principal.sql, grantScope.sql ? `EXISTS (SELECT 1 FROM principal_grants scoped_grant WHERE scoped_grant.principal_id = p.id AND ${buildGrantScopeConditions(filters, 'scoped_grant').sql})` : ''].filter(Boolean).join(' AND ');
      const tokenParams = [...principal.params, ...scopeExistsParams];
      const tokenTotalRow = db.prepare(`
        SELECT COUNT(*) AS active_tokens
        FROM entity_access_tokens token
        INNER JOIN entity_principals p ON p.id = token.principal_id
        ${tokenWhere ? `WHERE ${tokenWhere} AND token.status = 'active'` : "WHERE token.status = 'active'"}
      `).get(...tokenParams) as Record<string, unknown>;

      const rows = db.prepare(`
        SELECT p.*
        FROM entity_principals p
        ${principalWhere ? `WHERE ${principalWhere}` : ''}
        ORDER BY p.display_name COLLATE NOCASE ASC, p.id ASC
        LIMIT ? OFFSET ?
      `).all(...principalParams, safeLimit(filters.limit), safeOffset(filters.offset)) as Array<Record<string, unknown>>;

      const principals = rows.map((row) => {
        const grantConditions = buildGrantScopeConditions(filters);
        const grants = db.prepare(`
          SELECT g.*
          FROM principal_grants g
          WHERE g.principal_id = ?${grantConditions.sql ? ` AND ${grantConditions.sql}` : ''}
          ORDER BY g.created_at ASC, g.id ASC
        `).all(row.id, ...grantConditions.params) as Array<Record<string, unknown>>;
        const tokens = db.prepare(`
          SELECT id, label, token_prefix, status, last_used_at, created_at
          FROM entity_access_tokens
          WHERE principal_id = ?
          ORDER BY created_at DESC, id DESC
        `).all(row.id) as Array<Record<string, unknown>>;
        return mapPrincipal(row, grants.map(mapAccessGrant), tokens.map(mapAccessToken));
      });

      const aggregateWhere = principalScopeWhere ? `WHERE ${principalScopeWhere}` : '';
      const byRole = db.prepare(`
        SELECT g.role AS label, COUNT(*) AS count
        FROM principal_grants g
        INNER JOIN entity_principals p ON p.id = g.principal_id
        ${aggregateWhere}
        GROUP BY g.role
        ORDER BY count DESC, label ASC
      `).all(...principalScopeParams).map((row) => ({
        label: text((row as Record<string, unknown>).label),
        count: Number((row as Record<string, unknown>).count ?? 0),
      }));
      const byOrg = db.prepare(`
        SELECT COALESCE(g.org_id, 'global') AS label, COUNT(*) AS count
        FROM principal_grants g
        INNER JOIN entity_principals p ON p.id = g.principal_id
        ${aggregateWhere}
        GROUP BY label
        ORDER BY count DESC, label ASC
      `).all(...principalScopeParams).map((row) => ({
        label: text((row as Record<string, unknown>).label),
        count: Number((row as Record<string, unknown>).count ?? 0),
      }));
      const byTeam = db.prepare(`
        SELECT COALESCE(g.team_id, 'org-wide') AS label, COUNT(*) AS count
        FROM principal_grants g
        INNER JOIN entity_principals p ON p.id = g.principal_id
        ${aggregateWhere}
        GROUP BY label
        ORDER BY count DESC, label ASC
      `).all(...principalScopeParams).map((row) => ({
        label: text((row as Record<string, unknown>).label),
        count: Number((row as Record<string, unknown>).count ?? 0),
      }));

      return {
        totals: {
          principals: Number(totalRow.principals ?? 0),
          activePrincipals: Number(totalRow.active_principals ?? 0),
          grants: Number(grantTotalRow.grants ?? 0),
          activeTokens: Number(tokenTotalRow.active_tokens ?? 0),
        },
        principals,
        total: Number(totalRow.principals ?? 0),
        byOrg,
        byTeam,
        byRole,
      };
    },
  };
}
