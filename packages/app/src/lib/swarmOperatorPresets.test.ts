import test from 'node:test';
import assert from 'node:assert/strict';

import { containsSecretShapedValue } from './executionEnginePublicHealth.ts';
import {
  buildSwarmDispatchPayload,
  buildSwarmOperatorPresets,
  findSwarmOperatorPreset,
  listSelectableSwarmOperatorPresets,
  selectDefaultSwarmOperatorPreset,
} from './swarmOperatorPresets.ts';

const engines = [
  {
    name: 'ccp',
    label: 'CCP (delivery control plane)',
    description: 'Registry stub — dispatch not accepted until implemented.',
    acceptsDispatch: false,
    executionMode: 'stub',
    category: 'delivery-control-plane',
    health: { available: false, message: 'stub' },
  },
  {
    name: 'eforge',
    label: 'eforge',
    description: 'Hybrid queue/API build system',
    acceptsDispatch: true,
    executionMode: 'hybrid',
    category: 'build-system',
    health: {
      available: true,
      message: 'reachable at http://127.0.0.1:4568 path=/Users/enterprise/queue',
      latencyMs: 12,
    },
  },
  {
    name: 'symphony',
    label: 'Symphony (Entity-native)',
    description: 'Pull-based orchestrator',
    acceptsDispatch: true,
    executionMode: 'pull',
    meta: { acceptsDispatch: true, executionMode: 'pull' },
    health: { available: false, message: 'Symphony URL not configured' },
  },
  {
    name: 'codex',
    label: 'Codex (app server)',
    acceptsDispatch: true,
    executionMode: 'push',
    // missing health → unknown
  },
];

test('buildSwarmOperatorPresets ranks ready dispatch engines first and redacts secrets', () => {
  const presets = buildSwarmOperatorPresets(engines);
  assert.equal(presets.length, 4);
  assert.equal(presets[0].provider, 'eforge');
  assert.equal(presets[0].ready, true);
  assert.equal(presets[0].availability, 'ready');
  assert.equal(presets[0].autoDispatch, true);
  assert.match(presets[0].healthMessage ?? '', /\[redacted-url\]/);
  assert.match(presets[0].healthMessage ?? '', /\[redacted-path\]/);
  assert.equal(containsSecretShapedValue(presets[0].healthMessage), false);

  const symphony = presets.find((p) => p.provider === 'symphony')!;
  assert.equal(symphony.selectable, true);
  assert.equal(symphony.ready, false);
  assert.equal(symphony.availability, 'degraded');
  assert.equal(symphony.statusLabel, 'Degraded');

  const codex = presets.find((p) => p.provider === 'codex')!;
  assert.equal(codex.availability, 'unknown');
  assert.equal(codex.statusLabel, 'Health unknown');

  const ccp = presets.find((p) => p.provider === 'ccp')!;
  assert.equal(ccp.selectable, false);
  assert.equal(ccp.availability, 'refuses_dispatch');
  assert.equal(ccp.autoDispatch, false);
});

test('listSelectableSwarmOperatorPresets excludes stub/refusing engines', () => {
  const selectable = listSelectableSwarmOperatorPresets(buildSwarmOperatorPresets(engines));
  assert.deepEqual(
    selectable.map((p) => p.provider).sort(),
    ['codex', 'eforge', 'symphony'],
  );
});

test('selectDefaultSwarmOperatorPreset prefers ready, then preferred provider', () => {
  const presets = buildSwarmOperatorPresets(engines);
  assert.equal(selectDefaultSwarmOperatorPreset(presets)?.provider, 'eforge');
  assert.equal(selectDefaultSwarmOperatorPreset(presets, 'symphony')?.provider, 'symphony');

  const degradedOnly = buildSwarmOperatorPresets([
    {
      name: 'symphony',
      label: 'Symphony',
      acceptsDispatch: true,
      executionMode: 'pull',
      health: { available: false, message: 'down' },
    },
    {
      name: 'ccp',
      label: 'CCP',
      acceptsDispatch: false,
      executionMode: 'stub',
      health: { available: false },
    },
  ]);
  assert.equal(selectDefaultSwarmOperatorPreset(degradedOnly)?.provider, 'symphony');
  assert.equal(selectDefaultSwarmOperatorPreset([]), null);
});

test('buildSwarmDispatchPayload success path uses contract auto_dispatch', () => {
  const preset = findSwarmOperatorPreset(buildSwarmOperatorPresets(engines), 'eforge')!;
  const payload = buildSwarmDispatchPayload(preset, {
    taskId: 42,
    summary: 'Ship presets',
    spec: 'Implement EEPC-B-03',
  });
  assert.deepEqual(payload, {
    provider: 'eforge',
    auto_dispatch: true,
    task_id: 42,
    summary: 'Ship presets',
    spec: 'Implement EEPC-B-03',
  });
});

test('buildSwarmDispatchPayload refuses stub engines (negative path)', () => {
  const stub = findSwarmOperatorPreset(buildSwarmOperatorPresets(engines), 'ccp')!;
  assert.throws(
    () => buildSwarmDispatchPayload(stub, { spec: 'should fail' }),
    /refuses dispatch/i,
  );
});

test('empty / malformed engine lists degrade to empty presets', () => {
  assert.deepEqual(buildSwarmOperatorPresets(null), []);
  assert.deepEqual(buildSwarmOperatorPresets(undefined), []);
  assert.deepEqual(buildSwarmOperatorPresets([{ label: 'no-name' } as never]), []);
  assert.deepEqual(
    buildSwarmOperatorPresets([
      { name: 'eforge', label: 'A', acceptsDispatch: true },
      { name: 'eforge', label: 'dup', acceptsDispatch: true },
    ]).map((p) => p.provider),
    ['eforge'],
  );
});
