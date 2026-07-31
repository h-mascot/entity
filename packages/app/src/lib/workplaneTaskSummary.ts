/**
 * THE-862 / WP1-B-01 — Workplane task summary view model + load helpers.
 *
 * Pure normalize/build for the task summary panel. Consumes the same
 * `/tasks/:id` detail shape TaskDetailPanel already uses; does not invent
 * Engineering board data or touch proof-bundle normalization (THE-863+).
 */

import {
  deriveMissingEvidenceState,
  extractTaskOutputLinks,
  hasReviewMetadata,
} from '../components/mission-control/taskDetailWorkplaneSeams.ts';
import { HttpRequestError, buildApiCandidates, requestJsonWithFallback, toErrorMessage } from './http.ts';

export type WorkplaneTaskSummaryLoadStatus = 'empty' | 'loading' | 'error' | 'ready';

const STATUS_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  doing: 'Doing',
  review: 'Review',
  done: 'Done',
};

const PRIORITY_SET = new Set(['P0', 'P1', 'P2', 'P3']);

/** Concise operator-facing summary for the active Workplane task. */
export interface WorkplaneTaskSummaryView {
  taskId: number;
  /** Stable display identifier, e.g. `#42`. */
  identifier: string;
  title: string;
  statusKey: string;
  statusLabel: string;
  priority: string | null;
  assignee: string | null;
  blocked: boolean;
  blockerReason: string | null;
  descriptionPreview: string | null;
  reviewLabel: string | null;
  reviewState: string | null;
  proofSummary: string | null;
  missingProof: boolean;
  missingProofReason: string | null;
}

export interface WorkplaneTaskSummaryLoadState {
  status: WorkplaneTaskSummaryLoadStatus;
  taskId: number | null;
  summary: WorkplaneTaskSummaryView | null;
  errorMessage: string | null;
}

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

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    return Number.isInteger(n) && n >= 1 ? n : null;
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

function normalizeStatusKey(value: unknown): string {
  const raw = readNonEmptyString(value)?.toLowerCase() ?? 'backlog';
  return STATUS_LABELS[raw] ? raw : 'backlog';
}

function previewText(value: string | null | undefined, max = 220): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function resolveReviewLabel(
  record: Record<string, unknown>,
  metadata: Record<string, unknown>,
): { reviewLabel: string | null; reviewState: string | null } {
  const reviewRequired = normalizeBoolean(
    record.review_required ?? record.reviewRequired ?? metadata.review_required ?? metadata.reviewRequired,
  );
  const reviewState = readFirstString(
    record.review_state,
    record.reviewState,
    metadata.review_state,
    metadata.reviewState,
    metadata.review_decision,
  );
  const hasMeta = hasReviewMetadata(metadata);

  if (!reviewRequired && !hasMeta && !reviewState) {
    return { reviewLabel: null, reviewState: null };
  }

  if (!reviewRequired && reviewState === 'not_required') {
    return { reviewLabel: 'Review not required', reviewState: 'not_required' };
  }

  const state = reviewState && reviewState !== 'not_required' ? reviewState : reviewRequired ? 'pending' : null;
  if (!state) {
    return {
      reviewLabel: hasMeta ? 'Review metadata present' : null,
      reviewState: null,
    };
  }

  const label =
    state === 'pending'
      ? 'Review pending'
      : state === 'approved'
        ? 'Review approved'
        : state === 'rejected'
          ? 'Review rejected'
          : `Review: ${state}`;

  return { reviewLabel: label, reviewState: state };
}

/**
 * Build a concise task summary from a task detail / board payload.
 * Returns null when id/title are missing (empty / invalid payload).
 */
export function buildWorkplaneTaskSummary(raw: unknown): WorkplaneTaskSummaryView | null {
  const record = toRecord(raw);
  if (!record) return null;

  const taskId = normalizePositiveInteger(record.id);
  const title = readNonEmptyString(record.name);
  if (!taskId || !title) return null;

  const metadata = parseJsonRecord(record.metadata) ?? {};
  const statusKey = normalizeStatusKey(record.column);
  const statusLabel = STATUS_LABELS[statusKey] ?? statusKey;
  const priorityRaw = readFirstString(record.priority, metadata.priority)?.toUpperCase() ?? null;
  const priority = priorityRaw && PRIORITY_SET.has(priorityRaw) ? priorityRaw : null;
  const assignee = readFirstString(record.assignee, metadata.assignee);
  const blocked = normalizeBoolean(record.blocked ?? metadata.blocked);
  const blockerReason = blocked
    ? readFirstString(record.blocker_reason, record.blockerReason, metadata.blocker_reason)
    : null;
  const descriptionPreview = previewText(
    readFirstString(record.description, metadata.description) ?? '',
  );
  const output = readFirstString(record.output, metadata.output) ?? '';
  const outputLinks = extractTaskOutputLinks(output);
  const receipt = parseJsonRecord(metadata.phase2_receipt ?? metadata.receipt);
  const reviewPacket = parseJsonRecord(metadata.review_packet ?? metadata.review_brief);
  const evidenceLinks = Array.isArray(metadata.evidence_links)
    ? metadata.evidence_links
    : Array.isArray(metadata.evidence_artifacts)
      ? metadata.evidence_artifacts
      : [];

  const missing = deriveMissingEvidenceState({
    column: statusKey,
    metadata,
    receipt,
    reviewPacket,
    evidenceLinkCount: evidenceLinks.length,
    outputLinkCount: outputLinks.length,
  });

  const { reviewLabel, reviewState } = resolveReviewLabel(record, metadata);

  return {
    taskId,
    identifier: `#${taskId}`,
    title,
    statusKey,
    statusLabel,
    priority,
    assignee: assignee && assignee.toLowerCase() !== 'unassigned' ? assignee : null,
    blocked,
    blockerReason,
    descriptionPreview,
    reviewLabel,
    reviewState,
    proofSummary: previewText(missing.evidenceSummary, 160),
    missingProof: missing.missingEvidence,
    missingProofReason: missing.missingEvidenceReason,
  };
}

/** Explicit empty/loading/error/ready load envelope for the summary panel. */
export function createWorkplaneTaskSummaryLoadState(
  input: {
    taskId?: number | null;
    status?: WorkplaneTaskSummaryLoadStatus;
    summary?: WorkplaneTaskSummaryView | null;
    errorMessage?: string | null;
  } = {},
): WorkplaneTaskSummaryLoadState {
  const taskId =
    typeof input.taskId === 'number' && Number.isInteger(input.taskId) && input.taskId >= 1
      ? input.taskId
      : null;

  if (input.status === 'loading') {
    return {
      status: 'loading',
      taskId,
      summary: null,
      errorMessage: null,
    };
  }

  if (input.status === 'error') {
    return {
      status: 'error',
      taskId,
      summary: null,
      errorMessage: readNonEmptyString(input.errorMessage) ?? 'Unable to load task summary.',
    };
  }

  if (input.status === 'ready' && input.summary) {
    return {
      status: 'ready',
      taskId: input.summary.taskId,
      summary: input.summary,
      errorMessage: null,
    };
  }

  // empty: no task id, missing task, or invalid/null payload
  return {
    status: 'empty',
    taskId,
    summary: null,
    errorMessage: null,
  };
}

/**
 * Fetch task detail for Workplane summary.
 * Returns null for missing task (404 / invalid payload) — caller maps to empty.
 * Throws for transport / server failures — caller maps to error.
 */
export async function fetchWorkplaneTaskSummary(
  taskId: number,
  apiBase = '',
): Promise<WorkplaneTaskSummaryView | null> {
  if (!Number.isInteger(taskId) || taskId < 1) {
    return null;
  }

  try {
    const payload = await requestJsonWithFallback({
      urls: buildApiCandidates(`/tasks/${taskId}`, apiBase),
      init: { method: 'GET' },
      continueOnStatuses: [],
      fallbackError: 'Unable to load task summary.',
    });
    return buildWorkplaneTaskSummary(payload);
  } catch (error) {
    if (error instanceof HttpRequestError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export function workplaneTaskSummaryErrorMessage(error: unknown): string {
  return toErrorMessage(error, 'Unable to load task summary.');
}
