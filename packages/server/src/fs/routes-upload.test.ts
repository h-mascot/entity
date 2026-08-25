import express, { Router } from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileSourceRecord, FileSourceRepository } from '../../../db/src/file-sources';
import type { FileIndexRecord, FileIndexRepository } from '../../../db/src/file-index';
import type { FsFileOwnershipRecord, FsFileOwnershipRepository } from '../../../db/src/file-ownership';
import type { PrincipalGrant } from '../permissions';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true })));
});

async function makeTempRoot(): Promise<string> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'entity-upload-routes-'));
  tempRoots.push(root);
  return root;
}

function source(basePath: string): FileSourceRecord {
  const timestamp = '2026-08-25T00:00:00.000Z';
  return {
    id: 'workspace',
    display_name: 'Workspace',
    type: 'local',
    base_url: null,
    base_path: basePath,
    auth_type: 'none',
    auth_ref: null,
    enabled: true,
    icon: null,
    capabilities: '{}',
    health: 'ok',
    last_synced_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function makeSourceRepo(basePath: string): FileSourceRepository {
  const record = source(basePath);
  return {
    listSources: vi.fn(() => [record]),
    getSource: vi.fn(() => record),
    createSource: vi.fn(() => record),
    updateSource: vi.fn(() => record),
    setEnabled: vi.fn(() => record),
    deleteSource: vi.fn(() => false),
  };
}

function makeOwnershipRepo(): FsFileOwnershipRepository & { rows: Map<string, FsFileOwnershipRecord> } {
  const rows = new Map<string, FsFileOwnershipRecord>();
  const key = (sourceId: string, p: string) => `${sourceId}:${p}`;
  return {
    rows,
    getOwnership: vi.fn((sourceId: string, p: string) => rows.get(key(sourceId, p))),
    upsertOwnership: vi.fn((input: { sourceId: string; path: string; orgId: string; teamId?: string | null; ownerPrincipalId?: string | null; displayName?: string | null }) => {
      const record: FsFileOwnershipRecord = {
        source_id: input.sourceId,
        path: input.path,
        org_id: input.orgId,
        team_id: input.teamId ?? null,
        owner_principal_id: input.ownerPrincipalId ?? null,
        display_name: input.displayName ?? null,
        origin: 'upload',
        uploaded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      rows.set(key(input.sourceId, input.path), record);
      return record;
    }),
    listOwnershipForOrg: vi.fn(() => []),
    listOwnershipForTeams: vi.fn(() => []),
    deleteOwnership: vi.fn(() => false),
  };
}

function makeIndexRepo() {
  const upserted: unknown[] = [];
  const repo = {
    upserted,
    upsertRecord: vi.fn((input: unknown) => {
      upserted.push(input);
      return input as FileIndexRecord;
    }),
  };
  return repo as unknown as Pick<FileIndexRepository, 'upsertRecord'> & { upserted: unknown[] };
}

interface Harness {
  url: (path: string) => string;
  close: () => Promise<void>;
  root: string;
}

async function startHarness(options: {
  grantsHeader?: string;
  principalHeader?: string;
  roleHeader?: string;
  grants?: PrincipalGrant[];
}): Promise<Harness> {
  const root = await makeTempRoot();
  const prevWorkspace = process.env.WORKSPACE;
  const prevRoots = process.env.ENTITY_FS_LOCAL_SOURCE_ROOTS;
  process.env.WORKSPACE = root;
  process.env.ENTITY_FS_LOCAL_SOURCE_ROOTS = root;
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  const router = Router();

  // Header-based principal simulation matching buildLocalCompatPrincipalContext:
  // x-entity-principal-id + x-entity-role + grants injected via headers below.
  app.use((req, _res, next) => {
    if (options.principalHeader) req.headers['x-entity-principal-id'] = options.principalHeader;
    if (options.roleHeader) req.headers['x-entity-role'] = options.roleHeader;
    const principalId = String(req.headers['x-entity-principal-id'] ?? 'upload-test-principal');
    const orgId = String(req.headers['x-entity-org-id'] ?? 'curacel');
    const role = String(req.headers['x-entity-role'] ?? 'manager');
    const grants = options.grants ?? [{ role: role as PrincipalGrant['role'], org_id: orgId, sensitivity_categories: [] }];
    const orgIds = [...new Set(grants.map((grant) => grant.org_id).filter((value): value is string => Boolean(value)))];
    (req as unknown as { entityCustomerPrincipal: unknown }).entityCustomerPrincipal = {
      principalId,
      principalType: 'human',
      permission: {
        principal_id: principalId,
        grants,
      },
      orgIds,
      isGlobalAdmin: grants.some((grant) => grant.role === 'admin' && !grant.org_id && !grant.team_id && !grant.project_id),
    };
    next();
  });

  const { registerUploadRoutes } = await import('./routes-upload');
  registerUploadRoutes(router, {
    sourceRepo: makeSourceRepo(root),
    ownershipRepo: makeOwnershipRepo(),
    indexRepo: makeIndexRepo(),
  });
  app.use('/api/fs', router);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server failed to bind');
  const port = address.port;
  return {
    root,
    url: (p: string) => `http://127.0.0.1:${port}${p}`,
    close: () => new Promise<void>((resolve, reject) =>
      server.close((e) => {
        if (prevWorkspace === undefined) delete process.env.WORKSPACE;
        else process.env.WORKSPACE = prevWorkspace;
        if (prevRoots === undefined) delete process.env.ENTITY_FS_LOCAL_SOURCE_ROOTS;
        else process.env.ENTITY_FS_LOCAL_SOURCE_ROOTS = prevRoots;
        e ? reject(e) : resolve();
      }),
    ),
  };
}

const contribHeaders = {
  'content-type': 'application/json',
  'x-entity-org-id': 'curacel',
  'x-entity-principal-id': 'upload-test-pilot-service',
  'x-entity-role': 'manager',
};

describe('upload routes', () => {
  it('rejects viewers (403) even with a valid source', async () => {
    const h = await startHarness({});
    try {
      const res = await fetch(h.url('/api/fs/upload'), {
        method: 'POST',
        headers: { ...contribHeaders, 'x-entity-role': 'viewer' },
        body: JSON.stringify({
          sourceId: 'workspace',
          file: { name: 'proposal.md', text: '# Proposal\n' },
        }),
      });
      expect(res.status).toBe(403);
      expect(fs.existsSync(path.join(h.root, 'uploads'))).toBe(false);
    } finally {
      await h.close();
    }
  });

  it('uploads a text file with team scoping default from grants and records ownership', async () => {
    const h = await startHarness({});
    try {
      const res = await fetch(h.url('/api/fs/upload'), {
        method: 'POST',
        headers: contribHeaders,
        body: JSON.stringify({
          sourceId: 'workspace',
          file: { name: 'acme-proposal.md', text: '# Acme proposal\n\n pricing table' },
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { path: string; teamId: string | null };
      expect(body.path).toBe('uploads/curacel/acme-proposal.md');
      expect(fs.existsSync(path.join(h.root, body.path))).toBe(true);
    } finally {
      await h.close();
    }
  });


  it('defaults to the first team grant even when the caller also has an org-wide grant', async () => {
    const h = await startHarness({
      grants: [
        { role: 'manager', org_id: 'curacel', team_id: null, sensitivity_categories: [] },
        { role: 'contributor', org_id: 'curacel', team_id: 'pilot', sensitivity_categories: [] },
      ],
    });
    try {
      const res = await fetch(h.url('/api/fs/upload'), {
        method: 'POST',
        headers: contribHeaders,
        body: JSON.stringify({
          sourceId: 'workspace',
          file: { name: 'team-default.md', text: 'team scoped' },
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { path: string; teamId: string | null };
      expect(body.teamId).toBe('pilot');
      expect(body.path).toBe('uploads/curacel/pilot/team-default.md');
    } finally {
      await h.close();
    }
  });

  it('rejects an explicit team outside the caller grants', async () => {
    const h = await startHarness({
      grants: [{ role: 'contributor', org_id: 'curacel', team_id: 'pilot', sensitivity_categories: [] }],
    });
    try {
      const res = await fetch(h.url('/api/fs/upload'), {
        method: 'POST',
        headers: contribHeaders,
        body: JSON.stringify({
          sourceId: 'workspace',
          teamId: 'growth',
          file: { name: 'growth.md', text: 'not for growth' },
        }),
      });
      expect(res.status).toBe(403);
      expect(fs.existsSync(path.join(h.root, 'uploads'))).toBe(false);
    } finally {
      await h.close();
    }
  });


  it('rejects a request org outside the authenticated principal grants', async () => {
    const h = await startHarness({
      grants: [{ role: 'contributor', org_id: 'curacel', team_id: 'pilot', sensitivity_categories: [] }],
    });
    try {
      const res = await fetch(h.url('/api/fs/upload'), {
        method: 'POST',
        headers: { ...contribHeaders, 'x-entity-org-id': 'other-org' },
        body: JSON.stringify({
          sourceId: 'workspace',
          file: { name: 'cross-org.md', text: 'must not cross org boundary' },
        }),
      });
      expect(res.status).toBe(403);
      expect(fs.existsSync(path.join(h.root, 'uploads'))).toBe(false);
    } finally {
      await h.close();
    }
  });

  it('round-trips binary content byte-exact via base64', async () => {
    const h = await startHarness({});
    try {
      const bytes = Buffer.from([0x00, 0x01, 0xfe, 0xff, 0x0a, 0x89, 0xab, 0xcd]);
      const res = await fetch(h.url('/api/fs/upload'), {
        method: 'POST',
        headers: contribHeaders,
        body: JSON.stringify({
          sourceId: 'workspace',
          file: { name: 'scan.png', mimeType: 'image/png', contentBase64: bytes.toString('base64') },
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { path: string };
      const written = await fs.promises.readFile(path.join(h.root, body.path));
      expect(Buffer.compare(written, bytes)).toBe(0);
    } finally {
      await h.close();
    }
  });

  it('rejects duplicate uploads with 409', async () => {
    const h = await startHarness({});
    try {
      const payload = JSON.stringify({
        sourceId: 'workspace',
        file: { name: 'same.md', text: 'v1' },
      });
      const first = await fetch(h.url('/api/fs/upload'), { method: 'POST', headers: contribHeaders, body: payload });
      expect(first.status).toBe(201);
      const second = await fetch(h.url('/api/fs/upload'), { method: 'POST', headers: contribHeaders, body: payload });
      expect(second.status).toBe(409);
    } finally {
      await h.close();
    }
  });

  it('sanitizes dangerous filenames', async () => {
    const h = await startHarness({});
    try {
      const res = await fetch(h.url('/api/fs/upload'), {
        method: 'POST',
        headers: contribHeaders,
        body: JSON.stringify({
          sourceId: 'workspace',
          file: { name: '../../etc/passwd', text: 'nope' },
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { path: string };
      expect(body.path).toMatch(/\/passwd$/);
      expect(body.path).not.toContain('..');
    } finally {
      await h.close();
    }
  });


  it('rejects a custom path outside the request org/team scope', async () => {
    const h = await startHarness({
      grants: [{ role: 'contributor', org_id: 'curacel', team_id: 'pilot', sensitivity_categories: [] }],
    });
    try {
      const res = await fetch(h.url('/api/fs/upload'), {
        method: 'POST',
        headers: contribHeaders,
        body: JSON.stringify({
          sourceId: 'workspace',
          path: 'uploads/other-org/pilot/escape.md',
          file: { name: 'escape.md', text: 'must not cross org boundary' },
        }),
      });
      expect(res.status).toBe(403);
      expect(fs.existsSync(path.join(h.root, 'uploads', 'other-org'))).toBe(false);
    } finally {
      await h.close();
    }
  });

  it('rejects malformed base64 instead of accepting Buffer.from partial decoding', async () => {
    const h = await startHarness({});
    try {
      const res = await fetch(h.url('/api/fs/upload'), {
        method: 'POST',
        headers: contribHeaders,
        body: JSON.stringify({
          sourceId: 'workspace',
          file: { name: 'invalid.bin', contentBase64: 'not-base64!' },
        }),
      });
      expect(res.status).toBe(400);
    } finally {
      await h.close();
    }
  });

  it('rejects uploads over the size cap', async () => {
    const h = await startHarness({});
    try {
      const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0x61);
      const res = await fetch(h.url('/api/fs/upload'), {
        method: 'POST',
        headers: contribHeaders,
        body: JSON.stringify({
          sourceId: 'workspace',
          file: { name: 'big.txt', text: big.toString('utf-8') },
        }),
      });
      expect(res.status).toBe(413);
    } finally {
      await h.close();
    }
  });

  it('requires sourceId and file', async () => {
    const h = await startHarness({});
    try {
      const res = await fetch(h.url('/api/fs/upload'), {
        method: 'POST',
        headers: contribHeaders,
        body: JSON.stringify({ sourceId: 'workspace' }),
      });
      expect(res.status).toBe(400);
    } finally {
      await h.close();
    }
  });
});
