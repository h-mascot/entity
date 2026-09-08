import Database from 'better-sqlite3';
import { getEntityDatabase } from './entity-db';

export const FS_FILE_OWNERSHIP_ORIGINS = ['pending', 'upload', 'manual', 'system'] as const;
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

export interface FsFileOwnershipPathScope {
  sourceId: string;
  pathPrefix: string;
}

export interface FsFileOwnershipRepository {
  getOwnership(sourceId: string, path: string): FsFileOwnershipRecord | undefined;
  reservePendingOwnership(input: UpsertFsFileOwnershipInput): FsFileOwnershipRecord;
  upsertOwnership(input: UpsertFsFileOwnershipInput): FsFileOwnershipRecord;
  listOwnershipForOrg(orgId: string): FsFileOwnershipRecord[];
  listOwnershipForTeams(orgId: string, teamIds: string[]): FsFileOwnershipRecord[];
  /** Lists every organization’s reservations under the supplied physical-source path prefixes. */
  listOwnershipForPathScopes?(scopes: readonly FsFileOwnershipPathScope[]): FsFileOwnershipRecord[];
  deleteOwnership(sourceId: string, path: string): boolean;
  deleteOwnershipIfMatches?(expected: FsFileOwnershipRecord): boolean;
  deletePendingOwnership(reservation: FsFileOwnershipRecord): boolean;
}

function openOwnershipDatabase(): Database.Database {
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

export function createFsFileOwnershipRepository(): FsFileOwnershipRepository {
  const db = openOwnershipDatabase();
  const select = 'SELECT source_id, path, org_id, team_id, owner_principal_id, display_name, origin, uploaded_at, updated_at FROM fs_file_ownership';
  const getStmt = db.prepare(`${select} WHERE source_id = ? AND path = ?`);
  const upsertStmt = db.prepare(`
    INSERT INTO fs_file_ownership (source_id, path, org_id, team_id, owner_principal_id, display_name, origin, uploaded_at, updated_at)
    VALUES (@source_id, @path, @org_id, @team_id, @owner_principal_id, @display_name, @origin, @now, @now)
    ON CONFLICT(source_id, path) DO UPDATE SET
      org_id = excluded.org_id, team_id = excluded.team_id,
      owner_principal_id = excluded.owner_principal_id, display_name = excluded.display_name,
      origin = excluded.origin, updated_at = excluded.updated_at
  `);
  const reserveStmt = db.prepare(`
    INSERT INTO fs_file_ownership (source_id, path, org_id, team_id, owner_principal_id, display_name, origin, uploaded_at, updated_at)
    VALUES (@source_id, @path, @org_id, @team_id, @owner_principal_id, @display_name, 'pending', @now, @now)
  `);
  const orgStmt = db.prepare(`${select} WHERE org_id = ? ORDER BY uploaded_at DESC`);
  const teamsStmt = db.prepare(`${select} WHERE org_id = ? AND team_id IN (SELECT value FROM json_each(?)) ORDER BY uploaded_at DESC`);
  const deleteStmt = db.prepare('DELETE FROM fs_file_ownership WHERE source_id = ? AND path = ?');
  const deleteIfMatchesStmt = db.prepare(`DELETE FROM fs_file_ownership
    WHERE source_id = ? AND path = ? AND org_id = ? AND team_id IS ?
      AND owner_principal_id IS ? AND display_name IS ? AND origin = ?
      AND uploaded_at = ? AND updated_at = ?`);
  const deletePendingStmt = db.prepare("DELETE FROM fs_file_ownership WHERE source_id = ? AND path = ? AND origin = 'pending' AND owner_principal_id IS ? AND uploaded_at = ? AND updated_at = ?");
  return {
    getOwnership: (sourceId, path) => getStmt.get(sourceId, path) as FsFileOwnershipRecord | undefined,
    reservePendingOwnership: (input) => {
      const now = new Date().toISOString();
      try {
        reserveStmt.run({
          source_id: input.sourceId, path: input.path, org_id: input.orgId,
          team_id: input.teamId ?? null, owner_principal_id: input.ownerPrincipalId ?? null,
          display_name: input.displayName ?? null, now,
        });
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        if (code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw new Error('File upload path is already reserved by an incomplete upload; retry after reconciliation.');
        }
        throw error;
      }
      const result = getStmt.get(input.sourceId, input.path) as FsFileOwnershipRecord | undefined;
      if (!result) throw new Error('Failed to reserve file ownership.');
      return result;
    },
    upsertOwnership: (input) => {
      const now = new Date().toISOString();
      upsertStmt.run({
        source_id: input.sourceId, path: input.path, org_id: input.orgId,
        team_id: input.teamId ?? null, owner_principal_id: input.ownerPrincipalId ?? null,
        display_name: input.displayName ?? null, origin: input.origin ?? 'upload', now,
      });
      const result = getStmt.get(input.sourceId, input.path) as FsFileOwnershipRecord | undefined;
      if (!result) throw new Error('Failed to persist file ownership.');
      return result;
    },
    listOwnershipForOrg: (orgId) => orgStmt.all(orgId) as FsFileOwnershipRecord[],
    listOwnershipForTeams: (orgId, teamIds) => teamIds.length ? teamsStmt.all(orgId, JSON.stringify(teamIds)) as FsFileOwnershipRecord[] : [],
    listOwnershipForPathScopes: (scopes) => {
      if (scopes.length === 0) return [];
      const clauses: string[] = [];
      const params: Array<string | number> = [];
      for (const scope of scopes) {
        const prefix = scope.pathPrefix.replace(/^\/+|\/+$/g, '');
        clauses.push('(source_id = ? AND (? = \'\' OR path = ? OR (instr(path, ?) = 1 AND substr(path, length(?) + 1, 1) = \'/\')))');
        params.push(scope.sourceId, prefix, prefix, prefix, prefix);
      }
      return db.prepare(`${select} WHERE ${clauses.join(' OR ')} ORDER BY uploaded_at DESC`).all(...params) as FsFileOwnershipRecord[];
    },
    deleteOwnership: (sourceId, path) => Number(deleteStmt.run(sourceId, path).changes) > 0,
    deleteOwnershipIfMatches: (expected) => Number(deleteIfMatchesStmt.run(
      expected.source_id, expected.path, expected.org_id, expected.team_id,
      expected.owner_principal_id, expected.display_name, expected.origin,
      expected.uploaded_at, expected.updated_at,
    ).changes) > 0,
    deletePendingOwnership: (reservation) => {
      if (reservation.origin !== 'pending') return false;
      return Number(deletePendingStmt.run(
        reservation.source_id, reservation.path, reservation.owner_principal_id,
        reservation.uploaded_at, reservation.updated_at,
      ).changes) > 0;
    },
  };
}

export const __internal = { ensureFsFileOwnershipSchema };
