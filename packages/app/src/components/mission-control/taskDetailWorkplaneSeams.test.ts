import assert from 'node:assert/strict';
import test from 'node:test';
import {
  characterizeTaskDetailWorkplaneSeams,
  deriveMissingEvidenceState,
  extractTaskOutputLinks,
  hasReviewMetadata,
  normalizeTaskOutputHref,
  receiptStatusTone,
  WORKPLANE_PANEL_SEAM_MAP,
} from './taskDetailWorkplaneSeams.ts';

test('normalizeTaskOutputHref maps Entity docs and workspace paths', () => {
  assert.equal(normalizeTaskOutputHref('output/proofs/run.md'), '/docs/output/proofs/run.md');
  assert.equal(normalizeTaskOutputHref('docs/notes/plan.md'), '/docs/workspace/docs/notes/plan.md');
  assert.equal(normalizeTaskOutputHref('/tasks/42'), '/task/42');
  assert.equal(normalizeTaskOutputHref('https://example.com/report'), 'https://example.com/report');
  assert.equal(normalizeTaskOutputHref(''), null);
});

test('extractTaskOutputLinks success path collects distinct normalized links', () => {
  const links = extractTaskOutputLinks(
    'See output/demo/proof.md and https://example.com/artifact.json plus output/demo/proof.md again.',
  );
  assert.equal(links.length, 2);
  assert.equal(links[0]?.href, '/docs/output/demo/proof.md');
  assert.equal(links[0]?.external, false);
  assert.equal(links[1]?.href, 'https://example.com/artifact.json');
  assert.equal(links[1]?.external, true);
});

test('extractTaskOutputLinks negative path returns empty for plain text', () => {
  assert.deepEqual(extractTaskOutputLinks('no durable links here'), []);
  assert.deepEqual(extractTaskOutputLinks(''), []);
});

test('receiptStatusTone fails closed on missing/invalid integrity', () => {
  assert.equal(receiptStatusTone('created', 'valid', 'available'), 'ok');
  assert.equal(receiptStatusTone('missing_receipt', 'valid', 'available'), 'error');
  assert.equal(receiptStatusTone('created', 'missing_body', 'available'), 'error');
  assert.equal(receiptStatusTone('pending', 'valid', 'available'), 'warning');
  assert.equal(receiptStatusTone('not required yet', 'valid', 'available'), 'muted');
});

test('deriveMissingEvidenceState marks done tasks without proof as missing', () => {
  const missing = deriveMissingEvidenceState({
    column: 'done',
    metadata: {},
    evidenceLinkCount: 0,
    outputLinkCount: 0,
  });
  assert.equal(missing.missingEvidence, true);
  assert.equal(missing.evidenceSummary, 'No evidence summary recorded.');
});

test('deriveMissingEvidenceState success path keeps evidence present when output links exist', () => {
  const present = deriveMissingEvidenceState({
    column: 'done',
    metadata: {},
    evidenceLinkCount: 0,
    outputLinkCount: 2,
  });
  assert.equal(present.missingEvidence, false);
  assert.equal(present.evidenceSummary, 'Output links are attached.');
});

test('hasReviewMetadata detects packet/decision and rejects empty metadata', () => {
  assert.equal(hasReviewMetadata({ review_decision: 'accepted' }), true);
  assert.equal(hasReviewMetadata({ review_packet: { requested_outcome: 'ship' } }), true);
  assert.equal(hasReviewMetadata({}), false);
});

test('characterizeTaskDetailWorkplaneSeams maps all Q33 panels and forbids route invention', () => {
  const characterization = characterizeTaskDetailWorkplaneSeams('deadbeef');
  assert.equal(characterization.decision, 'CHARACTERIZED');
  assert.equal(characterization.workplaneRouteImplemented, false);
  assert.equal(characterization.inventedEngineeringBoardData, false);
  assert.deepEqual(Object.keys(WORKPLANE_PANEL_SEAM_MAP).sort(), [
    'activity_progress',
    'comments_review_checklist',
    'files_docs',
    'missing_proof_warnings',
    'proof_bundle',
    'task_summary',
  ]);
  assert.equal(WORKPLANE_PANEL_SEAM_MAP.proof_bundle.status, 'reusable_now');
  assert.equal(WORKPLANE_PANEL_SEAM_MAP.activity_progress.status, 'reusable_now');
});
