import assert from 'node:assert/strict';
import test from 'node:test';
import { localReadinessLabel } from './ProviderSettings.tsx';

test('local Office readiness is rendered as an explicit fail-closed state', () => {
  assert.equal(localReadinessLabel('ready'), 'Ready');
  assert.equal(localReadinessLabel('bridge_not_installed'), 'Bridge not installed');
  assert.equal(localReadinessLabel('bridge_not_running'), 'Bridge not running');
  assert.equal(localReadinessLabel('engine_unavailable'), 'Engine unavailable');
  assert.equal(localReadinessLabel('degraded'), 'Degraded');
});
