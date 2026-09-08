import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const dbPaths: string[] = [];
let activeDbPath: string | null = null;

function temporaryDbPath(): string {
  const dbPath = path.join(os.tmpdir(), `entity-file-ownership-${process.pid}-${randomUUID()}.sqlite`);
  dbPaths.push(dbPath);
  return dbPath;
}

async function loadRepository() {
  activeDbPath = temporaryDbPath();
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', activeDbPath);
  const module = await import('./file-ownership');
  return module.createFsFileOwnershipRepository();
}

afterEach(async () => {
  if (activeDbPath) {
    const { getEntityDatabase } = await import('./entity-db');
    getEntityDatabase().close();
  }
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const dbPath of dbPaths.splice(0)) {
    for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(file, { force: true });
  }
  activeDbPath = null;
});

describe('file ownership repository', () => {
  it('persists ownership and scopes team listings to the requested org', async () => {
    const repository = await loadRepository();
    repository.upsertOwnership({ sourceId: 'source-a', path: 'uploads/org-a/team-a/a.txt', orgId: 'org-a', teamId: 'team-a', ownerPrincipalId: 'principal-a', displayName: 'a.txt' });
    repository.upsertOwnership({ sourceId: 'source-a', path: 'uploads/org-b/team-a/b.txt', orgId: 'org-b', teamId: 'team-a', ownerPrincipalId: 'principal-b', displayName: 'b.txt' });

    expect(repository.getOwnership('source-a', 'uploads/org-a/team-a/a.txt')).toMatchObject({ org_id: 'org-a', team_id: 'team-a' });
    expect(repository.listOwnershipForTeams('org-a', ['team-a'])).toHaveLength(1);
    expect(repository.listOwnershipForOrg('org-a')).toHaveLength(1);
  });

  it('lists reservations across organizations under source path prefixes', async () => {
    const repository = await loadRepository();
    repository.upsertOwnership({ sourceId: 'source-a', path: 'nested/uploads/org-a/team-a/a.txt', orgId: 'org-a', origin: 'pending' });
    repository.upsertOwnership({ sourceId: 'source-a', path: 'nested/uploads/org-a/team-a/foreign.txt', orgId: 'org-b', origin: 'pending' });
    repository.upsertOwnership({ sourceId: 'source-a', path: 'nested/uploads/org-a-other/team-a/sibling.txt', orgId: 'org-c', origin: 'pending' });
    repository.upsertOwnership({ sourceId: 'source-b', path: 'uploads/org-a/team-a/b.txt', orgId: 'org-d', origin: 'pending' });
    repository.upsertOwnership({ sourceId: 'source-c', path: 'literal_% /emoji-😀/child.txt', orgId: 'org-e', origin: 'pending' });
    repository.upsertOwnership({ sourceId: 'source-c', path: 'literal_% /emoji-😀-sibling/child.txt', orgId: 'org-f', origin: 'pending' });

    const nestedMatches = repository.listOwnershipForPathScopes?.([{ sourceId: 'source-a', pathPrefix: 'nested/uploads/org-a' }]) ?? [];
    expect(nestedMatches).toHaveLength(2);
    expect(nestedMatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_id: 'source-a', path: 'nested/uploads/org-a/team-a/foreign.txt', org_id: 'org-b' }),
      expect.objectContaining({ source_id: 'source-a', path: 'nested/uploads/org-a/team-a/a.txt', org_id: 'org-a' }),
    ]));
    expect(repository.listOwnershipForPathScopes?.([{ sourceId: 'source-b', pathPrefix: '' }])).toMatchObject([
      { source_id: 'source-b', path: 'uploads/org-a/team-a/b.txt', org_id: 'org-d' },
    ]);
    const literalMatches = repository.listOwnershipForPathScopes?.([{ sourceId: 'source-c', pathPrefix: 'literal_% /emoji-😀' }]) ?? [];
    expect(literalMatches).toHaveLength(1);
    expect(literalMatches[0]).toMatchObject({ source_id: 'source-c', path: 'literal_% /emoji-😀/child.txt', org_id: 'org-e' });
  });

  it('atomically reserves a pending path and rejects competing reservations without overwriting ownership', async () => {
    const repository = await loadRepository();
    const input = { sourceId: 'source-a', path: 'uploads/org-a/team-a/pending.bin', orgId: 'org-a', teamId: 'team-a', ownerPrincipalId: 'principal-a', displayName: 'pending.bin' };

    expect(repository.reservePendingOwnership(input)).toMatchObject({ origin: 'pending', owner_principal_id: 'principal-a' });
    expect(() => repository.reservePendingOwnership({ ...input, ownerPrincipalId: 'principal-b' })).toThrow(/already reserved/);
    expect(repository.getOwnership(input.sourceId, input.path)).toMatchObject({ origin: 'pending', owner_principal_id: 'principal-a' });
    expect(repository.listOwnershipForOrg('org-a')).toHaveLength(1);
  });

  it('deletes only the exact pending reservation returned to the writer', async () => {
    const repository = await loadRepository();
    const input = { sourceId: 'source-a', path: 'uploads/org-a/team-a/conflict.bin', orgId: 'org-a', teamId: 'team-a', ownerPrincipalId: 'principal-a', displayName: 'conflict.bin' };
    const reservation = repository.reservePendingOwnership(input);
    expect(repository.deletePendingOwnership({ ...reservation, owner_principal_id: 'principal-b' })).toBe(false);
    expect(repository.deletePendingOwnership({ ...reservation, uploaded_at: '2026-01-01T00:00:00.000Z' })).toBe(false);
    expect(repository.deletePendingOwnership({ ...reservation, updated_at: '2026-01-01T00:00:00.000Z' })).toBe(false);
    expect(repository.deletePendingOwnership({ ...reservation, origin: 'upload' })).toBe(false);
    expect(repository.getOwnership(input.sourceId, input.path)).toMatchObject({ origin: 'pending', owner_principal_id: 'principal-a' });
    expect(repository.deletePendingOwnership(reservation)).toBe(true);
    expect(repository.getOwnership(input.sourceId, input.path)).toBeUndefined();
  });

  it('deletes an owned record only when every observed field still matches', async () => {
    const repository = await loadRepository();
    const input = { sourceId: 'source-a', path: 'notes/converted.md', orgId: 'org-a', teamId: 'team-a', ownerPrincipalId: 'principal-a', displayName: 'converted.md', origin: 'manual' as const };
    const expected = repository.upsertOwnership(input);
    expect(repository.deleteOwnershipIfMatches?.({ ...expected, owner_principal_id: 'principal-b' })).toBe(false);
    expect(repository.deleteOwnershipIfMatches?.(expected)).toBe(true);
    expect(repository.getOwnership(input.sourceId, input.path)).toBeUndefined();
    expect(repository.reservePendingOwnership(input)).toMatchObject({ origin: 'pending', path: input.path });
  });

  it('does not delete a concurrent replacement record', async () => {
    const repository = await loadRepository();
    const input = { sourceId: 'source-a', path: 'notes/replaced.md', orgId: 'org-a', teamId: 'team-a', ownerPrincipalId: 'principal-a', displayName: 'replaced.md', origin: 'upload' as const };
    const expected = repository.upsertOwnership(input);
    const replacement = repository.upsertOwnership({ ...input, ownerPrincipalId: 'principal-b' });
    expect(repository.deleteOwnershipIfMatches?.(expected)).toBe(false);
    expect(repository.getOwnership(input.sourceId, input.path)).toEqual(replacement);
  });
});
