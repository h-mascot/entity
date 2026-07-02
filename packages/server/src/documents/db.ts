import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

let documentsDb: Database.Database | null = null;
let documentsDbPath: string | null = null;

function ensureDirectory(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function resolveDocumentsDbPath(workspaceRoot: string): string {
  const customPath = process.env.ENTITY_DOCUMENTS_DB_PATH?.trim();
  if (customPath) {
    return path.resolve(customPath);
  }

  const serverSourceDir = path.resolve(__dirname, "..");
  const candidates = [
    path.resolve(process.cwd(), "packages/db/entity-documents.db"),
    path.resolve(workspaceRoot, "packages/db/entity-documents.db"),
    path.resolve(serverSourceDir, "../../db/entity-documents.db"),
    path.resolve(serverSourceDir, "../../../db/entity-documents.db"),
  ];

  for (const candidate of candidates) {
    const directory = path.dirname(candidate);
    if (fs.existsSync(directory)) {
      return candidate;
    }
  }

  return candidates[0];
}

function configureDocumentsDb(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
}

function ensureDocumentsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS document_sessions (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL UNIQUE,
      source_id TEXT NOT NULL,
      path TEXT NOT NULL,
      content_hash TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS authorship_ranges (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      author TEXT NOT NULL CHECK(author IN ('human','assistant','unknown')),
      reviewed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS authorship_history (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      range_id TEXT,
      author TEXT NOT NULL,
      diff_json TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS document_presence (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','idle','away','offline')),
      cursor_json TEXT,
      last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(doc_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS document_comments (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      author TEXT NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      selected_text TEXT,
      text TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS document_comment_replies (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      comment_id TEXT NOT NULL REFERENCES document_comments(id),
      author TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS document_suggestions (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      author TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'replace' CHECK(type IN ('insert','replace','delete','other')),
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      original_text TEXT NOT NULL,
      suggested_text TEXT NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS document_review_runs (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'quick' CHECK(mode IN ('quick','deep','security')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed')),
      result_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS document_review_findings (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      run_id TEXT NOT NULL REFERENCES document_review_runs(id),
      type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info' CHECK(severity IN ('error','warning','info')),
      message TEXT NOT NULL,
      start_offset INTEGER,
      end_offset INTEGER,
      suggested_fix_json TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','applied','ignored')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_document_sessions_doc_id ON document_sessions(doc_id);
    CREATE INDEX IF NOT EXISTS idx_authorship_ranges_doc_id ON authorship_ranges(doc_id);
    CREATE INDEX IF NOT EXISTS idx_authorship_history_doc_id ON authorship_history(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_presence_doc_id ON document_presence(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_comments_doc_id ON document_comments(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_comment_replies_doc_id ON document_comment_replies(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_comment_replies_comment_id ON document_comment_replies(comment_id);
    CREATE INDEX IF NOT EXISTS idx_document_suggestions_doc_id ON document_suggestions(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_review_runs_doc_id ON document_review_runs(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_review_findings_doc_id ON document_review_findings(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_review_findings_run_id ON document_review_findings(run_id);
  `);
}

export function getDocumentsDatabase(workspaceRoot: string): Database.Database {
  const dbPath = resolveDocumentsDbPath(workspaceRoot);
  if (!documentsDb || documentsDbPath !== dbPath) {
    if (documentsDb) {
      try {
        documentsDb.close();
      } catch {
        // best-effort close
      }
    }

    ensureDirectory(dbPath);
    documentsDb = new Database(dbPath);
    documentsDbPath = dbPath;
    configureDocumentsDb(documentsDb);
    ensureDocumentsSchema(documentsDb);
  }

  return documentsDb;
}


export function closeDocumentsDatabase(): void {
  if (!documentsDb) {
    return;
  }

  try {
    documentsDb.close();
  } catch {
    // best-effort close
  } finally {
    documentsDb = null;
    documentsDbPath = null;
  }
}
