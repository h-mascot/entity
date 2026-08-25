import { useCallback, useEffect, useState } from 'react';
import { buildApiCandidates, requestJsonWithFallback, toErrorMessage } from '../lib/http';
import { cacheApiPayload, readCachedApiPayloadEntry } from '../lib/offline';
import type {
  FileSource,
  SourceFileResponse,
  SourceTreeResponse,
  UnifiedSearchResponse,
} from '../types/filesystem';

export interface SourceSyncResult {
  sourceId: string;
  status: string;
  durationMs?: number;
  latestSyncRun?: {
    id: string;
    status: string;
    startedAt: string | null;
    finishedAt: string | null;
    filesScanned: number | null;
    filesIndexed: number | null;
    error: string | null;
  } | null;
}

interface UseFileSourcesOptions {
  apiBase?: string;
  enabled?: boolean;
}

interface CreateFileSourceInput {
  displayName: string;
  type: FileSource['type'];
  baseUrl?: string;
  basePath?: string;
  manifestPath?: string;
  authType?: FileSource['authType'];
  authRef?: string;
  icon?: string;
}

interface UpdateFileSourceInput {
  displayName?: string;
  type?: FileSource['type'];
  baseUrl?: string;
  basePath?: string;
  manifestPath?: string;
  authType?: FileSource['authType'];
  authRef?: string;
  icon?: string;
  enabled?: boolean;
}

function buildUrls(path: string, apiBase = ''): string[] {
  return buildApiCandidates(path, apiBase);
}

function buildApiOnlyUrls(path: string, apiBase = ''): string[] {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = apiBase.trim().replace(/\/+$/, '');

  if (!base) {
    return [`/api${normalizedPath}`];
  }

  return [`${base}/api${normalizedPath}`];
}

function uniqueUrls(urls: string[]): string[] {
  return Array.from(new Set(urls));
}

async function requestWithFallback(urls: string[], init: RequestInit, fallbackError: string): Promise<Response> {
  let lastError: Error | null = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, init);
      if (!response.ok) {
        const payload = await response.text();
        throw new Error(payload || `Request failed (${response.status})`);
      }
      return response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(fallbackError);
    }
  }

  throw lastError ?? new Error(fallbackError);
}

export function useFileSources({ apiBase = '', enabled = true }: UseFileSourcesOptions = {}) {
  const [sources, setSources] = useState<FileSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSources = useCallback(async () => {
    if (!enabled) {
      setSources([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload = await requestJsonWithFallback<{ sources?: FileSource[] }>({
        urls: [
          ...buildApiOnlyUrls('/sources?includeDisabled=true', apiBase),
          ...buildApiOnlyUrls('/fs/sources?includeDisabled=true', apiBase),
        ],
        fallbackError: 'Failed to load file sources.',
      });

      setSources(Array.isArray(payload.sources) ? payload.sources : []);
    } catch (err) {
      setError(toErrorMessage(err, 'Failed to load file sources.'));
      setSources([]);
    } finally {
      setLoading(false);
    }
  }, [apiBase, enabled]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  const createSource = useCallback(
    async (input: CreateFileSourceInput): Promise<FileSource> => {
      const response = await requestWithFallback(
        buildApiOnlyUrls('/sources', apiBase),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
        'Failed to create source.'
      );
      const created = (await response.json()) as FileSource;
      await loadSources();
      return created;
    },
    [apiBase, loadSources]
  );

  const updateSource = useCallback(
    async (id: string, input: UpdateFileSourceInput): Promise<FileSource> => {
      const response = await requestWithFallback(
        buildApiOnlyUrls(`/sources/${encodeURIComponent(id)}`, apiBase),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
        'Failed to update source.'
      );
      const updated = (await response.json()) as FileSource;
      await loadSources();
      return updated;
    },
    [apiBase, loadSources]
  );

  const setSourceEnabled = useCallback(
    async (id: string, enabledValue: boolean): Promise<FileSource> => {
      const response = await requestWithFallback(
        buildApiOnlyUrls(`/sources/${encodeURIComponent(id)}/enabled`, apiBase),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: enabledValue }),
        },
        'Failed to update source state.'
      );
      const updated = (await response.json()) as FileSource;
      await loadSources();
      return updated;
    },
    [apiBase, loadSources]
  );

  const deleteSource = useCallback(
    async (id: string): Promise<void> => {
      await requestWithFallback(
        buildApiOnlyUrls(`/sources/${encodeURIComponent(id)}`, apiBase),
        {
          method: 'DELETE',
        },
        'Failed to delete source.'
      );
      await loadSources();
    },
    [apiBase, loadSources]
  );

  const testSource = useCallback(
    async (id: string): Promise<{ status: 'ok' | 'error'; message: string; durationMs?: number }> => {
      const payload = await requestJsonWithFallback<{ status?: 'ok' | 'error'; message?: string; durationMs?: number }>(
        {
          urls: [
          ...buildApiOnlyUrls(`/sources/${encodeURIComponent(id)}/test`, apiBase),
          ...buildApiOnlyUrls(`/fs/sources/${encodeURIComponent(id)}/test`, apiBase),
        ],
          init: {
            method: 'POST',
          },
          fallbackError: 'Failed to test source.',
        }
      );

      return {
        status: payload.status === 'ok' ? 'ok' : 'error',
        message: payload.message ?? 'Unknown source test status.',
        durationMs: payload.durationMs,
      };
    },
    [apiBase]
  );

  const syncSource = useCallback(
    async (id: string): Promise<SourceSyncResult> => {
      const payload = await requestJsonWithFallback<SourceSyncResult>(
        {
          urls: [
            ...buildApiOnlyUrls(`/sources/${encodeURIComponent(id)}/sync`, apiBase),
            ...buildApiOnlyUrls(`/fs/sources/${encodeURIComponent(id)}/sync`, apiBase),
          ],
          init: {
            method: 'POST',
          },
          fallbackError: 'Failed to sync source.',
        }
      );

      return {
        sourceId: payload.sourceId ?? id,
        status: payload.status ?? 'unknown',
        durationMs: payload.durationMs,
        latestSyncRun: payload.latestSyncRun ?? null,
      };
    },
    [apiBase]
  );

  const fetchTree = useCallback(
    async (sourceId: string, treePath = ''): Promise<SourceTreeResponse> => {
      const encodedSourceId = encodeURIComponent(sourceId);
      const encodedPath = encodeURIComponent(treePath);
      const path = `/fs/tree?sourceId=${encodedSourceId}&path=${encodedPath}`;
      const urls = uniqueUrls([
        ...buildApiOnlyUrls(path, apiBase),
      ]);
      let lastError: Error | null = null;

      for (const url of urls) {
        try {
          const response = await fetch(url, { method: 'GET' });
          if (!response.ok) {
            throw new Error(`Request failed (${response.status})`);
          }

          const payload = (await response.json()) as SourceTreeResponse;
          void cacheApiPayload(url, payload);
          return payload;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error('Failed to load source tree.');
        }
      }

      const cachedEntry = await readCachedApiPayloadEntry<SourceTreeResponse>(urls);
      if (cachedEntry) {
        return cachedEntry.payload;
      }

      throw lastError ?? new Error('Failed to load source tree.');
    },
    [apiBase, sources]
  );

  const fetchFile = useCallback(
    async (sourceId: string, filePath: string): Promise<SourceFileResponse> => {
      const encodedSourceId = encodeURIComponent(sourceId);
      const encodedPath = encodeURIComponent(filePath);
      const path = `/fs/file?sourceId=${encodedSourceId}&path=${encodedPath}`;
      const urls = uniqueUrls([
        ...buildApiOnlyUrls(path, apiBase),
      ]);
      let lastError: Error | null = null;

      for (const url of urls) {
        try {
          const response = await fetch(url, { method: 'GET' });
          if (!response.ok) {
            throw new Error(`Request failed (${response.status})`);
          }

          const payload = (await response.json()) as SourceFileResponse;
          const servedFromCache = response.headers.get('X-Entity-Offline-Cache') === 'HIT';
          const cachedAtHeader = response.headers.get('X-Entity-Offline-Cache-Updated-At');
          const cacheAgeHeader = Number(response.headers.get('X-Entity-Offline-Cache-Age-Ms') ?? '');
          const cacheAgeMs = Number.isFinite(cacheAgeHeader) ? cacheAgeHeader : null;

          if (!servedFromCache) {
            void cacheApiPayload(url, payload);
          }

          return {
            ...payload,
            cached: servedFromCache,
            cachedAt: servedFromCache ? cachedAtHeader : null,
            cacheAgeMs: servedFromCache ? cacheAgeMs : null,
          };
        } catch (err) {
          lastError = err instanceof Error ? err : new Error('Failed to load source file.');
        }
      }

      const cachedEntry = await readCachedApiPayloadEntry<SourceFileResponse>(urls);
      if (cachedEntry) {
        return {
          ...cachedEntry.payload,
          cached: true,
          cachedAt: new Date(cachedEntry.updatedAt).toISOString(),
          cacheAgeMs: Math.max(0, Date.now() - cachedEntry.updatedAt),
        };
      }

      throw lastError ?? new Error('Failed to load source file.');
    },
    [apiBase, sources]
  );

  const createFile = useCallback(
    async (sourceId: string, filePath: string, content = ''): Promise<{ sourceId: string; path: string; updatedAt: string | null }> => {
      const response = await requestWithFallback(
        buildApiOnlyUrls('/fs/file', apiBase),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceId, path: filePath, content, mode: 'create' }),
        },
        'Failed to create file.'
      );
      return (await response.json()) as { sourceId: string; path: string; updatedAt: string | null };
    },
    [apiBase]
  );

  const writeFile = useCallback(
    async (sourceId: string, filePath: string, content: string): Promise<{ sourceId: string; path: string; updatedAt: string | null }> => {
      const response = await requestWithFallback(
        buildApiOnlyUrls('/fs/file', apiBase),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceId, path: filePath, content, mode: 'overwrite' }),
        },
        'Failed to write file.'
      );
      return (await response.json()) as { sourceId: string; path: string; updatedAt: string | null };
    },
    [apiBase]
  );

  const createFolder = useCallback(
    async (sourceId: string, folderPath: string): Promise<{ sourceId: string; path: string }> => {
      const response = await requestWithFallback(
        buildApiOnlyUrls('/fs/folder', apiBase),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceId, path: folderPath }),
        },
        'Failed to create folder.'
      );
      return (await response.json()) as { sourceId: string; path: string };
    },
    [apiBase]
  );

  const searchFiles = useCallback(
    async (query: string, options?: { sourceId?: string; type?: string; agent?: string; origin?: string; from?: string; to?: string; limit?: number }) => {
      const params = new URLSearchParams();
      if (query.trim()) {
        params.set('q', query.trim());
      }
      if (options?.sourceId) {
        params.set('sourceId', options.sourceId);
      }
      if (options?.type) {
        params.set('type', options.type);
      }
      if (options?.agent) {
        params.set('agent', options.agent);
      }
      if (options?.origin) {
        params.set('origin', options.origin);
      }
      if (options?.from) {
        params.set('from', options.from);
      }
      if (options?.to) {
        params.set('to', options.to);
      }
      if (typeof options?.limit === 'number') {
        params.set('limit', String(options.limit));
      }

      return requestJsonWithFallback<UnifiedSearchResponse>({
        urls: buildApiOnlyUrls(`/fs/search?${params.toString()}`, apiBase),
        fallbackError: 'Failed to search source files.',
      });
    },
    [apiBase]
  );

  return {
    sources,
    loading,
    error,
    reloadSources: loadSources,
    createSource,
    updateSource,
    setSourceEnabled,
    deleteSource,
    testSource,
    syncSource,
    fetchTree,
    fetchFile,
    createFile,
    writeFile,
    createFolder,
    searchFiles,
  };
}
