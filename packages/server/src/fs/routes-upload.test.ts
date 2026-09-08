import { acquireFileMutationGuard } from './mutation-guard';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express, { Router } from 'express';
import http from 'http';
import { describe, expect, it, vi } from 'vitest';
import type { FileSourceRecord, FileSourceRepository } from '../../../db/src/file-sources';
import type { FsFileOwnershipRecord, FsFileOwnershipRepository } from '../../../db/src/file-ownership';
import type { FileSourceAdapter } from './adapters/types';
import type { PrincipalGrant } from '../permissions';
import { MAX_UPLOAD_BYTES, registerUploadRoutes, resolveUploadTeamId, sanitizeUploadFilename } from './routes-upload';

const source: FileSourceRecord = {
  id: 'workspace', display_name: 'Workspace', type: 'local', base_url: null, base_path: '/workspace',
  auth_type: 'none', auth_ref: null, enabled: true, icon: null, capabilities: '{}', health: 'ok',
  last_synced_at: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
};

function sourceRepo(sources: FileSourceRecord[] = [source]): FileSourceRepository {
  return {
    listSources: vi.fn(() => sources), getSource: vi.fn((id) => sources.find((candidate) => candidate.id === id) ?? sources[0] ?? source), createSource: vi.fn(() => sources[0] ?? source),
    updateSource: vi.fn(() => sources[0] ?? source), setEnabled: vi.fn(() => sources[0] ?? source), deleteSource: vi.fn(() => false),
  };
}

function ownershipRepo(seed: FsFileOwnershipRecord[] = []): FsFileOwnershipRepository {
  const rows = new Map<string, FsFileOwnershipRecord>();
  for (const row of seed) rows.set(`${row.source_id}:${row.path}`, row);
  return {
    getOwnership: vi.fn((sourceId, path) => rows.get(`${sourceId}:${path}`)),
    reservePendingOwnership: vi.fn((input) => {
      const now = new Date().toISOString();
      const row: FsFileOwnershipRecord = { source_id: input.sourceId, path: input.path, org_id: input.orgId, team_id: input.teamId ?? null, owner_principal_id: input.ownerPrincipalId ?? null, display_name: input.displayName ?? null, origin: 'pending', uploaded_at: now, updated_at: now };
      rows.set(`${input.sourceId}:${input.path}`, row);
      return row;
    }),
    upsertOwnership: vi.fn((input) => {
      const now = new Date().toISOString();
      const row: FsFileOwnershipRecord = { source_id: input.sourceId, path: input.path, org_id: input.orgId, team_id: input.teamId ?? null, owner_principal_id: input.ownerPrincipalId ?? null, display_name: input.displayName ?? null, origin: 'upload', uploaded_at: now, updated_at: now };
      rows.set(`${input.sourceId}:${input.path}`, row);
      return row;
    }),
    listOwnershipForOrg: vi.fn((orgId) => [...rows.values()].filter((row) => row.org_id === orgId)),
    listOwnershipForTeams: vi.fn((orgId, teamIds) => [...rows.values()].filter((row) => row.org_id === orgId && row.team_id !== null && teamIds.includes(row.team_id))),
    deleteOwnership: vi.fn(() => false),
    deletePendingOwnership: vi.fn((reservation) => {
      const key = `${reservation.source_id}:${reservation.path}`;
      const row = rows.get(key);
      if (!row || row.origin !== 'pending' || row.owner_principal_id !== reservation.owner_principal_id || row.uploaded_at !== reservation.uploaded_at || row.updated_at !== reservation.updated_at) return false;
      rows.delete(key);
      return true;
    }),
  };
}

function teamRepo() {
  const teams = new Map([
    ['team-a', { id: 'team-a', org_id: 'org-a', name: 'Team A', slug: 'team-a', status: 'active', created_at: '', updated_at: '' }],
    ['team-b', { id: 'team-b', org_id: 'org-a', name: 'Team B', slug: 'team-b', status: 'active', created_at: '', updated_at: '' }],
    ['team-inactive', { id: 'team-inactive', org_id: 'org-a', name: 'Inactive', slug: 'team-inactive', status: 'disabled', created_at: '', updated_at: '' }],
    ['team-foreign', { id: 'team-foreign', org_id: 'org-b', name: 'Foreign', slug: 'team-foreign', status: 'active', created_at: '', updated_at: '' }],
  ]);
  return {
    getTeam: vi.fn(({ orgId }: { orgId: string }, teamId: string) => {
      const team = teams.get(teamId);
      return team && team.org_id === orgId ? team : undefined;
    }),
  };
}

async function requestUpload(body: unknown, role = 'contributor', grants: PrincipalGrant[] = [{ role: 'contributor', org_id: 'org-a', team_id: 'team-a' }], writerMode?: 'binary-only' | 'text-only', requestOrg: string | null = 'org-a', customerOrgIds = ['org-a'], writerFailure?: 'conflict' | 'ambiguous', workspace = teamRepo(), sourceRecords: FileSourceRecord[] = [source], ownershipSeed: FsFileOwnershipRecord[] = [], onParentInspection?: (ownership: FsFileOwnershipRepository) => void) {
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  const router = Router();
  const ownership = ownershipRepo(ownershipSeed);
  let parentInspectionNotified = false;
  const adapter: FileSourceAdapter = {
    key: 'test', validate: vi.fn(async () => undefined), capabilities: () => ({ read: true, write: true, rename: false, delete: false, list: true, search: true }),
    stat: vi.fn(async (path) => {
      if (!parentInspectionNotified) {
        parentInspectionNotified = true;
        onParentInspection?.(ownership);
      }
      return { sourceId: 'workspace', path, name: path.split('/').pop() ?? path, kind: 'directory' as const };
    }),
    list: vi.fn(async () => []), read: vi.fn(async () => { throw new Error('ENOENT: no such file or directory'); }),
    write: vi.fn(async () => ({})), writeExclusive: vi.fn(async () => {
      if (writerFailure === 'conflict') throw new Error('Converted document already exists.');
      if (writerFailure === 'ambiguous') throw new Error('broker write failed after uncertain completion');
      return {};
    }),
    writeRaw: vi.fn(async () => ({})), writeRawExclusive: vi.fn(async () => ({})), mkdir: vi.fn(async () => undefined),
  };
  if (writerMode === 'binary-only') adapter.writeExclusive = undefined;
  if (writerMode === 'text-only') adapter.writeRawExclusive = undefined;
  registerUploadRoutes(router, {
    sourceRepo: sourceRepo(sourceRecords), ownershipRepo: ownership,
    indexRepo: { upsertRecord: vi.fn(() => ({}) as never) }, createAdapter: () => adapter, teamRepo: workspace,
  });
  app.use('/api/fs', (req, _res, next) => {
    if (requestOrg) req.headers['x-entity-org-id'] = requestOrg;
    req.headers['x-entity-principal-id'] = 'principal-a';
    req.headers['x-entity-role'] = role;
    // The route uses the normal local compatibility principal, so give it a
    // role-grant through the customer context used by request-permissions.
    (req as unknown as { entityCustomerPrincipal: unknown }).entityCustomerPrincipal = {
      principalId: 'principal-a', principalType: 'human', permission: { principal_id: 'principal-a', grants }, orgIds: customerOrgIds, isGlobalAdmin: false,
    };
    next();
  }, router);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server failed to bind');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/fs/upload`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { response, adapter, ownership };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function aliasOwnership(sourceId: string, path: string, orgId = 'org-a', ownerPrincipalId = 'other-principal', origin: FsFileOwnershipRecord['origin'] = 'upload'): FsFileOwnershipRecord {
  return {
    source_id: sourceId, path, org_id: orgId, team_id: 'team-a', owner_principal_id: ownerPrincipalId,
    display_name: 'existing.txt', origin, uploaded_at: '2026-09-08T00:00:00.000Z', updated_at: '2026-09-08T00:00:00.000Z',
  };
}

async function requestUploads(grants: PrincipalGrant[]) {
  const app = express();
  const record: FsFileOwnershipRecord = {
    source_id: 'workspace', path: 'uploads/org-a/team-a/visible.txt', org_id: 'org-a', team_id: 'team-a',
    owner_principal_id: 'owner-a', display_name: 'visible.txt', origin: 'upload',
    uploaded_at: '2026-09-07T00:00:00.000Z', updated_at: '2026-09-07T00:00:00.000Z',
  };
  const ownership = ownershipRepo([record]);
  const router = Router();
  registerUploadRoutes(router, {
    sourceRepo: sourceRepo(), ownershipRepo: ownership,
    indexRepo: { upsertRecord: vi.fn(() => ({}) as never) },
    teamRepo: teamRepo(),
  });
  app.use('/api/fs', (req, _res, next) => {
    req.headers['x-entity-org-id'] = 'org-a';
    (req as unknown as { entityCustomerPrincipal: unknown }).entityCustomerPrincipal = {
      principalId: 'viewer-a', principalType: 'human', permission: { principal_id: 'viewer-a', grants },
      orgIds: ['org-a'], isGlobalAdmin: false,
    };
    next();
  }, router);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server failed to bind');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/fs/uploads`);
    return { response, ownership };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe('upload route security', () => {
  it('leaves teamId unset for an organization-wide contributor grant', () => {
    const binding = {
      orgId: 'org-a',
      principal: { principal_id: 'principal-a', grants: [
        { role: 'contributor' as const, org_id: 'org-a' },
        { role: 'contributor' as const, org_id: 'org-a', team_id: 'team-a' },
        { role: 'contributor' as const, org_id: 'org-a', team_id: 'team-b' },
      ] },
    };
    expect(resolveUploadTeamId(binding, null)).toEqual({ teamId: null });
    expect(resolveUploadTeamId({
      orgId: 'org-a',
      principal: { principal_id: 'principal-a', grants: [
        { role: 'contributor' as const, org_id: 'org-a' },
        { role: 'contributor' as const, org_id: 'org-a', team_id: 'team-a' },
      ] },
    }, null)).toEqual({ teamId: null });
  });

  it('distinguishes explicit organization-wide intent from omitted teamId inference', () => {
    const teamOnly = {
      orgId: 'org-a',
      principal: { principal_id: 'principal-a', grants: [
        { role: 'contributor' as const, org_id: 'org-a', team_id: 'team-a' },
      ] },
    };
    expect(resolveUploadTeamId(teamOnly, undefined)).toEqual({ teamId: 'team-a' });
    expect(resolveUploadTeamId(teamOnly, null)).toMatchObject({ reason: expect.stringContaining('organization-wide') });
  });

  it('accepts explicit team selection for an organization-wide contributor or global admin', async () => {
    const orgWideUpload = await requestUpload(
      { sourceId: 'workspace', teamId: null, file: { name: 'org-wide.txt', text: 'x' } },
      'contributor',
      [{ role: 'contributor', org_id: 'org-a' }],
    );
    expect(orgWideUpload.response.status).toBe(201);
    expect(await orgWideUpload.response.json()).toMatchObject({ teamId: null, path: 'uploads/org-a/org-wide.txt' });

    const orgWide = await requestUpload(
      { sourceId: 'workspace', teamId: 'team-b', file: { name: 'team-b.txt', text: 'x' } },
      'contributor',
      [{ role: 'contributor', org_id: 'org-a' }],
    );
    expect(orgWide.response.status).toBe(201);
    expect(await orgWide.response.json()).toMatchObject({ teamId: 'team-b', path: 'uploads/org-a/team-b/team-b.txt' });

    const globalAdmin = await requestUpload(
      { sourceId: 'workspace', teamId: 'team-a', file: { name: 'admin.txt', text: 'x' } },
      'admin',
      [{ role: 'admin' }],
    );
    expect(globalAdmin.response.status).toBe(201);

    const invalidGlobalAdminTeam = await requestUpload(
      { sourceId: 'workspace', teamId: 'missing-team', file: { name: 'admin-missing.txt', text: 'x' } },
      'admin',
      [{ role: 'admin' }],
    );
    expect(invalidGlobalAdminTeam.response.status).toBe(403);
  });

  it('accepts an active team ID with spaces while preserving raw ownership metadata', async () => {
    const salesTeamRepo = {
      getTeam: vi.fn(({ orgId }: { orgId: string }, teamId: string) => teamId === 'Sales Team' && orgId === 'org-a'
        ? { id: 'Sales Team', org_id: 'org-a', name: 'Sales Team', slug: 'sales-team', status: 'active', created_at: '', updated_at: '' }
        : undefined),
    };
    const result = await requestUpload(
      { sourceId: 'workspace', teamId: 'Sales Team', file: { name: 'sales.txt', text: 'x' } },
      'contributor',
      [{ role: 'contributor', org_id: 'org-a', team_id: 'Sales Team' }],
      undefined,
      'org-a',
      ['org-a'],
      undefined,
      salesTeamRepo,
    );
    expect(result.response.status).toBe(201);
    const body = await result.response.json() as { path: string; teamId: string };
    expect(body.teamId).toBe('Sales Team');
    expect(body.path).toMatch(/^uploads\/org-a\/~[0-9a-f]{64}\/sales\.txt$/);
    expect(result.ownership.upsertOwnership).toHaveBeenCalledWith(expect.objectContaining({ path: body.path, orgId: 'org-a', teamId: 'Sales Team' }));
  });

  it('encodes a spaced organization ID without changing raw ownership metadata', async () => {
    const result = await requestUpload(
      { sourceId: 'workspace', teamId: null, file: { name: 'spaced-org.txt', text: 'x' } },
      'contributor',
      [{ role: 'contributor', org_id: 'Sales Org' }],
      undefined,
      'Sales Org',
      ['Sales Org'],
    );
    expect(result.response.status).toBe(201);
    const body = await result.response.json() as { path: string; orgId: string };
    expect(body.orgId).toBe('Sales Org');
    expect(body.path).toMatch(/^uploads\/~[0-9a-f]{64}\/spaced-org\.txt$/);
    expect(result.ownership.upsertOwnership).toHaveBeenCalledWith(expect.objectContaining({ path: body.path, orgId: 'Sales Org', teamId: null }));
  });

  it('rejects explicit organization-wide intent for a team-only contributor', async () => {
    const result = await requestUpload(
      { sourceId: 'workspace', teamId: null, file: { name: 'org.txt', text: 'x' } },
      'contributor',
      [{ role: 'contributor', org_id: 'org-a', team_id: 'team-a' }],
    );
    expect(result.response.status).toBe(403);
  });

  it.each(['missing-team', 'team-inactive', 'team-foreign'] as const)('rejects selected %s even for org-wide authority', async (teamId) => {
    const result = await requestUpload(
      { sourceId: 'workspace', teamId, file: { name: `${teamId}.txt`, text: 'x' } },
      'contributor',
      [{ role: 'contributor', org_id: 'org-a' }],
    );
    expect(result.response.status).toBe(403);
  });

  it('sanitizes path-bearing names without retaining traversal segments', () => {
    expect(sanitizeUploadFilename('../../secret.txt')).toBe('secret.txt');
    expect(sanitizeUploadFilename('..')).toBeNull();
  });

  it('requires contributor and rejects an out-of-team custom path', async () => {
    const denied = await requestUpload({ sourceId: 'workspace', file: { name: 'a.txt', text: 'a' } }, 'viewer', [{ role: 'viewer', org_id: 'org-a', team_id: 'team-a' }]);
    expect(denied.response.status).toBe(403);
    const escaped = await requestUpload({ sourceId: 'workspace', path: 'uploads/org-a/team-b/a.txt', file: { name: 'a.txt', text: 'a' } });
    expect(escaped.response.status).toBe(403);
  });

  it.each(['foreign owner', 'same owner', 'pending'] as const)('rejects a %s ownership conflict through a same-root alias before adapter parents', async (kind) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'entity-upload-alias-'));
    try {
      const target = 'uploads/org-a/team-a/alias-conflict.txt';
      const sourceRecords = [
        { ...source, base_path: root },
        { ...source, id: 'alias', display_name: 'Alias', base_path: root },
      ];
      const result = await requestUpload(
        { sourceId: 'workspace', file: { name: 'alias-conflict.txt', text: 'x' } },
        'contributor',
        [{ role: 'contributor', org_id: 'org-a', team_id: 'team-a' }],
        undefined,
        'org-a',
        ['org-a'],
        undefined,
        teamRepo(),
        sourceRecords,
        [aliasOwnership('alias', target, kind === 'foreign owner' ? 'org-b' : 'org-a', kind === 'same owner' ? 'principal-a' : 'other-principal', kind === 'pending' ? 'pending' : 'upload')],
      );
      expect(result.response.status).toBe(409);
      expect(result.adapter.stat).not.toHaveBeenCalled();
      expect(result.adapter.writeExclusive).not.toHaveBeenCalled();
      expect(result.ownership.reservePendingOwnership).not.toHaveBeenCalled();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('rejects an ownership conflict through a nested physical alias before adapter parents', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'entity-upload-nested-alias-'));
    const nested = path.join(root, 'uploads/org-a/team-a');
    await fs.mkdir(nested, { recursive: true });
    try {
      const sourceRecords = [
        { ...source, base_path: root },
        { ...source, id: 'nested-alias', display_name: 'Nested alias', base_path: nested },
      ];
      const result = await requestUpload(
        { sourceId: 'workspace', file: { name: 'nested-conflict.txt', text: 'x' } },
        'contributor',
        [{ role: 'contributor', org_id: 'org-a', team_id: 'team-a' }],
        undefined,
        'org-a',
        ['org-a'],
        undefined,
        teamRepo(),
        sourceRecords,
        [aliasOwnership('nested-alias', 'nested-conflict.txt')],
      );
      expect(result.response.status).toBe(409);
      expect(result.adapter.stat).not.toHaveBeenCalled();
      expect(result.adapter.writeExclusive).not.toHaveBeenCalled();
      expect(result.ownership.reservePendingOwnership).not.toHaveBeenCalled();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('rechecks physical aliases after parent preparation before reserving ownership', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'entity-upload-race-alias-'));
    try {
      const target = 'uploads/org-a/team-a/race-alias.txt';
      const sourceRecords = [
        { ...source, base_path: root },
        { ...source, id: 'alias', display_name: 'Alias', base_path: root },
      ];
      const result = await requestUpload(
        { sourceId: 'workspace', file: { name: 'race-alias.txt', text: 'x' } },
        'contributor',
        [{ role: 'contributor', org_id: 'org-a', team_id: 'team-a' }],
        undefined,
        'org-a',
        ['org-a'],
        undefined,
        teamRepo(),
        sourceRecords,
        [],
        (ownership) => {
          const raced = aliasOwnership('alias', target, 'org-a', 'racing-principal');
          ownership.upsertOwnership({ sourceId: raced.source_id, path: raced.path, orgId: raced.org_id, teamId: raced.team_id, ownerPrincipalId: raced.owner_principal_id, displayName: raced.display_name, origin: raced.origin });
        },
      );
      expect(result.response.status).toBe(409);
      expect(result.adapter.writeExclusive).not.toHaveBeenCalled();
      expect(result.ownership.reservePendingOwnership).not.toHaveBeenCalled();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('infers a single customer org but rejects a foreign org selection', async () => {
    const inferred = await requestUpload({ sourceId: 'workspace', file: { name: 'inferred.txt', text: 'x' } }, 'contributor', undefined, undefined, null);
    expect(inferred.response.status).toBe(201);
    const foreign = await requestUpload({ sourceId: 'workspace', file: { name: 'foreign.txt', text: 'x' } }, 'contributor', undefined, undefined, 'org-b');
    expect(foreign.response.status).toBe(403);
  });

  it('does not combine a contributor grant for one team with viewer access to another', async () => {
    const result = await requestUpload(
      { sourceId: 'workspace', teamId: 'team-b', file: { name: 'a.txt', text: 'a' } },
      'contributor',
      [
        { role: 'contributor', org_id: 'org-a', team_id: 'team-a' },
        { role: 'viewer', org_id: 'org-a', team_id: 'team-b' },
      ],
    );
    expect(result.response.status).toBe(403);
  });

  it('requires an explicit team when multiple contributor team grants exist', async () => {
    const result = await requestUpload(
      { sourceId: 'workspace', file: { name: 'ambiguous.txt', text: 'ambiguous' } },
      'contributor',
      [
        { role: 'contributor', org_id: 'org-a', team_id: 'team-a' },
        { role: 'contributor', org_id: 'org-a', team_id: 'team-b' },
      ],
    );
    expect(result.response.status).toBe(403);
  });

  it('writes binary bytes through the raw broker-backed adapter and records ownership', async () => {
    const bytes = Buffer.from([0, 1, 0xfe, 0xff]);
    const result = await requestUpload({ sourceId: 'workspace', file: { name: 'scan.bin', mimeType: 'application/octet-stream', contentBase64: bytes.toString('base64') } });
    expect(result.response.status).toBe(201);
    expect(result.adapter.writeRawExclusive).toHaveBeenCalledWith('uploads/org-a/team-a/scan.bin', bytes);
    expect(result.ownership.upsertOwnership).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-a', teamId: 'team-a', ownerPrincipalId: 'principal-a' }));
  });

  it('accepts an empty binary upload as a valid zero-byte file', async () => {
    const result = await requestUpload({ sourceId: 'workspace', file: { name: 'empty.bin', mimeType: 'application/octet-stream', contentBase64: '' } });
    expect(result.response.status).toBe(201);
    expect(result.adapter.writeRawExclusive).toHaveBeenCalledWith('uploads/org-a/team-a/empty.bin', Buffer.alloc(0));
  });

  it('removes only its pending reservation on a verified exclusive-create conflict', async () => {
    const result = await requestUpload(
      { sourceId: 'workspace', file: { name: 'conflict.txt', text: 'x' } },
      'contributor', undefined, undefined, 'org-a', ['org-a'], 'conflict',
    );
    expect(result.response.status).toBe(409);
    expect(result.ownership.deletePendingOwnership).toHaveBeenCalledWith(expect.objectContaining({ source_id: 'workspace', path: 'uploads/org-a/team-a/conflict.txt', origin: 'pending', owner_principal_id: 'principal-a' }));
    expect(result.ownership.upsertOwnership).not.toHaveBeenCalled();
    expect(result.ownership.getOwnership('workspace', 'uploads/org-a/team-a/conflict.txt')).toBeUndefined();
  });

  it('retains the pending reservation after an ambiguous broker failure', async () => {
    const result = await requestUpload(
      { sourceId: 'workspace', file: { name: 'uncertain.txt', text: 'x' } },
      'contributor', undefined, undefined, 'org-a', ['org-a'], 'ambiguous',
    );
    expect(result.response.status).toBe(500);
    expect(result.ownership.deletePendingOwnership).not.toHaveBeenCalled();
    expect(result.ownership.getOwnership('workspace', 'uploads/org-a/team-a/uncertain.txt')).toMatchObject({ origin: 'pending' });
    acquireFileMutationGuard('move')();
  });

  it('checks the payload-specific exclusive writer before reserving ownership', async () => {
    const result = await requestUpload(
      { sourceId: 'workspace', file: { name: 'missing-writer.txt', text: 'x' } },
      'contributor',
      [{ role: 'contributor', org_id: 'org-a', team_id: 'team-a' }],
      'binary-only',
    );
    expect(result.response.status).toBe(503);
    expect(result.ownership.reservePendingOwnership).not.toHaveBeenCalled();
  });

  it('does not list project-only team grants, while a team viewer sees uploads', async () => {
    const projectOnly = await requestUploads([{ role: 'viewer', org_id: 'org-a', team_id: 'team-a', project_id: 'project-1' }]);
    expect(projectOnly.response.status).toBe(200);
    await expect(projectOnly.response.json()).resolves.toMatchObject({ orgId: 'org-a', uploads: [] });

    const teamViewer = await requestUploads([{ role: 'viewer', org_id: 'org-a', team_id: 'team-a' }]);
    expect(teamViewer.response.status).toBe(200);
    await expect(teamViewer.response.json()).resolves.toMatchObject({ uploads: [{ path: 'uploads/org-a/team-a/visible.txt' }] });
  });

  it('rejects payloads over the 1 MiB cap', async () => {
    const result = await requestUpload({ sourceId: 'workspace', file: { name: 'large.txt', text: 'x'.repeat(MAX_UPLOAD_BYTES + 1) } });
    expect(result.response.status).toBe(413);
  });

  it('accepts exactly the current 1 MiB broker-compatible boundary', async () => {
    const result = await requestUpload({ sourceId: 'workspace', file: { name: 'boundary.txt', text: 'x'.repeat(MAX_UPLOAD_BYTES) } });
    expect(result.response.status).toBe(201);
  });

  it('accepts a 1 MiB decoded text payload whose JSON escaping is larger on the wire', async () => {
    const result = await requestUpload({ sourceId: 'workspace', file: { name: 'escaped.txt', text: '\u0001'.repeat(MAX_UPLOAD_BYTES) } });
    expect(result.response.status).toBe(201);
  });

  it('writes an actual local upload into an empty source with broker-created parents', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'entity-upload-empty-'));
    const previousWorkspace = process.env.WORKSPACE;
    const previousRoots = process.env.ENTITY_FS_LOCAL_SOURCE_ROOTS;
    process.env.WORKSPACE = root;
    process.env.ENTITY_FS_LOCAL_SOURCE_ROOTS = root;
    const localSource = { ...source, base_path: root };
    const repo: FileSourceRepository = {
      listSources: vi.fn(() => [localSource]), getSource: vi.fn(() => localSource), createSource: vi.fn(() => localSource),
      updateSource: vi.fn(() => localSource), setEnabled: vi.fn(() => localSource), deleteSource: vi.fn(() => false),
    };
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use((req, _res, next) => {
      req.headers['x-entity-org-id'] = 'org-a';
      (req as unknown as { entityCustomerPrincipal: unknown }).entityCustomerPrincipal = {
        principalId: 'principal-a', principalType: 'human',
        permission: { principal_id: 'principal-a', grants: [{ role: 'contributor', org_id: 'org-a', team_id: 'team-a' }] },
        orgIds: ['org-a'], isGlobalAdmin: false,
      };
      next();
    });
    const router = Router();
    registerUploadRoutes(router, { sourceRepo: repo, ownershipRepo: ownershipRepo(), indexRepo: { upsertRecord: vi.fn(() => ({}) as never) }, teamRepo: teamRepo() });
    app.use('/api/fs', router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server failed to bind');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/fs/upload`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceId: 'workspace', file: { name: 'hello.txt', text: 'hello' } }),
      });
      expect(response.status).toBe(201);
      const body = await response.json() as { path: string };
      await expect(fs.readFile(path.join(root, body.path), 'utf8')).resolves.toBe('hello');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (previousWorkspace === undefined) delete process.env.WORKSPACE; else process.env.WORKSPACE = previousWorkspace;
      if (previousRoots === undefined) delete process.env.ENTITY_FS_LOCAL_SOURCE_ROOTS; else process.env.ENTITY_FS_LOCAL_SOURCE_ROOTS = previousRoots;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
