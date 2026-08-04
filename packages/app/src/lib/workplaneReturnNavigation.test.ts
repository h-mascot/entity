import assert from 'node:assert/strict';
import test from 'node:test';
import {
  coerceReturnPathToAppHref,
  mapReturnBoardToMcTab,
  navigateWorkplaneReturn,
  resolveWorkplaneReturnDestination,
  shouldPreferHistoryBack,
} from './workplaneReturnNavigation.ts';

test('mapReturnBoardToMcTab maps project keys and built-in tabs', () => {
  assert.equal(mapReturnBoardToMcTab('entity-engineering'), 'engineering');
  assert.equal(mapReturnBoardToMcTab('engineering'), 'engineering');
  assert.equal(mapReturnBoardToMcTab('ops'), 'kanban');
  assert.equal(mapReturnBoardToMcTab('kanban'), 'kanban');
  assert.equal(mapReturnBoardToMcTab('strategic'), 'strategic');
  assert.equal(mapReturnBoardToMcTab(null), null);
  assert.equal(mapReturnBoardToMcTab(''), null);
});

test('coerceReturnPathToAppHref maps /tasks to tasks workspace route', () => {
  assert.equal(coerceReturnPathToAppHref('/tasks', 'board'), '/?tab=tasks');
  assert.equal(coerceReturnPathToAppHref('/tasks/', 'tasks'), '/?tab=tasks');
  assert.equal(coerceReturnPathToAppHref('/task/42', 'detail'), '/task/42');
  assert.equal(coerceReturnPathToAppHref(null, 'detail', 9), '/task/9');
  assert.equal(coerceReturnPathToAppHref(null, 'board'), '/?tab=tasks');
});

test('resolveWorkplaneReturnDestination preserves detail return', () => {
  const dest = resolveWorkplaneReturnDestination({
    surface: 'detail',
    taskId: 22,
    path: '/task/22',
    board: 'engineering',
  });
  assert.equal(dest.href, '/task/22');
  assert.equal(dest.surface, 'detail');
  assert.equal(dest.boardTab, 'engineering');
  assert.match(dest.label, /task detail/i);
  assert.equal(dest.historyState.mode, 'task');
  assert.equal(dest.historyState.taskId, 22);
  assert.equal(dest.historyState.board, 'engineering');
  assert.equal(dest.historyState.fromWorkplaneReturn, true);
});

test('resolveWorkplaneReturnDestination preserves board/list return', () => {
  const board = resolveWorkplaneReturnDestination({
    surface: 'board',
    taskId: 3,
    path: '/tasks',
    board: 'entity-engineering',
  });
  assert.equal(board.href, '/?tab=tasks');
  assert.equal(board.surface, 'board');
  assert.equal(board.boardTab, 'engineering');
  assert.equal(board.historyState.mode, 'tasks');
  assert.equal(board.historyState.board, 'engineering');

  const tasks = resolveWorkplaneReturnDestination({
    surface: 'tasks',
    path: '/tasks',
  });
  assert.equal(tasks.href, '/?tab=tasks');
  assert.equal(tasks.surface, 'tasks');
  assert.match(tasks.label, /task list/i);
});

test('resolveWorkplaneReturnDestination fallbacks never strand (null context)', () => {
  const withTask = resolveWorkplaneReturnDestination(null, { taskId: 12 });
  assert.equal(withTask.href, '/task/12');
  assert.equal(withTask.surface, 'fallback');
  assert.match(withTask.label, /task detail/i);

  const noTask = resolveWorkplaneReturnDestination(null);
  assert.equal(noTask.href, '/?tab=tasks');
  assert.equal(noTask.surface, 'fallback');
});

test('shouldPreferHistoryBack only when workplane pushState entry exists', () => {
  assert.equal(
    shouldPreferHistoryBack({
      destinationHref: '/task/22',
      historyLength: 3,
      historyState: { mode: 'workplane', returnHref: '/task/22' },
    }),
    true,
  );
  assert.equal(
    shouldPreferHistoryBack({
      destinationHref: '/?tab=tasks',
      historyLength: 2,
      historyState: { mode: 'workplane', returnHref: '/tasks' },
    }),
    true,
  );
  assert.equal(
    shouldPreferHistoryBack({
      destinationHref: '/task/22',
      historyLength: 1,
      historyState: { mode: 'workplane', returnHref: '/task/22' },
    }),
    false,
  );
  assert.equal(
    shouldPreferHistoryBack({
      destinationHref: '/task/22',
      historyLength: 3,
      historyState: { mode: 'task', taskId: 22 },
    }),
    false,
  );
});

test('navigateWorkplaneReturn uses injected navigate for explicit return', () => {
  const calls: Array<{ href: string; replace?: boolean; state?: unknown }> = [];
  const result = navigateWorkplaneReturn({
    returnContext: {
      surface: 'detail',
      taskId: 22,
      path: '/task/22',
    },
    taskId: 22,
    preferHistoryBack: false,
    navigate: (href, options) => {
      calls.push({ href, replace: options?.replace, state: options?.state });
    },
  });

  assert.equal(result.method, 'navigate');
  assert.equal(result.href, '/task/22');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.href, '/task/22');
  assert.equal(calls[0]?.replace, false);
  assert.deepEqual(calls[0]?.state, {
    mode: 'task',
    taskId: 22,
    fromWorkplaneReturn: true,
  });
});

test('navigateWorkplaneReturn board path restores board tab in history state', () => {
  const calls: Array<{ href: string; state?: unknown }> = [];
  const result = navigateWorkplaneReturn({
    returnContext: {
      surface: 'board',
      taskId: 5,
      path: '/tasks',
      board: 'engineering',
    },
    preferHistoryBack: false,
    navigate: (href, options) => {
      calls.push({ href, state: options?.state });
    },
  });

  assert.equal(result.method, 'navigate');
  assert.equal(result.href, '/?tab=tasks');
  assert.deepEqual(calls[0]?.state, {
    mode: 'tasks',
    board: 'engineering',
    fromWorkplaneReturn: true,
  });
});
