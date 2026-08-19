import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * T-003 — Define and migrate unified document persistence.
 *
 * Covers the additive unified schema (document_objects, document_associations,
 * document_versions, document_integration_events), provider-identity uniqueness
 * (R-001), version/activity requirements, and the required empty + populated
 * migration fixtures with an R-036 rollback path.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md
 * - R-001 "Canonical document object" (section 11.1-11.4)
 * - R-036 "Database migration safety"
 *
 * Never persists credentials, raw tokens, tenant secrets, or document contents.
 */

function openFreshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

const openDatabases: Database.Database[] = [];

function trackDb(db: Database.Database): Database.Database {
  openDatabases.push(db);
  return db;
}

afterEach(() => {
  for (const db of openDatabases.splice(0)) {
    db.close();
  }
});

/**
 * Synthetic legacy Google V1 fixture: the pre-unified `external_document_refs`
 * table (as created by packages/db/src/index.ts) holding representative Google
 * connector rows. R-036 requires the unified migration to preserve this data.
 */
function seedLegacyGoogleFixture(db: Database.Database): void {
  db.exec(`
    CREATE TABLE external_document_refs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      connector_type TEXT NOT NULL,
      external_id TEXT,
      external_url TEXT,
      title TEXT NOT NULL,
      auth_state TEXT NOT NULL DEFAULT 'unknown',
      readiness_state TEXT NOT NULL DEFAULT 'unknown',
      granted_scopes_json TEXT NOT NULL DEFAULT '[]',
      missing_scopes_json TEXT NOT NULL DEFAULT '[]',
      capabilities_json TEXT NOT NULL DEFAULT '{}',
      canonicality TEXT NOT NULL DEFAULT 'unknown',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO external_document_refs
      (id, org_id, connector_type, external_id, external_url, title)
    VALUES
      ('legacy-ref-1', 'org-1', 'google_workspace', 'googdoc-AAA', 'https://example.test/d/AAA', 'Legacy Google Doc'),
      ('legacy-ref-2', 'org-1', 'google_workspace', 'googdoc-BBB', 'https://example.test/d/BBB', 'Legacy Google Sheet');
  `);
}

describe('T-003 unified document persistence schema', () => {
  it('defines the four additive unified tables with exactly the R-001/11 columns', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const tableNames = names.map((n) => n.name);
    // Distinct from the already-claimed `document_events` (MF-02): we must not claim it.
    expect(tableNames).not.toContain('document_events');
    for (const expected of [
      'document_objects',
      'document_associations',
      'document_versions',
      'document_integration_events',
    ]) {
      expect(tableNames).toContain(expected);
    }
  });

  it('enforces provider-identity uniqueness (provider_connection_id, external_id) when external_id is non-null', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    const base = {
      workspace_id: 'workspace-1',
      provider: 'google_workspace' as const,
      artifact_type: 'document' as const,
      title: 'Q3 Plan',
      auth_state: 'authorized' as const,
      readiness_state: 'ready' as const,
    };

    const first = repo.registerDocumentObject({
      ...base,
      provider_connection_id: 'conn-g1',
      external_id: 'googdoc-AAA',
    });
    expect(first.created).toBe(true);

    // R-001: rediscovery from the same provider identity must update, not duplicate.
    const second = repo.registerDocumentObject({
      ...base,
      title: 'Q3 Plan (updated)',
      current_revision: 'rev-2',
      provider_connection_id: 'conn-g1',
      external_id: 'googdoc-AAA',
    });
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.title).toBe('Q3 Plan (updated)');

    const byIdentity = repo.findDocumentByProviderIdentity('conn-g1', 'googdoc-AAA');
    expect(byIdentity?.id).toBe(first.record.id);

    // Same external provider artifact id under a different connection is a distinct record.
    const otherConn = repo.registerDocumentObject({
      ...base,
      provider_connection_id: 'conn-g2',
      external_id: 'googdoc-AAA',
    });
    expect(otherConn.created).toBe(true);
    expect(otherConn.record.id).not.toBe(first.record.id);

    const count = db
      .prepare('SELECT COUNT(*) AS c FROM document_objects')
      .get() as { c: number };
    expect(count.c).toBe(2);
  });

  it('rejects an explicit create that duplicates a provider identity with a loud error', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    repo.registerDocumentObject({
      workspace_id: 'workspace-1',
      provider: 'microsoft_365' as const,
      artifact_type: 'spreadsheet' as const,
      title: 'Budget',
      auth_state: 'authorized' as const,
      readiness_state: 'ready' as const,
      provider_connection_id: 'conn-m1',
      external_id: 'onedrive-123',
    });

    expect(() =>
      repo.createDocumentObject({
        workspace_id: 'workspace-1',
        provider: 'microsoft_365' as const,
        artifact_type: 'spreadsheet' as const,
        title: 'Budget duplicate',
        auth_state: 'authorized' as const,
        readiness_state: 'ready' as const,
        provider_connection_id: 'conn-m1',
        external_id: 'onedrive-123',
      }),
    ).toThrow(/provider identity/i);
  });

  it('requires the R-001 CHECK constraints: provider and artifact_type', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    expect(() =>
      repo.registerDocumentObject({
        workspace_id: 'w',
        provider: 'slack' as never,
        artifact_type: 'document' as const,
        title: 'Bad provider',
        auth_state: 'authorized' as const,
        readiness_state: 'ready' as const,
      }),
    ).toThrow();

    expect(() =>
      repo.registerDocumentObject({
        workspace_id: 'w',
        provider: 'google_workspace' as const,
        artifact_type: 'slides' as never,
        title: 'Bad artifact',
        auth_state: 'authorized' as const,
        readiness_state: 'ready' as const,
      }),
    ).toThrow();
  });

  it('records versions (R-001 revision/version/ETag/change token) for a document', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    const { record } = repo.registerDocumentObject({
      workspace_id: 'workspace-1',
      provider: 'google_workspace' as const,
      artifact_type: 'document' as const,
      title: 'Versioned Doc',
      auth_state: 'authorized' as const,
      readiness_state: 'ready' as const,
      current_revision: 'rev-1',
      provider_connection_id: 'conn-g1',
      external_id: 'googdoc-CCC',
    });

    const v1 = repo.recordDocumentVersion({
      document_id: record.id,
      provider_revision: 'rev-1',
      provider_version_id: 'gv-1',
      etag: 'etag-1',
      change_token: 'ct-1',
      actor_type: 'agent',
      actor_id: 'ada',
      source: 'provider',
      observed_at: '2026-08-01T00:00:00.000Z',
      provider_modified_at: '2026-08-01T00:00:00.000Z',
    });
    const v2 = repo.recordDocumentVersion({
      document_id: record.id,
      provider_revision: 'rev-2',
      provider_version_id: 'gv-2',
      etag: 'etag-2',
      change_token: 'ct-2',
      actor_type: 'human',
      actor_id: 'henry',
      source: 'reconcile',
      observed_at: '2026-08-02T00:00:00.000Z',
      provider_modified_at: '2026-08-02T00:00:00.000Z',
    });

    expect(v1.document_id).toBe(record.id);
    expect(v2.provider_revision).toBe('rev-2');
    const versions = repo.listVersionRecords(record.id);
    expect(versions.map((v) => v.provider_revision).sort()).toEqual(['rev-1', 'rev-2']);

    // snapshot_ref may be null for cloud versions where the provider is authoritative.
    expect(v1.snapshot_ref).toBeNull();

    const count = db
      .prepare('SELECT COUNT(*) AS c FROM document_versions WHERE document_id = ?')
      .get(record.id) as { c: number };
    expect(count.c).toBe(2);
  });

  it('appends activity events to document_integration_events (distinct from claimed document_events)', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    const { record } = repo.registerDocumentObject({
      workspace_id: 'workspace-1',
      provider: 'microsoft_365' as const,
      artifact_type: 'presentation' as const,
      title: 'Deck',
      auth_state: 'authorized' as const,
      readiness_state: 'ready' as const,
      provider_connection_id: 'conn-m1',
      external_id: 'onedrive-456',
    });

    const evt = repo.appendEvent({
      document_id: record.id,
      event_type: 'human_edit',
      actor_type: 'human',
      actor_id: 'henry',
      provider: 'microsoft_365',
      operation_id: 'op-1',
      receipt_id: 'receipt-1',
      idempotency_key: 'idem-1',
      before_revision: 'rev-1',
      after_revision: 'rev-2',
      status: 'completed',
      reason_code: 'ok',
    });

    expect(evt.document_id).toBe(record.id);
    expect(evt.after_revision).toBe('rev-2');
    expect(evt.receipt_id).toBe('receipt-1');

    const events = repo.listEvents(record.id);
    expect(events.map((e) => e.event_type)).toEqual(['human_edit']);
    // No secret/metadata body persisted by default.
    expect(evt.sanitized_metadata_json).toBeNull();
  });

  it('records project/task associations via document_associations', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    const { record } = repo.registerDocumentObject({
      workspace_id: 'workspace-1',
      provider: 'local_office' as const,
      artifact_type: 'document' as const,
      title: 'Local Notes',
      auth_state: 'authorized' as const,
      readiness_state: 'ready' as const,
      provider_connection_id: 'conn-local',
      external_id: 'managed-file-1',
    });

    repo.associateDocument(record.id, 'task', 'task-9');
    repo.associateDocument(record.id, 'project', 'project-3');
    repo.associateDocument(record.id, 'task', 'task-9'); // idempotent by PK

    const assoc = db
      .prepare('SELECT object_type, object_id FROM document_associations WHERE document_id = ? ORDER BY object_type')
      .all(record.id) as Array<{ object_type: string; object_id: string }>;
    expect(assoc).toEqual([
      { object_type: 'project', object_id: 'project-3' },
      { object_type: 'task', object_id: 'task-9' },
    ]);
  });
});

describe('T-003 / R-036 migration fixtures (empty + populated) and rollback', () => {
  it('empty fixture: applies additive schema on a fresh database', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    const report = repo.ensureSchema();

    expect(report.tablesEnsured).toEqual([
      'document_objects',
      'document_associations',
      'document_versions',
      'document_integration_events',
    ]);
    expect(report.collision).toEqual({ ok: true });
    expect(report.destructiveChanges).toBe(false);

    // Idempotent: a second apply does not fail or duplicate.
    const second = repo.ensureSchema();
    expect(second.collision.ok).toBe(true);
  });

  it('populated fixture: preserves legacy Google V1 rows while adding unified tables (R-036)', async () => {
    const db = trackDb(openFreshDb());
    seedLegacyGoogleFixture(db);
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);

    const legacyBefore = db
      .prepare('SELECT COUNT(*) AS c FROM external_document_refs')
      .get() as { c: number };
    expect(legacyBefore.c).toBe(2);

    const report = repo.ensureSchema();
    expect(report.collision.ok).toBe(true);
    expect(report.destructiveChanges).toBe(false);

    // Legacy data is still there untouched — the requirement R-036 "must not
    // destructively delete existing Google V1 data during initial rollout".
    const legacyAfter = db
      .prepare("SELECT id, external_id FROM external_document_refs WHERE connector_type='google_workspace' ORDER BY id")
      .all() as Array<{ id: string; external_id: string }>;
    expect(legacyAfter).toEqual([
      { id: 'legacy-ref-1', external_id: 'googdoc-AAA' },
      { id: 'legacy-ref-2', external_id: 'googdoc-BBB' },
    ]);

    const won = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='document_objects'")
      .get();
    expect(won).toBeTruthy();
  });

  it('collision guard: refuses to bind a unified table already present with an incompatible schema', async () => {
    const db = trackDb(openFreshDb());
    // Simulate an incompatible pre-existing table that would otherwise silently bind.
    db.exec('CREATE TABLE document_objects (id INTEGER PRIMARY KEY, weird_column TEXT)');
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);

    expect(() => repo.ensureSchema()).toThrow(/collision|incompatible|document_objects/i);
  });

  it('collision guard: verifies reserved names are absent from the running database before create', async () => {
    const db = trackDb(openFreshDb());
    const { DOCUMENT_INTEGRATION_TABLE_NAMES } = await import('./document-integrations');
    // Reserved names must not already be claimed by plugin/other DDL.
    const existing = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    const names = new Set(existing.map((n) => n.name));
    // `document_events` is claimed by agent-api.ts and must NOT be one of ours.
    expect(DOCUMENT_INTEGRATION_TABLE_NAMES).not.toContain('document_events');
    for (const reserved of DOCUMENT_INTEGRATION_TABLE_NAMES) {
      expect(names.has(reserved)).toBe(false);
    }
  });

  it('rollback: reverses only the additive unified tables, preserving old application semantics (R-036)', async () => {
    const db = trackDb(openFreshDb());
    seedLegacyGoogleFixture(db);
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    // Old application semantics kept reading from the legacy table after upgrade.
    const legacyKept = db
      .prepare('SELECT COUNT(*) AS c FROM external_document_refs')
      .get() as { c: number };
    expect(legacyKept.c).toBe(2);

    // Rolling back drops only the unified (additive) tables — legacy data is never
    // recovered-from/deleted, so old app code keeps working unchanged.
    repo.reverseSchema();
    const remaining = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = remaining.map((n) => n.name);
    for (const unified of ['document_objects', 'document_associations', 'document_versions', 'document_integration_events']) {
      expect(names).not.toContain(unified);
    }
    expect(names).toContain('external_document_refs');

    // Post-rollback the legacy rows remain intact.
    const legacyAfterRollback = db
      .prepare('SELECT COUNT(*) AS c FROM external_document_refs')
      .get() as { c: number };
    expect(legacyAfterRollback.c).toBe(2);
  });

  it('security: no credential columns are present in any unified table', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    const rows = db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name IN ('document_objects','document_associations','document_versions','document_integration_events')")
      .all() as Array<{ name: string; sql: string }>;
    for (const row of rows) {
      const lower = row.sql.toLowerCase();
      // Raw credentials prohibited (PRD 11.5: "Raw credentials are prohibited.").
      expect(lower).not.toMatch(/\b(access_token|refresh_token|client_secret|password|api_key|secret|credential|token)\b/);
    }
  });
});

describe('T-003 helper edge cases', () => {
  it('creates a stable deterministic Entity document ID for a given identity tuple', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository, documentObjectIdForIdentity } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    const a = documentObjectIdForIdentity('conn-g1', 'googdoc-AAA');
    const b = documentObjectIdForIdentity('conn-g1', 'googdoc-AAA');
    const c = documentObjectIdForIdentity('conn-g2', 'googdoc-AAA');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^doc_[a-z0-9]{12}$/);
  });

  it('returns undefined for a missing document / unknown identity lookup', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    expect(repo.getDocumentObject('does-not-exist')).toBeUndefined();
    expect(repo.findDocumentByProviderIdentity('conn-x', 'external-x')).toBeUndefined();
    expect(repo.listVersionRecords('does-not-exist')).toEqual([]);
    expect(repo.listEvents('does-not-exist')).toEqual([]);
  });

  it('rejects a version record for a non-existent document (foreign key integrity)', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    expect(() =>
      repo.recordDocumentVersion({
        document_id: randomUUID(),
        provider_revision: 'rev-1',
        actor_type: 'agent',
        actor_id: 'ada',
        source: 'provider',
        observed_at: '2026-08-01T00:00:00.000Z',
      }),
    ).toThrow(/foreign key|constraint/i);
  });
});
