import { buildApiCandidates, requestJsonWithFallback } from './http';
import { isOfflineQueuedResponsePayload, readCachedApiPayload } from './offline';
import {
  AUTHORSHIP_ACTORS,
  DOCUMENT_PRESENCE_STATUSES,
  DOCUMENT_REVIEW_MODES,
  DOCUMENT_REVIEW_STATUSES,
  DOCUMENT_SUGGESTION_STATUSES,
  DOCUMENT_SUGGESTION_TYPES,
  type DocumentApiIndexResponse,
  type DocumentAuthorshipAuthorStats,
  type DocumentAuthorshipRequest,
  type DocumentAuthorshipResponse,
  type DocumentAuthorshipStats,
  type DocumentAuthorshipHistoryRecord,
  type DocumentAuthorshipRangeRecord,
  type DocumentCommentRecord,
  type DocumentCommentReplyRecord,
  type DocumentCommentsResponse,
  type DocumentCollaborationSnapshot,
  type DocumentContentRef,
  type DocumentCursorPresenceRequest,
  type DocumentCursorPresenceResponse,
  type DocumentEditRequest,
  type DocumentEditResponse,
  type DocumentHealthResponse,
  type DocumentPresenceRecord,
  type DocumentPresenceStatus,
  type DocumentReviewFinding,
  type DocumentReviewRunRecord,
  type DocumentReviewRunResponse,
  type DocumentReviewStatus,
  type DocumentReviewSummary,
  type DocumentRoutesResponse,
  type DocumentSessionRecord,
  type DocumentStateResponse,
  type DocumentSuggestionRecord,
  type DocumentSuggestionStatus,
  type DocumentSuggestionType,
  type DocumentSuggestionsResponse,
  type DocumentSuggestionsSummary,
  type JsonValue,
  type SourceCapability,
} from '../types/collaboration';

type UnknownRecord = Record<string, unknown>;

const AUTHORSHIP_ACTOR_SET = new Set<string>(AUTHORSHIP_ACTORS);
const PRESENCE_STATUS_SET = new Set<string>(DOCUMENT_PRESENCE_STATUSES);
const SUGGESTION_TYPE_SET = new Set<string>(DOCUMENT_SUGGESTION_TYPES);
const SUGGESTION_STATUS_SET = new Set<string>(DOCUMENT_SUGGESTION_STATUSES);
const REVIEW_MODE_SET = new Set<string>(DOCUMENT_REVIEW_MODES);
const REVIEW_STATUS_SET = new Set<string>(DOCUMENT_REVIEW_STATUSES);

export type DocumentsClientAuth =
  | {
      kind: 'bearer';
      token: string;
    }
  | {
      kind: 'service';
      token: string;
      actorId: string;
    };

export interface DocumentsRequestOptions {
  auth?: DocumentsClientAuth;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface DocumentsClientOptions {
  apiBase?: string;
  auth?: DocumentsClientAuth;
}

export interface DocumentsApiClient {
  getIndex: (options?: DocumentsRequestOptions) => Promise<DocumentApiIndexResponse>;
  getHealth: (options?: DocumentsRequestOptions) => Promise<DocumentHealthResponse>;
  getState: (docId: string, options?: DocumentsRequestOptions) => Promise<DocumentStateResponse>;
  getComments: (docId: string, options?: DocumentsRequestOptions) => Promise<DocumentCommentsResponse>;
  postComment: (
    docId: string,
    input: { from: number; to: number; text: string; selectedText?: string | null },
    options?: DocumentsRequestOptions
  ) => Promise<DocumentCommentsResponse>;
  postCommentReply: (
    docId: string,
    commentId: string,
    input: { text: string },
    options?: DocumentsRequestOptions
  ) => Promise<DocumentCommentsResponse>;
  postCommentResolve: (
    docId: string,
    commentId: string,
    input: { resolved: boolean },
    options?: DocumentsRequestOptions
  ) => Promise<DocumentCommentsResponse>;
  getSuggestions: (docId: string, options?: DocumentsRequestOptions) => Promise<DocumentSuggestionsResponse>;
  postSuggestion: (
    docId: string,
    input: { from: number; to: number; originalText: string; suggestedText: string; type?: string; reason?: string | null },
    options?: DocumentsRequestOptions
  ) => Promise<DocumentSuggestionsResponse>;
  acceptSuggestion: (docId: string, suggestionId: string, options?: DocumentsRequestOptions) => Promise<DocumentSuggestionsResponse>;
  rejectSuggestion: (docId: string, suggestionId: string, options?: DocumentsRequestOptions) => Promise<DocumentSuggestionsResponse>;
  postReview: (docId: string, input: { mode: string }, options?: DocumentsRequestOptions) => Promise<DocumentReviewRunResponse>;
  getReview: (docId: string, runId: string, options?: DocumentsRequestOptions) => Promise<DocumentReviewRunResponse>;
  applyReviewFinding: (
    docId: string,
    runId: string,
    findingId: string,
    options?: DocumentsRequestOptions
  ) => Promise<DocumentReviewRunResponse>;
  ignoreReviewFinding: (
    docId: string,
    runId: string,
    findingId: string,
    options?: DocumentsRequestOptions
  ) => Promise<DocumentReviewRunResponse>;
  postEdit: (docId: string, input: DocumentEditRequest, options?: DocumentsRequestOptions) => Promise<DocumentEditResponse>;
  postAuthorship: (
    docId: string,
    input: DocumentAuthorshipRequest,
    options?: DocumentsRequestOptions
  ) => Promise<DocumentAuthorshipResponse>;
  postCursor: (
    docId: string,
    input: DocumentCursorPresenceRequest,
    options?: DocumentsRequestOptions
  ) => Promise<DocumentCursorPresenceResponse>;
}

function toRecord(value: unknown, context: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object.`);
  }

  return value as UnknownRecord;
}

function toString(value: unknown, context: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${context} must be a string.`);
  }

  return value;
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }

  if (typeof value === 'string') {
    return value;
  }

  throw new Error('Expected optional string field to be a string when present.');
}

function toNullableString(value: unknown, context: string): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  throw new Error(`${context} must be a string or null.`);
}

function toNumber(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${context} must be a finite number.`);
  }

  return value;
}

function toBoolean(value: unknown, context: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${context} must be a boolean.`);
  }

  return value;
}

function toArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array.`);
  }

  return value;
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
    const objectValue = value as Record<string, unknown>;
    const normalized: { [key: string]: JsonValue } = {};
    for (const [key, entry] of Object.entries(objectValue)) {
      normalized[key] = toJsonValue(entry);
    }
    return normalized;
  }

  return null;
}

function toNonEmptyTrimmedString(value: string, context: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${context} cannot be empty.`);
  }

  return normalized;
}

function toDocIdPath(docId: string, operation: string): string {
  return `/documents/${encodeURIComponent(toNonEmptyTrimmedString(docId, 'docId'))}${operation}`;
}

function buildDocumentUrls(path: string, apiBase = ''): string[] {
  return buildApiCandidates(path, apiBase);
}

function mapAuthorshipActor(value: unknown, context: string): string {
  const normalized = toString(value, context).trim().toLowerCase();
  if (!AUTHORSHIP_ACTOR_SET.has(normalized)) {
    throw new Error(`${context} must be one of: ${AUTHORSHIP_ACTORS.join(', ')}.`);
  }

  return normalized;
}

function mapPresenceStatus(value: unknown, context: string): DocumentPresenceStatus {
  const normalized = toString(value, context).trim().toLowerCase();
  if (!PRESENCE_STATUS_SET.has(normalized)) {
    throw new Error(`${context} must be one of: ${DOCUMENT_PRESENCE_STATUSES.join(', ')}.`);
  }

  return normalized as DocumentPresenceStatus;
}

function mapSuggestionType(value: unknown, context: string): DocumentSuggestionType {
  const normalized = toString(value, context).trim().toLowerCase();
  if (!SUGGESTION_TYPE_SET.has(normalized)) {
    throw new Error(`${context} must be one of: ${DOCUMENT_SUGGESTION_TYPES.join(', ')}.`);
  }

  return normalized as DocumentSuggestionType;
}

function mapSuggestionStatus(value: unknown, context: string): DocumentSuggestionStatus {
  const normalized = toString(value, context).trim().toLowerCase();
  if (!SUGGESTION_STATUS_SET.has(normalized)) {
    throw new Error(`${context} must be one of: ${DOCUMENT_SUGGESTION_STATUSES.join(', ')}.`);
  }

  return normalized as DocumentSuggestionStatus;
}

function mapReviewStatus(value: unknown, context: string): DocumentReviewStatus {
  const normalized = toString(value, context).trim().toLowerCase();
  if (!REVIEW_STATUS_SET.has(normalized)) {
    throw new Error(`${context} must be one of: ${DOCUMENT_REVIEW_STATUSES.join(', ')}.`);
  }

  return normalized as DocumentReviewStatus;
}

function mapSourceCapability(value: unknown, context: string): SourceCapability {
  const record = toRecord(value, context);
  return {
    read: toBoolean(record.read, `${context}.read`),
    write: toBoolean(record.write, `${context}.write`),
    rename: toBoolean(record.rename, `${context}.rename`),
    delete: toBoolean(record.delete, `${context}.delete`),
    list: toBoolean(record.list, `${context}.list`),
    search: toBoolean(record.search, `${context}.search`),
  };
}

function mapContentRef(value: unknown, context: string): DocumentContentRef {
  const record = toRecord(value, context);
  return {
    docId: toString(record.docId, `${context}.docId`),
    sourceId: toNullableString(record.sourceId, `${context}.sourceId`),
    path: toNullableString(record.path, `${context}.path`),
    contentHash: toNullableString(record.contentHash, `${context}.contentHash`),
  };
}

function mapSessionRecord(value: unknown, context: string): DocumentSessionRecord {
  const record = toRecord(value, context);
  return {
    id: toString(record.id, `${context}.id`),
    doc_id: toString(record.doc_id, `${context}.doc_id`),
    source_id: toString(record.source_id, `${context}.source_id`),
    path: toString(record.path, `${context}.path`),
    content_hash: toNullableString(record.content_hash, `${context}.content_hash`),
    version: toNumber(record.version, `${context}.version`),
    created_at: toString(record.created_at, `${context}.created_at`),
    updated_at: toString(record.updated_at, `${context}.updated_at`),
  };
}

function mapAuthorshipRangeRecord(value: unknown, context: string): DocumentAuthorshipRangeRecord {
  const record = toRecord(value, context);
  return {
    id: toString(record.id, `${context}.id`),
    doc_id: toString(record.doc_id, `${context}.doc_id`),
    start_offset: toNumber(record.start_offset, `${context}.start_offset`),
    end_offset: toNumber(record.end_offset, `${context}.end_offset`),
    author: mapAuthorshipActor(record.author, `${context}.author`),
    reviewed: toBoolean(record.reviewed, `${context}.reviewed`),
    created_at: toString(record.created_at, `${context}.created_at`),
    updated_at: toString(record.updated_at, `${context}.updated_at`),
  };
}

function mapAuthorshipHistoryRecord(value: unknown, context: string): DocumentAuthorshipHistoryRecord {
  const record = toRecord(value, context);
  return {
    id: toString(record.id, `${context}.id`),
    doc_id: toString(record.doc_id, `${context}.doc_id`),
    range_id: toNullableString(record.range_id, `${context}.range_id`),
    author: toString(record.author, `${context}.author`),
    diff_json: toJsonValue(record.diff_json),
    timestamp: toString(record.timestamp, `${context}.timestamp`),
    updated_at: toString(record.updated_at, `${context}.updated_at`),
  };
}

function mapPresenceRecord(value: unknown, context: string): DocumentPresenceRecord {
  const record = toRecord(value, context);
  return {
    id: toString(record.id, `${context}.id`),
    doc_id: toString(record.doc_id, `${context}.doc_id`),
    agent_id: toString(record.agent_id, `${context}.agent_id`),
    status: mapPresenceStatus(record.status, `${context}.status`),
    cursor_json: toJsonValue(record.cursor_json),
    last_activity_at: toString(record.last_activity_at, `${context}.last_activity_at`),
    created_at: toString(record.created_at, `${context}.created_at`),
    updated_at: toString(record.updated_at, `${context}.updated_at`),
  };
}

function mapCommentRecord(value: unknown, context: string): DocumentCommentRecord {
  const record = toRecord(value, context);
  return {
    id: toString(record.id, `${context}.id`),
    doc_id: toString(record.doc_id, `${context}.doc_id`),
    author: toString(record.author, `${context}.author`),
    start_offset: toNumber(record.start_offset, `${context}.start_offset`),
    end_offset: toNumber(record.end_offset, `${context}.end_offset`),
    selected_text: toNullableString(record.selected_text, `${context}.selected_text`),
    text: toString(record.text, `${context}.text`),
    resolved: toBoolean(record.resolved, `${context}.resolved`),
    created_at: toString(record.created_at, `${context}.created_at`),
    updated_at: toString(record.updated_at, `${context}.updated_at`),
  };
}

function mapCommentReplyRecord(value: unknown, context: string): DocumentCommentReplyRecord {
  const record = toRecord(value, context);
  return {
    id: toString(record.id, `${context}.id`),
    doc_id: toString(record.doc_id, `${context}.doc_id`),
    comment_id: toString(record.comment_id, `${context}.comment_id`),
    author: toString(record.author, `${context}.author`),
    text: toString(record.text, `${context}.text`),
    created_at: toString(record.created_at, `${context}.created_at`),
    updated_at: toString(record.updated_at, `${context}.updated_at`),
  };
}

function mapSuggestionRecord(value: unknown, context: string): DocumentSuggestionRecord {
  const record = toRecord(value, context);
  return {
    id: toString(record.id, `${context}.id`),
    doc_id: toString(record.doc_id, `${context}.doc_id`),
    author: toString(record.author, `${context}.author`),
    type: mapSuggestionType(record.type, `${context}.type`),
    start_offset: toNumber(record.start_offset, `${context}.start_offset`),
    end_offset: toNumber(record.end_offset, `${context}.end_offset`),
    original_text: toString(record.original_text, `${context}.original_text`),
    suggested_text: toString(record.suggested_text, `${context}.suggested_text`),
    reason: toNullableString(record.reason, `${context}.reason`),
    status: mapSuggestionStatus(record.status, `${context}.status`),
    created_at: toString(record.created_at, `${context}.created_at`),
    updated_at: toString(record.updated_at, `${context}.updated_at`),
  };
}

function mapReviewRunRecord(value: unknown, context: string): DocumentReviewRunRecord {
  const record = toRecord(value, context);
  const normalizedMode = toString(record.mode, `${context}.mode`).trim().toLowerCase();
  if (!REVIEW_MODE_SET.has(normalizedMode)) {
    throw new Error(`${context}.mode must be one of: ${DOCUMENT_REVIEW_MODES.join(', ')}.`);
  }

  const resultJson = record.result_json;
  return {
    id: toString(record.id, `${context}.id`),
    doc_id: toString(record.doc_id, `${context}.doc_id`),
    requested_by: toString(record.requested_by, `${context}.requested_by`),
    mode: normalizedMode as DocumentReviewRunRecord['mode'],
    status: mapReviewStatus(record.status, `${context}.status`),
    result_json: resultJson === null ? null : toJsonValue(resultJson),
    created_at: toString(record.created_at, `${context}.created_at`),
    updated_at: toString(record.updated_at, `${context}.updated_at`),
  };
}

function mapCollaborationSnapshot(value: unknown, context: string): DocumentCollaborationSnapshot {
  const record = toRecord(value, context);
  const sessionValue = record.session;
  const authorshipRanges = toArray(record.authorship_ranges, `${context}.authorship_ranges`);
  const authorshipHistory = toArray(record.authorship_history, `${context}.authorship_history`);
  const presence = toArray(record.presence, `${context}.presence`);
  const comments = toArray(record.comments, `${context}.comments`);
  const commentReplies = toArray(record.comment_replies, `${context}.comment_replies`);
  const suggestions = toArray(record.suggestions, `${context}.suggestions`);
  const reviewRuns = toArray(record.review_runs, `${context}.review_runs`);

  return {
    session:
      typeof sessionValue === 'undefined' || sessionValue === null
        ? undefined
        : mapSessionRecord(sessionValue, `${context}.session`),
    authorship_ranges: authorshipRanges.map((entry, index) =>
      mapAuthorshipRangeRecord(entry, `${context}.authorship_ranges[${index}]`)
    ),
    authorship_history: authorshipHistory.map((entry, index) =>
      mapAuthorshipHistoryRecord(entry, `${context}.authorship_history[${index}]`)
    ),
    presence: presence.map((entry, index) => mapPresenceRecord(entry, `${context}.presence[${index}]`)),
    comments: comments.map((entry, index) => mapCommentRecord(entry, `${context}.comments[${index}]`)),
    comment_replies: commentReplies.map((entry, index) =>
      mapCommentReplyRecord(entry, `${context}.comment_replies[${index}]`)
    ),
    suggestions: suggestions.map((entry, index) => mapSuggestionRecord(entry, `${context}.suggestions[${index}]`)),
    review_runs: reviewRuns.map((entry, index) => mapReviewRunRecord(entry, `${context}.review_runs[${index}]`)),
  };
}

function mapAuthorshipAuthorStats(value: unknown, context: string): DocumentAuthorshipAuthorStats {
  const record = toRecord(value, context);
  return {
    ranges: toNumber(record.ranges, `${context}.ranges`),
    reviewedRanges: toNumber(record.reviewedRanges, `${context}.reviewedRanges`),
    coveredCharacters: toNumber(record.coveredCharacters, `${context}.coveredCharacters`),
  };
}

function mapAuthorshipStats(value: unknown, context: string): DocumentAuthorshipStats {
  const record = toRecord(value, context);
  const byAuthorRecord = toRecord(record.byAuthor, `${context}.byAuthor`);
  const byAuthor: Record<string, DocumentAuthorshipAuthorStats> = {};

  for (const [author, stats] of Object.entries(byAuthorRecord)) {
    byAuthor[author] = mapAuthorshipAuthorStats(stats, `${context}.byAuthor.${author}`);
  }

  return {
    totalRanges: toNumber(record.totalRanges, `${context}.totalRanges`),
    reviewedRanges: toNumber(record.reviewedRanges, `${context}.reviewedRanges`),
    reviewedPercent: toNumber(record.reviewedPercent, `${context}.reviewedPercent`),
    coveredCharacters: toNumber(record.coveredCharacters, `${context}.coveredCharacters`),
    human: toNumber(record.human, `${context}.human`),
    ada: toNumber(record.ada, `${context}.ada`),
    spock: toNumber(record.spock, `${context}.spock`),
    scotty: toNumber(record.scotty, `${context}.scotty`),
    byAuthor,
  };
}

function mapCommentsSummary(value: unknown, context: string): DocumentStateResponse['commentsSummary'] {
  const record = toRecord(value, context);
  return {
    total: toNumber(record.total, `${context}.total`),
    resolved: toNumber(record.resolved, `${context}.resolved`),
    open: toNumber(record.open, `${context}.open`),
    replies: toNumber(record.replies, `${context}.replies`),
  };
}

function mapSuggestionsSummary(value: unknown, context: string): DocumentSuggestionsSummary {
  const record = toRecord(value, context);
  const byType = toRecord(record.byType, `${context}.byType`);
  return {
    total: toNumber(record.total, `${context}.total`),
    open: toNumber(record.open, `${context}.open`),
    accepted: toNumber(record.accepted, `${context}.accepted`),
    rejected: toNumber(record.rejected, `${context}.rejected`),
    byType: {
      insert: toNumber(byType.insert, `${context}.byType.insert`),
      replace: toNumber(byType.replace, `${context}.byType.replace`),
      delete: toNumber(byType.delete, `${context}.byType.delete`),
      other: toNumber(byType.other, `${context}.byType.other`),
    },
  };
}

function mapReviewSummary(value: unknown, context: string): DocumentReviewSummary {
  const record = toRecord(value, context);
  return {
    total: toNumber(record.total, `${context}.total`),
    pending: toNumber(record.pending, `${context}.pending`),
    running: toNumber(record.running, `${context}.running`),
    completed: toNumber(record.completed, `${context}.completed`),
    failed: toNumber(record.failed, `${context}.failed`),
    latestRun: record.latestRun === null ? null : mapReviewRunRecord(record.latestRun, `${context}.latestRun`),
  };
}

function mapDocumentStateResponse(value: unknown): DocumentStateResponse {
  const record = toRecord(value, 'DocumentStateResponse');
  const presence = toArray(record.presence, 'DocumentStateResponse.presence');

  return {
    docId: toString(record.docId, 'DocumentStateResponse.docId'),
    contentRef: mapContentRef(record.contentRef, 'DocumentStateResponse.contentRef'),
    sourceId: toNullableString(record.sourceId, 'DocumentStateResponse.sourceId'),
    path: toNullableString(record.path, 'DocumentStateResponse.path'),
    capabilities: mapSourceCapability(record.capabilities, 'DocumentStateResponse.capabilities'),
    authorshipStats: mapAuthorshipStats(record.authorshipStats, 'DocumentStateResponse.authorshipStats'),
    presence: presence.map((entry, index) => mapPresenceRecord(entry, `DocumentStateResponse.presence[${index}]`)),
    commentsSummary: mapCommentsSummary(record.commentsSummary, 'DocumentStateResponse.commentsSummary'),
    suggestionsSummary: mapSuggestionsSummary(record.suggestionsSummary, 'DocumentStateResponse.suggestionsSummary'),
    reviewSummary: mapReviewSummary(record.reviewSummary, 'DocumentStateResponse.reviewSummary'),
    version: toNumber(record.version, 'DocumentStateResponse.version'),
    collaboration: mapCollaborationSnapshot(record.collaboration, 'DocumentStateResponse.collaboration'),
  };
}

function mapDocumentEditResponse(value: unknown): DocumentEditResponse {
  const record = toRecord(value, 'DocumentEditResponse');
  return {
    docId: toString(record.docId, 'DocumentEditResponse.docId'),
    actorId: toString(record.actorId, 'DocumentEditResponse.actorId'),
    attribution: toString(record.attribution, 'DocumentEditResponse.attribution'),
    sourceId: toString(record.sourceId, 'DocumentEditResponse.sourceId'),
    path: toString(record.path, 'DocumentEditResponse.path'),
    from: toNumber(record.from, 'DocumentEditResponse.from'),
    to: toNumber(record.to, 'DocumentEditResponse.to'),
    insert: toString(record.insert, 'DocumentEditResponse.insert'),
    previousVersion: toNumber(record.previousVersion, 'DocumentEditResponse.previousVersion'),
    version: toNumber(record.version, 'DocumentEditResponse.version'),
    contentHash: toString(record.contentHash, 'DocumentEditResponse.contentHash'),
    contentLength: toNumber(record.contentLength, 'DocumentEditResponse.contentLength'),
    updatedAt: toNullableString(record.updatedAt, 'DocumentEditResponse.updatedAt'),
  };
}

function mapDocumentAuthorshipResponse(value: unknown): DocumentAuthorshipResponse {
  const record = toRecord(value, 'DocumentAuthorshipResponse');
  return {
    docId: toString(record.docId, 'DocumentAuthorshipResponse.docId'),
    actorId: toString(record.actorId, 'DocumentAuthorshipResponse.actorId'),
    from: toNumber(record.from, 'DocumentAuthorshipResponse.from'),
    to: toNumber(record.to, 'DocumentAuthorshipResponse.to'),
    author: mapAuthorshipActor(record.author, 'DocumentAuthorshipResponse.author') as DocumentAuthorshipResponse['author'],
    toggledOff: toBoolean(record.toggledOff, 'DocumentAuthorshipResponse.toggledOff'),
    range: record.range === null ? null : mapAuthorshipRangeRecord(record.range, 'DocumentAuthorshipResponse.range'),
    authorshipStats: mapAuthorshipStats(record.authorshipStats, 'DocumentAuthorshipResponse.authorshipStats'),
    collaboration: mapCollaborationSnapshot(record.collaboration, 'DocumentAuthorshipResponse.collaboration'),
  };
}

function mapDocumentCursorPresenceResponse(value: unknown): DocumentCursorPresenceResponse {
  const record = toRecord(value, 'DocumentCursorPresenceResponse');
  return {
    docId: toString(record.docId, 'DocumentCursorPresenceResponse.docId'),
    actor: toString(record.actor, 'DocumentCursorPresenceResponse.actor'),
    status: mapPresenceStatus(record.status, 'DocumentCursorPresenceResponse.status'),
    heartbeatAt: toString(record.heartbeatAt, 'DocumentCursorPresenceResponse.heartbeatAt'),
    presence: mapPresenceRecord(record.presence, 'DocumentCursorPresenceResponse.presence'),
  };
}

function mapDocumentCommentRange(value: unknown, context: string): { from: number; to: number } {
  const record = toRecord(value, context);
  return {
    from: toNumber(record.from, `${context}.from`),
    to: toNumber(record.to, `${context}.to`),
  };
}

function mapDocumentCommentReply(
  value: unknown,
  context: string
): DocumentCommentsResponse['threads'][number]['replies'][number] {
  const record = toRecord(value, context);
  return {
    id: toString(record.id, `${context}.id`),
    author: toString(record.author, `${context}.author`),
    text: toString(record.text, `${context}.text`),
    createdAt: toString(record.createdAt, `${context}.createdAt`),
  };
}

function mapDocumentCommentThread(value: unknown, context: string): DocumentCommentsResponse['threads'][number] {
  const record = toRecord(value, context);
  const replies = toArray(record.replies, `${context}.replies`);
  return {
    id: toString(record.id, `${context}.id`),
    range: mapDocumentCommentRange(record.range, `${context}.range`),
    text: toString(record.text, `${context}.text`),
    author: toString(record.author, `${context}.author`),
    createdAt: toString(record.createdAt, `${context}.createdAt`),
    selectedText: record.selectedText === null ? null : toString(record.selectedText, `${context}.selectedText`),
    resolved: toBoolean(record.resolved, `${context}.resolved`),
    replies: replies.map((entry, index) => mapDocumentCommentReply(entry, `${context}.replies[${index}]`)),
  };
}

function mapDocumentCommentsResponse(value: unknown): DocumentCommentsResponse {
  const record = toRecord(value, 'DocumentCommentsResponse');
  const threads = toArray(record.threads, 'DocumentCommentsResponse.threads');
  return {
    docId: toString(record.docId, 'DocumentCommentsResponse.docId'),
    threads: threads.map((entry, index) => mapDocumentCommentThread(entry, `DocumentCommentsResponse.threads[${index}]`)),
  };
}

function mapSuggestionUiStatus(
  value: unknown,
  context: string
): DocumentSuggestionsResponse['suggestions'][number]['status'] {
  const normalized = toString(value, context).trim().toLowerCase();
  if (normalized !== 'pending' && normalized !== 'accepted' && normalized !== 'rejected') {
    throw new Error(`${context} must be pending, accepted, or rejected.`);
  }
  return normalized as DocumentSuggestionsResponse['suggestions'][number]['status'];
}

function mapSuggestionUiRecord(value: unknown, context: string): DocumentSuggestionsResponse['suggestions'][number] {
  const record = toRecord(value, context);
  return {
    id: toString(record.id, `${context}.id`),
    range: mapDocumentCommentRange(record.range, `${context}.range`),
    originalText: toString(record.originalText, `${context}.originalText`),
    suggestedText: toString(record.suggestedText, `${context}.suggestedText`),
    author: toString(record.author, `${context}.author`),
    status: mapSuggestionUiStatus(record.status, `${context}.status`),
    type: mapSuggestionType(record.type, `${context}.type`),
    createdAt: toString(record.createdAt, `${context}.createdAt`),
    updatedAt: toString(record.updatedAt, `${context}.updatedAt`),
    reason: record.reason === null ? null : toString(record.reason, `${context}.reason`),
  };
}

function mapDocumentSuggestionsResponse(value: unknown): DocumentSuggestionsResponse {
  const record = toRecord(value, 'DocumentSuggestionsResponse');
  const suggestions = toArray(record.suggestions, 'DocumentSuggestionsResponse.suggestions');
  return {
    docId: toString(record.docId, 'DocumentSuggestionsResponse.docId'),
    suggestions: suggestions.map((entry, index) =>
      mapSuggestionUiRecord(entry, `DocumentSuggestionsResponse.suggestions[${index}]`)
    ),
  };
}

function mapReviewFinding(value: unknown, context: string): DocumentReviewFinding {
  const record = toRecord(value, context);
  const range = record.range === null ? null : mapDocumentCommentRange(record.range, `${context}.range`);
  const suggestedFixCandidate = record.suggestedFix;
  let suggestedFix: DocumentReviewFinding['suggestedFix'] = null;
  if (suggestedFixCandidate && typeof suggestedFixCandidate === 'object' && !Array.isArray(suggestedFixCandidate)) {
    const sf = suggestedFixCandidate as UnknownRecord;
    suggestedFix = { replacement: toString(sf.replacement, `${context}.suggestedFix.replacement`) };
  }

  const statusCandidate = toOptionalString(record.status);
  const status =
    statusCandidate === 'applied' || statusCandidate === 'ignored' || statusCandidate === 'open' ? statusCandidate : undefined;

  return {
    id: toString(record.id, `${context}.id`),
    type: toString(record.type, `${context}.type`),
    severity: (() => {
      const normalized = toString(record.severity, `${context}.severity`).trim().toLowerCase();
      if (normalized !== 'error' && normalized !== 'warning' && normalized !== 'info') {
        throw new Error(`${context}.severity must be error, warning, or info.`);
      }
      return normalized as DocumentReviewFinding['severity'];
    })(),
    message: toString(record.message, `${context}.message`),
    range,
    suggestedFix,
    status: status as DocumentReviewFinding['status'],
  };
}

function mapDocumentReviewRunResponse(value: unknown): DocumentReviewRunResponse {
  const record = toRecord(value, 'DocumentReviewRunResponse');
  const findings = toArray(record.findings, 'DocumentReviewRunResponse.findings');
  return {
    docId: toString(record.docId, 'DocumentReviewRunResponse.docId'),
    run: mapReviewRunRecord(record.run, 'DocumentReviewRunResponse.run'),
    findings: findings.map((entry, index) => mapReviewFinding(entry, `DocumentReviewRunResponse.findings[${index}]`)),
  };
}

function mapDocumentRoutesResponse(value: unknown): DocumentRoutesResponse {
  const record = toRecord(value, 'DocumentRoutesResponse');
  return {
    health: toString(record.health, 'DocumentRoutesResponse.health'),
    state: toString(record.state, 'DocumentRoutesResponse.state'),
    edit: toString(record.edit, 'DocumentRoutesResponse.edit'),
    authorship: toString(record.authorship, 'DocumentRoutesResponse.authorship'),
    cursor: toString(record.cursor, 'DocumentRoutesResponse.cursor'),
    comments: toString(record.comments, 'DocumentRoutesResponse.comments'),
    suggestions: toString(record.suggestions, 'DocumentRoutesResponse.suggestions'),
    reviews: toString(record.reviews, 'DocumentRoutesResponse.reviews'),
  };
}

function mapDocumentHealthResponse(value: unknown): DocumentHealthResponse {
  const record = toRecord(value, 'DocumentHealthResponse');
  return {
    status: toString(record.status, 'DocumentHealthResponse.status') as DocumentHealthResponse['status'],
    feature: toString(record.feature, 'DocumentHealthResponse.feature') as DocumentHealthResponse['feature'],
    storage: toString(record.storage, 'DocumentHealthResponse.storage') as DocumentHealthResponse['storage'],
    openClawBaseUrl: toString(record.openClawBaseUrl, 'DocumentHealthResponse.openClawBaseUrl'),
  };
}

function mapDocumentApiIndexResponse(value: unknown): DocumentApiIndexResponse {
  const record = toRecord(value, 'DocumentApiIndexResponse');
  return {
    status: toString(record.status, 'DocumentApiIndexResponse.status') as DocumentApiIndexResponse['status'],
    feature: toString(record.feature, 'DocumentApiIndexResponse.feature') as DocumentApiIndexResponse['feature'],
    storage: toString(record.storage, 'DocumentApiIndexResponse.storage') as DocumentApiIndexResponse['storage'],
    openClawBaseUrl: toString(record.openClawBaseUrl, 'DocumentApiIndexResponse.openClawBaseUrl'),
    routes: mapDocumentRoutesResponse(record.routes),
  };
}

function mapEditRequestPayload(input: DocumentEditRequest): UnknownRecord {
  const payload: UnknownRecord = {
    from: input.from,
    to: input.to,
    insert: input.insert,
  };

  const attribution = toOptionalString(input.attribution);
  if (typeof attribution === 'string') {
    payload.attribution = attribution;
  }

  if (typeof input.clientVersion === 'number') {
    payload.clientVersion = input.clientVersion;
  }

  return payload;
}

function mapAuthorshipRequestPayload(input: DocumentAuthorshipRequest): UnknownRecord {
  return {
    from: input.from,
    to: input.to,
    author: input.author,
  };
}

function mapCursorRequestPayload(input: DocumentCursorPresenceRequest): UnknownRecord {
  const payload: UnknownRecord = {};

  if (Object.prototype.hasOwnProperty.call(input, 'cursor')) {
    payload.cursor = toJsonValue(input.cursor);
  }

  if (Object.prototype.hasOwnProperty.call(input, 'position')) {
    payload.position = toJsonValue(input.position);
  }

  if (Object.prototype.hasOwnProperty.call(input, 'selection')) {
    payload.selection = toJsonValue(input.selection);
  }

  if (typeof input.action === 'string') {
    payload.action = input.action;
  }

  if (typeof input.status === 'string') {
    payload.status = input.status;
  }

  return payload;
}

function mapCommentCreatePayload(input: { from: number; to: number; text: string; selectedText?: string | null }): UnknownRecord {
  const payload: UnknownRecord = {
    from: input.from,
    to: input.to,
    text: input.text,
  };

  if (Object.prototype.hasOwnProperty.call(input, 'selectedText')) {
    payload.selectedText = input.selectedText ?? null;
  }

  return payload;
}

function mapCommentReplyPayload(input: { text: string }): UnknownRecord {
  return { text: input.text };
}

function mapCommentResolvePayload(input: { resolved: boolean }): UnknownRecord {
  return { resolved: input.resolved };
}

function mapSuggestionCreatePayload(input: {
  from: number;
  to: number;
  originalText: string;
  suggestedText: string;
  type?: string;
  reason?: string | null;
}): UnknownRecord {
  const payload: UnknownRecord = {
    from: input.from,
    to: input.to,
    originalText: input.originalText,
    suggestedText: input.suggestedText,
  };

  if (typeof input.type === 'string') {
    payload.type = input.type;
  }

  if (Object.prototype.hasOwnProperty.call(input, 'reason')) {
    payload.reason = input.reason ?? null;
  }

  return payload;
}

function mapReviewCreatePayload(input: { mode: string }): UnknownRecord {
  return { mode: input.mode };
}

function buildHeaders(
  auth: DocumentsClientAuth | undefined,
  extraHeaders: Record<string, string> | undefined,
  includeJsonContentType: boolean
): Record<string, string> {
  const headers: Record<string, string> = {};

  if (includeJsonContentType) {
    headers['Content-Type'] = 'application/json';
  }

  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      headers[key] = value;
    }
  }

  if (auth) {
    const token = toNonEmptyTrimmedString(auth.token, 'auth.token');
    headers.Authorization = `Bearer ${token}`;

    if (auth.kind === 'service') {
      headers['X-Entity-Actor'] = toNonEmptyTrimmedString(auth.actorId, 'auth.actorId');
    }
  }

  return headers;
}

interface RequestWithMapperOptions<T> {
  apiBase: string;
  defaultAuth: DocumentsClientAuth | undefined;
  path: string;
  method?: 'GET' | 'POST';
  body?: UnknownRecord;
  fallbackError: string;
  mapResponse: (payload: unknown) => T;
  requestOptions?: DocumentsRequestOptions;
}

async function requestWithMapper<T>(options: RequestWithMapperOptions<T>): Promise<T> {
  const auth = options.requestOptions?.auth ?? options.defaultAuth;
  const method = options.method ?? 'GET';
  const body = options.body;
  const payload = await requestJsonWithFallback<unknown>({
    urls: buildDocumentUrls(options.path, options.apiBase),
    init: {
      method,
      headers: buildHeaders(auth, options.requestOptions?.headers, Boolean(body)),
      body: body ? JSON.stringify(body) : undefined,
      signal: options.requestOptions?.signal,
    },
    fallbackError: options.fallbackError,
  });

  if (isOfflineQueuedResponsePayload(payload)) {
    const cachedPayload = await readCachedApiPayload(buildDocumentUrls(options.path, options.apiBase));
    if (cachedPayload !== null) {
      return options.mapResponse(cachedPayload);
    }

    throw new Error('Offline - change queued and will sync when back online.');
  }

  return options.mapResponse(payload);
}

export function createDocumentsApiClient(options: DocumentsClientOptions = {}): DocumentsApiClient {
  const apiBase = options.apiBase ?? '';
  const defaultAuth = options.auth;

  return {
    getIndex: (requestOptions) =>
      requestWithMapper({
        apiBase,
        defaultAuth,
        path: '/documents',
        fallbackError: 'Failed to load document API index.',
        mapResponse: mapDocumentApiIndexResponse,
        requestOptions,
      }),

    getHealth: (requestOptions) =>
      requestWithMapper({
        apiBase,
        defaultAuth,
        path: '/documents/health',
        fallbackError: 'Failed to load document API health.',
        mapResponse: mapDocumentHealthResponse,
        requestOptions,
      }),

    getState: (docId, requestOptions) =>
      requestWithMapper({
        apiBase,
        defaultAuth,
        path: toDocIdPath(docId, '/state'),
        fallbackError: 'Failed to load document collaboration state.',
        mapResponse: mapDocumentStateResponse,
        requestOptions,
      }),

    getComments: (docId, requestOptions) =>
      requestWithMapper({
        apiBase,
        defaultAuth,
        path: toDocIdPath(docId, '/comments'),
        fallbackError: 'Failed to load document comments.',
        mapResponse: mapDocumentCommentsResponse,
        requestOptions,
      }),

    postComment: (docId, input, requestOptions) =>
      requestWithMapper({
        apiBase,
        defaultAuth,
        path: toDocIdPath(docId, '/comments'),
        method: 'POST',
        body: mapCommentCreatePayload(input),
        fallbackError: 'Failed to create comment.',
        mapResponse: mapDocumentCommentsResponse,
        requestOptions,
      }),

    postCommentReply: (docId, commentId, input, requestOptions) =>
      requestWithMapper({
        apiBase,
        defaultAuth,
        path: toDocIdPath(docId, `/comments/${encodeURIComponent(toNonEmptyTrimmedString(commentId, 'commentId'))}/replies`),
        method: 'POST',
        body: mapCommentReplyPayload(input),
        fallbackError: 'Failed to create comment reply.',
        mapResponse: mapDocumentCommentsResponse,
        requestOptions,
      }),

    postCommentResolve: (docId, commentId, input, requestOptions) =>
      requestWithMapper({
        apiBase,
        defaultAuth,
        path: toDocIdPath(docId, `/comments/${encodeURIComponent(toNonEmptyTrimmedString(commentId, 'commentId'))}/resolve`),
        method: 'POST',
        body: mapCommentResolvePayload(input),
        fallbackError: 'Failed to update comment status.',
        mapResponse: mapDocumentCommentsResponse,
        requestOptions,
      }),

    getSuggestions: (docId, requestOptions) =>
      requestWithMapper({
        apiBase,
        defaultAuth,
        path: toDocIdPath(docId, '/suggestions'),
        fallbackError: 'Failed to load document suggestions.',
        mapResponse: mapDocumentSuggestionsResponse,
        requestOptions,
      }),

    postSuggestion: (docId, input, requestOptions) =>
      requestWithMapper({
        apiBase,
        defaultAuth,
        path: toDocIdPath(docId, '/suggestions'),
        method: 'POST',
        body: mapSuggestionCreatePayload(input),
        fallbackError: 'Failed to create suggestion.',
        mapResponse: mapDocumentSuggestionsResponse,
        requestOptions,
      }),

    acceptSuggestion: (docId, suggestionId, requestOptions) =>
      requestWithMapper({
        apiBase,
        defaultAuth,
        path: toDocIdPath(
          docId,
          `/suggestions/${encodeURIComponent(toNonEmptyTrimmedString(suggestionId, 'suggestionId'))}/accept`
        ),
        method: 'POST',
        fallbackError: 'Failed to accept suggestion.',
        mapResponse: mapDocumentSuggestionsResponse,
        requestOptions,
      }),

    rejectSuggestion: (docId, suggestionId, requestOptions) =>
      requestWithMapper({
        apiBase,
        defaultAuth,
        path: toDocIdPath(
          docId,
          `/suggestions/${encodeURIComponent(toNonEmptyTrimmedString(suggestionId, 'suggestionId'))}/reject`
        ),
        method: 'POST',
        fallbackError: 'Failed to reject suggestion.',
        mapResponse: mapDocumentSuggestionsResponse,
        requestOptions,
      }),

    postReview: (docId, input, requestOptions) =>
      requestWithMapper({
        apiBase,
        defaultAuth,
        path: toDocIdPath(docId, '/reviews'),
        method: 'POST',
        body: mapReviewCreatePayload(input),
        fallbackError: 'Failed to start review.',
        mapResponse: mapDocumentReviewRunResponse,
        requestOptions,
      }),

    getReview: (docId, runId, requestOptions) =>
      requestWithMapper({
        apiBase,
        defaultAuth,
        path: toDocIdPath(docId, `/reviews/${encodeURIComponent(toNonEmptyTrimmedString(runId, 'runId'))}`),
        fallbackError: 'Failed to load review run.',
        mapResponse: mapDocumentReviewRunResponse,
        requestOptions,
      }),

    applyReviewFinding: (docId, runId, findingId, requestOptions) =>
      requestWithMapper({
        apiBase,
        defaultAuth,
        path: toDocIdPath(
          docId,
          `/reviews/${encodeURIComponent(toNonEmptyTrimmedString(runId, 'runId'))}/findings/${encodeURIComponent(
            toNonEmptyTrimmedString(findingId, 'findingId')
          )}/apply`
        ),
        method: 'POST',
        fallbackError: 'Failed to apply finding fix.',
        mapResponse: mapDocumentReviewRunResponse,
        requestOptions,
      }),

    ignoreReviewFinding: (docId, runId, findingId, requestOptions) =>
      requestWithMapper({
        apiBase,
        defaultAuth,
        path: toDocIdPath(
          docId,
          `/reviews/${encodeURIComponent(toNonEmptyTrimmedString(runId, 'runId'))}/findings/${encodeURIComponent(
            toNonEmptyTrimmedString(findingId, 'findingId')
          )}/ignore`
        ),
        method: 'POST',
        fallbackError: 'Failed to ignore finding.',
        mapResponse: mapDocumentReviewRunResponse,
        requestOptions,
      }),

    postEdit: (docId, input, requestOptions) =>
      requestWithMapper({
        apiBase,
        defaultAuth,
        path: toDocIdPath(docId, '/edit'),
        method: 'POST',
        body: mapEditRequestPayload(input),
        fallbackError: 'Failed to apply document edit.',
        mapResponse: mapDocumentEditResponse,
        requestOptions,
      }),

    postAuthorship: (docId, input, requestOptions) =>
      requestWithMapper({
        apiBase,
        defaultAuth,
        path: toDocIdPath(docId, '/authorship'),
        method: 'POST',
        body: mapAuthorshipRequestPayload(input),
        fallbackError: 'Failed to update document authorship.',
        mapResponse: mapDocumentAuthorshipResponse,
        requestOptions,
      }),

    postCursor: (docId, input, requestOptions) =>
      requestWithMapper({
        apiBase,
        defaultAuth,
        path: toDocIdPath(docId, '/cursor'),
        method: 'POST',
        body: mapCursorRequestPayload(input),
        fallbackError: 'Failed to update document cursor presence.',
        mapResponse: mapDocumentCursorPresenceResponse,
        requestOptions,
      }),
  };
}
