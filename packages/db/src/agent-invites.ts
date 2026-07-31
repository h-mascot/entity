import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { getEntityDatabase } from './entity-db';

export const AGENT_INVITE_STATUSES = [
  'created',
  'opened',
  'in_progress',
  'completed',
  'expired',
  'revoked',
] as const;

export type AgentInviteStatus = (typeof AGENT_INVITE_STATUSES)[number];

export const INVITE_CREATION_SOURCES = ['onboarding_first_run', 'agents_invite'] as const;
export type InviteCreationSource = (typeof INVITE_CREATION_SOURCES)[number];

export const CHIEF_ROUTING_MODES = ['none', 'chief', 'worker'] as const;
export type ChiefRoutingMode = (typeof CHIEF_ROUTING_MODES)[number];

export const INVITE_PROGRESS_STEP_STATUSES = ['pending', 'running', 'done', 'error'] as const;
export type InviteProgressStepStatus = (typeof INVITE_PROGRESS_STEP_STATUSES)[number];

export interface AgentInviteRecord {
  id: string;
  token_hash: string;
  generation: number;
  status: AgentInviteStatus;
  agent_id: string | null;
  agent_name: string;
  role: string;
  created_at: string;
  opened_at: string | null;
  completed_at: string | null;
  expires_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  created_by: string | null;
  creation_source: InviteCreationSource;
  workspace_id: string | null;
  project_id: string | null;
  workplane_id: string | null;
  task_id: number | null;
  selected_bundle: string;
  selected_modules: string[];
  selected_module_config: Record<string, unknown>;
  permissions_scope: string[];
  safe_stop_conditions: string[];
  provider_profile_id: string | null;
  chief_routing_mode: ChiefRoutingMode;
  previous_token_hash: string | null;
  updated_at: string;
}

export interface AgentInviteProgressRecord {
  id: string;
  invite_id: string;
  step_id: string;
  label: string;
  module_id: string | null;
  status: InviteProgressStepStatus;
  message: string | null;
  evidence_url: string | null;
  updated_at: string;
}

export interface CreateAgentInviteInput {
  id?: string;
  token_hash: string;
  agent_name: string;
  role?: string;
  status?: AgentInviteStatus;
  generation?: number;
  agent_id?: string | null;
  created_at?: string;
  expires_at: string;
  created_by?: string | null;
  creation_source?: InviteCreationSource;
  workspace_id?: string | null;
  project_id?: string | null;
  workplane_id?: string | null;
  task_id?: number | null;
  selected_bundle?: string;
  selected_modules?: readonly string[];
  selected_module_config?: Record<string, unknown>;
  permissions_scope?: readonly string[];
  safe_stop_conditions?: readonly string[];
  provider_profile_id?: string | null;
  chief_routing_mode?: ChiefRoutingMode;
  progress?: readonly CreateAgentInviteProgressInput[];
}

export interface CreateAgentInviteProgressInput {
  step_id: string;
  label: string;
  module_id?: string | null;
  status?: InviteProgressStepStatus;
  message?: string | null;
  evidence_url?: string | null;
  updated_at?: string;
}

export interface UpdateAgentInviteStatusInput {
  status: AgentInviteStatus;
  opened_at?: string | null;
  completed_at?: string | null;
  revoked_at?: string | null;
  revoked_by?: string | null;
  expires_at?: string;
  token_hash?: string;
  generation?: number;
  previous_token_hash?: string | null;
}

export interface AgentInviteRepository {
  ensureSchema: () => void;
  createInvite: (input: CreateAgentInviteInput) => AgentInviteRecord;
  getInviteById: (id: string) => AgentInviteRecord | undefined;
  getInviteByTokenHash: (tokenHash: string) => AgentInviteRecord | undefined;
  /** Lookup rotated-away tokens so callers can fail-closed (not 404-as-unknown). */
  getInviteByPreviousTokenHash: (tokenHash: string) => AgentInviteRecord | undefined;
  listInvites: (filters?: { status?: AgentInviteStatus; limit?: number }) => AgentInviteRecord[];
  updateInvite: (id: string, patch: UpdateAgentInviteStatusInput) => AgentInviteRecord | undefined;
  replaceProgress: (inviteId: string, progress: readonly CreateAgentInviteProgressInput[]) => AgentInviteProgressRecord[];
  listProgress: (inviteId: string) => AgentInviteProgressRecord[];
}

function openEntityDatabase(): Database.Database {
  return getEntityDatabase(ensureAgentInviteSchema);
}

export function ensureAgentInviteSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_invites (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      generation INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'created',
      agent_id TEXT,
      agent_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'worker',
      created_at TEXT NOT NULL,
      opened_at TEXT,
      completed_at TEXT,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      revoked_by TEXT,
      created_by TEXT,
      creation_source TEXT NOT NULL DEFAULT 'agents_invite',
      workspace_id TEXT,
      project_id TEXT,
      workplane_id TEXT,
      task_id INTEGER,
      selected_bundle TEXT NOT NULL DEFAULT 'default',
      selected_modules_json TEXT NOT NULL DEFAULT '[]',
      selected_module_config_json TEXT NOT NULL DEFAULT '{}',
      permissions_scope_json TEXT NOT NULL DEFAULT '[]',
      safe_stop_conditions_json TEXT NOT NULL DEFAULT '[]',
      provider_profile_id TEXT,
      chief_routing_mode TEXT NOT NULL DEFAULT 'none',
      previous_token_hash TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_invites_token_hash ON agent_invites(token_hash);
    CREATE INDEX IF NOT EXISTS idx_agent_invites_status ON agent_invites(status);
    CREATE INDEX IF NOT EXISTS idx_agent_invites_created_at ON agent_invites(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_invites_agent_id ON agent_invites(agent_id);

    CREATE TABLE IF NOT EXISTS agent_invite_progress (
      id TEXT PRIMARY KEY,
      invite_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      label TEXT NOT NULL,
      module_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      message TEXT,
      evidence_url TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(invite_id, step_id),
      FOREIGN KEY(invite_id) REFERENCES agent_invites(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_agent_invite_progress_invite ON agent_invite_progress(invite_id);
  `);
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} is required`);
  }
  return value.trim();
}

function normalizeTimestamp(value: unknown, fallback = new Date().toISOString()): string {
  if (typeof value !== 'string') return fallback;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return fallback;
  return new Date(parsed).toISOString();
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeStatus(value: unknown): AgentInviteStatus {
  if (typeof value === 'string' && (AGENT_INVITE_STATUSES as readonly string[]).includes(value)) {
    return value as AgentInviteStatus;
  }
  throw new Error(`Unsupported agent invite status: ${String(value)}`);
}

function normalizeCreationSource(value: unknown): InviteCreationSource {
  if (typeof value === 'string' && (INVITE_CREATION_SOURCES as readonly string[]).includes(value)) {
    return value as InviteCreationSource;
  }
  return 'agents_invite';
}

function normalizeChiefMode(value: unknown): ChiefRoutingMode {
  if (typeof value === 'string' && (CHIEF_ROUTING_MODES as readonly string[]).includes(value)) {
    return value as ChiefRoutingMode;
  }
  return 'none';
}

function normalizeProgressStatus(value: unknown): InviteProgressStepStatus {
  if (typeof value === 'string' && (INVITE_PROGRESS_STEP_STATUSES as readonly string[]).includes(value)) {
    return value as InviteProgressStepStatus;
  }
  return 'pending';
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  } catch {
    return [];
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mapInviteRow(row: Record<string, unknown>): AgentInviteRecord {
  return {
    id: String(row.id ?? ''),
    token_hash: String(row.token_hash ?? ''),
    generation: Number(row.generation ?? 1),
    status: normalizeStatus(row.status),
    agent_id: normalizeNullableString(row.agent_id),
    agent_name: String(row.agent_name ?? ''),
    role: String(row.role ?? 'worker'),
    created_at: normalizeTimestamp(row.created_at),
    opened_at: normalizeNullableString(row.opened_at),
    completed_at: normalizeNullableString(row.completed_at),
    expires_at: normalizeTimestamp(row.expires_at),
    revoked_at: normalizeNullableString(row.revoked_at),
    revoked_by: normalizeNullableString(row.revoked_by),
    created_by: normalizeNullableString(row.created_by),
    creation_source: normalizeCreationSource(row.creation_source),
    workspace_id: normalizeNullableString(row.workspace_id),
    project_id: normalizeNullableString(row.project_id),
    workplane_id: normalizeNullableString(row.workplane_id),
    task_id: (() => {
      if (typeof row.task_id === 'number' && Number.isFinite(row.task_id)) return row.task_id;
      if (row.task_id == null || row.task_id === '') return null;
      const parsed = Number(row.task_id);
      return Number.isFinite(parsed) ? parsed : null;
    })(),
    selected_bundle: String(row.selected_bundle ?? 'default'),
    selected_modules: parseJsonArray(row.selected_modules_json),
    selected_module_config: parseJsonObject(row.selected_module_config_json),
    permissions_scope: parseJsonArray(row.permissions_scope_json),
    safe_stop_conditions: parseJsonArray(row.safe_stop_conditions_json),
    provider_profile_id: normalizeNullableString(row.provider_profile_id),
    chief_routing_mode: normalizeChiefMode(row.chief_routing_mode),
    previous_token_hash: normalizeNullableString(row.previous_token_hash),
    updated_at: normalizeTimestamp(row.updated_at),
  };
}

function mapProgressRow(row: Record<string, unknown>): AgentInviteProgressRecord {
  return {
    id: String(row.id ?? ''),
    invite_id: String(row.invite_id ?? ''),
    step_id: String(row.step_id ?? ''),
    label: String(row.label ?? ''),
    module_id: normalizeNullableString(row.module_id),
    status: normalizeProgressStatus(row.status),
    message: normalizeNullableString(row.message),
    evidence_url: normalizeNullableString(row.evidence_url),
    updated_at: normalizeTimestamp(row.updated_at),
  };
}

export function createAgentInviteRepository(): AgentInviteRepository {
  const db = openEntityDatabase();

  const getByIdStmt = db.prepare('SELECT * FROM agent_invites WHERE id = ?');
  const getByHashStmt = db.prepare('SELECT * FROM agent_invites WHERE token_hash = ?');
  const getByPreviousHashStmt = db.prepare(
    'SELECT * FROM agent_invites WHERE previous_token_hash = ? ORDER BY updated_at DESC LIMIT 1',
  );
  const insertInviteStmt = db.prepare(`
    INSERT INTO agent_invites (
      id, token_hash, generation, status, agent_id, agent_name, role,
      created_at, opened_at, completed_at, expires_at, revoked_at, revoked_by,
      created_by, creation_source, workspace_id, project_id, workplane_id, task_id,
      selected_bundle, selected_modules_json, selected_module_config_json,
      permissions_scope_json, safe_stop_conditions_json, provider_profile_id,
      chief_routing_mode, previous_token_hash, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, NULL, NULL, ?, NULL, NULL,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, NULL, ?
    )
  `);
  const deleteProgressStmt = db.prepare('DELETE FROM agent_invite_progress WHERE invite_id = ?');
  const insertProgressStmt = db.prepare(`
    INSERT INTO agent_invite_progress (
      id, invite_id, step_id, label, module_id, status, message, evidence_url, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const listProgressStmt = db.prepare(
    'SELECT * FROM agent_invite_progress WHERE invite_id = ? ORDER BY updated_at ASC, step_id ASC',
  );

  const replaceProgress = (
    inviteId: string,
    progress: readonly CreateAgentInviteProgressInput[],
  ): AgentInviteProgressRecord[] => {
    requireNonEmptyString(inviteId, 'inviteId');
    const tx = db.transaction(() => {
      deleteProgressStmt.run(inviteId);
      for (const step of progress) {
        const updatedAt = normalizeTimestamp(step.updated_at);
        insertProgressStmt.run(
          randomUUID(),
          inviteId,
          requireNonEmptyString(step.step_id, 'step_id'),
          requireNonEmptyString(step.label, 'label'),
          normalizeNullableString(step.module_id),
          normalizeProgressStatus(step.status),
          normalizeNullableString(step.message),
          normalizeNullableString(step.evidence_url),
          updatedAt,
        );
      }
    });
    tx();
    return listProgressStmt.all(inviteId).map((row) => mapProgressRow(row as Record<string, unknown>));
  };

  return {
    ensureSchema: () => ensureAgentInviteSchema(db),

    createInvite: (input) => {
      const id = input.id?.trim() || randomUUID();
      const now = new Date().toISOString();
      const createdAt = normalizeTimestamp(input.created_at, now);
      const tokenHash = requireNonEmptyString(input.token_hash, 'token_hash');
      const agentName = requireNonEmptyString(input.agent_name, 'agent_name');
      const status = input.status ? normalizeStatus(input.status) : 'created';
      const creationSource = normalizeCreationSource(input.creation_source);
      const expiresAt = normalizeTimestamp(input.expires_at);

      insertInviteStmt.run(
        id,
        tokenHash,
        input.generation ?? 1,
        status,
        normalizeNullableString(input.agent_id),
        agentName,
        requireNonEmptyString(input.role ?? 'worker', 'role'),
        createdAt,
        expiresAt,
        normalizeNullableString(input.created_by),
        creationSource,
        normalizeNullableString(input.workspace_id),
        normalizeNullableString(input.project_id),
        normalizeNullableString(input.workplane_id),
        input.task_id ?? null,
        input.selected_bundle?.trim() || 'default',
        JSON.stringify(input.selected_modules ?? []),
        JSON.stringify(input.selected_module_config ?? {}),
        JSON.stringify(input.permissions_scope ?? []),
        JSON.stringify(input.safe_stop_conditions ?? []),
        normalizeNullableString(input.provider_profile_id),
        normalizeChiefMode(input.chief_routing_mode),
        now,
      );

      if (input.progress?.length) {
        replaceProgress(id, input.progress);
      }

      const created = getByIdStmt.get(id) as Record<string, unknown> | undefined;
      if (!created) {
        throw new Error('Failed to create agent invite');
      }
      return mapInviteRow(created);
    },

    getInviteById: (id) => {
      const row = getByIdStmt.get(requireNonEmptyString(id, 'id')) as Record<string, unknown> | undefined;
      return row ? mapInviteRow(row) : undefined;
    },

    getInviteByTokenHash: (tokenHash) => {
      const row = getByHashStmt.get(requireNonEmptyString(tokenHash, 'tokenHash')) as
        | Record<string, unknown>
        | undefined;
      return row ? mapInviteRow(row) : undefined;
    },

    getInviteByPreviousTokenHash: (tokenHash) => {
      const row = getByPreviousHashStmt.get(requireNonEmptyString(tokenHash, 'tokenHash')) as
        | Record<string, unknown>
        | undefined;
      return row ? mapInviteRow(row) : undefined;
    },

    listInvites: (filters = {}) => {
      const limit = Math.min(Math.max(filters.limit ?? 100, 1), 1000);
      if (filters.status) {
        const status = normalizeStatus(filters.status);
        return db
          .prepare('SELECT * FROM agent_invites WHERE status = ? ORDER BY created_at DESC LIMIT ?')
          .all(status, limit)
          .map((row) => mapInviteRow(row as Record<string, unknown>));
      }
      return db
        .prepare('SELECT * FROM agent_invites ORDER BY created_at DESC LIMIT ?')
        .all(limit)
        .map((row) => mapInviteRow(row as Record<string, unknown>));
    },

    updateInvite: (id, patch) => {
      const existing = getByIdStmt.get(requireNonEmptyString(id, 'id')) as Record<string, unknown> | undefined;
      if (!existing) return undefined;

      const current = mapInviteRow(existing);
      const nextStatus = normalizeStatus(patch.status);
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE agent_invites SET
          status = ?,
          opened_at = ?,
          completed_at = ?,
          revoked_at = ?,
          revoked_by = ?,
          expires_at = ?,
          token_hash = ?,
          generation = ?,
          previous_token_hash = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        nextStatus,
        patch.opened_at === undefined ? current.opened_at : patch.opened_at,
        patch.completed_at === undefined ? current.completed_at : patch.completed_at,
        patch.revoked_at === undefined ? current.revoked_at : patch.revoked_at,
        patch.revoked_by === undefined ? current.revoked_by : patch.revoked_by,
        patch.expires_at ? normalizeTimestamp(patch.expires_at) : current.expires_at,
        patch.token_hash ? requireNonEmptyString(patch.token_hash, 'token_hash') : current.token_hash,
        patch.generation ?? current.generation,
        patch.previous_token_hash === undefined ? current.previous_token_hash : patch.previous_token_hash,
        now,
        id,
      );

      const row = getByIdStmt.get(id) as Record<string, unknown> | undefined;
      return row ? mapInviteRow(row) : undefined;
    },

    replaceProgress,
    listProgress: (inviteId) =>
      listProgressStmt
        .all(requireNonEmptyString(inviteId, 'inviteId'))
        .map((row) => mapProgressRow(row as Record<string, unknown>)),
  };
}
