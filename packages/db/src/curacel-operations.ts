import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getEntityDatabase } from './entity-db';

export const CURACEL_CONNECTOR_TYPES = ['email', 'gmail', 'sms', 'erp', 'ticket'] as const;
export const CURACEL_TEAM_TYPES = ['claims', 'customer_success', 'finance', 'ai_ops'] as const;
export const CURACEL_AUDIT_CATEGORIES = ['action', 'approval', 'agent_output', 'error', 'recovery'] as const;
export const CURACEL_REVIEW_OUTCOMES = ['approved', 'rejected', 'pending', 'not_required'] as const;
export type CuracelConnectorType = (typeof CURACEL_CONNECTOR_TYPES)[number];
export type CuracelTeamType = (typeof CURACEL_TEAM_TYPES)[number];
export type CuracelAuditCategory = (typeof CURACEL_AUDIT_CATEGORIES)[number];
export type CuracelReviewOutcome = (typeof CURACEL_REVIEW_OUTCOMES)[number];

export interface CuracelReviewPolicy {
  id: string;
  org_id: string;
  team_id: string | null;
  action: string;
  review_required: boolean;
  approver_roles: string[];
  actor_principal_id: string;
  created_at: string;
  updated_at: string;
}

export interface ResolvedCuracelReviewPolicy extends Omit<CuracelReviewPolicy, 'id' | 'actor_principal_id' | 'created_at' | 'updated_at'> {
  id: string | null;
  source: 'team_policy' | 'org_policy' | 'protected_default' | 'default';
}

export interface CuracelConnector {
  id: string;
  org_id: string;
  team_id: string | null;
  type: CuracelConnectorType;
  name: string;
  credential_ref: string;
  enabled: false;
  mode: 'dry_run';
  review_required: true;
  actor_principal_id: string;
  created_at: string;
  updated_at: string;
}

export interface CuracelConnectorDraft {
  id: string;
  org_id: string;
  connector_id: string;
  actor_principal_id: string;
  idempotency_key: string;
  target_ref: string;
  payload: Record<string, unknown>;
  state: 'pending_review';
  review_required: true;
  delivery_attempted: false;
  created_at: string;
}

export interface CuracelAuditRecord {
  id: string;
  org_id: string;
  team_id: string | null;
  agent_id: string | null;
  task_id: number | null;
  actor_principal_id: string;
  category: CuracelAuditCategory;
  action: string;
  outcome: string;
  detail: Record<string, unknown>;
  idempotency_key: string | null;
  created_at: string;
}

export interface CuracelExecutionSample {
  id: string;
  org_id: string;
  team_id: string | null;
  agent_id: string;
  task_id: number | null;
  outcome: 'success' | 'error';
  latency_ms: number;
  retries: number;
  muted: boolean;
  rate_limited: boolean;
  review_outcome: CuracelReviewOutcome;
  created_at: string;
}

export interface CuracelUsageAggregate {
  agent_id: string;
  team_id: string | null;
  volume: number;
  successes: number;
  errors: number;
  success_rate: number;
  error_rate: number;
  average_latency_ms: number;
  total_retries: number;
  mute_events: number;
  rate_limit_events: number;
  review_outcomes: Record<CuracelReviewOutcome, number>;
}

export interface CuracelTeamDashboard {
  id: string;
  org_id: string;
  team_id: string;
  team_type: CuracelTeamType;
  queue_label: string;
  approval_sla_minutes: number;
  policies: Record<string, unknown>;
  agent_permissions: string[];
  actor_principal_id: string;
  created_at: string;
  updated_at: string;
}

function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS curacel_review_policies (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, team_id TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL, review_required INTEGER NOT NULL CHECK(review_required IN (0,1)),
      approver_roles_json TEXT NOT NULL, actor_principal_id TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(org_id, team_id, action)
    );
    CREATE INDEX IF NOT EXISTS idx_curacel_review_policy_org ON curacel_review_policies(org_id, team_id);
    CREATE TABLE IF NOT EXISTS curacel_connectors (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, team_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL, name TEXT NOT NULL, credential_ref TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled = 0),
      mode TEXT NOT NULL DEFAULT 'dry_run' CHECK(mode = 'dry_run'),
      review_required INTEGER NOT NULL DEFAULT 1 CHECK(review_required = 1),
      actor_principal_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(org_id, team_id, type, name)
    );
    CREATE INDEX IF NOT EXISTS idx_curacel_connectors_org ON curacel_connectors(org_id, team_id);
    CREATE TABLE IF NOT EXISTS curacel_connector_drafts (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, connector_id TEXT NOT NULL REFERENCES curacel_connectors(id) ON DELETE CASCADE,
      actor_principal_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, target_ref TEXT NOT NULL,
      payload_json TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending_review' CHECK(state = 'pending_review'),
      review_required INTEGER NOT NULL DEFAULT 1 CHECK(review_required = 1),
      delivery_attempted INTEGER NOT NULL DEFAULT 0 CHECK(delivery_attempted = 0),
      created_at TEXT NOT NULL, UNIQUE(org_id, idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS curacel_operational_audit (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, team_id TEXT, agent_id TEXT, task_id INTEGER,
      actor_principal_id TEXT NOT NULL, category TEXT NOT NULL, action TEXT NOT NULL,
      outcome TEXT NOT NULL, detail_json TEXT NOT NULL, idempotency_key TEXT, created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_curacel_audit_idempotency
      ON curacel_operational_audit(org_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_curacel_audit_filters
      ON curacel_operational_audit(org_id, team_id, agent_id, task_id, created_at);
    CREATE TABLE IF NOT EXISTS curacel_execution_samples (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, team_id TEXT, agent_id TEXT NOT NULL, task_id INTEGER,
      outcome TEXT NOT NULL CHECK(outcome IN ('success','error')), latency_ms INTEGER NOT NULL CHECK(latency_ms >= 0),
      retries INTEGER NOT NULL CHECK(retries >= 0), muted INTEGER NOT NULL CHECK(muted IN (0,1)),
      rate_limited INTEGER NOT NULL CHECK(rate_limited IN (0,1)), review_outcome TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_curacel_execution_report
      ON curacel_execution_samples(org_id, team_id, agent_id, created_at);
    CREATE TABLE IF NOT EXISTS curacel_team_dashboards (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, team_id TEXT NOT NULL, team_type TEXT NOT NULL,
      queue_label TEXT NOT NULL, approval_sla_minutes INTEGER NOT NULL CHECK(approval_sla_minutes > 0),
      policies_json TEXT NOT NULL, agent_permissions_json TEXT NOT NULL, actor_principal_id TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(org_id, team_id)
    );
    CREATE INDEX IF NOT EXISTS idx_curacel_dashboards_org ON curacel_team_dashboards(org_id);
  `);
}

function required(value: unknown, field: string, max = 240): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${field} is too long`);
  return normalized;
}

function optional(value: unknown, field: string): string | null {
  if (value == null || value === '') return null;
  return required(value, field);
}

function integer(value: unknown, field: string, minimum = 0): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`${field} must be an integer of at least ${minimum}`);
  return parsed;
}

function jsonObject(value: unknown, field: string): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
  JSON.stringify(value);
  return value as Record<string, unknown>;
}

function rejectRawCredentials(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(rejectRawCredentials);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/(?:api[_-]?key|password|secret|access[_-]?token|authorization)/i.test(key)) {
      throw new Error('draft payload cannot contain raw credentials');
    }
    rejectRawCredentials(child);
  }
}

function stringArray(value: unknown, field: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return [...new Set(value.map((item) => required(item, field)))];
}

function parseObject(value: unknown): Record<string, unknown> {
  return JSON.parse(String(value)) as Record<string, unknown>;
}

function parseStrings(value: unknown): string[] {
  return JSON.parse(String(value)) as string[];
}

function isProtectedAction(action: string): boolean {
  const value = action.toLowerCase().replace(/[-\s]+/g, '_');
  return value.includes('claim') || value.includes('finance') || value.includes('financial')
    || value.includes('customer') || value.includes('external_communication');
}

function credentialReference(value: unknown): string {
  const ref = required(value, 'credential reference', 500);
  if (!/^(?:vault|secret|env|aws-secretsmanager|gcp-secret|azure-keyvault):\/\/[A-Za-z0-9_./:@-]+$/.test(ref)) {
    throw new Error('credential reference must be a scoped secret-store reference, not a raw credential');
  }
  return ref;
}

function enumValue<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${field} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

const mapPolicy = (row: Record<string, unknown>): CuracelReviewPolicy => ({
  id: String(row.id), org_id: String(row.org_id), team_id: row.team_id ? String(row.team_id) : null,
  action: String(row.action), review_required: Boolean(row.review_required),
  approver_roles: parseStrings(row.approver_roles_json), actor_principal_id: String(row.actor_principal_id),
  created_at: String(row.created_at), updated_at: String(row.updated_at),
});

const mapConnector = (row: Record<string, unknown>): CuracelConnector => ({
  id: String(row.id), org_id: String(row.org_id), team_id: row.team_id ? String(row.team_id) : null,
  type: row.type as CuracelConnectorType, name: String(row.name), credential_ref: String(row.credential_ref),
  enabled: false, mode: 'dry_run', review_required: true, actor_principal_id: String(row.actor_principal_id),
  created_at: String(row.created_at), updated_at: String(row.updated_at),
});

const mapDraft = (row: Record<string, unknown>): CuracelConnectorDraft => ({
  id: String(row.id), org_id: String(row.org_id), connector_id: String(row.connector_id),
  actor_principal_id: String(row.actor_principal_id), idempotency_key: String(row.idempotency_key),
  target_ref: String(row.target_ref), payload: parseObject(row.payload_json), state: 'pending_review',
  review_required: true, delivery_attempted: false, created_at: String(row.created_at),
});

const mapAudit = (row: Record<string, unknown>): CuracelAuditRecord => ({
  id: String(row.id), org_id: String(row.org_id), team_id: row.team_id == null ? null : String(row.team_id),
  agent_id: row.agent_id == null ? null : String(row.agent_id), task_id: row.task_id == null ? null : Number(row.task_id),
  actor_principal_id: String(row.actor_principal_id), category: row.category as CuracelAuditCategory,
  action: String(row.action), outcome: String(row.outcome), detail: parseObject(row.detail_json),
  idempotency_key: row.idempotency_key == null ? null : String(row.idempotency_key), created_at: String(row.created_at),
});

const mapSample = (row: Record<string, unknown>): CuracelExecutionSample => ({
  id: String(row.id), org_id: String(row.org_id), team_id: row.team_id == null ? null : String(row.team_id),
  agent_id: String(row.agent_id), task_id: row.task_id == null ? null : Number(row.task_id),
  outcome: row.outcome as 'success' | 'error', latency_ms: Number(row.latency_ms), retries: Number(row.retries),
  muted: Boolean(row.muted), rate_limited: Boolean(row.rate_limited),
  review_outcome: row.review_outcome as CuracelReviewOutcome, created_at: String(row.created_at),
});

const mapDashboard = (row: Record<string, unknown>): CuracelTeamDashboard => ({
  id: String(row.id), org_id: String(row.org_id), team_id: String(row.team_id), team_type: row.team_type as CuracelTeamType,
  queue_label: String(row.queue_label), approval_sla_minutes: Number(row.approval_sla_minutes),
  policies: parseObject(row.policies_json), agent_permissions: parseStrings(row.agent_permissions_json),
  actor_principal_id: String(row.actor_principal_id), created_at: String(row.created_at), updated_at: String(row.updated_at),
});

export function createCuracelOperationsRepository(
  providedDb?: Database.Database,
  options: { now?: () => Date } = {},
) {
  const db = providedDb ?? getEntityDatabase(ensureSchema);
  ensureSchema(db);
  const now = options.now ?? (() => new Date());
  const stamp = () => now().toISOString();

  const repository = {
    upsertReviewPolicy(input: {
      org_id: string; team_id?: string | null; action: string; review_required: boolean;
      approver_roles?: string[]; actor_principal_id: string;
    }): CuracelReviewPolicy {
      const orgId = required(input.org_id, 'organization id');
      const teamId = optional(input.team_id, 'team id') ?? '';
      const action = required(input.action, 'action').toLowerCase();
      if (isProtectedAction(action) && input.review_required !== true) {
        throw new Error('protected actions cannot bypass human review');
      }
      if (typeof input.review_required !== 'boolean') throw new Error('review required must be a boolean');
      const at = stamp();
      db.prepare(`INSERT INTO curacel_review_policies
        (id,org_id,team_id,action,review_required,approver_roles_json,actor_principal_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(org_id,team_id,action) DO UPDATE SET
        review_required=excluded.review_required,approver_roles_json=excluded.approver_roles_json,
        actor_principal_id=excluded.actor_principal_id,updated_at=excluded.updated_at`).run(
        randomUUID(), orgId, teamId, action, Number(input.review_required),
        JSON.stringify(stringArray(input.approver_roles, 'approver roles')),
        required(input.actor_principal_id, 'actor principal id'), at, at,
      );
      return mapPolicy(db.prepare('SELECT * FROM curacel_review_policies WHERE org_id=? AND team_id=? AND action=?').get(
        orgId, teamId, action,
      ) as Record<string, unknown>);
    },
    listReviewPolicies(orgId: string): CuracelReviewPolicy[] {
      return (db.prepare('SELECT * FROM curacel_review_policies WHERE org_id=? ORDER BY rowid').all(
        required(orgId, 'organization id'),
      ) as Record<string, unknown>[]).map(mapPolicy);
    },
    resolveReviewPolicy(input: { org_id: string; team_id?: string | null; action: string }): ResolvedCuracelReviewPolicy {
      const orgId = required(input.org_id, 'organization id');
      const teamId = optional(input.team_id, 'team id');
      const action = required(input.action, 'action').toLowerCase();
      const row = db.prepare(`SELECT * FROM curacel_review_policies WHERE org_id=? AND action=?
        AND team_id IN (?, '') ORDER BY CASE WHEN team_id=? THEN 0 ELSE 1 END LIMIT 1`).get(
        orgId, action, teamId ?? '', teamId ?? '',
      ) as Record<string, unknown> | undefined;
      if (row) {
        const policy = mapPolicy(row);
        return { id: policy.id, org_id: orgId, team_id: policy.team_id, action, review_required: policy.review_required,
          approver_roles: policy.approver_roles, source: policy.team_id ? 'team_policy' : 'org_policy' };
      }
      return { id: null, org_id: orgId, team_id: teamId, action, review_required: isProtectedAction(action),
        approver_roles: [], source: isProtectedAction(action) ? 'protected_default' : 'default' };
    },
    upsertConnector(input: {
      org_id: string; team_id?: string | null; type: CuracelConnectorType; name: string; credential_ref: string;
      enabled?: boolean; mode?: string; review_required?: boolean; actor_principal_id: string;
    }): CuracelConnector {
      if (input.enabled === true) throw new Error('outbound connectors cannot be enabled');
      if (input.mode != null && input.mode !== 'dry_run') throw new Error('connector mode must be dry_run');
      if (input.review_required === false) throw new Error('connector review cannot be disabled');
      const orgId = required(input.org_id, 'organization id');
      const teamId = optional(input.team_id, 'team id') ?? '';
      const type = enumValue(input.type, 'connector type', CURACEL_CONNECTOR_TYPES);
      const name = required(input.name, 'connector name');
      const at = stamp();
      db.prepare(`INSERT INTO curacel_connectors
        (id,org_id,team_id,type,name,credential_ref,actor_principal_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(org_id,team_id,type,name) DO UPDATE SET
        credential_ref=excluded.credential_ref,actor_principal_id=excluded.actor_principal_id,updated_at=excluded.updated_at`).run(
        randomUUID(), orgId, teamId, type, name, credentialReference(input.credential_ref),
        required(input.actor_principal_id, 'actor principal id'), at, at,
      );
      return mapConnector(db.prepare('SELECT * FROM curacel_connectors WHERE org_id=? AND team_id=? AND type=? AND name=?').get(
        orgId, teamId, type, name,
      ) as Record<string, unknown>);
    },
    listConnectors(orgId: string, teamId?: string | null): CuracelConnector[] {
      const args: unknown[] = [required(orgId, 'organization id')];
      let sql = 'SELECT * FROM curacel_connectors WHERE org_id=?';
      if (teamId !== undefined) { sql += ' AND team_id=?'; args.push(optional(teamId, 'team id') ?? ''); }
      return (db.prepare(`${sql} ORDER BY rowid`).all(...args) as Record<string, unknown>[]).map(mapConnector);
    },
    createConnectorDraft(input: {
      org_id: string; connector_id: string; actor_principal_id: string; idempotency_key: string;
      target_ref: string; payload: Record<string, unknown>;
    }): CuracelConnectorDraft {
      const orgId = required(input.org_id, 'organization id');
      const key = required(input.idempotency_key, 'idempotency key');
      const existing = db.prepare('SELECT * FROM curacel_connector_drafts WHERE org_id=? AND idempotency_key=?').get(
        orgId, key,
      ) as Record<string, unknown> | undefined;
      if (existing) return mapDraft(existing);
      const connectorId = required(input.connector_id, 'connector id');
      if (!db.prepare('SELECT 1 FROM curacel_connectors WHERE id=? AND org_id=?').get(connectorId, orgId)) {
        throw new Error('connector not found');
      }
      const payload = jsonObject(input.payload, 'draft payload');
      rejectRawCredentials(payload);
      db.prepare(`INSERT INTO curacel_connector_drafts
        (id,org_id,connector_id,actor_principal_id,idempotency_key,target_ref,payload_json,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(
        randomUUID(), orgId, connectorId, required(input.actor_principal_id, 'actor principal id'), key,
        required(input.target_ref, 'target reference', 500), JSON.stringify(payload), stamp(),
      );
      return mapDraft(db.prepare('SELECT * FROM curacel_connector_drafts WHERE org_id=? AND idempotency_key=?').get(
        orgId, key,
      ) as Record<string, unknown>);
    },
    listConnectorDrafts(orgId: string, connectorId?: string): CuracelConnectorDraft[] {
      const args: unknown[] = [required(orgId, 'organization id')];
      let sql = 'SELECT * FROM curacel_connector_drafts WHERE org_id=?';
      if (connectorId !== undefined) {
        sql += ' AND connector_id=?';
        args.push(required(connectorId, 'connector id'));
      }
      return (db.prepare(`${sql} ORDER BY created_at DESC, rowid DESC`).all(
        ...args,
      ) as Record<string, unknown>[]).map(mapDraft);
    },
    appendAudit(input: {
      org_id: string; team_id?: string | null; agent_id?: string | null; task_id?: number | null;
      actor_principal_id: string; category: CuracelAuditCategory; action: string; outcome: string;
      detail?: Record<string, unknown>; idempotency_key?: string | null;
    }): CuracelAuditRecord {
      const orgId = required(input.org_id, 'organization id');
      const key = optional(input.idempotency_key, 'idempotency key');
      if (key) {
        const existing = db.prepare('SELECT * FROM curacel_operational_audit WHERE org_id=? AND idempotency_key=?').get(
          orgId, key,
        ) as Record<string, unknown> | undefined;
        if (existing) return mapAudit(existing);
      }
      const id = randomUUID();
      db.prepare(`INSERT INTO curacel_operational_audit
        (id,org_id,team_id,agent_id,task_id,actor_principal_id,category,action,outcome,detail_json,idempotency_key,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, orgId, optional(input.team_id, 'team id'), optional(input.agent_id, 'agent id'),
        input.task_id == null ? null : integer(input.task_id, 'task id', 1),
        required(input.actor_principal_id, 'actor principal id'),
        enumValue(input.category, 'audit category', CURACEL_AUDIT_CATEGORIES),
        required(input.action, 'audit action'), required(input.outcome, 'audit outcome'),
        JSON.stringify(jsonObject(input.detail, 'audit detail')), key, stamp(),
      );
      return mapAudit(db.prepare('SELECT * FROM curacel_operational_audit WHERE id=?').get(id) as Record<string, unknown>);
    },
    listAudit(input: {
      org_id: string; team_id?: string; agent_id?: string; task_id?: number; category?: CuracelAuditCategory; limit?: number;
    }): CuracelAuditRecord[] {
      const clauses = ['org_id=?'];
      const args: unknown[] = [required(input.org_id, 'organization id')];
      for (const [column, value] of [['team_id', input.team_id], ['agent_id', input.agent_id]] as const) {
        if (value !== undefined) { clauses.push(`${column}=?`); args.push(required(value, column)); }
      }
      if (input.task_id !== undefined) { clauses.push('task_id=?'); args.push(integer(input.task_id, 'task id', 1)); }
      if (input.category !== undefined) {
        clauses.push('category=?'); args.push(enumValue(input.category, 'audit category', CURACEL_AUDIT_CATEGORIES));
      }
      args.push(integer(input.limit ?? 100, 'limit', 1));
      return (db.prepare(`SELECT * FROM curacel_operational_audit WHERE ${clauses.join(' AND ')}
        ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(...args) as Record<string, unknown>[]).map(mapAudit);
    },
    recordExecution(input: {
      org_id: string; team_id?: string | null; agent_id: string; task_id?: number | null;
      outcome: 'success' | 'error'; latency_ms: number; retries?: number; muted?: boolean;
      rate_limited?: boolean; review_outcome?: CuracelReviewOutcome;
    }): CuracelExecutionSample {
      const id = randomUUID();
      db.prepare(`INSERT INTO curacel_execution_samples
        (id,org_id,team_id,agent_id,task_id,outcome,latency_ms,retries,muted,rate_limited,review_outcome,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, required(input.org_id, 'organization id'), optional(input.team_id, 'team id'),
        required(input.agent_id, 'agent id'), input.task_id == null ? null : integer(input.task_id, 'task id', 1),
        enumValue(input.outcome, 'execution outcome', ['success', 'error']),
        integer(input.latency_ms, 'latency', 0), integer(input.retries ?? 0, 'retries', 0),
        Number(input.muted === true), Number(input.rate_limited === true),
        enumValue(input.review_outcome ?? 'not_required', 'review outcome', CURACEL_REVIEW_OUTCOMES), stamp(),
      );
      return mapSample(db.prepare('SELECT * FROM curacel_execution_samples WHERE id=?').get(id) as Record<string, unknown>);
    },
    listExecutionSamples(input: { org_id: string; team_id?: string; agent_id?: string; limit?: number }): CuracelExecutionSample[] {
      const clauses = ['org_id=?'];
      const args: unknown[] = [required(input.org_id, 'organization id')];
      if (input.team_id !== undefined) { clauses.push('team_id=?'); args.push(required(input.team_id, 'team id')); }
      if (input.agent_id !== undefined) { clauses.push('agent_id=?'); args.push(required(input.agent_id, 'agent id')); }
      args.push(integer(input.limit ?? 100, 'limit', 1));
      return (db.prepare(`SELECT * FROM curacel_execution_samples WHERE ${clauses.join(' AND ')}
        ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(...args) as Record<string, unknown>[]).map(mapSample);
    },
    getUsageReport(input: { org_id: string; team_id?: string; agent_id?: string }): CuracelUsageAggregate[] {
      const clauses = ['org_id=?'];
      const args: unknown[] = [required(input.org_id, 'organization id')];
      if (input.team_id !== undefined) { clauses.push('team_id=?'); args.push(required(input.team_id, 'team id')); }
      if (input.agent_id !== undefined) { clauses.push('agent_id=?'); args.push(required(input.agent_id, 'agent id')); }
      const rows = db.prepare(`SELECT agent_id,team_id,COUNT(*) volume,
        SUM(outcome='success') successes,SUM(outcome='error') errors,AVG(latency_ms) average_latency_ms,
        SUM(retries) total_retries,SUM(muted) mute_events,SUM(rate_limited) rate_limit_events,
        SUM(review_outcome='approved') approved,SUM(review_outcome='rejected') rejected,
        SUM(review_outcome='pending') pending,SUM(review_outcome='not_required') not_required
        FROM curacel_execution_samples WHERE ${clauses.join(' AND ')}
        GROUP BY agent_id,team_id ORDER BY MIN(rowid)`).all(...args) as Record<string, unknown>[];
      return rows.map((row) => {
        const volume = Number(row.volume);
        const successes = Number(row.successes);
        const errors = Number(row.errors);
        return {
          agent_id: String(row.agent_id), team_id: row.team_id == null ? null : String(row.team_id), volume, successes, errors,
          success_rate: successes / volume, error_rate: errors / volume, average_latency_ms: Number(row.average_latency_ms),
          total_retries: Number(row.total_retries), mute_events: Number(row.mute_events), rate_limit_events: Number(row.rate_limit_events),
          review_outcomes: { approved: Number(row.approved), rejected: Number(row.rejected),
            pending: Number(row.pending), not_required: Number(row.not_required) },
        };
      });
    },
    upsertTeamDashboard(input: {
      org_id: string; team_id: string; team_type: CuracelTeamType; queue_label: string;
      approval_sla_minutes: number; policies: Record<string, unknown>; agent_permissions: string[];
      actor_principal_id: string;
    }): CuracelTeamDashboard {
      const orgId = required(input.org_id, 'organization id');
      const teamId = required(input.team_id, 'team id');
      const at = stamp();
      db.prepare(`INSERT INTO curacel_team_dashboards
        (id,org_id,team_id,team_type,queue_label,approval_sla_minutes,policies_json,agent_permissions_json,actor_principal_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(org_id,team_id) DO UPDATE SET
        team_type=excluded.team_type,queue_label=excluded.queue_label,approval_sla_minutes=excluded.approval_sla_minutes,
        policies_json=excluded.policies_json,agent_permissions_json=excluded.agent_permissions_json,
        actor_principal_id=excluded.actor_principal_id,updated_at=excluded.updated_at`).run(
        randomUUID(), orgId, teamId, enumValue(input.team_type, 'team type', CURACEL_TEAM_TYPES),
        required(input.queue_label, 'queue label'), integer(input.approval_sla_minutes, 'approval SLA minutes', 1),
        JSON.stringify(jsonObject(input.policies, 'dashboard policies')),
        JSON.stringify(stringArray(input.agent_permissions, 'agent permissions')),
        required(input.actor_principal_id, 'actor principal id'), at, at,
      );
      return mapDashboard(db.prepare('SELECT * FROM curacel_team_dashboards WHERE org_id=? AND team_id=?').get(
        orgId, teamId,
      ) as Record<string, unknown>);
    },
    listTeamDashboards(orgId: string): CuracelTeamDashboard[] {
      return (db.prepare('SELECT * FROM curacel_team_dashboards WHERE org_id=? ORDER BY rowid').all(
        required(orgId, 'organization id'),
      ) as Record<string, unknown>[]).map(mapDashboard);
    },
    getTeamDashboard(orgId: string, teamId: string): CuracelTeamDashboard | undefined {
      const row = db.prepare('SELECT * FROM curacel_team_dashboards WHERE org_id=? AND team_id=?').get(
        required(orgId, 'organization id'), required(teamId, 'team id'),
      ) as Record<string, unknown> | undefined;
      return row ? mapDashboard(row) : undefined;
    },
  };
  return repository;
}

export type CuracelOperationsRepository = ReturnType<typeof createCuracelOperationsRepository>;
