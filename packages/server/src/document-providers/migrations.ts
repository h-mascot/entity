/**
 * T-003 — Define and migrate unified document persistence (migration helper).
 *
 * This module is the server-side operator/application migration entry point for the
 * ADDITIVE unified document schema defined by packages/db/src/document-integrations.ts.
 *
 * It applies `document_objects`, `document_associations`, `document_versions`, and
 * `document_integration_events` onto an existing Entity database WITHOUT deleting,
 * altering, or otherwise touching prior document data (legacy Google V1
 * `external_document_refs`, `native_documents`, etc.), satisfying R-036
 * "Database migration safety".
 *
 * Reversibility (R-037 note): this helper threads the audited Phase 2 flag host
 * (packages/server/src/phase2-flags.ts). It does not register its own flag here —
 * the feature regression/rollout flag for the unified registry is owned by T-006's
 * flag registration. This migration itself is fully reversible via
 * `reverseDocumentIntegrationsMigration`, which drops ONLY the additive unified tables;
 * legacy document data is never recovered-from or deleted, so rolling the application
 * back to pre-T-003 semantics preserves the old document read paths unchanged.
 *
 * Security & privacy: no credentials, raw tokens, tenant secrets, or document contents
 * are written by this migration. Only the sanctioned R-001 logical fields.
 */

import Database from 'better-sqlite3';
import { getEntityDatabase } from '../../../db/src/entity-db';
import {
  type DocumentIntegrationsCollisionLookup,
  type DocumentIntegrationsRepository,
  type SchemaAuditReport,
  createDocumentIntegrationsRepository,
  detectDocumentIntegrationsCollisions,
  EXPECTED_UNIFIED_TABLES,
} from '../../../db/src/document-integrations';

export interface DocumentIntegrationsMigrationReport {
  success: boolean;
  applied: boolean;
  tablesEnsured: readonly string[];
  collisionCheck: { ok: boolean; table?: string; detail?: string };
  additiveOnly: true;
  destructiveChanges: false;
  featureFlagHost: 'phase2-flags.ts';
  rollback: {
    command: 'reverseDocumentIntegrationsMigration';
    dropsOnly: string[];
    preservesLegacyData: true;
    semanticNote: string;
  };
}

/**
 * Verify that no unified table name collides with an incompatible pre-existing table in
 * the running database. This is the explicit collision check PRD 11.4 requires before
 * writing the migration (table names: T-003 verified none of the unified names collide
 * with any table name declared under packages/db/src or packages/server/src).
 */
export function checkDocumentIntegrationsCollisions(
  db: Database.Database = getEntityDatabase(),
): DocumentIntegrationsCollisionLookup {
  return detectDocumentIntegrationsCollisions(db);
}

/**
 * Apply the additive unified document schema to the entity database.
 *
 * Safe to run more than once (CREATE TABLE IF NOT EXISTS + idempotent collision guard).
 * Returns a structured report describing what was applied, the collision verdict, the
 * additive-only guarantee, and the rollback path.
 */
export function applyDocumentIntegrationsMigration(
  db: Database.Database = getEntityDatabase(),
): DocumentIntegrationsMigrationReport {
  const repo = createDocumentIntegrationsRepository(db);
  // Surface the collision verdict loudly (including which table collided) rather than
  // swallowing it into a bare message, so operators and tests can act on the cause.
  const verdict = detectDocumentIntegrationsCollisions(db);
  if (!verdict.ok) {
    return {
      success: false,
      applied: false,
      tablesEnsured: [],
      collisionCheck: { ok: false, table: verdict.table, detail: verdict.detail },
      additiveOnly: true,
      destructiveChanges: false,
      featureFlagHost: 'phase2-flags.ts',
      rollback: {
        command: 'reverseDocumentIntegrationsMigration',
        dropsOnly: [...EXPECTED_UNIFIED_TABLES],
        preservesLegacyData: true,
        semanticNote:
          'Legacy document data is never touched, so the pre-T-003 application keeps its original semantics if rolled back.',
      },
    };
  }
  let audit: SchemaAuditReport;
  try {
    audit = repo.ensureSchema();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      applied: false,
      tablesEnsured: [],
      collisionCheck: { ok: false, detail: message },
      additiveOnly: true,
      destructiveChanges: false,
      featureFlagHost: 'phase2-flags.ts',
      rollback: {
        command: 'reverseDocumentIntegrationsMigration',
        dropsOnly: [...EXPECTED_UNIFIED_TABLES],
        preservesLegacyData: true,
        semanticNote:
          'Legacy document data is never touched, so the pre-T-003 application keeps its original semantics if rolled back.',
      },
    };
  }
  return {
    success: true,
    applied: true,
    tablesEnsured: audit.tablesEnsured,
    collisionCheck: { ok: true },
    additiveOnly: true,
    destructiveChanges: false,
    featureFlagHost: 'phase2-flags.ts',
    rollback: {
      command: 'reverseDocumentIntegrationsMigration',
      dropsOnly: [...EXPECTED_UNIFIED_TABLES],
      preservesLegacyData: true,
      semanticNote:
        'Legacy document data is never touched, so the pre-T-003 application keeps its original semantics if rolled back.',
    },
  };
}

/**
 * Reverse the migration: drop only the additive unified tables. Legacy document tables
 * (and any other pre-existing data) are left intact, so the old application semantics
 * survive a rollback without recovering dropped legacy data (R-036).
 */
export function reverseDocumentIntegrationsMigration(
  db: Database.Database = getEntityDatabase(),
): { dropped: readonly string[]; legacyPreserved: true } {
  const repo = createDocumentIntegrationsRepository(db);
  repo.reverseSchema();
  return { dropped: [...EXPECTED_UNIFIED_TABLES], legacyPreserved: true };
}

/** Repository bound to the entity database, for callers that need direct helpers. */
export function entityDocumentIntegrationsRepository(
  db: Database.Database = getEntityDatabase(),
): DocumentIntegrationsRepository {
  return createDocumentIntegrationsRepository(db);
}
