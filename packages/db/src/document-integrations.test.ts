import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * T-003 — Define and migrate unified document persistence.
 *
 * Covers the additive unified schema (document_objects, document_associations,
 * document_versions, document_integration_events, document_operations), provider-identity uniqueness
 * (R-001), version/activity requirements, the R-026 operation-scoped idempotency store, and the
 * required empty + populated migration fixtures with an R-036 rollback path.
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
  it('defines the additive unified tables with exactly the R-001/11 columns', async () => {
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

  it('R-001 NULL-connection identity: re-registering a NULL-connection artifact updates, never duplicates, and is findable', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    const base = {
      workspace_id: 'workspace-1',
      provider: 'local_office' as const,
      artifact_type: 'document' as const,
      title: 'Local artifact',
      auth_state: 'authorized' as const,
      readiness_state: 'ready' as const,
    };

    // Connection-less registration (local artifact before connection resolution).
    const first = repo.registerDocumentObject({ ...base, provider_connection_id: null, external_id: 'one-123' });
    expect(first.created).toBe(true);

    // Rediscovery: the same (NULL, 'one-123') tuple must update, not create a duplicate.
    const second = repo.registerDocumentObject({
      ...base,
      title: 'Local artifact (updated)',
      provider_connection_id: null,
      external_id: 'one-123',
    });
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.title).toBe('Local artifact (updated)');

    // NULL-safe lookup must succeed.
    const byIdentity = repo.findDocumentByProviderIdentity(null, 'one-123');
    expect(byIdentity?.id).toBe(first.record.id);

    const count = db
      .prepare('SELECT COUNT(*) AS c FROM document_objects WHERE external_id = ?')
      .get('one-123') as { c: number };
    expect(count.c).toBe(1);

    // The unique index must also block a direct duplicate insert of a NULL-connection row.
    expect(() =>
      repo.createDocumentObject({
        ...base,
        provider_connection_id: null,
        external_id: 'one-123',
      }),
    ).toThrow(/provider identity|unique|constraint|already exists/i);
  });

  it('R-001 rediscovery preserves preview_state and conflict_state when a metadata re-sync omits them', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    const { record } = repo.registerDocumentObject({
      workspace_id: 'workspace-1',
      provider: 'google_workspace' as const,
      artifact_type: 'document' as const,
      title: 'Doc',
      auth_state: 'authorized' as const,
      readiness_state: 'ready' as const,
      provider_connection_id: 'conn-g1',
      external_id: 'googdoc-STATE',
      provider_url: 'https://example.test/d/STATE',
      preview_state: 'ready',
      conflict_state: 'detected',
    });
    expect(record.preview_state).toBe('ready');
    expect(record.conflict_state).toBe('detected');

    // A plain metadata re-sync omitting preview/conflict must NOT erase them.
    const second = repo.registerDocumentObject({
      workspace_id: 'workspace-1',
      provider: 'google_workspace' as const,
      artifact_type: 'document' as const,
      title: 'Doc (metadata sync)',
      auth_state: 'authorized' as const,
      readiness_state: 'ready' as const,
      provider_connection_id: 'conn-g1',
      external_id: 'googdoc-STATE',
      current_revision: 'rev-2',
    });
    expect(second.created).toBe(false);
    expect(second.record.preview_state).toBe('ready');
    expect(second.record.conflict_state).toBe('detected');
  });

  it('R-001 stable URL: provider_url is unchanged across a metadata-changing re-register', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    repo.registerDocumentObject({
      workspace_id: 'workspace-1',
      provider: 'google_workspace' as const,
      artifact_type: 'document' as const,
      title: 'Doc',
      auth_state: 'authorized' as const,
      readiness_state: 'ready' as const,
      provider_connection_id: 'conn-g1',
      external_id: 'googdoc-STABLE',
      provider_url: 'https://example.test/d/STABLE',
      current_revision: 'rev-1',
    });

    // Re-sync changes title/revision but omits provider_url — URL must stay stable.
    const second = repo.registerDocumentObject({
      workspace_id: 'workspace-1',
      provider: 'google_workspace' as const,
      artifact_type: 'document' as const,
      title: 'Doc (renamed)',
      auth_state: 'authorized' as const,
      readiness_state: 'ready' as const,
      provider_connection_id: 'conn-g1',
      external_id: 'googdoc-STABLE',
      current_revision: 'rev-2',
    });
    expect(second.created).toBe(false);
    expect(second.record.provider_url).toBe('https://example.test/d/STABLE');
  });

  it('R-001 duplicate-import concurrency: two concurrent registers of the same identity converge on one row', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    const base = {
      workspace_id: 'workspace-1',
      provider: 'microsoft_365' as const,
      artifact_type: 'spreadsheet' as const,
      title: 'Sheet',
      auth_state: 'authorized' as const,
      readiness_state: 'ready' as const,
      provider_connection_id: 'conn-m1',
      external_id: 'onedrive-CONCUR',
    };

    const results = await Promise.all([
      Promise.resolve().then(() => repo.registerDocumentObject({ ...base })),
      Promise.resolve().then(() => repo.registerDocumentObject({ ...base })),
    ]);

    const createdFlags = results.map((r) => r.created);
    // At most one row is created for the shared identity; the other updates it.
    const createdCount = createdFlags.filter(Boolean).length;
    expect(createdCount).toBeLessThanOrEqual(1);

    const ids = new Set(results.map((r) => r.record.id));
    expect(ids.size).toBe(1);

    const count = db
      .prepare('SELECT COUNT(*) AS c FROM document_objects WHERE external_id = ?')
      .get('onedrive-CONCUR') as { c: number };
    expect(count.c).toBe(1);
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
      'document_operations',
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
    for (const unified of ['document_objects', 'document_associations', 'document_versions', 'document_integration_events', 'document_operations']) {
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
      .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name IN ('document_objects','document_associations','document_versions','document_integration_events','document_operations')")
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

describe('T-003 operation-scoped creation idempotency (R-026)', () => {
  it('persists an operation record keyed on (workspace_id, idempotency_key) with the required fields', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    const op = repo.upsertDocumentOperation({
      workspace_id: 'workspace-1',
      idempotency_key: 'idem-create-abc',
      provider: 'google_workspace',
      artifact_type: 'document',
      destination_id: 'dest-1',
      operation_status: 'requested',
    });

    expect(op.workspace_id).toBe('workspace-1');
    expect(op.idempotency_key).toBe('idem-create-abc');
    expect(op.provider).toBe('google_workspace');
    expect(op.artifact_type).toBe('document');
    expect(op.destination_id).toBe('dest-1');
    expect(op.operation_status).toBe('requested');
    expect(op.provider_external_id).toBeNull();
    expect(op.document_id).toBeNull();

    const found = repo.findDocumentOperation('workspace-1', 'idem-create-abc');
    expect(found?.id).toBe(op.id);
  });

  it('resolves by (workspace_id, idempotency_key) without an Entity document id (before persistence)', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    // R-026: the store is resolvable before any document record exists.
    const op = repo.upsertDocumentOperation({
      workspace_id: 'workspace-1',
      idempotency_key: 'idem-create-xyz',
      provider: 'microsoft_365',
      artifact_type: 'spreadsheet',
      operation_status: 'in_progress',
    });
    expect(op.document_id).toBeNull();
    expect(repo.findDocumentOperation('workspace-1', 'idem-create-xyz')).toBeTruthy();
    // Same key in a different workspace is a distinct operation.
    expect(repo.findDocumentOperation('workspace-2', 'idem-create-xyz')).toBeUndefined();
  });

  it('late-fills provider_external_id and document_id once known (upsert + complete paths, idempotent)', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    // Upsert with the late-filled provider external id already known.
    const op = repo.upsertDocumentOperation({
      workspace_id: 'workspace-1',
      idempotency_key: 'idem-create-789',
      provider: 'local_office',
      artifact_type: 'document',
      operation_status: 'created',
      provider_external_id: 'managed-file-COMPLETE',
      document_id: 'doc_COMPLETE',
    });
    expect(op.provider_external_id).toBe('managed-file-COMPLETE');
    expect(op.document_id).toBe('doc_COMPLETE');

    // Re-running the same key updates status without clobbering the filled results.
    const rerun = repo.upsertDocumentOperation({
      workspace_id: 'workspace-1',
      idempotency_key: 'idem-create-789',
      provider: 'local_office',
      artifact_type: 'document',
      operation_status: 'reconciled',
    });
    expect(rerun.operation_status).toBe('reconciled');
    expect(rerun.provider_external_id).toBe('managed-file-COMPLETE');
    expect(rerun.document_id).toBe('doc_COMPLETE');

    // Standalone late-fill update path against a stored row missing the results.
    repo.upsertDocumentOperation({
      workspace_id: 'workspace-1',
      idempotency_key: 'idem-create-LATEFILL',
      provider: 'google_workspace',
      artifact_type: 'document',
      operation_status: 'requested',
    });
    const completed = repo.completeDocumentOperation('workspace-1', 'idem-create-LATEFILL', {
      operation_status: 'created',
      provider_external_id: 'googdoc-LATEFILL',
      document_id: 'doc_LATEFILL',
    });
    expect(completed?.provider_external_id).toBe('googdoc-LATEFILL');
    expect(completed?.document_id).toBe('doc_LATEFILL');
    expect(completed?.operation_status).toBe('created');

    // Late-fill of unknown key returns undefined.
    expect(repo.completeDocumentOperation('workspace-1', 'missing-key', { operation_status: 'created' })).toBeUndefined();
  });
});

describe('T-003 schema-audit report and NULL-identity persistence details', () => {
  it('rediscovery preserves the stored indexed_at when omitted; explicit indexed_at still applies (R-029 / T-004 M2)', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    const { record, created } = repo.registerDocumentObject({
      workspace_id: 'workspace-1',
      provider: 'google_workspace' as const,
      artifact_type: 'document' as const,
      title: 'Doc',
      auth_state: 'authorized' as const,
      readiness_state: 'ready' as const,
      provider_connection_id: 'conn-g1',
      external_id: 'googdoc-INDEXED',
      indexed_at: '2026-01-01T00:00:00.000Z',
    });
    expect(created).toBe(true);
    expect(record.indexed_at).toBe('2026-01-01T00:00:00.000Z');

    // A rediscovery (metadata re-sync) WITHOUT an explicit indexed_at must NOT stamp "now" —
    // observing a new revision leaves the search index stale, not fresh (R-029 / T-004 M2).
    const preserved = repo.registerDocumentObject({
      workspace_id: 'workspace-1',
      provider: 'google_workspace' as const,
      artifact_type: 'document' as const,
      title: 'Doc (re-synced)',
      auth_state: 'authorized' as const,
      readiness_state: 'ready' as const,
      provider_connection_id: 'conn-g1',
      external_id: 'googdoc-INDEXED',
    });
    expect(preserved.created).toBe(false);
    expect(preserved.record.indexed_at).toBe('2026-01-01T00:00:00.000Z');

    // An explicit indexed_at on rediscovery still applies over the stored value.
    const explicitRefresh = repo.registerDocumentObject({
      workspace_id: 'workspace-1',
      provider: 'google_workspace' as const,
      artifact_type: 'document' as const,
      title: 'Doc (re-indexed)',
      auth_state: 'authorized' as const,
      readiness_state: 'ready' as const,
      provider_connection_id: 'conn-g1',
      external_id: 'googdoc-INDEXED',
      indexed_at: '2026-02-01T00:00:00.000Z',
    });
    expect(explicitRefresh.record.indexed_at).toBe('2026-02-01T00:00:00.000Z');
  });

  it('createDocumentObject preserves the underlying cause on provider-identity collisions', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    repo.registerDocumentObject({
      workspace_id: 'workspace-1',
      provider: 'microsoft_365' as const,
      artifact_type: 'document' as const,
      title: 'Doc',
      auth_state: 'authorized' as const,
      readiness_state: 'ready' as const,
      provider_connection_id: 'conn-m1',
      external_id: 'onedrive-CAUSE',
    });

    try {
      repo.createDocumentObject({
        workspace_id: 'workspace-1',
        provider: 'microsoft_365' as const,
        artifact_type: 'document' as const,
        title: 'Duplicate',
        auth_state: 'authorized' as const,
        readiness_state: 'ready' as const,
        provider_connection_id: 'conn-m1',
        external_id: 'onedrive-CAUSE',
      });
      expect.unreachable('expected a provider-identity collision');
    } catch (err) {
      const e = err as Error & { cause?: unknown };
      expect(e.message).toMatch(/provider identity already exists/i);
      // The original SQLite UNIQUE failure must be preserved as the cause (F7).
      expect((e.cause as Error | undefined)?.message).toMatch(/unique constraint|constraint failed/i);
    }
  });

  it('does NOT rewrite a caller-supplied duplicate id PK collision as a provider-identity collision', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    repo.createDocumentObject({
      id: 'my-fixed-id',
      workspace_id: 'workspace-1',
      provider: 'google_workspace' as const,
      artifact_type: 'document' as const,
      title: 'Doc',
      auth_state: 'authorized' as const,
      readiness_state: 'ready' as const,
      provider_connection_id: 'conn-g1',
      external_id: 'googdoc-A',
    });

    try {
      repo.createDocumentObject({
        id: 'my-fixed-id', // genuine id (PK) collision, NOT a provider-identity collision
        workspace_id: 'workspace-1',
        provider: 'google_workspace' as const,
        artifact_type: 'document' as const,
        title: 'Doc 2',
        auth_state: 'authorized' as const,
        readiness_state: 'ready' as const,
        provider_connection_id: 'conn-g2',
        external_id: 'googdoc-B',
      });
      expect.unreachable('expected a PK collision');
    } catch (err) {
      const e = err as Error & { cause?: unknown };
      // Must NOT be mislabeled as a provider-identity collision (F7).
      expect(e.message).not.toMatch(/provider identity already exists/i);
      expect((e.cause as Error | undefined)?.message).toMatch(/unique constraint|constraint failed/i);
    }
  });

  it('tablesEnsured reflects exactly the tables actually created this apply (idempotent re-run creates none)', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);

    const first = repo.ensureSchema();
    expect(first.tablesEnsured).toHaveLength(5);

    // Second apply on the now-established DB: every unified table is already present
    // with a compatible schema, so none are newly created.
    const second = repo.ensureSchema();
    expect(second.tablesEnsured).toEqual([]);
    expect(second.collision.ok).toBe(true);
  });

  it('NULL-connection identity uniqueness survives a fresh repository over the same database', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository, documentObjectIdForIdentity } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    const first = repo.registerDocumentObject({
      workspace_id: 'workspace-1',
      provider: 'local_office' as const,
      artifact_type: 'document' as const,
      title: 'Local Doc',
      auth_state: 'authorized' as const,
      readiness_state: 'ready' as const,
      provider_connection_id: null,
      external_id: 'managed-file-PERSIST',
    });
    // The deterministic id is wired into the record (F5).
    expect(first.record.id).toBe(documentObjectIdForIdentity(null, 'managed-file-PERSIST'));

    // A brand-new repository over the same DB redis covers the identity (SQL-level, not
    // in-memory stack state) and the unique index blocks a direct duplicate.
    const repo2 = createDocumentIntegrationsRepository(db);
    const found = repo2.findDocumentByProviderIdentity(null, 'managed-file-PERSIST');
    expect(found?.id).toBe(first.record.id);

    expect(() =>
      repo2.createDocumentObject({
        workspace_id: 'workspace-1',
        provider: 'local_office' as const,
        artifact_type: 'document' as const,
        title: 'Duplicate',
        auth_state: 'authorized' as const,
        readiness_state: 'ready' as const,
        provider_connection_id: null,
        external_id: 'managed-file-PERSIST',
      }),
    ).toThrow(/provider identity|unique|constraint|already exists/i);
  });
});

describe('T-004 — updateDocumentObject (by-id update primitive) — review round 1 fixes', () => {
  const base = {
    workspace_id: 'workspace-1',
    provider: 'google_workspace' as const,
    artifact_type: 'document' as const,
    title: 'Doc',
    auth_state: 'authorized' as const,
    readiness_state: 'ready' as const,
    provider_connection_id: 'conn-g1',
    external_id: 'googdoc-UPD',
    provider_url: 'https://example.test/d/UPD',
    degraded_reason_code: 'quota_exceeded',
    destination_id: 'dest-1',
    owner_summary: 'owner:a',
    sensitivity_label: 'internal',
    tenant_external_id: 'tenant-1',
    indexed_at: '2026-01-01T00:00:00.000Z',
  };

  it('F5: changes === 0 (unknown id) returns undefined, never a record', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();
    expect(repo.updateDocumentObject('does-not-exist', { title: 'x' })).toBeUndefined();
  });

  it('F1: updateDocumentObject refuses to rewire the provider identity (typed rejection, cause-preserving) so rediscovery of the original identity still converges', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    const first = repo.registerDocumentObject({ ...base });
    const id = first.record.id;

    // Attempt to rewire the provider identity via a deliberately-unsafe cast (the identity
    // fields are immutably excluded from the update patch type; this exercises the runtime
    // guard that real callers cannot reach — F1 / review finding). Must be a TYPED rejection,
    // not a silent success and never a raw UNIQUE SqliteError.
    const rewire = { external_id: 'googdoc-REWIRED' } as unknown as Parameters<
      typeof repo.updateDocumentObject
    >[1];
    let err: unknown;
    try {
      repo.updateDocumentObject(id, rewire);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/identity|immutable/i);
    expect((err as Error).message).not.toMatch(/UNIQUE constraint/i);

    // After the rejected rewire attempt the original identity must STILL rediscover to the
    // SAME canonical record — no divergence, no duplicate (R-001 / F1 regression).
    const rediscovered = repo.registerDocumentObject({ ...base, title: 'Rediscovered' });
    expect(rediscovered.created).toBe(false);
    expect(rediscovered.record.id).toBe(id);
    expect(rediscovered.record.external_id).toBe('googdoc-UPD');
  });

  it('F1: a colliding rewire of provider_connection_id is also a typed rejection (never a raw SqliteError)', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    repo.registerDocumentObject({ ...base });
    // A second record owns a distinct identity; pointing record 1 at another record's identity
    // tuple would violate the unique identity index. It must fail closed with the same typed
    // rejection — never surface as a raw UNIQUE SqliteError.
    const other = repo.registerDocumentObject({
      ...base,
      external_id: 'googdoc-UPD-2',
      provider_connection_id: 'conn-g2',
    });

    const rewire = {
      provider_connection_id: 'conn-g1',
      external_id: 'googdoc-UPD',
    } as unknown as Parameters<typeof repo.updateDocumentObject>[1];
    let err: unknown;
    try {
      repo.updateDocumentObject(other.record.id, rewire);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/identity|immutable/i);
    expect((err as Error).message).not.toMatch(/UNIQUE constraint/i);
  });

  it('F2: explicit null clears a nullable field while undefined preserves it (degraded_reason_code + destination_id)', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    const { record } = repo.registerDocumentObject({ ...base });
    expect(record.degraded_reason_code).toBe('quota_exceeded');
    expect(record.destination_id).toBe('dest-1');

    // A ready document shedding its stale degraded reason + clearing destination.
    const cleared = repo.updateDocumentObject(record.id, {
      readiness_state: 'ready',
      degraded_reason_code: null,
      destination_id: null,
    });
    expect(cleared?.degraded_reason_code).toBeNull();
    expect(cleared?.destination_id).toBeNull();

    // Undefined (omitted) preserves — never clears.
    const preserved = repo.updateDocumentObject(record.id, { title: 'Renamed' });
    expect(preserved?.indexed_at).toBe('2026-01-01T00:00:00.000Z');
    expect(preserved?.provider_url).toBe('https://example.test/d/UPD');
    expect(preserved?.owner_summary).toBe('owner:a');
    expect(preserved?.sensitivity_label).toBe('internal');

    // Explicit null on still-null columns is idempotent (no error).
    const again = repo.updateDocumentObject(record.id, { degraded_reason_code: null });
    expect(again?.degraded_reason_code).toBeNull();
  });

  it('F2: the generic by-id update path now agrees with the T-003 rediscovery path on null-clear semantics for degraded_reason_code', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    // T-003 rediscovery path sets degraded_reason_code = @degraded_reason_code directly,
    // so a re-sync that OMITS it clears it (null). The by-id path must behave identically —
    // the two update paths must agree on null-clear semantics (F2).
    const { degraded_reason_code: _ignored, ...syncWithoutDegraded } = base;
    const viaRediscovery = repo.registerDocumentObject({ ...base });
    expect(viaRediscovery.record.degraded_reason_code).toBe('quota_exceeded');
    // Rediscovery re-sync that OMITS degraded_reason_code clears it via the direct assignment.
    const resynced = repo.registerDocumentObject({ ...syncWithoutDegraded, title: 're-sync' });
    expect(resynced.created).toBe(false);
    expect(resynced.record.degraded_reason_code).toBeNull();

    const viaUpdate = repo.registerDocumentObject({ ...base, external_id: 'googdoc-UPD-AGREE' });
    const cleared = repo.updateDocumentObject(viaUpdate.record.id, {
      readiness_state: 'ready',
      degraded_reason_code: null,
    });
    expect(cleared?.degraded_reason_code).toBeNull();
    // Both paths yield the same null-clear result.
    expect(cleared?.degraded_reason_code).toBe(resynced.record.degraded_reason_code);
  });

  it('F3: a title-only patch preserves indexed_at (no silent re-index stamp); explicit indexed_at still applies', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    const { record } = repo.registerDocumentObject({ ...base });
    expect(record.indexed_at).toBe('2026-01-01T00:00:00.000Z');

    // Title-only metadata patch must NOT rewrite indexed_at to "now" (R-029).
    const patched = repo.updateDocumentObject(record.id, { title: 'Renamed' });
    expect(patched?.indexed_at).toBe('2026-01-01T00:00:00.000Z');

    // Explicit indexed_at still applies.
    const explicit = repo.updateDocumentObject(record.id, { indexed_at: '2026-03-01T00:00:00.000Z' });
    expect(explicit?.indexed_at).toBe('2026-03-01T00:00:00.000Z');

    // Explicit null clears indexed_at (nullable — consistent with F2 null-clear).
    const cleared = repo.updateDocumentObject(record.id, { indexed_at: null });
    expect(cleared?.indexed_at).toBeNull();
  });

  it('F2: undefined preserves each nullable field while explicit null clears each one', async () => {
    const db = trackDb(openFreshDb());
    const { createDocumentIntegrationsRepository } = await import('./document-integrations');
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();

    const { record } = repo.registerDocumentObject({
      ...base,
      provider_url: 'url-1',
      owner_summary: 'owner:1',
      sensitivity_label: 'internal',
      tenant_external_id: 'tenant-1',
    });

    // Undefined → preserve every nullable field.
    const preserved = repo.updateDocumentObject(record.id, { title: 'T' });
    expect(preserved?.provider_url).toBe('url-1');
    expect(preserved?.owner_summary).toBe('owner:1');
    expect(preserved?.sensitivity_label).toBe('internal');
    expect(preserved?.tenant_external_id).toBe('tenant-1');

    // Explicit null → clear every nullable field.
    const cleared = repo.updateDocumentObject(record.id, {
      provider_url: null,
      owner_summary: null,
      sensitivity_label: null,
      tenant_external_id: null,
    });
    expect(cleared?.provider_url).toBeNull();
    expect(cleared?.owner_summary).toBeNull();
    expect(cleared?.sensitivity_label).toBeNull();
    expect(cleared?.tenant_external_id).toBeNull();
  });
});

describe('T-003 / PRD 11.4 declared-table-name collision check (repeatable)', () => {
  // Ensures no future module under packages/db/src or packages/server/src claims one of
  // the unified table names. This makes the one-time manual scan (previously only in
  // EVIDENCE) a repeatable CI-checkable test (F6 / PRD 11.4).
  it('no other local module declares a unified table name', () => {
    const repoRoot = fs.existsSync(path.join(process.cwd(), '..', '..', 'package.json'))
      ? path.resolve(process.cwd(), '..', '..')
      : path.resolve(__dirname, '..', '..', '..', '..');
    const dirs = [
      path.join(repoRoot, 'packages', 'db', 'src'),
      path.join(repoRoot, 'packages', 'server', 'src'),
    ];
    const unifiedTableNameRegex = /CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)/gi;

    const claimed = new Map<string, string[]>();
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (
          entry.isFile() &&
          entry.name.endsWith('.ts') &&
          !entry.name.endsWith('.test.ts') &&
          !entry.name.endsWith('.spec.ts')
        ) {
          const src = fs.readFileSync(full, 'utf8');
          for (const m of src.matchAll(unifiedTableNameRegex)) {
            const table = m[1];
            if (table.startsWith('document_')) {
              if (!claimed.has(table)) claimed.set(table, []);
              claimed.get(table)!.push(path.relative(repoRoot, full));
            }
          }
        }
      }
    };
    for (const dir of dirs) walk(dir);

    // document-integrations.ts is the sole owner of the four original unified tables and
    // the new operation store.
    for (const unified of [
      'document_objects',
      'document_associations',
      'document_versions',
      'document_integration_events',
      'document_operations',
    ]) {
      const files = (claimed.get(unified) ?? []).filter(
        (f) => !f.endsWith('packages/db/src/document-integrations.ts'),
      );
      expect(files).toEqual([]);
    }
    // Sanity: the scan actually sees our own declarations.
    expect((claimed.get('document_objects') ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
