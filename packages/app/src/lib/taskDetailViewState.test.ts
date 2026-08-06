import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveTaskDetailViewState } from './taskDetailViewState.ts';

test('returns loading while loading is true, even with stale task/form present', () => {
  assert.equal(
    resolveTaskDetailViewState({ loading: true, hasTask: true, hasForm: true, notFound: false }),
    'loading',
  );
  assert.equal(
    resolveTaskDetailViewState({ loading: true, hasTask: false, hasForm: false, notFound: false }),
    'loading',
  );
});

test('returns ready only after loading resolves with both task and form', () => {
  assert.equal(
    resolveTaskDetailViewState({ loading: false, hasTask: true, hasForm: true, notFound: false }),
    'ready',
  );
});

test('returns not-found only for a confirmed 404 once loading resolves', () => {
  assert.equal(
    resolveTaskDetailViewState({ loading: false, hasTask: false, hasForm: false, notFound: true }),
    'not-found',
  );
  // A stale 404 flag must not leak while still loading.
  assert.equal(
    resolveTaskDetailViewState({ loading: true, hasTask: false, hasForm: false, notFound: true }),
    'loading',
  );
});

test('returns error for non-404 failures (network / 5xx / invalid response)', () => {
  assert.equal(
    resolveTaskDetailViewState({ loading: false, hasTask: false, hasForm: false, notFound: false }),
    'error',
  );
  // Partial data after a resolved failure is still not ready.
  assert.equal(
    resolveTaskDetailViewState({ loading: false, hasTask: true, hasForm: false, notFound: false }),
    'error',
  );
  assert.equal(
    resolveTaskDetailViewState({ loading: false, hasTask: false, hasForm: true, notFound: false }),
    'error',
  );
});

test('never briefly declares not-found or error while loading (cold deep-link guard)', () => {
  // Simulate the cold deep-link sequence: in-flight then resolved-missing (404).
  const inflight = resolveTaskDetailViewState({ loading: true, hasTask: false, hasForm: false, notFound: false });
  const resolved404 = resolveTaskDetailViewState({ loading: false, hasTask: false, hasForm: false, notFound: true });
  assert.equal(inflight, 'loading');
  assert.equal(resolved404, 'not-found');

  // A generic network failure resolves to error, not not-found.
  const resolvedNetwork = resolveTaskDetailViewState({ loading: false, hasTask: false, hasForm: false, notFound: false });
  assert.equal(resolvedNetwork, 'error');
});
