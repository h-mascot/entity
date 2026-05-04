import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { getEntityDatabase } from './entity-db';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface NormalizedOffsetRange {
  start_offset: number;
  end_offset: number;
}

export interface DocumentSessionRecord {
  id: string;
  doc_id: string;
  source_id: string;
  path: string;
  content_hash: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface UpsertDocumentSessionInput {
  id?: string;
  doc_id: string;
  source_id: string;
  path: string;
  content_hash?: string | null;
  version?: number;
}

export interface DocumentAuthorshipRangeRecord {
  id: string;
  doc_id: string;
  start_offset: number;
  end_offset: number;
  author: string;
  reviewed: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpsertDocumentAuthorshipRangeInput {
  id?: string;
  doc_id: string;
  start_offset: number;
  end_offset: number;
  author: string;
  reviewed?: boolean;
}

export interface DocumentAuthorshipHistoryRecord {
  id: string;
  doc_id: string;
  range_id: string | null;
  author: string;
  diff_json: JsonValue;
  timestamp: string;
  updated_at: string;
}

export interface CreateDocumentAuthorshipHistoryInput {
  id?: string;
  doc_id: string;
  range_id?: string | null;
  author: string;
  diff_json?: JsonValue;
  timestamp?: string;
}

export const DOCUMENT_PRESENCE_STATUSES = ['active', 'idle', 'disconnected'] as const;
export type DocumentPresenceStatus = (typeof DOCUMENT_PRESENCE_STATUSES)[number];

export interface DocumentPresenceRecord {
  id: string;
  doc_id: string;
  agent_id: string;
  status: DocumentPresenceStatus;
  cursor_json: JsonValue;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
}

export interface UpsertDocumentPresenceInput {
  id?: string;
  doc_id: string;
  agent_id: string;
  status?: DocumentPresenceStatus | string;
  cursor_json?: JsonValue;
  last_activity_at?: string;
}

export interface DocumentCommentRecord {
  id: string;
  doc_id: string;
  author: string;
  start_offset: number;
  end_offset: number;
  selected_text: string | null;
  text: string;
  resolved: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateDocumentCommentInput {
  id?: string;
  doc_id: string;
  author: string;
  start_offset: number;
  end_offset: number;
  selected_text?: string | null;
  text: string;
  resolved?: boolean;
}

export interface DocumentCommentReplyRecord {
  id: string;
  doc_id: string;
  comment_id: string;
  author: string;
  text: string;
  created_at: string;
  updated_at: string;
}

export interface CreateDocumentCommentReplyInput {
  id?: string;
  doc_id: string;
  comment_id: string;
  author: string;
  text: string;
}

export const DOCUMENT_SUGGESTION_TYPES = ['insert', 'replace', 'delete'] as const;
export type DocumentSuggestionType = (typeof DOCUMENT_SUGGESTION_TYPES)[number];

export const DOCUMENT_SUGGESTION_STATUSES = ['open', 'accepted', 'rejected'] as const;
export type DocumentSuggestionStatus = (typeof DOCUMENT_SUGGESTION_STATUSES)[number];

export interface DocumentSuggestionRecord {
  id: string;
  doc_id: string;
  author: string;
  type: DocumentSuggestionType;
  start_offset: number;
  end_offset: number;
  original_text: string;
  suggested_text: string;
  reason: string | null;
  status: DocumentSuggestionStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateDocumentSuggestionInput {
  id?: string;
  doc_id: string;
  author: string;
  type: DocumentSuggestionType | string;
  start_offset: number;
  end_offset: number;
  original_text: string;
  suggested_text: string;
  reason?: string | null;
  status?: DocumentSuggestionStatus | string;
}

export const DOCUMENT_REVIEW_MODES = ['style', 'grammar', 'technical', 'security'] as const;
export type DocumentReviewMode = (typeof DOCUMENT_REVIEW_MODES)[number];

export const DOCUMENT_REVIEW_STATUSES = ['pending', 'running', 'completed', 'failed'] as const;
export type DocumentReviewStatus = (typeof DOCUMENT_REVIEW_STATUSES)[number];

export interface DocumentReviewRunRecord {
  id: string;
  doc_id: string;
  requested_by: string;
  mode: DocumentReviewMode;
  status: DocumentReviewStatus;
  result_json: JsonValue | null;
  created_at: string;
  updated_at: string;
}

export interface CreateDocumentReviewRunInput {
  id?: string;
  doc_id: string;
  requested_by: string;
  mode: DocumentReviewMode | string;
  status?: DocumentReviewStatus | string;
  result_json?: JsonValue | null;
}

export interface UpdateDocumentReviewRunInput {
  status?: DocumentReviewStatus | string;
  result_json?: JsonValue | null;
}

export interface DocumentCollaborationSnapshot {
  session: DocumentSessionRecord | undefined;
  authorship_ranges: DocumentAuthorshipRangeRecord[];
  authorship_history: DocumentAuthorshipHistoryRecord[];
  presence: DocumentPresenceRecord[];
  comments: DocumentCommentRecord[];
  comment_replies: DocumentCommentReplyRecord[];
  suggestions: DocumentSuggestionRecord[];
  review_runs: DocumentReviewRunRecord[];
}

export interface DocumentCollaborationRepository {
  getSessionByDocId: (docId: string) => DocumentSessionRecord | undefined;
  getSessionById: (sessionId: string) => DocumentSessionRecord | undefined;
  upsertSession: (input: UpsertDocumentSessionInput) => DocumentSessionRecord;
  listAuthorshipRanges: (docId: string) => DocumentAuthorshipRangeRecord[];
  upsertAuthorshipRange: (input: UpsertDocumentAuthorshipRangeInput) => DocumentAuthorshipRangeRecord;
  deleteAuthorshipRange: (docId: string, rangeId: string) => boolean;
  listAuthorshipHistory: (docId: string, limit?: number) => DocumentAuthorshipHistoryRecord[];
  createAuthorshipHistory: (input: CreateDocumentAuthorshipHistoryInput) => DocumentAuthorshipHistoryRecord;
  listPresence: (docId: string) => DocumentPresenceRecord[];
  upsertPresence: (input: UpsertDocumentPresenceInput) => DocumentPresenceRecord;
  removePresence: (docId: string, agentId: string) => boolean;
  listComments: (docId: string) => DocumentCommentRecord[];
  getComment: (docId: string, commentId: string) => DocumentCommentRecord | undefined;
  createComment: (input: CreateDocumentCommentInput) => DocumentCommentRecord;
  setCommentResolved: (docId: string, commentId: string, resolved: boolean) => DocumentCommentRecord | undefined;
  listCommentReplies: (docId: string, commentId?: string) => DocumentCommentReplyRecord[];
  createCommentReply: (input: CreateDocumentCommentReplyInput) => DocumentCommentReplyRecord;
  listSuggestions: (docId: string, status?: DocumentSuggestionStatus) => DocumentSuggestionRecord[];
  getSuggestion: (docId: string, suggestionId: string) => DocumentSuggestionRecord | undefined;
  createSuggestion: (input: CreateDocumentSuggestionInput) => DocumentSuggestionRecord;
  updateSuggestionStatus: (
    docId: string,
    suggestionId: string,
    status: DocumentSuggestionStatus
  ) => DocumentSuggestionRecord | undefined;
  listReviewRuns: (docId: string, limit?: number) => DocumentReviewRunRecord[];
  getReviewRun: (docId: string, runId: string) => DocumentReviewRunRecord | undefined;
  createReviewRun: (input: CreateDocumentReviewRunInput) => DocumentReviewRunRecord;
  updateReviewRun: (
    docId: string,
    runId: string,
    updates: UpdateDocumentReviewRunInput
  ) => DocumentReviewRunRecord | undefined;
  getCollaborationSnapshot: (docId: string) => DocumentCollaborationSnapshot;
}

function openEntityDatabase(): Database.Database {
  return getEntityDatabase(ensureCollaborationSchema);
}

function ensureCollaborationSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS document_sessions (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      path TEXT NOT NULL,
      content_hash TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_document_sessions_doc_id ON document_sessions(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_sessions_updated_at ON document_sessions(updated_at DESC);

    CREATE TABLE IF NOT EXISTS document_authorship_ranges (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      author TEXT NOT NULL,
      reviewed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_document_authorship_ranges_doc_id ON document_authorship_ranges(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_authorship_ranges_updated_at ON document_authorship_ranges(updated_at DESC);

    CREATE TABLE IF NOT EXISTS document_authorship_history (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      range_id TEXT,
      author TEXT NOT NULL,
      diff_json TEXT NOT NULL DEFAULT '{}',
      timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_document_authorship_history_doc_id ON document_authorship_history(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_authorship_history_updated_at ON document_authorship_history(updated_at DESC);

    CREATE TABLE IF NOT EXISTS document_presence (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      cursor_json TEXT NOT NULL DEFAULT '{}',
      last_activity_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_document_presence_doc_agent ON document_presence(doc_id, agent_id);
    CREATE INDEX IF NOT EXISTS idx_document_presence_doc_id ON document_presence(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_presence_updated_at ON document_presence(updated_at DESC);

    CREATE TABLE IF NOT EXISTS document_comments (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      author TEXT NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      selected_text TEXT,
      text TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_document_comments_doc_id ON document_comments(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_comments_updated_at ON document_comments(updated_at DESC);

    CREATE TABLE IF NOT EXISTS document_comment_replies (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      comment_id TEXT NOT NULL,
      author TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_document_comment_replies_doc_id ON document_comment_replies(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_comment_replies_comment_id ON document_comment_replies(comment_id);
    CREATE INDEX IF NOT EXISTS idx_document_comment_replies_updated_at ON document_comment_replies(updated_at DESC);

    CREATE TABLE IF NOT EXISTS document_suggestions (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      author TEXT NOT NULL,
      type TEXT NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      original_text TEXT NOT NULL,
      suggested_text TEXT NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_document_suggestions_doc_id ON document_suggestions(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_suggestions_updated_at ON document_suggestions(updated_at DESC);

    CREATE TABLE IF NOT EXISTS document_review_runs (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      result_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_document_review_runs_doc_id ON document_review_runs(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_review_runs_updated_at ON document_review_runs(updated_at DESC);
  `);
}

function isJsonRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toJsonValue(entry));
  }

  if (typeof value === 'object') {
    const normalized: { [key: string]: JsonValue } = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      normalized[key] = toJsonValue(entry);
    }
    return normalized;
  }

  return null;
}

function parseJson(value: unknown, fallback: JsonValue): JsonValue {
  if (typeof value === 'string') {
    try {
      return toJsonValue(JSON.parse(value) as unknown);
    } catch {
      return fallback;
    }
  }

  if (typeof value === 'undefined') {
    return fallback;
  }

  return toJsonValue(value);
}

function serializeJson(value: JsonValue): string {
  return JSON.stringify(value);
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value !== 'string') {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function normalizeBoolean(value: unknown): boolean {
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

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }

  return value;
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} is required`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }

  return trimmed;
}

function normalizeNonNegativeInteger(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const normalized = Math.floor(parsed);
  return normalized >= 0 ? normalized : fallback;
}

function clampLimit(limit: number | undefined, fallback = 100, minimum = 1, maximum = 500): number {
  if (typeof limit !== 'number' || !Number.isInteger(limit)) {
    return fallback;
  }

  if (limit < minimum) {
    return minimum;
  }

  if (limit > maximum) {
    return maximum;
  }

  return limit;
}

function normalizePresenceStatus(value: unknown): DocumentPresenceStatus {
  if (typeof value !== 'string') {
    return 'active';
  }

  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'active':
    case 'idle':
    case 'disconnected':
      return normalized;
    default:
      return 'active';
  }
}

function normalizeSuggestionType(value: unknown): DocumentSuggestionType {
  if (typeof value !== 'string') {
    return 'replace';
  }

  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'insert':
    case 'replace':
    case 'delete':
      return normalized;
    default:
      return 'replace';
  }
}

function normalizeSuggestionStatus(value: unknown): DocumentSuggestionStatus {
  if (typeof value !== 'string') {
    return 'open';
  }

  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'open':
    case 'accepted':
    case 'rejected':
      return normalized;
    default:
      return 'open';
  }
}

function normalizeReviewMode(value: unknown): DocumentReviewMode {
  if (typeof value !== 'string') {
    return 'style';
  }

  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'style':
    case 'grammar':
    case 'technical':
    case 'security':
      return normalized;
    default:
      return 'style';
  }
}

function normalizeReviewStatus(value: unknown): DocumentReviewStatus {
  if (typeof value !== 'string') {
    return 'pending';
  }

  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'pending':
    case 'running':
    case 'completed':
    case 'failed':
      return normalized;
    default:
      return 'pending';
  }
}

export function isValidOffsetRange(startOffset: number, endOffset: number): boolean {
  return Number.isInteger(startOffset) && Number.isInteger(endOffset) && startOffset >= 0 && endOffset >= startOffset;
}

export function normalizeOffsetRange(startOffset: number, endOffset: number): NormalizedOffsetRange {
  const normalizedStart = normalizeNonNegativeInteger(startOffset, 0);
  const normalizedEnd = normalizeNonNegativeInteger(endOffset, normalizedStart);
  return {
    start_offset: normalizedStart,
    end_offset: Math.max(normalizedStart, normalizedEnd),
  };
}

function mapSessionRow(row: Record<string, unknown>): DocumentSessionRecord {
  return {
    id: String(row.id ?? ''),
    doc_id: String(row.doc_id ?? ''),
    source_id: String(row.source_id ?? ''),
    path: String(row.path ?? ''),
    content_hash: row.content_hash === null ? null : String(row.content_hash ?? ''),
    version: normalizeNonNegativeInteger(row.version, 0),
    created_at: normalizeTimestamp(row.created_at),
    updated_at: normalizeTimestamp(row.updated_at),
  };
}

function mapAuthorshipRangeRow(row: Record<string, unknown>): DocumentAuthorshipRangeRecord {
  return {
    id: String(row.id ?? ''),
    doc_id: String(row.doc_id ?? ''),
    start_offset: normalizeNonNegativeInteger(row.start_offset, 0),
    end_offset: normalizeNonNegativeInteger(row.end_offset, 0),
    author: String(row.author ?? ''),
    reviewed: normalizeBoolean(row.reviewed),
    created_at: normalizeTimestamp(row.created_at),
    updated_at: normalizeTimestamp(row.updated_at),
  };
}

function mapAuthorshipHistoryRow(row: Record<string, unknown>): DocumentAuthorshipHistoryRecord {
  return {
    id: String(row.id ?? ''),
    doc_id: String(row.doc_id ?? ''),
    range_id: row.range_id === null ? null : String(row.range_id ?? ''),
    author: String(row.author ?? ''),
    diff_json: parseJson(row.diff_json, {}),
    timestamp: normalizeTimestamp(row.timestamp),
    updated_at: normalizeTimestamp(row.updated_at),
  };
}

function mapPresenceRow(row: Record<string, unknown>): DocumentPresenceRecord {
  return {
    id: String(row.id ?? ''),
    doc_id: String(row.doc_id ?? ''),
    agent_id: String(row.agent_id ?? ''),
    status: normalizePresenceStatus(row.status),
    cursor_json: parseJson(row.cursor_json, {}),
    last_activity_at: normalizeTimestamp(row.last_activity_at),
    created_at: normalizeTimestamp(row.created_at),
    updated_at: normalizeTimestamp(row.updated_at),
  };
}

function mapCommentRow(row: Record<string, unknown>): DocumentCommentRecord {
  return {
    id: String(row.id ?? ''),
    doc_id: String(row.doc_id ?? ''),
    author: String(row.author ?? ''),
    start_offset: normalizeNonNegativeInteger(row.start_offset, 0),
    end_offset: normalizeNonNegativeInteger(row.end_offset, 0),
    selected_text: row.selected_text === null ? null : String(row.selected_text ?? ''),
    text: String(row.text ?? ''),
    resolved: normalizeBoolean(row.resolved),
    created_at: normalizeTimestamp(row.created_at),
    updated_at: normalizeTimestamp(row.updated_at),
  };
}

function mapCommentReplyRow(row: Record<string, unknown>): DocumentCommentReplyRecord {
  return {
    id: String(row.id ?? ''),
    doc_id: String(row.doc_id ?? ''),
    comment_id: String(row.comment_id ?? ''),
    author: String(row.author ?? ''),
    text: String(row.text ?? ''),
    created_at: normalizeTimestamp(row.created_at),
    updated_at: normalizeTimestamp(row.updated_at),
  };
}

function mapSuggestionRow(row: Record<string, unknown>): DocumentSuggestionRecord {
  return {
    id: String(row.id ?? ''),
    doc_id: String(row.doc_id ?? ''),
    author: String(row.author ?? ''),
    type: normalizeSuggestionType(row.type),
    start_offset: normalizeNonNegativeInteger(row.start_offset, 0),
    end_offset: normalizeNonNegativeInteger(row.end_offset, 0),
    original_text: String(row.original_text ?? ''),
    suggested_text: String(row.suggested_text ?? ''),
    reason: row.reason === null ? null : String(row.reason ?? ''),
    status: normalizeSuggestionStatus(row.status),
    created_at: normalizeTimestamp(row.created_at),
    updated_at: normalizeTimestamp(row.updated_at),
  };
}

function mapReviewRunRow(row: Record<string, unknown>): DocumentReviewRunRecord {
  return {
    id: String(row.id ?? ''),
    doc_id: String(row.doc_id ?? ''),
    requested_by: String(row.requested_by ?? ''),
    mode: normalizeReviewMode(row.mode),
    status: normalizeReviewStatus(row.status),
    result_json: row.result_json === null ? null : parseJson(row.result_json, {}),
    created_at: normalizeTimestamp(row.created_at),
    updated_at: normalizeTimestamp(row.updated_at),
  };
}

function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return isJsonRecord(value);
}

export function createDocumentCollaborationRepository(): DocumentCollaborationRepository {
  const db = openEntityDatabase();

  const getSessionByDocStmt = db.prepare(`
    SELECT *
    FROM document_sessions
    WHERE doc_id = ?
    ORDER BY datetime(updated_at) DESC, id DESC
    LIMIT 1
  `);
  const getSessionByIdStmt = db.prepare('SELECT * FROM document_sessions WHERE id = ?');
  const insertSessionStmt = db.prepare(`
    INSERT INTO document_sessions (
      id,
      doc_id,
      source_id,
      path,
      content_hash,
      version,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  const updateSessionStmt = db.prepare(`
    UPDATE document_sessions
    SET
      doc_id = ?,
      source_id = ?,
      path = ?,
      content_hash = ?,
      version = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  const listAuthorshipRangesStmt = db.prepare(`
    SELECT *
    FROM document_authorship_ranges
    WHERE doc_id = ?
    ORDER BY start_offset ASC, end_offset ASC, datetime(updated_at) DESC, id DESC
  `);
  const getAuthorshipRangeStmt = db.prepare('SELECT * FROM document_authorship_ranges WHERE doc_id = ? AND id = ?');
  const upsertAuthorshipRangeStmt = db.prepare(`
    INSERT INTO document_authorship_ranges (
      id,
      doc_id,
      start_offset,
      end_offset,
      author,
      reviewed,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      doc_id = excluded.doc_id,
      start_offset = excluded.start_offset,
      end_offset = excluded.end_offset,
      author = excluded.author,
      reviewed = excluded.reviewed,
      updated_at = CURRENT_TIMESTAMP
  `);
  const deleteAuthorshipRangeStmt = db.prepare('DELETE FROM document_authorship_ranges WHERE doc_id = ? AND id = ?');

  const listAuthorshipHistoryStmt = db.prepare(`
    SELECT *
    FROM document_authorship_history
    WHERE doc_id = ?
    ORDER BY datetime(timestamp) DESC, datetime(updated_at) DESC, id DESC
    LIMIT ?
  `);
  const getAuthorshipHistoryStmt = db.prepare('SELECT * FROM document_authorship_history WHERE id = ?');
  const createAuthorshipHistoryStmt = db.prepare(`
    INSERT INTO document_authorship_history (
      id,
      doc_id,
      range_id,
      author,
      diff_json,
      timestamp,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  const listPresenceStmt = db.prepare(`
    SELECT *
    FROM document_presence
    WHERE doc_id = ?
    ORDER BY datetime(last_activity_at) DESC, datetime(updated_at) DESC, id DESC
  `);
  const getPresenceStmt = db.prepare('SELECT * FROM document_presence WHERE doc_id = ? AND agent_id = ?');
  const upsertPresenceStmt = db.prepare(`
    INSERT INTO document_presence (
      id,
      doc_id,
      agent_id,
      status,
      cursor_json,
      last_activity_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(doc_id, agent_id) DO UPDATE SET
      status = excluded.status,
      cursor_json = excluded.cursor_json,
      last_activity_at = excluded.last_activity_at,
      updated_at = CURRENT_TIMESTAMP
  `);
  const removePresenceStmt = db.prepare('DELETE FROM document_presence WHERE doc_id = ? AND agent_id = ?');

  const listCommentsStmt = db.prepare(`
    SELECT *
    FROM document_comments
    WHERE doc_id = ?
    ORDER BY datetime(created_at) ASC, id ASC
  `);
  const getCommentStmt = db.prepare('SELECT * FROM document_comments WHERE doc_id = ? AND id = ?');
  const createCommentStmt = db.prepare(`
    INSERT INTO document_comments (
      id,
      doc_id,
      author,
      start_offset,
      end_offset,
      selected_text,
      text,
      resolved,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  const setCommentResolvedStmt = db.prepare(`
    UPDATE document_comments
    SET resolved = ?, updated_at = CURRENT_TIMESTAMP
    WHERE doc_id = ? AND id = ?
  `);

  const listRepliesByDocStmt = db.prepare(`
    SELECT *
    FROM document_comment_replies
    WHERE doc_id = ?
    ORDER BY datetime(created_at) ASC, id ASC
  `);
  const listRepliesByCommentStmt = db.prepare(`
    SELECT *
    FROM document_comment_replies
    WHERE doc_id = ? AND comment_id = ?
    ORDER BY datetime(created_at) ASC, id ASC
  `);
  const getReplyStmt = db.prepare('SELECT * FROM document_comment_replies WHERE id = ?');
  const createReplyStmt = db.prepare(`
    INSERT INTO document_comment_replies (
      id,
      doc_id,
      comment_id,
      author,
      text,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);

  const listSuggestionsStmt = db.prepare(`
    SELECT *
    FROM document_suggestions
    WHERE doc_id = ? AND (? IS NULL OR status = ?)
    ORDER BY datetime(updated_at) DESC, id DESC
  `);
  const getSuggestionStmt = db.prepare('SELECT * FROM document_suggestions WHERE doc_id = ? AND id = ?');
  const createSuggestionStmt = db.prepare(`
    INSERT INTO document_suggestions (
      id,
      doc_id,
      author,
      type,
      start_offset,
      end_offset,
      original_text,
      suggested_text,
      reason,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  const updateSuggestionStatusStmt = db.prepare(`
    UPDATE document_suggestions
    SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE doc_id = ? AND id = ?
  `);

  const listReviewRunsStmt = db.prepare(`
    SELECT *
    FROM document_review_runs
    WHERE doc_id = ?
    ORDER BY datetime(updated_at) DESC, id DESC
    LIMIT ?
  `);
  const getReviewRunStmt = db.prepare('SELECT * FROM document_review_runs WHERE doc_id = ? AND id = ?');
  const createReviewRunStmt = db.prepare(`
    INSERT INTO document_review_runs (
      id,
      doc_id,
      requested_by,
      mode,
      status,
      result_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);

  return {
    getSessionByDocId: (docId: string) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const row = getSessionByDocStmt.get(normalizedDocId) as Record<string, unknown> | undefined;
      return row ? mapSessionRow(row) : undefined;
    },

    getSessionById: (sessionId: string) => {
      const normalizedSessionId = requireNonEmptyString(sessionId, 'sessionId');
      const row = getSessionByIdStmt.get(normalizedSessionId) as Record<string, unknown> | undefined;
      return row ? mapSessionRow(row) : undefined;
    },

    upsertSession: (input: UpsertDocumentSessionInput) => {
      const docId = requireNonEmptyString(input.doc_id, 'doc_id');
      const sourceId = requireNonEmptyString(input.source_id, 'source_id');
      const documentPath = requireNonEmptyString(input.path, 'path');
      const explicitId = normalizeOptionalString(input.id);
      const currentRow = explicitId
        ? (getSessionByIdStmt.get(explicitId) as Record<string, unknown> | undefined)
        : (getSessionByDocStmt.get(docId) as Record<string, unknown> | undefined);
      const current = currentRow ? mapSessionRow(currentRow) : undefined;
      const sessionId = explicitId ?? current?.id ?? randomUUID();
      const version = normalizeNonNegativeInteger(input.version, current?.version ?? 0);
      const contentHash = normalizeOptionalString(input.content_hash) ?? current?.content_hash ?? null;

      if (current) {
        updateSessionStmt.run(docId, sourceId, documentPath, contentHash, version, sessionId);
      } else {
        insertSessionStmt.run(sessionId, docId, sourceId, documentPath, contentHash, version);
      }

      const row = getSessionByIdStmt.get(sessionId) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to upsert document session');
      }

      return mapSessionRow(row);
    },

    listAuthorshipRanges: (docId: string) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const rows = listAuthorshipRangesStmt.all(normalizedDocId) as Array<Record<string, unknown>>;
      return rows.map(mapAuthorshipRangeRow);
    },

    upsertAuthorshipRange: (input: UpsertDocumentAuthorshipRangeInput) => {
      const id = normalizeOptionalString(input.id) ?? randomUUID();
      const docId = requireNonEmptyString(input.doc_id, 'doc_id');
      const author = requireNonEmptyString(input.author, 'author');
      const range = normalizeOffsetRange(input.start_offset, input.end_offset);

      upsertAuthorshipRangeStmt.run(
        id,
        docId,
        range.start_offset,
        range.end_offset,
        author,
        normalizeBoolean(input.reviewed) ? 1 : 0
      );

      const row = getAuthorshipRangeStmt.get(docId, id) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to upsert authorship range');
      }

      return mapAuthorshipRangeRow(row);
    },

    deleteAuthorshipRange: (docId: string, rangeId: string) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const normalizedRangeId = requireNonEmptyString(rangeId, 'rangeId');
      const result = deleteAuthorshipRangeStmt.run(normalizedDocId, normalizedRangeId);
      return result.changes > 0;
    },

    listAuthorshipHistory: (docId: string, limit = 100) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const safeLimit = clampLimit(limit, 100);
      const rows = listAuthorshipHistoryStmt.all(normalizedDocId, safeLimit) as Array<Record<string, unknown>>;
      return rows.map(mapAuthorshipHistoryRow);
    },

    createAuthorshipHistory: (input: CreateDocumentAuthorshipHistoryInput) => {
      const id = normalizeOptionalString(input.id) ?? randomUUID();
      const docId = requireNonEmptyString(input.doc_id, 'doc_id');
      const author = requireNonEmptyString(input.author, 'author');
      const rangeId = normalizeOptionalString(input.range_id);
      const diffJson = input.diff_json ?? {};
      const timestamp = normalizeTimestamp(input.timestamp ?? new Date().toISOString());

      createAuthorshipHistoryStmt.run(id, docId, rangeId, author, serializeJson(diffJson), timestamp);
      const row = getAuthorshipHistoryStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create authorship history');
      }

      return mapAuthorshipHistoryRow(row);
    },

    listPresence: (docId: string) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const rows = listPresenceStmt.all(normalizedDocId) as Array<Record<string, unknown>>;
      return rows.map(mapPresenceRow);
    },

    upsertPresence: (input: UpsertDocumentPresenceInput) => {
      const docId = requireNonEmptyString(input.doc_id, 'doc_id');
      const agentId = requireNonEmptyString(input.agent_id, 'agent_id');
      const id = normalizeOptionalString(input.id) ?? randomUUID();
      const status = normalizePresenceStatus(input.status ?? 'active');
      const cursor = input.cursor_json ?? {};
      const lastActivityAt = normalizeTimestamp(input.last_activity_at ?? new Date().toISOString());

      upsertPresenceStmt.run(id, docId, agentId, status, serializeJson(cursor), lastActivityAt);
      const row = getPresenceStmt.get(docId, agentId) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to upsert document presence');
      }

      return mapPresenceRow(row);
    },

    removePresence: (docId: string, agentId: string) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const normalizedAgentId = requireNonEmptyString(agentId, 'agentId');
      const result = removePresenceStmt.run(normalizedDocId, normalizedAgentId);
      return result.changes > 0;
    },

    listComments: (docId: string) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const rows = listCommentsStmt.all(normalizedDocId) as Array<Record<string, unknown>>;
      return rows.map(mapCommentRow);
    },

    getComment: (docId: string, commentId: string) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const normalizedCommentId = requireNonEmptyString(commentId, 'commentId');
      const row = getCommentStmt.get(normalizedDocId, normalizedCommentId) as Record<string, unknown> | undefined;
      return row ? mapCommentRow(row) : undefined;
    },

    createComment: (input: CreateDocumentCommentInput) => {
      const id = normalizeOptionalString(input.id) ?? randomUUID();
      const docId = requireNonEmptyString(input.doc_id, 'doc_id');
      const author = requireNonEmptyString(input.author, 'author');
      const text = requireNonEmptyString(input.text, 'text');
      const range = normalizeOffsetRange(input.start_offset, input.end_offset);
      const selectedText = input.selected_text === null ? null : normalizeOptionalString(input.selected_text);

      createCommentStmt.run(
        id,
        docId,
        author,
        range.start_offset,
        range.end_offset,
        selectedText,
        text,
        normalizeBoolean(input.resolved) ? 1 : 0
      );

      const row = getCommentStmt.get(docId, id) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create document comment');
      }

      return mapCommentRow(row);
    },

    setCommentResolved: (docId: string, commentId: string, resolved: boolean) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const normalizedCommentId = requireNonEmptyString(commentId, 'commentId');
      const result = setCommentResolvedStmt.run(resolved ? 1 : 0, normalizedDocId, normalizedCommentId);
      if (result.changes < 1) {
        return undefined;
      }

      const row = getCommentStmt.get(normalizedDocId, normalizedCommentId) as Record<string, unknown> | undefined;
      return row ? mapCommentRow(row) : undefined;
    },

    listCommentReplies: (docId: string, commentId?: string) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const normalizedCommentId = normalizeOptionalString(commentId);
      if (!normalizedCommentId) {
        const rows = listRepliesByDocStmt.all(normalizedDocId) as Array<Record<string, unknown>>;
        return rows.map(mapCommentReplyRow);
      }

      const rows = listRepliesByCommentStmt.all(normalizedDocId, normalizedCommentId) as Array<Record<string, unknown>>;
      return rows.map(mapCommentReplyRow);
    },

    createCommentReply: (input: CreateDocumentCommentReplyInput) => {
      const id = normalizeOptionalString(input.id) ?? randomUUID();
      const docId = requireNonEmptyString(input.doc_id, 'doc_id');
      const commentId = requireNonEmptyString(input.comment_id, 'comment_id');
      const author = requireNonEmptyString(input.author, 'author');
      const text = requireNonEmptyString(input.text, 'text');

      createReplyStmt.run(id, docId, commentId, author, text);
      const row = getReplyStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create document comment reply');
      }

      return mapCommentReplyRow(row);
    },

    listSuggestions: (docId: string, status?: DocumentSuggestionStatus) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const normalizedStatus = status ? normalizeSuggestionStatus(status) : null;
      const rows = listSuggestionsStmt.all(normalizedDocId, normalizedStatus, normalizedStatus) as Array<
        Record<string, unknown>
      >;
      return rows.map(mapSuggestionRow);
    },

    getSuggestion: (docId: string, suggestionId: string) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const normalizedSuggestionId = requireNonEmptyString(suggestionId, 'suggestionId');
      const row = getSuggestionStmt.get(normalizedDocId, normalizedSuggestionId) as Record<string, unknown> | undefined;
      return row ? mapSuggestionRow(row) : undefined;
    },

    createSuggestion: (input: CreateDocumentSuggestionInput) => {
      const id = normalizeOptionalString(input.id) ?? randomUUID();
      const docId = requireNonEmptyString(input.doc_id, 'doc_id');
      const author = requireNonEmptyString(input.author, 'author');
      const suggestionType = normalizeSuggestionType(input.type);
      const range = normalizeOffsetRange(input.start_offset, input.end_offset);
      const originalText = requireString(input.original_text, 'original_text');
      const suggestedText = requireString(input.suggested_text, 'suggested_text');
      const reason = input.reason === null ? null : normalizeOptionalString(input.reason);
      const status = normalizeSuggestionStatus(input.status ?? 'open');

      createSuggestionStmt.run(
        id,
        docId,
        author,
        suggestionType,
        range.start_offset,
        range.end_offset,
        originalText,
        suggestedText,
        reason,
        status
      );

      const row = getSuggestionStmt.get(docId, id) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create document suggestion');
      }

      return mapSuggestionRow(row);
    },

    updateSuggestionStatus: (docId: string, suggestionId: string, status: DocumentSuggestionStatus) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const normalizedSuggestionId = requireNonEmptyString(suggestionId, 'suggestionId');
      const normalizedStatus = normalizeSuggestionStatus(status);

      const result = updateSuggestionStatusStmt.run(normalizedStatus, normalizedDocId, normalizedSuggestionId);
      if (result.changes < 1) {
        return undefined;
      }

      const row = getSuggestionStmt.get(normalizedDocId, normalizedSuggestionId) as Record<string, unknown> | undefined;
      return row ? mapSuggestionRow(row) : undefined;
    },

    listReviewRuns: (docId: string, limit = 100) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const safeLimit = clampLimit(limit, 100);
      const rows = listReviewRunsStmt.all(normalizedDocId, safeLimit) as Array<Record<string, unknown>>;
      return rows.map(mapReviewRunRow);
    },

    getReviewRun: (docId: string, runId: string) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const normalizedRunId = requireNonEmptyString(runId, 'runId');
      const row = getReviewRunStmt.get(normalizedDocId, normalizedRunId) as Record<string, unknown> | undefined;
      return row ? mapReviewRunRow(row) : undefined;
    },

    createReviewRun: (input: CreateDocumentReviewRunInput) => {
      const id = normalizeOptionalString(input.id) ?? randomUUID();
      const docId = requireNonEmptyString(input.doc_id, 'doc_id');
      const requestedBy = requireNonEmptyString(input.requested_by, 'requested_by');
      const mode = normalizeReviewMode(input.mode);
      const status = normalizeReviewStatus(input.status ?? 'pending');
      const resultJson = input.result_json ?? null;

      createReviewRunStmt.run(id, docId, requestedBy, mode, status, resultJson === null ? null : serializeJson(resultJson));
      const row = getReviewRunStmt.get(docId, id) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create document review run');
      }

      return mapReviewRunRow(row);
    },

    updateReviewRun: (docId: string, runId: string, updates: UpdateDocumentReviewRunInput) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const normalizedRunId = requireNonEmptyString(runId, 'runId');

      const assignments: string[] = [];
      const values: unknown[] = [];
      if (typeof updates.status !== 'undefined') {
        assignments.push('status = ?');
        values.push(normalizeReviewStatus(updates.status));
      }

      if (Object.prototype.hasOwnProperty.call(updates, 'result_json')) {
        assignments.push('result_json = ?');
        values.push(updates.result_json === null || typeof updates.result_json === 'undefined' ? null : serializeJson(updates.result_json));
      }

      if (assignments.length === 0) {
        const existing = getReviewRunStmt.get(normalizedDocId, normalizedRunId) as Record<string, unknown> | undefined;
        return existing ? mapReviewRunRow(existing) : undefined;
      }

      assignments.push('updated_at = CURRENT_TIMESTAMP');
      values.push(normalizedDocId, normalizedRunId);
      const stmt = db.prepare(`UPDATE document_review_runs SET ${assignments.join(', ')} WHERE doc_id = ? AND id = ?`);
      const result = stmt.run(...values);
      if (result.changes < 1) {
        return undefined;
      }

      const row = getReviewRunStmt.get(normalizedDocId, normalizedRunId) as Record<string, unknown> | undefined;
      return row ? mapReviewRunRow(row) : undefined;
    },

    getCollaborationSnapshot: (docId: string) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      return {
        session: (() => {
          const row = getSessionByDocStmt.get(normalizedDocId) as Record<string, unknown> | undefined;
          return row ? mapSessionRow(row) : undefined;
        })(),
        authorship_ranges: (() => {
          const rows = listAuthorshipRangesStmt.all(normalizedDocId) as Array<Record<string, unknown>>;
          return rows.map(mapAuthorshipRangeRow);
        })(),
        authorship_history: (() => {
          const rows = listAuthorshipHistoryStmt.all(normalizedDocId, 200) as Array<Record<string, unknown>>;
          return rows.map(mapAuthorshipHistoryRow);
        })(),
        presence: (() => {
          const rows = listPresenceStmt.all(normalizedDocId) as Array<Record<string, unknown>>;
          return rows.map(mapPresenceRow);
        })(),
        comments: (() => {
          const rows = listCommentsStmt.all(normalizedDocId) as Array<Record<string, unknown>>;
          return rows.map(mapCommentRow);
        })(),
        comment_replies: (() => {
          const rows = listRepliesByDocStmt.all(normalizedDocId) as Array<Record<string, unknown>>;
          return rows.map(mapCommentReplyRow);
        })(),
        suggestions: (() => {
          const rows = listSuggestionsStmt.all(normalizedDocId, null, null) as Array<Record<string, unknown>>;
          return rows.map(mapSuggestionRow);
        })(),
        review_runs: (() => {
          const rows = listReviewRunsStmt.all(normalizedDocId, 200) as Array<Record<string, unknown>>;
          return rows.map(mapReviewRunRow);
        })(),
      };
    },
  };
}

export function mergeCursorPatch(cursor: JsonValue, patch: JsonValue): JsonValue {
  if (!isJsonObject(cursor) || !isJsonObject(patch)) {
    return patch;
  }

  return {
    ...cursor,
    ...patch,
  };
}
