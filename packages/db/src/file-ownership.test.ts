import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFsFileOwnershipRepository } from './file-ownership';
import { getEntityDatabase } from './entity-db';

const tempFiles: string[] = [];

afterEach(async () => {
  await Promise.all(tempFiles.splice(0).map((file) => fs.promises.rm(file, { force: true })));
});

function freshDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-ownership-'));
  const dbPath = path.join(dir, 'entity.sqlite');
  tempFiles.push(dbPath);
  return dbPath;
}

describe('fs_file_ownership repository', () => {
  it('upserts and fetches ownership rows keyed by (source_id, path)', () => {
    process.env.ENTITY_TASK_DB_PATH = freshDbPath();
    const repo = createFsFileOwnershipRepository();
    const created = repo.upsertOwnership({
      sourceId: 'curacel-workspace',
      path: 'uploads/curacel/pilot/acme-proposal.md',
      orgId: 'curacel',
      teamId: 'pilot',
      ownerPrincipalId: 'pilot-service',
      displayName: 'acme-proposal.md',
      origin: 'upload',
    });
    expect(created.org_id).toBe('curacel');
    expect(created.team_id).toBe('pilot');
    expect(created.origin).toBe('upload');

    const fetched = repo.getOwnership('curacel-workspace', 'uploads/curacel/pilot/acme-proposal.md');
    expect(fetched?.owner_principal_id).toBe('pilot-service');

    // Upsert same key updates rather than duplicates.
    const updated = repo.upsertOwnership({
      sourceId: 'curacel-workspace',
      path: 'uploads/curacel/pilot/acme-proposal.md',
      orgId: 'curacel',
      teamId: 'growth',
      ownerPrincipalId: 'growth-lead',
    });
    expect(updated.team_id).toBe('growth');
    const all = repo.listOwnershipForOrg('curacel');
    expect(all).toHaveLength(1);
  });

  it('lists ownership by org and by teams', () => {
    process.env.ENTITY_TASK_DB_PATH = freshDbPath();
    const repo = createFsFileOwnershipRepository();
    repo.upsertOwnership({ sourceId: 's', path: 'a.md', orgId: 'curacel', teamId: 'pilot' });
    repo.upsertOwnership({ sourceId: 's', path: 'b.md', orgId: 'curacel', teamId: 'growth' });
    repo.upsertOwnership({ sourceId: 's', path: 'c.md', orgId: 'other-org', teamId: null });

    expect(repo.listOwnershipForOrg('curacel')).toHaveLength(2);
    const pilot = repo.listOwnershipForTeams('curacel', ['pilot']);
    expect(pilot.map((r) => r.path)).toEqual(['a.md']);
    expect(repo.listOwnershipForTeams('curacel', [])).toEqual([]);
  });

  it('deletes ownership rows', () => {
    process.env.ENTITY_TASK_DB_PATH = freshDbPath();
    const repo = createFsFileOwnershipRepository();
    repo.upsertOwnership({ sourceId: 's', path: 'x.md', orgId: 'curacel' });
    expect(repo.deleteOwnership('s', 'x.md')).toBe(true);
    expect(repo.getOwnership('s', 'x.md')).toBeUndefined();
    expect(repo.deleteOwnership('s', 'x.md')).toBe(false);
  });

  it('ensures its table even when the shared handle was opened by another module first', () => {
    const dbPath = freshDbPath();
    process.env.ENTITY_TASK_DB_PATH = dbPath;
    // Simulate another module (e.g. file-sources) opening the shared handle first
    // without knowing about fs_file_ownership.
    getEntityDatabase();
    const repo = createFsFileOwnershipRepository();
    repo.upsertOwnership({ sourceId: 's', path: 'y.md', orgId: 'curacel' });
    expect(repo.getOwnership('s', 'y.md')).toBeDefined();
  });
});
