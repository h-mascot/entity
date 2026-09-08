import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FsFileOwnershipRecord } from '../../../db/src/file-ownership';
import type { FileSourceRecord } from '../../../db/src/file-sources';
import type { PrincipalGrant } from '../permissions';
import type { RequestOrgBinding } from '../request-permissions';
import { LOCAL_ADMIN_PRINCIPAL_ID } from '../principals/admin-identity';
import {
  assertOwnedDirectoryWriteAccess,
  assertOwnedFileAccess,
  resolveOwnershipScope,
  sourceOwnershipPathVisible,
} from './ownership';
import { encodeUploadScopeSegment } from './scope-path';

const roots: string[] = [];

function source(id: string, basePath: string): FileSourceRecord {
  return {
    id, display_name: id, type: 'local', base_url: null, base_path: basePath,
    auth_type: 'none', auth_ref: null, enabled: true, icon: null, capabilities: '{}',
    health: 'ok', last_synced_at: null, created_at: '2026-09-07T00:00:00.000Z', updated_at: '2026-09-07T00:00:00.000Z',
  };
}

function ownership(sourceId: string, filePath: string, teamId = 'team-a'): FsFileOwnershipRecord {
  return {
    source_id: sourceId, path: filePath, org_id: 'org-a', team_id: teamId, owner_principal_id: 'owner',
    display_name: path.posix.basename(filePath), origin: 'upload', uploaded_at: '2026-09-07T00:00:00.000Z', updated_at: '2026-09-07T00:00:00.000Z',
  };
}

function repo(rows: FsFileOwnershipRecord[]) {
  return { getOwnership: vi.fn((sourceId: string, filePath: string) => rows.find((row) => row.source_id === sourceId && row.path === filePath)) };
}

function binding(role: 'viewer' | 'contributor', teamId = 'team-a', orgId = 'org-a') {
  const grants: PrincipalGrant[] = [{ role, org_id: orgId, team_id: teamId }];
  return {
    orgId,
    principal: { principal_id: 'principal', grants },
  } satisfies RequestOrgBinding;
}

async function overlapFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'entity-ownership-'));
  roots.push(root);
  const nested = path.join(root, 'nested');
  await fs.mkdir(path.join(nested, 'uploads/org-a/team-a'), { recursive: true });
  await fs.writeFile(path.join(nested, 'uploads/org-a/team-a/file.txt'), 'private');
  return { root, sources: [source('a', root), source('b', nested)] };
}

async function sameRootFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'entity-ownership-same-root-'));
  roots.push(root);
  await fs.mkdir(path.join(root, 'uploads/org-a/team-a'), { recursive: true });
  await fs.writeFile(path.join(root, 'uploads/org-a/team-a/file.txt'), 'private');
  return { root, sources: [source('a', root), source('b', root)] };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('cross-source ownership policy', () => {
  it('keeps optional source context backward-compatible while finding overlapping owners', async () => {
    const { root, sources } = await overlapFixture();
    const row = ownership('b', 'uploads/org-a/team-a/file.txt');
    const ownershipRepo = repo([row]);
    const found = assertOwnedFileAccess(binding('viewer'), ownershipRepo, 'a', 'nested/uploads/org-a/team-a/file.txt', 'read', sources);
    expect(found).toEqual(row);

    const direct = ownership('a', 'ordinary.txt');
    const directRepo = repo([direct]);
    expect(assertOwnedFileAccess(binding('viewer'), directRepo, 'a', 'ordinary.txt', 'read')).toEqual(direct);
    expect(root).toBeTruthy();
  });

  it('fails closed for an unowned reserved alias and denies a foreign team owner', async () => {
    const { sources } = await overlapFixture();
    const emptyRepo = repo([]);
    expect(() => assertOwnedFileAccess(binding('viewer'), emptyRepo, 'a', 'nested/uploads/org-a/team-a/file.txt', 'read', sources)).toThrow(/ownership is required/i);

    const row = ownership('b', 'uploads/org-a/team-a/file.txt');
    expect(() => assertOwnedFileAccess(binding('viewer', 'team-b'), repo([row]), 'a', 'nested/uploads/org-a/team-a/file.txt', 'read', sources)).toThrow(/ownership scope/i);
    expect(() => assertOwnedFileAccess({ orgId: 'org-a', principal: { principal_id: LOCAL_ADMIN_PRINCIPAL_ID, grants: [] } }, emptyRepo, 'a', 'nested/uploads/org-a/team-a/file.txt', 'write', sources)).toThrow(/ownership is required/i);
  });

  it('projects directory visibility across overlapping roots without unrelated-source aliasing', async () => {
    const { sources } = await overlapFixture();
    const row = ownership('b', 'uploads/org-a/team-a/file.txt');
    const scope = resolveOwnershipScope(binding('viewer'));
    expect(sourceOwnershipPathVisible(scope, 'a', 'nested/uploads/org-a/team-a', [row], sources)).toBe(true);
    expect(sourceOwnershipPathVisible(scope, 'a', 'nested/uploads/org-a/team-a', [ownership('b', 'uploads/org-a/team-a/file.txt', 'team-b')], sources)).toBe(false);
  });

  it('shares one owner across same-root aliases but denies foreign and pending alias conflicts', async () => {
    const { sources } = await sameRootFixture();
    const scope = resolveOwnershipScope(binding('viewer'));
    const owner = ownership('a', 'uploads/org-a/team-a/file.txt');
    expect(sourceOwnershipPathVisible(scope, 'a', 'uploads/org-a/team-a', [owner], sources)).toBe(true);
    expect(sourceOwnershipPathVisible(scope, 'b', 'uploads/org-a/team-a', [owner], sources)).toBe(true);

    const foreign = ownership('b', 'uploads/org-a/team-a/file.txt', 'team-b');
    expect(sourceOwnershipPathVisible(scope, 'a', 'uploads/org-a/team-a', [owner, foreign], sources)).toBe(false);

    const pending = { ...owner, source_id: 'b', origin: 'pending' as const };
    expect(sourceOwnershipPathVisible(scope, 'a', 'uploads/org-a/team-a', [owner, pending], sources)).toBe(false);

    const invisibleSibling = ownership('b', 'uploads/org-a/team-a/other.txt', 'team-b');
    expect(sourceOwnershipPathVisible(scope, 'a', 'uploads/org-a/team-a', [owner, invisibleSibling], sources)).toBe(true);
  });

  it('keeps local and global admins bound to their selected organization', async () => {
    const { sources } = await sameRootFixture();
    const filePath = 'uploads/org-a/team-a/file.txt';
    const directoryPath = 'uploads/org-a/team-a';
    const localAdmin = {
      orgId: 'org-a',
      principal: { principal_id: LOCAL_ADMIN_PRINCIPAL_ID, grants: [] },
    } satisfies RequestOrgBinding;
    const globalAdmin = {
      orgId: 'org-a',
      principal: { principal_id: 'global-admin', grants: [{ role: 'admin' }] },
    } satisfies RequestOrgBinding;
    const foreignFile = { ...ownership('b', filePath), org_id: 'org-b' };
    const foreignDirectory = { ...ownership('b', directoryPath), org_id: 'org-b' };
    const pendingFile = { ...ownership('b', filePath), origin: 'pending' as const };
    const sameOrgFile = ownership('b', filePath);
    const sameOrgDirectory = ownership('b', directoryPath);

    for (const admin of [localAdmin, globalAdmin]) {
      const scope = resolveOwnershipScope(admin);
      expect(sourceOwnershipPathVisible(scope, 'a', directoryPath, [foreignFile], sources)).toBe(false);
      expect(() => assertOwnedFileAccess(admin, repo([foreignFile]), 'a', filePath, 'read', sources)).toThrow(/ownership scope/i);
      expect(() => assertOwnedFileAccess(admin, repo([foreignFile]), 'a', filePath, 'write', sources)).toThrow(/ownership scope/i);
      expect(() => assertOwnedDirectoryWriteAccess(admin, repo([foreignDirectory]), 'a', directoryPath, sources)).toThrow(/ownership scope/i);
      expect(() => assertOwnedFileAccess(admin, repo([pendingFile]), 'a', filePath, 'read', sources)).toThrow(/ownership scope/i);
      expect(() => assertOwnedFileAccess(admin, repo([]), 'a', filePath, 'read', sources)).toThrow(/ownership is required/i);

      expect(assertOwnedFileAccess(admin, repo([sameOrgFile]), 'a', filePath, 'read', sources)).toEqual(sameOrgFile);
      expect(() => assertOwnedFileAccess(admin, repo([sameOrgFile]), 'a', filePath, 'write', sources)).not.toThrow();
      expect(() => assertOwnedDirectoryWriteAccess(admin, repo([sameOrgDirectory]), 'a', directoryPath, sources)).not.toThrow();
    }
  });

  it('allows an exact contributor team directory but rejects a foreign organization path', async () => {
    const { sources } = await overlapFixture();
    const ownershipRepo = repo([]);
    expect(() => assertOwnedDirectoryWriteAccess(binding('contributor'), ownershipRepo, 'a', 'uploads/org-a/team-a/new-folder', sources)).not.toThrow();
    expect(() => assertOwnedDirectoryWriteAccess(binding('contributor'), ownershipRepo, 'a', 'uploads/org-b/team-a/new-folder', sources)).toThrow(/contributor role required/i);
  });

  it('matches encoded unsafe team path segments against raw contributor grants', async () => {
    const { sources } = await overlapFixture();
    const salesBinding = binding('contributor', 'Sales Team');
    const encodedTeamPath = `uploads/org-a/${encodeUploadScopeSegment('Sales Team')}/new-folder`;
    expect(() => assertOwnedDirectoryWriteAccess(salesBinding, repo([]), 'a', encodedTeamPath, sources)).not.toThrow();
    expect(() => assertOwnedDirectoryWriteAccess(binding('contributor', 'Other Team'), repo([]), 'a', encodedTeamPath, sources)).toThrow(/contributor role required/i);
  });

  it('matches encoded organization and team segments without crossing organizations', async () => {
    const { sources } = await overlapFixture();
    const encodedPath = `uploads/${encodeUploadScopeSegment('Sales Org')}/${encodeUploadScopeSegment('Sales Team')}/new-folder`;
    expect(() => assertOwnedDirectoryWriteAccess(binding('contributor', 'Sales Team', 'Sales Org'), repo([]), 'a', encodedPath, sources)).not.toThrow();
    expect(() => assertOwnedDirectoryWriteAccess(binding('contributor', 'Sales Team', 'Other Org'), repo([]), 'a', encodedPath, sources)).toThrow(/contributor role required/i);
  });

  it('allows root directory capability for global or org-wide callers but not team-only callers', async () => {
    const { sources } = await overlapFixture();
    const ownershipRepo = repo([]);
    expect(() => assertOwnedDirectoryWriteAccess({
      orgId: 'org-a',
      principal: { principal_id: LOCAL_ADMIN_PRINCIPAL_ID, grants: [] },
    }, ownershipRepo, 'a', '', sources)).not.toThrow();
    expect(() => assertOwnedDirectoryWriteAccess({
      orgId: 'org-a',
      principal: { principal_id: 'principal', grants: [{ role: 'contributor', org_id: 'org-a', team_id: null }] },
    }, ownershipRepo, 'a', '', sources)).not.toThrow();
    expect(() => assertOwnedDirectoryWriteAccess(binding('contributor'), ownershipRepo, 'a', '', sources)).toThrow(/contributor role required/i);
  });

  it('projects a nested source root into its outer reserved upload alias', async () => {
    const outerRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'entity-ownership-outer-'));
    roots.push(outerRoot);
    const nestedRoot = path.join(outerRoot, 'uploads/org-a/team-a');
    await fs.mkdir(nestedRoot, { recursive: true });
    const sources = [source('nested', nestedRoot), source('outer', outerRoot)];
    const ownershipRepo = repo([]);

    expect(() => assertOwnedDirectoryWriteAccess(binding('contributor', 'team-a'), ownershipRepo, 'nested', '', sources)).not.toThrow();
    expect(() => assertOwnedDirectoryWriteAccess(binding('contributor', 'team-b'), ownershipRepo, 'nested', '', sources)).toThrow(/contributor role required/i);
  });

  it('keeps a disabled outer alias in the fail-closed nested-root ownership check', async () => {
    const outerRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'entity-ownership-disabled-'));
    roots.push(outerRoot);
    const nestedRoot = path.join(outerRoot, 'uploads/org-a/team-a');
    await fs.mkdir(nestedRoot, { recursive: true });
    const sources = [
      source('nested', nestedRoot),
      { ...source('outer', outerRoot), enabled: false },
    ];
    const disabledAliasOwner = ownership('outer', 'uploads/org-a/team-a', 'team-b');
    expect(() => assertOwnedDirectoryWriteAccess(
      binding('contributor', 'team-a'),
      repo([disabledAliasOwner]),
      'nested',
      '',
      sources,
    )).toThrow(/scope|contributor role required/i);
  });
});
