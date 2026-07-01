export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

import { BUILT_IN_AUTHORSHIP_ACTORS } from '../lib/agentRegistry';

export const AUTHORSHIP_ACTORS = BUILT_IN_AUTHORSHIP_ACTORS;
export type DocumentAuthorshipActor = (typeof AUTHORSHIP_ACTORS)[number];

export const DOCUMENT_PRESENCE_STATUSES = ['active', 'idle', 'disconnected'] as const;
export type DocumentPresenceStatus = (typeof DOCUMENT_PRESENCE_STATUSES)[number];

export const DOCUMENT_SUGGESTION_TYPES = ['insert', 'replace', 'delete'] as const;
export type DocumentSuggestionType = (typeof DOCUMENT_SUGGESTION_TYPES)[number];

export const DOCUMENT_SUGGESTION_STATUSES = ['open', 'accepted', 'rejected'] as const;
export type DocumentSuggestionStatus = (typeof DOCUMENT_SUGGESTION_STATUSES)[number];

export const DOCUMENT_REVIEW_MODES = ['style', 'grammar', 'technical', 'security'] as const;
export type DocumentReviewMode = (typeof DOCUMENT_REVIEW_MODES)[number];

export const DOCUMENT_REVIEW_STATUSES = ['pending', 'running', 'completed', 'failed'] as const;
export type DocumentReviewStatus = (typeof DOCUMENT_REVIEW_STATUSES)[number];

export interface SourceCapability {
  read: boolean;
  write: boolean;
  rename: boolean;
  delete: boolean;
  list: boolean;
  search: boolean;
}

export interface DocumentContentRef {
  docId: string;
  sourceId: string | null;
  path: string | null;
  contentHash: string | null;
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

export interface DocumentAuthorshipHistoryRecord {
  id: string;
  doc_id: string;
  range_id: string | null;
  author: string;
  diff_json: JsonValue;
  timestamp: string;
  updated_at: string;
}

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

export interface DocumentCommentReplyRecord {
  id: string;
  doc_id: string;
  comment_id: string;
  author: string;
  text: string;
  created_at: string;
  updated_at: string;
}

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

export interface DocumentCommentRange {
  from: number;
  to: number;
}

export interface DocumentCommentReply {
  id: string;
  author: string;
  text: string;
  createdAt: string;
}

export interface DocumentCommentThread {
  id: string;
  range: DocumentCommentRange;
  text: string;
  author: string;
  createdAt: string;
  selectedText: string | null;
  resolved: boolean;
  replies: DocumentCommentReply[];
}

export interface DocumentCommentsResponse {
  docId: string;
  threads: DocumentCommentThread[];
}

export type DocumentSuggestionUiStatus = 'pending' | 'accepted' | 'rejected';

export interface DocumentSuggestionUiRecord {
  id: string;
  range: DocumentCommentRange;
  originalText: string;
  suggestedText: string;
  author: string;
  status: DocumentSuggestionUiStatus;
  type: DocumentSuggestionType;
  createdAt: string;
  updatedAt: string;
  reason: string | null;
}

export interface DocumentSuggestionsResponse {
  docId: string;
  suggestions: DocumentSuggestionUiRecord[];
}

export interface DocumentReviewFinding {
  id: string;
  type: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  range: DocumentCommentRange | null;
  suggestedFix?: {
    replacement: string;
  } | null;
  status?: 'open' | 'applied' | 'ignored';
}

export interface DocumentReviewRunResponse {
  docId: string;
  run: DocumentReviewRunRecord;
  findings: DocumentReviewFinding[];
}

export interface DocumentCollaborationSnapshot {
  session?: DocumentSessionRecord;
  authorship_ranges: DocumentAuthorshipRangeRecord[];
  authorship_history: DocumentAuthorshipHistoryRecord[];
  presence: DocumentPresenceRecord[];
  comments: DocumentCommentRecord[];
  comment_replies: DocumentCommentReplyRecord[];
  suggestions: DocumentSuggestionRecord[];
  review_runs: DocumentReviewRunRecord[];
}

export interface DocumentAuthorshipAuthorStats {
  ranges: number;
  reviewedRanges: number;
  coveredCharacters: number;
}

export interface DocumentAuthorshipStats {
  totalRanges: number;
  reviewedRanges: number;
  reviewedPercent: number;
  coveredCharacters: number;
  human: number;
  ada: number;
  spock: number;
  scotty: number;
  byAuthor: Record<string, DocumentAuthorshipAuthorStats>;
}

export interface DocumentCommentsSummary {
  total: number;
  resolved: number;
  open: number;
  replies: number;
}

export interface DocumentSuggestionTypeSummary {
  insert: number;
  replace: number;
  delete: number;
  other: number;
}

export interface DocumentSuggestionsSummary {
  total: number;
  open: number;
  accepted: number;
  rejected: number;
  byType: DocumentSuggestionTypeSummary;
}

export interface DocumentReviewSummary {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  latestRun: DocumentReviewRunRecord | null;
}

export interface DocumentStateResponse {
  docId: string;
  contentRef: DocumentContentRef;
  sourceId: string | null;
  path: string | null;
  capabilities: SourceCapability;
  authorshipStats: DocumentAuthorshipStats;
  presence: DocumentPresenceRecord[];
  commentsSummary: DocumentCommentsSummary;
  suggestionsSummary: DocumentSuggestionsSummary;
  reviewSummary: DocumentReviewSummary;
  version: number;
  collaboration: DocumentCollaborationSnapshot;
}

export interface DocumentEditRequest {
  from: number;
  to: number;
  insert: string;
  attribution?: string;
  clientVersion?: number;
}

export interface DocumentEditResponse {
  docId: string;
  actorId: string;
  attribution: string;
  sourceId: string;
  path: string;
  from: number;
  to: number;
  insert: string;
  previousVersion: number;
  version: number;
  contentHash: string;
  contentLength: number;
  updatedAt: string | null;
}

export interface DocumentAuthorshipRequest {
  from: number;
  to: number;
  author: DocumentAuthorshipActor;
}

export interface DocumentAuthorshipResponse {
  docId: string;
  actorId: string;
  from: number;
  to: number;
  author: DocumentAuthorshipActor;
  toggledOff: boolean;
  range: DocumentAuthorshipRangeRecord | null;
  authorshipStats: DocumentAuthorshipStats;
  collaboration: DocumentCollaborationSnapshot;
}

export interface DocumentCursorPresenceRequest {
  cursor?: JsonValue;
  position?: JsonValue;
  selection?: JsonValue;
  action?: string;
  status?: DocumentPresenceStatus;
}

export interface DocumentCursorPresenceResponse {
  docId: string;
  actor: string;
  status: DocumentPresenceStatus;
  heartbeatAt: string;
  presence: DocumentPresenceRecord;
}

export interface DocumentRoutesResponse {
  health: string;
  state: string;
  edit: string;
  authorship: string;
  cursor: string;
  comments: string;
  suggestions: string;
  reviews: string;
}

export interface DocumentApiIndexResponse {
  status: 'ok';
  feature: 'entity.agent_native_editor';
  storage: 'sqlite';
  routes: DocumentRoutesResponse;
}

export interface DocumentHealthResponse {
  status: 'ok';
  feature: 'entity.agent_native_editor';
  storage: 'sqlite';
}
