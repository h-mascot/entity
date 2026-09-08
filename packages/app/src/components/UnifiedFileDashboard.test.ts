import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUnifiedFileSearchIdentity, isUnifiedFileSearchCurrent } from '../lib/unifiedFileSearch.ts';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

test('search identity changes when organization or filters change', () => {
  const base = {
    query: 'guide',
    sourceId: 'all',
    type: 'all',
    origin: 'all',
    agent: 'all',
    refreshNonce: 0,
  };

  assert.notEqual(
    buildUnifiedFileSearchIdentity({ ...base, orgId: 'org-a' }),
    buildUnifiedFileSearchIdentity({ ...base, orgId: 'org-b' }),
  );
  assert.notEqual(
    buildUnifiedFileSearchIdentity({ ...base, orgId: 'org-a', type: 'blog' }),
    buildUnifiedFileSearchIdentity({ ...base, orgId: 'org-a', type: 'prd' }),
  );
});

test('late organization A search cannot overwrite current organization B results', async () => {
  const base = {
    query: 'guide',
    sourceId: 'all',
    type: 'all',
    origin: 'all',
    agent: 'all',
    refreshNonce: 0,
  };
  const identityA = buildUnifiedFileSearchIdentity({ ...base, orgId: 'org-a' });
  const identityB = buildUnifiedFileSearchIdentity({ ...base, orgId: 'org-b' });
  const first = deferred<string>();
  const second = deferred<string>();
  let currentRequestId = 1;
  let currentIdentity = identityA;
  const accepted: string[] = [];

  const applyResult = async (requestId: number, identity: string, result: Promise<string>) => {
    const value = await result;
    if (isUnifiedFileSearchCurrent(requestId, currentRequestId, identity, currentIdentity)) {
      accepted.push(value);
    }
  };

  const firstPending = applyResult(1, identityA, first.promise);
  currentRequestId = 2;
  currentIdentity = identityB;
  const secondPending = applyResult(2, identityB, second.promise);

  // B completes first and must remain the only visible result even when A
  // resolves afterward.
  second.resolve('org-b-result');
  first.resolve('org-a-result');
  await Promise.all([firstPending, secondPending]);

  assert.deepEqual(accepted, ['org-b-result']);
  assert.equal(isUnifiedFileSearchCurrent(1, currentRequestId, identityA, currentIdentity), false);
});
