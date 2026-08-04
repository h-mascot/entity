/**
 * THE-904 / SRCH-A-05 — client helpers for GET /api/search/scoped.
 * THE-905 / SRCH-A-06 — proof-pack empty/degraded kind helpers.
 *
 * Consumes the entity.scoped-search.v1 envelope from SRCH-A-03/A-04.
 * UI must show healthy success, empty, and degraded/partial/failed states
 * without leaking restricted private metadata.
 */

import { buildApiCandidates, withApiToken } from './http.ts';

export const SCOPED_SEARCH_VERSION = 'entity.scoped-search.v1';
export const DEFAULT_SCOPED_SEARCH_ORG_ID = 'default-org';

export const DOC_HUB_SCOPED_OBJECT_TYPES = [
  'native_document',
  'external_document_ref',
  'file',
] as const;

export const WORKPLANE_SCOPED_OBJECT_TYPES = [
  'task',
  'evidence_artifact',
  'receipt',
] as const;

export type ScopedSearchObjectType =
  | (typeof DOC_HUB_SCOPED_OBJECT_TYPES)[number]
  | (typeof WORKPLANE_SCOPED_OBJECT_TYPES)[number];

export type ScopedSearchHealthState = 'healthy' | 'degraded' | 'failed' | 'unknown';

export type ScopedSearchSurface = 'doc_hub' | 'workplane';

export interface ScopedSearchBackendState {
  name: string;
  state: ScopedSearchHealthState;
  indexedAt: string | null;
  lagSeconds: number | null;
}

export interface ScopedSearchResult {
  objectType: ScopedSearchObjectType | string;
  objectId: string;
  title: string;
  snippet: string | null;
  deepLink: { route: string } | null;
  permission?: { state: 'visible' | 'restricted'; reasons?: string[] };
  sensitivity?: string | null;
  state?: string | null;
  reviewState?: string | null;
  provenance?: {
    backend?: string;
    sourceId?: string | null;
    indexedAt?: string | null;
    lagSeconds?: number | null;
  };
}

export interface ScopedSearchEnvelope {
  version: string;
  query: string;
  scope: { orgId: string; teamId: string | null; projectId: string | null };
  filters: { objectTypes: string[] } & Record<string, unknown>;
  searchState: {
    state: ScopedSearchHealthState;
    partial: boolean;
    reasons: string[];
    backends: ScopedSearchBackendState[];
  };
  count: number;
  nextCursor: string | null;
  pagination?: {
    offset: number;
    limit: number;
    truncated: boolean;
    maxOffset: number;
  };
  results: ScopedSearchResult[];
}

export type ScopedSearchViewStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'empty'
  | 'degraded'
  | 'failed'
  | 'error';

/** Distinct empty kinds for SRCH-A-06 proof pack — never coerce degraded/failed to healthy empty. */
export type ScopedSearchEmptyKind =
  | 'healthy-empty'
  | 'degraded-empty'
  | 'failed-empty'
  | 'none';

export interface ScopedSearchViewModel {
  status: ScopedSearchViewStatus;
  query: string;
  headline: string;
  detail: string | null;
  healthState: ScopedSearchHealthState | null;
  partial: boolean;
  reasons: string[];
  backends: ScopedSearchBackendState[];
  results: ScopedSearchDisplayResult[];
  httpStatus: number | null;
  errorMessage: string | null;
}

export function scopedSearchEmptyKind(
  view: Pick<ScopedSearchViewModel, 'status' | 'results'>,
): ScopedSearchEmptyKind {
  if (view.status === 'empty') return 'healthy-empty';
  if (view.status === 'degraded' && view.results.length === 0) return 'degraded-empty';
  if (view.status === 'failed') return 'failed-empty';
  return 'none';
}

export interface ScopedSearchDisplayResult {
  key: string;
  objectType: string;
  objectId: string;
  title: string;
  snippet: string | null;
  deepLinkRoute: string | null;
  restricted: boolean;
  metaLine: string | null;
}

export interface FetchScopedSearchParams {
  q: string;
  orgId?: string;
  objectTypes: readonly string[];
  apiBase?: string;
  limit?: number;
  teamId?: string;
  projectId?: string | number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export class ScopedSearchRequestError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly payload?: unknown;

  constructor(
    message: string,
    options: { status?: number; code?: string; payload?: unknown } = {},
  ) {
    super(message);
    this.name = 'ScopedSearchRequestError';
    this.status = options.status;
    this.code = options.code;
    this.payload = options.payload;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asHealth(value: unknown): ScopedSearchHealthState {
  if (value === 'healthy' || value === 'degraded' || value === 'failed' || value === 'unknown') {
    return value;
  }
  return 'unknown';
}

export function isRestrictedScopedResult(result: ScopedSearchResult): boolean {
  if (result.permission?.state === 'restricted') return true;
  if (result.objectId === 'restricted:opaque') return true;
  if (result.title === 'Restricted result') return true;
  return false;
}

export function toDisplayResult(result: ScopedSearchResult, index: number): ScopedSearchDisplayResult {
  const restricted = isRestrictedScopedResult(result);
  const objectType = asString(result.objectType) ?? 'unknown';
  const objectId = restricted ? 'restricted:opaque' : (asString(result.objectId) ?? `row-${index}`);
  const title = restricted ? 'Restricted result' : (asString(result.title) ?? objectId);
  const snippet = restricted ? null : (typeof result.snippet === 'string' ? result.snippet : null);
  const deepLinkRoute = restricted
    ? null
    : (result.deepLink && typeof result.deepLink.route === 'string' ? result.deepLink.route : null);

  let metaLine: string | null = null;
  if (!restricted) {
    const parts = [objectType];
    if (result.state) parts.push(String(result.state));
    if (result.provenance?.backend) parts.push(String(result.provenance.backend));
    metaLine = parts.join(' · ');
  } else {
    metaLine = 'Access restricted · private metadata hidden';
  }

  return {
    key: `${objectType}:${objectId}:${index}`,
    objectType,
    objectId,
    title,
    snippet,
    deepLinkRoute,
    restricted,
    metaLine,
  };
}

export function buildScopedSearchViewModel(input: {
  query: string;
  envelope?: ScopedSearchEnvelope | null;
  httpStatus?: number | null;
  errorMessage?: string | null;
  loading?: boolean;
}): ScopedSearchViewModel {
  const query = input.query.trim();
  if (input.loading) {
    return {
      status: 'loading',
      query,
      headline: 'Searching…',
      detail: null,
      healthState: null,
      partial: false,
      reasons: [],
      backends: [],
      results: [],
      httpStatus: input.httpStatus ?? null,
      errorMessage: null,
    };
  }

  if (!query) {
    return {
      status: 'idle',
      query: '',
      headline: 'Enter a query to search',
      detail: 'Scoped search covers permission-safe Docs, tasks, and proof artifacts.',
      healthState: null,
      partial: false,
      reasons: [],
      backends: [],
      results: [],
      httpStatus: null,
      errorMessage: null,
    };
  }

  if (input.errorMessage && !input.envelope) {
    return {
      status: 'error',
      query,
      headline: 'Search unavailable',
      detail: input.errorMessage,
      healthState: null,
      partial: false,
      reasons: [],
      backends: [],
      results: [],
      httpStatus: input.httpStatus ?? null,
      errorMessage: input.errorMessage,
    };
  }

  const envelope = input.envelope;
  if (!envelope) {
    return {
      status: 'error',
      query,
      headline: 'Search unavailable',
      detail: 'No search response received.',
      healthState: null,
      partial: false,
      reasons: [],
      backends: [],
      results: [],
      httpStatus: input.httpStatus ?? null,
      errorMessage: 'No search response received.',
    };
  }

  const healthState = asHealth(envelope.searchState?.state);
  const partial = Boolean(envelope.searchState?.partial);
  const reasons = Array.isArray(envelope.searchState?.reasons)
    ? envelope.searchState.reasons.filter((r): r is string => typeof r === 'string')
    : [];
  const backends = Array.isArray(envelope.searchState?.backends)
    ? envelope.searchState.backends.map((backend) => ({
        name: asString(backend.name) ?? 'unknown',
        state: asHealth(backend.state),
        indexedAt: asString(backend.indexedAt),
        lagSeconds: typeof backend.lagSeconds === 'number' ? backend.lagSeconds : null,
      }))
    : [];
  const results = (Array.isArray(envelope.results) ? envelope.results : []).map(toDisplayResult);

  if (healthState === 'failed' || input.httpStatus === 503) {
    return {
      status: 'failed',
      query,
      headline: 'All search backends failed',
      detail: reasons.length > 0
        ? reasons.join(' · ')
        : 'Scoped search could not complete. Results are empty and must not be treated as a healthy miss.',
      healthState: 'failed',
      partial,
      reasons,
      backends,
      results: [],
      httpStatus: input.httpStatus ?? 503,
      errorMessage: null,
    };
  }

  if (healthState === 'degraded' || healthState === 'unknown' || partial) {
    const empty = results.length === 0;
    return {
      status: 'degraded',
      query,
      headline: empty
        ? healthState === 'unknown'
          ? 'No matches · index health unknown'
          : 'No matches · search degraded'
        : healthState === 'unknown'
          ? 'Partial results · index health unknown'
          : 'Partial results · search degraded',
      detail: reasons.length > 0
        ? reasons.join(' · ')
        : 'One or more backends reported degraded or unknown health. Empty here is not a healthy miss.',
      healthState,
      partial: true,
      reasons,
      backends,
      results,
      httpStatus: input.httpStatus ?? 200,
      errorMessage: null,
    };
  }

  if (results.length === 0) {
    return {
      status: 'empty',
      query,
      headline: 'No matches',
      detail: 'Healthy search completed with zero visible results for this query and scope.',
      healthState: 'healthy',
      partial: false,
      reasons,
      backends,
      results: [],
      httpStatus: input.httpStatus ?? 200,
      errorMessage: null,
    };
  }

  return {
    status: 'success',
    query,
    headline: `${results.length} result${results.length === 1 ? '' : 's'}`,
    detail: null,
    healthState: 'healthy',
    partial: false,
    reasons,
    backends,
    results,
    httpStatus: input.httpStatus ?? 200,
    errorMessage: null,
  };
}

export function parseScopedSearchEnvelope(payload: unknown): ScopedSearchEnvelope {
  if (!isRecord(payload)) {
    throw new ScopedSearchRequestError('Scoped search response was not an object.');
  }
  const version = asString(payload.version);
  if (version !== SCOPED_SEARCH_VERSION) {
    throw new ScopedSearchRequestError(
      `Unexpected scoped search version: ${version ?? 'missing'}`,
    );
  }
  const searchState = isRecord(payload.searchState) ? payload.searchState : {};
  const scope = isRecord(payload.scope) ? payload.scope : {};
  const filters = isRecord(payload.filters) ? payload.filters : {};
  return {
    version,
    query: asString(payload.query) ?? '',
    scope: {
      orgId: asString(scope.orgId) ?? DEFAULT_SCOPED_SEARCH_ORG_ID,
      teamId: asString(scope.teamId),
      projectId: asString(scope.projectId),
    },
    filters: {
      ...filters,
      objectTypes: Array.isArray(filters.objectTypes)
        ? filters.objectTypes.filter((v): v is string => typeof v === 'string')
        : [],
    },
    searchState: {
      state: asHealth(searchState.state),
      partial: Boolean(searchState.partial),
      reasons: Array.isArray(searchState.reasons)
        ? searchState.reasons.filter((v): v is string => typeof v === 'string')
        : [],
      backends: Array.isArray(searchState.backends)
        ? (searchState.backends as ScopedSearchBackendState[])
        : [],
    },
    count: typeof payload.count === 'number' ? payload.count : 0,
    nextCursor: asString(payload.nextCursor),
    pagination: isRecord(payload.pagination)
      ? {
          offset: typeof payload.pagination.offset === 'number' ? payload.pagination.offset : 0,
          limit: typeof payload.pagination.limit === 'number' ? payload.pagination.limit : 0,
          truncated: Boolean(payload.pagination.truncated),
          maxOffset: typeof payload.pagination.maxOffset === 'number' ? payload.pagination.maxOffset : 0,
        }
      : undefined,
    results: Array.isArray(payload.results) ? (payload.results as ScopedSearchResult[]) : [],
  };
}

export async function fetchScopedSearch(
  params: FetchScopedSearchParams,
): Promise<{ envelope: ScopedSearchEnvelope; httpStatus: number }> {
  const q = params.q.trim();
  if (!q) {
    throw new ScopedSearchRequestError('q required', { code: 'query_required', status: 400 });
  }

  const orgId = (params.orgId ?? DEFAULT_SCOPED_SEARCH_ORG_ID).trim() || DEFAULT_SCOPED_SEARCH_ORG_ID;
  const search = new URLSearchParams();
  search.set('q', q);
  search.set('objectTypes', params.objectTypes.join(','));
  if (params.limit) search.set('limit', String(params.limit));
  if (params.teamId) search.set('teamId', params.teamId);
  if (params.projectId !== undefined && params.projectId !== null && `${params.projectId}` !== '') {
    search.set('projectId', String(params.projectId));
  }

  const urls = buildApiCandidates(`/search/scoped?${search.toString()}`, params.apiBase ?? '');
  const fetchImpl = params.fetchImpl ?? fetch;
  let lastError: Error | null = null;

  for (const url of urls) {
    try {
      const response = await fetchImpl(
        url,
        withApiToken({
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'x-entity-org-id': orgId,
          },
          signal: params.signal,
        }),
      );
      const text = await response.text();
      let payload: unknown = null;
      if (text) {
        try {
          payload = JSON.parse(text) as unknown;
        } catch {
          throw new ScopedSearchRequestError('Server returned invalid JSON.', {
            status: response.status,
          });
        }
      }

      if (response.status === 404) {
        lastError = new ScopedSearchRequestError('Scoped search endpoint not found.', {
          status: 404,
        });
        continue;
      }

      // 503 may still carry the stable empty envelope (all backends failed).
      if (response.ok || response.status === 503) {
        if (isRecord(payload) && asString(payload.version) === SCOPED_SEARCH_VERSION) {
          return {
            envelope: parseScopedSearchEnvelope(payload),
            httpStatus: response.status,
          };
        }
        if (response.status === 503) {
          throw new ScopedSearchRequestError(
            asString(isRecord(payload) ? payload.error : null)
              ?? 'Scoped search backends unavailable.',
            {
              status: 503,
              code: asString(isRecord(payload) ? payload.code : null) ?? undefined,
              payload,
            },
          );
        }
      }

      throw new ScopedSearchRequestError(
        asString(isRecord(payload) ? payload.error : null)
          ?? asString(isRecord(payload) ? payload.message : null)
          ?? `Scoped search failed with status ${response.status}.`,
        {
          status: response.status,
          code: asString(isRecord(payload) ? payload.code : null) ?? undefined,
          payload,
        },
      );
    } catch (error) {
      if (error instanceof ScopedSearchRequestError && error.status && error.status !== 404) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error('Scoped search request failed.');
    }
  }

  throw lastError ?? new ScopedSearchRequestError('Unable to reach scoped search.');
}

export function objectTypesForSurface(surface: ScopedSearchSurface): readonly ScopedSearchObjectType[] {
  return surface === 'workplane' ? WORKPLANE_SCOPED_OBJECT_TYPES : DOC_HUB_SCOPED_OBJECT_TYPES;
}
