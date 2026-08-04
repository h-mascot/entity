import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ActivityProgressPanel from '../components/workplane/ActivityProgressPanel.tsx';
import ProofBundlePanel from '../components/workplane/ProofBundlePanel.tsx';
import WorkplaneShell from '../components/workplane/WorkplaneShell.tsx';
import { normalizeProofBundle } from './proofBundle.ts';
import {
  createWorkplaneActivityProgressLoadState,
  normalizeActivityProgressBundle,
} from './workplaneActivityProgress.ts';
import { createWorkplaneCommentsReviewLoadState } from './workplaneCommentsReview.ts';
import { createWorkplaneFilesDocsLoadState } from './workplaneFilesDocs.ts';
import {
  countJobProofStatusSignals,
  extractJobProofStatusFromEvent,
  extractJobProofStatusSignal,
  formatJobProofStatusLabel,
  mergeJobProofIntoProofBundle,
  projectJobProofItemsFromActivityEvents,
} from './workplaneJobProofStatus.ts';
import { createWorkplaneProofBundleLoadState } from './workplaneProofBundle.ts';
import { createWorkplaneTaskSummaryLoadState } from './workplaneTaskSummary.ts';

const CALLBACK_PROOF_EVENT = {
  id: 11,
  taskId: 897,
  eventType: 'proof' as const,
  actor: { type: 'agent' as const, principalId: 'execution-engine:acp' },
  timestamp: '2026-07-31T10:00:00.000Z',
  payloadRef: null,
  payload: {
    adapterSource: 'activity_event',
    summary: 'ACP uploaded proof artifacts',
    data: {
      source: 'execution-engine-callback',
      execution_callback_kind: 'proof',
      provider: 'acp',
      provider_id: 'swarm.acp',
      job_id: 'job-897-proof',
      job_status: 'proof',
      event_body: {
        summary: 'ACP uploaded proof artifacts',
        commit_sha: 'abcdef1234567890',
        branch: 'runner/the-897',
        artifact_refs: [
          '/docs/output/entity/eepc-b-02/proof.md',
          'https://example.com/receipts/job-897.html',
        ],
      },
    },
  },
  sequence: 2,
  proofIncomplete: false,
};

const CALLBACK_STATUS_EVENT = {
  id: 12,
  taskId: 897,
  eventType: 'status' as const,
  actor: { type: 'agent' as const, principalId: 'execution-engine:acp' },
  timestamp: '2026-07-31T10:01:00.000Z',
  payloadRef: null,
  payload: {
    adapterSource: 'activity_event',
    summary: 'Job moved to running',
    data: {
      source: 'execution-engine-callback',
      execution_callback_kind: 'status',
      provider: 'acp',
      job_id: 'job-897-status',
      job_status: 'running',
      event_body: {
        summary: 'Job moved to running',
        status: 'running',
        run_state: 'active',
      },
    },
  },
  sequence: 3,
  proofIncomplete: false,
};

const SWARM_STATUS_EVENT = {
  id: null,
  taskId: 897,
  eventType: 'status' as const,
  actor: { type: 'agent' as const },
  timestamp: '2026-07-31T10:02:00.000Z',
  payloadRef: 'swarm_job:job-swarm-1',
  payload: {
    adapterSource: 'swarm_job',
    summary: 'Swarm running: collect receipts',
    swarm_job_id: 'job-swarm-1',
    swarm_status: 'running',
  },
  sequence: 4,
  proofIncomplete: false,
};

const PLAIN_PROGRESS_EVENT = {
  id: 1,
  taskId: 897,
  eventType: 'progress' as const,
  actor: { type: 'human' as const, principalId: 'henry' },
  timestamp: '2026-07-31T09:00:00.000Z',
  payloadRef: null,
  payload: { summary: 'Human note — not a job signal' },
  sequence: 1,
  proofIncomplete: false,
};

test('extractJobProofStatusSignal maps EEPC-A-03 callback proof/status payloads', () => {
  const proof = extractJobProofStatusSignal(CALLBACK_PROOF_EVENT.payload, 'proof');
  assert.ok(proof);
  assert.equal(proof.origin, 'execution_callback');
  assert.equal(proof.kind, 'proof');
  assert.equal(proof.jobId, 'job-897-proof');
  assert.equal(proof.provider, 'acp');
  assert.equal(proof.commitSha, 'abcdef1234567890');
  assert.deepEqual(proof.artifactRefs, [
    '/docs/output/entity/eepc-b-02/proof.md',
    'https://example.com/receipts/job-897.html',
  ]);

  const status = extractJobProofStatusSignal(CALLBACK_STATUS_EVENT.payload, 'status');
  assert.ok(status);
  assert.equal(status.kind, 'status');
  assert.equal(status.jobStatus, 'running');
  assert.equal(status.runState, 'active');
});

test('extractJobProofStatusSignal maps WP1-C-04 swarm_job adapter rows', () => {
  const signal = extractJobProofStatusFromEvent(SWARM_STATUS_EVENT);
  assert.ok(signal);
  assert.equal(signal.origin, 'swarm_job');
  assert.equal(signal.jobId, 'job-swarm-1');
  assert.equal(signal.jobStatus, 'running');
});

test('extractJobProofStatusSignal ignores non-job activity and secret-like refs', () => {
  assert.equal(extractJobProofStatusFromEvent(PLAIN_PROGRESS_EVENT), null);

  const leaked = extractJobProofStatusSignal({
    data: {
      source: 'execution-engine-callback',
      execution_callback_kind: 'proof',
      job_id: 'job-secret',
      event_body: {
        summary: 'should drop secret refs',
        artifact_refs: ['sk-abcdefghijklmnopqrstuvwxyz', 'Bearer abc.def.ghi'],
      },
    },
  });
  assert.ok(leaked);
  assert.deepEqual(leaked.artifactRefs, []);
});

test('projectJobProofItemsFromActivityEvents builds proof panel items; status does not invent proof', () => {
  const items = projectJobProofItemsFromActivityEvents([
    CALLBACK_PROOF_EVENT,
    CALLBACK_STATUS_EVENT,
    PLAIN_PROGRESS_EVENT,
  ]);
  assert.equal(items.length, 2);
  assert.ok(items.every((item) => item.source === 'execution_job_proof'));
  assert.ok(items.some((item) => item.path === '/docs/output/entity/eepc-b-02/proof.md'));
  assert.ok(items.some((item) => item.href === 'https://example.com/receipts/job-897.html'));
});

test('mergeJobProofIntoProofBundle merges job proof without inventing when absent', () => {
  const emptyBundle = normalizeProofBundle({
    id: 897,
    name: 'EEPC-B-02',
    column: 'doing',
    output: '',
    metadata: {},
  });
  assert.equal(emptyBundle.empty, true);

  const unchanged = mergeJobProofIntoProofBundle(emptyBundle, [CALLBACK_STATUS_EVENT]);
  assert.equal(unchanged.items.length, 0);
  assert.equal(unchanged.empty, true);

  const merged = mergeJobProofIntoProofBundle(emptyBundle, [
    CALLBACK_PROOF_EVENT,
    CALLBACK_STATUS_EVENT,
  ]);
  assert.equal(merged.empty, false);
  assert.equal(merged.missingEvidence, false);
  assert.ok(merged.items.some((item) => item.source === 'execution_job_proof'));
});

test('countJobProofStatusSignals counts proof/status job rows only', () => {
  const counts = countJobProofStatusSignals([
    PLAIN_PROGRESS_EVENT,
    CALLBACK_PROOF_EVENT,
    CALLBACK_STATUS_EVENT,
    SWARM_STATUS_EVENT,
  ]);
  assert.equal(counts.total, 3);
  assert.equal(counts.proof, 1);
  assert.equal(counts.status, 2);
  assert.ok(formatJobProofStatusLabel(extractJobProofStatusFromEvent(CALLBACK_STATUS_EVENT)!));
});

test('ActivityProgressPanel renders job badge/label for proof and status callbacks', () => {
  const bundle = normalizeActivityProgressBundle({
    taskId: 897,
    empty: false,
    degraded: false,
    warnings: [],
    events: [PLAIN_PROGRESS_EVENT, CALLBACK_PROOF_EVENT, CALLBACK_STATUS_EVENT],
  });
  const html = renderToStaticMarkup(
    createElement(ActivityProgressPanel, {
      loadState: createWorkplaneActivityProgressLoadState({
        status: 'ready',
        taskId: 897,
        bundle,
      }),
    }),
  );
  assert.match(html, /data-testid="workplane-activity-job-badge"/);
  assert.match(html, /data-testid="workplane-activity-job-label"/);
  assert.match(html, /data-activity-job-linked="true"/);
  assert.match(html, /data-activity-job-proof-count="1"/);
  assert.match(html, /data-activity-job-status-count="1"/);
  assert.match(html, /ACP uploaded proof artifacts/);
  assert.match(html, /Job moved to running/);
  assert.doesNotMatch(html, /sk-abcdefghijklmnopqrstuvwxyz/);
});

test('ProofBundlePanel shows job proof badge for execution_job_proof items', () => {
  const emptyBundle = normalizeProofBundle({
    id: 897,
    name: 'EEPC-B-02',
    column: 'doing',
    output: '',
    metadata: {},
  });
  const merged = mergeJobProofIntoProofBundle(emptyBundle, [CALLBACK_PROOF_EVENT]);
  const html = renderToStaticMarkup(
    createElement(ProofBundlePanel, {
      loadState: createWorkplaneProofBundleLoadState({
        status: 'ready',
        taskId: 897,
        bundle: merged,
      }),
    }),
  );
  assert.match(html, /data-testid="workplane-proof-job-badge"/);
  assert.match(html, /data-proof-job-linked="true"/);
  assert.match(html, /data-proof-source="execution_job_proof"/);
});

test('WorkplaneShell merges job proof into proof panel from activity state', () => {
  const activityBundle = normalizeActivityProgressBundle({
    taskId: 897,
    empty: false,
    degraded: false,
    warnings: [],
    events: [CALLBACK_PROOF_EVENT, CALLBACK_STATUS_EVENT],
  });
  const proofBundle = normalizeProofBundle({
    id: 897,
    name: 'EEPC-B-02 wire job proof',
    column: 'doing',
    output: '',
    metadata: {},
  });

  const html = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/897',
      search: '?panel=proof_bundle',
      taskSummaryState: createWorkplaneTaskSummaryLoadState({
        status: 'ready',
        taskId: 897,
        summary: {
          taskId: 897,
          identifier: '#897',
          title: 'EEPC-B-02',
          statusKey: 'doing',
          statusLabel: 'Doing',
          priority: null,
          assignee: null,
          blocked: false,
          blockerReason: null,
          descriptionPreview: null,
          reviewLabel: null,
          reviewState: null,
          proofSummary: null,
          missingProof: true,
          missingProofReason: 'No proof yet',
        },
      }),
      proofBundleState: createWorkplaneProofBundleLoadState({
        status: 'ready',
        taskId: 897,
        bundle: proofBundle,
      }),
      filesDocsState: createWorkplaneFilesDocsLoadState({ status: 'empty', taskId: 897 }),
      activityProgressState: createWorkplaneActivityProgressLoadState({
        status: 'ready',
        taskId: 897,
        bundle: activityBundle,
      }),
      commentsReviewState: createWorkplaneCommentsReviewLoadState({
        status: 'empty',
        taskId: 897,
      }),
    }),
  );

  assert.match(html, /data-workplane-job-signal-count="2"/);
  assert.match(html, /data-workplane-job-proof-count="1"/);
  assert.match(html, /data-workplane-job-status-count="1"/);
  assert.match(html, /data-testid="workplane-proof-job-badge"/);
  assert.match(html, /data-proof-source="execution_job_proof"/);
});

test('degraded path: incomplete job proof remains visible and not review-ready', () => {
  const incomplete = {
    ...CALLBACK_PROOF_EVENT,
    payload: {
      adapterSource: 'activity_event',
      summary: 'Proof callback without artifacts',
      data: {
        source: 'execution-engine-callback',
        execution_callback_kind: 'proof',
        provider: 'acp',
        job_id: 'job-incomplete',
        job_status: 'proof',
        event_body: {
          summary: 'Proof callback without artifacts',
          artifact_refs: [],
        },
      },
    },
    proofIncomplete: true,
  };
  const items = projectJobProofItemsFromActivityEvents([incomplete]);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.status, 'proof_incomplete');
  assert.equal(items[0]?.href, null);
  assert.equal(items[0]?.path, null);

  const html = renderToStaticMarkup(
    createElement(ActivityProgressPanel, {
      loadState: createWorkplaneActivityProgressLoadState({
        status: 'ready',
        taskId: 897,
        bundle: {
          taskId: 897,
          events: [incomplete],
          empty: false,
          degraded: true,
          warnings: [{ code: 'proof_event_incomplete', message: 'incomplete' }],
          reviewReady: false,
        },
      }),
    }),
  );
  assert.match(html, /data-activity-review-ready="false"/);
  assert.match(html, /data-activity-job-linked="true"/);
});
