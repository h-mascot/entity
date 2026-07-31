/**
 * THE-874 / WP1-C-06 — Negative + positive review-gate coverage.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import CommentsReviewChecklistPanel from '../components/workplane/CommentsReviewChecklistPanel.tsx';
import WorkplaneShell from '../components/workplane/WorkplaneShell.tsx';
import { normalizeProofBundle } from './proofBundle.ts';
import {
  buildCommentsReviewBundle,
  createWorkplaneCommentsReviewLoadState,
} from './workplaneCommentsReview.ts';
import { createWorkplaneFilesDocsLoadState } from './workplaneFilesDocs.ts';
import { buildMissingProofWarningView } from './workplaneMissingProof.ts';
import { createWorkplaneProofBundleLoadState } from './workplaneProofBundle.ts';
import {
  applyReviewGateToCommentsReviewLoadState,
  evaluateWorkplaneReviewGate,
} from './workplaneReviewGate.ts';
import { createWorkplaneTaskSummaryLoadState } from './workplaneTaskSummary.ts';
import { createWorkplaneActivityProgressLoadState } from './workplaneActivityProgress.ts';

const NO_PROOF_TASK = {
  id: 874,
  name: 'Accepted without proof',
  column: 'review',
  output: '',
  metadata: {
    review_decision: 'accepted',
    review_type: 'peer',
    reviewed_by: 'henry',
    reviewed_at: '2026-07-31T00:00:00.000Z',
  },
  review_required: true,
  review_state: 'accepted',
};

const PROOF_PRESENT_TASK = {
  id: 875,
  name: 'Accepted with proof',
  column: 'review',
  output: 'See output/entity/workplanes/review-gate-proof.md for proof.',
  metadata: {
    review_decision: 'accepted',
    review_type: 'peer',
    reviewed_by: 'henry',
    reviewed_at: '2026-07-31T00:00:00.000Z',
    evidence_summary: 'Browser proof attached.',
    phase2_receipt: {
      artifact_id: 'receipt-875',
      artifact_kind: 'raw_task_receipt',
      stable_path: '/artifacts/evidence/receipt-875.md',
      integrity_state: 'valid',
      availability_state: 'available',
      receipt_status: 'created',
    },
  },
  review_required: true,
  review_state: 'accepted',
  human_gate_required: false,
};

function acceptedReviewLoad(task: Record<string, unknown>) {
  const bundle = buildCommentsReviewBundle({
    task,
    comments: [
      {
        id: 1,
        task_id: task.id,
        body: 'Looks good once proof is attached.',
        author: 'henry',
        created_at: '2026-07-31T01:00:00.000Z',
      },
    ],
    commentsAvailable: true,
  });
  assert.ok(bundle);
  return createWorkplaneCommentsReviewLoadState({ status: 'ready', bundle });
}

function missingProofViewFromTask(task: Record<string, unknown>) {
  const proofBundle = normalizeProofBundle(task);
  return buildMissingProofWarningView(
    createWorkplaneProofBundleLoadState({ status: 'ready', bundle: proofBundle }),
  );
}

test('NEGATIVE GATE: accepted review + missing proof cannot present as review-ready', () => {
  const missingProof = missingProofViewFromTask(NO_PROOF_TASK);
  assert.equal(missingProof.status, 'warning');
  assert.equal(missingProof.warningVisible, true);

  const commentsReview = acceptedReviewLoad(NO_PROOF_TASK);
  assert.equal(commentsReview.bundle?.decision, 'accepted');

  const gate = evaluateWorkplaneReviewGate({ missingProof, commentsReview });
  assert.equal(gate.reviewReady, false);
  assert.equal(gate.blocked, true);
  assert.equal(gate.proofSatisfied, false);
  assert.equal(gate.missingProofBlocks, true);
  assert.ok(gate.blockers.some((b) => b.code === 'missing_proof'));
  assert.match(gate.reason, /review-ready/i);
  assert.doesNotMatch(gate.reason, /allows review-ready/i);

  const stamped = applyReviewGateToCommentsReviewLoadState(commentsReview, gate);
  assert.equal(stamped.bundle?.reviewReady, false);

  const html = renderToStaticMarkup(
    createElement(CommentsReviewChecklistPanel, {
      loadState: stamped,
      reviewGate: gate,
    }),
  );
  assert.match(html, /data-review-ready="false"/);
  assert.doesNotMatch(html, /data-review-ready="true"/);
  assert.match(html, /data-testid="workplane-review-gate-blocked"/);
  assert.match(html, /Missing proof/i);
});

test('POSITIVE GATE: clear proof + accepted review may present as review-ready', () => {
  const missingProof = missingProofViewFromTask(PROOF_PRESENT_TASK);
  assert.equal(missingProof.status, 'clear');
  assert.equal(missingProof.proofPresent, true);

  const commentsReview = acceptedReviewLoad(PROOF_PRESENT_TASK);
  const gate = evaluateWorkplaneReviewGate({ missingProof, commentsReview });
  assert.equal(gate.reviewReady, true);
  assert.equal(gate.blocked, false);
  assert.equal(gate.proofSatisfied, true);
  assert.equal(gate.missingProofBlocks, false);
  assert.equal(gate.blockers.length, 0);

  const stamped = applyReviewGateToCommentsReviewLoadState(commentsReview, gate);
  assert.equal(stamped.bundle?.reviewReady, true);

  const html = renderToStaticMarkup(
    createElement(CommentsReviewChecklistPanel, {
      loadState: stamped,
      reviewGate: gate,
    }),
  );
  assert.match(html, /data-review-ready="true"/);
  assert.match(html, /data-testid="workplane-review-gate-ready"/);
});

test('NEGATIVE GATE: degraded proof blocks review-ready even when accepted', () => {
  const unknownOnly = {
    id: 876,
    name: 'Unknown only',
    column: 'review',
    output: '',
    metadata: {
      review_decision: 'accepted',
      evidence_summary: 'Opaque blob',
      evidence_artifacts: [{ id: 'opaque-1', title: 'Unclassified blob' }],
    },
    review_state: 'accepted',
  };
  const missingProof = missingProofViewFromTask(unknownOnly);
  assert.ok(missingProof.status === 'degraded' || missingProof.warningVisible);

  const gate = evaluateWorkplaneReviewGate({
    missingProof,
    commentsReview: acceptedReviewLoad(unknownOnly),
  });
  assert.equal(gate.reviewReady, false);
  assert.equal(gate.missingProofBlocks, true);
});

test('NEGATIVE GATE: proof clear but needs_fix still blocks review-ready', () => {
  const missingProof = missingProofViewFromTask(PROOF_PRESENT_TASK);
  const bundle = buildCommentsReviewBundle({
    task: {
      ...PROOF_PRESENT_TASK,
      review_state: 'needs_fix',
      metadata: { ...PROOF_PRESENT_TASK.metadata, review_decision: 'needs_fix' },
    },
    comments: [],
    commentsAvailable: true,
  });
  assert.ok(bundle);
  const gate = evaluateWorkplaneReviewGate({
    missingProof,
    commentsReview: createWorkplaneCommentsReviewLoadState({ status: 'ready', bundle }),
  });
  assert.equal(gate.reviewReady, false);
  assert.equal(gate.proofSatisfied, true);
  assert.ok(gate.blockers.some((b) => b.code === 'review_needs_fix'));
});

test('NEGATIVE GATE: proof loading / error / empty never present as review-ready', () => {
  const accepted = acceptedReviewLoad(PROOF_PRESENT_TASK);

  for (const status of ['loading', 'error', 'empty'] as const) {
    const missingProof = buildMissingProofWarningView(
      createWorkplaneProofBundleLoadState({
        status,
        taskId: 875,
        errorMessage: status === 'error' ? 'boom' : null,
      }),
    );
    const gate = evaluateWorkplaneReviewGate({ missingProof, commentsReview: accepted });
    assert.equal(gate.reviewReady, false, `status=${status}`);
    assert.equal(gate.missingProofBlocks, true, `status=${status}`);
  }
});

test('WorkplaneShell stamps review gate: missing proof cannot render review-ready', () => {
  const noProofBundle = normalizeProofBundle(NO_PROOF_TASK);
  const reviewBundle = buildCommentsReviewBundle({
    task: NO_PROOF_TASK,
    comments: [],
    commentsAvailable: true,
  });
  assert.ok(reviewBundle);
  assert.equal(reviewBundle.decision, 'accepted');

  const html = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/874',
      search: '?panel=comments_review_checklist',
      taskSummaryState: createWorkplaneTaskSummaryLoadState({ status: 'empty', taskId: 874 }),
      proofBundleState: createWorkplaneProofBundleLoadState({
        status: 'ready',
        bundle: noProofBundle,
      }),
      filesDocsState: createWorkplaneFilesDocsLoadState({ status: 'empty', taskId: 874 }),
      activityProgressState: createWorkplaneActivityProgressLoadState({
        status: 'empty',
        taskId: 874,
      }),
      commentsReviewState: createWorkplaneCommentsReviewLoadState({
        status: 'ready',
        bundle: reviewBundle,
      }),
    }),
  );

  assert.match(html, /data-workplane-review-ready="false"/);
  assert.match(html, /data-workplane-review-gate-blocked="true"/);
  assert.match(html, /data-workplane-missing-proof-blocks="true"/);
  assert.match(html, /data-review-ready="false"/);
  assert.doesNotMatch(html, /data-workplane-review-ready="true"/);
  assert.doesNotMatch(html, /data-review-ready="true"/);
  assert.match(html, /data-testid="workplane-review-gate-blocked"/);
});

test('WorkplaneShell positive path can present review-ready when proof clear', () => {
  const proofBundle = normalizeProofBundle(PROOF_PRESENT_TASK);
  const reviewBundle = buildCommentsReviewBundle({
    task: PROOF_PRESENT_TASK,
    comments: [],
    commentsAvailable: true,
  });
  assert.ok(reviewBundle);

  const html = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/875',
      search: '?panel=comments_review_checklist',
      taskSummaryState: createWorkplaneTaskSummaryLoadState({ status: 'empty', taskId: 875 }),
      proofBundleState: createWorkplaneProofBundleLoadState({
        status: 'ready',
        bundle: proofBundle,
      }),
      filesDocsState: createWorkplaneFilesDocsLoadState({ status: 'empty', taskId: 875 }),
      activityProgressState: createWorkplaneActivityProgressLoadState({
        status: 'empty',
        taskId: 875,
      }),
      commentsReviewState: createWorkplaneCommentsReviewLoadState({
        status: 'ready',
        bundle: reviewBundle,
      }),
    }),
  );

  assert.match(html, /data-workplane-review-ready="true"/);
  assert.match(html, /data-workplane-review-gate-blocked="false"/);
  assert.match(html, /data-workplane-missing-proof-blocks="false"/);
  assert.match(html, /data-review-ready="true"/);
  assert.match(html, /data-testid="workplane-review-gate-ready"/);
});
