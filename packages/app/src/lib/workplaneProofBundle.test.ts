import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ProofBundlePanel from '../components/workplane/ProofBundlePanel.tsx';
import WorkplaneShell from '../components/workplane/WorkplaneShell.tsx';
import { normalizeProofBundle } from './proofBundle.ts';
import {
  countProofBundleKinds,
  createWorkplaneProofBundleLoadState,
  isProofBundleItemSelected,
  toProofBundleSelectionToken,
} from './workplaneProofBundle.ts';
import { createWorkplaneCommentsReviewLoadState } from './workplaneCommentsReview.ts';
import { createWorkplaneTaskSummaryLoadState } from './workplaneTaskSummary.ts';

const MIXED_TASK = {
  id: 64,
  name: 'Proof bundle panel fixture',
  column: 'review',
  output: [
    'Raw: [/docs/output/entity/wp1-b-03/raw.md](/docs/output/entity/wp1-b-03/raw.md)',
    'Doc: [/docs/workspace/docs/notes/plan.md](/docs/workspace/docs/notes/plan.md)',
    'Ext: [https://example.com/external-proof](https://example.com/external-proof)',
  ].join('\n'),
  metadata: {
    evidence_summary: 'Mixed raw/curated/external/unknown proof for THE-864.',
    evidence_links: ['opaque-token-without-path'],
    phase2_receipt: {
      artifact_id: 'receipt_wp1_b_03',
      artifact_kind: 'raw_task_receipt',
      human_path_alias: '/docs/output/entity/wp1-b-03/receipt.md',
      status: 'present',
    },
    native_documents: [
      {
        id: 'native_plan',
        title: 'Plan note',
        object_type: 'native_document',
        path: '/docs/workspace/docs/notes/plan.md',
      },
    ],
    external_document_refs: [
      {
        id: 'ext_ref_1',
        title: 'Partner brief',
        object_type: 'external_document_ref',
        external_url: 'https://example.com/partner-brief',
      },
    ],
  },
};

const EMPTY_TASK = {
  id: 65,
  name: 'No proof yet',
  column: 'todo',
  output: '',
  metadata: {},
};

test('normalizeProofBundle mixed fixture yields raw/curated/external/unknown', () => {
  const bundle = normalizeProofBundle(MIXED_TASK);
  assert.equal(bundle.taskId, 64);
  assert.equal(bundle.empty, false);
  const counts = countProofBundleKinds(bundle);
  assert.ok(counts.raw >= 1);
  assert.ok(counts.curated >= 1);
  assert.ok(counts.external >= 1);
  assert.ok(counts.unknown >= 1);
  assert.match(bundle.evidenceSummary ?? '', /Mixed raw\/curated/);
});

test('createWorkplaneProofBundleLoadState covers empty/loading/error/ready', () => {
  assert.equal(
    createWorkplaneProofBundleLoadState({ status: 'loading', taskId: 64 }).status,
    'loading',
  );
  assert.equal(createWorkplaneProofBundleLoadState({ status: 'empty' }).status, 'empty');
  assert.equal(
    createWorkplaneProofBundleLoadState({ status: 'error', errorMessage: 'boom' }).errorMessage,
    'boom',
  );
  const ready = createWorkplaneProofBundleLoadState({
    status: 'ready',
    bundle: normalizeProofBundle(MIXED_TASK),
  });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.bundle?.taskId, 64);
  assert.equal(ready.bundle?.empty, false);
});

test('toProofBundleSelectionToken yields URL-safe tokens', () => {
  const bundle = normalizeProofBundle(MIXED_TASK);
  for (const item of bundle.items) {
    const token = toProofBundleSelectionToken(item);
    assert.ok(token, `expected token for ${item.id}`);
    assert.match(token!, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
    assert.equal(token!.includes('/'), false);
  }
  const first = bundle.items[0];
  assert.equal(isProofBundleItemSelected(first, toProofBundleSelectionToken(first)), true);
  assert.equal(isProofBundleItemSelected(first, 'not-this-proof'), false);
});

test('ProofBundlePanel renders loading/empty/error/ready and kind badges', () => {
  const loading = renderToStaticMarkup(
    createElement(ProofBundlePanel, {
      loadState: createWorkplaneProofBundleLoadState({ status: 'loading', taskId: 64 }),
    }),
  );
  assert.match(loading, /data-testid="workplane-proof-bundle"/);
  assert.match(loading, /data-proof-status="loading"/);
  assert.match(loading, /data-testid="workplane-proof-bundle-loading"/);

  const empty = renderToStaticMarkup(
    createElement(ProofBundlePanel, {
      loadState: createWorkplaneProofBundleLoadState({ status: 'empty', taskId: null }),
    }),
  );
  assert.match(empty, /data-proof-status="empty"/);
  assert.match(empty, /No proof available/);

  const missing = renderToStaticMarkup(
    createElement(ProofBundlePanel, {
      loadState: createWorkplaneProofBundleLoadState({ status: 'empty', taskId: 404 }),
    }),
  );
  assert.match(missing, /Task 404 was not found/);

  const error = renderToStaticMarkup(
    createElement(ProofBundlePanel, {
      loadState: createWorkplaneProofBundleLoadState({
        status: 'error',
        taskId: 64,
        errorMessage: 'Network down',
      }),
      onRetry: () => undefined,
    }),
  );
  assert.match(error, /data-proof-status="error"/);
  assert.match(error, /Network down/);
  assert.match(error, /data-testid="workplane-proof-bundle-retry"/);

  const ready = renderToStaticMarkup(
    createElement(ProofBundlePanel, {
      loadState: createWorkplaneProofBundleLoadState({
        status: 'ready',
        bundle: normalizeProofBundle(MIXED_TASK),
      }),
    }),
  );
  assert.match(ready, /data-proof-status="ready"/);
  assert.match(ready, /data-testid="workplane-proof-bundle-ready"/);
  assert.match(ready, /data-proof-kind="raw"/);
  assert.match(ready, /data-proof-kind="curated"/);
  assert.match(ready, /data-proof-kind="external"/);
  assert.match(ready, /data-proof-kind="unknown"/);
  assert.match(ready, /data-testid="workplane-proof-kind-count-raw"/);
  assert.match(ready, /Mixed raw\/curated/);
  assert.match(ready, /data-testid="workplane-proof-item"/);
});

test('ProofBundlePanel ready-empty and malformed inputs stay fail-closed', () => {
  const emptyReady = renderToStaticMarkup(
    createElement(ProofBundlePanel, {
      loadState: createWorkplaneProofBundleLoadState({
        status: 'ready',
        bundle: normalizeProofBundle(EMPTY_TASK),
      }),
    }),
  );
  assert.match(emptyReady, /data-proof-empty="true"/);
  assert.match(emptyReady, /data-testid="workplane-proof-bundle-empty-items"/);
  assert.match(emptyReady, /No proof items/);

  const malformed = normalizeProofBundle({
    id: 66,
    name: 'Malformed evidence',
    column: 'done',
    output: '',
    metadata: {
      evidence_links: [null, '', { title: '' }, '!!!'],
      evidence_summary: null,
    },
  });
  assert.equal(malformed.empty, true);
  const html = renderToStaticMarkup(
    createElement(ProofBundlePanel, {
      loadState: createWorkplaneProofBundleLoadState({
        status: 'ready',
        bundle: malformed,
      }),
    }),
  );
  assert.match(html, /data-proof-empty="true"/);
  assert.match(html, /No proof items/);
  // done without evidence should surface missing warning, not invent items
  assert.match(html, /data-missing-evidence="true"/);
  assert.match(html, /data-testid="workplane-proof-bundle-missing"/);
});

test('ProofBundlePanel highlights selected proof token', () => {
  const bundle = normalizeProofBundle(MIXED_TASK);
  const selectable = bundle.items
    .map((item) => ({ item, token: toProofBundleSelectionToken(item) }))
    .find((entry) => entry.token);
  assert.ok(selectable?.token);

  const html = renderToStaticMarkup(
    createElement(ProofBundlePanel, {
      loadState: createWorkplaneProofBundleLoadState({ status: 'ready', bundle }),
      selectedProof: selectable!.token,
      onSelectProof: () => undefined,
    }),
  );
  assert.match(html, /data-proof-selected="true"/);
  assert.match(html, /data-testid="workplane-proof-item-select"/);
});

test('WorkplaneShell renders ProofBundlePanel for proof_bundle panel', () => {
  const bundle = normalizeProofBundle(MIXED_TASK);
  const html = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/64',
      search: '?panel=proof_bundle',
      taskSummaryState: createWorkplaneTaskSummaryLoadState({ status: 'empty', taskId: 64 }),
      proofBundleState: createWorkplaneProofBundleLoadState({ status: 'ready', bundle }),
    }),
  );
  assert.match(html, /data-workplane-active-panel="proof_bundle"/);
  assert.match(html, /data-testid="workplane-proof-bundle-ready"/);
  assert.match(html, /data-proof-kind="raw"/);
  assert.match(html, /data-proof-kind="external"/);
  assert.doesNotMatch(html, /Placeholder — full panel ships/);

  const other = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/64',
      search: '?panel=comments_review_checklist',
      taskSummaryState: createWorkplaneTaskSummaryLoadState({ status: 'empty', taskId: 64 }),
      proofBundleState: createWorkplaneProofBundleLoadState({ status: 'ready', bundle }),
      commentsReviewState: createWorkplaneCommentsReviewLoadState({
        status: 'empty',
        taskId: 64,
      }),
    }),
  );
  assert.match(other, /data-testid="workplane-comments-review"/);
  assert.doesNotMatch(other, /data-testid="workplane-proof-bundle-ready"/);
  assert.doesNotMatch(other, /Placeholder — full panel ships/);
});
