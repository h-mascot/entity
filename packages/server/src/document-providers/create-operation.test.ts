/**
 * R-026 — provider-neutral create-operation claim composition (unit tests).
 *
 * Pure logic only: fingerprint stability/sensitivity, stored-result round-trip, and the
 * fail-closed parse of malformed persisted results (F-001/F-002 reconciliation reads these).
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  claimInputForDocumentCreate,
  documentCreateRequestFingerprint,
  markDocumentCreateUncertain,
  parseStoredDocumentCreateResult,
  serializeDocumentCreateResult,
  type DocumentCreateRequestIdentity,
  type DocumentOperationStore,
} from './create-operation';

const identity: DocumentCreateRequestIdentity = {
  provider: 'google_workspace',
  artifactType: 'document',
  title: 'Q3 Operating Plan',
  destinationId: 'dest_1',
};

describe('documentCreateRequestFingerprint', () => {
  it('is deterministic for the same request identity', () => {
    expect(documentCreateRequestFingerprint(identity)).toBe(documentCreateRequestFingerprint({ ...identity }));
  });

  it('changes when any identity field changes (provider/artifactType/title/destinationId)', () => {
    const base = documentCreateRequestFingerprint(identity);
    expect(documentCreateRequestFingerprint({ ...identity, provider: 'microsoft_365' })).not.toBe(base);
    expect(documentCreateRequestFingerprint({ ...identity, artifactType: 'spreadsheet' })).not.toBe(base);
    expect(documentCreateRequestFingerprint({ ...identity, title: 'Q4 Operating Plan' })).not.toBe(base);
    expect(documentCreateRequestFingerprint({ ...identity, destinationId: 'dest_2' })).not.toBe(base);
  });

  it('treats null and undefined destinationId identically (stable normalization)', () => {
    expect(documentCreateRequestFingerprint({ ...identity, destinationId: null }))
      .toBe(documentCreateRequestFingerprint({ ...identity, destinationId: undefined as unknown as null }));
  });
});

describe('claimInputForDocumentCreate', () => {
  it('binds workspace + idempotency key + fingerprinted request identity', () => {
    const input = claimInputForDocumentCreate({
      workspaceId: 'ws_A',
      idempotencyKey: 'op_1',
      identity,
    });
    expect(input.workspace_id).toBe('ws_A');
    expect(input.idempotency_key).toBe('op_1');
    expect(input.provider).toBe('google_workspace');
    expect(input.artifact_type).toBe('document');
    expect(input.destination_id).toBe('dest_1');
    expect(input.request_fingerprint).toBe(documentCreateRequestFingerprint(identity));
  });
});

describe('stored create result (de)serialization', () => {
  it('round-trips a complete result', () => {
    const result = {
      documentId: 'doc_123',
      entityUrl: '/documents/doc_123',
      provider: 'local_office' as const,
      revision: 'rev-9',
    };
    expect(parseStoredDocumentCreateResult(serializeDocumentCreateResult(result))).toEqual(result);
  });

  it('round-trips a null revision', () => {
    const result = {
      documentId: 'doc_123',
      entityUrl: '/documents/doc_123',
      provider: 'google_workspace' as const,
      revision: null,
    };
    expect(parseStoredDocumentCreateResult(serializeDocumentCreateResult(result))).toEqual(result);
  });

  it('fails closed (null) for malformed persisted payloads — never re-dispatchable garbage', () => {
    expect(parseStoredDocumentCreateResult(null)).toBeNull();
    expect(parseStoredDocumentCreateResult(undefined)).toBeNull();
    expect(parseStoredDocumentCreateResult('')).toBeNull();
    expect(parseStoredDocumentCreateResult('not json')).toBeNull();
    expect(parseStoredDocumentCreateResult('[]')).toBeNull();
    expect(parseStoredDocumentCreateResult('{}')).toBeNull();
    expect(parseStoredDocumentCreateResult('{"documentId":123,"entityUrl":"/x","provider":"google_workspace","revision":null}')).toBeNull();
    expect(parseStoredDocumentCreateResult('{"documentId":"d","entityUrl":"/x","provider":"google_workspace","revision":42}')).toBeNull();
    expect(parseStoredDocumentCreateResult('{"documentId":"d","entityUrl":"/x","revision":null}')).toBeNull();
    expect(parseStoredDocumentCreateResult('{"documentId":"","entityUrl":"/x","provider":"google_workspace","revision":null}')).toBeNull();
  });
});

describe('markDocumentCreateUncertain', () => {
  it('completes the claim as uncertain with the fingerprint (and preserves originating failures)', () => {
    const calls: Array<{ key: string; status: string | undefined; fingerprint: string; external: string | null }> = [];
    const store: DocumentOperationStore = {
      claimDocumentOperation: () => {
        throw new Error('not used in this test');
      },
      completeDocumentOperation: (workspaceId, idempotencyKey, fields) => {
        calls.push({
          key: `${workspaceId}/${idempotencyKey}`,
          status: fields.operation_status,
          fingerprint: fields.request_fingerprint ?? '',
          external: fields.provider_external_id ?? null,
        });
        return undefined;
      },
    };
    markDocumentCreateUncertain(store, {
      workspaceId: 'ws_A',
      idempotencyKey: 'op_1',
      identity,
      providerExternalId: 'goog-doc-1',
    });
    expect(calls).toEqual([
      {
        key: 'ws_A/op_1',
        status: 'uncertain',
        fingerprint: documentCreateRequestFingerprint(identity),
        external: 'goog-doc-1',
      },
    ]);
  });

  it('never throws when the store rejects the transition (originating failure is preserved)', () => {
    const store: DocumentOperationStore = {
      claimDocumentOperation: () => {
        throw new Error('not used');
      },
      completeDocumentOperation: () => {
        throw new Error('document operation transition rejected');
      },
    };
    expect(() =>
      markDocumentCreateUncertain(store, { workspaceId: 'ws_A', idempotencyKey: 'op_1', identity }),
    ).not.toThrow();
  });
});

/* =============================================================================
 * runDocumentCreateOperation — the canonical create lifecycle (composition tests with the
 * real in-memory T-003 store, real registry, and the deterministic fake adapter).
 * =============================================================================
 */
import Database from 'better-sqlite3';
import { createDocumentIntegrationsRepository } from '../../../db/src/document-integrations';
import { createDocumentRegistry } from './registry';
import { createFakeDocumentProviderAdapter } from './fake-adapter';
import {
  runDocumentCreateOperation,
  registryWriteInputForCreate,
  type DocumentCreateOperationDeps,
} from './create-operation';

describe('runDocumentCreateOperation (canonical lifecycle)', () => {
  const openDbs: Database.Database[] = [];
  function harness() {
    const db = new Database(':memory:');
    openDbs.push(db);
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();
    const registry = createDocumentRegistry(db);
    const adapter = createFakeDocumentProviderAdapter();
    const deps: DocumentCreateOperationDeps = { operations: repo, registry, adapter };
    const identity: DocumentCreateRequestIdentity = {
      provider: 'google_workspace',
      artifactType: 'document',
      title: 'Q3',
      destinationId: 'dest_1',
    };
    return { db, repo, registry, adapter, deps, identity };
  }
  afterEach(() => { for (const db of openDbs.splice(0)) db.close(); });

  it('creates: claim new → dispatch → registry persist → completed row', async () => {
    const h = harness();
    const outcome = await runDocumentCreateOperation(h.deps, {
      workspaceId: 'ws_A', idempotencyKey: 'op_1', identity: h.identity, now: '2026-08-18T00:00:00.000Z',
    });
    expect(outcome.kind).toBe('created');
    if (outcome.kind !== 'created') return;
    expect(outcome.record.provider).toBe('google_workspace');
    const row = h.repo.findDocumentOperation('ws_A', 'op_1');
    expect(row?.operation_status).toBe('completed');
    expect(row?.document_id).toBe(outcome.record.id);
  });

  it('completed replay validates the LIVE record: missing canonical document fails closed', async () => {
    const h = harness();
    await runDocumentCreateOperation(h.deps, { workspaceId: 'ws_A', idempotencyKey: 'op_2', identity: h.identity });
    h.db.prepare('DELETE FROM document_objects').run();
    const outcome = await runDocumentCreateOperation(h.deps, { workspaceId: 'ws_A', idempotencyKey: 'op_2', identity: h.identity });
    expect(outcome).toMatchObject({ kind: 'reconciliation_required', reason: 'replay_target_missing' });
  });

  it('completed replay validates the EXPECTED provider: stored provider mismatch fails closed', async () => {
    const h = harness();
    await runDocumentCreateOperation(h.deps, { workspaceId: 'ws_A', idempotencyKey: 'op_3', identity: h.identity });
    const row = h.repo.findDocumentOperation('ws_A', 'op_3');
    const stored = JSON.parse(row!.result_json!) as { documentId: string; entityUrl: string };
    h.db.prepare('UPDATE document_operations SET result_json = ? WHERE workspace_id = ? AND idempotency_key = ?')
      .run(JSON.stringify({ ...stored, provider: 'microsoft_365' }), 'ws_A', 'op_3');
    const outcome = await runDocumentCreateOperation(h.deps, { workspaceId: 'ws_A', idempotencyKey: 'op_3', identity: h.identity });
    expect(outcome).toMatchObject({ kind: 'reconciliation_required', reason: 'replay_provider_mismatch' });
  });

  it('completed replay against the validated live record returns `replayed` (never stored-JSON fields)', async () => {
    const h = harness();
    const first = await runDocumentCreateOperation(h.deps, { workspaceId: 'ws_A', idempotencyKey: 'op_4', identity: h.identity });
    expect(first.kind).toBe('created');
    const replay = await runDocumentCreateOperation(h.deps, { workspaceId: 'ws_A', idempotencyKey: 'op_4', identity: h.identity });
    expect(replay.kind).toBe('replayed');
    if (replay.kind !== 'replayed') return;
    expect(replay.record.id).toBe((first as { record: { id: string } }).record.id);
  });

  it('a dispatch failure marks the claim uncertain and rethrows — never a silent retry path', async () => {
    const h = harness();
    const failing: DocumentCreateOperationDeps = {
      ...h.deps,
      adapter: { create: () => { throw new Error('provider dispatch failed'); } },
    };
    await expect(runDocumentCreateOperation(failing, {
      workspaceId: 'ws_A', idempotencyKey: 'op_5', identity: h.identity,
    })).rejects.toThrow('provider dispatch failed');
    expect(h.repo.findDocumentOperation('ws_A', 'op_5')?.operation_status).toBe('uncertain');
    // A retry with the same key demands reconciliation (no re-dispatch).
    const retry = await runDocumentCreateOperation(h.deps, {
      workspaceId: 'ws_A', idempotencyKey: 'op_5', identity: h.identity,
    });
    expect(retry).toMatchObject({ kind: 'reconciliation_required', reason: 'uncertain_prior_attempt' });
  });

  it('a registry identity conflict rethrows (caller maps the typed conflict) and the row goes uncertain with the orphan id', async () => {
    const h = harness();
    // Pre-own the identity the fake adapter deterministically mints first (google_workspace-document-0).
    h.registry.create({
      provider: 'google_workspace', artifact_type: 'document', title: 'existing',
      external_id: 'google_workspace-document-0', provider_connection_id: null, provider_url: null,
      owner_summary: null, tenant_external_id: null, permissions_summary_json: null,
      sensitivity_label: null, auth_state: 'authorized', readiness_state: 'ready',
      current_revision: 'rev-1', provider_modified_at: null, preview_state: 'ready',
      conflict_state: 'none',
    }, 'ws_A');
    await expect(runDocumentCreateOperation(h.deps, {
      workspaceId: 'ws_A', idempotencyKey: 'op_6', identity: h.identity,
    })).rejects.toThrow(/already exists/i);
    const row = h.repo.findDocumentOperation('ws_A', 'op_6');
    expect(row?.operation_status).toBe('uncertain');
    expect(row?.provider_external_id).toBe('google_workspace-document-0');
  });

  it('registryWriteInputForCreate maps the request identity + descriptor verbatim', () => {
    const input = registryWriteInputForCreate(
      { provider: 'local_office', artifactType: 'spreadsheet', title: 'Sheet', destinationId: 'dest_local' },
      {
        provider: 'local_office', artifact_type: 'spreadsheet', external_id: 'file-1',
        provider_connection_id: null, title: 'Sheet', provider_url: null,
        auth_state: 'authorized', readiness_state: 'ready', current_revision: 'r1',
        provider_modified_at: '2026-08-18T00:00:00.000Z', preview_state: 'ready', conflict_state: 'none',
      },
    );
    expect(input).toEqual({
      provider: 'local_office', artifact_type: 'spreadsheet', title: 'Sheet',
      destination_id: 'dest_local', external_id: 'file-1', provider_connection_id: null,
      provider_url: null, owner_summary: null, tenant_external_id: null,
      permissions_summary_json: null, sensitivity_label: null, auth_state: 'authorized',
      readiness_state: 'ready', current_revision: 'r1',
      provider_modified_at: '2026-08-18T00:00:00.000Z', preview_state: 'ready', conflict_state: 'none',
    });
  });
});
