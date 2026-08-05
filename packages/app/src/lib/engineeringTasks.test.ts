import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEngineeringTaskCandidates,
  ENGINEERING_DEFAULT_FILTER,
  filterEngineeringTaskPayload,
  isEngineeringViewportMatch,
  loadEngineeringTasks,
  resolveEngineeringBoardFilter,
  resolveEngineeringHighlightTaskId,
  toEngineeringLoadError,
} from './engineeringTasks.ts';
import { selectTasksForBoard } from './boardTaskFilter.ts';

test('builds the canonical task-list query (membership source for the Engineering board)', () => {
  assert.deepEqual(buildEngineeringTaskCandidates('https://entity.test/'), [
    'https://entity.test/api/tasks',
    'https://entity.test/tasks',
  ]);
});

test('normalizes the canonical task payload for Engineering board membership', () => {
  const tasks = filterEngineeringTaskPayload({
    tasks: [
      {
        id: 101,
        name: 'Ship Engineering board',
        column: 'doing',
            due_date: '2026-08-15',
        work_domain: 'engineering',
        work_domain_state: 'resolved',
      },
      {
        id: 102,
        name: 'Customer renewal',
        column: 'todo',
        work_domain: 'general',
        work_domain_state: 'resolved',
      },
      {
        id: 103,
        name: 'Unclassified coding task',
        column: 'todo',
        work_domain: null,
        work_domain_state: 'unclassified_project',
      },
      {
        id: 104,
        name: 'Engineering import task',
        column: 'todo',
        work_domain: 'engineering',
        work_domain_state: 'invalid_primary_project',
      },
      {
        id: 'not-an-id',
        name: 'Malformed task',
        work_domain: 'engineering',
        work_domain_state: 'resolved',
      },
    ],
  });

  // D10 (BRD-002/003): membership is the canonical task list, so valid tasks of
  // every work domain are retained; only malformed rows (bad id) are dropped.
  assert.deepEqual(tasks.map((task) => task.id), [101, 102, 103, 104]);
  assert.equal(tasks[0]?.name, 'Ship Engineering board');
  assert.equal(tasks[0]?.due_at, '2026-08-15');
  assert.equal(tasks[0]?.work_domain, 'engineering');
  assert.equal(tasks[0]?.work_domain_state, 'resolved');
  assert.equal(tasks[1]?.work_domain, 'general');
  assert.equal(tasks[2]?.work_domain, null);
});

test('loads the canonical task list (membership source) across pages', async () => {
  const requestedUrls: string[][] = [];
  const pages = [
    {
      tasks: [
        {
          id: 201,
          name: 'First Engineering task',
          work_domain: 'engineering',
          work_domain_state: 'resolved',
        },
      ],
      count: 1,
      hasMore: true,
    },
    {
      tasks: [
        {
          id: 202,
          name: 'Second Engineering task',
          work_domain: 'engineering',
          work_domain_state: 'resolved',
        },
        {
          id: 203,
          name: 'Business task',
          work_domain: 'general',
          work_domain_state: 'resolved',
        },
      ],
      count: 2,
      hasMore: false,
    },
  ];

  const tasks = await loadEngineeringTasks({
    apiBase: 'https://entity.test',
    request: async ({ urls }) => {
      requestedUrls.push(urls);
      return pages[requestedUrls.length - 1];
    },
  });

  // D10 (BRD-002/003): the membership source is the canonical /tasks list, so
  // engineering and non-engineering tasks are both retained for local filtering.
  assert.deepEqual(tasks.map((task) => task.id), [201, 202, 203]);
  assert.deepEqual(requestedUrls, [
    [
      'https://entity.test/api/tasks?limit=2000&offset=0',
      'https://entity.test/tasks?limit=2000&offset=0',
    ],
    [
      'https://entity.test/api/tasks?limit=2000&offset=1',
      'https://entity.test/tasks?limit=2000&offset=1',
    ],
  ]);
});

test('surfaces a specific degraded Engineering-board error', () => {
  assert.equal(
    toEngineeringLoadError(new Error('Service unavailable')),
    'Engineering board could not load: Service unavailable',
  );
  assert.equal(
    toEngineeringLoadError(null),
    'Engineering board could not load: Task request failed.',
  );
});

test('only the active responsive board instance owns Engineering loading', () => {
  assert.equal(isEngineeringViewportMatch('desktop', 1_024), true);
  assert.equal(isEngineeringViewportMatch('desktop', 1_023), false);
  assert.equal(isEngineeringViewportMatch('tablet', 1_023), true);
  assert.equal(isEngineeringViewportMatch('tablet', 767), false);
  assert.equal(isEngineeringViewportMatch('mobile', 767), true);
  assert.equal(isEngineeringViewportMatch('mobile', 768), false);
});

// D10 (BRD-002/003): Engineering board membership must operate over the canonical
// task list so a customized Engineering board with scope=all can display a
// non-engineering task. The persisted board filter controls contents locally.
test('D10: a customized Engineering board with scope=all displays a non-engineering task', async () => {
  const tasks = await loadEngineeringTasks({
    apiBase: 'https://entity.test',
    request: async () => ({
      tasks: [
        {
          id: 501,
          name: 'Ship Engineering board',
          column: 'doing',
          work_domain: 'engineering',
          work_domain_state: 'resolved',
        },
        {
          id: 502,
          name: 'Sales renewal',
          column: 'todo',
          work_domain: 'sales',
          work_domain_state: 'resolved',
        },
      ],
      count: 2,
      hasMore: false,
    }),
  });

  // A customized Engineering board persisted filter with scope=all must control
  // board contents, so the non-engineering task is selectable.
  const visible = selectTasksForBoard(tasks, { filter_config: { scope: 'all' } });

  assert.deepEqual(
    visible.map((task) => task.id).sort((a, b) => a - b),
    [501, 502],
  );
  assert.ok(
    visible.some((task) => task.work_domain !== 'engineering'),
    'a customized scope=all Engineering board must be able to show a non-engineering task',
  );
});

test('D10: default Engineering template filter selects engineering work-domain tasks only', async () => {
  const tasks = await loadEngineeringTasks({
    apiBase: 'https://entity.test',
    request: async () => ({
      tasks: [
        {
          id: 601,
          name: 'Engineering task',
          work_domain: 'engineering',
          work_domain_state: 'resolved',
        },
        {
          id: 602,
          name: 'Sales task',
          work_domain: 'sales',
          work_domain_state: 'resolved',
        },
        {
          id: 603,
          name: 'Engineering import',
          work_domain: 'engineering',
          work_domain_state: 'unclassified_project',
        },
      ],
      count: 3,
      hasMore: false,
    }),
  });

  // No custom filter supplied -> the Engineering template's work-domain default
  // is applied locally, preserving the default Engineering board behavior.
  const visible = selectTasksForBoard(tasks, {
    filter_config: resolveEngineeringBoardFilter(undefined),
  });

  assert.deepEqual(visible.map((task) => task.id).sort((a, b) => a - b), [601, 603]);
  assert.ok(visible.every((task) => task.work_domain === 'engineering'));
});

test('D10: resolveEngineeringBoardFilter prefers a supplied custom filter', () => {
  const custom: { scope: 'all' } = { scope: 'all' };
  assert.equal(resolveEngineeringBoardFilter(custom), custom);
  assert.equal(resolveEngineeringBoardFilter(null), ENGINEERING_DEFAULT_FILTER);
  assert.equal(resolveEngineeringBoardFilter(undefined), ENGINEERING_DEFAULT_FILTER);
  assert.deepEqual(ENGINEERING_DEFAULT_FILTER, {
    scope: 'workDomain',
    workDomain: 'engineering',
  });
});

test('never opens a task detail that is absent from the filtered Engineering set', () => {
  const engineeringTasks = filterEngineeringTaskPayload({
    tasks: [
      {
        id: 301,
        name: 'Engineering task',
        work_domain: 'engineering',
        work_domain_state: 'resolved',
      },
    ],
  });

  assert.equal(resolveEngineeringHighlightTaskId(engineeringTasks, 301), 301);
  assert.equal(resolveEngineeringHighlightTaskId(engineeringTasks, 999), null);
  assert.equal(resolveEngineeringHighlightTaskId(engineeringTasks, null), null);
});
