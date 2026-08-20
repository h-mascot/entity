import type {
  ExternalDocumentRefRecord,
  NativeDocumentRecord,
  NativeDocumentSearchIndexState,
} from '../../../db/src';
import type { FileIndexRecord, FileSyncRunRecord } from '../../../db/src/file-index';
import type { FileSourceRecord } from '../../../db/src/file-sources';
import { sourcePreviewRestricted } from '../fs/routes-search';
import { buildGoogleExternalDocumentMetadata } from '../google-docs-metadata';
import { permissionSafeRecord, type RequestOrgBinding } from '../request-permissions';
import type { ProtectedObject } from '../permissions';

export type DocumentObjectType = 'native_document' | 'external_document_ref' | 'file';
export type ScopedSearchObjectType = DocumentObjectType | 'task' | 'evidence_artifact' | 'receipt';

export interface ScopedSearchResult {
  objectType: ScopedSearchObjectType;
  objectId: string;
  title: string;
  snippet: string | null;
  deepLink: { route: string } | null;
  scope: {
    orgId: string;
    teamId: string | null;
    projectIds: string[];
  };
  state: string | null;
  reviewState: string | null;
  sensitivity: string | null;
  permission: {
    state: 'visible' | 'restricted';
    reasons: string[];
  };
  provenance: {
    backend: 'documents' | 'tasks' | 'proofs';
    sourceId: string | null;
    indexed: boolean;
    indexedAt: string | null;
    lagSeconds: number | null;
    canonical: true;
    mutability: 'mutable' | 'editable_versioned' | 'immutable' | 'external';
  };
  /** R-029 — search/indexing state so the UI can identify stale/degraded indexing. */
  indexState?: NativeDocumentSearchIndexState | null;
  ranking: {
    score: number;
    basis: 'keyword';
  };
  connectorState?: {
    state: string;
    authState?: string;
    referenceState?: string;
    lastSyncedAt?: string | null;
    lagSeconds?: number | null;
    latestSyncStatus?: string | null;
  };
}

export interface RankedSearchResult {
  result: ScopedSearchResult;
  recencyMs: number;
}

function parsePolicy(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function mayDiscloseExistence(...policies: Array<string | null | undefined>): boolean {
  return policies.some((policy) => parsePolicy(policy).disclose_existence === true);
}

export function restrictedResult(
  binding: RequestOrgBinding,
  result: ScopedSearchResult,
  reasons: string[],
): ScopedSearchResult {
  return {
    objectType: result.objectType,
    objectId: 'restricted:opaque',
    title: 'Restricted result',
    snippet: null,
    deepLink: null,
    scope: { orgId: binding.orgId, teamId: null, projectIds: [] },
    state: null,
    reviewState: null,
    sensitivity: null,
    permission: { state: 'restricted', reasons },
    provenance: {
      backend: result.provenance.backend,
      sourceId: null,
      indexed: result.provenance.indexed,
      indexedAt: null,
      lagSeconds: null,
      canonical: true,
      mutability: result.provenance.mutability,
    },
    ranking: { score: 0, basis: 'keyword' },
  };
}

export function permissionSafeResult(
  binding: RequestOrgBinding,
  object: ProtectedObject,
  result: ScopedSearchResult,
  disclosurePolicies: Array<string | null | undefined>,
): ScopedSearchResult | null {
  const envelope = permissionSafeRecord(binding, object, result as unknown as Record<string, unknown>, 'search');
  if (envelope.permission.allowed) return result;
  if (!mayDiscloseExistence(...disclosurePolicies)) return null;
  return restrictedResult(binding, result, ['restricted_by_policy']);
}

export function keywordScore(query: string, title: string): number {
  return title.toLowerCase().includes(query.toLowerCase()) ? 1 : 0.5;
}

export function nativeResult(binding: RequestOrgBinding, query: string, record: NativeDocumentRecord): RankedSearchResult | null {
  const indexState = record.search_index_state ?? null;
  const result: ScopedSearchResult = {
    objectType: 'native_document',
    objectId: record.id,
    title: record.title,
    snippet: null,
    deepLink: { route: `/api/document-objects/native-documents/${encodeURIComponent(record.id)}` },
    scope: {
      orgId: record.org_id,
      teamId: record.team_id,
      projectIds: record.project_id ? [String(record.project_id)] : [],
    },
    state: record.lifecycle_state,
    reviewState: null,
    sensitivity: record.sensitivity,
    permission: { state: 'visible', reasons: [] },
    provenance: {
      backend: 'documents',
      sourceId: null,
      indexed: Boolean(record.last_indexed_at),
      indexedAt: record.last_indexed_at ?? null,
      lagSeconds: null,
      canonical: true,
      mutability: record.mutability_policy === 'immutable' ? 'immutable' : 'editable_versioned',
    },
    indexState,
    ranking: { score: keywordScore(query, record.title), basis: 'keyword' },
  };
  const safe = permissionSafeResult(binding, {
    object_type: 'native_document',
    object_id: record.id,
    org_id: record.org_id,
    team_id: record.team_id,
    project_id: record.project_id,
    title: record.title,
    sensitivity: record.sensitivity,
    acl_json: record.acl_json,
  }, result, [record.acl_json]);
  return safe ? {
    result: safe,
    recencyMs: safe.permission.state === 'restricted' ? 0 : Date.parse(record.updated_at) || 0,
  } : null;
}

export function externalResult(
  binding: RequestOrgBinding,
  query: string,
  record: ExternalDocumentRefRecord,
  now: Date,
): RankedSearchResult | null {
  const lagSeconds = secondsSince(now, record.last_indexed_at);
  const effectiveConnector = buildGoogleExternalDocumentMetadata(record, now);
  const result: ScopedSearchResult = {
    objectType: 'external_document_ref',
    objectId: record.id,
    title: record.title,
    snippet: null,
    deepLink: { route: `/api/document-objects/external-document-refs/${encodeURIComponent(record.id)}` },
    scope: { orgId: record.org_id, teamId: null, projectIds: [] },
    state: record.external_ref_state,
    reviewState: null,
    sensitivity: null,
    permission: { state: 'visible', reasons: [] },
    provenance: {
      backend: 'documents',
      sourceId: record.connector_type,
      indexed: Boolean(record.last_indexed_at),
      indexedAt: record.last_indexed_at,
      lagSeconds,
      canonical: true,
      mutability: 'external',
    },
    ranking: { score: keywordScore(query, record.title), basis: 'keyword' },
    connectorState: {
      state: effectiveConnector.effective_readiness_state,
      authState: effectiveConnector.effective_auth_state,
      referenceState: record.external_ref_state,
      lastSyncedAt: record.last_indexed_at,
      lagSeconds,
    },
  };
  const safe = permissionSafeResult(binding, {
    object_type: 'external_document_ref',
    object_id: record.id,
    org_id: record.org_id,
    title: record.title,
    entity_visibility_policy_json: record.entity_visibility_policy_json,
  }, result, [record.entity_visibility_policy_json]);
  return safe ? {
    result: safe,
    recencyMs: safe.permission.state === 'restricted' ? 0 : Date.parse(record.updated_at) || 0,
  } : null;
}

export function sourceConnectorState(source: FileSourceRecord): string {
  if (source.health === 'ok') return 'ready';
  if (source.health === 'error') return 'unavailable';
  return 'degraded';
}

function fileRoute(sourceId: string, filePath: string): string {
  const encodedPath = filePath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  return `/docs/source/${encodeURIComponent(sourceId)}/${encodedPath}`;
}

export function fileResult(
  binding: RequestOrgBinding,
  query: string,
  record: FileIndexRecord,
  source: FileSourceRecord,
  latestRun: FileSyncRunRecord | undefined,
  now: Date,
): RankedSearchResult | null {
  const lagSeconds = secondsSince(now, record.indexed_at);
  const result: ScopedSearchResult = {
    objectType: 'file',
    objectId: record.id,
    title: record.title,
    snippet: record.preview,
    deepLink: { route: fileRoute(source.id, record.path) },
    scope: { orgId: record.org_id ?? binding.orgId, teamId: null, projectIds: [] },
    state: null,
    reviewState: null,
    sensitivity: record.sensitivity ?? null,
    permission: { state: 'visible', reasons: [] },
    provenance: {
      backend: 'documents',
      sourceId: source.id,
      indexed: true,
      indexedAt: record.indexed_at,
      lagSeconds,
      canonical: true,
      mutability: 'mutable',
    },
    ranking: { score: keywordScore(query, record.title), basis: 'keyword' },
    connectorState: {
      state: sourceConnectorState(source),
      lastSyncedAt: source.last_synced_at,
      lagSeconds,
      latestSyncStatus: latestRun?.status ?? null,
    },
  };
  if (sourcePreviewRestricted(source).restricted) {
    return {
      result: restrictedResult(binding, result, ['source_permission_policy_restricts_search_preview']),
      recencyMs: 0,
    };
  }
  const safe = permissionSafeResult(binding, {
    object_type: 'search_result',
    object_id: record.id,
    org_id: record.org_id,
    title: record.title,
    snippet: record.preview,
    content: record.preview,
    sensitivity: record.sensitivity,
    acl_json: record.acl_json,
    entity_visibility_policy_json: record.entity_visibility_policy_json,
  }, result, [record.entity_visibility_policy_json, record.acl_json]);
  return safe ? {
    result: safe,
    recencyMs: safe.permission.state === 'restricted'
      ? 0
      : Date.parse(record.updated_at ?? record.indexed_at) || 0,
  } : null;
}

export function secondsSince(now: Date, value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((now.getTime() - parsed) / 1000));
}
