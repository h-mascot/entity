import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_IDENTITY_CAPABILITY_CARD_FIELDS,
  buildAgentIdentityCapabilityCard,
  completenessLabel,
  normalizePresenceStatus,
  presenceToneClass,
} from './agentIdentityCapabilityCard.ts';

test('schema exposes Q57 identity/capability/presence field keys', () => {
  for (const key of [
    'agentName',
    'permissionLabels',
    'runtimeLabel',
    'modelLabel',
    'capabilityLabels',
    'presenceStatus',
    'heartbeatFreshnessLabel',
    'currentTaskId',
    'currentWorkplaneId',
  ]) {
    assert.ok(AGENT_IDENTITY_CAPABILITY_CARD_FIELDS.includes(key as never), key);
  }
});

test('invite-backed card keeps presence missing (not silently healthy)', () => {
  const card = buildAgentIdentityCapabilityCard({
    invite: {
      id: 'inv-1',
      agentName: 'Scout',
      role: 'worker',
      status: 'created',
      selectedModules: ['entity-mc'],
      permissionsScope: ['workspace_read'],
      taskId: 22,
      workplaneId: 'wp-a',
    },
  });

  assert.equal(card.presenceStatus, 'missing');
  assert.equal(card.heartbeatFreshnessLabel, 'No heartbeat yet');
  assert.equal(card.currentWorkLabel, 'Task 22 · Workplane wp-a');
  assert.equal(card.cardCompleteness, 'partial');
  assert.ok(card.degradedReasons.includes('presence_missing'));
  assert.ok(card.degradedReasons.includes('runtime_unbound'));
  assert.ok(!card.degradedReasons.includes('current_work_unattached'));
});

test('unknown presence and empty source are explicit degraded paths', () => {
  assert.equal(normalizePresenceStatus(null), 'missing');
  assert.equal(normalizePresenceStatus('nope'), 'unknown');

  const empty = buildAgentIdentityCapabilityCard({});
  assert.equal(empty.cardCompleteness, 'degraded');
  assert.equal(empty.currentWorkLabel, 'No current work attached');
  assert.ok(empty.degradedReasons.includes('card_source_missing'));

  const unknown = buildAgentIdentityCapabilityCard({
    invite: { id: 'i', agentName: 'A', role: 'worker', status: 'opened' },
    presence: { status: 'weird', lastSeenAt: 'not-a-date' },
  });
  assert.equal(unknown.presenceStatus, 'unknown');
  assert.ok(unknown.degradedReasons.includes('presence_unknown'));
});

test('UI helpers map completeness and presence tone', () => {
  assert.equal(completenessLabel('partial'), 'Partial');
  assert.equal(completenessLabel('degraded'), 'Degraded');
  assert.match(presenceToneClass('live'), /success/);
  assert.match(presenceToneClass('missing'), /text-secondary/);
});
