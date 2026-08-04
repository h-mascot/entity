import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import WorkplaneShell from '../components/workplane/WorkplaneShell.tsx';
import { normalizeProofBundle } from './proofBundle.ts';
import { createWorkplaneActivityProgressLoadState } from './workplaneActivityProgress.ts';
import { createWorkplaneCommentsReviewLoadState } from './workplaneCommentsReview.ts';
import { createWorkplaneFilesDocsLoadState, normalizeWorkplaneFilesDocs } from './workplaneFilesDocs.ts';
import { createWorkplaneProofBundleLoadState } from './workplaneProofBundle.ts';
import { createWorkplaneTaskSummaryLoadState } from './workplaneTaskSummary.ts';
import {
  WORKPLANE_SLICE1_E2E_CODE,
  WORKPLANE_SLICE1_E2E_ISSUE,
  WORKPLANE_SLICE1_E2E_SCENARIOS,
  WORKPLANE_SLICE1_E2E_WITH_PROOF_TASK,
  WORKPLANE_SLICE1_E2E_WITHOUT_PROOF_TASK,
  buildWorkplaneSlice1E2EHref,
  evaluateAllWorkplaneSlice1E2EScenarios,
  evaluateWorkplaneSlice1E2EScenario,
  workplaneSlice1E2ERawProofToken,
} from './workplaneSlice1E2EProofPack.ts';

function renderScenarioShell(input: {
  task: typeof WORKPLANE_SLICE1_E2E_WITH_PROOF_TASK | typeof WORKPLANE_SLICE1_E2E_WITHOUT_PROOF_TASK;
  panel: string;
  selectedProof?: string | null;
}) {
  const task = input.task;
  const search = new URLSearchParams({ panel: input.panel });
  if (input.selectedProof) search.set('proof', input.selectedProof);
  return renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: `/workplane/${task.id}`,
      search: `?${search.toString()}`,
      taskSummaryState: createWorkplaneTaskSummaryLoadState({
        status: 'empty',
        taskId: task.id,
      }),
      proofBundleState: createWorkplaneProofBundleLoadState({
        status: 'ready',
        bundle: normalizeProofBundle(task),
      }),
      filesDocsState: createWorkplaneFilesDocsLoadState({
        status: 'ready',
        bundle: normalizeWorkplaneFilesDocs(task),
      }),
      activityProgressState: createWorkplaneActivityProgressLoadState({
        status: 'empty',
        taskId: task.id,
      }),
      commentsReviewState: createWorkplaneCommentsReviewLoadState({
        status: 'empty',
        taskId: task.id,
      }),
    }),
  );
}

test('WP1-C-07 pack covers required scenario ids exactly once', () => {
  assert.equal(WORKPLANE_SLICE1_E2E_ISSUE, 'THE-875');
  assert.equal(WORKPLANE_SLICE1_E2E_CODE, 'WP1-C-07');
  const ids = WORKPLANE_SLICE1_E2E_SCENARIOS.map((s) => s.id).sort();
  assert.deepEqual(ids, [
    'linked_doc',
    'raw_proof',
    'refresh',
    'with_proof',
    'without_proof',
  ]);
});

test('evaluateAllWorkplaneSlice1E2EScenarios passes for fixture contracts', () => {
  const results = evaluateAllWorkplaneSlice1E2EScenarios();
  assert.equal(results.length, 5);
  for (const result of results) {
    assert.equal(result.pass, true, `${result.scenarioId}: ${result.failures.join('; ')}`);
  }
});

test('with_proof shell renders proof bundle ready and not missing-proof warning', () => {
  const evalResult = evaluateWorkplaneSlice1E2EScenario('with_proof');
  assert.equal(evalResult.pass, true);
  const html = renderScenarioShell({
    task: WORKPLANE_SLICE1_E2E_WITH_PROOF_TASK,
    panel: 'proof_bundle',
  });
  assert.match(html, /data-testid="workplane-shell"/);
  assert.match(html, /data-workplane-status="ready"/);
  assert.match(html, /data-workplane-active-panel="proof_bundle"/);
  assert.match(html, /data-testid="workplane-proof-bundle-ready"/);
  assert.match(html, /data-proof-kind="raw"/);
  assert.match(html, /data-workplane-missing-proof-warning-visible="false"/);
});

test('without_proof shell renders missing-proof warning and empty proof', () => {
  const evalResult = evaluateWorkplaneSlice1E2EScenario('without_proof');
  assert.equal(evalResult.pass, true);
  const html = renderScenarioShell({
    task: WORKPLANE_SLICE1_E2E_WITHOUT_PROOF_TASK,
    panel: 'missing_proof_warnings',
  });
  assert.match(html, /data-workplane-active-panel="missing_proof_warnings"/);
  assert.match(html, /data-workplane-missing-proof-warning-visible="true"/);
  assert.match(html, /data-testid="workplane-missing-proof"/);
  assert.match(html, /data-workplane-proof-status="ready"/);
});

test('raw_proof scenario selects a raw proof token in shell URL state', () => {
  const token = workplaneSlice1E2ERawProofToken();
  assert.match(token, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
  const evalResult = evaluateWorkplaneSlice1E2EScenario('raw_proof');
  assert.equal(evalResult.pass, true);
  assert.equal(evalResult.rawProofToken, token);

  const html = renderScenarioShell({
    task: WORKPLANE_SLICE1_E2E_WITH_PROOF_TASK,
    panel: 'proof_bundle',
    selectedProof: token,
  });
  assert.match(html, new RegExp(`data-workplane-selected-proof="${token}"`));
  assert.match(html, /data-proof-kind="raw"/);
  assert.match(html, /data-testid="workplane-proof-item"/);
});

test('linked_doc scenario exposes Doc Hub opener for native plan note', () => {
  const evalResult = evaluateWorkplaneSlice1E2EScenario('linked_doc');
  assert.equal(evalResult.pass, true);
  assert.equal(evalResult.linkedDocHref, '/docs/source/workspace/docs/notes/plan.md');

  const html = renderScenarioShell({
    task: WORKPLANE_SLICE1_E2E_WITH_PROOF_TASK,
    panel: 'files_docs',
  });
  assert.match(html, /data-testid="workplane-files-docs-ready"/);
  assert.match(html, /data-testid="workplane-files-docs-opener"/);
  assert.match(html, /data-opener-kind="doc_hub"/);
  assert.match(html, /data-opener-href="\/docs\/source\/workspace\/docs\/notes\/plan\.md"/);
});

test('refresh scenario round-trips panel + selected proof via URL serialize/restore', () => {
  const evalResult = evaluateWorkplaneSlice1E2EScenario('refresh');
  assert.equal(evalResult.pass, true);
  assert.equal(evalResult.restoredFromUrl, true);

  const token = workplaneSlice1E2ERawProofToken();
  const href = buildWorkplaneSlice1E2EHref({
    taskId: WORKPLANE_SLICE1_E2E_WITH_PROOF_TASK.id,
    panel: 'proof_bundle',
    selectedProof: token,
    returnPath: `/task/${WORKPLANE_SLICE1_E2E_WITH_PROOF_TASK.id}`,
  });
  assert.match(href, /\/workplane\/8751/);
  assert.match(href, /panel=proof_bundle/);
  const parsed = new URL(href, 'http://localhost');
  assert.equal(parsed.searchParams.get('proof'), token);
  assert.equal(parsed.searchParams.get('return'), 'detail');
  assert.equal(parsed.searchParams.get('returnTask'), String(WORKPLANE_SLICE1_E2E_WITH_PROOF_TASK.id));
});

test('NEGATIVE: without_proof fixture fails with_proof expectations', () => {
  // Swap fixture semantics by evaluating with_proof against empty-task-derived emptiness.
  const without = evaluateWorkplaneSlice1E2EScenario('without_proof');
  assert.equal(without.proofEmpty, true);
  assert.equal(without.missingProofWarningVisible, true);
  assert.equal(without.hasRawProofKind, false);
  assert.equal(without.hasLinkedDocOpener, false);
});
