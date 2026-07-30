import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import TaskSummaryPanel from '../components/workplane/TaskSummaryPanel.tsx';
import WorkplaneShell from '../components/workplane/WorkplaneShell.tsx';
import {
  buildWorkplaneTaskSummary,
  createWorkplaneTaskSummaryLoadState,
} from './workplaneTaskSummary.ts';

const SAMPLE_TASK = {
  id: 22,
  name: 'Restore Workplane on refresh',
  description: 'Cold-load deep links must restore task id and active panel without inventing board data.',
  column: 'doing',
  assignee: 'cursor-agent',
  priority: 'P1',
  blocked: false,
  review_required: true,
  review_state: 'pending',
  output: 'See /docs/output/entity/workplanes/refresh.md for proof.',
  metadata: {
    evidence_summary: 'Refresh restore browser proof attached.',
    review_type: 'correctness',
  },
};

test('buildWorkplaneTaskSummary maps title/identifier/status/review/proof context', () => {
  const summary = buildWorkplaneTaskSummary(SAMPLE_TASK);
  assert.ok(summary);
  assert.equal(summary.taskId, 22);
  assert.equal(summary.identifier, '#22');
  assert.equal(summary.title, 'Restore Workplane on refresh');
  assert.equal(summary.statusKey, 'doing');
  assert.equal(summary.statusLabel, 'Doing');
  assert.equal(summary.priority, 'P1');
  assert.equal(summary.assignee, 'cursor-agent');
  assert.equal(summary.blocked, false);
  assert.match(summary.descriptionPreview ?? '', /Cold-load deep links/);
  assert.equal(summary.reviewLabel, 'Review pending');
  assert.equal(summary.reviewState, 'pending');
  assert.match(summary.proofSummary ?? '', /Refresh restore browser proof/);
  assert.equal(summary.missingProof, false);
});

test('buildWorkplaneTaskSummary returns null for missing/invalid payloads (empty path)', () => {
  assert.equal(buildWorkplaneTaskSummary(null), null);
  assert.equal(buildWorkplaneTaskSummary({}), null);
  assert.equal(buildWorkplaneTaskSummary({ id: 0, name: 'x' }), null);
  assert.equal(buildWorkplaneTaskSummary({ id: 3, name: '   ' }), null);
});

test('buildWorkplaneTaskSummary surfaces blocked + missing proof for done without evidence', () => {
  const summary = buildWorkplaneTaskSummary({
    id: 9,
    name: 'Done without proof',
    column: 'done',
    blocked: true,
    blocker_reason: 'Waiting on receipt',
    output: '',
    metadata: {},
  });
  assert.ok(summary);
  assert.equal(summary.blocked, true);
  assert.equal(summary.blockerReason, 'Waiting on receipt');
  assert.equal(summary.missingProof, true);
  assert.match(summary.proofSummary ?? '', /No evidence summary/);
});

test('createWorkplaneTaskSummaryLoadState covers empty/loading/error/ready envelopes', () => {
  assert.equal(createWorkplaneTaskSummaryLoadState({ status: 'loading', taskId: 1 }).status, 'loading');
  assert.equal(createWorkplaneTaskSummaryLoadState({ status: 'empty' }).status, 'empty');
  assert.equal(
    createWorkplaneTaskSummaryLoadState({ status: 'error', errorMessage: 'boom' }).errorMessage,
    'boom',
  );
  const ready = createWorkplaneTaskSummaryLoadState({
    status: 'ready',
    summary: buildWorkplaneTaskSummary(SAMPLE_TASK),
  });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.summary?.identifier, '#22');
});

test('TaskSummaryPanel renders loading/empty/error/ready states', () => {
  const loading = renderToStaticMarkup(
    createElement(TaskSummaryPanel, {
      loadState: createWorkplaneTaskSummaryLoadState({ status: 'loading', taskId: 22 }),
    }),
  );
  assert.match(loading, /data-testid="workplane-task-summary"/);
  assert.match(loading, /data-summary-status="loading"/);
  assert.match(loading, /data-testid="workplane-task-summary-loading"/);
  assert.match(loading, /Loading task summary/);

  const empty = renderToStaticMarkup(
    createElement(TaskSummaryPanel, {
      loadState: createWorkplaneTaskSummaryLoadState({ status: 'empty', taskId: null }),
    }),
  );
  assert.match(empty, /data-summary-status="empty"/);
  assert.match(empty, /data-testid="workplane-task-summary-empty"/);
  assert.match(empty, /No task available/);

  const missing = renderToStaticMarkup(
    createElement(TaskSummaryPanel, {
      loadState: createWorkplaneTaskSummaryLoadState({ status: 'empty', taskId: 404 }),
    }),
  );
  assert.match(missing, /Task 404 was not found/);

  const error = renderToStaticMarkup(
    createElement(TaskSummaryPanel, {
      loadState: createWorkplaneTaskSummaryLoadState({
        status: 'error',
        taskId: 22,
        errorMessage: 'Network down',
      }),
      onRetry: () => undefined,
    }),
  );
  assert.match(error, /data-summary-status="error"/);
  assert.match(error, /data-testid="workplane-task-summary-error"/);
  assert.match(error, /Network down/);
  assert.match(error, /data-testid="workplane-task-summary-retry"/);

  const ready = renderToStaticMarkup(
    createElement(TaskSummaryPanel, {
      loadState: createWorkplaneTaskSummaryLoadState({
        status: 'ready',
        summary: buildWorkplaneTaskSummary(SAMPLE_TASK),
      }),
    }),
  );
  assert.match(ready, /data-summary-status="ready"/);
  assert.match(ready, /data-testid="workplane-task-summary-ready"/);
  assert.match(ready, /data-testid="workplane-task-summary-title"/);
  assert.match(ready, /Restore Workplane on refresh/);
  assert.match(ready, /#22/);
  assert.match(ready, /Doing/);
  assert.match(ready, /Review pending/);
  assert.match(ready, /Refresh restore browser proof/);
});

test('WorkplaneShell exposes task summary panel for default task_summary panel', () => {
  const summary = buildWorkplaneTaskSummary(SAMPLE_TASK);
  assert.ok(summary);

  const happy = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/22',
      taskSummaryState: createWorkplaneTaskSummaryLoadState({ status: 'ready', summary }),
    }),
  );
  assert.match(happy, /data-workplane-active-panel="task_summary"/);
  assert.match(happy, /data-workplane-summary-status="ready"/);
  assert.match(happy, /data-testid="workplane-task-summary-ready"/);
  assert.match(happy, /Restore Workplane on refresh/);

  const loading = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/22',
      taskSummaryState: createWorkplaneTaskSummaryLoadState({ status: 'loading', taskId: 22 }),
    }),
  );
  assert.match(loading, /data-workplane-summary-status="loading"/);
  assert.match(loading, /data-testid="workplane-task-summary-loading"/);

  const errored = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/22',
      taskSummaryState: createWorkplaneTaskSummaryLoadState({
        status: 'error',
        taskId: 22,
        errorMessage: 'Failed to fetch',
      }),
    }),
  );
  assert.match(errored, /data-workplane-summary-status="error"/);
  assert.match(errored, /Failed to fetch/);

  const emptyTask = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/22',
      taskSummaryState: createWorkplaneTaskSummaryLoadState({ status: 'empty', taskId: 22 }),
    }),
  );
  assert.match(emptyTask, /data-workplane-summary-status="empty"/);
  assert.match(emptyTask, /Task 22 was not found/);

  const invalid = renderToStaticMarkup(
    createElement(WorkplaneShell, { pathname: '/workplane/abc' }),
  );
  assert.match(invalid, /data-workplane-status="invalid_route"/);
  assert.match(invalid, /data-testid="workplane-task-summary-empty"/);
});

test('WorkplaneShell keeps later panels as placeholders (not proof_bundle)', () => {
  const html = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/22',
      search: '?panel=files_docs',
      taskSummaryState: createWorkplaneTaskSummaryLoadState({
        status: 'ready',
        summary: buildWorkplaneTaskSummary(SAMPLE_TASK),
      }),
    }),
  );
  assert.match(html, /data-workplane-active-panel="files_docs"/);
  assert.match(html, /Placeholder/);
  assert.doesNotMatch(html, /data-testid="workplane-task-summary-ready"/);
  assert.doesNotMatch(html, /data-testid="workplane-proof-bundle-ready"/);
});
