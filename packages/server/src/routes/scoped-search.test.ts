import express from 'express';
import http from 'http';
import { describe, expect, it, vi } from 'vitest';
import type {
  EvidenceArtifactRecord,
  ExternalDocumentRefRecord,
  NativeDocumentRecord,
  TaskRecord,
} from '../../../db/src';
import type { FileIndexRecord, FileSyncRunRecord } from '../../../db/src/file-index';
import type { FileSourceRecord } from '../../../db/src/file-sources';
import { resolvePhase2Flags } from '../phase2-flags';
import { createSearchRouter } from './search';
import type { ScopedSearchRouteDeps } from './scoped-search';

const now = '2026-07-30T12:00:00.000Z';

function nativeDocument(overrides: Partial<NativeDocumentRecord> = {}): NativeDocumentRecord {
  return {
    id: 'native-renewal',
    org_id: 'org-a',
    team_id: 'team-a',
    project_id: 42,
    title: 'Renewal native note',
    document_kind: 'note',
    body_format: 'markdown',
    stable_path: '/documents/native/native-renewal.md',
    content_hash: 'sha256:native',
    mutability_policy: 'editable_versioned',
    version: 1,
    lifecycle_state: 'active',
    sensitivity: null,
    acl_json: '{}',
    linked_object_refs: [],
    created_by_principal_id: 'user-a',
    metadata_json: '{}',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function externalDocument(overrides: Partial<ExternalDocumentRefRecord> = {}): ExternalDocumentRefRecord {
  return {
    id: 'external-renewal',
    org_id: 'org-a',
    connector_type: 'google_docs',
    external_id: 'google-123',
    external_url: null,
    title: 'Renewal external plan',
    external_mime_type: 'application/vnd.google-apps.document',
    external_canonical_url: null,
    auth_state: 'authorized',
    readiness_state: 'ready',
    granted_scopes: ['read', 'index', 'link', 'preview'],
    missing_scopes: [],
    auth_expires_at: null,
    external_ref_state: 'available',
    capabilities_json: '{}',
    canonicality: 'external_canonical',
    last_indexed_at: now,
    last_checked_at: now,
    entity_visibility_policy_json: '{}',
    external_permission_summary: null,
    linked_object_refs: [],
    metadata_json: '{}',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function fileSource(overrides: Partial<FileSourceRecord> = {}): FileSourceRecord {
  return {
    id: 'workspace',
    display_name: 'Workspace',
    type: 'local',
    base_url: null,
    base_path: '/workspace',
    auth_type: 'none',
    auth_ref: null,
    enabled: true,
    icon: null,
    capabilities: '{}',
    health: 'ok',
    last_synced_at: now,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function indexedFile(overrides: Partial<FileIndexRecord> = {}): FileIndexRecord {
  return {
    id: 'workspace:plans/renewal.md',
    source_id: 'workspace',
    path: 'plans/renewal.md',
    title: 'Renewal indexed file',
    type: 'plan',
    agent: 'entity-mc',
    origin: 'task',
    is_recurring: false,
    recurring_pattern: null,
    tags: '[]',
    updated_at: now,
    indexed_at: now,
    preview: 'Permitted renewal snippet',
    content_hash: 'sha256:file',
    org_id: 'org-a',
    sensitivity: null,
    acl_json: '{}',
    entity_visibility_policy_json: '{}',
    ...overrides,
  };
}

function syncRun(overrides: Partial<FileSyncRunRecord> = {}): FileSyncRunRecord {
  return {
    id: 1,
    source_id: 'workspace',
    status: 'ok',
    started_at: now,
    finished_at: now,
    error: null,
    files_scanned: 1,
    files_indexed: 1,
    ...overrides,
  };
}

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 77,
    org_id: 'org-a',
    team_id: 'team-a',
    project_id: 42,
    created_by_principal_id: 'creator-a',
    initiator_principal_id: 'initiator-a',
    initiator_type: 'human',
    owner_principal_id: 'owner-a',
    owner_principal_type: 'human',
    executor_principal_id: 'executor-a',
    assignment_state: 'assigned',
    taskmaster_drivable: false,
    worktype: 'sales',
    risk_level: 'medium',
    agent_trust_level: 'standard',
    policy_inputs_json: '{}',
    external_side_effects_json: '[]',
    external_side_effects: [],
    review_required: true,
    review_state: 'pending',
    human_gate_required: false,
    human_gate_state: 'not_required',
    name: 'Renewal task',
    description: 'Prepare the permitted renewal packet',
    brief: null,
    origin_channel: null,
    column: 'review',
    model: null,
    archived: false,
    assignee: 'agent-a',
    blocked: false,
    blocker_reason: null,
    due_date: null,
    priority: 'P1',
    estimate_hours: null,
    time_spent: 0,
    output: null,
    progress_status: 'in_progress',
    recurring: false,
    recurring_config: null,
    created_at: now,
    updated_at: now,
    metadata: '{}',
    project: 'Renewals',
    projects: [],
    ...overrides,
  };
}

function evidenceArtifact(overrides: Partial<EvidenceArtifactRecord> = {}): EvidenceArtifactRecord {
  return {
    id: 'artifact-renewal',
    org_id: 'org-a',
    team_id: 'team-a',
    project_id: 42,
    artifact_kind: 'curated_report',
    title: 'Renewal proof report',
    body_format: 'markdown',
    stable_path: '/artifacts/evidence/artifact-renewal.md',
    human_path_alias: null,
    content_hash: 'sha256:artifact',
    mutability_policy: 'editable_versioned',
    version: 1,
    origin_task_id: 77,
    source_activity_event_ids: [],
    source_artifact_ids: [],
    linked_object_refs: [{ object_type: 'task', object_id: '77', link_role: 'proof' }],
    provenance_json: JSON.stringify({ source: 'task_completion' }),
    integrity_state: 'valid',
    availability_state: 'available',
    created_by_principal_id: 'agent-a',
    metadata_json: '{}',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function healthyDeps(overrides: Partial<ScopedSearchRouteDeps> = {}): ScopedSearchRouteDeps {
  const source = fileSource();
  return {
    documentRepo: {
      listNativeDocuments: vi.fn(() => [nativeDocument()]),
      listExternalDocumentRefs: vi.fn(() => [externalDocument()]),
    },
    indexRepo: {
      search: vi.fn(() => [indexedFile()]),
      getLatestSyncRun: vi.fn(() => syncRun()),
    },
    sourceRepo: {
      listSources: vi.fn(() => [source]),
      getSource: vi.fn((id: string) => id === source.id ? source : undefined),
    },
    now: () => new Date(now),
    ...overrides,
  };
}

async function withSearchServer(
  deps: ScopedSearchRouteDeps,
  run: (baseUrl: string) => Promise<void>,
  permissionStrictness = 'on',
): Promise<void> {
  const app = express();
  app.use('/api/search', createSearchRouter({
    flags: resolvePhase2Flags({ ENTITY_PHASE2_SEARCH_PERMISSION_STRICTNESS: permissionStrictness }),
    scoped: deps,
  }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server failed to bind');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe('Docs scoped search', () => {
  it('returns native, external, and indexed files in the stable org-scoped envelope', async () => {
    const deps = healthyDeps();
    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/search/scoped?q=renewal`, {
        headers: { 'x-entity-org-id': 'org-a' },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body).toMatchObject({
        version: 'entity.scoped-search.v1',
        query: 'renewal',
        scope: { orgId: 'org-a', teamId: null, projectId: null },
        searchState: {
          state: 'healthy',
          partial: false,
          reasons: [],
          backends: [{ name: 'documents', state: 'healthy', indexedAt: now, lagSeconds: 0 }],
        },
        count: 3,
        nextCursor: null,
      });
      expect(body.results.map((entry: any) => entry.objectType).sort()).toEqual([
        'external_document_ref',
        'file',
        'native_document',
      ]);
      expect(body.results.find((entry: any) => entry.objectType === 'file')).toMatchObject({
        objectId: 'workspace:plans/renewal.md',
        snippet: 'Permitted renewal snippet',
        deepLink: { route: '/docs/source/workspace/plans/renewal.md' },
        scope: { orgId: 'org-a' },
        permission: { state: 'visible', reasons: [] },
        provenance: {
          backend: 'documents',
          sourceId: 'workspace',
          indexed: true,
          indexedAt: now,
          lagSeconds: 0,
          canonical: true,
        },
        ranking: { score: 1, basis: 'keyword' },
      });
      expect(deps.indexRepo?.search).toHaveBeenCalledWith('renewal', expect.objectContaining({
        orgId: 'org-a',
        includeUnscoped: false,
      }));
    });
  });

  it('attributes legacy unscoped index rows only to the default workspace org', async () => {
    const source = fileSource();
    const legacyRecord = indexedFile({ org_id: null });
    const search = vi.fn((_query: string, filters?: { includeUnscoped?: boolean }) =>
      filters?.includeUnscoped ? [legacyRecord] : []
    );
    const deps = healthyDeps({
      documentRepo: {
        listNativeDocuments: vi.fn(() => []),
        listExternalDocumentRefs: vi.fn(() => []),
      },
      indexRepo: {
        search,
        getLatestSyncRun: vi.fn(() => syncRun()),
      },
      sourceRepo: {
        listSources: vi.fn(() => [source]),
        getSource: vi.fn(() => source),
      },
    });
    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/search/scoped?q=renewal&objectTypes=file`, {
        headers: { 'x-entity-org-id': 'default-org' },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        count: 1,
        results: [{ objectType: 'file', scope: { orgId: 'default-org' } }],
      });
      expect(search).toHaveBeenCalledWith('renewal', expect.objectContaining({
        orgId: 'default-org',
        includeUnscoped: true,
      }));
    });
  });

  it('surfaces a stale failed index fixture as degraded instead of healthy empty state', async () => {
    const stale = '2026-07-30T10:00:00.000Z';
    const source = fileSource({ health: 'degraded', last_synced_at: stale });
    const deps = healthyDeps({
      documentRepo: {
        listNativeDocuments: vi.fn(() => []),
        listExternalDocumentRefs: vi.fn(() => []),
      },
      indexRepo: {
        search: vi.fn(() => [indexedFile({ indexed_at: stale, updated_at: stale })]),
        getLatestSyncRun: vi.fn(() => syncRun({
          status: 'error',
          finished_at: stale,
          error: 'connector timeout',
          files_indexed: 0,
        })),
      },
      sourceRepo: {
        listSources: vi.fn(() => [source]),
        getSource: vi.fn(() => source),
      },
    });
    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/search/scoped?q=renewal&objectTypes=file`, {
        headers: { 'x-entity-org-id': 'org-a' },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.searchState).toMatchObject({
        state: 'degraded',
        partial: true,
        reasons: expect.arrayContaining(['file_index_lag_degraded', 'file_index_source_degraded']),
        backends: [{
          name: 'documents',
          state: 'degraded',
          indexedAt: stale,
          lagSeconds: 7200,
        }],
      });
      expect(body.results[0]).toMatchObject({
        objectType: 'file',
        connectorState: {
          state: 'degraded',
          lastSyncedAt: stale,
          lagSeconds: 7200,
          latestSyncStatus: 'error',
        },
        provenance: {
          indexedAt: stale,
          lagSeconds: 7200,
        },
      });
    });
  });

  it('reports external connector degradation even when the query returns no matching refs', async () => {
    const stale = '2026-07-30T10:00:00.000Z';
    const degradedRef = externalDocument({
      readiness_state: 'degraded',
      last_indexed_at: stale,
      updated_at: stale,
    });
    const deps = healthyDeps({
      documentRepo: {
        listNativeDocuments: vi.fn(() => []),
        listExternalDocumentRefs: vi.fn((input) => input.query ? [] : [degradedRef]),
      },
    });
    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/search/scoped?q=missing&objectTypes=external_document_ref`, {
        headers: { 'x-entity-org-id': 'org-a' },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        searchState: {
          state: 'degraded',
          partial: true,
          reasons: expect.arrayContaining([
            'external_document_index_lag_degraded',
            'external_document_connector_degraded',
          ]),
          backends: [{
            name: 'documents',
            state: 'degraded',
            indexedAt: stale,
            lagSeconds: 7200,
          }],
        },
        count: 0,
        results: [],
      });
    });
  });

  it('uses effective external auth readiness instead of reporting an unusable ref as healthy', async () => {
    const unusableRef = externalDocument({
      auth_state: 'expired',
      readiness_state: 'ready',
      last_indexed_at: now,
    });
    const deps = healthyDeps({
      documentRepo: {
        listNativeDocuments: vi.fn(() => []),
        listExternalDocumentRefs: vi.fn(() => [unusableRef]),
      },
    });
    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/search/scoped?q=renewal&objectTypes=external_document_ref`, {
        headers: { 'x-entity-org-id': 'org-a' },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        searchState: {
          state: 'degraded',
          reasons: expect.arrayContaining(['external_document_connector_degraded']),
        },
        results: [{
          objectType: 'external_document_ref',
          connectorState: {
            state: 'degraded',
            authState: 'expired',
          },
        }],
      });

      const filtered = await fetch(
        `${baseUrl}/api/search/scoped?q=renewal&objectTypes=external_document_ref&connectorState=ready`,
        { headers: { 'x-entity-org-id': 'org-a' } },
      );
      expect(filtered.status).toBe(200);
      expect(await filtered.json()).toMatchObject({
        count: 0,
        results: [],
      });
    });
  });

  it('returns 503 with the scoped envelope when every requested document store fails', async () => {
    const unavailable = () => {
      throw new Error('backend unavailable');
    };
    const deps: ScopedSearchRouteDeps = {
      documentRepo: {
        listNativeDocuments: vi.fn(unavailable),
        listExternalDocumentRefs: vi.fn(unavailable),
      },
      indexRepo: {
        search: vi.fn(unavailable),
        getLatestSyncRun: vi.fn(() => undefined),
      },
      sourceRepo: {
        listSources: vi.fn(unavailable),
        getSource: vi.fn(() => undefined),
      },
      now: () => new Date(now),
    };
    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/search/scoped?q=renewal`, {
        headers: { 'x-entity-org-id': 'org-a' },
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        version: 'entity.scoped-search.v1',
        searchState: {
          state: 'failed',
          partial: false,
          reasons: ['documents_backend_unavailable'],
          backends: [{ name: 'documents', state: 'failed' }],
        },
        count: 0,
        results: [],
      });
    });
  });

  it('omits undisclosable cross-org results and returns only a generic restricted placeholder when allowed', async () => {
    const source = fileSource();
    const deps = healthyDeps({
      documentRepo: {
        listNativeDocuments: vi.fn(() => [nativeDocument({
          id: 'other-org-secret',
          org_id: 'org-b',
          title: 'Do not leak cross-org title',
        })]),
        listExternalDocumentRefs: vi.fn(() => []),
      },
      indexRepo: {
        search: vi.fn(() => [indexedFile({
          id: 'workspace:restricted/compensation.md',
          title: 'Do not leak compensation title',
          path: 'restricted/compensation.md',
          preview: 'Do not leak compensation snippet',
          sensitivity: 'customer',
          entity_visibility_policy_json: JSON.stringify({ disclose_existence: true }),
        })]),
        getLatestSyncRun: vi.fn(() => syncRun()),
      },
      sourceRepo: {
        listSources: vi.fn(() => [source]),
        getSource: vi.fn(() => source),
      },
    });
    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/search/scoped?q=leak&objectTypes=native_document,file`, {
        headers: { 'x-entity-org-id': 'org-a' },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.results).toEqual([expect.objectContaining({
        objectType: 'file',
        title: 'Restricted result',
        snippet: null,
        deepLink: null,
        sensitivity: null,
        permission: { state: 'restricted', reasons: ['restricted_by_policy'] },
      })]);
      const serialized = JSON.stringify(body.results);
      expect(serialized).not.toContain('cross-org');
      expect(serialized).not.toContain('compensation');
      expect(serialized).not.toContain('restricted/compensation.md');
    });
  });

  it('redacts indexed metadata when the file source restricts search previews', async () => {
    const source = fileSource({
      capabilities: JSON.stringify({
        entity_visibility_policy: { restricted: true },
      }),
    });
    const deps = healthyDeps({
      documentRepo: {
        listNativeDocuments: vi.fn(() => []),
        listExternalDocumentRefs: vi.fn(() => []),
      },
      indexRepo: {
        search: vi.fn(() => [indexedFile({
          id: 'workspace:restricted/payroll.md',
          path: 'restricted/payroll.md',
          title: 'Executive payroll plan',
          preview: 'Private compensation details',
        })]),
        getLatestSyncRun: vi.fn(() => syncRun()),
      },
      sourceRepo: {
        listSources: vi.fn(() => [source]),
        getSource: vi.fn(() => source),
      },
    });
    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/search/scoped?q=payroll&objectTypes=file`, {
        headers: { 'x-entity-org-id': 'org-a' },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.results).toEqual([expect.objectContaining({
        title: 'Restricted result',
        snippet: null,
        deepLink: null,
        permission: {
          state: 'restricted',
          reasons: ['source_permission_policy_restricts_search_preview'],
        },
        ranking: { score: 0, basis: 'keyword' },
      })]);
      const serialized = JSON.stringify(body.results);
      expect(serialized).not.toContain('payroll');
      expect(serialized).not.toContain('compensation');
      expect(serialized).not.toContain('restricted/payroll.md');
    });
  });

  it('does not search or serialize cached rows from an explicitly disabled source', async () => {
    const source = fileSource({ enabled: false });
    const search = vi.fn(() => [indexedFile({
      id: 'disabled:secret.md',
      source_id: 'disabled',
      path: 'secret.md',
      title: 'Disabled source secret',
      preview: 'Cached private content',
    })]);
    const deps = healthyDeps({
      documentRepo: {
        listNativeDocuments: vi.fn(() => []),
        listExternalDocumentRefs: vi.fn(() => []),
      },
      indexRepo: {
        search,
        getLatestSyncRun: vi.fn(() => syncRun({ source_id: 'disabled' })),
      },
      sourceRepo: {
        listSources: vi.fn(() => []),
        getSource: vi.fn(() => source),
      },
    });
    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/search/scoped?q=secret&objectTypes=file&sourceId=disabled`, {
        headers: { 'x-entity-org-id': 'org-a' },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body).toMatchObject({
        searchState: {
          state: 'degraded',
          reasons: expect.arrayContaining(['file_source_unavailable']),
        },
        count: 0,
        results: [],
      });
      expect(search).not.toHaveBeenCalled();
      expect(JSON.stringify(body.results)).not.toContain('secret');
    });
  });

  it('reports unknown index health when freshness and run state are unmeasured', async () => {
    const source = fileSource({ last_synced_at: null });
    const deps = healthyDeps({
      indexRepo: {
        search: vi.fn(() => []),
        getLatestSyncRun: vi.fn(() => undefined),
      },
      sourceRepo: {
        listSources: vi.fn(() => [source]),
        getSource: vi.fn(() => source),
      },
    });
    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/search/scoped?q=missing&objectTypes=file`, {
        headers: { 'x-entity-org-id': 'org-a' },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        searchState: {
          state: 'unknown',
          partial: true,
          reasons: expect.arrayContaining(['file_index_freshness_unknown', 'file_index_run_unknown']),
        },
        count: 0,
        results: [],
      });
    });
  });

  it('paginates deterministically with an opaque cursor', async () => {
    const records = [
      nativeDocument({ id: 'native-a', title: 'Renewal A', updated_at: '2026-07-30T11:00:00.000Z' }),
      nativeDocument({ id: 'native-b', title: 'Renewal B', updated_at: '2026-07-30T10:00:00.000Z' }),
    ];
    const deps = healthyDeps({
      documentRepo: {
        listNativeDocuments: vi.fn(() => records),
        listExternalDocumentRefs: vi.fn(() => []),
      },
    });
    await withSearchServer(deps, async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/search/scoped?q=renewal&objectTypes=native_document&limit=1`, {
        headers: { 'x-entity-org-id': 'org-a' },
      });
      const firstBody = await first.json() as any;
      expect(firstBody.results[0].objectId).toBe('native-a');
      expect(firstBody.nextCursor).toEqual(expect.any(String));

      const second = await fetch(`${baseUrl}/api/search/scoped?q=renewal&objectTypes=native_document&limit=1&cursor=${encodeURIComponent(firstBody.nextCursor)}`, {
        headers: { 'x-entity-org-id': 'org-a' },
      });
      const secondBody = await second.json() as any;
      expect(secondBody.results[0].objectId).toBe('native-b');
      expect(secondBody.nextCursor).toBeNull();
    });
  });

  it('fetches enough backend candidates to serve a page beyond the initial 500 matches', async () => {
    const records = Array.from({ length: 501 }, (_, index) => nativeDocument({
      id: `native-${String(index).padStart(3, '0')}`,
      title: `Renewal ${index}`,
      updated_at: '2026-07-30T11:00:00.000Z',
    }));
    const deps = healthyDeps({
      documentRepo: {
        listNativeDocuments: vi.fn((input) => records.slice(0, input.limit ?? 50)),
        listExternalDocumentRefs: vi.fn(() => []),
      },
    });
    const cursor = Buffer.from(JSON.stringify({ version: 1, offset: 500 }), 'utf8').toString('base64url');
    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/search/scoped?q=renewal&objectTypes=native_document&limit=1&cursor=${encodeURIComponent(cursor)}`,
        { headers: { 'x-entity-org-id': 'org-a' } },
      );
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.count).toBe(1);
      expect(body.results).toHaveLength(1);
      expect(deps.documentRepo?.listNativeDocuments).toHaveBeenCalledWith(expect.objectContaining({
        limit: 502,
      }));
    });
  });

  it('overfetches when permission checks remove the first candidate window', async () => {
    const denied = Array.from({ length: 3 }, (_, index) => nativeDocument({
      id: `denied-${index}`,
      title: `Renewal denied ${index}`,
      acl_json: JSON.stringify({ allowed_principal_ids: ['other-principal'] }),
    }));
    const visible = nativeDocument({
      id: 'visible-after-denied',
      title: 'Renewal visible',
    });
    const records = [...denied, visible];
    const listNativeDocuments = vi.fn((input) => records.slice(0, input.limit ?? 50));
    const deps = healthyDeps({
      documentRepo: {
        listNativeDocuments,
        listExternalDocumentRefs: vi.fn(() => []),
      },
    });
    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/search/scoped?q=renewal&objectTypes=native_document&limit=1`,
        { headers: { 'x-entity-org-id': 'org-a' } },
      );
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.results).toEqual([expect.objectContaining({
        objectId: 'visible-after-denied',
        permission: { state: 'visible', reasons: [] },
      })]);
      expect(listNativeDocuments).toHaveBeenLastCalledWith(expect.objectContaining({
        limit: 8,
      }));
    });
  });

  it('binds the default workspace org when no explicit org is provided, rejects invalid filters, and 503s when strict permissions are disabled', async () => {
    const deps = healthyDeps();
    await withSearchServer(deps, async (baseUrl) => {
      // HEAD RBAC convention (shared with every route): a request with no explicit
      // org header binds the default workspace org. The default org is a real,
      // scoped workspace, so this is permission-safe — the route still scopes every
      // query to the bound orgId and cannot leak cross-org data.
      const missingOrg = await fetch(`${baseUrl}/api/search/scoped?q=renewal`);
      expect(missingOrg.status).toBe(200);
      expect(await missingOrg.json()).toMatchObject({
        version: 'entity.scoped-search.v1',
        scope: { orgId: 'default-org', teamId: null, projectId: null },
      });

      const unavailableType = await fetch(`${baseUrl}/api/search/scoped?q=renewal&objectTypes=agent`, {
        headers: { 'x-entity-org-id': 'org-a' },
      });
      expect(unavailableType.status).toBe(400);
      expect(await unavailableType.json()).toMatchObject({ code: 'invalid_search_filter' });

      const badCursor = await fetch(`${baseUrl}/api/search/scoped?q=renewal&cursor=not-a-cursor`, {
        headers: { 'x-entity-org-id': 'org-a' },
      });
      expect(badCursor.status).toBe(400);
      expect(await badCursor.json()).toMatchObject({ code: 'invalid_search_filter' });

      const badConnectorState = await fetch(`${baseUrl}/api/search/scoped?q=renewal&objectTypes=file&connectorState=green`, {
        headers: { 'x-entity-org-id': 'org-a' },
      });
      expect(badConnectorState.status).toBe(400);
      expect(await badConnectorState.json()).toMatchObject({ code: 'invalid_search_filter' });

      const incompatibleFilters = await fetch(
        `${baseUrl}/api/search/scoped?q=renewal&objectTypes=native_document,file&sourceId=workspace&teamId=team-a`,
        { headers: { 'x-entity-org-id': 'org-a' } },
      );
      expect(incompatibleFilters.status).toBe(400);
      expect(await incompatibleFilters.json()).toMatchObject({ code: 'invalid_search_filter' });
    });

    await withSearchServer(deps, async (baseUrl) => {
      const disabled = await fetch(`${baseUrl}/api/search/scoped?q=renewal`, {
        headers: { 'x-entity-org-id': 'org-a' },
      });
      expect(disabled.status).toBe(503);
      expect(await disabled.json()).toMatchObject({
        code: 'search_permission_strictness_disabled',
      });
    }, 'off');
  });

  it('never returns records outside the bound org (cross-org isolation)', async () => {
    // Prove-It security regression: org-scoping must hold at every backend. An org-a
    // request must never surface org-b records, and vice versa, even when both orgs
    // have matching rows. Org isolation is enforced at the SQL layer (WHERE org_id = ?);
    // these org-aware mocks simulate that boundary.
    const orgADoc = nativeDocument({ id: 'native-a', org_id: 'org-a', title: 'alpha renewal note' });
    const orgBDoc = nativeDocument({ id: 'native-b', org_id: 'org-b', title: 'beta renewal note' });
    const deps: ScopedSearchRouteDeps = {
      documentRepo: {
        listNativeDocuments: vi.fn((input: { org_id: string }) =>
          [orgADoc, orgBDoc].filter((r) => r.org_id === input.org_id)),
        listExternalDocumentRefs: vi.fn(() => []),
      },
      indexRepo: {
        search: vi.fn(() => []),
        getLatestSyncRun: vi.fn(() => syncRun()),
      },
      sourceRepo: {
        listSources: vi.fn(() => [fileSource()]),
        getSource: vi.fn(() => fileSource()),
      },
      now: () => new Date(now),
    };
    await withSearchServer(deps, async (baseUrl) => {
      const resA = await fetch(`${baseUrl}/api/search/scoped?q=renewal&objectTypes=native_document`, {
        headers: { 'x-entity-org-id': 'org-a' },
      });
      expect(resA.status).toBe(200);
      const bodyA = await resA.json() as any;
      expect(bodyA.results.map((r: any) => r.objectId)).toEqual(['native-a']);
      expect(deps.documentRepo?.listNativeDocuments).toHaveBeenCalledWith(expect.objectContaining({ org_id: 'org-a' }));

      const resB = await fetch(`${baseUrl}/api/search/scoped?q=renewal&objectTypes=native_document`, {
        headers: { 'x-entity-org-id': 'org-b' },
      });
      expect(resB.status).toBe(200);
      const bodyB = await resB.json() as any;
      expect(bodyB.results.map((r: any) => r.objectId)).toEqual(['native-b']);
      expect(deps.documentRepo?.listNativeDocuments).toHaveBeenCalledWith(expect.objectContaining({ org_id: 'org-b' }));
    });
  });
});

describe('task and proof scoped search', () => {
  it('returns tasks, evidence artifacts, and receipts through the shared envelope and filters', async () => {
    const taskRecord = task();
    const report = evidenceArtifact();
    const receipt = evidenceArtifact({
      id: 'receipt-renewal',
      artifact_kind: 'raw_task_receipt',
      title: 'Renewal task receipt',
      stable_path: '/artifacts/evidence/receipt-renewal.md',
      human_path_alias: '/tasks/77/receipt',
      mutability_policy: 'immutable_append_only',
    });
    const deps = healthyDeps({
      taskRepoForOrg: vi.fn(() => ({ listTasks: () => [taskRecord] })),
      artifactRepo: {
        listArtifacts: vi.fn(() => [report, receipt]),
      },
    });

    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/search/scoped?q=renewal&objectTypes=task,evidence_artifact,receipt&teamId=team-a&projectId=42&worktype=sales&ownerId=owner-a&reviewState=pending`,
        { headers: { 'x-entity-org-id': 'org-a', 'x-entity-sensitivity': 'customer' } },
      );
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body).toMatchObject({
        version: 'entity.scoped-search.v1',
        scope: { orgId: 'org-a', teamId: 'team-a', projectId: '42' },
        filters: {
          objectTypes: ['task', 'evidence_artifact', 'receipt'],
          worktype: 'sales',
          ownerId: 'owner-a',
          reviewState: 'pending',
        },
        searchState: {
          state: 'healthy',
          partial: false,
          backends: [
            { name: 'tasks', state: 'healthy', indexedAt: null, lagSeconds: null },
            { name: 'proofs', state: 'healthy', indexedAt: null, lagSeconds: null },
          ],
        },
        count: 3,
      });
      expect(body.results).toEqual(expect.arrayContaining([
        expect.objectContaining({
          objectType: 'task',
          objectId: '77',
          title: 'Renewal task',
          snippet: 'Prepare the permitted renewal packet',
          deepLink: { route: '/workplane/77' },
          state: 'review',
          reviewState: 'pending',
          provenance: expect.objectContaining({
            backend: 'tasks',
            indexed: false,
            canonical: true,
            mutability: 'mutable',
          }),
        }),
        expect.objectContaining({
          objectType: 'evidence_artifact',
          objectId: 'artifact-renewal',
          deepLink: { route: '/workplane/77' },
          provenance: expect.objectContaining({
            backend: 'proofs',
            sourceId: 'curated_report',
            mutability: 'editable_versioned',
          }),
        }),
        expect.objectContaining({
          objectType: 'receipt',
          objectId: 'receipt-renewal',
          provenance: expect.objectContaining({
            backend: 'proofs',
            sourceId: 'raw_task_receipt',
            mutability: 'immutable',
          }),
        }),
      ]));
      expect(deps.taskRepoForOrg).toHaveBeenCalledWith('org-a');
      expect(deps.artifactRepo?.listArtifacts).toHaveBeenCalledWith(expect.objectContaining({
        org_id: 'org-a',
        artifact_kinds: expect.arrayContaining(['raw_task_receipt', 'curated_report']),
      }));
    });
  });

  it('does not return document results for mixed queries with task-only filters', async () => {
    const deps = healthyDeps({
      taskRepoForOrg: vi.fn(() => ({ listTasks: () => [task()] })),
    });

    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/search/scoped?q=renewal&objectTypes=task,native_document&ownerId=owner-a`,
        { headers: { 'x-entity-org-id': 'org-a', 'x-entity-sensitivity': 'customer' } },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        searchState: { backends: [{ name: 'tasks', state: 'healthy' }] },
        count: 1,
        results: [{ objectType: 'task', objectId: '77' }],
      });
      expect(deps.documentRepo?.listNativeDocuments).not.toHaveBeenCalled();
    });
  });

  it('omits undisclosable task/proof rows and emits only opaque placeholders when disclosure is allowed', async () => {
    const hiddenTask = task({
      id: 88,
      name: 'Secret acquisition task',
      description: 'Do not leak acquisition details',
      metadata: JSON.stringify({ acl_json: { allowed_principal_ids: ['other'] } }),
    });
    const restrictedReceipt = evidenceArtifact({
      id: 'secret-receipt',
      artifact_kind: 'raw_task_receipt',
      title: 'Secret acquisition receipt',
      stable_path: '/artifacts/evidence/secret-receipt.md',
      origin_task_id: null,
      linked_object_refs: [],
      metadata_json: JSON.stringify({
        sensitivity: 'confidential',
        acl_json: { allowed_principal_ids: ['other'] },
        entity_visibility_policy: { disclose_existence: true },
      }),
    });
    const deps = healthyDeps({
      taskRepoForOrg: vi.fn(() => ({ listTasks: () => [hiddenTask] })),
      artifactRepo: { listArtifacts: vi.fn(() => [restrictedReceipt]) },
    });

    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/search/scoped?q=secret&objectTypes=task,receipt`,
        { headers: { 'x-entity-org-id': 'org-a', 'x-entity-principal-id': 'user-a' } },
      );
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.results).toEqual([expect.objectContaining({
        objectType: 'receipt',
        title: 'Restricted result',
        snippet: null,
        deepLink: null,
        sensitivity: null,
        permission: { state: 'restricted', reasons: ['restricted_by_policy'] },
      })]);
      const serialized = JSON.stringify(body.results);
      expect(serialized).not.toContain('acquisition');
      expect(serialized).not.toContain('secret-receipt');
      expect(serialized).not.toContain('/artifacts/evidence');
    });
  });

  it('inherits origin-task permissions, supports direct proof scope, and does not search private metadata', async () => {
    const protectedTask = task({
      metadata: JSON.stringify({
        sensitivity: 'confidential',
        entity_visibility_policy: { disclose_existence: true },
      }),
    });
    const inheritedProof = evidenceArtifact({
      metadata_json: JSON.stringify({ internal_marker: 'private-needle' }),
    });
    const directProof = evidenceArtifact({
      id: 'direct-renewal-proof',
      title: 'Direct renewal proof',
      origin_task_id: null,
      linked_object_refs: [],
    });
    const deps = healthyDeps({
      taskRepoForOrg: vi.fn(() => ({ listTasks: () => [protectedTask] })),
      artifactRepo: { listArtifacts: vi.fn(() => [inheritedProof, directProof]) },
    });

    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/search/scoped?q=renewal&objectTypes=evidence_artifact&teamId=team-a&projectId=42`,
        { headers: { 'x-entity-org-id': 'org-a' } },
      );
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.results).toEqual([expect.objectContaining({
        objectId: 'direct-renewal-proof',
        title: 'Direct renewal proof',
        permission: { state: 'visible', reasons: [] },
      })]);
      expect(JSON.stringify(body.results)).not.toContain('artifact-renewal');

      const metadataSearch = await fetch(
        `${baseUrl}/api/search/scoped?q=private-needle&objectTypes=evidence_artifact`,
        { headers: { 'x-entity-org-id': 'org-a' } },
      );
      expect(metadataSearch.status).toBe(200);
      expect(await metadataSearch.json()).toMatchObject({ count: 0, results: [] });
    });
  });

  it('enforces policy-input sensitivity for tasks and inherited proofs', async () => {
    const policySensitiveTask = task({
      worktype: 'business_ops',
      policy_inputs_json: JSON.stringify({
        layers: { worktype: { sensitivity_class: 'confidential' } },
      }),
      metadata: JSON.stringify({
        entity_visibility_policy: { disclose_existence: true },
      }),
    });
    const inheritedProof = evidenceArtifact();
    const deps = healthyDeps({
      taskRepoForOrg: vi.fn(() => ({ listTasks: () => [policySensitiveTask] })),
      artifactRepo: { listArtifacts: vi.fn(() => [inheritedProof]) },
    });

    await withSearchServer(deps, async (baseUrl) => {
      const restricted = await fetch(
        `${baseUrl}/api/search/scoped?q=renewal&objectTypes=task,evidence_artifact`,
        {
          headers: {
            'x-entity-org-id': 'org-a',
            'x-entity-sensitivity': 'workspace_defined',
          },
        },
      );
      expect(restricted.status).toBe(200);
      const restrictedBody = await restricted.json() as any;
      expect(restrictedBody.results).toHaveLength(2);
      expect(restrictedBody.results).toEqual(restrictedBody.results.map(() => expect.objectContaining({
        title: 'Restricted result',
        permission: { state: 'restricted', reasons: ['restricted_by_policy'] },
      })));

      const visible = await fetch(
        `${baseUrl}/api/search/scoped?q=renewal&objectTypes=task,evidence_artifact`,
        {
          headers: {
            'x-entity-org-id': 'org-a',
            'x-entity-sensitivity': 'workspace_defined,confidential_strategy',
          },
        },
      );
      expect(visible.status).toBe(200);
      expect((await visible.json() as any).results.map((entry: any) => entry.title))
        .toEqual(expect.arrayContaining(['Renewal task', 'Renewal proof report']));
    });
  });

  it('does not disclose restricted task attributes through protected filters', async () => {
    const restrictedTask = task({
      name: 'Secret renewal task',
      owner_principal_id: 'owner-secret',
      worktype: 'general',
      metadata: JSON.stringify({
        acl_json: { allowed_principal_ids: ['other'] },
        entity_visibility_policy: { disclose_existence: true },
      }),
    });
    const deps = healthyDeps({
      taskRepoForOrg: vi.fn(() => ({ listTasks: () => [restrictedTask] })),
    });

    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/search/scoped?q=secret&objectTypes=task&ownerId=owner-secret`,
        { headers: { 'x-entity-org-id': 'org-a', 'x-entity-principal-id': 'user-a' } },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ count: 0, results: [] });
    });
  });

  it('does not expose restricted proof integrity through backend health', async () => {
    const restrictedDegradedProof = evidenceArtifact({
      origin_task_id: null,
      linked_object_refs: [],
      integrity_state: 'hash_mismatch',
      availability_state: 'missing_body',
      metadata_json: JSON.stringify({
        acl_json: { allowed_principal_ids: ['other'] },
        entity_visibility_policy: { disclose_existence: true },
      }),
    });
    const deps = healthyDeps({
      taskRepoForOrg: vi.fn(() => ({ listTasks: () => [] })),
      artifactRepo: { listArtifacts: vi.fn(() => [restrictedDegradedProof]) },
    });

    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/search/scoped?q=renewal&objectTypes=evidence_artifact`,
        { headers: { 'x-entity-org-id': 'org-a', 'x-entity-principal-id': 'user-a' } },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        searchState: { state: 'healthy', partial: false, reasons: [] },
        count: 1,
        results: [{ title: 'Restricted result' }],
      });
    });
  });

  it('finds proof artifacts by their authorized origin task title', async () => {
    const proof = evidenceArtifact({
      title: 'Completion evidence',
    });
    const listArtifacts = vi.fn((input: { query?: string | null; query_origin_task_ids?: number[] }) =>
      input.query
        ? input.query_origin_task_ids?.includes(77) ? [proof] : []
        : [proof]
    );
    const deps = healthyDeps({
      taskRepoForOrg: vi.fn(() => ({ listTasks: () => [task()] })),
      artifactRepo: { listArtifacts },
    });

    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/search/scoped?q=renewal&objectTypes=evidence_artifact`,
        { headers: { 'x-entity-org-id': 'org-a', 'x-entity-sensitivity': 'customer' } },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        count: 1,
        results: [{ objectId: 'artifact-renewal', title: 'Completion evidence' }],
      });
    });
  });

  it('reports proof integrity degradation even when no result matches the query', async () => {
    const degradedReceipt = evidenceArtifact({
      id: 'missing-body',
      artifact_kind: 'raw_task_receipt',
      title: 'Different receipt',
      integrity_state: 'missing_body',
      availability_state: 'missing_body',
    });
    const listArtifacts = vi.fn((input: { query?: string | null }) => input.query ? [] : [degradedReceipt]);
    const deps = healthyDeps({
      taskRepoForOrg: vi.fn(() => ({ listTasks: () => [task()] })),
      artifactRepo: { listArtifacts },
    });

    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/search/scoped?q=absent&objectTypes=receipt`,
        { headers: { 'x-entity-org-id': 'org-a', 'x-entity-sensitivity': 'customer' } },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        searchState: {
          state: 'degraded',
          partial: true,
          reasons: expect.arrayContaining(['proof_integrity_degraded', 'proof_availability_degraded']),
          backends: [{ name: 'proofs', state: 'degraded' }],
        },
        count: 0,
        results: [],
      });
      expect(listArtifacts).toHaveBeenCalledWith(expect.objectContaining({ org_id: 'org-a' }));
    });
  });

  it('retains unknown proof-health reasons alongside degraded reasons', async () => {
    const mixedHealthProof = evidenceArtifact({
      title: 'Renewal mixed health proof',
      origin_task_id: null,
      linked_object_refs: [],
      integrity_state: 'unknown',
      availability_state: 'missing_body',
    });
    const deps = healthyDeps({
      taskRepoForOrg: vi.fn(() => ({ listTasks: () => [] })),
      artifactRepo: { listArtifacts: vi.fn(() => [mixedHealthProof]) },
    });

    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/search/scoped?q=renewal&objectTypes=evidence_artifact`,
        { headers: { 'x-entity-org-id': 'org-a' } },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        searchState: {
          state: 'degraded',
          reasons: expect.arrayContaining([
            'proof_integrity_unknown',
            'proof_availability_degraded',
          ]),
        },
      });
    });
  });

  it('paginates task results deterministically through the shared cursor', async () => {
    const tasks = [
      task({ id: 77, name: 'Renewal alpha' }),
      task({ id: 78, name: 'Renewal beta' }),
      task({ id: 79, name: 'Renewal gamma' }),
    ];
    const deps = healthyDeps({
      taskRepoForOrg: vi.fn(() => ({ listTasks: () => tasks })),
    });

    await withSearchServer(deps, async (baseUrl) => {
      const first = await fetch(
        `${baseUrl}/api/search/scoped?q=renewal&objectTypes=task&limit=2`,
        { headers: { 'x-entity-org-id': 'org-a', 'x-entity-sensitivity': 'customer' } },
      );
      expect(first.status).toBe(200);
      const firstBody = await first.json() as any;
      expect(firstBody.results.map((entry: any) => entry.objectId)).toEqual(['77', '78']);
      expect(firstBody.nextCursor).toEqual(expect.any(String));

      const second = await fetch(
        `${baseUrl}/api/search/scoped?q=renewal&objectTypes=task&limit=2&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
        { headers: { 'x-entity-org-id': 'org-a', 'x-entity-sensitivity': 'customer' } },
      );
      expect(second.status).toBe(200);
      expect(await second.json()).toMatchObject({
        count: 1,
        nextCursor: null,
        pagination: { offset: 2, limit: 2, truncated: false },
        results: [{ objectId: '79' }],
      });
    });
  });

  it('ranks task matches before applying the backend candidate cap', async () => {
    const newerDescriptionMatches = Array.from({ length: 10_101 }, (_, index) => task({
      id: 1_000 + index,
      name: `Unrelated task ${index}`,
      description: 'Renewal details appear only in the description',
    }));
    const olderTitleMatch = task({
      id: 77,
      name: 'Renewal exact title',
      updated_at: '2025-01-01T00:00:00.000Z',
    });
    const deps = healthyDeps({
      taskRepoForOrg: vi.fn(() => ({
        listTasks: () => [...newerDescriptionMatches, olderTitleMatch],
      })),
    });

    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/search/scoped?q=renewal&objectTypes=task&limit=1`,
        { headers: { 'x-entity-org-id': 'org-a', 'x-entity-sensitivity': 'customer' } },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        count: 1,
        results: [{ objectId: '77', title: 'Renewal exact title' }],
      });
    });
  });

  it('query-filters proof candidates before the backend cap while observing health separately', async () => {
    const matchingProof = evidenceArtifact({
      id: 'older-renewal-proof',
      title: 'Older renewal proof',
      origin_task_id: null,
      linked_object_refs: [],
      updated_at: '2025-01-01T00:00:00.000Z',
    });
    const healthRecords = Array.from({ length: 10_101 }, (_, index) => evidenceArtifact({
      id: `newer-unrelated-${index}`,
      title: `Unrelated proof ${index}`,
      origin_task_id: null,
      linked_object_refs: [],
    }));
    const listArtifacts = vi.fn((input: { query?: string | null }) =>
      input.query ? [matchingProof] : healthRecords
    );
    const deps = healthyDeps({
      taskRepoForOrg: vi.fn(() => ({ listTasks: () => [] })),
      artifactRepo: { listArtifacts },
    });

    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/search/scoped?q=renewal&objectTypes=evidence_artifact`,
        { headers: { 'x-entity-org-id': 'org-a' } },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        searchState: {
          state: 'unknown',
          reasons: expect.arrayContaining(['proof_search_health_partial']),
        },
        count: 1,
        results: [{ objectId: 'older-renewal-proof' }],
      });
      expect(listArtifacts).toHaveBeenNthCalledWith(1, expect.objectContaining({ query: 'renewal' }));
      expect(listArtifacts).toHaveBeenNthCalledWith(2, expect.not.objectContaining({ query: expect.anything() }));
    });
  });

  it('marks proof searches truncated when a capped batch is permission-filtered away', async () => {
    const restrictedProofs = Array.from({ length: 10_101 }, (_, index) => evidenceArtifact({
      id: `restricted-proof-${index}`,
      title: `Renewal restricted proof ${index}`,
      origin_task_id: null,
      linked_object_refs: [],
      metadata_json: JSON.stringify({
        acl_json: { allowed_principal_ids: ['other'] },
      }),
    }));
    const deps = healthyDeps({
      taskRepoForOrg: vi.fn(() => ({ listTasks: () => [] })),
      artifactRepo: { listArtifacts: vi.fn(() => restrictedProofs) },
    });

    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/search/scoped?q=renewal&objectTypes=evidence_artifact`,
        { headers: { 'x-entity-org-id': 'org-a' } },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        count: 0,
        pagination: { truncated: true },
        results: [],
      });
    });
  });

  it('returns partial results for one failed backend and 503 when every requested backend fails', async () => {
    const proof = evidenceArtifact();
    const partialDeps = healthyDeps({
      taskRepoForOrg: vi.fn(() => ({ listTasks: () => { throw new Error('tasks unavailable'); } })),
      artifactRepo: { listArtifacts: vi.fn(() => [proof]) },
    });
    await withSearchServer(partialDeps, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/search/scoped?q=renewal&objectTypes=task,evidence_artifact`,
        { headers: { 'x-entity-org-id': 'org-a' } },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        searchState: {
          state: 'degraded',
          partial: true,
          reasons: expect.arrayContaining(['tasks_backend_unavailable']),
          backends: [
            { name: 'tasks', state: 'failed' },
            { name: 'proofs', state: 'unknown' },
          ],
        },
        count: 0,
        results: [],
      });
    });

    const failedDeps = healthyDeps({
      taskRepoForOrg: vi.fn(() => ({ listTasks: () => { throw new Error('tasks unavailable'); } })),
      artifactRepo: { listArtifacts: vi.fn(() => { throw new Error('proofs unavailable'); }) },
    });
    await withSearchServer(failedDeps, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/search/scoped?q=renewal&objectTypes=task,receipt`,
        { headers: { 'x-entity-org-id': 'org-a' } },
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        searchState: {
          state: 'failed',
          partial: false,
          reasons: expect.arrayContaining(['tasks_backend_unavailable', 'proofs_backend_unavailable']),
        },
        count: 0,
        results: [],
      });
    });
  });

  it('keeps directly scoped proofs available when origin task loading fails', async () => {
    const directProof = evidenceArtifact({
      id: 'direct-proof-during-task-outage',
      title: 'Renewal direct proof',
      origin_task_id: null,
      linked_object_refs: [],
    });
    const deps = healthyDeps({
      taskRepoForOrg: vi.fn(() => ({ listTasks: () => { throw new Error('tasks unavailable'); } })),
      artifactRepo: { listArtifacts: vi.fn(() => [directProof]) },
    });

    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/search/scoped?q=renewal&objectTypes=evidence_artifact&teamId=team-a&projectId=42`,
        { headers: { 'x-entity-org-id': 'org-a' } },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        searchState: {
          state: 'unknown',
          partial: true,
          reasons: expect.arrayContaining(['proof_origin_task_context_unknown']),
          backends: [{ name: 'proofs', state: 'unknown' }],
        },
        count: 1,
        results: [{ objectId: 'direct-proof-during-task-outage' }],
      });
    });
  });
});
