import test from 'node:test';
import assert from 'node:assert/strict';

import {
  containsSecretShapedValue,
  normalizeExecutionEngineListItem,
  projectExecutionEngineHealthForUi,
  redactExecutionEngineMessage,
} from './executionEnginePublicHealth.ts';

test('redactExecutionEngineMessage strips urls, paths, and bearer tokens', () => {
  const out = redactExecutionEngineMessage(
    'up http://127.0.0.1:9/secret path=/Users/enterprise/secret Bearer abcdefghijklmnopqrstuvwxyz01234567',
  );
  assert.ok(out);
  assert.match(out!, /\[redacted-url\]/);
  assert.match(out!, /\[redacted-path\]/);
  assert.match(out!, /Bearer \[redacted\]/i);
  assert.equal(containsSecretShapedValue(out), false);
});

test('redactExecutionEngineMessage refuses wholesale secret-shaped messages', () => {
  assert.equal(
    redactExecutionEngineMessage('Bearer abcdefghijklmnopqrstuvwxyz01234567'),
    '[redacted]',
  );
  assert.equal(
    redactExecutionEngineMessage('probe sk-abcdefghijklmnopqrstuv present'),
    '[redacted]',
  );
});

test('projectExecutionEngineHealthForUi keeps available and redacts message', () => {
  const projected = projectExecutionEngineHealthForUi({
    available: true,
    latencyMs: 12,
    message: 'ACP reachable at http://localhost:8100 under /tmp/leaky',
  });
  assert.equal(projected.available, true);
  assert.equal(projected.latencyMs, 12);
  assert.match(projected.message ?? '', /\[redacted-url\]/);
  assert.match(projected.message ?? '', /\[redacted-path\]/);
  assert.equal(containsSecretShapedValue(projected), false);
});

test('normalizeExecutionEngineListItem flattens meta and never leaves secret-shaped health', () => {
  const item = normalizeExecutionEngineListItem({
    name: 'acp',
    label: 'Geordi',
    meta: {
      category: 'orchestration',
      description: 'Geordi ACP execution arm',
      capabilities: ['dispatch', 'status'],
      acceptsDispatch: true,
      executionMode: 'push',
    },
    health: {
      available: false,
      message: 'missing config at /Users/enterprise/.secrets',
    },
  });

  assert.equal(item.kind, 'execution-engine');
  assert.equal(item.category, 'orchestration');
  assert.equal(item.description, 'Geordi ACP execution arm');
  assert.equal(item.acceptsDispatch, true);
  assert.equal(item.executionMode, 'push');
  assert.deepEqual(item.capabilities, ['dispatch', 'status']);
  assert.equal(item.health.available, false);
  assert.match(item.health.message ?? '', /\[redacted-path\]/);
  assert.equal(containsSecretShapedValue(item.health), false);
});

test('missing health degrades visibly instead of inventing healthy', () => {
  const item = normalizeExecutionEngineListItem({
    name: 'codex',
    label: 'Codex',
  });
  assert.equal(item.health.available, false);
  assert.equal(item.health.message, 'Health unknown');
});
