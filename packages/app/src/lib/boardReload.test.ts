import assert from 'node:assert/strict';
import test from 'node:test';
import { runBoardReload } from './boardReload.js';
import type { BoardSummary } from './boardsState.js';

function makeBoard(id: number): BoardSummary {
  return {
    id,
    key: null,
    name: `Board ${id}`,
    view: 'board',
    is_default: false,
    sort_order: id,
    filter_config: { scope: 'all' },
  };
}

function deferredBoards() {
  let resolve!: (boards: BoardSummary[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<BoardSummary[]>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Flush the promise microtask queue so .then/.catch/.finally callbacks run.
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test('runBoardReload: delivers results and completion when not cancelled', async () => {
  const { promise, resolve } = deferredBoards();
  const calls: string[] = [];
  const cancel = runBoardReload({
    fetchBoards: () => promise,
    onStart: () => calls.push('start'),
    onResult: (boards) => calls.push(`result:${boards.length}`),
    onError: () => calls.push('error'),
    onComplete: () => calls.push('complete'),
  });

  resolve([makeBoard(1)]);
  await flushMicrotasks();

  assert.deepEqual(calls, ['start', 'result:1', 'complete']);
  cancel(); // harmless after completion
});

test('runBoardReload: cancel before resolve suppresses late state updates (D7)', async () => {
  const { promise, resolve } = deferredBoards();
  const calls: string[] = [];
  const cancel = runBoardReload({
    fetchBoards: () => promise,
    onStart: () => calls.push('start'),
    onResult: () => calls.push('result'),
    onError: () => calls.push('error'),
    onComplete: () => calls.push('complete'),
  });

  // Effect cleanup runs before the fetch resolves (unmount / dep change).
  cancel();
  resolve([makeBoard(1)]);
  await flushMicrotasks();

  // onStart already fired synchronously, but the late result/completion MUST NOT
  // update state — this is the race D7 fixes.
  assert.deepEqual(calls, ['start']);
});

test('runBoardReload: cancel before reject suppresses late error', async () => {
  const { promise, reject } = deferredBoards();
  const calls: string[] = [];
  const cancel = runBoardReload({
    fetchBoards: () => promise,
    onStart: () => calls.push('start'),
    onResult: () => calls.push('result'),
    onError: (message) => calls.push(`error:${message}`),
    onComplete: () => calls.push('complete'),
  });

  cancel();
  reject(new Error('network down'));
  await flushMicrotasks();

  assert.deepEqual(calls, ['start']);
});

test('runBoardReload: returns a cancel function', () => {
  const cancel = runBoardReload({
    fetchBoards: () => Promise.resolve([]),
    onResult: () => undefined,
    onError: () => undefined,
  });
  assert.equal(typeof cancel, 'function');
});
