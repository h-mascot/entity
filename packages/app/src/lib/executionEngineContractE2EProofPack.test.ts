import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ActivityProgressPanel from '../components/workplane/ActivityProgressPanel.tsx';
import ProofBundlePanel from '../components/workplane/ProofBundlePanel.tsx';
import {
  createWorkplaneActivityProgressLoadState,
  normalizeActivityProgressBundle,
} from './workplaneActivityProgress.ts';
import { createWorkplaneProofBundleLoadState } from './workplaneProofBundle.ts';
import { normalizeProofBundle } from './proofBundle.ts';
import { mergeJobProofIntoProofBundle } from './workplaneJobProofStatus.ts';
import {
  EEPC_CONTRACT_E2E_CODE,
  EEPC_CONTRACT_E2E_FIXTURE,
  EEPC_CONTRACT_E2E_ISSUE,
  EEPC_CONTRACT_E2E_SCENARIOS,
  buildEepcContractE2ESwarmHref,
  buildEepcContractE2EWorkplaneHref,
  eepcContractE2EPresets,
  evaluateAllEepcContractE2EScenarios,
  evaluateEepcContractE2EScenario,
  payloadHasSecretLeak,
} from './executionEngineContractE2EProofPack.ts';

test('EEPC-B-04 pack covers required scenario ids exactly once', () => {
  assert.equal(EEPC_CONTRACT_E2E_ISSUE, 'THE-899');
  assert.equal(EEPC_CONTRACT_E2E_CODE, 'EEPC-B-04');
  const ids = EEPC_CONTRACT_E2E_SCENARIOS.map((s) => s.id).sort();
  assert.deepEqual(ids, [
    'callback_to_workplane_proof',
    'degraded_health_visible',
    'list_engines_no_secrets',
    'malformed_callback_rejected',
    'operator_presets_dispatch',
    'unauthorized_callback_rejected',
  ]);
  assert.deepEqual(
    [...EEPC_CONTRACT_E2E_SCENARIOS]
      .sort((a, b) => a.stepOrder - b.stepOrder)
      .map((s) => s.id),
    [
      'list_engines_no_secrets',
      'operator_presets_dispatch',
      'callback_to_workplane_proof',
      'unauthorized_callback_rejected',
      'malformed_callback_rejected',
      'degraded_health_visible',
    ],
  );
});

test('evaluateAllEepcContractE2EScenarios passes for fixture contracts', () => {
  const results = evaluateAllEepcContractE2EScenarios();
  assert.equal(results.length, 6);
  for (const result of results) {
    assert.equal(result.pass, true, `${result.scenarioId}: ${result.failures.join('; ')}`);
  }
});

test('operator presets redact leaky health and refuse stub dispatch', () => {
  const presets = eepcContractE2EPresets();
  const acp = presets.find((p) => p.provider === 'acp');
  assert.ok(acp);
  assert.equal(acp.ready, true);
  assert.match(String(acp.healthMessage), /redacted/i);
  assert.equal(payloadHasSecretLeak({ healthMessage: acp.healthMessage }), false);
  assert.match(buildEepcContractE2ESwarmHref('http://127.0.0.1:3089'), /view=swarm/);
});

test('Workplane panels render job proof/status badges from callback events', () => {
  const events = EEPC_CONTRACT_E2E_FIXTURE.activityEvents;
  const activityBundle = normalizeActivityProgressBundle({
    taskId: EEPC_CONTRACT_E2E_FIXTURE.taskId,
    empty: false,
    degraded: false,
    warnings: [],
    events: [...events],
  });
  const activityHtml = renderToStaticMarkup(
    createElement(ActivityProgressPanel, {
      loadState: createWorkplaneActivityProgressLoadState({
        status: 'ready',
        taskId: EEPC_CONTRACT_E2E_FIXTURE.taskId,
        bundle: activityBundle,
      }),
    }),
  );
  assert.match(activityHtml, /data-testid="workplane-activity-job-badge"/);
  assert.match(activityHtml, /data-activity-job-proof-count="1"/);
  assert.match(activityHtml, /data-activity-job-status-count="1"/);
  assert.match(activityHtml, /EEPC-B-04 proof artifacts|Job moved to running/);

  const emptyBundle = normalizeProofBundle({
    id: EEPC_CONTRACT_E2E_FIXTURE.taskId,
    name: 'EEPC-B-04',
    column: 'doing',
    output: '',
    metadata: {},
  });
  const proofHtml = renderToStaticMarkup(
    createElement(ProofBundlePanel, {
      loadState: createWorkplaneProofBundleLoadState({
        status: 'ready',
        taskId: EEPC_CONTRACT_E2E_FIXTURE.taskId,
        bundle: mergeJobProofIntoProofBundle(emptyBundle, events),
      }),
    }),
  );
  assert.match(proofHtml, /data-testid="workplane-proof-job-badge"/);
  assert.match(proofHtml, /data-proof-source="execution_job_proof"/);
  assert.match(
    buildEepcContractE2EWorkplaneHref('http://127.0.0.1:3089'),
    /\/workplane\/899\?panel=activity_progress/,
  );
});

test('negative: secret-bearing payload is detected; security scenarios pass', () => {
  assert.equal(payloadHasSecretLeak({ token: 'leak' }), true);
  assert.equal(payloadHasSecretLeak({ authorization: 'Bearer abcdefghijklmnop' }), true);
  assert.equal(payloadHasSecretLeak({ provider: 'acp', jobId: 'x' }), false);
  assert.equal(evaluateEepcContractE2EScenario('unauthorized_callback_rejected').pass, true);
  assert.equal(evaluateEepcContractE2EScenario('malformed_callback_rejected').pass, true);
  assert.equal(evaluateEepcContractE2EScenario('degraded_health_visible').pass, true);
});
