import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ActivityProgressPanel from '../components/workplane/ActivityProgressPanel.tsx';
import WorkplaneShell from '../components/workplane/WorkplaneShell.tsx';
import {
  ACTIVITY_PROGRESS_SPINE_TYPES,
  countActivityProgressTypes,
  createWorkplaneActivityProgressLoadState,
  formatActivityProgressEventSummary,
  normalizeActivityProgressBundle,
  normalizeActivityProgressEvent,
} from './workplaneActivityProgress.ts';
import { createWorkplaneTaskSummaryLoadState } from './workplaneTaskSummary.ts';
import { createWorkplaneProofBundleLoadState } from './workplaneProofBundle.ts';
import { createWorkplaneFilesDocsLoadState } from './workplaneFilesDocs.ts';
import { createWorkplaneCommentsReviewLoadState } from './workplaneCommentsReview.ts';

const MIXED_API = {
  taskId: 871,
  empty: false,
  degraded: false,
  warnings: [],
  permissionState: 'visible',
  events: [
    {
      id: 1,
      taskId: 871,
      eventType: 'plan',
      actor: { type: 'human', principalId: 'henry' },
      timestamp: '2026-07-31T01:00:00.000Z',
      payloadRef: null,
      payload: { summary: 'Outline Workplane activity panel' },
      sequence: 1,
    },
    {
      id: 2,
      taskId: 871,
      eventType: 'progress',
      actor: { type: 'agent', principalId: 'cursor' },
      timestamp: '2026-07-31T01:05:00.000Z',
      payloadRef: null,
      payload: { message: 'Rendering typed events' },
      sequence: 2,
    },
    {
      id: 3,
      taskId: 871,
      eventType: 'log',
      actor: { type: 'system' },
      timestamp: '2026-07-31T01:06:00.000Z',
      payloadRef: 'log://wp1-c-03',
      payload: {},
      sequence: 3,
    },
    {
      id: 4,
      taskId: 871,
      eventType: 'proof',
      actor: { type: 'agent' },
      timestamp: '2026-07-31T01:10:00.000Z',
      payloadRef: '/docs/output/entity/wp1-c-03/proof.md',
      payload: { title: 'Panel proof receipt' },
      sequence: 4,
    },
    {
      id: 5,
      taskId: 871,
      eventType: 'status',
      actor: { type: 'workflow' },
      timestamp: '2026-07-31T01:11:00.000Z',
      payloadRef: null,
      payload: { status: 'in_review' },
      sequence: 5,
    },
    {
      id: 6,
      taskId: 871,
      eventType: 'blocker',
      actor: { type: 'unknown' },
      timestamp: '2026-07-31T01:12:00.000Z',
      payloadRef: null,
      payload: { summary: 'Waiting on browser proof' },
      sequence: 6,
    },
  ],
};

const EMPTY_API = {
  taskId: 872,
  events: [],
  empty: true,
  degraded: false,
  warnings: [],
  permissionState: 'visible',
};

test('ACTIVITY_PROGRESS_SPINE_TYPES matches THE-869 vocabulary order', () => {
  assert.deepEqual([...ACTIVITY_PROGRESS_SPINE_TYPES], [
    'plan',
    'progress',
    'log',
    'proof',
    'status',
    'blocker',
  ]);
});

test('normalizeActivityProgressBundle projects mixed spine types in sequence order', () => {
  const bundle = normalizeActivityProgressBundle(MIXED_API);
  assert.equal(bundle.taskId, 871);
  assert.equal(bundle.empty, false);
  assert.equal(bundle.reviewReady, false);
  assert.equal(bundle.events.length, 6);
  assert.deepEqual(
    bundle.events.map((event) => event.eventType),
    ['plan', 'progress', 'log', 'proof', 'status', 'blocker'],
  );
  const counts = countActivityProgressTypes(bundle);
  for (const type of ACTIVITY_PROGRESS_SPINE_TYPES) {
    assert.equal(counts[type], 1, `expected one ${type}`);
  }
});

test('normalizeActivityProgressBundle empty stream is explicit and not review-ready', () => {
  const bundle = normalizeActivityProgressBundle(EMPTY_API);
  assert.equal(bundle.taskId, 872);
  assert.equal(bundle.empty, true);
  assert.equal(bundle.events.length, 0);
  assert.equal(bundle.reviewReady, false);
  assert.equal(bundle.degraded, false);
});

test('normalizeActivityProgressBundle skips unknown types and marks degraded', () => {
  const bundle = normalizeActivityProgressBundle({
    taskId: 873,
    empty: false,
    degraded: false,
    warnings: [],
    events: [
      {
        id: 9,
        taskId: 873,
        eventType: 'runner_karaoke',
        actor: { type: 'agent' },
        timestamp: '2026-07-31T02:00:00.000Z',
        sequence: 1,
        payload: {},
      },
      {
        id: 10,
        taskId: 873,
        eventType: 'progress',
        actor: { type: 'agent' },
        timestamp: '2026-07-31T02:01:00.000Z',
        sequence: 2,
        payload: { summary: 'ok' },
      },
    ],
  });
  assert.equal(bundle.events.length, 1);
  assert.equal(bundle.events[0]?.eventType, 'progress');
  assert.equal(bundle.degraded, true);
  assert.equal(bundle.reviewReady, false);
  assert.ok(bundle.warnings.some((warning) => warning.code === 'unknown_or_missing_event_type'));
});

test('incomplete proof events are degraded and never review-ready', () => {
  const incomplete = normalizeActivityProgressEvent({
    taskId: 874,
    eventType: 'proof',
    actor: { type: 'agent' },
    timestamp: '2026-07-31T03:00:00.000Z',
    sequence: 1,
    payload: {},
  });
  assert.equal(incomplete.ok, true);
  if (!incomplete.ok) return;
  assert.equal(incomplete.event.proofIncomplete, true);
  assert.match(formatActivityProgressEventSummary(incomplete.event), /without payload/);

  const bundle = normalizeActivityProgressBundle({
    taskId: 874,
    empty: false,
    events: [
      {
        taskId: 874,
        eventType: 'proof',
        actor: { type: 'agent' },
        timestamp: '2026-07-31T03:00:00.000Z',
        sequence: 1,
        payload: {},
      },
    ],
  });
  assert.equal(bundle.degraded, true);
  assert.equal(bundle.reviewReady, false);
  assert.ok(bundle.warnings.some((warning) => warning.code === 'proof_event_incomplete'));
});

test('createWorkplaneActivityProgressLoadState covers empty/loading/error/ready', () => {
  assert.equal(
    createWorkplaneActivityProgressLoadState({ status: 'loading', taskId: 871 }).status,
    'loading',
  );
  assert.equal(createWorkplaneActivityProgressLoadState({ status: 'empty' }).status, 'empty');
  assert.equal(
    createWorkplaneActivityProgressLoadState({
      status: 'error',
      errorMessage: 'boom',
    }).errorMessage,
    'boom',
  );
  const ready = createWorkplaneActivityProgressLoadState({
    status: 'ready',
    bundle: normalizeActivityProgressBundle(MIXED_API),
  });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.bundle?.taskId, 871);
  assert.equal(ready.bundle?.reviewReady, false);
});

test('ActivityProgressPanel renders loading/empty/error/ready and typed events', () => {
  const loading = renderToStaticMarkup(
    createElement(ActivityProgressPanel, {
      loadState: createWorkplaneActivityProgressLoadState({ status: 'loading', taskId: 871 }),
    }),
  );
  assert.match(loading, /data-testid="workplane-activity-progress"/);
  assert.match(loading, /data-activity-status="loading"/);
  assert.match(loading, /data-testid="workplane-activity-progress-loading"/);
  assert.match(loading, /data-activity-review-ready="false"/);

  const empty = renderToStaticMarkup(
    createElement(ActivityProgressPanel, {
      loadState: createWorkplaneActivityProgressLoadState({ status: 'empty', taskId: null }),
    }),
  );
  assert.match(empty, /data-activity-status="empty"/);
  assert.match(empty, /No activity stream available/);

  const missing = renderToStaticMarkup(
    createElement(ActivityProgressPanel, {
      loadState: createWorkplaneActivityProgressLoadState({ status: 'empty', taskId: 404 }),
    }),
  );
  assert.match(missing, /Task 404 was not found/);

  const error = renderToStaticMarkup(
    createElement(ActivityProgressPanel, {
      loadState: createWorkplaneActivityProgressLoadState({
        status: 'error',
        taskId: 871,
        errorMessage: 'Network down',
      }),
      onRetry: () => undefined,
    }),
  );
  assert.match(error, /data-activity-status="error"/);
  assert.match(error, /Network down/);
  assert.match(error, /data-testid="workplane-activity-progress-retry"/);

  const ready = renderToStaticMarkup(
    createElement(ActivityProgressPanel, {
      loadState: createWorkplaneActivityProgressLoadState({
        status: 'ready',
        bundle: normalizeActivityProgressBundle(MIXED_API),
      }),
    }),
  );
  assert.match(ready, /data-activity-status="ready"/);
  assert.match(ready, /data-testid="workplane-activity-progress-ready"/);
  assert.match(ready, /data-activity-review-ready="false"/);
  for (const type of ACTIVITY_PROGRESS_SPINE_TYPES) {
    assert.match(ready, new RegExp(`data-activity-type="${type}"`));
    assert.match(ready, new RegExp(`data-testid="workplane-activity-type-count-${type}"`));
  }
  assert.match(ready, /Outline Workplane activity panel/);
  assert.match(ready, /Waiting on browser proof/);
  assert.match(ready, /data-testid="workplane-activity-event"/);
});

test('ActivityProgressPanel ready-empty state is explicit', () => {
  const html = renderToStaticMarkup(
    createElement(ActivityProgressPanel, {
      loadState: createWorkplaneActivityProgressLoadState({
        status: 'ready',
        bundle: normalizeActivityProgressBundle(EMPTY_API),
      }),
    }),
  );
  assert.match(html, /data-activity-empty="true"/);
  assert.match(html, /data-testid="workplane-activity-progress-empty-events"/);
  assert.match(html, /No activity events yet/);
  assert.match(html, /data-activity-review-ready="false"/);
  assert.doesNotMatch(html, /data-activity-review-ready="true"/);
  assert.doesNotMatch(html, /Review ready/i);
});

test('ActivityProgressPanel surfaces degraded incomplete proof without review-ready', () => {
  const html = renderToStaticMarkup(
    createElement(ActivityProgressPanel, {
      loadState: createWorkplaneActivityProgressLoadState({
        status: 'ready',
        bundle: normalizeActivityProgressBundle({
          taskId: 875,
          empty: false,
          events: [
            {
              taskId: 875,
              eventType: 'proof',
              actor: { type: 'agent' },
              timestamp: '2026-07-31T04:00:00.000Z',
              sequence: 1,
              payload: {},
            },
          ],
        }),
      }),
    }),
  );
  assert.match(html, /data-activity-degraded="true"/);
  assert.match(html, /data-testid="workplane-activity-progress-degraded"/);
  assert.match(html, /data-activity-proof-incomplete="true"/);
  assert.match(html, /not review-ready/i);
  assert.match(html, /data-activity-review-ready="false"/);
});

test('WorkplaneShell renders ActivityProgressPanel for activity_progress panel', () => {
  const bundle = normalizeActivityProgressBundle(MIXED_API);
  const html = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/871',
      search: '?panel=activity_progress',
      taskSummaryState: createWorkplaneTaskSummaryLoadState({ status: 'empty', taskId: 871 }),
      proofBundleState: createWorkplaneProofBundleLoadState({ status: 'empty', taskId: 871 }),
      filesDocsState: createWorkplaneFilesDocsLoadState({ status: 'empty', taskId: 871 }),
      activityProgressState: createWorkplaneActivityProgressLoadState({
        status: 'ready',
        bundle,
      }),
    }),
  );
  assert.match(html, /data-workplane-active-panel="activity_progress"/);
  assert.match(html, /data-testid="workplane-activity-progress-ready"/);
  assert.match(html, /data-activity-type="plan"/);
  assert.match(html, /data-activity-type="blocker"/);
  assert.doesNotMatch(html, /Placeholder — full panel ships/);

  const other = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/871',
      search: '?panel=comments_review_checklist',
      taskSummaryState: createWorkplaneTaskSummaryLoadState({ status: 'empty', taskId: 871 }),
      proofBundleState: createWorkplaneProofBundleLoadState({ status: 'empty', taskId: 871 }),
      filesDocsState: createWorkplaneFilesDocsLoadState({ status: 'empty', taskId: 871 }),
      activityProgressState: createWorkplaneActivityProgressLoadState({
        status: 'ready',
        bundle,
      }),
      commentsReviewState: createWorkplaneCommentsReviewLoadState({
        status: 'empty',
        taskId: 871,
      }),
    }),
  );
  assert.match(other, /data-testid="workplane-comments-review"/);
  assert.doesNotMatch(other, /data-testid="workplane-activity-progress-ready"/);
  assert.doesNotMatch(other, /Placeholder — full panel ships/);
});
