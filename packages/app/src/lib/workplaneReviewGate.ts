/**
 * THE-874 / WP1-C-06 — Workplane review-ready gate.
 *
 * Combines missing-proof warnings (THE-866) with comments/review checklist
 * (THE-873) so missing/degraded/unavailable proof can never present as
 * review-ready. Fail-closed: unknown/loading/error states block readiness.
 */

import type { WorkplaneCommentsReviewLoadState } from './workplaneCommentsReview.ts';
import type { MissingProofWarningView } from './workplaneMissingProof.ts';

export type WorkplaneReviewGateBlockerCode =
  | 'missing_proof'
  | 'proof_degraded'
  | 'proof_unavailable'
  | 'proof_loading'
  | 'proof_not_clear'
  | 'review_not_loaded'
  | 'review_load_error'
  | 'review_pending'
  | 'review_needs_fix'
  | 'review_rejected'
  | 'review_degraded'
  | 'human_gate_blocking';

export interface WorkplaneReviewGateBlocker {
  code: WorkplaneReviewGateBlockerCode;
  message: string;
}

export interface WorkplaneReviewGateResult {
  /** True only when proof is clear and review state allows readiness. */
  reviewReady: boolean;
  blocked: boolean;
  blockers: WorkplaneReviewGateBlocker[];
  /** Proof alone would satisfy the proof half of the gate. */
  proofSatisfied: boolean;
  /** True when missing/degraded/unavailable proof is the (or a) blocker. */
  missingProofBlocks: boolean;
  reason: string;
}

function humanGateBlocks(state: string | null | undefined, required: boolean): boolean {
  if (!required) return false;
  const normalized = (state ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized || normalized === 'pending' || normalized === 'required') return true;
  if (normalized === 'rejected' || normalized === 'denied' || normalized === 'blocked') {
    return true;
  }
  // approved / accepted / cleared / not_required → not blocking
  return !(
    normalized === 'approved' ||
    normalized === 'accepted' ||
    normalized === 'cleared' ||
    normalized === 'not_required' ||
    normalized === 'complete' ||
    normalized === 'completed'
  );
}

function collectProofBlockers(missingProof: MissingProofWarningView): {
  blockers: WorkplaneReviewGateBlocker[];
  proofSatisfied: boolean;
  missingProofBlocks: boolean;
} {
  const blockers: WorkplaneReviewGateBlocker[] = [];

  if (missingProof.status === 'loading') {
    blockers.push({
      code: 'proof_loading',
      message: 'Proof metadata is still loading. Not review-ready.',
    });
  } else if (missingProof.status === 'error' || missingProof.status === 'empty') {
    blockers.push({
      code: 'proof_unavailable',
      message:
        missingProof.status === 'error'
          ? 'Proof metadata is unavailable. Missing proof — not review-ready.'
          : 'No proof payload. Missing proof — not review-ready.',
    });
  } else if (missingProof.status === 'degraded') {
    blockers.push({
      code: 'proof_degraded',
      message: 'Proof metadata is degraded. Not review-ready until resolved.',
    });
  } else if (missingProof.status === 'warning' || missingProof.warningVisible) {
    const primary =
      missingProof.warnings.find(
        (w) => w.kind === 'no_proof' || w.kind === 'missing_evidence' || w.kind === 'load_empty',
      ) ?? missingProof.warnings[0];
    blockers.push({
      code: 'missing_proof',
      message:
        primary?.message ??
        'Proof is missing or incomplete. Do not treat this task as review-ready.',
    });
  } else if (missingProof.status !== 'clear' || !missingProof.proofPresent) {
    blockers.push({
      code: 'proof_not_clear',
      message: 'Proof is not clear. Missing proof — not review-ready.',
    });
  }

  const missingProofBlocks = blockers.some((b) =>
    ['missing_proof', 'proof_degraded', 'proof_unavailable', 'proof_loading', 'proof_not_clear'].includes(
      b.code,
    ),
  );

  return {
    blockers,
    proofSatisfied: blockers.length === 0,
    missingProofBlocks,
  };
}

function collectReviewBlockers(
  commentsReview: WorkplaneCommentsReviewLoadState,
): WorkplaneReviewGateBlocker[] {
  const blockers: WorkplaneReviewGateBlocker[] = [];

  if (commentsReview.status === 'loading' || commentsReview.status === 'empty') {
    blockers.push({
      code: 'review_not_loaded',
      message: 'Comments/review checklist is not loaded. Not review-ready.',
    });
    return blockers;
  }

  if (commentsReview.status === 'error' || !commentsReview.bundle) {
    blockers.push({
      code: 'review_load_error',
      message: 'Comments/review checklist failed to load. Not review-ready.',
    });
    return blockers;
  }

  const bundle = commentsReview.bundle;

  if (bundle.degraded) {
    blockers.push({
      code: 'review_degraded',
      message: 'Comments/review stream is degraded. Not review-ready.',
    });
  }

  if (bundle.decision === 'pending') {
    blockers.push({
      code: 'review_pending',
      message: 'Review decision is still pending. Not review-ready.',
    });
  } else if (bundle.decision === 'needs_fix') {
    blockers.push({
      code: 'review_needs_fix',
      message: 'Review requires fixes. Not review-ready.',
    });
  } else if (bundle.decision === 'rejected') {
    blockers.push({
      code: 'review_rejected',
      message: 'Review was rejected. Not review-ready.',
    });
  }

  if (humanGateBlocks(bundle.humanGateState, bundle.humanGateRequired)) {
    blockers.push({
      code: 'human_gate_blocking',
      message: 'Required human gate is unresolved. Not review-ready.',
    });
  }

  return blockers;
}

/**
 * Evaluate whether the Workplane may present as review-ready.
 * Missing proof always wins: even an accepted review cannot present ready
 * when proof/evidence is missing, degraded, or unavailable.
 */
export function evaluateWorkplaneReviewGate(input: {
  missingProof: MissingProofWarningView;
  commentsReview: WorkplaneCommentsReviewLoadState;
}): WorkplaneReviewGateResult {
  const proof = collectProofBlockers(input.missingProof);
  const reviewBlockers = collectReviewBlockers(input.commentsReview);
  const blockers = [...proof.blockers, ...reviewBlockers];
  const reviewReady = blockers.length === 0;

  let reason: string;
  if (reviewReady) {
    reason = 'Proof is present and review state allows review-ready presentation.';
  } else if (proof.missingProofBlocks) {
    const firstProof = proof.blockers[0];
    reason = firstProof?.message ?? 'Missing proof — not review-ready.';
  } else {
    reason = blockers[0]?.message ?? 'Review gate blocked — not review-ready.';
  }

  return {
    reviewReady,
    blocked: !reviewReady,
    blockers,
    proofSatisfied: proof.proofSatisfied,
    missingProofBlocks: proof.missingProofBlocks,
    reason,
  };
}

/** Stamp gate result onto a comments/review load state for panel presentation. */
export function applyReviewGateToCommentsReviewLoadState(
  loadState: WorkplaneCommentsReviewLoadState,
  gate: WorkplaneReviewGateResult,
): WorkplaneCommentsReviewLoadState {
  if (loadState.status !== 'ready' || !loadState.bundle) {
    return loadState;
  }
  return {
    ...loadState,
    bundle: {
      ...loadState.bundle,
      reviewReady: gate.reviewReady,
    },
  };
}
