import assert from 'node:assert/strict';
import test from 'node:test';
import { loadInitialChatSnapshot } from './chat-store.js';

test('chat initialization falls back to the existing snapshot when optional setup fails', async () => {
  const expected = { categories: [], channels: [{ id: 'general' }] } as never;
  const result = await loadInitialChatSnapshot(
    async () => { throw new Error('setup upstream returned 502'); },
    async () => expected,
  );
  assert.equal(result, expected);
});

test('chat initialization still fails when setup and snapshot both fail', async () => {
  await assert.rejects(
    loadInitialChatSnapshot(
      async () => { throw new Error('setup failed'); },
      async () => { throw new Error('snapshot failed'); },
    ),
    /snapshot failed/,
  );
});
