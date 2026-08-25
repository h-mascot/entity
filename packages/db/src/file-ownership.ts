import Database from 'better-sqlite3';
import { getEntityDatabase } from './entity-db';

export const FS_FILE_OWNERSHIP_ORIGINS = ['upload', 'manual', 'system'] as const;
export type FsFileOwnershipOrigin = (typeof FS_FILE_OWNERSHIP_ORIGINS)[number];

export interface FsFileOwnershipRecord {
  source_id: string;
  path: string;
  org_id: string;
  team_id: string | null;
  owner_principal_id: string | null;
  display_name: string | null;
  origin: FsFileOwnershipOrigin;
  uploaded_at: string;
  updated_at: string;
}

export interface UpsertFsFileOwnershipInput {
  sourceId: string;
  path: string;
  orgId: string;
  teamId?: string | null;
  ownerPrincipalId?: string | null;
  displayName?: string | null;
  origin?: FsFileOwnershipOrigin;
}

export interface FsFileOwnershipRepository {
  getOwnership: (sourceId: string, path: string) => FsFileOwnershipRecord | undefined;
  upsertOwnership: (input: UpsertFsFileOwnershipInput) => FsFileOwnershipRecord;
  listOwnershipForOrg: (orgId: string) => FsFileOwnershipRecord[];
  listOwnershipForTeams: (orgId: string, teamIds: string[]) => FsFileOwnershipRecord[];
  deleteOwnership: (sourceId: string, path: string) => boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createFsFileOwnershipRepository(): FsFileOwnershipRepository {
  const db = openOwnershipDatabase();
  const getOwnershipStmt = db.prepare(
    'SELECT source_id, path, org_id, team_id, owner_principal_id, display_name, origin, uploaded_at, updated_at FROM fs_file_ownership WHERE source_id = ? AND path = ?',
  );
  const upsertStmt = db.prepare(`
    INSERT INTO fs_file_ownership (source_id, path, org_id, team_id, owner_principal_id, display_name, origin, uploaded_at, updated_at)
    VALUES (@source_id, @path, @org_id, @team_id, @owner_principal_id, @display_name, @origin, @now, @now)
    ON CONFLICT(source_id, path) DO UPDATE SET
      org_id = excluded.org_id,
      team_id = excluded.team_id,
      owner_principal_id = excluded.owner_principal_id,
      display_name = excluded.display_name,
      origin = excluded.origin,
      updated_at = excluded.updated_at
  `);
  const listForOrgStmt = db.prepare(
    'SELECT source_id, path, org_id, team_id, owner_principal_id, display_name, origin, uploaded_at, updated_at FROM fs_file_ownership WHERE org_id = ? ORDER BY uploaded_at DESC',
  );
  const listForTeamsStmt = db.prepare(`
    SELECT source_id, path, org_id, team_id, owner_principal_id, display_name, origin, uploaded_at, updated_at
    FROM fs_file_ownership
    WHERE org_id = ? AND team_id IN (SELECT value FROM json_each(?))
    ORDER BY uploaded_at DESC
  `);
  const deleteStmt = db.prepare('DELETE FROM fs_file_ownership WHERE source_id = ? AND path = ?');

  return {
    getOwnership(sourceId: string, path: string) {
      return getOwnershipStmt.get(sourceId, path) as FsFileOwnershipRecord | undefined;
    },
    upsertOwnership(input: UpsertFsFileOwnershipInput) {
      const now = nowIso();
      upsertStmt.run({
        source_id: input.sourceId,
        path: input.path,
        org_id: input.orgId,
        team_id: input.teamId ?? null,
        owner_principal_id: input.ownerPrincipalId ?? null,
        display_name: input.displayName ?? null,
        origin: input.origin ?? 'upload',
        now,
      });
      return getOwnershipStmt.get(input.sourceId, input.path) as FsFileOwnershipRecord;
    },
    listOwnershipForOrg(orgId: string) {
      return listForOrgStmt.all(orgId) as FsFileOwnershipRecord[];
    },
    listOwnershipForTeams(orgId: string, teamIds: string[]) {
      if (teamIds.length === 0) return [];
      return listForTeamsStmt.all(orgId, JSON.stringify(teamIds)) as FsFileOwnershipRecord[];
    },
    deleteOwnership(sourceId: string, path: string) {
      return deleteStmt.run(sourceId, path).changes > 0;
    },
  };
}

function openOwnershipDatabase(): Database.Database {
  // getEntityDatabase(ensureSchema) invokes the hook on every call, so passing
  // our schema hook here is sufficient and idempotent (CREATE TABLE IF NOT EXISTS).
  return getEntityDatabase(ensureFsFileOwnershipSchema);
}

function ensureFsFileOwnershipSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fs_file_ownership (
      source_id TEXT NOT NULL,
      path TEXT NOT NULL,
      org_id TEXT NOT NULL,
      team_id TEXT,
      owner_principal_id TEXT,
      display_name TEXT,
      origin TEXT NOT NULL DEFAULT 'upload',
      uploaded_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (source_id, path)
    );

    CREATE INDEX IF NOT EXISTS idx_fs_file_ownership_org ON fs_file_ownership(org_id);
    CREATE INDEX IF NOT EXISTS idx_fs_file_ownership_org_team ON fs_file_ownership(org_id, team_id);
  `);
}

export const __internal = { ensureFsFileOwnershipSchema };
