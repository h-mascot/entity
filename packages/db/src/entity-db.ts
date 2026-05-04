import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

let cachedDb: Database.Database | null = null;
let cachedDbPath: string | null = null;

function ensureDirectory(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function resolveEntityDbPath(): string {
  const custom = process.env.ENTITY_TASK_DB_PATH;
  if (custom) {
    return path.resolve(custom);
  }

  return path.resolve(__dirname, '..', 'entity-tasks.db');
}

function configureDatabase(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
}

export function getEntityDatabase(ensureSchema?: (db: Database.Database) => void): Database.Database {
  const dbPath = resolveEntityDbPath();
  if (!cachedDb || cachedDbPath !== dbPath) {
    if (cachedDb) {
      try {
        cachedDb.close();
      } catch {
        // best-effort close before switching database path
      }
    }
    ensureDirectory(dbPath);
    cachedDb = new Database(dbPath);
    cachedDbPath = dbPath;
    configureDatabase(cachedDb);
  }

  if (ensureSchema) {
    ensureSchema(cachedDb);
  }

  return cachedDb;
}
