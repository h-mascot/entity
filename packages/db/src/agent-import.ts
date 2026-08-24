import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getEntityDatabase } from './entity-db';

export interface AgentReviewPolicy {
  required: boolean;
  human_gate_required: boolean;
}

export interface AgentImportMappingRecord {
  id: string;
  org_id: string;
  source: string;
  external_id: string;
  agent_id: string;
  source_agent_id: string | null;
  team_ids: string[];
  module_ids: string[];
  channel_ids: string[];
  review_policy: AgentReviewPolicy;
  imported_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface AgentImportReceiptRecord {
  id: string;
  org_id: string;
  idempotency_key: string;
  input_hash: string;
  actor_user_id: string;
  receipt_json: string;
  created_at: string;
}

export interface UpsertAgentImportMappingInput {
  org_id: string;
  source: string;
  external_id: string;
  agent_id: string;
  source_agent_id?: string | null;
  team_ids: string[];
  module_ids: string[];
  channel_ids: string[];
  review_policy: AgentReviewPolicy;
  imported_by_user_id: string;
}

export interface AgentImportRepository {
  listMappings: (orgId: string) => AgentImportMappingRecord[];
  getMapping: (orgId: string, source: string, externalId: string) => AgentImportMappingRecord | undefined;
  getMappingByAgent: (agentId: string) => AgentImportMappingRecord | undefined;
  upsertMapping: (input: UpsertAgentImportMappingInput) => AgentImportMappingRecord;
  importBatch: <T extends object>(
    input: {
      org_id: string;
      idempotency_key: string;
      input_hash: string;
      actor_user_id: string;
    },
    work: () => { receipt: T },
  ) => AgentImportReceiptRecord;
  getReceiptByIdempotencyKey: (
    orgId: string,
    idempotencyKey: string,
  ) => AgentImportReceiptRecord | undefined;
  getLatestReceipt: (orgId: string) => AgentImportReceiptRecord | undefined;
}

function required(value: unknown, field: string, max = 240): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${field} is too long`);
  return normalized;
}

function identifiers(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return [...new Set(value.map((item) => required(item, field)))].sort();
}

function reviewPolicy(value: unknown): AgentReviewPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('review policy must be an object');
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.required !== 'boolean' || typeof candidate.human_gate_required !== 'boolean') {
    throw new Error('review policy flags must be booleans');
  }
  return {
    required: candidate.required,
    human_gate_required: candidate.human_gate_required,
  };
}

function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_import_mappings (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      source_agent_id TEXT,
      team_ids_json TEXT NOT NULL,
      module_ids_json TEXT NOT NULL,
      channel_ids_json TEXT NOT NULL,
      review_policy_json TEXT NOT NULL,
      imported_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(org_id, source, external_id),
      UNIQUE(agent_id)
    );

    CREATE INDEX IF NOT EXISTS idx_agent_import_mappings_org
      ON agent_import_mappings(org_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS agent_import_receipts (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      receipt_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(org_id, idempotency_key)
    );
  `);
  const columns = db.prepare('PRAGMA table_info(agent_import_mappings)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'source_agent_id')) {
    db.exec('ALTER TABLE agent_import_mappings ADD COLUMN source_agent_id TEXT');
  }
  const hasRegistry = Boolean(db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'entity_agents'
  `).get());
  const hasTombstones = Boolean(db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'entity_agent_id_tombstones'
  `).get());
  if (hasRegistry && hasTombstones) {
    db.exec(`
      INSERT OR IGNORE INTO entity_agent_id_tombstones (agent_id)
      SELECT mapping.agent_id
      FROM agent_import_mappings AS mapping
      LEFT JOIN entity_agents AS agent ON agent.id = mapping.agent_id
      WHERE agent.id IS NULL
    `);
  }
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function mapMapping(row: Record<string, unknown>): AgentImportMappingRecord {
  return {
    id: String(row.id),
    org_id: String(row.org_id),
    source: String(row.source),
    external_id: String(row.external_id),
    agent_id: String(row.agent_id),
    source_agent_id: row.source_agent_id === null || row.source_agent_id === undefined
      ? null
      : String(row.source_agent_id),
    team_ids: parseStringArray(row.team_ids_json),
    module_ids: parseStringArray(row.module_ids_json),
    channel_ids: parseStringArray(row.channel_ids_json),
    review_policy: reviewPolicy(JSON.parse(String(row.review_policy_json))),
    imported_by_user_id: String(row.imported_by_user_id),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapReceipt(row: Record<string, unknown>): AgentImportReceiptRecord {
  return {
    id: String(row.id),
    org_id: String(row.org_id),
    idempotency_key: String(row.idempotency_key),
    input_hash: String(row.input_hash),
    actor_user_id: String(row.actor_user_id),
    receipt_json: String(row.receipt_json),
    created_at: String(row.created_at),
  };
}

export function createAgentImportRepository(): AgentImportRepository {
  const db = getEntityDatabase(ensureSchema);
  const mappingQuery = db.prepare(`
    SELECT * FROM agent_import_mappings
    WHERE org_id = ? AND source = ? AND external_id = ?
  `);
  const receiptQuery = db.prepare(`
    SELECT * FROM agent_import_receipts
    WHERE org_id = ? AND idempotency_key = ?
  `);
  const mappingByAgentQuery = db.prepare('SELECT * FROM agent_import_mappings WHERE agent_id = ?');

  return {
    listMappings: (orgId) => (db.prepare(`
      SELECT * FROM agent_import_mappings
      WHERE org_id = ?
      ORDER BY source, external_id
    `).all(required(orgId, 'organization id')) as Record<string, unknown>[]).map(mapMapping),
    getMapping: (orgId, source, externalId) => {
      const row = mappingQuery.get(
        required(orgId, 'organization id'),
        required(source, 'source'),
        required(externalId, 'external id'),
      ) as Record<string, unknown> | undefined;
      return row ? mapMapping(row) : undefined;
    },
    getMappingByAgent: (agentId) => {
      const row = mappingByAgentQuery.get(
        required(agentId, 'agent id'),
      ) as Record<string, unknown> | undefined;
      return row ? mapMapping(row) : undefined;
    },
    upsertMapping: (input) => {
      const orgId = required(input.org_id, 'organization id');
      const source = required(input.source, 'source', 80).toLowerCase();
      const externalId = required(input.external_id, 'external id', 200);
      const agentId = required(input.agent_id, 'agent id', 200);
      const sourceAgentId = input.source_agent_id
        ? required(input.source_agent_id, 'source agent id', 200)
        : null;
      const teamIds = identifiers(input.team_ids, 'team ids');
      const moduleIds = identifiers(input.module_ids, 'module ids');
      const channelIds = identifiers(input.channel_ids, 'channel ids');
      const policy = reviewPolicy(input.review_policy);
      db.prepare(`
        INSERT INTO agent_import_mappings (
          id, org_id, source, external_id, agent_id, source_agent_id, team_ids_json,
          module_ids_json, channel_ids_json, review_policy_json, imported_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(org_id, source, external_id) DO UPDATE SET
          agent_id = excluded.agent_id,
          source_agent_id = excluded.source_agent_id,
          team_ids_json = excluded.team_ids_json,
          module_ids_json = excluded.module_ids_json,
          channel_ids_json = excluded.channel_ids_json,
          review_policy_json = excluded.review_policy_json,
          imported_by_user_id = excluded.imported_by_user_id,
          updated_at = CURRENT_TIMESTAMP
      `).run(
        randomUUID(),
        orgId,
        source,
        externalId,
        agentId,
        sourceAgentId,
        JSON.stringify(teamIds),
        JSON.stringify(moduleIds),
        JSON.stringify(channelIds),
        JSON.stringify(policy),
        required(input.imported_by_user_id, 'importing user id'),
      );
      return mapMapping(mappingQuery.get(orgId, source, externalId) as Record<string, unknown>);
    },
    importBatch: (input, work) => db.transaction(() => {
      const orgId = required(input.org_id, 'organization id');
      const key = required(input.idempotency_key, 'idempotency key');
      const inputHash = required(input.input_hash, 'input hash');
      const existing = receiptQuery.get(orgId, key) as Record<string, unknown> | undefined;
      if (existing) {
        const receipt = mapReceipt(existing);
        if (receipt.input_hash !== inputHash) {
          throw new Error('idempotency key was already used for different input');
        }
        return receipt;
      }
      const result = work();
      db.prepare(`
        INSERT INTO agent_import_receipts (
          id, org_id, idempotency_key, input_hash, actor_user_id, receipt_json
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        orgId,
        key,
        inputHash,
        required(input.actor_user_id, 'actor user id'),
        JSON.stringify(result.receipt),
      );
      return mapReceipt(receiptQuery.get(orgId, key) as Record<string, unknown>);
    })(),
    getReceiptByIdempotencyKey: (orgId, key) => {
      const row = receiptQuery.get(
        required(orgId, 'organization id'),
        required(key, 'idempotency key'),
      ) as Record<string, unknown> | undefined;
      return row ? mapReceipt(row) : undefined;
    },
    getLatestReceipt: (orgId) => {
      const row = db.prepare(`
        SELECT * FROM agent_import_receipts
        WHERE org_id = ?
        ORDER BY datetime(created_at) DESC, rowid DESC
        LIMIT 1
      `).get(required(orgId, 'organization id')) as Record<string, unknown> | undefined;
      return row ? mapReceipt(row) : undefined;
    },
  };
}
