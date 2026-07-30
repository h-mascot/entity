import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOpenWorkplaneHref,
  buildTaskDetailReturnContext,
  navigateToWorkplane,
} from './openWorkplaneFromTaskDetail.ts';
import { parseWorkplaneUrlState } from './workplaneUrlState.ts';

test('buildTaskDetailReturnContext defaults to detail surface for task id', () => {
  assert.deepEqual(buildTaskDetailReturnContext(42), {
    surface: 'detail',
    taskId: 42,
    path: '/task/42',
  });
});

test('buildTaskDetailReturnContext uses current /task/:id pathname', () => {
  assert.deepEqual(
    buildTaskDetailReturnContext(7, { currentPathname: '/task/7' }),
    {
      surface: 'detail',
      taskId: 7,
      path: '/task/7',
    },
  );
});

test('buildTaskDetailReturnContext maps /tasks to tasks/board surfaces', () => {
  assert.deepEqual(buildTaskDetailReturnContext(3, { currentPathname: '/tasks' }), {
    surface: 'tasks',
    taskId: 3,
    path: '/tasks',
  });
  assert.deepEqual(
    buildTaskDetailReturnContext(3, {
      currentPathname: '/tasks',
      returnBoard: 'entity-engineering',
    }),
    {
      surface: 'board',
      taskId: 3,
      path: '/tasks',
      board: 'entity-engineering',
    },
  );
});

test('buildOpenWorkplaneHref serializes return context for task detail', () => {
  const href = buildOpenWorkplaneHref({
    taskId: 12,
    currentPathname: '/task/12',
  });
  assert.equal(
    href,
    '/workplane/12?return=detail&returnTask=12&returnPath=%2Ftask%2F12',
  );

  const parsed = parseWorkplaneUrlState('/workplane/12', href.split('?')[1] ?? '');
  assert.equal(parsed?.taskId, 12);
  assert.equal(parsed?.returnContext?.surface, 'detail');
  assert.equal(parsed?.returnContext?.taskId, 12);
  assert.equal(parsed?.returnContext?.path, '/task/12');
});

test('buildOpenWorkplaneHref carries optional panel and proof', () => {
  const href = buildOpenWorkplaneHref({
    taskId: 9,
    currentPathname: '/task/9',
    activePanel: 'proof_bundle',
    selectedProof: 'receipt:demo',
  });
  const url = new URL(href, 'https://entity.local');
  assert.equal(url.pathname, '/workplane/9');
  assert.equal(url.searchParams.get('panel'), 'proof_bundle');
  assert.equal(url.searchParams.get('proof'), 'receipt:demo');
  assert.equal(url.searchParams.get('return'), 'detail');
  assert.equal(url.searchParams.get('returnTask'), '9');
});

test('buildOpenWorkplaneHref rejects invalid task ids', () => {
  assert.throws(() => buildOpenWorkplaneHref({ taskId: 0 }), /positive integer/);
  assert.throws(() => buildOpenWorkplaneHref({ taskId: -1 }), /positive integer/);
  assert.throws(() => buildTaskDetailReturnContext(1.5), /positive integer/);
});

test('navigateToWorkplane uses injected navigate when provided', () => {
  const calls: Array<{ href: string; replace?: boolean }> = [];
  navigateToWorkplane('/workplane/1?return=detail&returnTask=1&returnPath=%2Ftask%2F1', (href, options) => {
    calls.push({ href, replace: options?.replace });
  });
  assert.deepEqual(calls, [
    {
      href: '/workplane/1?return=detail&returnTask=1&returnPath=%2Ftask%2F1',
      replace: false,
    },
  ]);
});
