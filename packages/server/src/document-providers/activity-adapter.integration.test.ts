/**
 * THE-951 (T-010) — Activity + Entity execution receipts — REAL-REPOSITORY integration regression.
 *
 * Exercises the REAL `createActivityRepository` against a temp SQLite DB (instead of the stub
 * `makeActivitySink` used in `activity-adapter.test.ts`). This is the failing-test-first regression
 * for reviewer findings F1 and F2:
 *
 *   - F1 (R-027): a persisted document-mutation activity through the REAL repo must carry a valid
 *     structured `activity_event_type` (e.g. `document_operation`) with `activity_event_schema_status`
 *     `structured` — NOT degrade to `legacy_event_observed` / `legacy_unknown` / a `document_mutation`
 *     legacy type.
 *   - F2 (attribution integrity): a `provider_external_actor` / `local_external_actor` operation
 *     persisted through the REAL repo must NOT be durably re-projected as a trusted `agent` (no
 *     `agent_name`, no `actor_type: 'agent'`). The honest class stays on `data.actorClass` and the
 *     principal on `actor_principal_id` / `data.actorId`.
 *
 * The temp DB is isolated via `ENTITY_TASK_DB_PATH` (the same env-controlled path switch the db
 * test suite uses), so the REAL `buildActivityEventProjection` / `createActivity` SQL path runs.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { recordDocumentActivity, type DocumentActivityRecord } from './activity-adapter';

const activeDbPaths: string[] = [];

function tempDbPath(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${process.pid}-${randomUUID()}.sqlite`);
}

/** Stub a fresh temp DB path and reload the db module so the REAL repository opens it. */
async function loadActivityRepository() {
  const dbPath = tempDbPath('entity-activity-realrepo');
  activeDbPaths.push(dbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', dbPath);
  const { createActivityRepository } = await import('../../../db/src');
  return { repo: createActivityRepository(), dbPath };
}

function makeDocumentActivity(overrides: Partial<DocumentActivityRecord> = {}): DocumentActivityRecord {
  return {
    id: 'op-real',
    documentId: 'doc-1',
    provider: 'google_workspace',
    artifactType: 'document',
    externalId: 'google_workspace-document-0',
    operationType: 'mutate',
    actorClass: 'agent',
    actorId: 'agent-1',
    priorRevision: 'rev-1',
    resultRevision: 'rev-2',
    timestamp: '2026-08-18T00:00:00.000Z',
    succeeded: true,
    reasonCode: null,
    receiptId: null,
    ...overrides,
  };
}

afterEach(() => {
  // `getEntityDatabase` is path-keyed and auto-closes the previous DB whenever the path switches
  // (each `loadActivityRepository` uses a fresh temp path), so no explicit close is needed here.
  // On POSIX, unlinking an open sqlite file (db/-wal/-shm) succeeds, so we can remove the temp files.
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const dbPath of activeDbPaths.splice(0)) {
    for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      fs.rmSync(file, { force: true });
    }
  }
});

describe('T-010 — REAL ActivityRepository integration (F1/F2 regression against buildActivityEventProjection)', () => {
  it('F1: persists an agent document mutation with a valid structured document_operation event type (not legacy_event_observed)', async () => {
    const { repo } = await loadActivityRepository();
    const published = recordDocumentActivity({
      activity: makeDocumentActivity(),
      createActivity: repo.createActivity,
      taskId: 5,
    });

    const persisted = repo.listActivities(10)[0];
    expect(persisted).toBeDefined();
    expect(persisted.id).toBe(published.id);
    // The real projection must keep the explicit valid structured event type + schema status.
    expect(persisted.activity_event_type).toBe('document_operation');
    expect(persisted.activity_event_schema_status).toBe('structured');
    // It must NOT degrade to the legacy path / store the raw type as a legacy type.
    expect(persisted.activity_event_type).not.toBe('legacy_event_observed');
    expect(persisted.activity_event_schema_status).not.toBe('legacy_unknown');
    expect(persisted.activity_event_legacy_type).toBeNull();
  });

  it('F2: never re-projects a provider_external_actor as a trusted agent through the real repo', async () => {
    const { repo } = await loadActivityRepository();
    recordDocumentActivity({
      activity: makeDocumentActivity({
        actorClass: 'provider_external_actor',
        actorId: 'provider-user-99',
      }),
      createActivity: repo.createActivity,
      taskId: 6,
    });

    const persisted = repo.listActivities(10)[0];
    const payload = JSON.parse(persisted.activity_event_payload_json ?? '{}') as Record<string, unknown>;

    // Row-level agent_name (an assertion of a trusted Entity AGENT) must be absent for an external actor.
    expect(persisted.agent_name).toBeNull();
    // The projected payload actor_type must map fail-closed to `unknown`, never `agent` (or `human`).
    expect(payload.actor_type).toBe('unknown');
    expect(['agent', 'human']).not.toContain(payload.actor_type);
    // The honest class and provider-bound principal remain retrievable on the structured payload.
    expect((payload.data as Record<string, unknown>).actorClass).toBe('provider_external_actor');
    expect((payload.data as Record<string, unknown>).actorId).toBe('provider-user-99');
    expect(payload.actor_principal_id).toBe('provider-user-99');
  });

  it('F2: never promotes a local_external_actor to a trusted agent through the real repo', async () => {
    const { repo } = await loadActivityRepository();
    recordDocumentActivity({
      activity: makeDocumentActivity({
        actorClass: 'local_external_actor',
        actorId: 'local-editor-7',
      }),
      createActivity: repo.createActivity,
      taskId: 7,
    });

    const persisted = repo.listActivities(10)[0];
    const payload = JSON.parse(persisted.activity_event_payload_json ?? '{}') as Record<string, unknown>;
    expect(persisted.agent_name).toBeNull();
    expect(payload.actor_type).toBe('unknown');
    expect((payload.data as Record<string, unknown>).actorClass).toBe('local_external_actor');
  });
});
