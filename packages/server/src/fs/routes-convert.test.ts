import { acquireFileMutationGuard } from './mutation-guard';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFileSourceRepository } from '../../../db/src/file-sources';
import type { FileSourceRecord } from '../../../db/src/file-sources';
import type { FsFileOwnershipRecord } from '../../../db/src/file-ownership';
import type { FileSourceAdapter } from './adapters/types';
import { registerDocumentConvertRoutes } from './routes-convert';

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'entity-convert-route-'));
  tempRoots.push(root);
  return root;
}

async function requestApp(app: express.Express, body: Record<string, unknown>) {
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const res = await fetch(`http://127.0.0.1:${port}/documents/convert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  server.close();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

describe('document convert routes', () => {
  let root = '';
  let sourceRepo = createFileSourceRepository();
  let sourceId = '';

  beforeEach(async () => {
    root = await makeTempRoot();
    sourceId = `convert-source-${Date.now()}`;
    vi.stubEnv('ENTITY_FS_LOCAL_SOURCE_ROOTS', root);
    sourceRepo = createFileSourceRepository();
    sourceRepo.createSource({
      id: sourceId,
      display_name: 'Convert Source',
      type: 'local',
      base_path: root,
      enabled: true,
    });
    await fs.promises.writeFile(path.join(root, 'source.md'), '# Source doc\n\nConvert me into a PRD.', 'utf-8');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(tempRoots.splice(0).map((entry) => fs.promises.rm(entry, { recursive: true, force: true })));
  });

  it('dry-run previews conversion without writing', async () => {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerDocumentConvertRoutes(router, { sourceRepo });
    app.use(router);

    const result = await requestApp(app, {
      sourceId,
      path: 'source.md',
      targetType: 'prd',
      targetName: 'Converted PRD',
      dryRun: true,
    });

    expect(result.status).toBe(200);
    expect(result.body.dryRun).toBe(true);
    expect(result.body.preview).toContain('# Converted PRD');
    await expect(fs.promises.readdir(path.join(root, 'converted'))).rejects.toThrow();
    await expect(fs.promises.readFile(path.join(root, 'source.md'), 'utf-8')).resolves.toContain('Convert me into a PRD.');
  });

  it('rejects conversion during a move and succeeds after the move releases', async () => {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerDocumentConvertRoutes(router, { sourceRepo });
    app.use(router);
    const body = { sourceId, path: 'source.md', targetType: 'blog', targetName: 'After Move' };
    const release = acquireFileMutationGuard('move');
    try {
      const result = await requestApp(app, body);
      expect(result.status).toBe(409);
      expect(result.body.error).toContain('Retry the request');
    } finally {
      release();
    }
    const result = await requestApp(app, body);
    expect(result.status).toBe(201);
    await expect(fs.promises.readFile(path.join(root, result.body.targetPath), 'utf8')).resolves.toContain('entity_source_path: source.md');
  });

  it('creates a converted document while preserving the source file', async () => {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerDocumentConvertRoutes(router, { sourceRepo });
    app.use(router);

    const result = await requestApp(app, {
      sourceId,
      path: 'source.md',
      targetType: 'blog',
      targetName: 'Converted Blog',
    });

    expect(result.status).toBe(201);
    expect(result.body.targetType).toBe('blog');
    const converted = await fs.promises.readFile(path.join(root, result.body.targetPath), 'utf-8');
    expect(converted).toContain('entity_source_path: source.md');
    expect(converted).toContain('## Hook');
    await expect(fs.promises.readFile(path.join(root, 'source.md'), 'utf-8')).resolves.toContain('Convert me into a PRD.');
  });

  it('rejects existing converted targets without overwriting', async () => {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerDocumentConvertRoutes(router, { sourceRepo });
    app.use(router);

    await requestApp(app, {
      sourceId,
      path: 'source.md',
      targetType: 'prd',
      targetName: 'Collision Test',
    });

    const second = await requestApp(app, {
      sourceId,
      path: 'source.md',
      targetType: 'prd',
      targetName: 'Collision Test',
    });

    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/already exists/i);
  });

  it('denies a viewer before reading or writing a conversion target', async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.entityCustomerPrincipal = {
        principalId: 'viewer-a', principalType: 'human', orgIds: ['org-a'], isGlobalAdmin: false,
        permission: { principal_id: 'viewer-a', grants: [{ role: 'viewer', org_id: 'org-a', team_id: 'team-a' }] },
      };
      next();
    });
    app.use(express.json());
    const router = express.Router();
    registerDocumentConvertRoutes(router, {
      sourceRepo,
      ownershipRepo: {
        getOwnership: vi.fn(() => undefined),
        reservePendingOwnership: vi.fn(),
        deletePendingOwnership: vi.fn(),
        upsertOwnership: vi.fn(),
      },
    });
    app.use(router);

    const result = await requestApp(app, {
      sourceId,
      path: 'source.md',
      targetType: 'prd',
      targetName: 'Viewer Must Not Convert',
    });

    expect(result.status).toBe(403);
    await expect(fs.promises.readdir(path.join(root, 'converted'))).rejects.toThrow();
  });

  it('rejects read-only sources clearly', async () => {
    const blockedRoot = await makeTempRoot();
    const blockedRepo = createFileSourceRepository();
    const blockedId = `blocked-${Date.now()}`;
    blockedRepo.createSource({
      id: blockedId,
      display_name: 'Blocked',
      type: 'local',
      base_path: blockedRoot,
      enabled: true,
    });

    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerDocumentConvertRoutes(router, { sourceRepo: blockedRepo });
    app.use(router);

    const result = await requestApp(app, {
      sourceId: blockedId,
      path: 'source.md',
      targetType: 'prd',
    });

    expect(result.status).toBe(403);
    expect(result.body.error).toMatch(/read-only/i);
  });

  it('preserves an overlapping owner scope when converting an aliased upload', async () => {
    const overlapRoot = await makeTempRoot();
    const nested = path.join(overlapRoot, 'nested');
    await fs.promises.mkdir(path.join(nested, 'uploads/org-a/team-a'), { recursive: true });
    const sourcePath = 'nested/uploads/org-a/team-a/source.md';
    const sourceA: FileSourceRecord = {
      ...sourceRepo.getSource(sourceId)!, id: 'source-a', base_path: overlapRoot,
    };
    const sourceB: FileSourceRecord = {
      ...sourceA, id: 'source-b', base_path: nested,
    };
    const sources = [sourceA, sourceB];
    const sourceRow: FsFileOwnershipRecord = {
      source_id: sourceB.id, path: 'uploads/org-a/team-a/source.md', org_id: 'org-a', team_id: 'team-a', owner_principal_id: 'owner-a', display_name: 'source.md', origin: 'upload', uploaded_at: '2026-09-07T00:00:00.000Z', updated_at: '2026-09-07T00:00:00.000Z',
    };
    const reservedTarget: FsFileOwnershipRecord = {
      ...sourceRow, source_id: sourceA.id, path: 'nested/uploads/org-a/team-a/converted/converted.blog.md', display_name: 'Converted', origin: 'manual',
    };
    const ownershipRepo = {
      getOwnership: vi.fn((candidateSourceId: string, candidatePath: string) => candidateSourceId === sourceRow.source_id && candidatePath === sourceRow.path ? sourceRow : undefined),
      reservePendingOwnership: vi.fn(),
      deletePendingOwnership: vi.fn(),
      upsertOwnership: vi.fn(),
    };
    const adapter: FileSourceAdapter = {
      key: 'overlap', validate: vi.fn(async () => undefined),
      capabilities: () => ({ read: true, write: true, rename: false, delete: false, list: true, search: true }),
      read: vi.fn(async (candidatePath) => candidatePath === sourcePath
        ? { content: '# Source\nConvert me.', contentType: 'text/markdown', size: 20, isBinary: false }
        : (() => { throw new Error('ENOENT: no such file or directory'); })()),
      list: vi.fn(async () => []),
      write: vi.fn(async () => ({})),
      writeExclusive: vi.fn(async () => ({})),
      mkdir: vi.fn(async () => undefined),
    };
    const app = express();
    app.use((req, _res, next) => {
      req.headers['x-entity-org-id'] = 'org-a';
      (req as unknown as { entityCustomerPrincipal: unknown }).entityCustomerPrincipal = {
        principalId: 'owner-a', principalType: 'human',
        permission: { principal_id: 'owner-a', grants: [{ role: 'contributor', org_id: 'org-a', team_id: 'team-a' }] }, orgIds: ['org-a'], isGlobalAdmin: false,
      };
      next();
    });
    app.use(express.json());
    const router = express.Router();
    registerDocumentConvertRoutes(router, {
      sourceRepo: {
        listSources: vi.fn(() => sources), getSource: vi.fn((id: string) => sources.find((entry) => entry.id === id)),
        createSource: vi.fn(() => sourceA), updateSource: vi.fn(() => sourceA), setEnabled: vi.fn(() => sourceA), deleteSource: vi.fn(() => false),
      },
      ownershipRepo,
      createAdapter: vi.fn(() => adapter),
    });
    app.use(router);
    const result = await requestApp(app, { sourceId: sourceA.id, path: sourcePath, targetType: 'blog', targetName: 'Converted' });
    expect(result.status).toBe(201);
    expect(ownershipRepo.reservePendingOwnership).toHaveBeenCalledWith(expect.objectContaining({ orgId: sourceRow.org_id, teamId: sourceRow.team_id }));
    expect(ownershipRepo.upsertOwnership).toHaveBeenCalledWith(expect.objectContaining({ orgId: sourceRow.org_id, teamId: sourceRow.team_id }));
    expect(reservedTarget).toBeDefined();
  });

  it('clears only its pending reservation when exclusive conversion loses a verified create race', async () => {
    const pendingReservation: FsFileOwnershipRecord = {
      source_id: sourceId,
      path: 'uploads/org-a/team-a/converted/race.blog.md',
      org_id: 'org-a',
      team_id: 'team-a',
      owner_principal_id: 'owner-a',
      display_name: 'Race',
      origin: 'pending',
      uploaded_at: '2026-09-07T00:00:00.000Z',
      updated_at: '2026-09-07T00:00:00.000Z',
    };
    const ownershipRepo = {
      getOwnership: vi.fn((candidateSourceId: string, candidatePath: string) => (
        candidatePath === 'uploads/org-a/team-a/source.md'
          ? {
              ...pendingReservation,
              source_id: candidateSourceId,
              path: candidatePath,
              origin: 'upload' as const,
              display_name: 'source.md',
            }
          : undefined
      )),
      reservePendingOwnership: vi.fn(() => pendingReservation),
      deletePendingOwnership: vi.fn(() => true),
      upsertOwnership: vi.fn(),
    };
    const adapter: FileSourceAdapter = {
      key: 'convert-conflict',
      validate: vi.fn(async () => undefined),
      capabilities: () => ({ read: true, write: true, rename: false, delete: false, list: true, search: true }),
      read: vi.fn(async (candidatePath) => candidatePath.endsWith('/source.md')
        ? { content: '# Source\nConvert me.', contentType: 'text/markdown', size: 20, isBinary: false }
        : (() => { throw new Error('ENOENT: no such file or directory'); })()),
      list: vi.fn(async () => []),
      write: vi.fn(async () => ({})),
      writeExclusive: vi.fn(async () => {
        const error = Object.assign(new Error('Converted document already exists.'), { code: 'EEXIST' });
        throw error;
      }),
      mkdir: vi.fn(async () => undefined),
    };
    const app = express();
    app.use((req, _res, next) => {
      req.headers['x-entity-org-id'] = 'org-a';
      (req as unknown as { entityCustomerPrincipal: unknown }).entityCustomerPrincipal = {
        principalId: 'owner-a', principalType: 'human',
        permission: { principal_id: 'owner-a', grants: [{ role: 'contributor', org_id: 'org-a', team_id: 'team-a' }] },
        orgIds: ['org-a'], isGlobalAdmin: false,
      };
      next();
    });
    app.use(express.json());
    const router = express.Router();
    registerDocumentConvertRoutes(router, { sourceRepo, ownershipRepo, createAdapter: () => adapter });
    app.use(router);

    const result = await requestApp(app, {
      sourceId,
      path: 'uploads/org-a/team-a/source.md',
      targetType: 'blog',
      targetName: 'Race',
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/already exists/i);
    expect(ownershipRepo.deletePendingOwnership).toHaveBeenCalledWith(pendingReservation);
    expect(ownershipRepo.upsertOwnership).not.toHaveBeenCalled();
  });

  it('retains its pending reservation after an ambiguous conversion write failure', async () => {
    const pendingReservation: FsFileOwnershipRecord = {
      source_id: sourceId,
      path: 'uploads/org-a/team-a/converted/uncertain.blog.md',
      org_id: 'org-a',
      team_id: 'team-a',
      owner_principal_id: 'owner-a',
      display_name: 'Uncertain',
      origin: 'pending',
      uploaded_at: '2026-09-07T00:00:00.000Z',
      updated_at: '2026-09-07T00:00:00.000Z',
    };
    const ownershipRepo = {
      getOwnership: vi.fn((candidateSourceId: string, candidatePath: string) => (
        candidatePath === 'uploads/org-a/team-a/source.md'
          ? { ...pendingReservation, source_id: candidateSourceId, path: candidatePath, origin: 'upload' as const }
          : undefined
      )),
      reservePendingOwnership: vi.fn(() => pendingReservation),
      deletePendingOwnership: vi.fn(() => true),
      upsertOwnership: vi.fn(),
    };
    const adapter: FileSourceAdapter = {
      key: 'convert-uncertain',
      validate: vi.fn(async () => undefined),
      capabilities: () => ({ read: true, write: true, rename: false, delete: false, list: true, search: true }),
      read: vi.fn(async (candidatePath) => candidatePath.endsWith('/source.md')
        ? { content: '# Source\nConvert me.', contentType: 'text/markdown', size: 20, isBinary: false }
        : (() => { throw new Error('ENOENT: no such file or directory'); })()),
      list: vi.fn(async () => []),
      write: vi.fn(async () => ({})),
      writeExclusive: vi.fn(async () => { throw new Error('managed storage broker input failed'); }),
      mkdir: vi.fn(async () => undefined),
    };
    const app = express();
    app.use((req, _res, next) => {
      req.headers['x-entity-org-id'] = 'org-a';
      (req as unknown as { entityCustomerPrincipal: unknown }).entityCustomerPrincipal = {
        principalId: 'owner-a', principalType: 'human',
        permission: { principal_id: 'owner-a', grants: [{ role: 'contributor', org_id: 'org-a', team_id: 'team-a' }] },
        orgIds: ['org-a'], isGlobalAdmin: false,
      };
      next();
    });
    app.use(express.json());
    const router = express.Router();
    registerDocumentConvertRoutes(router, { sourceRepo, ownershipRepo, createAdapter: () => adapter });
    app.use(router);

    const result = await requestApp(app, {
      sourceId,
      path: 'uploads/org-a/team-a/source.md',
      targetType: 'blog',
      targetName: 'Uncertain',
    });

    expect(result.status).toBe(500);
    expect(ownershipRepo.deletePendingOwnership).not.toHaveBeenCalled();
    expect(ownershipRepo.upsertOwnership).not.toHaveBeenCalled();
    // A failed broker write retains ownership but must release request admission.
    acquireFileMutationGuard('move')();
  });
});
