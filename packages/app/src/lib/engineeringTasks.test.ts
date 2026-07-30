import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEngineeringTaskCandidates,
  filterEngineeringTaskPayload,
  isEngineeringViewportMatch,
  loadEngineeringTasks,
  resolveEngineeringHighlightTaskId,
  toEngineeringLoadError,
} from './engineeringTasks.ts';

test('builds only the exact Engineering work-domain task query', () => {
  assert.deepEqual(buildEngineeringTaskCandidates('https://entity.test/'), [
    'https://entity.test/api/tasks?work_domain=engineering',
    'https://entity.test/tasks?work_domain=engineering',
  ]);
});

test('normalizes Engineering tasks and fails closed for other or unresolved domains', () => {
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
        name: 'Malformed domain claim',
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

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.id, 101);
  assert.equal(tasks[0]?.name, 'Ship Engineering board');
  assert.equal(tasks[0]?.due_at, '2026-08-15');
  assert.equal(tasks[0]?.work_domain, 'engineering');
  assert.equal(tasks[0]?.work_domain_state, 'resolved');
});

test('loads every Engineering page without broadening the domain query', async () => {
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
          name: 'Leaked business task',
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

  assert.deepEqual(tasks.map((task) => task.id), [201, 202]);
  assert.deepEqual(requestedUrls, [
    [
      'https://entity.test/api/tasks?work_domain=engineering&limit=2000&offset=0',
      'https://entity.test/tasks?work_domain=engineering&limit=2000&offset=0',
    ],
    [
      'https://entity.test/api/tasks?work_domain=engineering&limit=2000&offset=1',
      'https://entity.test/tasks?work_domain=engineering&limit=2000&offset=1',
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
