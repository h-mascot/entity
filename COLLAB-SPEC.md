# Entity Document Collaboration Backend

Build the server-side document collaboration API for Entity. The frontend client already exists at `packages/app/src/lib/documents-client.ts` and expects these endpoints.

## Database

Create a new SQLite database at `packages/db/entity-documents.db` with these tables:

### document_sessions
```sql
CREATE TABLE document_sessions (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL UNIQUE,
  source_id TEXT NOT NULL,
  path TEXT NOT NULL,
  content_hash TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### authorship_ranges
```sql
CREATE TABLE authorship_ranges (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  author TEXT NOT NULL CHECK(author IN ('human','ada','spock','scotty','geordi','zora','unknown')),
  reviewed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### authorship_history
```sql
CREATE TABLE authorship_history (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  range_id TEXT,
  author TEXT NOT NULL,
  diff_json TEXT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### document_presence
```sql
CREATE TABLE document_presence (
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
```

### document_comments
```sql
CREATE TABLE document_comments (
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
```

### document_comment_replies
```sql
CREATE TABLE document_comment_replies (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  comment_id TEXT NOT NULL REFERENCES document_comments(id),
  author TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### document_suggestions
```sql
CREATE TABLE document_suggestions (
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
```

### document_review_runs
```sql
CREATE TABLE document_review_runs (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'quick' CHECK(mode IN ('quick','deep','security')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed')),
  result_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### document_review_findings
```sql
CREATE TABLE document_review_findings (
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
```

## API Routes

Add all routes to `packages/server/src/index.ts`. Use the existing patterns (express, better-sqlite3).

### GET /api/documents
Returns API index with status and routes.

### GET /api/documents/health
Returns health check.

### GET /api/documents/:docId/state
Returns full collaboration state for a document. If no session exists, create one on first access.
The docId format is: `sourceId:path` (URL encoded).

Response must match `DocumentStateResponse`:
- docId, contentRef, sourceId, path, capabilities
- authorshipStats (computed from authorship_ranges)
- presence (from document_presence)
- commentsSummary (counts from document_comments)
- suggestionsSummary (counts from document_suggestions) 
- reviewSummary (counts + latest run from document_review_runs)
- version (from document_sessions)
- collaboration (full snapshot of all related data)

### GET /api/documents/:docId/comments
Returns comment threads with replies. Group replies under their parent comment.

### POST /api/documents/:docId/comments
Create a new comment. Body: { from, to, text, selectedText? }

### POST /api/documents/:docId/comments/:commentId/replies
Add a reply. Body: { text }

### POST /api/documents/:docId/comments/:commentId/resolve
Toggle resolve. Body: { resolved: boolean }

### GET /api/documents/:docId/suggestions
Returns all suggestions for doc.

### POST /api/documents/:docId/suggestions
Create suggestion. Body: { from, to, originalText, suggestedText, type?, reason? }

### POST /api/documents/:docId/suggestions/:suggestionId/accept
Mark as accepted.

### POST /api/documents/:docId/suggestions/:suggestionId/reject
Mark as rejected.

### POST /api/documents/:docId/reviews
Start a review run. Body: { mode }
Set status to 'completed' immediately (actual AI review can come later).

### GET /api/documents/:docId/reviews/:runId
Get review run with findings.

### POST /api/documents/:docId/reviews/:runId/findings/:findingId/apply
Mark finding as applied.

### POST /api/documents/:docId/reviews/:runId/findings/:findingId/ignore
Mark finding as ignored.

### POST /api/documents/:docId/edit
Apply edit. Body: { from, to, insert, attribution?, clientVersion? }
Update session version, create authorship history entry.

### POST /api/documents/:docId/authorship
Set authorship range. Body: { from, to, author }

### POST /api/documents/:docId/cursor
Update cursor presence. Body: { cursor?, position?, selection?, action?, status? }

## Implementation Notes

- Use `crypto.randomUUID()` for all IDs
- Parse docId as `sourceId:path` where sourceId defaults to 'default' if no colon
- The `capabilities` object should return all true for now
- Default author for comments/suggestions is 'human' (can be set via X-Entity-Actor header)
- For review runs, just set status='completed' immediately with empty findings (no AI integration yet)
- Database file location: use the same `packages/db/` directory as entity-tasks.db
- Import better-sqlite3 the same way the existing task DB does
- Initialize tables on server start (CREATE TABLE IF NOT EXISTS)

## DO NOT:
- Modify any frontend files
- Change existing routes
- Add npm dependencies
- Break existing functionality

## After changes:
npx tsc --noEmit -p packages/server/tsconfig.json && npm --prefix packages/app run build
