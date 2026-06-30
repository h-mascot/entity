import { createHash } from 'crypto';
import type { AgentRegistryRecord } from '../../../db/src';
import { createAgentTokenRepository, type AgentTokenRepository } from '../../../db/src/agent-tokens';
import {
  DOCUMENT_PRESENCE_STATUSES,
  createDocumentCollaborationRepository,
  mergeCursorPatch,
  type DocumentAuthorshipRangeRecord,
  type DocumentCommentRecord,
  type DocumentCommentReplyRecord,
  type DocumentCollaborationRepository,
  type DocumentCollaborationSnapshot,
  type DocumentPresenceRecord,
  type DocumentPresenceStatus,
  type DocumentReviewMode,
  type DocumentReviewRunRecord,
  type DocumentReviewStatus,
  type DocumentSuggestionRecord,
  type DocumentSuggestionStatus,
  type DocumentSuggestionType,
  type JsonValue,
} from '../../../db/src/document-collab';
import { createFileSourceRepository, type FileSourceRepository } from '../../../db/src/file-sources';
import {
  createDocumentCommentMentionResponder,
  type DocumentCommentMentionTrigger,
} from '../agent/document-comment-responder';
import { createFileSourceAdapter } from '../fs/adapters/registry';
import type { FileSourceAdapter, SourceCapability } from '../fs/adapters/types';
import type { EditorWsBroadcaster } from './ws';

type JsonObject = Record<string, JsonValue>;

export interface EditorServiceOptions {
  openClawBaseUrl: string;
  broadcaster: EditorWsBroadcaster;
  collaborationRepository?: DocumentCollaborationRepository;
  tokenRepository?: AgentTokenRepository;
  sourceRepository?: FileSourceRepository;
  listAgents?: () => AgentRegistryRecord[];
  documentCommentMentionResponder?: (trigger: DocumentCommentMentionTrigger) => Promise<void> | void;
}

export interface EditorModuleHealth {
  status: 'ok';
  feature: 'entity.agent_native_editor';
  storage: 'sqlite';
  openClawBaseUrl: string;
}

export interface DocumentContentRef {
  docId: string;
  sourceId: string | null;
  path: string | null;
  contentHash: string | null;
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

export interface DocumentCommentCreateInput {
  from: number;
  to: number;
  text: string;
  selectedText?: string | null;
}

export interface DocumentCommentReplyCreateInput {
  text: string;
}

export interface DocumentCommentResolveInput {
  resolved: boolean;
}

export interface DocumentSuggestionRange {
  from: number;
  to: number;
}

export type DocumentSuggestionUiStatus = 'pending' | 'accepted' | 'rejected';

export interface DocumentSuggestionUiRecord {
  id: string;
  range: DocumentSuggestionRange;
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

export interface DocumentSuggestionCreateInput {
  from: number;
  to: number;
  originalText: string;
  suggestedText: string;
  type?: DocumentSuggestionType | string;
  reason?: string | null;
}

export interface DocumentSuggestionUpdateInput {
  status: 'accepted' | 'rejected' | string;
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

export interface DocumentReviewCreateInput {
  mode: DocumentReviewMode | string;
}

export interface DocumentReviewWebhookPayload {
  docId: string;
  runId: string;
  status: DocumentReviewStatus | string;
  findings?: unknown;
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

export interface CursorPresenceUpdateInput {
  cursor?: JsonValue;
  position?: JsonValue;
  selection?: JsonValue;
  action?: string;
  status?: DocumentPresenceStatus | string;
}

export interface CursorPresenceUpdateResult {
  docId: string;
  actorId: string;
  action: string | null;
  presence: DocumentPresenceRecord;
}

export interface DocumentEditInput {
  from: number;
  to: number;
  insert: string;
  attribution?: string;
  clientVersion?: number;
}

export interface DocumentEditResult {
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

export const AUTHORSHIP_ACTORS = ['human', 'ada', 'spock', 'scotty'] as const;
export type DocumentAuthorshipActor = (typeof AUTHORSHIP_ACTORS)[number];

export interface DocumentAuthorshipInput {
  from: number;
  to: number;
  author: string;
}

export interface DocumentAuthorshipResult {
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

export class EditorServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = 'EditorServiceError';
  }
}

export interface EditorService {
  readonly repositories: {
    collaboration: DocumentCollaborationRepository;
    tokens: AgentTokenRepository;
    sources: FileSourceRepository;
  };
  readonly broadcaster: EditorWsBroadcaster;
  getHealth: () => EditorModuleHealth;
  getDocumentState: (docId: string) => DocumentStateResponse;
  getComments: (docId: string) => DocumentCommentsResponse;
  createComment: (docId: string, actorId: string, input: DocumentCommentCreateInput) => DocumentCommentsResponse;
  replyToComment: (
    docId: string,
    actorId: string,
    commentId: string,
    input: DocumentCommentReplyCreateInput
  ) => DocumentCommentsResponse;
  resolveComment: (docId: string, actorId: string, commentId: string, input: DocumentCommentResolveInput) => DocumentCommentsResponse;
  getSuggestions: (docId: string) => DocumentSuggestionsResponse;
  createSuggestion: (docId: string, actorId: string, input: DocumentSuggestionCreateInput) => DocumentSuggestionsResponse;
  acceptSuggestion: (docId: string, actorId: string, suggestionId: string) => Promise<DocumentSuggestionsResponse>;
  rejectSuggestion: (docId: string, actorId: string, suggestionId: string) => DocumentSuggestionsResponse;
  createReviewRun: (docId: string, actorId: string, input: DocumentReviewCreateInput) => Promise<DocumentReviewRunResponse>;
  getReviewRun: (docId: string, runId: string) => DocumentReviewRunResponse;
  applyReviewFinding: (docId: string, actorId: string, runId: string, findingId: string) => Promise<DocumentReviewRunResponse>;
  ignoreReviewFinding: (docId: string, actorId: string, runId: string, findingId: string) => DocumentReviewRunResponse;
  receiveReviewResult: (payload: DocumentReviewWebhookPayload) => DocumentReviewRunResponse;
  applyEdit: (docId: string, actorId: string, input: DocumentEditInput) => Promise<DocumentEditResult>;
  upsertAuthorship: (docId: string, actorId: string, input: DocumentAuthorshipInput) => DocumentAuthorshipResult;
  upsertCursorPresence: (docId: string, actorId: string, input: CursorPresenceUpdateInput) => CursorPresenceUpdateResult;
}

const PRESENCE_STATUSES = new Set<string>(DOCUMENT_PRESENCE_STATUSES);
const AUTHORSHIP_ACTOR_SET = new Set<string>(AUTHORSHIP_ACTORS);
const DEFAULT_SOURCE_CAPABILITIES: SourceCapability = {
  read: true,
  write: false,
  rename: false,
  delete: false,
  list: true,
  search: false,
};

function normalizeBaseUrl(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return 'unconfigured';
  }

  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} is required.`);
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalized;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new EditorServiceError('INVALID_REQUEST', `${fieldName} is required.`, 400);
  }

  return value;
}

function requireOptionalString(value: unknown, fieldName: string): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value === 'undefined') {
    return null;
  }

  if (typeof value !== 'string') {
    throw new EditorServiceError('INVALID_REQUEST', `${fieldName} must be a string when provided.`, 400);
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeOptionalInteger(value: unknown): number | null {
  if (typeof value === 'undefined') {
    return null;
  }

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new EditorServiceError('INVALID_REQUEST', 'clientVersion must be an integer when provided.', 400);
  }

  if (value < 0) {
    throw new EditorServiceError('INVALID_REQUEST', 'clientVersion must be zero or greater.', 400);
  }

  return value;
}

function requireOffset(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new EditorServiceError('INVALID_EDIT_RANGE', `${fieldName} must be a non-negative integer.`, 400);
  }

  return value;
}

function requireOffsetRange(
  from: number,
  to: number,
  maxLength: number,
  label: string
): { from: number; to: number } {
  const safeFrom = Math.max(0, Math.floor(from));
  const safeTo = Math.max(0, Math.floor(to));
  if (safeTo < safeFrom) {
    throw new EditorServiceError('INVALID_EDIT_RANGE', `${label}.to must be greater than or equal to ${label}.from.`, 400);
  }

  if (safeFrom > maxLength || safeTo > maxLength) {
    throw new EditorServiceError('INVALID_EDIT_RANGE', `${label} range exceeds document length ${maxLength}.`, 400);
  }

  return { from: safeFrom, to: safeTo };
}

function requireAuthorshipOffset(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new EditorServiceError('INVALID_AUTHORSHIP_RANGE', `${fieldName} must be a non-negative integer.`, 400);
  }

  return value;
}

function requireAuthorshipActor(value: unknown): DocumentAuthorshipActor {
  if (typeof value !== 'string') {
    throw new EditorServiceError(
      'INVALID_AUTHORSHIP_AUTHOR',
      'author must be one of: human, ada, spock, scotty.',
      400
    );
  }

  const normalized = value.trim().toLowerCase();
  if (!AUTHORSHIP_ACTOR_SET.has(normalized)) {
    throw new EditorServiceError(
      'INVALID_AUTHORSHIP_AUTHOR',
      'author must be one of: human, ada, spock, scotty.',
      400
    );
  }

  return normalized as DocumentAuthorshipActor;
}

function computeContentHash(content: string): string {
  return createHash('sha1').update(content, 'utf8').digest('hex');
}

function parseDocIdParts(docId: string): { sourceId: string | null; path: string | null } {
  const normalized = docId.trim();
  if (!normalized) {
    return { sourceId: null, path: null };
  }

  const idx = normalized.indexOf(':');
  if (idx < 1) {
    return { sourceId: null, path: null };
  }

  const prefix = normalized.slice(0, idx).trim();
  const suffix = normalized.slice(idx + 1).trim();
  if (!suffix) {
    return { sourceId: null, path: null };
  }

  const path = suffix.startsWith('/') ? suffix : `/${suffix}`;
  if (prefix.toLowerCase() === 'local') {
    return { sourceId: null, path };
  }

  return { sourceId: prefix, path };
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePresenceStatus(value: unknown, fallback: DocumentPresenceStatus): DocumentPresenceStatus {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (!PRESENCE_STATUSES.has(normalized)) {
    return fallback;
  }

  return normalized as DocumentPresenceStatus;
}

function normalizeCapability(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return fallback;
    }

    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
      return true;
    }

    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
      return false;
    }
  }

  return fallback;
}

function mergeCapabilities(base: SourceCapability, patch: Partial<SourceCapability>): SourceCapability {
  return {
    read: normalizeCapability(patch.read, base.read),
    write: normalizeCapability(patch.write, base.write),
    rename: normalizeCapability(patch.rename, base.rename),
    delete: normalizeCapability(patch.delete, base.delete),
    list: normalizeCapability(patch.list, base.list),
    search: normalizeCapability(patch.search, base.search),
  };
}

function parseSourceCapabilityPatch(value: unknown): Partial<SourceCapability> {
  if (typeof value !== 'string') {
    return {};
  }

  const normalized = value.trim();
  if (!normalized) {
    return {};
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (!isJsonObject(parsed)) {
      return {};
    }

    return {
      read: normalizeCapability(parsed.read, DEFAULT_SOURCE_CAPABILITIES.read),
      write: normalizeCapability(parsed.write, DEFAULT_SOURCE_CAPABILITIES.write),
      rename: normalizeCapability(parsed.rename, DEFAULT_SOURCE_CAPABILITIES.rename),
      delete: normalizeCapability(parsed.delete, DEFAULT_SOURCE_CAPABILITIES.delete),
      list: normalizeCapability(parsed.list, DEFAULT_SOURCE_CAPABILITIES.list),
      search: normalizeCapability(parsed.search, DEFAULT_SOURCE_CAPABILITIES.search),
    };
  } catch {
    return {};
  }
}

function percent(part: number, whole: number): number {
  if (whole <= 0) {
    return 0;
  }

  return Number(((part / whole) * 100).toFixed(2));
}

function buildAuthorshipStats(snapshot: DocumentCollaborationSnapshot): DocumentAuthorshipStats {
  const byAuthor: Record<string, DocumentAuthorshipAuthorStats> = {};
  let coveredCharacters = 0;
  let reviewedRanges = 0;

  for (const range of snapshot.authorship_ranges) {
    const span = Math.max(0, range.end_offset - range.start_offset);
    coveredCharacters += span;
    if (range.reviewed) {
      reviewedRanges += 1;
    }

    if (!byAuthor[range.author]) {
      byAuthor[range.author] = {
        ranges: 0,
        reviewedRanges: 0,
        coveredCharacters: 0,
      };
    }

    byAuthor[range.author].ranges += 1;
    byAuthor[range.author].coveredCharacters += span;
    if (range.reviewed) {
      byAuthor[range.author].reviewedRanges += 1;
    }
  }

  const totalRanges = snapshot.authorship_ranges.length;
  const human = percent(byAuthor.human?.coveredCharacters ?? 0, coveredCharacters);
  const ada = percent(byAuthor.ada?.coveredCharacters ?? 0, coveredCharacters);
  const spock = percent(byAuthor.spock?.coveredCharacters ?? 0, coveredCharacters);
  const scotty = percent(byAuthor.scotty?.coveredCharacters ?? 0, coveredCharacters);
  return {
    totalRanges,
    reviewedRanges,
    reviewedPercent: percent(reviewedRanges, totalRanges),
    coveredCharacters,
    human,
    ada,
    spock,
    scotty,
    byAuthor,
  };
}

function buildCommentsSummary(snapshot: DocumentCollaborationSnapshot): DocumentCommentsSummary {
  const total = snapshot.comments.length;
  const resolved = snapshot.comments.reduce((count, comment) => count + (comment.resolved ? 1 : 0), 0);
  return {
    total,
    resolved,
    open: Math.max(0, total - resolved),
    replies: snapshot.comment_replies.length,
  };
}

function buildSuggestionsSummary(snapshot: DocumentCollaborationSnapshot): DocumentSuggestionsSummary {
  const byType: DocumentSuggestionTypeSummary = {
    insert: 0,
    replace: 0,
    delete: 0,
    other: 0,
  };

  let open = 0;
  let accepted = 0;
  let rejected = 0;
  for (const suggestion of snapshot.suggestions) {
    if (suggestion.status === 'open') {
      open += 1;
    } else if (suggestion.status === 'accepted') {
      accepted += 1;
    } else if (suggestion.status === 'rejected') {
      rejected += 1;
    }

    if (suggestion.type === 'insert' || suggestion.type === 'replace' || suggestion.type === 'delete') {
      byType[suggestion.type] += 1;
    } else {
      byType.other += 1;
    }
  }

  return {
    total: snapshot.suggestions.length,
    open,
    accepted,
    rejected,
    byType,
  };
}

function buildReviewSummary(snapshot: DocumentCollaborationSnapshot): DocumentReviewSummary {
  let pending = 0;
  let running = 0;
  let completed = 0;
  let failed = 0;

  for (const run of snapshot.review_runs) {
    if (run.status === 'pending') {
      pending += 1;
    } else if (run.status === 'running') {
      running += 1;
    } else if (run.status === 'completed') {
      completed += 1;
    } else if (run.status === 'failed') {
      failed += 1;
    }
  }

  return {
    total: snapshot.review_runs.length,
    pending,
    running,
    completed,
    failed,
    latestRun: snapshot.review_runs[0] ?? null,
  };
}

function mapCommentThreads(snapshot: DocumentCollaborationSnapshot): DocumentCommentThread[] {
  const repliesByComment = new Map<string, DocumentCommentReplyRecord[]>();
  for (const reply of snapshot.comment_replies) {
    const list = repliesByComment.get(reply.comment_id) ?? [];
    list.push(reply);
    repliesByComment.set(reply.comment_id, list);
  }

  return snapshot.comments.map((comment) => {
    const replies = repliesByComment.get(comment.id) ?? [];
    return {
      id: comment.id,
      range: { from: comment.start_offset, to: comment.end_offset },
      text: comment.text,
      author: comment.author,
      createdAt: comment.created_at,
      selectedText: comment.selected_text ?? null,
      resolved: comment.resolved,
      replies: replies.map((entry) => ({
        id: entry.id,
        author: entry.author,
        text: entry.text,
        createdAt: entry.created_at,
      })),
    };
  });
}

function mapSuggestionStatusForUi(status: DocumentSuggestionStatus): DocumentSuggestionUiStatus {
  switch (status) {
    case 'accepted':
      return 'accepted';
    case 'rejected':
      return 'rejected';
    default:
      return 'pending';
  }
}

function normalizeSuggestionType(value: unknown): DocumentSuggestionType {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'insert' || normalized === 'replace' || normalized === 'delete') {
      return normalized as DocumentSuggestionType;
    }
  }

  return 'replace';
}

function inferSuggestionType(from: number, to: number, suggestedText: string): DocumentSuggestionType {
  if (from === to && suggestedText.length > 0) {
    return 'insert';
  }

  if (!suggestedText && to > from) {
    return 'delete';
  }

  return 'replace';
}

function mapSuggestions(snapshot: DocumentCollaborationSnapshot): DocumentSuggestionUiRecord[] {
  return snapshot.suggestions.map((entry) => ({
    id: entry.id,
    range: { from: entry.start_offset, to: entry.end_offset },
    originalText: entry.original_text,
    suggestedText: entry.suggested_text,
    author: entry.author,
    status: mapSuggestionStatusForUi(entry.status),
    type: entry.type,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
    reason: entry.reason ?? null,
  }));
}

function normalizeReviewMode(value: unknown): DocumentReviewMode {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'style' || normalized === 'grammar' || normalized === 'technical' || normalized === 'security') {
      return normalized as DocumentReviewMode;
    }
  }

  return 'style';
}

function normalizeReviewStatus(value: unknown): DocumentReviewStatus {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'pending' || normalized === 'running' || normalized === 'completed' || normalized === 'failed') {
      return normalized as DocumentReviewStatus;
    }
  }

  return 'pending';
}

function normalizeFindingSeverity(value: unknown): DocumentReviewFinding['severity'] {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'error' || normalized === 'warning' || normalized === 'info') {
      return normalized as DocumentReviewFinding['severity'];
    }
  }

  return 'info';
}

function mapReviewFindings(run: DocumentReviewRunRecord): DocumentReviewFinding[] {
  const raw = run.result_json;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return [];
  }

  const record = raw as Record<string, unknown>;
  const findings = Array.isArray(record.findings) ? (record.findings as unknown[]) : [];
  return findings
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null;
      }

      const e = entry as Record<string, unknown>;
      const id = normalizeOptionalString(e.id) ?? '';
      const type = normalizeOptionalString(e.type) ?? 'finding';
      const message = normalizeOptionalString(e.message) ?? '';
      if (!id || !message) {
        return null;
      }

      const rangeCandidate = e.range;
      let range: DocumentCommentRange | null = null;
      if (rangeCandidate && typeof rangeCandidate === 'object' && !Array.isArray(rangeCandidate)) {
        const r = rangeCandidate as Record<string, unknown>;
        const from = typeof r.from === 'number' && Number.isFinite(r.from) ? Math.max(0, Math.floor(r.from)) : null;
        const to = typeof r.to === 'number' && Number.isFinite(r.to) ? Math.max(0, Math.floor(r.to)) : null;
        if (typeof from === 'number' && typeof to === 'number') {
          range = { from: Math.min(from, to), to: Math.max(from, to) };
        }
      }

      const suggestedFixCandidate = e.suggestedFix;
      let suggestedFix: { replacement: string } | null = null;
      if (suggestedFixCandidate && typeof suggestedFixCandidate === 'object' && !Array.isArray(suggestedFixCandidate)) {
        const sf = suggestedFixCandidate as Record<string, unknown>;
        const replacement = normalizeOptionalString(sf.replacement);
        if (replacement !== null) {
          suggestedFix = { replacement };
        }
      }

      const status = normalizeOptionalString(e.status) ?? 'open';
      const finding: DocumentReviewFinding = {
        id,
        type,
        severity: normalizeFindingSeverity(e.severity),
        message,
        range,
        suggestedFix,
        status: status === 'applied' || status === 'ignored' ? (status as 'applied' | 'ignored') : 'open',
      };
      return finding;
    })
    .filter((entry): entry is DocumentReviewFinding => entry !== null);
}

function updateFindingsStatusJson(
  run: DocumentReviewRunRecord,
  findingId: string,
  status: 'applied' | 'ignored'
): JsonValue {
  const existing = run.result_json;
  const resultObj: Record<string, unknown> =
    existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...(existing as Record<string, unknown>) } : {};
  const findings = Array.isArray(resultObj.findings) ? [...(resultObj.findings as unknown[])] : [];

  resultObj.findings = findings.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return entry;
    }

    const record = entry as Record<string, unknown>;
    if (normalizeOptionalString(record.id) !== findingId) {
      return entry;
    }

    return { ...record, status };
  });

  return resultObj as JsonValue;
}

function buildCursorPatch(input: CursorPresenceUpdateInput, action: string | null): JsonValue {
  const patch: JsonObject = {};
  if (isJsonObject(input.cursor)) {
    Object.assign(patch, input.cursor);
  }

  if (Object.prototype.hasOwnProperty.call(input, 'position') && typeof input.position !== 'undefined') {
    patch.position = input.position;
  }

  if (Object.prototype.hasOwnProperty.call(input, 'selection') && typeof input.selection !== 'undefined') {
    patch.selection = input.selection;
  }

  if (action) {
    patch.action = action;
  }

  return patch;
}

export function createEditorService(options: EditorServiceOptions): EditorService {
  const collaboration = options.collaborationRepository ?? createDocumentCollaborationRepository();
  const tokens = options.tokenRepository ?? createAgentTokenRepository();
  const sources = options.sourceRepository ?? createFileSourceRepository();
  const openClawBaseUrl = normalizeBaseUrl(options.openClawBaseUrl);

  const requireSourceAdapter = (sourceId: string): { adapter: FileSourceAdapter; capabilities: SourceCapability } => {
    const source = sources.getSource(sourceId);
    if (!source) {
      throw new EditorServiceError('SOURCE_NOT_FOUND', 'Document source was not found.', 404);
    }

    let capabilities = mergeCapabilities(DEFAULT_SOURCE_CAPABILITIES, parseSourceCapabilityPatch(source.capabilities));
    try {
      const adapter = createFileSourceAdapter(source);
      capabilities = mergeCapabilities(capabilities, adapter.capabilities());
      return { adapter, capabilities };
    } catch {
      throw new EditorServiceError('SOURCE_ADAPTER_UNAVAILABLE', 'Unable to initialize source adapter.', 500);
    }
  };

  const resolveSourceCapabilities = (sourceId: string | null): SourceCapability => {
    if (!sourceId) {
      return { ...DEFAULT_SOURCE_CAPABILITIES };
    }

    try {
      return requireSourceAdapter(sourceId).capabilities;
    } catch {
      // Preserve fallback capabilities if source lookup or adapter creation fails.
      return { ...DEFAULT_SOURCE_CAPABILITIES };
    }
  };

  const ensureDocumentSession = (docId: string) => {
    const normalizedDocId = requireNonEmptyString(docId, 'docId');
    const existing = collaboration.getSessionByDocId(normalizedDocId);
    if (existing) {
      return existing;
    }

    const parsed = parseDocIdParts(normalizedDocId);
    if (!parsed.sourceId || !parsed.path) {
      return undefined;
    }

    // Validate the source before persisting the session.
    requireSourceAdapter(parsed.sourceId);
    return collaboration.upsertSession({
      doc_id: normalizedDocId,
      source_id: parsed.sourceId,
      path: parsed.path,
      content_hash: null,
      version: 0,
    });
  };

  const requireSessionForMutation = (docId: string) => {
    const normalizedDocId = requireNonEmptyString(docId, 'docId');
    const session = ensureDocumentSession(normalizedDocId) ?? collaboration.getSessionByDocId(normalizedDocId);
    if (!session) {
      throw new EditorServiceError('DOC_SESSION_NOT_FOUND', 'No document session exists for the provided docId.', 404);
    }
    return session;
  };

  const readDocumentMentionContext = async (docId: string, comment: DocumentCommentRecord) => {
    const normalizedDocId = requireNonEmptyString(docId, 'docId');
    const session = ensureDocumentSession(normalizedDocId) ?? collaboration.getSessionByDocId(normalizedDocId);
    const parsed = parseDocIdParts(normalizedDocId);
    const sourceId = session?.source_id ?? parsed.sourceId ?? null;
    const documentPath = session?.path ?? parsed.path ?? null;

    if (!sourceId || !documentPath) {
      return {
        docId: normalizedDocId,
        sourceId,
        path: documentPath,
        content: comment.selected_text ?? '',
      };
    }

    const { adapter } = requireSourceAdapter(sourceId);
    const file = await adapter.read(documentPath);
    return {
      docId: normalizedDocId,
      sourceId,
      path: documentPath,
      content: file.content,
    };
  };

  const documentCommentMentionResponder =
    options.documentCommentMentionResponder ??
    (options.listAgents
      ? createDocumentCommentMentionResponder({
          listAgents: options.listAgents,
          readDocumentContext: readDocumentMentionContext,
          listThreadReplies: (docId, commentId) => collaboration.listCommentReplies(docId, commentId),
          createReply: (input) =>
            collaboration.createCommentReply({
              doc_id: input.docId,
              comment_id: input.commentId,
              author: input.author,
              text: input.text,
            }),
          broadcastReply: (docId, commentId, reply) =>
            options.broadcaster.broadcastComment(docId, {
              actor: reply.author,
              action: 'replied',
              commentId,
              replyId: reply.id,
            }),
        })
      : undefined);

  return {
    repositories: {
      collaboration,
      tokens,
      sources,
    },
    broadcaster: options.broadcaster,
    getHealth: () => ({
      status: 'ok',
      feature: 'entity.agent_native_editor',
      storage: 'sqlite',
      openClawBaseUrl,
    }),
    getDocumentState: (docId: string) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const ensuredSession = ensureDocumentSession(normalizedDocId);
      const collaborationSnapshot = collaboration.getCollaborationSnapshot(normalizedDocId);
      const session = ensuredSession ?? collaborationSnapshot.session;
      const parsed = parseDocIdParts(normalizedDocId);
      const sourceId = session?.source_id ?? parsed.sourceId ?? null;
      const path = session?.path ?? parsed.path ?? null;

      return {
        docId: normalizedDocId,
        contentRef: {
          docId: normalizedDocId,
          sourceId,
          path,
          contentHash: session?.content_hash ?? null,
        },
        sourceId,
        path,
        capabilities: resolveSourceCapabilities(sourceId),
        authorshipStats: buildAuthorshipStats(collaborationSnapshot),
        presence: collaborationSnapshot.presence,
        commentsSummary: buildCommentsSummary(collaborationSnapshot),
        suggestionsSummary: buildSuggestionsSummary(collaborationSnapshot),
        reviewSummary: buildReviewSummary(collaborationSnapshot),
        version: session?.version ?? 0,
        collaboration: collaborationSnapshot,
      };
    },
    getComments: (docId: string) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      ensureDocumentSession(normalizedDocId);
      const snapshot = collaboration.getCollaborationSnapshot(normalizedDocId);
      return { docId: normalizedDocId, threads: mapCommentThreads(snapshot) };
    },
    createComment: (docId: string, actorId: string, input: DocumentCommentCreateInput) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const normalizedActorId = requireNonEmptyString(actorId, 'actorId');
      ensureDocumentSession(normalizedDocId);

      const from = requireOffset(input.from, 'from');
      const to = requireOffset(input.to, 'to');
      if (to < from) {
        throw new EditorServiceError('INVALID_COMMENT_RANGE', 'to must be greater than or equal to from.', 400);
      }

      const text = requireNonEmptyString(input.text, 'text');
      const selectedText = Object.prototype.hasOwnProperty.call(input, 'selectedText')
        ? requireOptionalString(input.selectedText, 'selectedText')
        : null;

      const comment = collaboration.createComment({
        doc_id: normalizedDocId,
        author: normalizedActorId,
        start_offset: from,
        end_offset: to,
        selected_text: selectedText,
        text,
        resolved: false,
      });

      const snapshot = collaboration.getCollaborationSnapshot(normalizedDocId);
      options.broadcaster.broadcastComment(normalizedDocId, { actor: normalizedActorId, action: 'created' });
      void documentCommentMentionResponder?.({
        kind: 'comment',
        docId: normalizedDocId,
        comment,
      });
      return { docId: normalizedDocId, threads: mapCommentThreads(snapshot) };
    },
    replyToComment: (docId: string, actorId: string, commentId: string, input: DocumentCommentReplyCreateInput) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const normalizedActorId = requireNonEmptyString(actorId, 'actorId');
      const normalizedCommentId = requireNonEmptyString(commentId, 'commentId');
      ensureDocumentSession(normalizedDocId);

      const existing = collaboration.getComment(normalizedDocId, normalizedCommentId);
      if (!existing) {
        throw new EditorServiceError('COMMENT_NOT_FOUND', 'Comment was not found.', 404);
      }

      const text = requireNonEmptyString(input.text, 'text');
      const reply = collaboration.createCommentReply({
        doc_id: normalizedDocId,
        comment_id: normalizedCommentId,
        author: normalizedActorId,
        text,
      });

      const snapshot = collaboration.getCollaborationSnapshot(normalizedDocId);
      options.broadcaster.broadcastComment(normalizedDocId, {
        actor: normalizedActorId,
        action: 'replied',
        commentId: normalizedCommentId,
      });
      void documentCommentMentionResponder?.({
        kind: 'reply',
        docId: normalizedDocId,
        comment: existing,
        reply,
      });
      return { docId: normalizedDocId, threads: mapCommentThreads(snapshot) };
    },
    resolveComment: (docId: string, actorId: string, commentId: string, input: DocumentCommentResolveInput) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const normalizedActorId = requireNonEmptyString(actorId, 'actorId');
      const normalizedCommentId = requireNonEmptyString(commentId, 'commentId');
      ensureDocumentSession(normalizedDocId);

      const updated = collaboration.setCommentResolved(normalizedDocId, normalizedCommentId, Boolean(input.resolved));
      if (!updated) {
        throw new EditorServiceError('COMMENT_NOT_FOUND', 'Comment was not found.', 404);
      }

      const snapshot = collaboration.getCollaborationSnapshot(normalizedDocId);
      options.broadcaster.broadcastComment(normalizedDocId, {
        actor: normalizedActorId,
        action: input.resolved ? 'resolved' : 'reopened',
        commentId: normalizedCommentId,
      });
      return { docId: normalizedDocId, threads: mapCommentThreads(snapshot) };
    },
    getSuggestions: (docId: string) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      ensureDocumentSession(normalizedDocId);
      const snapshot = collaboration.getCollaborationSnapshot(normalizedDocId);
      return { docId: normalizedDocId, suggestions: mapSuggestions(snapshot) };
    },
    createSuggestion: (docId: string, actorId: string, input: DocumentSuggestionCreateInput) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const normalizedActorId = requireNonEmptyString(actorId, 'actorId');
      ensureDocumentSession(normalizedDocId);

      const from = requireOffset(input.from, 'from');
      const to = requireOffset(input.to, 'to');
      if (to < from) {
        throw new EditorServiceError('INVALID_SUGGESTION_RANGE', 'to must be greater than or equal to from.', 400);
      }

      const originalText = requireString(input.originalText, 'originalText');
      const suggestedText = requireString(input.suggestedText, 'suggestedText');
      const type =
        typeof input.type === 'undefined'
          ? inferSuggestionType(from, to, suggestedText)
          : normalizeSuggestionType(input.type);
      const reason = Object.prototype.hasOwnProperty.call(input, 'reason') ? requireOptionalString(input.reason, 'reason') : null;

      collaboration.createSuggestion({
        doc_id: normalizedDocId,
        author: normalizedActorId,
        type,
        start_offset: from,
        end_offset: to,
        original_text: originalText,
        suggested_text: suggestedText,
        reason,
        status: 'open',
      });

      const snapshot = collaboration.getCollaborationSnapshot(normalizedDocId);
      options.broadcaster.broadcastSuggestion(normalizedDocId, { actor: normalizedActorId, action: 'created' });
      return { docId: normalizedDocId, suggestions: mapSuggestions(snapshot) };
    },
    acceptSuggestion: async (docId: string, actorId: string, suggestionId: string) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const normalizedActorId = requireNonEmptyString(actorId, 'actorId');
      const normalizedSuggestionId = requireNonEmptyString(suggestionId, 'suggestionId');
      ensureDocumentSession(normalizedDocId);

      const suggestion = collaboration.getSuggestion(normalizedDocId, normalizedSuggestionId);
      if (!suggestion) {
        throw new EditorServiceError('SUGGESTION_NOT_FOUND', 'Suggestion was not found.', 404);
      }

      let updatedAt: string | null = null;
      const session = collaboration.getSessionByDocId(normalizedDocId);
      const sourceId = normalizeOptionalString(session?.source_id ?? null);
      const documentPath = normalizeOptionalString(session?.path ?? null);
      if (sourceId && documentPath) {
        // Accept/reject is primarily a collaboration overlay update. We only attempt to apply
        // the suggested text to the backing source if we can prove it is writable.
        let adapter: FileSourceAdapter | null = null;
        let capabilities: SourceCapability | null = null;
        try {
          const resolved = requireSourceAdapter(sourceId);
          adapter = resolved.adapter;
          capabilities = resolved.capabilities;
        } catch {
          adapter = null;
          capabilities = null;
        }

        if (adapter && capabilities?.write) {
          let existingContent = '';
          try {
            const file = await adapter.read(documentPath);
            existingContent = file.content;
          } catch {
            throw new EditorServiceError('SOURCE_READ_FAILED', 'Unable to read document content from source.', 500);
          }

          const range = requireOffsetRange(
            suggestion.start_offset,
            suggestion.end_offset,
            existingContent.length,
            'suggestion.range'
          );
          const nextContent = `${existingContent.slice(0, range.from)}${suggestion.suggested_text}${existingContent.slice(range.to)}`;

          try {
            const writeResult = await adapter.write(documentPath, nextContent);
            updatedAt = writeResult.updatedAt ?? null;
          } catch {
            throw new EditorServiceError('SOURCE_WRITE_FAILED', 'Unable to persist document content to source.', 500);
          }

          const previousVersion = session?.version ?? 0;
          const contentHash = computeContentHash(nextContent);
          if (session) {
            collaboration.upsertSession({
              id: session.id,
              doc_id: session.doc_id,
              source_id: session.source_id,
              path: session.path,
              content_hash: contentHash,
              version: previousVersion + 1,
            });
          }
        }
      }

      const updated = collaboration.updateSuggestionStatus(normalizedDocId, normalizedSuggestionId, 'accepted');
      if (!updated) {
        throw new EditorServiceError('SUGGESTION_NOT_FOUND', 'Suggestion was not found.', 404);
      }

      const snapshot = collaboration.getCollaborationSnapshot(normalizedDocId);
      options.broadcaster.broadcastSuggestion(normalizedDocId, {
        actor: normalizedActorId,
        action: 'accepted',
        suggestionId: normalizedSuggestionId,
        updatedAt,
      });
      return { docId: normalizedDocId, suggestions: mapSuggestions(snapshot) };
    },
    rejectSuggestion: (docId: string, actorId: string, suggestionId: string) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const normalizedActorId = requireNonEmptyString(actorId, 'actorId');
      const normalizedSuggestionId = requireNonEmptyString(suggestionId, 'suggestionId');
      ensureDocumentSession(normalizedDocId);

      const updated = collaboration.updateSuggestionStatus(normalizedDocId, normalizedSuggestionId, 'rejected');
      if (!updated) {
        throw new EditorServiceError('SUGGESTION_NOT_FOUND', 'Suggestion was not found.', 404);
      }

      const snapshot = collaboration.getCollaborationSnapshot(normalizedDocId);
      options.broadcaster.broadcastSuggestion(normalizedDocId, { actor: normalizedActorId, action: 'rejected', suggestionId: normalizedSuggestionId });
      return { docId: normalizedDocId, suggestions: mapSuggestions(snapshot) };
    },
    createReviewRun: async (docId: string, actorId: string, input: DocumentReviewCreateInput) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const normalizedActorId = requireNonEmptyString(actorId, 'actorId');
      const mode = normalizeReviewMode(input.mode);

      const session = requireSessionForMutation(normalizedDocId);
      const sourceId = normalizeOptionalString(session.source_id);
      if (!sourceId) {
        throw new EditorServiceError('SOURCE_NOT_FOUND', 'Document source is missing.', 404);
      }

      const documentPath = normalizeOptionalString(session.path);
      if (!documentPath) {
        throw new EditorServiceError('DOCUMENT_PATH_MISSING', 'Document path is missing from the session.', 400);
      }

      const { adapter } = requireSourceAdapter(sourceId);
      let existingContent = '';
      try {
        const file = await adapter.read(documentPath);
        existingContent = file.content;
      } catch {
        throw new EditorServiceError('SOURCE_READ_FAILED', 'Unable to read document content from source.', 500);
      }

      const run = collaboration.createReviewRun({
        doc_id: normalizedDocId,
        requested_by: normalizedActorId,
        mode,
        status: 'running',
        result_json: { findings: [] },
      });

      try {
        await fetch(`${openClawBaseUrl}/hooks/review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            docId: normalizedDocId,
            runId: run.id,
            mode,
            sourceId,
            path: documentPath,
            content: existingContent,
            callbackPath: '/api/webhooks/openclaw/review-result',
            requestedBy: normalizedActorId,
            timestamp: new Date().toISOString(),
          }),
        });
      } catch (error) {
        const updated = collaboration.updateReviewRun(normalizedDocId, run.id, {
          status: 'failed',
          result_json: {
            findings: [],
            error: error instanceof Error ? error.message : 'Failed to dispatch OpenClaw review.',
          },
        });

        if (!updated) {
          throw new EditorServiceError('REVIEW_RUN_NOT_FOUND', 'Review run was not found after creation.', 500);
        }

        options.broadcaster.broadcastReview(normalizedDocId, { actor: normalizedActorId, action: 'failed', runId: run.id });
        return { docId: normalizedDocId, run: updated, findings: mapReviewFindings(updated) };
      }

      options.broadcaster.broadcastReview(normalizedDocId, { actor: normalizedActorId, action: 'created', runId: run.id, mode });
      return { docId: normalizedDocId, run, findings: mapReviewFindings(run) };
    },
    getReviewRun: (docId: string, runId: string) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const normalizedRunId = requireNonEmptyString(runId, 'runId');
      const run = collaboration.getReviewRun(normalizedDocId, normalizedRunId);
      if (!run) {
        throw new EditorServiceError('REVIEW_RUN_NOT_FOUND', 'Review run was not found.', 404);
      }
      return { docId: normalizedDocId, run, findings: mapReviewFindings(run) };
    },
    applyReviewFinding: async (docId: string, actorId: string, runId: string, findingId: string) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const normalizedActorId = requireNonEmptyString(actorId, 'actorId');
      const normalizedRunId = requireNonEmptyString(runId, 'runId');
      const normalizedFindingId = requireNonEmptyString(findingId, 'findingId');
      const run = collaboration.getReviewRun(normalizedDocId, normalizedRunId);
      if (!run) {
        throw new EditorServiceError('REVIEW_RUN_NOT_FOUND', 'Review run was not found.', 404);
      }

      const findings = mapReviewFindings(run);
      const finding = findings.find((entry) => entry.id === normalizedFindingId);
      if (!finding) {
        throw new EditorServiceError('FINDING_NOT_FOUND', 'Finding was not found.', 404);
      }

      if (!finding.range || !finding.suggestedFix || typeof finding.suggestedFix.replacement !== 'string') {
        throw new EditorServiceError('FINDING_NOT_APPLICABLE', 'Finding does not include an auto-applicable fix.', 400);
      }

      const session = requireSessionForMutation(normalizedDocId);
      const sourceId = normalizeOptionalString(session.source_id);
      if (!sourceId) {
        throw new EditorServiceError('SOURCE_NOT_FOUND', 'Document source is missing.', 404);
      }
      const documentPath = normalizeOptionalString(session.path);
      if (!documentPath) {
        throw new EditorServiceError('DOCUMENT_PATH_MISSING', 'Document path is missing from the session.', 400);
      }

      const { adapter, capabilities } = requireSourceAdapter(sourceId);
      if (!capabilities.write) {
        throw new EditorServiceError('SOURCE_READ_ONLY', 'Source does not allow write mutations for this document.', 403);
      }

      let existingContent = '';
      try {
        const file = await adapter.read(documentPath);
        existingContent = file.content;
      } catch {
        throw new EditorServiceError('SOURCE_READ_FAILED', 'Unable to read document content from source.', 500);
      }

      const range = requireOffsetRange(finding.range.from, finding.range.to, existingContent.length, 'finding.range');
      const nextContent = `${existingContent.slice(0, range.from)}${finding.suggestedFix.replacement}${existingContent.slice(range.to)}`;

      try {
        await adapter.write(documentPath, nextContent);
      } catch {
        throw new EditorServiceError('SOURCE_WRITE_FAILED', 'Unable to persist document content to source.', 500);
      }

      const previousVersion = session.version;
      const contentHash = computeContentHash(nextContent);
      collaboration.upsertSession({
        id: session.id,
        doc_id: session.doc_id,
        source_id: session.source_id,
        path: session.path,
        content_hash: contentHash,
        version: previousVersion + 1,
      });

      const nextJson = updateFindingsStatusJson(run, normalizedFindingId, 'applied');
      const updatedRun = collaboration.updateReviewRun(normalizedDocId, normalizedRunId, { result_json: nextJson }) ?? run;
      options.broadcaster.broadcastReview(normalizedDocId, { actor: normalizedActorId, action: 'applied', runId: normalizedRunId, findingId: normalizedFindingId });
      return { docId: normalizedDocId, run: updatedRun, findings: mapReviewFindings(updatedRun) };
    },
    ignoreReviewFinding: (docId: string, actorId: string, runId: string, findingId: string) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const normalizedActorId = requireNonEmptyString(actorId, 'actorId');
      const normalizedRunId = requireNonEmptyString(runId, 'runId');
      const normalizedFindingId = requireNonEmptyString(findingId, 'findingId');
      const run = collaboration.getReviewRun(normalizedDocId, normalizedRunId);
      if (!run) {
        throw new EditorServiceError('REVIEW_RUN_NOT_FOUND', 'Review run was not found.', 404);
      }

      const nextJson = updateFindingsStatusJson(run, normalizedFindingId, 'ignored');
      const updatedRun = collaboration.updateReviewRun(normalizedDocId, normalizedRunId, { result_json: nextJson });
      if (!updatedRun) {
        throw new EditorServiceError('REVIEW_RUN_NOT_FOUND', 'Review run was not found.', 404);
      }

      options.broadcaster.broadcastReview(normalizedDocId, { actor: normalizedActorId, action: 'ignored', runId: normalizedRunId, findingId: normalizedFindingId });
      return { docId: normalizedDocId, run: updatedRun, findings: mapReviewFindings(updatedRun) };
    },
    receiveReviewResult: (payload: DocumentReviewWebhookPayload) => {
      const normalizedDocId = requireNonEmptyString(payload.docId, 'docId');
      const normalizedRunId = requireNonEmptyString(payload.runId, 'runId');
      const status = normalizeReviewStatus(payload.status);

      const existing = collaboration.getReviewRun(normalizedDocId, normalizedRunId);
      if (!existing) {
        throw new EditorServiceError('REVIEW_RUN_NOT_FOUND', 'Review run was not found.', 404);
      }

      const findings = Array.isArray(payload.findings) ? payload.findings : [];
      const nextJson: JsonValue = {
        ...(isJsonObject(existing.result_json) ? (existing.result_json as Record<string, JsonValue>) : {}),
        findings,
      };
      const updatedRun = collaboration.updateReviewRun(normalizedDocId, normalizedRunId, { status, result_json: nextJson });
      if (!updatedRun) {
        throw new EditorServiceError('REVIEW_RUN_NOT_FOUND', 'Review run was not found.', 404);
      }

      options.broadcaster.broadcastReview(normalizedDocId, { actor: 'system-reviewer', action: 'result', runId: normalizedRunId, status });
      return { docId: normalizedDocId, run: updatedRun, findings: mapReviewFindings(updatedRun) };
    },
    applyEdit: async (docId: string, actorId: string, input: DocumentEditInput) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const normalizedActorId = requireNonEmptyString(actorId, 'actorId');

      const from = requireOffset(input.from, 'from');
      const to = requireOffset(input.to, 'to');
      if (to < from) {
        throw new EditorServiceError('INVALID_EDIT_RANGE', 'to must be greater than or equal to from.', 400);
      }

      const insert = requireString(input.insert, 'insert');
      const attribution = normalizedActorId;
      const clientVersion = normalizeOptionalInteger(input.clientVersion);

      const session = requireSessionForMutation(normalizedDocId);

      const sourceId = normalizeOptionalString(session.source_id);
      if (!sourceId) {
        throw new EditorServiceError('SOURCE_NOT_FOUND', 'Document source is missing.', 404);
      }

      const documentPath = normalizeOptionalString(session.path);
      if (!documentPath) {
        throw new EditorServiceError('DOCUMENT_PATH_MISSING', 'Document path is missing from the session.', 400);
      }

      const { adapter, capabilities } = requireSourceAdapter(sourceId);
      if (!capabilities.write) {
        throw new EditorServiceError(
          'SOURCE_READ_ONLY',
          'Source does not allow write mutations for this document.',
          403
        );
      }

      if (clientVersion !== null && clientVersion !== session.version) {
        throw new EditorServiceError(
          'VERSION_CONFLICT',
          `Document version mismatch. Expected ${session.version}, received ${clientVersion}.`,
          409
        );
      }

      let existingContent = '';
      try {
        const file = await adapter.read(documentPath);
        existingContent = file.content;
      } catch {
        throw new EditorServiceError('SOURCE_READ_FAILED', 'Unable to read document content from source.', 500);
      }

      if (to > existingContent.length) {
        throw new EditorServiceError(
          'INVALID_EDIT_RANGE',
          `Edit range [${from}, ${to}] exceeds document length ${existingContent.length}.`,
          400
        );
      }

      const nextContent = `${existingContent.slice(0, from)}${insert}${existingContent.slice(to)}`;
      let updatedAt: string | null = null;
      try {
        const writeResult = await adapter.write(documentPath, nextContent);
        updatedAt = writeResult.updatedAt ?? null;
      } catch {
        throw new EditorServiceError('SOURCE_WRITE_FAILED', 'Unable to persist document content to source.', 500);
      }

      const previousVersion = session.version;
      const contentHash = computeContentHash(nextContent);
      const nextSession = collaboration.upsertSession({
        id: session.id,
        doc_id: session.doc_id,
        source_id: session.source_id,
        path: session.path,
        content_hash: contentHash,
        version: previousVersion + 1,
      });

      return {
        docId: normalizedDocId,
        actorId: normalizedActorId,
        attribution,
        sourceId: nextSession.source_id,
        path: nextSession.path,
        from,
        to,
        insert,
        previousVersion,
        version: nextSession.version,
        contentHash,
        contentLength: nextContent.length,
        updatedAt,
      };
    },
    upsertAuthorship: (docId: string, actorId: string, input: DocumentAuthorshipInput) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const normalizedActorId = requireNonEmptyString(actorId, 'actorId');
      const from = requireAuthorshipOffset(input.from, 'from');
      const to = requireAuthorshipOffset(input.to, 'to');
      if (to <= from) {
        throw new EditorServiceError(
          'INVALID_AUTHORSHIP_RANGE',
          'to must be greater than from for authorship attribution.',
          400
        );
      }

      const author = requireAuthorshipActor(input.author);
      const session = collaboration.getSessionByDocId(normalizedDocId);
      if (!session) {
        throw new EditorServiceError('DOC_SESSION_NOT_FOUND', 'No document session exists for the provided docId.', 404);
      }

      const existingRange = collaboration
        .listAuthorshipRanges(normalizedDocId)
        .find((entry) => entry.start_offset === from && entry.end_offset === to);

      let range: DocumentAuthorshipRangeRecord | null = null;
      let toggledOff = false;

      if (existingRange && existingRange.author === author) {
        toggledOff = collaboration.deleteAuthorshipRange(normalizedDocId, existingRange.id);
        collaboration.createAuthorshipHistory({
          doc_id: normalizedDocId,
          range_id: existingRange.id,
          author: normalizedActorId,
          diff_json: {
            action: toggledOff ? 'toggle_off' : 'toggle_off_noop',
            from,
            to,
            author,
            previousAuthor: existingRange.author,
            reviewed: existingRange.reviewed,
          },
          timestamp: new Date().toISOString(),
        });
      } else {
        range = collaboration.upsertAuthorshipRange({
          id: existingRange?.id,
          doc_id: normalizedDocId,
          start_offset: from,
          end_offset: to,
          author,
          reviewed: existingRange?.reviewed ?? false,
        });

        collaboration.createAuthorshipHistory({
          doc_id: normalizedDocId,
          range_id: range.id,
          author: normalizedActorId,
          diff_json: {
            action: existingRange ? 'toggle_update' : 'toggle_on',
            from,
            to,
            author,
            previousAuthor: existingRange?.author ?? null,
            previousReviewed: existingRange?.reviewed ?? null,
          },
          timestamp: new Date().toISOString(),
        });
      }

      const snapshot = collaboration.getCollaborationSnapshot(normalizedDocId);
      return {
        docId: normalizedDocId,
        actorId: normalizedActorId,
        from,
        to,
        author,
        toggledOff,
        range,
        authorshipStats: buildAuthorshipStats(snapshot),
        collaboration: snapshot,
      };
    },
    upsertCursorPresence: (docId: string, actorId: string, input: CursorPresenceUpdateInput) => {
      const normalizedDocId = requireNonEmptyString(docId, 'docId');
      const normalizedActorId = requireNonEmptyString(actorId, 'actorId');
      const existingPresence = collaboration
        .listPresence(normalizedDocId)
        .find((entry) => entry.agent_id === normalizedActorId);
      const action = normalizeOptionalString(input.action);
      const cursorPatch = buildCursorPatch(input, action);
      const mergedCursor = mergeCursorPatch(existingPresence?.cursor_json ?? {}, cursorPatch);
      const status = normalizePresenceStatus(input.status, existingPresence?.status ?? 'active');

      const presence = collaboration.upsertPresence({
        doc_id: normalizedDocId,
        agent_id: normalizedActorId,
        status,
        cursor_json: mergedCursor,
        last_activity_at: new Date().toISOString(),
      });

      return {
        docId: normalizedDocId,
        actorId: normalizedActorId,
        action,
        presence,
      };
    },
  };
}
