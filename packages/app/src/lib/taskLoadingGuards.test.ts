import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLatestRequestGuard,
  resolveScopedTaskDetailId,
} from './taskLoadingGuards.ts';

test('only the latest Engineering reload may update board state', () => {
  const guard = createLatestRequestGuard();
  const olderRequest = guard.begin();
  const newerRequest = guard.begin();

  assert.equal(guard.isCurrent(olderRequest), false);
  assert.equal(guard.isCurrent(newerRequest), true);

  guard.invalidate();
  assert.equal(guard.isCurrent(newerRequest), false);
});

test('scoped task details close when refreshed tasks no longer contain the selection', () => {
  assert.equal(resolveScopedTaskDetailId([101, 102], 101, true), 101);
  assert.equal(resolveScopedTaskDetailId([102], 101, true), null);
  assert.equal(resolveScopedTaskDetailId([102], 101, false), 101);
  assert.equal(resolveScopedTaskDetailId([102], null, true), null);
});
