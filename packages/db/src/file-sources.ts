import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { getEntityDatabase } from './entity-db';

export const FILE_SOURCE_TYPES = ['local', 'docsify', 'http-markdown', 'github', 's3', 'custom'] as const;
export type FileSourceType = (typeof FILE_SOURCE_TYPES)[number];

export const FILE_SOURCE_HEALTH = ['ok', 'degraded', 'error'] as const;
export type FileSourceHealth = (typeof FILE_SOURCE_HEALTH)[number];

export type FileSourceAuthType = 'none' | 'bearer' | 'api-key' | 'basic' | 'ssh';

export interface FileSourceRecord {
  id: string;
  display_name: string;
  type: FileSourceType;
  base_url: string | null;
  base_path: string | null;
  auth_type: FileSourceAuthType;
  auth_ref: string | null;
  enabled: boolean;
  icon: string | null;
  capabilities: string;
  health: FileSourceHealth;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateFileSourceInput {
  id?: string;
  display_name: string;
  type: FileSourceType | string;
  base_url?: string;
  base_path?: string;
  auth_type?: FileSourceAuthType;
  auth_ref?: string;
  enabled?: boolean;
  icon?: string;
  capabilities?: string;
  health?: FileSourceHealth;
  last_synced_at?: string;
}

export interface UpdateFileSourceInput {
  display_name?: string;
  type?: FileSourceType | string;
  base_url?: string;
  base_path?: string;
  auth_type?: FileSourceAuthType;
  auth_ref?: string;
  enabled?: boolean;
  icon?: string;
  capabilities?: string;
  health?: FileSourceHealth;
  last_synced_at?: string;
}

export interface FileSourceRepository {
  listSources: (includeDisabled?: boolean) => FileSourceRecord[];
  getSource: (id: string) => FileSourceRecord | undefined;
  createSource: (input: CreateFileSourceInput) => FileSourceRecord;
  updateSource: (id: string, updates: UpdateFileSourceInput) => FileSourceRecord | undefined;
  setEnabled: (id: string, enabled: boolean) => FileSourceRecord | undefined;
  deleteSource: (id: string) => boolean;
}

function openEntityDatabase(): Database.Database {
  return getEntityDatabase(ensureFileSystemSchema);
}

function ensureFileSystemSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_sources (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      type TEXT NOT NULL,
      base_url TEXT,
      base_path TEXT,
      auth_type TEXT NOT NULL DEFAULT 'none',
      auth_ref TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      icon TEXT,
      capabilities TEXT NOT NULL DEFAULT '{}',
      health TEXT NOT NULL DEFAULT 'ok',
      last_synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_file_sources_enabled ON file_sources(enabled);
    CREATE INDEX IF NOT EXISTS idx_file_sources_type ON file_sources(type);
    CREATE INDEX IF NOT EXISTS idx_file_sources_updated_at ON file_sources(updated_at DESC);

    CREATE TABLE IF NOT EXISTS file_index (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      path TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'one-off',
      agent TEXT NOT NULL DEFAULT 'other',
      is_recurring INTEGER NOT NULL DEFAULT 0,
      recurring_pattern TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT,
      indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      preview TEXT,
      content_hash TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_file_index_source_path ON file_index(source_id, path);
    CREATE INDEX IF NOT EXISTS idx_file_index_source ON file_index(source_id);
    CREATE INDEX IF NOT EXISTS idx_file_index_type ON file_index(type);
    CREATE INDEX IF NOT EXISTS idx_file_index_agent ON file_index(agent);
    CREATE INDEX IF NOT EXISTS idx_file_index_indexed_at ON file_index(indexed_at DESC);

    CREATE TABLE IF NOT EXISTS file_sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      error TEXT,
      files_scanned INTEGER NOT NULL DEFAULT 0,
      files_indexed INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_file_sync_runs_source ON file_sync_runs(source_id);
    CREATE INDEX IF NOT EXISTS idx_file_sync_runs_status ON file_sync_runs(status);
    CREATE INDEX IF NOT EXISTS idx_file_sync_runs_started_at ON file_sync_runs(started_at DESC);
  `);
}

function normalizeTimestamp(value: string | null | undefined): string {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function normalizeSourceType(value: string): FileSourceType {
  const normalized = value.trim().toLowerCase();
  if ((FILE_SOURCE_TYPES as readonly string[]).includes(normalized)) {
    return normalized as FileSourceType;
  }

  throw new Error(`Invalid source type: ${value}`);
}

function normalizeHealth(value: string): FileSourceHealth {
  const normalized = value.trim().toLowerCase();
  if ((FILE_SOURCE_HEALTH as readonly string[]).includes(normalized)) {
    return normalized as FileSourceHealth;
  }

  return 'ok';
}

function normalizeEnabled(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }

  return false;
}

function normalizeAuthType(value: unknown): FileSourceAuthType {
  if (typeof value !== 'string') {
    return 'none';
  }

  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'none':
    case 'bearer':
    case 'api-key':
    case 'basic':
    case 'ssh':
      return normalized;
    default:
      return 'none';
  }
}

function mapSourceRow(row: Record<string, unknown>): FileSourceRecord {
  return {
    id: String(row.id ?? ''),
    display_name: String(row.display_name ?? ''),
    type: normalizeSourceType(String(row.type ?? 'custom')),
    base_url: row.base_url === null ? null : String(row.base_url ?? ''),
    base_path: row.base_path === null ? null : String(row.base_path ?? ''),
    auth_type: normalizeAuthType(row.auth_type),
    auth_ref: row.auth_ref === null ? null : String(row.auth_ref ?? ''),
    enabled: normalizeEnabled(row.enabled),
    icon: row.icon === null ? null : String(row.icon ?? ''),
    capabilities: row.capabilities === null ? '{}' : String(row.capabilities ?? '{}'),
    health: normalizeHealth(String(row.health ?? 'ok')),
    last_synced_at: row.last_synced_at === null ? null : normalizeTimestamp(String(row.last_synced_at ?? '')),
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
    updated_at: normalizeTimestamp(String(row.updated_at ?? row.created_at ?? '')),
  };
}

export function createFileSourceRepository(): FileSourceRepository {
  const db = openEntityDatabase();

  const listStmt = db.prepare(
    'SELECT * FROM file_sources WHERE (? = 1 OR enabled = 1) ORDER BY datetime(updated_at) DESC, id DESC'
  );
  const getStmt = db.prepare('SELECT * FROM file_sources WHERE id = ?');
  const createStmt = db.prepare(`
    INSERT INTO file_sources (
      id,
      display_name,
      type,
      base_url,
      base_path,
      auth_type,
      auth_ref,
      enabled,
      icon,
      capabilities,
      health,
      last_synced_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  const deleteStmt = db.prepare('DELETE FROM file_sources WHERE id = ?');

  return {
    listSources: (includeDisabled = false) => {
      const rows = listStmt.all(includeDisabled ? 1 : 0) as Array<Record<string, unknown>>;
      return rows.map(mapSourceRow);
    },

    getSource: (id: string) => {
      const row = getStmt.get(id) as Record<string, unknown> | undefined;
      return row ? mapSourceRow(row) : undefined;
    },

    createSource: (input: CreateFileSourceInput) => {
      const displayName = input.display_name?.trim();
      if (!displayName) {
        throw new Error('display_name is required');
      }

      const id = input.id?.trim() || randomUUID();
      const sourceType = normalizeSourceType(String(input.type ?? 'custom'));

      createStmt.run(
        id,
        displayName,
        sourceType,
        input.base_url?.trim() || null,
        input.base_path?.trim() || null,
        normalizeAuthType(input.auth_type),
        input.auth_ref?.trim() || null,
        normalizeEnabled(typeof input.enabled === 'boolean' ? input.enabled : true) ? 1 : 0,
        input.icon?.trim() || null,
        input.capabilities?.trim() || '{}',
        normalizeHealth(input.health ?? 'ok'),
        input.last_synced_at ? normalizeTimestamp(input.last_synced_at) : null
      );

      const row = getStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create file source');
      }

      return mapSourceRow(row);
    },

    updateSource: (id: string, updates: UpdateFileSourceInput) => {
      const existing = getStmt.get(id) as Record<string, unknown> | undefined;
      if (!existing) {
        return undefined;
      }

      const fields: string[] = [];
      const values: unknown[] = [];

      if (typeof updates.display_name === 'string') {
        const displayName = updates.display_name.trim();
        if (!displayName) {
          throw new Error('display_name cannot be empty');
        }
        fields.push('display_name = ?');
        values.push(displayName);
      }

      if (typeof updates.type === 'string') {
        fields.push('type = ?');
        values.push(normalizeSourceType(updates.type));
      }

      if (typeof updates.base_url === 'string') {
        fields.push('base_url = ?');
        values.push(updates.base_url.trim() || null);
      }

      if (typeof updates.base_path === 'string') {
        fields.push('base_path = ?');
        values.push(updates.base_path.trim() || null);
      }

      if (typeof updates.auth_type === 'string') {
        fields.push('auth_type = ?');
        values.push(normalizeAuthType(updates.auth_type));
      }

      if (typeof updates.auth_ref === 'string') {
        fields.push('auth_ref = ?');
        values.push(updates.auth_ref.trim() || null);
      }

      if (typeof updates.enabled !== 'undefined') {
        fields.push('enabled = ?');
        values.push(normalizeEnabled(updates.enabled) ? 1 : 0);
      }

      if (typeof updates.icon === 'string') {
        fields.push('icon = ?');
        values.push(updates.icon.trim() || null);
      }

      if (typeof updates.capabilities === 'string') {
        fields.push('capabilities = ?');
        values.push(updates.capabilities.trim() || '{}');
      }

      if (typeof updates.health === 'string') {
        fields.push('health = ?');
        values.push(normalizeHealth(updates.health));
      }

      if (typeof updates.last_synced_at === 'string') {
        fields.push('last_synced_at = ?');
        values.push(updates.last_synced_at.trim() ? normalizeTimestamp(updates.last_synced_at) : null);
      }

      if (fields.length === 0) {
        return mapSourceRow(existing);
      }

      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);
      db.prepare(`UPDATE file_sources SET ${fields.join(', ')} WHERE id = ?`).run(...values);

      const row = getStmt.get(id) as Record<string, unknown> | undefined;
      return row ? mapSourceRow(row) : undefined;
    },

    setEnabled: (id: string, enabled: boolean) => {
      db.prepare('UPDATE file_sources SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        enabled ? 1 : 0,
        id
      );
      const row = getStmt.get(id) as Record<string, unknown> | undefined;
      return row ? mapSourceRow(row) : undefined;
    },

    deleteSource: (id: string) => {
      const result = deleteStmt.run(id);
      return result.changes > 0;
    },
  };
}
