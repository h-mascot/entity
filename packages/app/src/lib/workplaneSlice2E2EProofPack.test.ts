import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WORKPLANE_SLICE2_E2E_CODE,
  WORKPLANE_SLICE2_E2E_FIXTURE,
  WORKPLANE_SLICE2_E2E_ISSUE,
  WORKPLANE_SLICE2_E2E_SCENARIOS,
  buildWorkplaneSlice2E2EDeskHref,
  evaluateAllWorkplaneSlice2E2EScenarios,
  evaluateWorkplaneSlice2E2EScenario,
  payloadHasSecretKeys,
} from './workplaneSlice2E2EProofPack.ts';

test('WP2-B-07 pack covers required scenario ids exactly once', () => {
  assert.equal(WORKPLANE_SLICE2_E2E_ISSUE, 'THE-888');
  assert.equal(WORKPLANE_SLICE2_E2E_CODE, 'WP2-B-07');
  const ids = WORKPLANE_SLICE2_E2E_SCENARIOS.map((s) => s.id).sort();
  assert.deepEqual(ids, [
    'admin_settings_no_secrets',
    'chief_ask',
    'invite',
    'presence',
    'progress',
  ]);
  assert.deepEqual(
    [...WORKPLANE_SLICE2_E2E_SCENARIOS]
      .sort((a, b) => a.stepOrder - b.stepOrder)
      .map((s) => s.id),
    ['invite', 'progress', 'presence', 'chief_ask', 'admin_settings_no_secrets'],
  );
});

test('evaluateAllWorkplaneSlice2E2EScenarios passes for fixture contracts', () => {
  const results = evaluateAllWorkplaneSlice2E2EScenarios();
  assert.equal(results.length, 5);
  for (const result of results) {
    assert.equal(result.pass, true, `${result.scenarioId}: ${result.failures.join('; ')}`);
  }
});

test('progress scenario expects completed invite with verified checklist', () => {
  const evalResult = evaluateWorkplaneSlice2E2EScenario('progress');
  assert.equal(evalResult.pass, true);
  assert.equal(WORKPLANE_SLICE2_E2E_FIXTURE.completedInvite.status, 'completed');
  assert.equal(payloadHasSecretKeys(WORKPLANE_SLICE2_E2E_FIXTURE.completedInvite), false);
  assert.match(buildWorkplaneSlice2E2EDeskHref('http://127.0.0.1:3075'), /invite-desk/);
});

test('negative: secret-bearing payload is detected', () => {
  assert.equal(payloadHasSecretKeys({ token: 'leak' }), true);
  assert.equal(payloadHasSecretKeys({ inviteId: 'x', status: 'created' }), false);
  assert.equal(payloadHasSecretKeys(WORKPLANE_SLICE2_E2E_FIXTURE.askPanel), false);
  assert.equal(payloadHasSecretKeys(WORKPLANE_SLICE2_E2E_FIXTURE.adminSettings), false);
});
