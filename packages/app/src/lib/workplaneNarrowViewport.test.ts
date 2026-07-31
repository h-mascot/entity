import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import WorkplaneShell from '../components/workplane/WorkplaneShell.tsx';
import { normalizeProofBundle } from './proofBundle.ts';
import {
  createWorkplaneFilesDocsLoadState,
  normalizeWorkplaneFilesDocs,
} from './workplaneFilesDocs.ts';
import { createWorkplaneActivityProgressLoadState } from './workplaneActivityProgress.ts';
import { createWorkplaneProofBundleLoadState } from './workplaneProofBundle.ts';
import {
  buildWorkplaneTaskSummary,
  createWorkplaneTaskSummaryLoadState,
} from './workplaneTaskSummary.ts';
import { WORKPLANE_PANEL_IDS } from './workplaneUrlState.ts';
import { formatWorkplanePanelOrder, selectWorkplanePanelAsHuman } from './workplaneLayoutLock.ts';
import {
  WORKPLANE_MOBILE_MAX_WIDTH,
  WORKPLANE_NARROW_MAX_WIDTH,
  WORKPLANE_NARROW_SMOKE_PANELS,
  assertWorkplaneNarrowMarkupContract,
  classifyWorkplaneViewportWidth,
  getWorkplaneNarrowViewportContract,
  hasHorizontalOverflow,
  isWorkplaneNarrowViewport,
  workplaneNarrowDomAttrs,
  workplanePanelBodyNarrowClassNames,
  workplanePanelNavNarrowClassNames,
  workplaneShellNarrowClassNames,
} from './workplaneNarrowViewport.ts';

const SAMPLE_TASK = {
  id: 22,
  name: 'Narrow viewport smoke task with a reasonably long title for wrap checks',
  column: 'doing',
  priority: 'P1',
  assignee: 'operator',
  description: 'Mobile Workplane panel smoke for THE-868.',
  output: [
    'Ext: [https://example.com/very/long/path/to/proof/artifact/receipt-with-extra-segments](https://example.com/very/long/path/to/proof/artifact/receipt-with-extra-segments)',
    'Doc: [/docs/workspace/docs/long/path/to/document.md](/docs/workspace/docs/long/path/to/document.md)',
  ].join('\n'),
  metadata: {
    native_documents: [
      {
        id: 'native_long',
        title: 'Linked Doc Hub document with a long display title',
        object_type: 'native_document',
        path: '/docs/workspace/docs/long/path/to/document.md',
      },
    ],
  },
};

const EMPTY_TASK = {
  id: 21,
  name: 'No proof narrow smoke',
  column: 'todo',
  output: '',
  metadata: {},
};

const READY_SUMMARY = createWorkplaneTaskSummaryLoadState({
  status: 'ready',
  summary: buildWorkplaneTaskSummary(SAMPLE_TASK)!,
});

const EMPTY_PROOF = createWorkplaneProofBundleLoadState({ status: 'empty', taskId: 21 });
const EMPTY_FILES = createWorkplaneFilesDocsLoadState({ status: 'empty', taskId: 21 });

const READY_PROOF = createWorkplaneProofBundleLoadState({
  status: 'ready',
  taskId: 22,
  bundle: normalizeProofBundle(SAMPLE_TASK),
});

const READY_FILES = createWorkplaneFilesDocsLoadState({
  status: 'ready',
  taskId: 22,
  bundle: normalizeWorkplaneFilesDocs(SAMPLE_TASK),
});

test('narrow viewport contract pins THE-868 breakpoints and required panels', () => {
  const contract = getWorkplaneNarrowViewportContract();
  assert.equal(contract.issue, 'THE-868');
  assert.equal(contract.code, 'WP1-B-07');
  assert.equal(contract.mobileMaxWidth, 390);
  assert.equal(contract.narrowMaxWidth, 720);
  assert.equal(contract.overflowPolicy, 'no_document_horizontal_overflow');
  assert.equal(contract.layoutLockPreserved, true);
  assert.equal(contract.humanPanelNavPreserved, true);
  assert.deepEqual([...contract.requiredPanels], [...WORKPLANE_PANEL_IDS]);
  assert.deepEqual([...WORKPLANE_NARROW_SMOKE_PANELS], [...WORKPLANE_PANEL_IDS]);
});

test('classifyWorkplaneViewportWidth bands mobile/narrow/desktop and fails closed', () => {
  assert.equal(classifyWorkplaneViewportWidth(WORKPLANE_MOBILE_MAX_WIDTH), 'mobile');
  assert.equal(classifyWorkplaneViewportWidth(320), 'mobile');
  assert.equal(classifyWorkplaneViewportWidth(WORKPLANE_NARROW_MAX_WIDTH), 'narrow');
  assert.equal(classifyWorkplaneViewportWidth(640), 'narrow');
  assert.equal(classifyWorkplaneViewportWidth(721), 'desktop');
  assert.equal(classifyWorkplaneViewportWidth(1280), 'desktop');
  assert.equal(classifyWorkplaneViewportWidth(0), 'mobile');
  assert.equal(classifyWorkplaneViewportWidth(-1), 'mobile');
  assert.equal(classifyWorkplaneViewportWidth(Number.NaN), 'mobile');
  assert.equal(isWorkplaneNarrowViewport(390), true);
  assert.equal(isWorkplaneNarrowViewport(720), true);
  assert.equal(isWorkplaneNarrowViewport(1024), false);
});

test('hasHorizontalOverflow uses 1px tolerance and fails closed on bad metrics', () => {
  assert.equal(hasHorizontalOverflow(390, 390), false);
  assert.equal(hasHorizontalOverflow(391, 390), false);
  assert.equal(hasHorizontalOverflow(392, 390), true);
  assert.equal(hasHorizontalOverflow(500, 390), true);
  assert.equal(hasHorizontalOverflow(Number.NaN, 390), true);
});

test('narrow class / DOM attr helpers are stable for CSS and proof hooks', () => {
  assert.match(workplaneShellNarrowClassNames(), /\bworkplane-shell\b/);
  assert.match(workplaneShellNarrowClassNames(), /\bworkplane-shell--narrow-ready\b/);
  assert.match(workplanePanelNavNarrowClassNames(), /\bworkplane-panel-nav\b/);
  assert.match(workplanePanelBodyNarrowClassNames(), /\bworkplane-panel-body\b/);
  assert.deepEqual(workplaneNarrowDomAttrs(), {
    'data-workplane-narrow-ready': 'true',
    'data-workplane-viewport-smoke': 'WP1-B-07',
    'data-workplane-overflow-policy': 'no_document_horizontal_overflow',
    'data-workplane-layout-locked': 'true',
  });
});

test('WorkplaneShell exposes narrow-ready DOM contract without regressing layout lock', () => {
  const html = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/22',
      search: '?panel=task_summary',
      taskSummaryState: READY_SUMMARY,
      proofBundleState: EMPTY_PROOF,
      filesDocsState: EMPTY_FILES,
      agentLayoutPayload: {
        panel_order: ['evil_widget', 'task_summary'],
        hidden_panels: ['files_docs'],
        active_panel: 'activity_progress',
        custom_panels: [{ id: 'evil_widget', label: 'Evil Widget' }],
      },
    }),
  );

  const contract = assertWorkplaneNarrowMarkupContract(html);
  assert.equal(contract.narrowReady, true);
  assert.equal(contract.viewportSmoke, true);
  assert.equal(contract.overflowPolicy, true);
  assert.equal(contract.layoutLocked, true);
  assert.equal(contract.layoutIntact, true);
  assert.equal(contract.hasShellClass, true);
  assert.equal(contract.hasNavClass, true);
  assert.equal(contract.hasBodyClass, true);
  assert.equal(contract.panelTabsPresent, true);
  assert.match(html, /data-workplane-agent-layout-rejected="true"/);
  assert.match(html, /data-workplane-active-panel="task_summary"/);
  assert.match(
    html,
    new RegExp(`data-workplane-panel-order="${formatWorkplanePanelOrder()}"`),
  );
  assert.doesNotMatch(html, /evil_widget|Evil Widget/);
});

test('narrow smoke: task summary / proof / files / missing-proof panels remain usable', () => {
  assert.ok(READY_PROOF.bundle && READY_PROOF.bundle.empty === false);
  assert.ok(READY_FILES.bundle && READY_FILES.bundle.empty === false);
  assert.ok(buildWorkplaneTaskSummary(EMPTY_TASK));

  const summaryHtml = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/22',
      search: '?panel=task_summary',
      taskSummaryState: READY_SUMMARY,
      proofBundleState: READY_PROOF,
      filesDocsState: READY_FILES,
    }),
  );
  assert.match(summaryHtml, /data-testid="workplane-task-summary-ready"/);
  assert.match(summaryHtml, /data-workplane-narrow-ready="true"/);

  const proofHtml = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/22',
      search: '?panel=proof_bundle',
      taskSummaryState: READY_SUMMARY,
      proofBundleState: READY_PROOF,
      filesDocsState: READY_FILES,
    }),
  );
  assert.match(proofHtml, /data-testid="workplane-proof-bundle"/);
  assert.match(proofHtml, /data-testid="workplane-proof-item"/);
  assert.match(proofHtml, /truncate/);

  const filesHtml = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/22',
      search: '?panel=files_docs',
      taskSummaryState: READY_SUMMARY,
      proofBundleState: READY_PROOF,
      filesDocsState: READY_FILES,
    }),
  );
  assert.match(filesHtml, /data-testid="workplane-files-docs"/);
  assert.match(filesHtml, /data-testid="workplane-files-docs-opener"/);

  const missingHtml = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/21',
      search: '?panel=missing_proof_warnings',
      taskSummaryState: createWorkplaneTaskSummaryLoadState({
        status: 'ready',
        summary: buildWorkplaneTaskSummary(EMPTY_TASK)!,
      }),
      proofBundleState: EMPTY_PROOF,
      filesDocsState: EMPTY_FILES,
    }),
  );
  assert.match(missingHtml, /data-testid="workplane-missing-proof"/);
  assert.match(missingHtml, /data-missing-proof-warning-visible="true"/);
  assert.match(missingHtml, /data-missing-proof-review-ready="false"/);
});

test('narrow smoke: activity panel renders; comments placeholder stays; layout locked', () => {
  const activityHtml = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/22',
      search: '?panel=activity_progress',
      taskSummaryState: READY_SUMMARY,
      proofBundleState: EMPTY_PROOF,
      filesDocsState: EMPTY_FILES,
      activityProgressState: createWorkplaneActivityProgressLoadState({
        status: 'ready',
        bundle: {
          taskId: 22,
          events: [],
          empty: true,
          degraded: false,
          warnings: [],
          reviewReady: false,
        },
      }),
    }),
  );
  assert.match(activityHtml, /data-workplane-active-panel="activity_progress"/);
  assert.match(activityHtml, /data-testid="workplane-activity-progress"/);
  assert.match(activityHtml, /data-activity-empty="true"/);
  assert.doesNotMatch(activityHtml, /Placeholder — full panel ships/);
  assert.match(activityHtml, /data-workplane-narrow-ready="true"/);
  assert.match(activityHtml, /data-workplane-layout-locked="true"/);

  const commentsHtml = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/22',
      search: '?panel=comments_review_checklist',
      taskSummaryState: READY_SUMMARY,
      proofBundleState: EMPTY_PROOF,
      filesDocsState: EMPTY_FILES,
    }),
  );
  assert.match(commentsHtml, /data-workplane-active-panel="comments_review_checklist"/);
  assert.match(commentsHtml, /Placeholder/);
  assert.match(commentsHtml, /data-workplane-narrow-ready="true"/);
  assert.match(commentsHtml, /data-workplane-layout-locked="true"/);
  assert.match(commentsHtml, /data-testid="workplane-panel-nav"/);
});

test('NEGATIVE: human panel navigation still accepted under narrow contract (layout lock intact)', () => {
  const nav = selectWorkplanePanelAsHuman('task_summary', 'proof_bundle');
  assert.equal(nav.accepted, true);
  assert.equal(nav.activePanel, 'proof_bundle');
  assert.equal(nav.layout.locked, true);

  const rejected = selectWorkplanePanelAsHuman('task_summary', 'not_a_panel');
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.activePanel, 'task_summary');
});

test('invalid route still exposes narrow-ready attrs (degraded, not blank)', () => {
  const html = renderToStaticMarkup(
    createElement(WorkplaneShell, { pathname: '/workplane/not-a-task' }),
  );
  assert.match(html, /data-workplane-status="invalid_route"/);
  assert.match(html, /data-workplane-narrow-ready="true"/);
  assert.match(html, /data-workplane-viewport-smoke="WP1-B-07"/);
  assert.match(html, /data-workplane-overflow-policy="no_document_horizontal_overflow"/);
  assert.match(html, /data-workplane-layout-locked="true"/);
  assert.match(html, /\bworkplane-shell\b/);
  assert.match(html, /data-testid="workplane-task-summary-empty"/);
  assert.match(html, /data-testid="workplane-missing-proof"/);
});
