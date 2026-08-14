import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeHandoffHistory } from './taskHandoffHistory.js';

test('handoff history includes incoming records returned by the task API', () => {
  const direct = { id: 'direct', created_at: '2026-08-14T00:00:00Z' };
  const incoming = { id: 'incoming', created_at: '2026-08-14T01:00:00Z' };
  assert.deepEqual(
    mergeHandoffHistory({ handoffs: [direct], incoming: [incoming] } as never).map((row) => row.id),
    ['incoming', 'direct'],
  );
});

test('handoff history deduplicates records present in both arrays', () => {
  const row = { id: 'same', created_at: '2026-08-14T00:00:00Z' };
  const history = mergeHandoffHistory({ handoffs: [row], incoming: [row] } as never);
  assert.equal(history.length, 1);
  assert.equal(history[0]?.id, 'same');
});
