import assert from 'node:assert/strict';
import test from 'node:test';
import {
  taskMatchesBoardFilter,
  selectTasksForBoard,
  type BoardFilterableTask,
} from './boardTaskFilter.js';
import type { BoardSummary } from './boardsState.js';

function board(
  filter: BoardSummary['filter_config'],
  view: BoardSummary['view'] = 'board',
): BoardSummary {
  return {
    id: 1,
    key: null,
    name: 'B',
    view,
    is_default: false,
    sort_order: 0,
    filter_config: filter,
  };
}

function task(
  id: number,
  opts: { projectIds?: number[]; workDomain?: string | null } = {},
): BoardFilterableTask {
  return {
    id,
    projects: (opts.projectIds ?? []).map((pid) => ({ id: pid, name: `p${pid}` })),
    work_domain: opts.workDomain ?? null,
  };
}

const tasks: BoardFilterableTask[] = [
  task(1, { projectIds: [5], workDomain: 'engineering' }),
  task(2, { projectIds: [6], workDomain: 'data' }),
  task(3, { workDomain: 'Engineering' }), // case-insensitive match, no projects
  task(4, { projectIds: [5, 7] }),
  task(5), // no projects, no work domain
];

test('scope all returns every task (General default keeps all existing tasks visible)', () => {
  assert.equal(selectTasksForBoard(tasks, board({ scope: 'all' })).length, tasks.length);
});

test('scope none returns an empty list', () => {
  assert.deepEqual(selectTasksForBoard(tasks, board({ scope: 'none' })), []);
});

test('scope projects matches tasks sharing any requested project id', () => {
  const result = selectTasksForBoard(tasks, board({ scope: 'projects', projectIds: [5, 7] }));
  assert.deepEqual(
    result.map((t) => t.id),
    [1, 4],
  );
});

test('scope workDomain matches tasks whose work domain equals the filter, case-insensitive', () => {
  const engineering = board({ scope: 'workDomain', workDomain: 'engineering' });
  assert.deepEqual(
    selectTasksForBoard(tasks, engineering).map((t) => t.id),
    [1, 3],
  );
});

test('engineering-template board (workDomain engineering) surfaces engineering tasks only', () => {
  const engineeringBoard: BoardSummary = {
    id: 9,
    key: null,
    name: 'Platform Eng',
    view: 'engineering',
    is_default: false,
    sort_order: 0,
    filter_config: { scope: 'workDomain', workDomain: 'engineering' },
  };
  assert.deepEqual(
    selectTasksForBoard(tasks, engineeringBoard).map((t) => t.id),
    [1, 3],
  );
});

test('scope workDomain with null target matches nothing', () => {
  assert.deepEqual(
    selectTasksForBoard(tasks, board({ scope: 'workDomain', workDomain: null })).map((t) => t.id),
    [],
  );
});

test('taskMatchesBoardFilter is reusable and never mutates input', () => {
  const original = tasks.map((t) => ({ ...t, projects: [...(t.projects ?? [])] }));
  assert.equal(taskMatchesBoardFilter(tasks[1], { scope: 'projects', projectIds: [6] }), true);
  assert.equal(taskMatchesBoardFilter(tasks[0], { scope: 'projects', projectIds: [6] }), false);
  // input array and rows unchanged
  assert.deepEqual(tasks, original);
});

test('selectTasksForBoard returns a fresh array (no mutation)', () => {
  const before = tasks.slice();
  const out = selectTasksForBoard(tasks, board({ scope: 'all' }));
  assert.notEqual(out, tasks);
  assert.deepEqual(tasks, before);
});
