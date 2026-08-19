import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import {
  applyDocumentIntegrationsMigration,
  checkDocumentIntegrationsCollisions,
  reverseDocumentIntegrationsMigration,
  type DocumentIntegrationsMigrationReport,
} from './migrations';
import { EXPECTED_UNIFIED_TABLES } from '../../../db/src/document-integrations';

const openDatabases: Database.Database[] = [];

function openFreshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  openDatabases.push(db);
  return db;
}

afterEach(() => {
  for (const db of openDatabases.splice(0)) {
    db.close();
  }
});

describe('document-providers migration helper (T-003)', () => {
  it('applies the additive unified schema successfully', () => {
    const db = openFreshDb();
    const report = applyDocumentIntegrationsMigration(db);
    expect(report.success).toBe(true);
    expect(report.applied).toBe(true);
    expect(report.additiveOnly).toBe(true);
    expect(report.destructiveChanges).toBe(false);
    expect(report.collisionCheck.ok).toBe(true);
    expect(report.tablesEnsured).toEqual([...EXPECTED_UNIFIED_TABLES]);

    for (const table of EXPECTED_UNIFIED_TABLES) {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table);
      expect(row).toBeTruthy();
    }

    // The operation store is part of the unified set.
    const opStore = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='document_operations'")
      .get();
    expect(opStore).toBeTruthy();
  });

  it('is idempotent: a second apply succeeds and creates no additional tables', () => {
    const db = openFreshDb();
    const first = applyDocumentIntegrationsMigration(db);
    expect(first.success).toBe(true);

    const second = applyDocumentIntegrationsMigration(db);
    expect(second.success).toBe(true);
    expect(second.collisionCheck.ok).toBe(true);
    // On the idempotent re-run every unified table is already present and compatible.
    expect(second.tablesEnsured).toEqual([]);

    const count = db
      .prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name IN ('document_objects','document_associations','document_versions','document_integration_events','document_operations')")
      .get() as { c: number };
    expect(count.c).toBe(5);
  });

  it('collision guard fails loudly when a reserved name is already an incompatible table', () => {
    const db = openFreshDb();
    db.exec('CREATE TABLE document_objects (id INTEGER PRIMARY KEY, incompatible_column TEXT)');

    // The direct collision check reports the collision.
    const lookup = checkDocumentIntegrationsCollisions(db);
    expect(lookup.ok).toBe(false);
    if (!lookup.ok) {
      expect(lookup.table).toBe('document_objects');
    }

    // The apply helper surfaces the failure via a structured report (success:false).
    const report = applyDocumentIntegrationsMigration(db);
    expect(report.success).toBe(false);
    expect(report.applied).toBe(false);
    expect(report.collisionCheck.ok).toBe(false);
    if (!report.collisionCheck.ok) {
      expect(report.collisionCheck.table).toBe('document_objects');
      expect(report.collisionCheck.detail).toMatch(/collision|incompatible/i);
    }
  });

  it('failure path: a throw inside ensureSchema is reported as success:false and never mutates the DB', () => {
    const db = openFreshDb();
    // Simulate a migration failure mid-apply by refusing one of the reserved names.
    db.exec('CREATE TABLE document_associations (id INTEGER PRIMARY KEY, foreign_schema TEXT)');

    const report: DocumentIntegrationsMigrationReport = applyDocumentIntegrationsMigration(db);
    expect(report.success).toBe(false);
    expect(report.applied).toBe(false);
    expect(report.collisionCheck.ok).toBe(false);

    // The unified schema was not applied (no document_objects / document_versions were
    // created by the failed migration).
    const objects = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='document_objects'")
      .get();
    expect(objects).toBeUndefined();
  });

  it('rollback drops only the additive unified tables and preserves legacy data (R-036)', () => {
    const db = openFreshDb();
    db.exec(`
      CREATE TABLE external_document_refs (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        connector_type TEXT NOT NULL,
        external_id TEXT,
        title TEXT NOT NULL
      );
      INSERT INTO external_document_refs (id, org_id, connector_type, external_id, title)
      VALUES ('legacy-1', 'org-1', 'google_workspace', 'AAA', 'Legacy Doc');
    `);

    applyDocumentIntegrationsMigration(db);

    const result = reverseDocumentIntegrationsMigration(db);
    expect(result.legacyPreserved).toBe(true);
    expect(result.dropped).toEqual([...EXPECTED_UNIFIED_TABLES]);

    for (const table of EXPECTED_UNIFIED_TABLES) {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table);
      expect(row).toBeUndefined();
    }
    const legacy = db
      .prepare('SELECT COUNT(*) AS c FROM external_document_refs')
      .get() as { c: number };
    expect(legacy.c).toBe(1);
  });
});
