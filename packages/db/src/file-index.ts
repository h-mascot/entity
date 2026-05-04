import Database from 'better-sqlite3';
import { getEntityDatabase } from './entity-db';

export type FileIndexOrigin = 'task' | 'cron' | 'manual' | 'unknown';

export interface FileIndexRecord {
  id: string;
  source_id: string;
  path: string;
  title: string;
  type: string;
  agent: string;
  origin: FileIndexOrigin;
  is_recurring: boolean;
  recurring_pattern: string | null;
  tags: string;
  updated_at: string | null;
  indexed_at: string;
  preview: string | null;
  content_hash: string | null;
}

export interface UpsertFileIndexInput {
  id: string;
  source_id: string;
  path: string;
  title: string;
  type: string;
  agent: string;
  origin: FileIndexOrigin;
  is_recurring: boolean;
  recurring_pattern?: string | null;
  tags?: string;
  updated_at?: string | null;
  indexed_at?: string;
  preview?: string | null;
  content_hash?: string | null;
}

export interface FileIndexSearchFilters {
  sourceId?: string;
  type?: string;
  agent?: string;
  origin?: FileIndexOrigin;
  from?: string;
  to?: string;
  limit?: number;
}

export interface FileSyncRunRecord {
  id: number;
  source_id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  files_scanned: number;
  files_indexed: number;
}

export interface FileIndexRepository {
  upsertRecord: (input: UpsertFileIndexInput) => FileIndexRecord;
  search: (query: string, filters?: FileIndexSearchFilters) => FileIndexRecord[];
  listBySource: (sourceId: string, limit?: number) => FileIndexRecord[];
  startSyncRun: (sourceId: string) => FileSyncRunRecord;
  finishSyncRun: (
    id: number,
    status: string,
    options?: { error?: string; filesScanned?: number; filesIndexed?: number }
  ) => FileSyncRunRecord;
  getLatestSyncRun: (sourceId: string) => FileSyncRunRecord | undefined;
}

function openEntityDatabase(): Database.Database {
  return getEntityDatabase(ensureSchema);
}

function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_index (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      path TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'one-off',
      agent TEXT NOT NULL DEFAULT 'other',
      origin TEXT NOT NULL DEFAULT 'unknown',
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

  try {
    db.exec(`ALTER TABLE file_index ADD COLUMN origin TEXT NOT NULL DEFAULT 'unknown'`);
  } catch {
    // SQLite does not support IF NOT EXISTS for columns.
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_file_index_origin ON file_index(origin)`);
}

function toIso(value: string | null | undefined): string {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function normalizeOrigin(value: unknown): FileIndexOrigin {
  if (typeof value !== 'string') {
    return 'unknown';
  }

  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'task':
    case 'cron':
    case 'manual':
    case 'unknown':
      return normalized;
    default:
      return 'unknown';
  }
}

function mapIndexRow(row: Record<string, unknown>): FileIndexRecord {
  return {
    id: String(row.id),
    source_id: String(row.source_id),
    path: String(row.path),
    title: String(row.title),
    type: String(row.type ?? 'one-off'),
    agent: String(row.agent ?? 'other'),
    origin: normalizeOrigin(row.origin),
    is_recurring: Number(row.is_recurring ?? 0) !== 0,
    recurring_pattern: row.recurring_pattern === null ? null : String(row.recurring_pattern ?? ''),
    tags: String(row.tags ?? '[]'),
    updated_at: row.updated_at === null ? null : toIso(String(row.updated_at ?? '')),
    indexed_at: toIso(String(row.indexed_at ?? '')),
    preview: row.preview === null ? null : String(row.preview ?? ''),
    content_hash: row.content_hash === null ? null : String(row.content_hash ?? ''),
  };
}

function mapSyncRunRow(row: Record<string, unknown>): FileSyncRunRecord {
  return {
    id: Number(row.id),
    source_id: String(row.source_id),
    status: String(row.status),
    started_at: toIso(String(row.started_at ?? '')),
    finished_at: row.finished_at === null ? null : toIso(String(row.finished_at ?? '')),
    error: row.error === null ? null : String(row.error ?? ''),
    files_scanned: Number(row.files_scanned ?? 0),
    files_indexed: Number(row.files_indexed ?? 0),
  };
}

export function createFileIndexRepository(): FileIndexRepository {
  const db = openEntityDatabase();

  const getRecordStmt = db.prepare('SELECT * FROM file_index WHERE source_id = ? AND path = ?');
  const listBySourceStmt = db.prepare('SELECT * FROM file_index WHERE source_id = ? ORDER BY indexed_at DESC LIMIT ?');
  const getSyncRunStmt = db.prepare('SELECT * FROM file_sync_runs WHERE id = ?');
  const latestSyncRunStmt = db.prepare(
    'SELECT * FROM file_sync_runs WHERE source_id = ? ORDER BY datetime(started_at) DESC, id DESC LIMIT 1'
  );

  const upsertStmt = db.prepare(`
    INSERT INTO file_index (
      id, source_id, path, title, type, agent, origin, is_recurring, recurring_pattern, tags, updated_at, indexed_at, preview, content_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id, path) DO UPDATE SET
      title = excluded.title,
      type = excluded.type,
      agent = excluded.agent,
      origin = excluded.origin,
      is_recurring = excluded.is_recurring,
      recurring_pattern = excluded.recurring_pattern,
      tags = excluded.tags,
      updated_at = excluded.updated_at,
      indexed_at = excluded.indexed_at,
      preview = excluded.preview,
      content_hash = excluded.content_hash
  `);

  const startSyncRunStmt = db.prepare(
    'INSERT INTO file_sync_runs (source_id, status, started_at, files_scanned, files_indexed) VALUES (?, ?, CURRENT_TIMESTAMP, 0, 0)'
  );

  const finishSyncRunStmt = db.prepare(`
    UPDATE file_sync_runs
    SET status = ?, finished_at = CURRENT_TIMESTAMP, error = ?, files_scanned = ?, files_indexed = ?
    WHERE id = ?
  `);

  return {
    upsertRecord: (input: UpsertFileIndexInput) => {
      upsertStmt.run(
        input.id,
        input.source_id,
        input.path,
        input.title,
        input.type,
        input.agent,
        input.origin,
        input.is_recurring ? 1 : 0,
        input.recurring_pattern ?? null,
        input.tags ?? '[]',
        input.updated_at ?? null,
        input.indexed_at ?? new Date().toISOString(),
        input.preview ?? null,
        input.content_hash ?? null
      );

      const row = getRecordStmt.get(input.source_id, input.path) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to upsert file index record.');
      }
      return mapIndexRow(row);
    },

    search: (query: string, filters: FileIndexSearchFilters = {}) => {
      const clauses: string[] = [];
      const values: unknown[] = [];

      if (query.trim()) {
        clauses.push('(LOWER(title) LIKE ? OR LOWER(path) LIKE ? OR LOWER(preview) LIKE ?)');
        const like = `%${query.trim().toLowerCase()}%`;
        values.push(like, like, like);
      }

      if (filters.sourceId) {
        clauses.push('source_id = ?');
        values.push(filters.sourceId);
      }

      if (filters.type) {
        clauses.push('type = ?');
        values.push(filters.type);
      }

      if (filters.agent) {
        clauses.push('agent = ?');
        values.push(filters.agent);
      }

      if (filters.origin) {
        clauses.push('origin = ?');
        values.push(filters.origin);
      }

      if (filters.from) {
        clauses.push('datetime(indexed_at) >= datetime(?)');
        values.push(filters.from);
      }

      if (filters.to) {
        clauses.push('datetime(indexed_at) <= datetime(?)');
        values.push(filters.to);
      }

      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const limit = Math.max(1, Math.min(filters.limit ?? 50, 200));
      values.push(limit);

      const sql = `SELECT * FROM file_index ${where} ORDER BY datetime(COALESCE(updated_at, indexed_at)) DESC, datetime(indexed_at) DESC LIMIT ?`;
      const rows = db.prepare(sql).all(...values) as Array<Record<string, unknown>>;
      return rows.map(mapIndexRow);
    },

    listBySource: (sourceId: string, limit = 100) => {
      const safeLimit = Math.max(1, Math.min(limit, 500));
      const rows = listBySourceStmt.all(sourceId, safeLimit) as Array<Record<string, unknown>>;
      return rows.map(mapIndexRow);
    },

    startSyncRun: (sourceId: string) => {
      const result = startSyncRunStmt.run(sourceId, 'running');
      const row = getSyncRunStmt.get(result.lastInsertRowid as number) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to start sync run.');
      }
      return mapSyncRunRow(row);
    },

    finishSyncRun: (id: number, status: string, options?: { error?: string; filesScanned?: number; filesIndexed?: number }) => {
      finishSyncRunStmt.run(
        status,
        options?.error?.trim() || null,
        options?.filesScanned ?? 0,
        options?.filesIndexed ?? 0,
        id
      );

      const row = getSyncRunStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to finish sync run.');
      }
      return mapSyncRunRow(row);
    },

    getLatestSyncRun: (sourceId: string) => {
      const row = latestSyncRunStmt.get(sourceId) as Record<string, unknown> | undefined;
      return row ? mapSyncRunRow(row) : undefined;
    },
  };
}
