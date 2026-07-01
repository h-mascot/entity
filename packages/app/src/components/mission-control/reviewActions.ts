export type ReviewDecision = 'pending' | 'accepted' | 'needs_fix' | 'rejected';

/** The actions offered by the board review modal. */
export type ReviewAction = 'accept' | 'accept_done' | 'needs_fix' | 'reject';

export function reviewActionToDecision(action: ReviewAction): ReviewDecision {
  if (action === 'reject') return 'rejected';
  if (action === 'needs_fix') return 'needs_fix';
  return 'accepted';
}

export const REVIEW_DECISION_LABELS: Record<ReviewDecision, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  needs_fix: 'Needs fix',
  rejected: 'Rejected',
};

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readSupportedReviewType(value: unknown): string {
  const normalized = readString(value).toLowerCase();
  return normalized === 'henry' || normalized === 'peer' || normalized === 'auto' ? normalized : '';
}

export function normalizeReviewDecision(value: unknown): ReviewDecision {
  const normalized = readString(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'accepted' || normalized === 'needs_fix' || normalized === 'rejected') {
    return normalized;
  }
  return 'pending';
}

export interface BuildReviewMetadataOptions {
  decision: ReviewDecision;
  reviewer: string;
  /** Substantive review note; only written when non-empty (server requires ≥20 chars to complete). */
  note?: string;
  /** Fill `review_type` from the existing value or default to `peer` (used by the board completion flow). */
  ensureReviewType?: boolean;
}

/**
 * Single source of truth for the review-decision metadata patch written by both
 * the task detail panel and the board's review modal. Preserves existing
 * metadata and stamps the decision + reviewer + timestamp; optionally ensures a
 * review_type and attaches a review note.
 */
export function buildReviewDecisionMetadata(
  metadataRecord: Record<string, unknown>,
  { decision, reviewer, note, ensureReviewType }: BuildReviewMetadataOptions,
): string {
  const next: Record<string, unknown> = {
    ...metadataRecord,
    review_decision: decision,
    reviewed_by: reviewer,
    reviewed_at: new Date().toISOString(),
  };
  if (ensureReviewType) {
    next.review_type =
      readSupportedReviewType(metadataRecord.review_type) || readSupportedReviewType(metadataRecord.review_class) || 'peer';
  }
  const trimmedNote = note?.trim();
  if (trimmedNote) {
    next.review_note = trimmedNote;
  }
  return JSON.stringify(next);
}
