import assert from 'node:assert/strict';
import test from 'node:test';
import { refreshServiceRegistryUntilSettled } from './entityServicesRefresh.js';

test('manual refresh polls without forcing again until discovery settles', async () => {
  const calls: string[] = [];
  const responses = [
    { state: 'refreshing' as const },
    { state: 'refreshing' as const },
    { state: 'ready' as const },
  ];

  const result = await refreshServiceRegistryUntilSettled({
    request: async (forceRefresh) => {
      calls.push(forceRefresh ? 'force' : 'poll');
      return responses.shift() ?? { state: 'ready' as const };
    },
    wait: async () => undefined,
  });

  assert.equal(result.state, 'ready');
  assert.deepEqual(calls, ['force', 'poll', 'poll']);
});
