import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import MissingProofWarningPanel from '../components/workplane/MissingProofWarningPanel.tsx';
import WorkplaneShell from '../components/workplane/WorkplaneShell.tsx';
import { normalizeProofBundle } from './proofBundle.ts';
import {
  buildMissingProofWarningView,
  createMissingProofWarningView,
} from './workplaneMissingProof.ts';
import { createWorkplaneFilesDocsLoadState } from './workplaneFilesDocs.ts';
import { createWorkplaneProofBundleLoadState } from './workplaneProofBundle.ts';
import { createWorkplaneTaskSummaryLoadState } from './workplaneTaskSummary.ts';

const NO_PROOF_TASK = {
  id: 866,
  name: 'Done without proof',
  column: 'done',
  output: '',
  metadata: {},
};

const PROOF_PRESENT_TASK = {
  id: 22,
  name: 'Has proof',
  column: 'review',
  output: 'See output/entity/workplanes/missing-proof.md for proof.',
  metadata: {
    evidence_summary: 'Browser proof attached.',
    phase2_receipt: {
      artifact_id: 'receipt-22',
      artifact_kind: 'raw_task_receipt',
      stable_path: '/artifacts/evidence/receipt-22.md',
      integrity_state: 'valid',
      availability_state: 'available',
      receipt_status: 'created',
    },
  },
};

const UNKNOWN_ONLY_TASK = {
  id: 867,
  name: 'Unknown artifacts',
  column: 'review',
  output: '',
  metadata: {
    evidence_summary: 'Opaque blob recorded.',
    evidence_artifacts: [
      {
        id: 'opaque-1',
        title: 'Unclassified blob',
        // no artifact_kind / href → unknown
      },
    ],
  },
};

const EXPLICIT_MISSING_TASK = {
  id: 868,
  name: 'Flagged missing',
  column: 'doing',
  output: 'https://example.com/not-enough',
  metadata: {
    missing_evidence: true,
    missing_evidence_reason: 'Operator flagged missing receipt.',
  },
};

test('buildMissingProofWarningView warns for no-proof task', () => {
  const bundle = normalizeProofBundle(NO_PROOF_TASK);
  assert.equal(bundle.empty, true);
  assert.equal(bundle.missingEvidence, true);

  const view = buildMissingProofWarningView(
    createWorkplaneProofBundleLoadState({ status: 'ready', bundle }),
  );
  assert.equal(view.status, 'warning');
  assert.equal(view.warningVisible, true);
  assert.equal(view.reviewReady, false);
  assert.equal(view.proofPresent, false);
  assert.equal(view.proofItemCount, 0);
  assert.ok(view.warnings.some((w) => w.kind === 'no_proof' || w.kind === 'missing_evidence'));
  assert.ok(view.warnings.every((w) => w.severity !== undefined));
});

test('buildMissingProofWarningView clears warning when proof is present', () => {
  const bundle = normalizeProofBundle(PROOF_PRESENT_TASK);
  assert.equal(bundle.empty, false);
  assert.equal(bundle.missingEvidence, false);

  const view = buildMissingProofWarningView(
    createWorkplaneProofBundleLoadState({ status: 'ready', bundle }),
  );
  assert.equal(view.status, 'clear');
  assert.equal(view.warningVisible, false);
  assert.equal(view.reviewReady, false);
  assert.equal(view.proofPresent, true);
  assert.ok(view.proofItemCount >= 1);
  assert.equal(view.warnings.length, 0);
});

test('buildMissingProofWarningView degrades for unknown artifacts', () => {
  const bundle = normalizeProofBundle(UNKNOWN_ONLY_TASK);
  assert.ok(bundle.items.some((item) => item.kind === 'unknown'));

  const view = buildMissingProofWarningView(
    createWorkplaneProofBundleLoadState({ status: 'ready', bundle }),
  );
  // Unknown-only with no usable href/path → missing proof warning (not clear).
  assert.ok(view.status === 'warning' || view.status === 'degraded');
  assert.equal(view.warningVisible, true);
  assert.equal(view.reviewReady, false);
  assert.ok(view.unknownItemCount >= 1);
  assert.ok(view.warnings.some((w) => w.kind === 'unknown_artifacts'));
});

test('buildMissingProofWarningView surfaces explicit missing_evidence flag', () => {
  const bundle = normalizeProofBundle(EXPLICIT_MISSING_TASK);
  assert.equal(bundle.missingEvidence, true);

  const view = buildMissingProofWarningView(
    createWorkplaneProofBundleLoadState({ status: 'ready', bundle }),
  );
  assert.equal(view.status, 'warning');
  assert.equal(view.warningVisible, true);
  assert.equal(view.reviewReady, false);
  assert.ok(view.warnings.some((w) => w.kind === 'missing_evidence'));
  assert.match(view.missingEvidenceReason ?? '', /Operator flagged/);
});

test('buildMissingProofWarningView covers loading/empty/error envelopes', () => {
  const loading = createMissingProofWarningView({ status: 'loading', taskId: 866 });
  assert.equal(loading.status, 'loading');
  assert.equal(loading.warningVisible, false);
  assert.equal(loading.reviewReady, false);

  const empty = createMissingProofWarningView({ status: 'empty', taskId: 866 });
  assert.equal(empty.status, 'empty');
  assert.equal(empty.warningVisible, true);
  assert.ok(empty.warnings.some((w) => w.kind === 'load_empty'));

  const errored = createMissingProofWarningView({
    status: 'error',
    taskId: 866,
    errorMessage: 'upstream failed',
  });
  assert.equal(errored.status, 'error');
  assert.equal(errored.warningVisible, true);
  assert.match(errored.errorMessage ?? '', /upstream failed/);
});

test('MissingProofWarningPanel renders no-proof warning and clear proof-present states', () => {
  const noProofHtml = renderToStaticMarkup(
    createElement(MissingProofWarningPanel, {
      proofLoadState: createWorkplaneProofBundleLoadState({
        status: 'ready',
        bundle: normalizeProofBundle(NO_PROOF_TASK),
      }),
    }),
  );
  assert.match(noProofHtml, /data-testid="workplane-missing-proof"/);
  assert.match(noProofHtml, /data-missing-proof-status="warning"/);
  assert.match(noProofHtml, /data-missing-proof-warning-visible="true"/);
  assert.match(noProofHtml, /data-missing-proof-review-ready="false"/);
  assert.match(noProofHtml, /not review-ready/);
  assert.match(noProofHtml, /data-testid="workplane-missing-proof-warning"/);

  const clearHtml = renderToStaticMarkup(
    createElement(MissingProofWarningPanel, {
      proofLoadState: createWorkplaneProofBundleLoadState({
        status: 'ready',
        bundle: normalizeProofBundle(PROOF_PRESENT_TASK),
      }),
    }),
  );
  assert.match(clearHtml, /data-missing-proof-status="clear"/);
  assert.match(clearHtml, /data-missing-proof-warning-visible="false"/);
  assert.match(clearHtml, /data-testid="workplane-missing-proof-clear"/);
  assert.match(clearHtml, /No missing-proof warning/);
  assert.doesNotMatch(clearHtml, /data-testid="workplane-missing-proof-warning"/);
});

test('MissingProofWarningPanel renders unknown/degraded and unavailable metadata', () => {
  const unknownHtml = renderToStaticMarkup(
    createElement(MissingProofWarningPanel, {
      proofLoadState: createWorkplaneProofBundleLoadState({
        status: 'ready',
        bundle: normalizeProofBundle(UNKNOWN_ONLY_TASK),
      }),
    }),
  );
  assert.match(unknownHtml, /data-missing-proof-warning-visible="true"/);
  assert.match(unknownHtml, /data-warning-kind="unknown_artifacts"/);
  assert.match(unknownHtml, /data-missing-proof-review-ready="false"/);

  const errorHtml = renderToStaticMarkup(
    createElement(MissingProofWarningPanel, {
      proofLoadState: createWorkplaneProofBundleLoadState({
        status: 'error',
        taskId: 866,
        errorMessage: 'metadata unavailable',
      }),
      onRetry: () => undefined,
    }),
  );
  assert.match(errorHtml, /data-missing-proof-status="error"/);
  assert.match(errorHtml, /metadata unavailable/);
  assert.match(errorHtml, /data-testid="workplane-missing-proof-retry"/);

  const loadingHtml = renderToStaticMarkup(
    createElement(MissingProofWarningPanel, {
      proofLoadState: createWorkplaneProofBundleLoadState({
        status: 'loading',
        taskId: 866,
      }),
    }),
  );
  assert.match(loadingHtml, /data-missing-proof-status="loading"/);
  assert.match(loadingHtml, /data-testid="workplane-missing-proof-loading"/);
});

test('WorkplaneShell wires MissingProofWarningPanel for missing_proof_warnings panel', () => {
  const noProofBundle = normalizeProofBundle(NO_PROOF_TASK);
  const warningHtml = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/866',
      search: '?panel=missing_proof_warnings',
      taskSummaryState: createWorkplaneTaskSummaryLoadState({ status: 'empty', taskId: 866 }),
      proofBundleState: createWorkplaneProofBundleLoadState({
        status: 'ready',
        bundle: noProofBundle,
      }),
      filesDocsState: createWorkplaneFilesDocsLoadState({ status: 'empty', taskId: 866 }),
    }),
  );
  assert.match(warningHtml, /data-workplane-active-panel="missing_proof_warnings"/);
  assert.match(warningHtml, /data-testid="workplane-missing-proof"/);
  assert.match(warningHtml, /data-missing-proof-warning-visible="true"/);
  assert.match(warningHtml, /data-workplane-missing-proof-status="warning"/);
  assert.doesNotMatch(warningHtml, /Placeholder — full panel ships/);

  const proofBundle = normalizeProofBundle(PROOF_PRESENT_TASK);
  const clearHtml = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/22',
      search: '?panel=missing_proof_warnings',
      taskSummaryState: createWorkplaneTaskSummaryLoadState({ status: 'empty', taskId: 22 }),
      proofBundleState: createWorkplaneProofBundleLoadState({
        status: 'ready',
        bundle: proofBundle,
      }),
      filesDocsState: createWorkplaneFilesDocsLoadState({ status: 'empty', taskId: 22 }),
    }),
  );
  assert.match(clearHtml, /data-missing-proof-status="clear"/);
  assert.match(clearHtml, /data-missing-proof-warning-visible="false"/);

  const other = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/866',
      search: '?panel=comments_review_checklist',
      taskSummaryState: createWorkplaneTaskSummaryLoadState({ status: 'empty', taskId: 866 }),
      proofBundleState: createWorkplaneProofBundleLoadState({
        status: 'ready',
        bundle: noProofBundle,
      }),
      filesDocsState: createWorkplaneFilesDocsLoadState({ status: 'empty', taskId: 866 }),
    }),
  );
  assert.match(other, /Placeholder — full panel ships/);
  assert.doesNotMatch(other, /data-testid="workplane-missing-proof"/);
});
