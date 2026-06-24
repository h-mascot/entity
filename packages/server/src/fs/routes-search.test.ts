import express, { Router } from 'express';
import http from 'http';
import { describe, expect, it, vi } from 'vitest';
import type { FileIndexRecord, FileSyncRunRecord } from '../../../db/src/file-index';
import type { FileSourceRecord } from '../../../db/src/file-sources';
import type { FileSourceAdapter } from './adapters/types';
import { registerSearchRoutes, type SearchRouteDeps } from './routes-search';

const syncedAt = '2026-06-24T03:00:00.000Z';
const indexedAt = '2026-06-24T03:05:00.000Z';

function source(overrides: Partial<FileSourceRecord> = {}): FileSourceRecord {
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
    last_synced_at: syncedAt,
    created_at: syncedAt,
    updated_at: syncedAt,
    ...overrides,
  };
}

function indexRecord(overrides: Partial<FileIndexRecord> = {}): FileIndexRecord {
  return {
    id: 'workspace:plans/renewal.md',
    source_id: 'workspace',
    path: 'plans/renewal.md',
    title: 'Renewal plan',
    type: 'plan',
    agent: 'entity-mc',
    origin: 'task',
    is_recurring: false,
    recurring_pattern: null,
    tags: JSON.stringify(['customer', 'renewal']),
    updated_at: '2026-06-24T02:55:00.000Z',
    indexed_at: indexedAt,
    preview: 'Permitted indexed snippet',
    content_hash: 'sha256:indexed',
    ...overrides,
  };
}

function syncRun(overrides: Partial<FileSyncRunRecord> = {}): FileSyncRunRecord {
  return {
    id: 42,
    source_id: 'workspace',
    status: 'ok',
    started_at: '2026-06-24T02:59:00.000Z',
    finished_at: syncedAt,
    error: null,
    files_scanned: 5,
    files_indexed: 5,
    ...overrides,
  };
}

async function withSearchServer(deps: SearchRouteDeps, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  const router = Router();
  registerSearchRoutes(router, deps);
  app.use('/api/fs', router);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server failed to bind');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

describe('file-source search routes', () => {
  it('returns indexed search results in a stable permission/search envelope', async () => {
    const workspaceSource = source();
    const deps: SearchRouteDeps = {
      sourceRepo: {
        listSources: vi.fn(() => [workspaceSource]),
        getSource: vi.fn((id: string) => (id === workspaceSource.id ? workspaceSource : undefined)),
      },
      indexRepo: {
        search: vi.fn(() => [indexRecord()]),
        getLatestSyncRun: vi.fn(() => syncRun()),
      },
    };

    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/fs/search?q=renewal&indexState=indexed`);
      expect(response.status).toBe(200);
      const body = await response.json() as any;

      expect(body.indexed).toBe(true);
      expect(body.indexState).toMatchObject({ mode: 'indexed', fallbackUsed: false, degraded: false });
      expect(body.results[0]).toMatchObject({
        id: 'workspace:plans/renewal.md',
        objectType: 'file',
        object_type: 'file',
        title: 'Renewal plan',
        snippet: 'Permitted indexed snippet',
        source: {
          id: 'workspace',
          name: 'Workspace',
          type: 'local',
          health: 'ok',
        },
        deepLink: {
          kind: 'file_source',
          sourceId: 'workspace',
          path: 'plans/renewal.md',
        },
        scope: {
          sourceId: 'workspace',
          sourceType: 'local',
        },
        recency: {
          updatedAt: '2026-06-24T02:55:00.000Z',
          indexedAt,
        },
        provenance: {
          indexed: true,
          origin: 'task',
          agent: 'entity-mc',
          contentHash: 'sha256:indexed',
          tags: ['customer', 'renewal'],
        },
        permissionState: 'visible',
        permission_state: 'visible',
        entity_permission_state: 'visible',
        connectorState: {
          health: 'ok',
          lastSyncedAt: syncedAt,
          latestSyncRun: {
            status: 'ok',
            filesScanned: 5,
            filesIndexed: 5,
          },
        },
        indexState: {
          indexed: true,
          degraded: false,
          latestSyncStatus: 'ok',
        },
      });
    });
  });

  it('surfaces degraded connector and fallback index visibility with scoped filters', async () => {
    const degradedSource = source({
      id: 'degraded-docs',
      display_name: 'Degraded Docs',
      type: 'docsify',
      health: 'degraded',
      last_synced_at: '2026-06-24T01:00:00.000Z',
    });
    const adapter: FileSourceAdapter = {
      key: 'fake',
      validate: vi.fn(async () => undefined),
      capabilities: vi.fn(() => ({ read: true, write: false, rename: false, delete: false, list: true, search: false })),
      list: vi.fn(async () => [
        { sourceId: degradedSource.id, path: 'incidents/customer-risk.md', name: 'customer-risk.md', isDirectory: false, kind: 'file' as const, updatedAt: '2026-06-24T02:00:00.000Z' },
      ]),
      read: vi.fn(async () => ({ content: '', contentType: 'text/markdown' })),
      write: vi.fn(async () => ({})),
      mkdir: vi.fn(async () => undefined),
    };
    const deps: SearchRouteDeps = {
      sourceRepo: {
        listSources: vi.fn(() => [degradedSource]),
        getSource: vi.fn((id: string) => (id === degradedSource.id ? degradedSource : undefined)),
      },
      indexRepo: {
        search: vi.fn(() => []),
        getLatestSyncRun: vi.fn(() => syncRun({
          source_id: degradedSource.id,
          status: 'error',
          finished_at: '2026-06-24T01:00:00.000Z',
          error: 'connector timeout',
          files_scanned: 3,
          files_indexed: 0,
        })),
      },
      createAdapter: vi.fn(() => adapter),
    };

    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/fs/search?q=customer&connectorHealth=degraded&indexState=fallback`);
      expect(response.status).toBe(200);
      const body = await response.json() as any;

      expect(body.indexed).toBe(false);
      expect(body.indexState).toMatchObject({ mode: 'fallback', fallbackUsed: true, degraded: true });
      expect(body.results).toHaveLength(1);
      expect(body.results[0]).toMatchObject({
        id: 'degraded-docs:incidents/customer-risk.md',
        title: 'customer-risk.md',
        snippet: null,
        source: {
          id: 'degraded-docs',
          name: 'Degraded Docs',
          type: 'docsify',
          health: 'degraded',
        },
        provenance: {
          indexed: false,
          origin: 'unknown',
          agent: 'other',
        },
        connectorState: {
          health: 'degraded',
          latestSyncRun: {
            status: 'error',
            error: 'connector timeout',
          },
        },
        indexState: {
          indexed: false,
          degraded: true,
          latestSyncStatus: 'error',
        },
      });
      expect(deps.createAdapter).toHaveBeenCalledWith(degradedSource);
    });
  });

  it('rejects invalid connector/index filters before searching', async () => {
    const deps: SearchRouteDeps = {
      sourceRepo: { listSources: vi.fn(() => []), getSource: vi.fn(() => undefined) },
      indexRepo: { search: vi.fn(() => []), getLatestSyncRun: vi.fn(() => undefined) },
    };

    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/fs/search?indexState=stale`);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'indexState must be indexed, fallback, or all' });
      expect(deps.indexRepo?.search).not.toHaveBeenCalled();
    });
  });
});
