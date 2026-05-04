import type Database from 'better-sqlite3';

export interface StoredSetting {
  key: string;
  valueJson: string;
  updatedAt: string;
  updatedBy: string | null;
}

export function ensureAppSettingsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT
    )
  `);

  const columns = db.prepare('PRAGMA table_info(app_settings)').all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has('updated_at')) {
    db.exec("ALTER TABLE app_settings ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
  }
  if (!columnNames.has('updated_by')) {
    db.exec('ALTER TABLE app_settings ADD COLUMN updated_by TEXT');
  }
}

export function getSettingJson(db: Database.Database, key: string): unknown | null {
  ensureAppSettingsTable(db);
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(key) as { value_json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.value_json);
}

export function setSettingJson(db: Database.Database, key: string, value: unknown, updatedBy = 'system'): void {
  ensureAppSettingsTable(db);
  db.prepare(`
    INSERT INTO app_settings (key, value_json, updated_at, updated_by)
    VALUES (?, ?, datetime('now'), ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run(key, JSON.stringify(value), updatedBy);
}
