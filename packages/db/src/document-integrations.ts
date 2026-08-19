/**
 * T-003 — Define and migrate unified document persistence.
 *
 * Establishes stable Entity document identity through an ADDITIVE unified schema:
 *   - document_objects          — the canonical provider-neutral document record (R-001 / 11.1)
 *   - document_associations     — project/task/File Source associations (R-001 / 11.2)
 *   - document_versions         — version/ETag/change-token history (R-001 / 11.3)
 *   - document_integration_events — attributable activity events (R-001 / 11.4)
 *
 * Distinct from the already-claimed `document_events` table
 * (packages/server/src/routes/agent-api.ts:47, MF-02): we never reuse that name and
 * every migration runs an explicit collision guard before creating any unified table,
 * so a pre-existing incompatible table can never silently bind one consumer schema to
 * another (R-036 / PRD 11.4).
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md
 *   - R-001 "Canonical document object"  — required logical fields + uniqueness semantics
 *   - R-036 "Database migration safety"  — additive schema, no destructive rollback
 *
 * Security & privacy: this module persists NO credentials, raw tokens, tenant secrets,
 * or document contents. Permission/ownership fields are summaries; event metadata is
 * sanitized only. See the "security" column checks in the test suite.
 */

import { createHash, randomUUID } from 'crypto';
import Database from 'better-sqlite3';

/** Canonical provider families (D-002 / D-003). Provider type never implies capability. */
export const DOCUMENT_PROVIDERS = ['google_workspace', 'microsoft_365', 'local_office'] as const;
export type DocumentProvider = (typeof DOCUMENT_PROVIDERS)[number];

/** R-001 artifact type vocabulary. */
export const DOCUMENT_ARTIFACT_TYPES = ['document', 'spreadsheet', 'presentation'] as const;
export type DocumentArtifactType = (typeof DOCUMENT_ARTIFACT_TYPES)[number];

/** R-001 auth/readiness/preview/conflict domains. */
export const DOCUMENT_AUTH_STATES = ['authorized', 'degraded', 'unauthorized', 'unknown'] as const;
export type DocumentAuthState = (typeof DOCUMENT_AUTH_STATES)[number];

export const DOCUMENT_READINESS_STATES = ['ready', 'degraded', 'error', 'unknown'] as const;
export type DocumentReadinessState = (typeof DOCUMENT_READINESS_STATES)[number];

export const DOCUMENT_PREVIEW_STATES = ['not_requested', 'pending', 'ready', 'failed', 'unsupported'] as const;
export type DocumentPreviewState = (typeof DOCUMENT_PREVIEW_STATES)[number];

export const DOCUMENT_CONFLICT_STATES = ['none', 'detected', 'resolved'] as const;
export type DocumentConflictState = (typeof DOCUMENT_CONFLICT_STATES)[number];

/** The additive unified table names owned by this module. */
export const DOCUMENT_INTEGRATION_TABLE_NAMES = [
  'document_objects',
  'document_associations',
  'document_versions',
  'document_integration_events',
] as const;

export interface DocumentObjectRecord {
  id: string;
  workspace_id: string;
  provider: DocumentProvider;
  artifact_type: DocumentArtifactType;
  title: string;
  provider_connection_id: string | null;
  destination_id: string | null;
  external_id: string | null;
  provider_url: string | null;
  owner_summary: string | null;
  tenant_external_id: string | null;
  permissions_summary_json: string | null;
  sensitivity_label: string | null;
  auth_state: DocumentAuthState;
  readiness_state: DocumentReadinessState;
  degraded_reason_code: string | null;
  current_revision: string | null;
  provider_modified_at: string | null;
  indexed_at: string | null;
  preview_state: DocumentPreviewState;
  conflict_state: DocumentConflictState;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreateDocumentObjectInput {
  id?: string;
  workspace_id: string;
  provider: DocumentProvider;
  artifact_type: DocumentArtifactType;
  title: string;
  provider_connection_id?: string | null;
  destination_id?: string | null;
  external_id?: string | null;
  provider_url?: string | null;
  owner_summary?: string | null;
  tenant_external_id?: string | null;
  permissions_summary_json?: string | null;
  sensitivity_label?: string | null;
  auth_state: DocumentAuthState;
  readiness_state: DocumentReadinessState;
  degraded_reason_code?: string | null;
  current_revision?: string | null;
  provider_modified_at?: string | null;
  indexed_at?: string | null;
  preview_state?: DocumentPreviewState;
  conflict_state?: DocumentConflictState;
}

export interface DocumentVersionRecord {
  id: string;
  document_id: string;
  provider_revision: string;
  provider_version_id: string | null;
  etag: string | null;
  change_token: string | null;
  content_hash: string | null;
  actor_type: string;
  actor_id: string | null;
  source: string;
  snapshot_ref: string | null;
  provider_modified_at: string | null;
  observed_at: string;
  metadata_json: string | null;
}

export interface CreateDocumentVersionInput {
  id?: string;
  document_id: string;
  provider_revision: string;
  provider_version_id?: string | null;
  etag?: string | null;
  change_token?: string | null;
  content_hash?: string | null;
  actor_type: string;
  actor_id?: string | null;
  source: string;
  snapshot_ref?: string | null;
  provider_modified_at?: string | null;
  observed_at: string;
  metadata_json?: string | null;
}

export interface DocumentIntegrationEventRecord {
  id: string;
  document_id: string;
  event_type: string;
  actor_type: string;
  actor_id: string | null;
  provider: DocumentProvider;
  operation_id: string | null;
  receipt_id: string | null;
  idempotency_key: string | null;
  before_revision: string | null;
  after_revision: string | null;
  status: string;
  reason_code: string | null;
  sanitized_metadata_json: string | null;
  created_at: string;
}

export interface CreateDocumentIntegrationEventInput {
  id?: string;
  document_id: string;
  event_type: string;
  actor_type: string;
  actor_id?: string | null;
  provider: DocumentProvider;
  operation_id?: string | null;
  receipt_id?: string | null;
  idempotency_key?: string | null;
  before_revision?: string | null;
  after_revision?: string | null;
  status: string;
  reason_code?: string | null;
  sanitized_metadata_json?: string | null;
}

/** Result of ensuring the additive unified schema exists. */
export interface SchemaAuditReport {
  tablesEnsured: readonly string[];
  collision: { ok: true };
  destructiveChanges: false;
}

export interface RegistrationResult {
  record: DocumentObjectRecord;
  created: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Stable, deterministic Entity document ID derived from the provider identity tuple.
 * R-001: "Given any supported ... artifact, when Entity registers it, then it receives
 * exactly one canonical Entity document ID." Deriving from the identity makes
 * re-registration idempotent across restarts.
 */
export function documentObjectIdForIdentity(
  providerConnectionId: string | null | undefined,
  externalId: string | null | undefined,
): string {
  const tuple = `${providerConnectionId ?? ''}|${externalId ?? ''}`;
  return `doc_${createHash('sha256').update(tuple).digest('hex').slice(0, 12)}`;
}

/**
 * The exact additive DDL for the unified schema. Follows PRD section 11 and
 * repository conventions (TEXT ids, CHECK constraints, ISO timestamps).
 */
const DOCUMENT_INTEGRATIONS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS document_objects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL
    CHECK (provider IN ('google_workspace','microsoft_365','local_office')),
  artifact_type TEXT NOT NULL
    CHECK (artifact_type IN ('document','spreadsheet','presentation')),
  title TEXT NOT NULL,
  provider_connection_id TEXT,
  destination_id TEXT,
  external_id TEXT,
  provider_url TEXT,
  owner_summary TEXT,
  tenant_external_id TEXT,
  permissions_summary_json TEXT,
  sensitivity_label TEXT,
  auth_state TEXT NOT NULL,
  readiness_state TEXT NOT NULL,
  degraded_reason_code TEXT,
  current_revision TEXT,
  provider_modified_at TEXT,
  indexed_at TEXT,
  preview_state TEXT NOT NULL DEFAULT 'not_requested',
  conflict_state TEXT NOT NULL DEFAULT 'none',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

-- R-001 uniqueness: (provider_connection_id, external_id) must be unique when
-- external_id is non-null. For local artifacts external_id is the durable managed
-- file identity, so the same index supplies equivalent uniqueness (PRD 11.1).
CREATE UNIQUE INDEX IF NOT EXISTS uq_document_objects_provider_identity
  ON document_objects(provider_connection_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_document_objects_workspace ON document_objects(workspace_id);

CREATE TABLE IF NOT EXISTS document_associations (
  document_id TEXT NOT NULL REFERENCES document_objects(id),
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (document_id, object_type, object_id)
);

CREATE TABLE IF NOT EXISTS document_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES document_objects(id),
  provider_revision TEXT NOT NULL,
  provider_version_id TEXT,
  etag TEXT,
  change_token TEXT,
  content_hash TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  source TEXT NOT NULL,
  snapshot_ref TEXT,
  provider_modified_at TEXT,
  observed_at TEXT NOT NULL,
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_document_versions_document ON document_versions(document_id, observed_at);

CREATE TABLE IF NOT EXISTS document_integration_events (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES document_objects(id),
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  provider TEXT NOT NULL,
  operation_id TEXT,
  receipt_id TEXT,
  idempotency_key TEXT,
  before_revision TEXT,
  after_revision TEXT,
  status TEXT NOT NULL,
  reason_code TEXT,
  sanitized_metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_document_integration_events_document ON document_integration_events(document_id, created_at);
`;

/** Discriminated result of the pre-create schema collision guard. */
export type DocumentIntegrationsCollisionLookup =
  | { ok: true; namesAlreadyCompatible: string[] }
  | { ok: false; table: string; detail: string };

/**
 * Collision guard. Before any unified table is created we verify each reserved name is
 * either absent or, if already present, exactly the additive schema we own (that is, it
 * was created by an earlier run of this same migration — NOT by an unrelated consumer
 * that would silently bind us to its incompatible shape, the MF-02 / PRD 11.4 hazard).
 * Returns the set of names that already exist with a compatible schema.
 */
export function detectDocumentIntegrationsCollisions(
  db: Database.Database,
): DocumentIntegrationsCollisionLookup {
  const existing = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type='table'")
    .all() as Array<{ name: string; sql: string | null }>;
  const byName = new Map(existing.map((t) => [t.name, t.sql]));

  const ourSql = new Map<string, string>();
  const ourTables = (DOCUMENT_INTEGRATIONS_SCHEMA_SQL.match(/CREATE TABLE IF NOT EXISTS (\w+)/g) ?? []).map(
    (m) => m.replace('CREATE TABLE IF NOT EXISTS ', ''),
  );
  for (const name of ourTables) {
    const block = DOCUMENT_INTEGRATIONS_SCHEMA_SQL.split('CREATE TABLE IF NOT EXISTS')
      .find((part) => part.trimStart().startsWith(name));
    ourSql.set(name, `CREATE TABLE IF NOT EXISTS${block ?? ''}`);
  }

  const alreadyCompatible: string[] = [];
  for (const name of DOCUMENT_INTEGRATION_TABLE_NAMES) {
    const present = byName.get(name);
    if (!present) {
      continue; // absent — safe to create
    }
    // Compare column set only (the observable schema), not formatting.
    const existingCols = extractColumnNamesFromSql(present);
    const expectedCols = extractColumnNamesFromSql(ourSql.get(name) ?? '');
    if (existingCols.length !== expectedCols.length) {
      return { ok: false, table: name, detail: `existing table has incompatible column set (${existingCols.join(', ')})` };
    }
    for (const col of expectedCols) {
      if (!existingCols.includes(col)) {
        return { ok: false, table: name, detail: `existing table is missing column '${col}'` };
      }
    }
    alreadyCompatible.push(name);
  }
  return { ok: true, namesAlreadyCompatible: alreadyCompatible };
}

function extractColumnNamesFromSql(sql: string): string[] {
  const cols: string[] = [];
  for (const match of sql.matchAll(/^\s*([a-z_][a-z0-9_]*)\s+(TEXT|INTEGER|BLOB|REAL|NUMERIC)\b/gim)) {
    cols.push(match[1]);
  }
  return cols;
}

export interface DocumentIntegrationsRepository {
  /** Apply the additive unified schema. Throws on an incompatible-schema collision. */
  ensureSchema(): SchemaAuditReport;
  /** Drop only the additive unified tables — the R-036 rollback path. */
  reverseSchema(): void;
  /** Insert a new canonical document. Throws loudly if the provider identity already exists. */
  createDocumentObject(input: CreateDocumentObjectInput): DocumentObjectRecord;
  /** Idempotent registration: dedupe on provider identity (R-001 rediscovery semantics). */
  registerDocumentObject(input: CreateDocumentObjectInput): RegistrationResult;
  getDocumentObject(id: string): DocumentObjectRecord | undefined;
  findDocumentByProviderIdentity(
    providerConnectionId: string | null,
    externalId: string,
  ): DocumentObjectRecord | undefined;
  associateDocument(documentId: string, objectType: string, objectId: string): void;
  recordDocumentVersion(input: CreateDocumentVersionInput): DocumentVersionRecord;
  listVersionRecords(documentId: string): DocumentVersionRecord[];
  appendEvent(input: CreateDocumentIntegrationEventInput): DocumentIntegrationEventRecord;
  listEvents(documentId: string): DocumentIntegrationEventRecord[];
}

/** The unified-table set guaranteed present after a successful migration. */
export const EXPECTED_UNIFIED_TABLES: readonly string[] = [
  'document_objects',
  'document_associations',
  'document_versions',
  'document_integration_events',
];

export function createDocumentIntegrationsRepository(db: Database.Database): DocumentIntegrationsRepository {
  function ensureSchema(): SchemaAuditReport {
    const verdict = detectDocumentIntegrationsCollisions(db);
    if (!verdict.ok) {
      throw new Error(
        `document-integrations schema collision on table '${verdict.table}': ${verdict.detail}`,
      );
    }
    db.exec(DOCUMENT_INTEGRATIONS_SCHEMA_SQL);
    return {
      tablesEnsured: [...EXPECTED_UNIFIED_TABLES],
      collision: { ok: true },
      destructiveChanges: false,
    };
  }

  function reverseSchema(): void {
    // Rollback is destructive ONLY to the additive unified tables. No legacy table is
    // ever dropped, so rolling application code back preserves old application semantics
    // (R-036: "Rolling application code back during the compatibility period does not
    // require recovering dropped legacy data").
    db.exec(`
      DROP TABLE IF EXISTS document_integration_events;
      DROP TABLE IF EXISTS document_versions;
      DROP TABLE IF EXISTS document_associations;
      DROP TABLE IF EXISTS document_objects;
    `);
  }

  function createDocumentObject(input: CreateDocumentObjectInput): DocumentObjectRecord {
    const id = input.id ?? randomUUID();
    const now = nowIso();
    try {
      db.prepare(`
        INSERT INTO document_objects (
          id, workspace_id, provider, artifact_type, title,
          provider_connection_id, destination_id, external_id, provider_url,
          owner_summary, tenant_external_id, permissions_summary_json, sensitivity_label,
          auth_state, readiness_state, degraded_reason_code, current_revision,
          provider_modified_at, indexed_at, preview_state, conflict_state,
          created_at, updated_at, deleted_at
        ) VALUES (
          @id, @workspace_id, @provider, @artifact_type, @title,
          @provider_connection_id, @destination_id, @external_id, @provider_url,
          @owner_summary, @tenant_external_id, @permissions_summary_json, @sensitivity_label,
          @auth_state, @readiness_state, @degraded_reason_code, @current_revision,
          @provider_modified_at, @indexed_at, @preview_state, @conflict_state,
          @created_at, @updated_at, NULL
        )
      `).run({
      id,
      workspace_id: input.workspace_id,
      provider: input.provider,
      artifact_type: input.artifact_type,
      title: input.title,
      provider_connection_id: input.provider_connection_id ?? null,
      destination_id: input.destination_id ?? null,
      external_id: input.external_id ?? null,
      provider_url: input.provider_url ?? null,
      owner_summary: input.owner_summary ?? null,
      tenant_external_id: input.tenant_external_id ?? null,
      permissions_summary_json: input.permissions_summary_json ?? null,
      sensitivity_label: input.sensitivity_label ?? null,
      auth_state: input.auth_state,
      readiness_state: input.readiness_state,
      degraded_reason_code: input.degraded_reason_code ?? null,
      current_revision: input.current_revision ?? null,
      provider_modified_at: input.provider_modified_at ?? null,
      indexed_at: input.indexed_at ?? null,
      preview_state: input.preview_state ?? 'not_requested',
      conflict_state: input.conflict_state ?? 'none',
      created_at: now,
      updated_at: now,
    });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/unique constraint|constraint failed/i.test(message) && input.external_id) {
        // Loud failure instead of silently binding a second record to the same
        // provider identity (R-001 uniqueness + R-036 fail-loud-on-collision).
        throw new Error(
          `document provider identity already exists: (provider_connection_id, external_id) ` +
            `= (${String(input.provider_connection_id ?? null)}, ${input.external_id})`,
        );
      }
      throw err;
    }
    const record = getDocumentObject(id);
    if (!record) {
      throw new Error('document object insert failed');
    }
    return record;
  }

  function registerDocumentObject(input: CreateDocumentObjectInput): RegistrationResult {
    const externalId = input.external_id ?? null;
    const connectionId = input.provider_connection_id ?? null;
    const existing = externalId
      ? findDocumentByProviderIdentity(connectionId, externalId)
      : undefined;
    if (existing) {
      // R-001: rediscovery updates the existing record, never creates a duplicate.
      const now = nowIso();
      db.prepare(`
        UPDATE document_objects SET
          title = @title,
          provider_url = COALESCE(@provider_url, provider_url),
          owner_summary = COALESCE(@owner_summary, owner_summary),
          tenant_external_id = COALESCE(@tenant_external_id, tenant_external_id),
          permissions_summary_json = COALESCE(@permissions_summary_json, permissions_summary_json),
          sensitivity_label = COALESCE(@sensitivity_label, sensitivity_label),
          auth_state = @auth_state,
          readiness_state = @readiness_state,
          degraded_reason_code = @degraded_reason_code,
          current_revision = COALESCE(@current_revision, current_revision),
          provider_modified_at = COALESCE(@provider_modified_at, provider_modified_at),
          preview_state = COALESCE(@preview_state, preview_state),
          conflict_state = COALESCE(@conflict_state, conflict_state),
          updated_at = @now
        WHERE id = @id
      `).run({
        id: existing.id,
        title: input.title,
        provider_url: input.provider_url ?? null,
        owner_summary: input.owner_summary ?? null,
        tenant_external_id: input.tenant_external_id ?? null,
        permissions_summary_json: input.permissions_summary_json ?? null,
        sensitivity_label: input.sensitivity_label ?? null,
        auth_state: input.auth_state,
        readiness_state: input.readiness_state,
        degraded_reason_code: input.degraded_reason_code ?? null,
        current_revision: input.current_revision ?? null,
        provider_modified_at: input.provider_modified_at ?? null,
        preview_state: input.preview_state ?? 'not_requested',
        conflict_state: input.conflict_state ?? 'none',
        now,
      });
      const record = getDocumentObject(existing.id);
      return { record: record as DocumentObjectRecord, created: false };
    }
    return { record: createDocumentObject(input), created: true };
  }

  function getDocumentObject(id: string): DocumentObjectRecord | undefined {
    const row = db
      .prepare('SELECT * FROM document_objects WHERE id = ?')
      .get(id) as DocumentObjectRecord | undefined;
    return row;
  }

  function findDocumentByProviderIdentity(
    providerConnectionId: string | null,
    externalId: string,
  ): DocumentObjectRecord | undefined {
    const row = db
      .prepare('SELECT * FROM document_objects WHERE provider_connection_id = ? AND external_id = ?')
      .get(providerConnectionId, externalId) as DocumentObjectRecord | undefined;
    return row;
  }

  function associateDocument(documentId: string, objectType: string, objectId: string): void {
    db.prepare(`
      INSERT OR IGNORE INTO document_associations (document_id, object_type, object_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(documentId, objectType, objectId, nowIso());
  }

  function recordDocumentVersion(input: CreateDocumentVersionInput): DocumentVersionRecord {
    const id = input.id ?? randomUUID();
    const now = nowIso();
    db.prepare(`
      INSERT INTO document_versions (
        id, document_id, provider_revision, provider_version_id, etag, change_token, content_hash,
        actor_type, actor_id, source, snapshot_ref, provider_modified_at, observed_at, metadata_json
      ) VALUES (
        @id, @document_id, @provider_revision, @provider_version_id, @etag, @change_token, @content_hash,
        @actor_type, @actor_id, @source, @snapshot_ref, @provider_modified_at, @observed_at, @metadata_json
      )
    `).run({
      id,
      document_id: input.document_id,
      provider_revision: input.provider_revision,
      provider_version_id: input.provider_version_id ?? null,
      etag: input.etag ?? null,
      change_token: input.change_token ?? null,
      content_hash: input.content_hash ?? null,
      actor_type: input.actor_type,
      actor_id: input.actor_id ?? null,
      source: input.source,
      snapshot_ref: input.snapshot_ref ?? null,
      provider_modified_at: input.provider_modified_at ?? null,
      observed_at: input.observed_at,
      metadata_json: input.metadata_json ?? null,
    });
    const row = db
      .prepare('SELECT * FROM document_versions WHERE id = ?')
      .get(id) as DocumentVersionRecord;
    if (!row) {
      throw new Error('document version insert failed');
    }
    return row;
  }

  function listVersionRecords(documentId: string): DocumentVersionRecord[] {
    return db
      .prepare('SELECT * FROM document_versions WHERE document_id = ? ORDER BY observed_at, id')
      .all(documentId) as DocumentVersionRecord[];
  }

  function appendEvent(input: CreateDocumentIntegrationEventInput): DocumentIntegrationEventRecord {
    const id = input.id ?? randomUUID();
    db.prepare(`
      INSERT INTO document_integration_events (
        id, document_id, event_type, actor_type, actor_id, provider,
        operation_id, receipt_id, idempotency_key, before_revision, after_revision,
        status, reason_code, sanitized_metadata_json, created_at
      ) VALUES (
        @id, @document_id, @event_type, @actor_type, @actor_id, @provider,
        @operation_id, @receipt_id, @idempotency_key, @before_revision, @after_revision,
        @status, @reason_code, @sanitized_metadata_json, @created_at
      )
    `).run({
      id,
      document_id: input.document_id,
      event_type: input.event_type,
      actor_type: input.actor_type,
      actor_id: input.actor_id ?? null,
      provider: input.provider,
      operation_id: input.operation_id ?? null,
      receipt_id: input.receipt_id ?? null,
      idempotency_key: input.idempotency_key ?? null,
      before_revision: input.before_revision ?? null,
      after_revision: input.after_revision ?? null,
      status: input.status,
      reason_code: input.reason_code ?? null,
      sanitized_metadata_json: input.sanitized_metadata_json ?? null,
      created_at: nowIso(),
    });
    const row = db
      .prepare('SELECT * FROM document_integration_events WHERE id = ?')
      .get(id) as DocumentIntegrationEventRecord;
    if (!row) {
      throw new Error('document integration event insert failed');
    }
    return row;
  }

  function listEvents(documentId: string): DocumentIntegrationEventRecord[] {
    return db
      .prepare('SELECT * FROM document_integration_events WHERE document_id = ? ORDER BY created_at, id')
      .all(documentId) as DocumentIntegrationEventRecord[];
  }

  return {
    ensureSchema,
    reverseSchema,
    createDocumentObject,
    registerDocumentObject,
    getDocumentObject,
    findDocumentByProviderIdentity,
    associateDocument,
    recordDocumentVersion,
    listVersionRecords,
    appendEvent,
    listEvents,
  };
}
