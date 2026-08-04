import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getEntityDatabase } from './entity-db';

export const PRINCIPAL_TYPES = ['human', 'agent', 'service_account'] as const;
export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

export const PRINCIPAL_STATUSES = ['active', 'disabled'] as const;
export type PrincipalStatus = (typeof PRINCIPAL_STATUSES)[number];

export const GRANT_ROLES = ['viewer', 'contributor', 'manager', 'admin'] as const;
export type GrantRole = (typeof GRANT_ROLES)[number];

export interface PrincipalRecord {
  id: string;
  principal_type: PrincipalType;
  display_name: string;
  handle: string | null;
  email: string | null;
  status: PrincipalStatus;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface PrincipalGrantRecord {
  id: string;
  principal_id: string;
  role: GrantRole;
  org_id: string | null;
  team_id: string | null;
  project_id: number | null;
  sensitivity_categories_json: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface CreatePrincipalInput {
  id?: string;
  principal_type: PrincipalType;
  display_name: string;
  handle?: string | null;
  email?: string | null;
  metadata_json?: string;
  created_by?: string | null;
}

export interface UpdatePrincipalInput {
  display_name?: string;
  handle?: string | null;
  email?: string | null;
  metadata_json?: string;
  updated_by?: string | null;
}

export interface CreatePrincipalGrantInput {
  id?: string;
  principal_id: string;
  role: GrantRole;
  org_id?: string | null;
  team_id?: string | null;
  project_id?: number | null;
  sensitivity_categories?: string[];
  created_by?: string | null;
}

export interface UpdatePrincipalGrantInput {
  role?: GrantRole;
  org_id?: string | null;
  team_id?: string | null;
  project_id?: number | null;
  sensitivity_categories?: string[];
  updated_by?: string | null;
}

export interface PrincipalRepository {
  listPrincipals: (options?: { includeDisabled?: boolean }) => PrincipalRecord[];
  getPrincipal: (id: string) => PrincipalRecord | undefined;
  createPrincipal: (input: CreatePrincipalInput) => PrincipalRecord;
  updatePrincipal: (id: string, input: UpdatePrincipalInput) => PrincipalRecord | undefined;
  disablePrincipal: (id: string, updatedBy?: string | null) => PrincipalRecord | undefined;
  listGrantsForPrincipal: (principalId: string) => PrincipalGrantRecord[];
  getGrant: (grantId: string) => PrincipalGrantRecord | undefined;
  createGrant: (input: CreatePrincipalGrantInput) => PrincipalGrantRecord;
  updateGrant: (grantId: string, input: UpdatePrincipalGrantInput) => PrincipalGrantRecord | undefined;
  revokeGrant: (grantId: string) => boolean;
}

function normalizePrincipalType(value: unknown): PrincipalType {
  return value === 'agent' || value === 'service_account' ? value : 'human';
}

function normalizeGrantRole(value: unknown): GrantRole {
  return value === 'viewer' || value === 'contributor' || value === 'manager' || value === 'admin' ? value : 'viewer';
}

function mapPrincipalRow(row: Record<string, unknown>): PrincipalRecord {
  return {
    id: String(row.id ?? ''),
    principal_type: normalizePrincipalType(row.principal_type),
    display_name: String(row.display_name ?? ''),
    handle: typeof row.handle === 'string' ? row.handle : null,
    email: typeof row.email === 'string' ? row.email : null,
    status: row.status === 'disabled' ? 'disabled' : 'active',
    metadata_json: typeof row.metadata_json === 'string' ? row.metadata_json : '{}',
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
    created_by: typeof row.created_by === 'string' ? row.created_by : null,
    updated_by: typeof row.updated_by === 'string' ? row.updated_by : null,
  };
}

function mapGrantRow(row: Record<string, unknown>): PrincipalGrantRecord {
  return {
    id: String(row.id ?? ''),
    principal_id: String(row.principal_id ?? ''),
    role: normalizeGrantRole(row.role),
    org_id: typeof row.org_id === 'string' ? row.org_id : null,
    team_id: typeof row.team_id === 'string' ? row.team_id : null,
    project_id: typeof row.project_id === 'number' ? row.project_id : row.project_id != null ? Number(row.project_id) : null,
    sensitivity_categories_json: typeof row.sensitivity_categories_json === 'string' ? row.sensitivity_categories_json : '[]',
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
    created_by: typeof row.created_by === 'string' ? row.created_by : null,
    updated_by: typeof row.updated_by === 'string' ? row.updated_by : null,
  };
}

export function ensurePrincipalsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_principals (
      id TEXT PRIMARY KEY,
      principal_type TEXT NOT NULL CHECK (principal_type IN ('human', 'agent', 'service_account')),
      display_name TEXT NOT NULL,
      handle TEXT,
      email TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT,
      updated_by TEXT
    );

    CREATE TABLE IF NOT EXISTS principal_grants (
      id TEXT PRIMARY KEY,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('viewer', 'contributor', 'manager', 'admin')),
      org_id TEXT,
      team_id TEXT,
      project_id INTEGER,
      sensitivity_categories_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT,
      updated_by TEXT,
      FOREIGN KEY (principal_id) REFERENCES entity_principals(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_principal_grants_principal ON principal_grants(principal_id);
    CREATE INDEX IF NOT EXISTS idx_entity_principals_status ON entity_principals(status);
  `);
}

export function createPrincipalRepository(db?: Database.Database): PrincipalRepository {
  const database = db ?? getEntityDatabase(ensurePrincipalsSchema);

  return {
    listPrincipals(options = {}) {
      const rows = options.includeDisabled
        ? database.prepare('SELECT * FROM entity_principals ORDER BY display_name COLLATE NOCASE ASC').all()
        : database.prepare("SELECT * FROM entity_principals WHERE status = 'active' ORDER BY display_name COLLATE NOCASE ASC").all();
      return (rows as Array<Record<string, unknown>>).map(mapPrincipalRow);
    },

    getPrincipal(id) {
      const row = database.prepare('SELECT * FROM entity_principals WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      return row ? mapPrincipalRow(row) : undefined;
    },

    createPrincipal(input) {
      const id = input.id?.trim() || randomUUID();
      const handle = input.handle?.trim() || null;
      const email = input.email?.trim() || null;
      const metadataJson = input.metadata_json ?? '{}';
      const createdBy = input.created_by ?? null;
      database.prepare(`
        INSERT INTO entity_principals (
          id, principal_type, display_name, handle, email, status, metadata_json, created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
      `).run(id, normalizePrincipalType(input.principal_type), input.display_name.trim(), handle, email, metadataJson, createdBy, createdBy);
      return mapPrincipalRow(database.prepare('SELECT * FROM entity_principals WHERE id = ?').get(id) as Record<string, unknown>);
    },

    updatePrincipal(id, input) {
      const current = this.getPrincipal(id);
      if (!current) return undefined;
      const next = {
        display_name: input.display_name?.trim() ?? current.display_name,
        handle: input.handle === undefined ? current.handle : (input.handle?.trim() || null),
        email: input.email === undefined ? current.email : (input.email?.trim() || null),
        metadata_json: input.metadata_json ?? current.metadata_json,
        updated_by: input.updated_by ?? current.updated_by,
      };
      database.prepare(`
        UPDATE entity_principals
        SET display_name = ?, handle = ?, email = ?, metadata_json = ?, updated_at = datetime('now'), updated_by = ?
        WHERE id = ?
      `).run(next.display_name, next.handle, next.email, next.metadata_json, next.updated_by, id);
      return this.getPrincipal(id);
    },

    disablePrincipal(id, updatedBy = null) {
      const current = this.getPrincipal(id);
      if (!current) return undefined;
      database.prepare(`
        UPDATE entity_principals
        SET status = 'disabled', updated_at = datetime('now'), updated_by = ?
        WHERE id = ?
      `).run(updatedBy, id);
      return this.getPrincipal(id);
    },

    listGrantsForPrincipal(principalId) {
      const rows = database.prepare('SELECT * FROM principal_grants WHERE principal_id = ? ORDER BY created_at ASC').all(principalId);
      return (rows as Array<Record<string, unknown>>).map(mapGrantRow);
    },

    getGrant(grantId) {
      const row = database.prepare('SELECT * FROM principal_grants WHERE id = ?').get(grantId) as Record<string, unknown> | undefined;
      return row ? mapGrantRow(row) : undefined;
    },

    createGrant(input) {
      const id = input.id?.trim() || randomUUID();
      const sensitivityJson = JSON.stringify(input.sensitivity_categories ?? []);
      const createdBy = input.created_by ?? null;
      database.prepare(`
        INSERT INTO principal_grants (
          id, principal_id, role, org_id, team_id, project_id, sensitivity_categories_json, created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.principal_id,
        normalizeGrantRole(input.role),
        input.org_id ?? null,
        input.team_id ?? null,
        input.project_id ?? null,
        sensitivityJson,
        createdBy,
        createdBy,
      );
      return mapGrantRow(database.prepare('SELECT * FROM principal_grants WHERE id = ?').get(id) as Record<string, unknown>);
    },

    updateGrant(grantId, input) {
      const current = this.getGrant(grantId);
      if (!current) return undefined;
      const next = {
        role: input.role ? normalizeGrantRole(input.role) : current.role,
        org_id: input.org_id === undefined ? current.org_id : input.org_id,
        team_id: input.team_id === undefined ? current.team_id : input.team_id,
        project_id: input.project_id === undefined ? current.project_id : input.project_id,
        sensitivity_categories_json: input.sensitivity_categories
          ? JSON.stringify(input.sensitivity_categories)
          : current.sensitivity_categories_json,
        updated_by: input.updated_by ?? current.updated_by,
      };
      database.prepare(`
        UPDATE principal_grants
        SET role = ?, org_id = ?, team_id = ?, project_id = ?, sensitivity_categories_json = ?,
            updated_at = datetime('now'), updated_by = ?
        WHERE id = ?
      `).run(
        next.role,
        next.org_id,
        next.team_id,
        next.project_id,
        next.sensitivity_categories_json,
        next.updated_by,
        grantId,
      );
      return this.getGrant(grantId);
    },

    revokeGrant(grantId) {
      const result = database.prepare('DELETE FROM principal_grants WHERE id = ?').run(grantId);
      return result.changes > 0;
    },
  };
}

export function parseGrantSensitivityCategories(grant: PrincipalGrantRecord): string[] {
  try {
    const parsed = JSON.parse(grant.sensitivity_categories_json);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}
