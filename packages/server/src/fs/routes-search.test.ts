import express, { Router } from 'express';
import fs from 'node:fs';
import http from 'http';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { FileIndexRecord, FileIndexSearchFilters, FileSyncRunRecord } from '../../../db/src/file-index';
import type { FileSourceRecord } from '../../../db/src/file-sources';
import type { FsFileOwnershipRecord } from '../../../db/src/file-ownership';
import type { FileSourceAdapter } from './adapters/types';
import { registerSearchRoutes, type SearchRouteDeps } from './routes-search';
import { ownershipVisible, resolveOwnershipScope } from './ownership';

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

async function withTeamSearchServer(
  deps: SearchRouteDeps,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use((req, _res, next) => {
    req.headers['x-entity-org-id'] = 'org-a';
    req.entityCustomerPrincipal = {
      principalId: 'team-a-viewer',
      principalType: 'human',
      permission: {
        principal_id: 'team-a-viewer',
        grants: [{ role: 'viewer', org_id: 'org-a', team_id: 'team-a' }],
      },
      orgIds: ['org-a'],
      isGlobalAdmin: false,
    };
    next();
  });
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
  it('fills the requested indexed result limit after hiding unauthorized top-ranked rows', async () => {
    const workspaceSource = source();
    const visiblePath = 'uploads/org-a/team-a/visible.txt';
    const forbiddenRows = Array.from({ length: 50 }, (_, index) => indexRecord({
      id: `${workspaceSource.id}:uploads/org-a/team-b/forbidden-${index}.txt`,
      path: `uploads/org-a/team-b/forbidden-${index}.txt`,
      title: `Forbidden ${index}`,
      org_id: 'org-a',
    }));
    const records = [...forbiddenRows, indexRecord({
      id: `${workspaceSource.id}:${visiblePath}`,
      path: visiblePath,
      title: 'Visible result',
      org_id: 'org-a',
    })];
    const search = vi.fn((_query: string, filters: FileIndexSearchFilters = {}) => {
      const offset = filters.offset ?? 0;
      const pageSize = filters.limit ?? 50;
      return records.slice(offset, offset + pageSize);
    });
    const ownershipRepo = {
      getOwnership: vi.fn((_sourceId: string, filePath: string) => ({
        source_id: workspaceSource.id,
        path: filePath,
        org_id: 'org-a',
        team_id: filePath === visiblePath ? 'team-a' : 'team-b',
        owner_principal_id: 'uploader',
        display_name: path.basename(filePath),
        origin: 'upload' as const,
        uploaded_at: indexedAt,
        updated_at: indexedAt,
      } satisfies FsFileOwnershipRecord)),
      listOwnershipForOrg: vi.fn(() => []),
    };
    const app = express();
    app.use((req, _res, next) => {
      req.headers['x-entity-org-id'] = 'org-a';
      req.entityCustomerPrincipal = {
        principalId: 'team-viewer',
        principalType: 'human',
        permission: {
          principal_id: 'team-viewer',
          grants: [{ role: 'viewer', org_id: 'org-a', team_id: 'team-a' }],
        },
        orgIds: ['org-a'],
        isGlobalAdmin: false,
      };
      next();
    });
    const router = Router();
    registerSearchRoutes(router, {
      sourceRepo: {
        listSources: vi.fn(() => [workspaceSource]),
        getSource: vi.fn(() => workspaceSource),
      },
      indexRepo: { search, getLatestSyncRun: vi.fn(() => syncRun()) },
      ownershipRepo,
    });
    app.use('/api/fs', router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server failed to bind');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/fs/search?q=result&indexState=indexed&limit=1`);
      expect(response.status).toBe(200);
      const body = await response.json() as { results: Array<{ path: string }> };
      expect(body.results).toHaveLength(1);
      expect(body.results[0]?.path).toBe(visiblePath);
      expect(search).toHaveBeenCalledWith('result', expect.objectContaining({ limit: 50, offset: 0 }));
      expect(search).toHaveBeenCalledWith('result', expect.objectContaining({ limit: 50, offset: 50 }));
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('falls back for all-mode when indexed matches are all unauthorized', async () => {
    const workspaceSource = source();
    const indexedPath = 'uploads/org-a/team-b/indexed-match.md';
    const fallbackPath = 'uploads/org-a/team-a/fallback-match.md';
    const ownershipRepo = {
      getOwnership: vi.fn((_sourceId: string, filePath: string) => ({
        source_id: workspaceSource.id,
        path: filePath,
        org_id: 'org-a',
        team_id: filePath === indexedPath ? 'team-b' : 'team-a',
        owner_principal_id: 'uploader',
        display_name: path.basename(filePath),
        origin: 'upload' as const,
        uploaded_at: indexedAt,
        updated_at: indexedAt,
      } satisfies FsFileOwnershipRecord)),
      listOwnershipForOrg: vi.fn(() => []),
    };
    const adapter: FileSourceAdapter = {
      key: 'fallback-match',
      validate: vi.fn(async () => undefined),
      capabilities: vi.fn(() => ({ read: true, write: false, rename: false, delete: false, list: true, search: false })),
      list: vi.fn(async (directoryPath) => directoryPath === ''
        ? [{ sourceId: workspaceSource.id, path: fallbackPath, name: 'fallback-match.md', isDirectory: false, kind: 'file' as const, updatedAt: indexedAt }]
        : []),
      read: vi.fn(async () => ({ content: '', contentType: 'text/plain' })),
      write: vi.fn(async () => ({})),
      mkdir: vi.fn(async () => undefined),
    };
    const app = express();
    app.use((req, _res, next) => {
      req.headers['x-entity-org-id'] = 'org-a';
      req.entityCustomerPrincipal = {
        principalId: 'team-a-viewer',
        principalType: 'human',
        permission: {
          principal_id: 'team-a-viewer',
          grants: [{ role: 'viewer', org_id: 'org-a', team_id: 'team-a' }],
        },
        orgIds: ['org-a'],
        isGlobalAdmin: false,
      };
      next();
    });
    const router = Router();
    registerSearchRoutes(router, {
      sourceRepo: {
        listSources: vi.fn(() => [workspaceSource]),
        getSource: vi.fn(() => workspaceSource),
      },
      indexRepo: {
        search: vi.fn(() => [indexRecord({
          id: `${workspaceSource.id}:${indexedPath}`,
          path: indexedPath,
          title: 'Indexed match',
          org_id: 'org-a',
        })]),
        getLatestSyncRun: vi.fn(() => undefined),
      },
      ownershipRepo,
      createAdapter: vi.fn(() => adapter),
    });
    app.use('/api/fs', router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server failed to bind');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/fs/search?q=match&indexState=all`);
      expect(response.status).toBe(200);
      const body = await response.json() as { indexed: boolean; indexState: { mode: string; fallbackUsed: boolean }; results: Array<{ path: string }> };
      expect(body.indexed).toBe(false);
      expect(body.indexState).toMatchObject({ mode: 'fallback', fallbackUsed: true });
      expect(body.results.map((result) => result.path)).toEqual([fallbackPath]);

      const indexedOnly = await fetch(`http://127.0.0.1:${address.port}/api/fs/search?q=match&indexState=indexed`);
      expect(indexedOnly.status).toBe(200);
      await expect(indexedOnly.json()).resolves.toMatchObject({
        indexed: true,
        indexState: { mode: 'indexed', fallbackUsed: false },
        results: [],
      });

      const fallbackOnly = await fetch(`http://127.0.0.1:${address.port}/api/fs/search?q=match&indexState=fallback`);
      expect(fallbackOnly.status).toBe(200);
      await expect(fallbackOnly.json()).resolves.toMatchObject({
        indexed: false,
        indexState: { mode: 'fallback', fallbackUsed: true },
        results: [{ path: fallbackPath }],
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('returns a typed scope-limit error beyond 1000 candidates but allows exact-end fallback', async () => {
    const workspaceSource = source();
    const fallbackPath = 'uploads/org-a/team-a/fallback-forbidden.md';
    let records = Array.from({ length: 1000 }, (_, index) => indexRecord({
      id: `${workspaceSource.id}:uploads/org-a/team-b/forbidden-${index}.md`,
      path: `uploads/org-a/team-b/forbidden-${index}.md`,
      title: `Forbidden ${index}`,
      org_id: 'org-a',
    }));
    const ownershipRepo = {
      getOwnership: vi.fn((_sourceId: string, filePath: string) => ({
        source_id: workspaceSource.id,
        path: filePath,
        org_id: 'org-a',
        team_id: filePath === fallbackPath ? 'team-a' : 'team-b',
        owner_principal_id: 'uploader',
        display_name: path.basename(filePath),
        origin: 'upload' as const,
        uploaded_at: indexedAt,
        updated_at: indexedAt,
      } satisfies FsFileOwnershipRecord)),
      listOwnershipForOrg: vi.fn(() => []),
    };
    const adapter: FileSourceAdapter = {
      key: 'bounded-fallback',
      validate: vi.fn(async () => undefined),
      capabilities: vi.fn(() => ({ read: true, write: false, rename: false, delete: false, list: true, search: false })),
      list: vi.fn(async (directoryPath) => directoryPath === ''
        ? [{ sourceId: workspaceSource.id, path: fallbackPath, name: 'fallback-forbidden.md', isDirectory: false, kind: 'file' as const, updatedAt: indexedAt }]
        : []),
      read: vi.fn(async () => ({ content: '', contentType: 'text/plain' })),
      write: vi.fn(async () => ({})),
      mkdir: vi.fn(async () => undefined),
    };
    const indexSearch = vi.fn((_query: string, filters: FileIndexSearchFilters = {}) => {
      const offset = filters.offset ?? 0;
      const pageSize = filters.limit ?? 50;
      return records.slice(offset, offset + pageSize);
    });
    const app = express();
    app.use((req, _res, next) => {
      req.headers['x-entity-org-id'] = 'org-a';
      req.entityCustomerPrincipal = {
        principalId: 'team-a-viewer',
        principalType: 'human',
        permission: {
          principal_id: 'team-a-viewer',
          grants: [{ role: 'viewer', org_id: 'org-a', team_id: 'team-a' }],
        },
        orgIds: ['org-a'],
        isGlobalAdmin: false,
      };
      next();
    });
    const router = Router();
    registerSearchRoutes(router, {
      sourceRepo: {
        listSources: vi.fn(() => [workspaceSource]),
        getSource: vi.fn(() => workspaceSource),
      },
      indexRepo: { search: indexSearch, getLatestSyncRun: vi.fn(() => undefined) },
      ownershipRepo,
      createAdapter: vi.fn(() => adapter),
    });
    app.use('/api/fs', router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server failed to bind');
    try {
      const exactEnd = await fetch(`http://127.0.0.1:${address.port}/api/fs/search?q=forbidden&indexState=all`);
      expect(exactEnd.status).toBe(200);
      await expect(exactEnd.json()).resolves.toMatchObject({
        indexed: false,
        indexState: { mode: 'fallback', fallbackUsed: true },
        results: [{ path: fallbackPath }],
      });

      records = [...records, indexRecord({
        id: `${workspaceSource.id}:uploads/org-a/team-b/forbidden-extra.md`,
        path: 'uploads/org-a/team-b/forbidden-extra.md',
        title: 'Forbidden extra',
        org_id: 'org-a',
      })];
      (adapter.list as ReturnType<typeof vi.fn>).mockClear();
      const overBudget = await fetch(`http://127.0.0.1:${address.port}/api/fs/search?q=forbidden&indexState=all`);
      expect(overBudget.status).toBe(422);
      const body = await overBudget.json() as { code?: string; error?: string; results?: unknown };
      expect(body.code).toBe('search_scope_scan_limit');
      expect(body.error).toContain('narrow the query or choose a source');
      expect(body.results).toBeUndefined();
      expect(adapter.list).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('does not treat project-only grants as org-wide ownership visibility', () => {
    const scope = resolveOwnershipScope({
      orgId: 'org-a',
      principal: { principal_id: 'principal-a', grants: [{ role: 'viewer', org_id: 'org-a', team_id: 'team-a', project_id: 'project-1' }] },
    });
    expect(scope.hasOrgWide).toBe(false);
    expect(scope.visibleTeamIds.has('team-a')).toBe(false);
    expect(ownershipVisible(scope, {
      source_id: 'workspace', path: 'uploads/org-a/team-b/x.txt', org_id: 'org-a', team_id: 'team-b',
      owner_principal_id: 'other', display_name: 'x.txt', origin: 'upload', uploaded_at: indexedAt, updated_at: indexedAt,
    })).toBe(false);
  });

  it('keeps ownership tenant-bound even when team ids match across orgs', () => {
    const scope = resolveOwnershipScope({
      orgId: 'org-a',
      principal: { principal_id: 'principal-a', grants: [{ role: 'viewer', org_id: 'org-a', team_id: 'team-a' }] },
    });
    expect(ownershipVisible(scope, {
      source_id: 'workspace', path: 'uploads/org-b/team-a/x.txt', org_id: 'org-b', team_id: 'team-a',
      owner_principal_id: 'other', display_name: 'x.txt', origin: 'upload', uploaded_at: indexedAt, updated_at: indexedAt,
    })).toBe(false);
  });

  it('hides pending reservations even from org-wide callers', () => {
    const scope = resolveOwnershipScope({
      orgId: 'org-a',
      principal: { principal_id: 'principal-a', grants: [{ role: 'viewer', org_id: 'org-a' }] },
    });
    expect(ownershipVisible(scope, {
      source_id: 'workspace', path: 'uploads/org-a/pending.txt', org_id: 'org-a', team_id: null,
      owner_principal_id: 'owner', display_name: 'pending.txt', origin: 'pending', uploaded_at: indexedAt, updated_at: indexedAt,
    })).toBe(false);
  });

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

  it('uses canonical team ownership for indexed and fallback search permissions', async () => {
    const workspaceSource = source();
    const ownedPath = 'uploads/org-a/team-a/owned-upload.txt';
    const foreignPath = 'uploads/org-a/team-b/foreign-upload.txt';
    const ownedOwnership: FsFileOwnershipRecord = {
      source_id: workspaceSource.id,
      path: ownedPath,
      org_id: 'org-a',
      team_id: 'team-a',
      owner_principal_id: 'uploader-a',
      display_name: 'owned-upload.txt',
      origin: 'upload',
      uploaded_at: indexedAt,
      updated_at: indexedAt,
    };
    const foreignOwnership: FsFileOwnershipRecord = {
      ...ownedOwnership,
      path: foreignPath,
      team_id: 'team-b',
      display_name: 'foreign-upload.txt',
    };
    const aclDeniedRecord = indexRecord({
      id: `${workspaceSource.id}:${ownedPath}:acl-denied`,
      path: ownedPath,
      title: 'ACL denied upload',
      org_id: 'org-a',
      acl_json: JSON.stringify({ denied_principal_ids: ['team-viewer'] }),
    });
    let indexedResults: FileIndexRecord[] = [indexRecord({
      id: `${workspaceSource.id}:${ownedPath}`,
      path: ownedPath,
      title: 'Owned upload',
      org_id: 'org-a',
    })];
    let fallbackNodes: Array<{
      sourceId: string;
      path: string;
      name: string;
      isDirectory: false;
      kind: 'file';
      updatedAt: string;
    }> = [];
    const ownershipRepo = {
      getOwnership: vi.fn((sourceId: string, filePath: string) => {
        if (sourceId !== workspaceSource.id) return undefined;
        if (filePath === ownedPath) return ownedOwnership;
        if (filePath === foreignPath) return foreignOwnership;
        return undefined;
      }),
      listOwnershipForOrg: vi.fn(() => [ownedOwnership, foreignOwnership]),
    };
    const adapter: FileSourceAdapter = {
      key: 'team-owned-search',
      validate: vi.fn(async () => undefined),
      capabilities: vi.fn(() => ({ read: true, write: false, rename: false, delete: false, list: true, search: false })),
      list: vi.fn(async () => fallbackNodes),
      read: vi.fn(async () => ({ content: '', contentType: 'text/plain' })),
      write: vi.fn(async () => ({})),
      mkdir: vi.fn(async () => undefined),
    };
    const app = express();
    app.use((req, _res, next) => {
      req.headers['x-entity-org-id'] = 'org-a';
      req.entityCustomerPrincipal = {
        principalId: 'team-viewer',
        principalType: 'human',
        permission: {
          principal_id: 'team-viewer',
          grants: [{ role: 'viewer', org_id: 'org-a', team_id: 'team-a' }],
        },
        orgIds: ['org-a'],
        isGlobalAdmin: false,
      };
      next();
    });
    const router = Router();
    registerSearchRoutes(router, {
      sourceRepo: {
        listSources: vi.fn(() => [workspaceSource]),
        getSource: vi.fn((id: string) => id === workspaceSource.id ? workspaceSource : undefined),
      },
      indexRepo: {
        search: vi.fn(() => indexedResults),
        getLatestSyncRun: vi.fn(() => syncRun()),
      },
      ownershipRepo,
      createAdapter: vi.fn(() => adapter),
    });
    app.use('/api/fs', router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server failed to bind');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const ownedIndexed = await fetch(`${baseUrl}/api/fs/search?q=owned&indexState=indexed`);
      expect(ownedIndexed.status).toBe(200);
      expect((await ownedIndexed.json()).results[0]).toMatchObject({
        title: 'Owned upload',
        restricted: false,
        permission: { allowed: true },
        owner: { ownerPrincipalId: 'uploader-a', teamId: 'team-a' },
      });

      indexedResults = [indexRecord({
        id: `${workspaceSource.id}:${foreignPath}`,
        path: foreignPath,
        title: 'Foreign upload',
        org_id: 'org-a',
      })];
      const foreignIndexed = await fetch(`${baseUrl}/api/fs/search?q=foreign&indexState=indexed`);
      expect(foreignIndexed.status).toBe(200);
      expect((await foreignIndexed.json()).results).toHaveLength(0);

      indexedResults = [aclDeniedRecord];
      const aclDenied = await fetch(`${baseUrl}/api/fs/search?q=acl&indexState=indexed`);
      expect(aclDenied.status).toBe(200);
      const aclDeniedBody = await aclDenied.json() as any;
      expect(aclDeniedBody.results[0]).toMatchObject({
        title: 'Restricted file',
        restricted: true,
        permission: { allowed: false },
      });
      expect(aclDeniedBody.results[0].owner).toBeUndefined();
      expect(JSON.stringify(aclDeniedBody)).not.toContain('uploader-a');

      indexedResults = [];
      fallbackNodes = [{
        sourceId: workspaceSource.id,
        path: ownedPath,
        name: 'owned-upload.txt',
        isDirectory: false,
        kind: 'file',
        updatedAt: indexedAt,
      }];
      const ownedFallback = await fetch(`${baseUrl}/api/fs/search?q=owned&indexState=fallback`);
      expect(ownedFallback.status).toBe(200);
      expect((await ownedFallback.json()).results[0]).toMatchObject({
        title: 'owned-upload.txt',
        restricted: false,
        permission: { allowed: true },
        owner: { ownerPrincipalId: 'uploader-a', teamId: 'team-a' },
      });

      fallbackNodes = [{
        sourceId: workspaceSource.id,
        path: foreignPath,
        name: 'foreign-upload.txt',
        isDirectory: false,
        kind: 'file',
        updatedAt: indexedAt,
      }];
      const foreignFallback = await fetch(`${baseUrl}/api/fs/search?q=foreign&indexState=fallback`);
      expect(foreignFallback.status).toBe(200);
      expect((await foreignFallback.json()).results).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('does not charge foreign fallback files against the visible-file budget', async () => {
    const workspaceSource = source();
    const visiblePath = 'uploads/org-a/team-a/match-visible.txt';
    const foreignPaths = Array.from({ length: 250 }, (_, index) => `uploads/org-a/team-b/match-foreign-${index}.txt`);
    const ownershipRecords: FsFileOwnershipRecord[] = [
      ...foreignPaths.map((filePath) => ({
        source_id: workspaceSource.id, path: filePath, org_id: 'org-a', team_id: 'team-b',
        owner_principal_id: 'foreign', display_name: path.basename(filePath), origin: 'upload' as const,
        uploaded_at: indexedAt, updated_at: indexedAt,
      })),
      {
        source_id: workspaceSource.id, path: visiblePath, org_id: 'org-a', team_id: 'team-a',
        owner_principal_id: 'owner', display_name: 'match-visible.txt', origin: 'upload',
        uploaded_at: indexedAt, updated_at: indexedAt,
      },
    ];
    const ownershipRepo = {
      getOwnership: vi.fn((sourceId: string, filePath: string) => ownershipRecords.find((row) => row.source_id === sourceId && row.path === filePath)),
      listOwnershipForOrg: vi.fn(() => ownershipRecords),
    };
    const nodes = [...foreignPaths, visiblePath].map((filePath) => ({
      sourceId: workspaceSource.id,
      path: filePath,
      name: path.basename(filePath),
      isDirectory: false as const,
      kind: 'file' as const,
      updatedAt: indexedAt,
    }));
    const adapter: FileSourceAdapter = {
      key: 'foreign-file-budget',
      validate: vi.fn(async () => undefined),
      capabilities: vi.fn(() => ({ read: true, write: false, rename: false, delete: false, list: true, search: false })),
      list: vi.fn(async () => nodes),
      read: vi.fn(async () => ({ content: '', contentType: 'text/plain' })),
      write: vi.fn(async () => ({})),
      mkdir: vi.fn(async () => undefined),
    };

    await withTeamSearchServer({
      sourceRepo: { listSources: vi.fn(() => [workspaceSource]), getSource: vi.fn(() => workspaceSource) },
      indexRepo: { search: vi.fn(() => []), getLatestSyncRun: vi.fn(() => undefined) },
      ownershipRepo,
      createAdapter: vi.fn(() => adapter),
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/fs/search?q=match&indexState=fallback&limit=1`);
      expect(response.status).toBe(200);
      expect((await response.json()).results.map((result: { path: string }) => result.path)).toEqual([visiblePath]);
    });
  });

  it('prunes foreign upload directories before charging the traversal budget', async () => {
    const workspaceSource = source();
    const foreignDirectories = Array.from({ length: 50 }, (_, index) => `uploads/org-a/team-b/foreign-${index}`);
    const visibleDirectory = 'uploads/org-a/team-a/visible';
    const visiblePath = `${visibleDirectory}/match-visible.txt`;
    const ownershipRecords: FsFileOwnershipRecord[] = [
      ...foreignDirectories.map((directory) => ({
        source_id: workspaceSource.id, path: `${directory}/hidden.txt`, org_id: 'org-a', team_id: 'team-b',
        owner_principal_id: 'foreign', display_name: 'hidden.txt', origin: 'upload' as const,
        uploaded_at: indexedAt, updated_at: indexedAt,
      })),
      {
        source_id: workspaceSource.id, path: visiblePath, org_id: 'org-a', team_id: 'team-a',
        owner_principal_id: 'owner', display_name: 'match-visible.txt', origin: 'upload',
        uploaded_at: indexedAt, updated_at: indexedAt,
      },
    ];
    const ownershipRepo = {
      getOwnership: vi.fn((sourceId: string, filePath: string) => ownershipRecords.find((row) => row.source_id === sourceId && row.path === filePath)),
      listOwnershipForOrg: vi.fn(() => ownershipRecords),
    };
    const adapter: FileSourceAdapter = {
      key: 'foreign-directory-budget',
      validate: vi.fn(async () => undefined),
      capabilities: vi.fn(() => ({ read: true, write: false, rename: false, delete: false, list: true, search: false })),
      list: vi.fn(async (directoryPath) => {
        if (directoryPath === '') {
          return [...foreignDirectories, visibleDirectory].map((filePath) => ({
            sourceId: workspaceSource.id,
            path: filePath,
            name: path.basename(filePath),
            isDirectory: true as const,
            kind: 'directory' as const,
          }));
        }
        if (directoryPath === visibleDirectory) {
          return [{ sourceId: workspaceSource.id, path: visiblePath, name: 'match-visible.txt', isDirectory: false as const, kind: 'file' as const, updatedAt: indexedAt }];
        }
        return [];
      }),
      read: vi.fn(async () => ({ content: '', contentType: 'text/plain' })),
      write: vi.fn(async () => ({})),
      mkdir: vi.fn(async () => undefined),
    };

    await withTeamSearchServer({
      sourceRepo: { listSources: vi.fn(() => [workspaceSource]), getSource: vi.fn(() => workspaceSource) },
      indexRepo: { search: vi.fn(() => []), getLatestSyncRun: vi.fn(() => undefined) },
      ownershipRepo,
      createAdapter: vi.fn(() => adapter),
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/fs/search?q=match&indexState=fallback&limit=1`);
      expect(response.status).toBe(200);
      expect((await response.json()).results.map((result: { path: string }) => result.path)).toEqual([visiblePath]);
    });
  });

  it('returns a typed error when fallback candidate work reaches the hard budget', async () => {
    const workspaceSource = source();
    const foreignPaths = Array.from({ length: 1_001 }, (_, index) => `uploads/org-a/team-b/match-foreign-${index}.txt`);
    const ownershipRecords: FsFileOwnershipRecord[] = foreignPaths.map((filePath) => ({
      source_id: workspaceSource.id, path: filePath, org_id: 'org-a', team_id: 'team-b',
      owner_principal_id: 'foreign', display_name: path.basename(filePath), origin: 'upload',
      uploaded_at: indexedAt, updated_at: indexedAt,
    }));
    const ownershipRepo = {
      getOwnership: vi.fn((sourceId: string, filePath: string) => ownershipRecords.find((row) => row.source_id === sourceId && row.path === filePath)),
      listOwnershipForOrg: vi.fn(() => ownershipRecords),
    };
    const adapter: FileSourceAdapter = {
      key: 'fallback-scan-budget',
      validate: vi.fn(async () => undefined),
      capabilities: vi.fn(() => ({ read: true, write: false, rename: false, delete: false, list: true, search: false })),
      list: vi.fn(async (directoryPath) => directoryPath === '' ? foreignPaths.map((filePath) => ({
        sourceId: workspaceSource.id,
        path: filePath,
        name: path.basename(filePath),
        isDirectory: false as const,
        kind: 'file' as const,
        updatedAt: indexedAt,
      })) : []),
      read: vi.fn(async () => ({ content: '', contentType: 'text/plain' })),
      write: vi.fn(async () => ({})),
      mkdir: vi.fn(async () => undefined),
    };

    await withTeamSearchServer({
      sourceRepo: { listSources: vi.fn(() => [workspaceSource]), getSource: vi.fn(() => workspaceSource) },
      indexRepo: { search: vi.fn(() => []), getLatestSyncRun: vi.fn(() => undefined) },
      ownershipRepo,
      createAdapter: vi.fn(() => adapter),
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/fs/search?q=match&indexState=fallback&limit=1`);
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toEqual({
        code: 'search_scope_scan_limit',
        error: 'Search scope is too broad; narrow the query or choose a source.',
      });
    });
  });

  it('counts nonmatching fallback files toward the raw node budget', async () => {
    const workspaceSource = source();
    const paths = Array.from({ length: 1_001 }, (_, index) => `docs/unrelated-${index}.txt`);
    const adapter: FileSourceAdapter = {
      key: 'fallback-nonmatching-budget',
      validate: vi.fn(async () => undefined),
      capabilities: vi.fn(() => ({ read: true, write: false, rename: false, delete: false, list: true, search: false })),
      list: vi.fn(async (directoryPath) => directoryPath === '' ? paths.map((filePath) => ({
        sourceId: workspaceSource.id,
        path: filePath,
        name: path.basename(filePath),
        isDirectory: false as const,
        kind: 'file' as const,
        updatedAt: indexedAt,
      })) : []),
      read: vi.fn(async () => ({ content: '', contentType: 'text/plain' })),
      write: vi.fn(async () => ({})),
      mkdir: vi.fn(async () => undefined),
    };

    await withTeamSearchServer({
      sourceRepo: { listSources: vi.fn(() => [workspaceSource]), getSource: vi.fn(() => workspaceSource) },
      indexRepo: { search: vi.fn(() => []), getLatestSyncRun: vi.fn(() => undefined) },
      ownershipRepo: {
        getOwnership: vi.fn(() => undefined),
        listOwnershipForOrg: vi.fn(() => []),
      },
      createAdapter: vi.fn(() => adapter),
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/fs/search?q=needle&indexState=fallback&limit=1`);
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({ code: 'search_scope_scan_limit' });
    });
  });

  it('counts foreign fallback directories toward the raw node budget', async () => {
    const workspaceSource = source();
    const directories = Array.from({ length: 1_001 }, (_, index) => `uploads/org-a/team-b/foreign-${index}`);
    const ownershipRecords: FsFileOwnershipRecord[] = [{
      source_id: workspaceSource.id, path: `${directories[0]}/hidden.txt`, org_id: 'org-a', team_id: 'team-b',
      owner_principal_id: 'foreign', display_name: 'hidden.txt', origin: 'upload',
      uploaded_at: indexedAt, updated_at: indexedAt,
    }];
    const adapter: FileSourceAdapter = {
      key: 'fallback-foreign-directory-budget',
      validate: vi.fn(async () => undefined),
      capabilities: vi.fn(() => ({ read: true, write: false, rename: false, delete: false, list: true, search: false })),
      list: vi.fn(async (directoryPath) => directoryPath === '' ? directories.map((directory) => ({
        sourceId: workspaceSource.id,
        path: directory,
        name: path.basename(directory),
        isDirectory: true as const,
        kind: 'directory' as const,
      })) : []),
      read: vi.fn(async () => ({ content: '', contentType: 'text/plain' })),
      write: vi.fn(async () => ({})),
      mkdir: vi.fn(async () => undefined),
    };

    await withTeamSearchServer({
      sourceRepo: { listSources: vi.fn(() => [workspaceSource]), getSource: vi.fn(() => workspaceSource) },
      indexRepo: { search: vi.fn(() => []), getLatestSyncRun: vi.fn(() => undefined) },
      ownershipRepo: {
        getOwnership: vi.fn(() => undefined),
        listOwnershipForOrg: vi.fn(() => ownershipRecords),
      },
      createAdapter: vi.fn(() => adapter),
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/fs/search?q=hidden&indexState=fallback&limit=1`);
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({ code: 'search_scope_scan_limit' });
    });
  });

  it('surfaces Helm status references without exposing deep Helm object search', async () => {
    const helmStatusSource = source({
      id: 'helm-status',
      display_name: 'Helm Runtime Status',
      type: 'local',
      base_path: '/workspace/status/helm',
      capabilities: JSON.stringify({
        entity_visibility_policy: {
          allow_preview: true,
          reference_only: true,
        },
      }),
    });
    const deps: SearchRouteDeps = {
      sourceRepo: {
        listSources: vi.fn(() => [helmStatusSource]),
        getSource: vi.fn((id: string) => (id === helmStatusSource.id ? helmStatusSource : undefined)),
      },
      indexRepo: {
        search: vi.fn(() => [
          indexRecord({
            id: 'helm-status:runtimes/book-status.md',
            source_id: helmStatusSource.id,
            path: 'runtimes/book-status.md',
            title: 'Book runtime status reference',
            type: 'runtime_status_ref',
            agent: 'book',
            tags: JSON.stringify(['helm-status', 'runtime-reference']),
            preview: 'Helm status reference: health degraded, readiness degraded, open in Helm for runtime details.',
            content_hash: 'sha256:helm-status-ref',
          }),
        ]),
        getLatestSyncRun: vi.fn(() => syncRun({ source_id: helmStatusSource.id })),
      },
    };

    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/fs/search?q=helm%20status&indexState=indexed`);
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.results).toHaveLength(1);
      expect(body.results[0]).toMatchObject({
        objectType: 'file',
        object_type: 'file',
        title: 'Book runtime status reference',
        type: 'runtime_status_ref',
        source: {
          id: 'helm-status',
          name: 'Helm Runtime Status',
        },
        deepLink: {
          kind: 'file_source',
          sourceId: 'helm-status',
          path: 'runtimes/book-status.md',
        },
        provenance: {
          indexed: true,
          origin: 'task',
          agent: 'book',
          tags: ['helm-status', 'runtime-reference'],
        },
      });
      const serialized = JSON.stringify(body);
      expect(serialized).toContain('Helm status reference');
      expect(serialized).not.toContain('helmObject');
      expect(serialized).not.toContain('runtimeAdminPayload');
      expect(serialized).not.toContain('deploymentMutation');
      expect(serialized).not.toContain('/api/helm/objects');
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

  it('suppresses stale indexed previews when source policy disables search preview', async () => {
    const restrictedSource = source({
      capabilities: JSON.stringify({
        entity_visibility_policy: {
          restricted: true,
          allow_preview: false,
        },
      }),
    });
    const deps: SearchRouteDeps = {
      sourceRepo: {
        listSources: vi.fn(() => [restrictedSource]),
        getSource: vi.fn((id: string) => (id === restrictedSource.id ? restrictedSource : undefined)),
      },
      indexRepo: {
        search: vi.fn(() => [
          indexRecord({
            title: 'Customer risk compensation notes',
            preview: 'Do not leak stale indexed compensation snippet',
          }),
        ]),
        getLatestSyncRun: vi.fn(() => syncRun()),
      },
      ownershipRepo: {
        getOwnership: vi.fn(() => ({
          source_id: 'workspace',
          path: 'plans/renewal.md',
          org_id: 'default-org',
          team_id: 'team-secret',
          owner_principal_id: 'owner-secret',
          display_name: 'private-compensation.md',
          origin: 'upload' as const,
          uploaded_at: indexedAt,
          updated_at: indexedAt,
        })),
        listOwnershipForOrg: vi.fn(() => []),
      },
    };

    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/fs/search?q=compensation&indexState=indexed`);
      expect(response.status).toBe(200);
      const body = await response.json() as any;

      expect(body.results).toHaveLength(1);
      expect(body.results[0]).toMatchObject({
        title: 'Restricted file',
        preview: null,
        snippet: null,
        permissionState: 'restricted',
        permission_state: 'restricted',
        entity_permission_state: 'restricted',
        restricted: true,
        placeholder: true,
        permission_reasons: ['source permission policy restricts search preview'],
      });
      expect(JSON.stringify(body)).not.toContain('Do not leak stale indexed compensation snippet');
      expect(JSON.stringify(body)).not.toContain('Customer risk compensation notes');
      expect(body.results[0].owner).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain('owner-secret');
      expect(JSON.stringify(body)).not.toContain('private-compensation.md');
    });
  });

  it('suppresses restricted indexed previews before returning file search results', async () => {
    const workspaceSource = source();
    const deps: SearchRouteDeps = {
      sourceRepo: {
        listSources: vi.fn(() => [workspaceSource]),
        getSource: vi.fn((id: string) => (id === workspaceSource.id ? workspaceSource : undefined)),
      },
      indexRepo: {
        search: vi.fn(() => [indexRecord({
          title: 'Restricted indexed account memo',
          preview: 'Do not leak indexed customer preview',
          sensitivity: 'customer',
        })]),
        getLatestSyncRun: vi.fn(() => syncRun()),
      },
    };

    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/fs/search?q=account&indexState=indexed`, {
        headers: { 'x-entity-org-id': 'default-org' },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as any;

      expect(body.results[0]).toMatchObject({
        id: 'workspace:plans/renewal.md',
        title: 'Restricted file',
        preview: null,
        snippet: null,
        permission_state: 'restricted',
        entity_permission_state: 'restricted',
        restricted: true,
        placeholder: true,
      });
      expect(JSON.stringify(body)).not.toContain('Restricted indexed account memo');
      expect(JSON.stringify(body)).not.toContain('Do not leak indexed customer preview');
    });
  });

  it('suppresses restricted fallback previews before returning source search results', async () => {
    const workspaceSource = source();
    const adapter: FileSourceAdapter = {
      key: 'fake',
      validate: vi.fn(async () => undefined),
      capabilities: vi.fn(() => ({ read: true, write: false, rename: false, delete: false, list: true, search: false })),
      list: vi.fn(async () => [
        {
          sourceId: workspaceSource.id,
          path: 'restricted/customer-note.md',
          name: 'Restricted customer note',
          isDirectory: false,
          kind: 'file' as const,
          updatedAt: '2026-06-24T02:00:00.000Z',
          sensitivity: 'customer',
        },
      ]),
      read: vi.fn(async () => ({ content: '', contentType: 'text/markdown' })),
      write: vi.fn(async () => ({})),
      mkdir: vi.fn(async () => undefined),
    };
    const deps: SearchRouteDeps = {
      sourceRepo: {
        listSources: vi.fn(() => [workspaceSource]),
        getSource: vi.fn((id: string) => (id === workspaceSource.id ? workspaceSource : undefined)),
      },
      indexRepo: {
        search: vi.fn(() => []),
        getLatestSyncRun: vi.fn(() => syncRun()),
      },
      ownershipRepo: {
        getOwnership: vi.fn(() => ({
          source_id: 'workspace',
          path: 'restricted/customer-note.md',
          org_id: 'default-org',
          team_id: 'team-secret',
          owner_principal_id: 'owner-secret',
          display_name: 'private-customer-note.md',
          origin: 'upload' as const,
          uploaded_at: indexedAt,
          updated_at: indexedAt,
        })),
        listOwnershipForOrg: vi.fn(() => []),
      },
      createAdapter: vi.fn(() => adapter),
    };

    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/fs/search?q=customer&indexState=fallback`, {
        headers: { 'x-entity-org-id': 'default-org' },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as any;

      expect(body.results[0]).toMatchObject({
        id: 'workspace:restricted/customer-note.md',
        title: 'Restricted file',
        preview: null,
        snippet: null,
        permission_state: 'restricted',
        entity_permission_state: 'restricted',
        restricted: true,
        placeholder: true,
      });
      expect(JSON.stringify(body)).not.toContain('Restricted customer note');
      expect(body.results[0].owner).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain('owner-secret');
      expect(JSON.stringify(body)).not.toContain('private-customer-note.md');
    });
  });

  it('excludes unimplemented connectors from indexed search results', async () => {
    const githubSource = source({
      id: 'github-upstream',
      display_name: 'GitHub upstream',
      type: 'github',
      base_path: null,
      base_url: 'https://github.com/example/example',
    });
    const workspaceSource = source();
    const deps: SearchRouteDeps = {
      sourceRepo: {
        listSources: vi.fn(() => [githubSource, workspaceSource]),
        getSource: vi.fn((id: string) =>
          id === githubSource.id ? githubSource : id === workspaceSource.id ? workspaceSource : undefined
        ),
      },
      indexRepo: {
        // Stale rows from a source whose connector is not implemented in this
        // build must never surface as actionable search results.
        search: vi.fn(() => [
          indexRecord({
            id: 'github-upstream:legacy/upstream-plan.md',
            source_id: githubSource.id,
            path: 'legacy/upstream-plan.md',
            title: 'Legacy upstream plan',
          }),
          indexRecord(),
        ]),
        getLatestSyncRun: vi.fn(() => syncRun()),
      },
    };

    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/fs/search?q=renewal`);
      expect(response.status).toBe(200);
      const body = await response.json() as any;

      expect(body.indexed).toBe(true);
      expect(body.results).toHaveLength(1);
      expect(body.results[0].sourceId).toBe('workspace');
      expect(JSON.stringify(body)).not.toContain('github-upstream');
      expect(JSON.stringify(body)).not.toContain('Legacy upstream plan');
    });
  });

  it('excludes stale indexed rows from disabled sources', async () => {
    const disabledSource = source({ id: 'disabled-workspace', display_name: 'Disabled Workspace', enabled: false });
    const deps: SearchRouteDeps = {
      sourceRepo: {
        listSources: vi.fn(() => [disabledSource]),
        getSource: vi.fn(() => disabledSource),
      },
      indexRepo: {
        search: vi.fn(() => [indexRecord({ id: 'disabled-workspace:old.md', source_id: disabledSource.id, path: 'old.md', title: 'Stale disabled result' })]),
        getLatestSyncRun: vi.fn(() => syncRun({ source_id: disabledSource.id })),
      },
    };

    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/fs/search?q=old&indexState=indexed`);
      expect(response.status).toBe(200);
      const body = await response.json() as { results: unknown[] };
      expect(body.results).toEqual([]);
    });
  });

  it('never dispatches fallback search to unimplemented connectors', async () => {
    const githubSource = source({
      id: 'github-upstream',
      display_name: 'GitHub upstream',
      type: 'github',
      base_path: null,
      base_url: 'https://github.com/example/example',
    });
    const workspaceSource = source();
    const adapter: FileSourceAdapter = {
      key: 'fake',
      validate: vi.fn(async () => undefined),
      capabilities: vi.fn(() => ({ read: true, write: false, rename: false, delete: false, list: true, search: false })),
      list: vi.fn(async () => [
        { sourceId: workspaceSource.id, path: 'plans/renewal.md', name: 'renewal.md', isDirectory: false, kind: 'file' as const, updatedAt: '2026-06-24T02:00:00.000Z' },
      ]),
      read: vi.fn(async () => ({ content: '', contentType: 'text/markdown' })),
      write: vi.fn(async () => ({})),
      mkdir: vi.fn(async () => undefined),
    };
    const deps: SearchRouteDeps = {
      sourceRepo: {
        listSources: vi.fn(() => [githubSource, workspaceSource]),
        getSource: vi.fn((id: string) =>
          id === githubSource.id ? githubSource : id === workspaceSource.id ? workspaceSource : undefined
        ),
      },
      indexRepo: {
        search: vi.fn(() => []),
        getLatestSyncRun: vi.fn(() => syncRun()),
      },
      createAdapter: vi.fn((candidate: FileSourceRecord) => {
        if (candidate.id === githubSource.id) {
          throw new Error('fallback search must not create an adapter for an unimplemented connector');
        }
        return adapter;
      }),
    };

    await withSearchServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/fs/search?q=renewal&indexState=fallback`);
      expect(response.status).toBe(200);
      const body = await response.json() as any;

      expect(body.indexed).toBe(false);
      expect(body.results).toHaveLength(1);
      expect(body.results[0]).toMatchObject({
        id: 'workspace:plans/renewal.md',
        sourceId: 'workspace',
      });
      expect(deps.createAdapter).not.toHaveBeenCalledWith(githubSource);
      expect(deps.createAdapter).toHaveBeenCalledWith(workspaceSource);

      // An explicit sourceId pointed at an unavailable source yields no
      // results and no dispatch either.
      const scoped = await fetch(`${baseUrl}/api/fs/search?q=renewal&sourceId=${githubSource.id}&indexState=fallback`);
      expect(scoped.status).toBe(200);
      const scopedBody = await scoped.json() as any;
      expect(scopedBody.results).toHaveLength(0);
      expect(deps.createAdapter).toHaveBeenCalledTimes(1);
    });
  });

  it('searches an overlapping owned path through the physical source context', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'entity-search-overlap-'));
    const nested = path.join(root, 'nested');
    await fs.promises.mkdir(path.join(nested, 'uploads/org-a/team-a'), { recursive: true });
    const workspaceSource = source({ id: 'workspace', base_path: root });
    const nestedSource = source({ id: 'nested', base_path: nested });
    const sources = [workspaceSource, nestedSource];
    const row: FsFileOwnershipRecord = {
      source_id: 'nested', path: 'uploads/org-a/team-a/file.txt', org_id: 'org-a', team_id: 'team-a',
      owner_principal_id: 'owner-a', display_name: 'file.txt', origin: 'upload', uploaded_at: indexedAt, updated_at: indexedAt,
    };
    const ownershipRepo = {
      getOwnership: vi.fn((sourceId: string, filePath: string) => sourceId === row.source_id && filePath === row.path ? row : undefined),
      listOwnershipForOrg: vi.fn(() => [row]),
    };
    const adapter: FileSourceAdapter = {
      key: 'overlap', validate: vi.fn(async () => undefined),
      capabilities: () => ({ read: true, write: false, rename: false, delete: false, list: true, search: false }),
      list: vi.fn(async (directoryPath) => {
        const directories: Record<string, { path: string; name: string }[]> = {
          '': [{ path: 'nested', name: 'nested' }],
          nested: [{ path: 'nested/uploads', name: 'uploads' }],
          'nested/uploads': [{ path: 'nested/uploads/org-a', name: 'org-a' }],
          'nested/uploads/org-a': [{ path: 'nested/uploads/org-a/team-a', name: 'team-a' }],
        };
        if (directories[directoryPath]) return directories[directoryPath].map((entry) => ({ sourceId: 'workspace', ...entry, isDirectory: true, kind: 'directory' as const }));
        if (directoryPath === 'nested/uploads/org-a/team-a') return [{ sourceId: 'workspace', path: 'nested/uploads/org-a/team-a/file.txt', name: 'file.txt', isDirectory: false, kind: 'file' as const, updatedAt: indexedAt }];
        return [];
      }),
      read: vi.fn(async () => ({ content: 'private', contentType: 'text/plain', size: 7, isBinary: false })),
      write: vi.fn(async () => ({})),
      mkdir: vi.fn(async () => undefined),
    };
    const app = express();
    let grants = [{ role: 'viewer' as const, org_id: 'org-a', team_id: 'team-a' }];
    app.use((req, _res, next) => {
      req.headers['x-entity-org-id'] = 'org-a';
      (req as unknown as { entityCustomerPrincipal: unknown }).entityCustomerPrincipal = {
        principalId: 'viewer-a', principalType: 'human', permission: { principal_id: 'viewer-a', grants }, orgIds: ['org-a'], isGlobalAdmin: false,
      };
      next();
    });
    const router = Router();
    registerSearchRoutes(router, {
      sourceRepo: { listSources: vi.fn(() => sources), getSource: vi.fn((id: string) => sources.find((entry) => entry.id === id)) },
      indexRepo: { search: vi.fn(() => []), getLatestSyncRun: vi.fn(() => undefined) },
      ownershipRepo, createAdapter: vi.fn((candidate) => candidate.id === workspaceSource.id ? adapter : {
        ...adapter,
        key: 'nested-empty',
        list: vi.fn(async () => []),
      }),
    });
    app.use('/api/fs', router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server failed to bind');
    try {
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const allowed = await fetch(`${baseUrl}/api/fs/search?q=file&indexState=fallback`);
      expect(allowed.status).toBe(200);
      expect((await allowed.json()).results).toHaveLength(1);
      grants = [{ role: 'viewer', org_id: 'org-a', team_id: 'team-b' }];
      const denied = await fetch(`${baseUrl}/api/fs/search?q=file&indexState=fallback`);
      expect(denied.status).toBe(200);
      expect((await denied.json()).results).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it('does not request unscoped indexed hits for a non-default customer org', async () => {
    const search = vi.fn((_query: string, options: FileIndexSearchFilters = {}) => options.includeUnscoped ? [indexRecord({ org_id: null })] : []);
    const app = express();
    app.use((req, _res, next) => {
      (req as unknown as { entityCustomerPrincipal: unknown }).entityCustomerPrincipal = {
        principalId: 'customer-a', principalType: 'human',
        permission: { principal_id: 'customer-a', grants: [{ role: 'viewer', org_id: 'org-a' }] },
        orgIds: ['org-a'], isGlobalAdmin: false,
      };
      next();
    });
    const router = Router();
    registerSearchRoutes(router, {
      sourceRepo: { listSources: vi.fn(() => [source()]), getSource: vi.fn(() => source()) },
      indexRepo: { search, getLatestSyncRun: vi.fn(() => syncRun()) },
    });
    app.use('/api/fs', router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server failed to bind');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/fs/search?q=renewal&indexState=indexed`);
      expect(response.status).toBe(200);
      expect((await response.json()).results).toEqual([]);
      expect(search).toHaveBeenCalledWith('renewal', expect.objectContaining({ orgId: 'org-a', includeUnscoped: false }));
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
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
