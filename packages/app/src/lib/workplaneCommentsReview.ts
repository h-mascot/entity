/**
 * THE-873 / WP1-C-05 — Workplane comments/review checklist load helpers.
 *
 * Reuses existing task truth (`GET /tasks/:id` + `GET /tasks/:id/comments`) and
 * reviewActions semantics (normalizeReviewDecision / REVIEW_DECISION_LABELS /
 * reviewActionToDecision). No new task store. Fail-closed empty/loading/error;
 * reviewReady defaults false until THE-874 / WP1-C-06 gate stamps it.
 */

import {
  REVIEW_DECISION_LABELS,
  normalizeReviewDecision,
  reviewActionToDecision,
  type ReviewAction,
  type ReviewDecision,
} from '../components/mission-control/reviewActions.ts';
import { hasReviewMetadata } from '../components/mission-control/taskDetailWorkplaneSeams.ts';
import { HttpRequestError, buildApiCandidates, requestJsonWithFallback, toErrorMessage } from './http.ts';

export type WorkplaneCommentsReviewLoadStatus = 'empty' | 'loading' | 'error' | 'ready';

export interface WorkplaneCommentItem {
  id: number;
  taskId: number;
  body: string;
  author: string;
  parentId: number | null;
  createdAt: string;
}

export type ReviewChecklistItemStatus = 'pending' | 'done' | 'blocked' | 'info';

export type ReviewChecklistItemSource =
  | 'review_decision'
  | 'reviewer'
  | 'review_type'
  | 'done_criteria'
  | 'human_gate'
  | 'henry_required';

export interface ReviewChecklistItem {
  id: string;
  label: string;
  status: ReviewChecklistItemStatus;
  source: ReviewChecklistItemSource;
}

export interface CommentsReviewWarning {
  code: string;
  message: string;
}

/** Available board review actions surfaced for checklist context (read-only). */
export interface CommentsReviewActionView {
  action: ReviewAction;
  label: string;
  decision: ReviewDecision;
  decisionLabel: string;
}

export interface CommentsReviewBundle {
  taskId: number | null;
  taskTitle: string | null;
  decision: ReviewDecision;
  decisionLabel: string;
  reviewer: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  reviewType: string | null;
  reviewRequired: boolean;
  humanGateRequired: boolean;
  humanGateState: string | null;
  hasReviewMetadata: boolean;
  packetSummary: string | null;
  checklist: ReviewChecklistItem[];
  availableActions: CommentsReviewActionView[];
  comments: WorkplaneCommentItem[];
  commentsAvailable: boolean;
  commentsEmpty: boolean;
  /** Explicit empty review + comments content (still a ready envelope). */
  empty: boolean;
  degraded: boolean;
  warnings: CommentsReviewWarning[];
  /**
   * Presentation flag stamped by THE-874 / WP1-C-06 review gate.
   * Builders default to false; WorkplaneShell applies evaluateWorkplaneReviewGate.
   */
  reviewReady: boolean;
}

export interface WorkplaneCommentsReviewLoadState {
  status: WorkplaneCommentsReviewLoadStatus;
  taskId: number | null;
  bundle: CommentsReviewBundle | null;
  errorMessage: string | null;
}

export const REVIEW_CHECKLIST_ACTION_VIEWS: readonly CommentsReviewActionView[] = Object.freeze([
  {
    action: 'accept',
    label: 'Accept review',
    decision: reviewActionToDecision('accept'),
    decisionLabel: REVIEW_DECISION_LABELS[reviewActionToDecision('accept')],
  },
  {
    action: 'accept_done',
    label: 'Accept + Done',
    decision: reviewActionToDecision('accept_done'),
    decisionLabel: REVIEW_DECISION_LABELS[reviewActionToDecision('accept_done')],
  },
  {
    action: 'needs_fix',
    label: 'Request fix',
    decision: reviewActionToDecision('needs_fix'),
    decisionLabel: REVIEW_DECISION_LABELS[reviewActionToDecision('needs_fix')],
  },
  {
    action: 'reject',
    label: 'Reject',
    decision: reviewActionToDecision('reject'),
    decisionLabel: REVIEW_DECISION_LABELS[reviewActionToDecision('reject')],
  },
]);

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return toRecord(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  return toRecord(value);
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readFirstString(...values: unknown[]): string | null {
  for (const value of values) {
    const next = readNonEmptyString(value);
    if (next) return next;
  }
  return null;
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }
  return false;
}

function readPositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    return Number.isInteger(n) && n >= 1 ? n : null;
  }
  return null;
}

function normalizeTimestamp(value: unknown): string {
  const raw = readNonEmptyString(value);
  if (!raw) return '';
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : raw;
}

/**
 * Summary of review_packet / review_brief (extracted from TaskDetailPanel seam).
 */
export function buildReviewPacketSummary(metadata: Record<string, unknown>): string | null {
  const packet = parseJsonRecord(metadata.review_packet) ?? parseJsonRecord(metadata.review_brief);
  if (!packet) {
    return null;
  }

  const outcome = readFirstString(packet.requested_outcome, packet.outcome) ?? 'Outcome not set';
  const criteria = Array.isArray(packet.done_criteria)
    ? packet.done_criteria.map((entry) => readNonEmptyString(entry)).filter(Boolean).length
    : readNonEmptyString(packet.done_criteria)
      ? 1
      : 0;
  return `${outcome}${criteria > 0 ? ` / ${criteria} ${criteria === 1 ? 'criterion' : 'criteria'}` : ''}`;
}

function decisionChecklistStatus(decision: ReviewDecision): ReviewChecklistItemStatus {
  if (decision === 'accepted') return 'done';
  if (decision === 'rejected' || decision === 'needs_fix') return 'blocked';
  return 'pending';
}

function buildChecklist(
  metadata: Record<string, unknown>,
  decision: ReviewDecision,
  options: {
    reviewer: string | null;
    reviewType: string | null;
    reviewRequired: boolean;
    humanGateRequired: boolean;
    humanGateState: string | null;
  },
): ReviewChecklistItem[] {
  const items: ReviewChecklistItem[] = [];

  items.push({
    id: 'review-decision',
    label: `Review decision: ${REVIEW_DECISION_LABELS[decision]}`,
    status: decisionChecklistStatus(decision),
    source: 'review_decision',
  });

  if (options.reviewRequired || options.reviewer) {
    items.push({
      id: 'reviewer',
      label: options.reviewer
        ? `Eligible reviewer: ${options.reviewer}`
        : 'Eligible reviewer: unassigned',
      status: options.reviewer ? 'done' : 'pending',
      source: 'reviewer',
    });
  }

  if (options.reviewType) {
    items.push({
      id: 'review-type',
      label: `Review type: ${options.reviewType}`,
      status: 'info',
      source: 'review_type',
    });
  }

  const packet = parseJsonRecord(metadata.review_packet) ?? parseJsonRecord(metadata.review_brief);
  if (packet) {
    const criteria = Array.isArray(packet.done_criteria)
      ? packet.done_criteria
      : readNonEmptyString(packet.done_criteria)
        ? [packet.done_criteria]
        : [];
    criteria.forEach((entry, index) => {
      const label = readNonEmptyString(entry);
      if (!label) return;
      items.push({
        id: `done-criteria-${index + 1}`,
        label,
        status: decision === 'accepted' ? 'done' : 'pending',
        source: 'done_criteria',
      });
    });
  }

  if (options.humanGateRequired || options.humanGateState) {
    const gateState = options.humanGateState ?? 'pending';
    const gateStatus: ReviewChecklistItemStatus =
      gateState === 'approved'
        ? 'done'
        : gateState === 'rejected'
          ? 'blocked'
          : 'pending';
    items.push({
      id: 'human-gate',
      label: `Human gate: ${gateState}`,
      status: gateStatus,
      source: 'human_gate',
    });
  }

  if (normalizeBoolean(metadata.henry_required ?? metadata.requires_henry)) {
    items.push({
      id: 'henry-required',
      label: 'Henry review required',
      status: decision === 'accepted' ? 'done' : 'pending',
      source: 'henry_required',
    });
  }

  return items;
}

export function normalizeWorkplaneComment(raw: unknown): WorkplaneCommentItem | null {
  const record = toRecord(raw);
  if (!record) return null;
  const id = readPositiveInteger(record.id);
  if (!id) return null;
  const body = readNonEmptyString(record.body) ?? '';
  return {
    id,
    taskId: readPositiveInteger(record.task_id ?? record.taskId) ?? 0,
    body,
    author: readFirstString(record.author, record.user) ?? 'Human',
    parentId: readPositiveInteger(record.parent_id ?? record.parentId),
    createdAt: normalizeTimestamp(record.created_at ?? record.createdAt),
  };
}

/**
 * Build comments/review checklist bundle from task detail + comments payloads.
 * Returns null when task id/title are missing (empty / invalid task).
 */
export function buildCommentsReviewBundle(input: {
  task: unknown;
  comments?: unknown;
  commentsAvailable?: boolean;
}): CommentsReviewBundle | null {
  const record = toRecord(input.task);
  if (!record) return null;

  const taskId = readPositiveInteger(record.id);
  const taskTitle = readNonEmptyString(record.name);
  if (!taskId || !taskTitle) return null;

  const metadata = parseJsonRecord(record.metadata) ?? {};
  // Prefer an explicit metadata decision when column-level review_state is
  // absent or the sentinel `not_required` (otherwise normalize → pending and
  // THE-874 cannot treat accepted+proof as review-ready).
  const columnReviewState = record.review_state ?? record.reviewState;
  const columnNormalized =
    typeof columnReviewState === 'string'
      ? columnReviewState.trim().toLowerCase().replace(/[\s-]+/g, '_')
      : '';
  const decisionSource =
    columnNormalized && columnNormalized !== 'not_required'
      ? columnReviewState
      : (metadata.review_decision ??
        metadata.review_state ??
        metadata.reviewState ??
        columnReviewState);
  const decision = normalizeReviewDecision(decisionSource);
  const reviewer = readFirstString(
    record.reviewer_principal_id,
    record.reviewerPrincipalId,
    record.reviewer,
    metadata.reviewed_by,
    metadata.reviewer,
    metadata.review_owner,
  );
  const reviewedAt = readFirstString(metadata.reviewed_at, metadata.reviewedAt);
  const reviewNote = readFirstString(
    metadata.review_note,
    metadata.review_decision_reason,
    metadata.reviewDecisionReason,
  );
  const reviewType = readFirstString(
    metadata.review_type,
    metadata.review_class,
    metadata.reviewType,
  );
  const reviewRequired =
    normalizeBoolean(record.review_required ?? record.reviewRequired) ||
    normalizeBoolean(metadata.review_required ?? metadata.reviewRequired);
  const humanGateRequired =
    normalizeBoolean(record.human_gate_required ?? record.humanGateRequired) ||
    normalizeBoolean(metadata.human_gate_required ?? metadata.humanGateRequired);
  const humanGateState = readFirstString(
    record.human_gate_state,
    record.humanGateState,
    metadata.human_gate_state,
    metadata.human_gate_decision,
  );
  const packetSummary = buildReviewPacketSummary(metadata);
  const reviewMetaPresent = hasReviewMetadata(metadata) || reviewRequired || Boolean(humanGateState);

  const commentsAvailable = input.commentsAvailable !== false;
  const warnings: CommentsReviewWarning[] = [];
  let comments: WorkplaneCommentItem[] = [];

  if (!commentsAvailable) {
    warnings.push({
      code: 'comments_unavailable',
      message: 'Comments endpoint unavailable. Review checklist still uses task metadata.',
    });
  } else if (input.comments !== undefined && input.comments !== null && !Array.isArray(input.comments)) {
    warnings.push({
      code: 'comments_malformed',
      message: 'Comments payload was malformed and was ignored.',
    });
  } else if (Array.isArray(input.comments)) {
    comments = input.comments
      .map(normalizeWorkplaneComment)
      .filter((entry): entry is WorkplaneCommentItem => entry !== null);
    const skipped = input.comments.length - comments.length;
    if (skipped > 0) {
      warnings.push({
        code: 'comments_skipped',
        message: `${skipped} comment(s) were skipped as invalid.`,
      });
    }
  }

  const checklist = buildChecklist(metadata, decision, {
    reviewer,
    reviewType,
    reviewRequired,
    humanGateRequired,
    humanGateState,
  });

  const commentsEmpty = comments.length === 0;
  const empty = !reviewMetaPresent && commentsEmpty && checklist.length <= 1 && decision === 'pending';

  return {
    taskId,
    taskTitle,
    decision,
    decisionLabel: REVIEW_DECISION_LABELS[decision],
    reviewer,
    reviewedAt,
    reviewNote,
    reviewType,
    reviewRequired,
    humanGateRequired,
    humanGateState,
    hasReviewMetadata: reviewMetaPresent,
    packetSummary,
    checklist,
    availableActions: [...REVIEW_CHECKLIST_ACTION_VIEWS],
    comments,
    commentsAvailable,
    commentsEmpty,
    empty,
    degraded: warnings.length > 0,
    warnings,
    // Fail-closed until WP1-C-06 gate evaluates proof + review together.
    reviewReady: false,
  };
}

/** Explicit empty/loading/error/ready load envelope. */
export function createWorkplaneCommentsReviewLoadState(
  input: {
    taskId?: number | null;
    status?: WorkplaneCommentsReviewLoadStatus;
    bundle?: CommentsReviewBundle | null;
    errorMessage?: string | null;
  } = {},
): WorkplaneCommentsReviewLoadState {
  const taskId =
    typeof input.taskId === 'number' && Number.isInteger(input.taskId) && input.taskId >= 1
      ? input.taskId
      : null;

  if (input.status === 'loading') {
    return {
      status: 'loading',
      taskId,
      bundle: null,
      errorMessage: null,
    };
  }

  if (input.status === 'error') {
    return {
      status: 'error',
      taskId,
      bundle: null,
      errorMessage:
        readNonEmptyString(input.errorMessage) ?? 'Unable to load comments and review checklist.',
    };
  }

  if (input.status === 'ready' && input.bundle) {
    return {
      status: 'ready',
      taskId: input.bundle.taskId ?? taskId,
      bundle: {
        ...input.bundle,
        reviewReady: false,
      },
      errorMessage: null,
    };
  }

  return {
    status: 'empty',
    taskId,
    bundle: null,
    errorMessage: null,
  };
}

async function fetchTaskCommentsPayload(
  taskId: number,
  apiBase: string,
): Promise<{ comments: unknown; available: boolean }> {
  try {
    const payload = await requestJsonWithFallback({
      urls: buildApiCandidates(`/tasks/${taskId}/comments`, apiBase),
      init: { method: 'GET' },
      continueOnStatuses: [],
      fallbackError: 'Unable to load task comments.',
    });
    return { comments: payload, available: true };
  } catch (error) {
    if (error instanceof HttpRequestError && (error.status === 404 || error.status === 501)) {
      return { comments: [], available: false };
    }
    if (error instanceof HttpRequestError && (error.status === 401 || error.status === 403)) {
      return { comments: [], available: false };
    }
    // Soft-degrade comments; review metadata from task still usable.
    return { comments: [], available: false };
  }
}

/**
 * Fetch task + comments and build the comments/review checklist bundle.
 * Returns null for missing task (404) — caller maps to empty.
 * Throws when task detail fails (non-404) — caller maps to error.
 */
export async function fetchWorkplaneCommentsReview(
  taskId: number,
  apiBase = '',
): Promise<CommentsReviewBundle | null> {
  if (!Number.isInteger(taskId) || taskId < 1) {
    return null;
  }

  let taskPayload: unknown;
  try {
    taskPayload = await requestJsonWithFallback({
      urls: buildApiCandidates(`/tasks/${taskId}`, apiBase),
      init: { method: 'GET' },
      continueOnStatuses: [],
      fallbackError: 'Unable to load task for comments/review checklist.',
    });
  } catch (error) {
    if (error instanceof HttpRequestError && error.status === 404) {
      return null;
    }
    throw error;
  }

  const commentsResult = await fetchTaskCommentsPayload(taskId, apiBase);
  return buildCommentsReviewBundle({
    task: taskPayload,
    comments: commentsResult.comments,
    commentsAvailable: commentsResult.available,
  });
}

export function workplaneCommentsReviewErrorMessage(error: unknown): string {
  return toErrorMessage(error, 'Unable to load comments and review checklist.');
}
