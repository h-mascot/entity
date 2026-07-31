import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import CommentsReviewChecklistPanel from '../components/workplane/CommentsReviewChecklistPanel.tsx';
import WorkplaneShell from '../components/workplane/WorkplaneShell.tsx';
import {
  REVIEW_DECISION_LABELS,
  normalizeReviewDecision,
  reviewActionToDecision,
} from '../components/mission-control/reviewActions.ts';
import { createWorkplaneActivityProgressLoadState } from './workplaneActivityProgress.ts';
import { createWorkplaneFilesDocsLoadState } from './workplaneFilesDocs.ts';
import { createWorkplaneProofBundleLoadState } from './workplaneProofBundle.ts';
import { createWorkplaneTaskSummaryLoadState } from './workplaneTaskSummary.ts';
import {
  REVIEW_CHECKLIST_ACTION_VIEWS,
  buildCommentsReviewBundle,
  buildReviewPacketSummary,
  createWorkplaneCommentsReviewLoadState,
  normalizeWorkplaneComment,
} from './workplaneCommentsReview.ts';

const SAMPLE_TASK = {
  id: 873,
  name: 'Review checklist panel',
  column: 'in_progress',
  review_required: true,
  reviewer: 'henry',
  metadata: JSON.stringify({
    review_decision: 'needs_fix',
    review_type: 'peer',
    review_note: 'Needs a clearer proof receipt before accept.',
    reviewed_by: 'henry',
    reviewed_at: '2026-07-30T12:00:00.000Z',
    review_packet: {
      requested_outcome: 'Ship Workplane comments panel',
      done_criteria: ['Comments render', 'Review decision visible', 'Empty state explicit'],
    },
    human_gate_required: true,
    human_gate_state: 'pending',
  }),
};

const SAMPLE_COMMENTS = [
  {
    id: 1,
    task_id: 873,
    body: 'Please attach the receipt path.',
    author: 'henry',
    created_at: '2026-07-30T11:00:00.000Z',
  },
  {
    id: 2,
    task_id: 873,
    body: 'Working on it.',
    author: 'agent',
    parent_id: 1,
    created_at: '2026-07-30T11:30:00.000Z',
  },
];

test('reviewActions semantics: normalize + action→decision labels used by checklist', () => {
  assert.equal(normalizeReviewDecision('needs_fix'), 'needs_fix');
  assert.equal(normalizeReviewDecision('Needs Fix'), 'needs_fix');
  assert.equal(normalizeReviewDecision('request_fix'), 'needs_fix');
  assert.equal(normalizeReviewDecision('unknown'), 'pending');
  assert.equal(reviewActionToDecision('accept'), 'accepted');
  assert.equal(reviewActionToDecision('reject'), 'rejected');
  assert.equal(REVIEW_DECISION_LABELS.needs_fix, 'Needs fix');
  assert.equal(REVIEW_CHECKLIST_ACTION_VIEWS.length, 4);
  assert.equal(
    REVIEW_CHECKLIST_ACTION_VIEWS.find((a) => a.action === 'needs_fix')?.decision,
    'needs_fix',
  );
});

test('buildCommentsReviewBundle prefers metadata decision when review_state is not_required', () => {
  const bundle = buildCommentsReviewBundle({
    task: {
      id: 874,
      name: 'Accepted via metadata',
      review_required: false,
      review_state: 'not_required',
      metadata: {
        review_decision: 'accepted',
        review_type: 'peer',
        reviewed_by: 'henry',
      },
    },
    comments: [],
    commentsAvailable: true,
  });
  assert.ok(bundle);
  assert.equal(bundle.decision, 'accepted');
  assert.equal(bundle.decisionLabel, 'Accepted');
});

test('buildCommentsReviewBundle maps API request_fix review_state to needs_fix', () => {
  const bundle = buildCommentsReviewBundle({
    task: {
      id: 23,
      name: 'API vocabulary',
      review_required: true,
      review_state: 'request_fix',
      metadata: {
        review_decision: 'request_fix',
        review_type: 'peer',
        reviewer: 'henry',
      },
    },
    comments: [],
    commentsAvailable: true,
  });
  assert.ok(bundle);
  assert.equal(bundle.decision, 'needs_fix');
  assert.equal(bundle.decisionLabel, 'Needs fix');
  assert.equal(bundle.reviewReady, false);
});

test('buildReviewPacketSummary maps outcome + criteria count', () => {
  assert.equal(
    buildReviewPacketSummary({
      review_packet: { requested_outcome: 'Ship', done_criteria: ['a', 'b'] },
    }),
    'Ship / 2 criteria',
  );
  assert.equal(buildReviewPacketSummary({}), null);
});

test('buildCommentsReviewBundle maps review metadata + comments (success path)', () => {
  const bundle = buildCommentsReviewBundle({
    task: SAMPLE_TASK,
    comments: SAMPLE_COMMENTS,
    commentsAvailable: true,
  });
  assert.ok(bundle);
  assert.equal(bundle.taskId, 873);
  assert.equal(bundle.decision, 'needs_fix');
  assert.equal(bundle.decisionLabel, 'Needs fix');
  assert.equal(bundle.reviewer, 'henry');
  assert.equal(bundle.reviewRequired, true);
  assert.equal(bundle.hasReviewMetadata, true);
  assert.match(bundle.packetSummary ?? '', /Ship Workplane comments panel/);
  assert.equal(bundle.comments.length, 2);
  assert.equal(bundle.commentsEmpty, false);
  assert.equal(bundle.reviewReady, false);
  assert.ok(bundle.checklist.some((item) => item.source === 'done_criteria'));
  assert.ok(bundle.checklist.some((item) => item.id === 'review-decision'));
  assert.ok(bundle.checklist.some((item) => item.source === 'human_gate'));
});

test('buildCommentsReviewBundle returns null for missing/invalid task (empty path)', () => {
  assert.equal(buildCommentsReviewBundle({ task: null }), null);
  assert.equal(buildCommentsReviewBundle({ task: {} }), null);
  assert.equal(buildCommentsReviewBundle({ task: { id: 0, name: 'x' } }), null);
  assert.equal(buildCommentsReviewBundle({ task: { id: 3, name: '   ' } }), null);
});

test('buildCommentsReviewBundle degrades when comments unavailable (negative path)', () => {
  const bundle = buildCommentsReviewBundle({
    task: {
      id: 9,
      name: 'No comments endpoint',
      metadata: { review_decision: 'pending', review_type: 'human' },
    },
    comments: [],
    commentsAvailable: false,
  });
  assert.ok(bundle);
  assert.equal(bundle.commentsAvailable, false);
  assert.equal(bundle.degraded, true);
  assert.equal(bundle.reviewReady, false);
  assert.ok(bundle.warnings.some((w) => w.code === 'comments_unavailable'));
});

test('normalizeWorkplaneComment skips invalid rows', () => {
  assert.equal(normalizeWorkplaneComment(null), null);
  assert.equal(normalizeWorkplaneComment({ body: 'no id' }), null);
  const ok = normalizeWorkplaneComment({
    id: 12,
    task_id: 3,
    body: 'hi',
    author: 'ops',
  });
  assert.equal(ok?.id, 12);
  assert.equal(ok?.body, 'hi');
});

test('createWorkplaneCommentsReviewLoadState covers empty/loading/error/ready', () => {
  assert.equal(
    createWorkplaneCommentsReviewLoadState({ status: 'loading', taskId: 1 }).status,
    'loading',
  );
  assert.equal(createWorkplaneCommentsReviewLoadState({ status: 'empty' }).status, 'empty');
  assert.equal(
    createWorkplaneCommentsReviewLoadState({ status: 'error', errorMessage: 'boom' }).errorMessage,
    'boom',
  );
  const ready = createWorkplaneCommentsReviewLoadState({
    status: 'ready',
    bundle: buildCommentsReviewBundle({
      task: SAMPLE_TASK,
      comments: SAMPLE_COMMENTS,
    }),
  });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.bundle?.reviewReady, false);
});

test('CommentsReviewChecklistPanel renders loading/empty/error/ready', () => {
  const loading = renderToStaticMarkup(
    createElement(CommentsReviewChecklistPanel, {
      loadState: createWorkplaneCommentsReviewLoadState({ status: 'loading', taskId: 873 }),
    }),
  );
  assert.match(loading, /data-testid="workplane-comments-review-loading"/);
  assert.match(loading, /data-review-ready="false"/);

  const empty = renderToStaticMarkup(
    createElement(CommentsReviewChecklistPanel, {
      loadState: createWorkplaneCommentsReviewLoadState({ status: 'empty', taskId: 404 }),
    }),
  );
  assert.match(empty, /data-testid="workplane-comments-review-empty"/);

  const error = renderToStaticMarkup(
    createElement(CommentsReviewChecklistPanel, {
      loadState: createWorkplaneCommentsReviewLoadState({
        status: 'error',
        taskId: 873,
        errorMessage: 'network down',
      }),
      onRetry: () => undefined,
    }),
  );
  assert.match(error, /data-testid="workplane-comments-review-error"/);
  assert.match(error, /network down/);
  assert.match(error, /data-testid="workplane-comments-review-retry"/);

  const ready = renderToStaticMarkup(
    createElement(CommentsReviewChecklistPanel, {
      loadState: createWorkplaneCommentsReviewLoadState({
        status: 'ready',
        bundle: buildCommentsReviewBundle({
          task: SAMPLE_TASK,
          comments: SAMPLE_COMMENTS,
        }),
      }),
    }),
  );
  assert.match(ready, /data-testid="workplane-comments-review-ready"/);
  assert.match(ready, /data-review-decision="needs_fix"/);
  assert.match(ready, /Please attach the receipt path/);
  assert.match(ready, /data-testid="workplane-review-checklist-item"/);
  assert.match(ready, /data-testid="workplane-review-action-accept"/);
  assert.match(ready, /data-review-ready="false"/);
  assert.doesNotMatch(ready, /review-ready="true"/);
});

test('CommentsReviewChecklistPanel ready-empty comments is explicit', () => {
  const html = renderToStaticMarkup(
    createElement(CommentsReviewChecklistPanel, {
      loadState: createWorkplaneCommentsReviewLoadState({
        status: 'ready',
        bundle: buildCommentsReviewBundle({
          task: {
            id: 10,
            name: 'Quiet task',
            metadata: { review_decision: 'accepted', review_type: 'auto' },
          },
          comments: [],
          commentsAvailable: true,
        }),
      }),
    }),
  );
  assert.match(html, /data-testid="workplane-comments-empty"/);
  assert.match(html, /data-comments-empty="true"/);
  assert.match(html, /data-review-decision="accepted"/);
});

test('WorkplaneShell renders CommentsReviewChecklistPanel for comments_review_checklist', () => {
  const bundle = buildCommentsReviewBundle({
    task: SAMPLE_TASK,
    comments: SAMPLE_COMMENTS,
  });
  const html = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/873',
      search: '?panel=comments_review_checklist',
      taskSummaryState: createWorkplaneTaskSummaryLoadState({ status: 'empty', taskId: 873 }),
      proofBundleState: createWorkplaneProofBundleLoadState({ status: 'empty', taskId: 873 }),
      filesDocsState: createWorkplaneFilesDocsLoadState({ status: 'empty', taskId: 873 }),
      activityProgressState: createWorkplaneActivityProgressLoadState({
        status: 'empty',
        taskId: 873,
      }),
      commentsReviewState: createWorkplaneCommentsReviewLoadState({
        status: 'ready',
        bundle,
      }),
    }),
  );
  assert.match(html, /data-workplane-active-panel="comments_review_checklist"/);
  assert.match(html, /data-testid="workplane-comments-review-ready"/);
  assert.match(html, /data-review-decision="needs_fix"/);
  assert.doesNotMatch(html, /Placeholder — full panel ships/);

  const other = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/873',
      search: '?panel=activity_progress',
      taskSummaryState: createWorkplaneTaskSummaryLoadState({ status: 'empty', taskId: 873 }),
      proofBundleState: createWorkplaneProofBundleLoadState({ status: 'empty', taskId: 873 }),
      filesDocsState: createWorkplaneFilesDocsLoadState({ status: 'empty', taskId: 873 }),
      activityProgressState: createWorkplaneActivityProgressLoadState({
        status: 'ready',
        bundle: {
          taskId: 873,
          events: [],
          empty: true,
          degraded: false,
          warnings: [],
          reviewReady: false,
        },
      }),
      commentsReviewState: createWorkplaneCommentsReviewLoadState({
        status: 'ready',
        bundle,
      }),
    }),
  );
  assert.match(other, /data-testid="workplane-activity-progress"/);
  assert.doesNotMatch(other, /data-testid="workplane-comments-review-ready"/);
});
