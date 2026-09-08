import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_TASK_PRIORITY,
  TASK_PRIORITY_DEFINITIONS,
  TASK_PRIORITY_WIKI_HREF,
  buildTaskPriorityWikiHref,
  resolveTaskPriorityOrgId,
  taskPriorityDefinition,
} from './taskPriorityPolicy.ts';
import { resolveRelativeDocHubNavigation } from '../../../lib/docHubRoute.ts';

test('priority definitions cover P0-P3 exactly once each with P2 as the sole default', () => {
  assert.deepEqual(
    TASK_PRIORITY_DEFINITIONS.map((definition) => definition.value),
    ['P0', 'P1', 'P2', 'P3'],
  );
  assert.equal(DEFAULT_TASK_PRIORITY, 'P2');
  const defaults = TASK_PRIORITY_DEFINITIONS.filter((definition) => definition.isDefault);
  assert.equal(defaults.length, 1);
  assert.equal(defaults[0].value, 'P2');
});

test('every priority definition carries a name, explanation, and example', () => {
  for (const definition of TASK_PRIORITY_DEFINITIONS) {
    assert.ok(definition.label.startsWith(definition.value), `label must start with ${definition.value}`);
    assert.ok(definition.shortExplanation.length >= 20, `${definition.value} explanation is too short`);
    assert.ok(definition.example.trim().length >= 10, `${definition.value} example is missing`);
  }
});

test('taskPriorityDefinition returns the definition for a known value', () => {
  assert.equal(taskPriorityDefinition('P0').value, 'P0');
  assert.equal(taskPriorityDefinition('P3').label.includes('P3'), true);
});

test('taskPriorityDefinition falls back to the default definition for unknown values', () => {
  const fallback = taskPriorityDefinition('P9' as never);
  assert.equal(fallback.value, DEFAULT_TASK_PRIORITY);
  assert.equal(fallback.isDefault, true);
});

test('priority wiki href targets the Entity Wiki page and task-priorities anchor', () => {
  assert.equal(
    TASK_PRIORITY_WIKI_HREF,
    '/docs/source/entity-wiki/features/mission-control-and-tasks.html#task-priorities',
  );
  const parsed = new URL(TASK_PRIORITY_WIKI_HREF, 'https://entity.invalid');
  assert.equal(parsed.pathname.startsWith('/docs/source/entity-wiki/'), true);
  assert.equal(parsed.hash, '#task-priorities');
});

test('priority wiki href resolves from the Tasks surface to a canonical Doc Hub route', () => {
  assert.deepEqual(
    resolveRelativeDocHubNavigation(
      '/',
      '?tab=tasks',
      TASK_PRIORITY_WIKI_HREF,
      true,
      'https://entity.example',
    ),
    {
      target: {
        sourceId: 'entity-wiki',
        path: 'features/mission-control-and-tasks.html',
      },
      route: '/docs/source/entity-wiki/features/mission-control-and-tasks.html#task-priorities',
    },
  );
});

test('priority wiki href scopes org before the task-priorities anchor', () => {
  assert.equal(
    buildTaskPriorityWikiHref(' org/beta '),
    '/docs/source/entity-wiki/features/mission-control-and-tasks.html?org=org%2Fbeta#task-priorities',
  );
  const parsed = new URL(buildTaskPriorityWikiHref('org&beta')!, 'https://entity.invalid');
  assert.equal(parsed.searchParams.get('org'), 'org&beta');
  assert.equal(parsed.hash, '#task-priorities');
});

test('priority wiki href is unavailable without explicit organization context', () => {
  assert.equal(buildTaskPriorityWikiHref(), null);
  assert.equal(buildTaskPriorityWikiHref('  '), null);
});

test('task-board priority scope uses the sole available organization on an unscoped route', () => {
  assert.equal(resolveTaskPriorityOrgId(undefined, '?tab=kanban', ['org-a']), 'org-a');
});

test('task-board priority scope does not guess among multiple organizations', () => {
  assert.equal(resolveTaskPriorityOrgId(undefined, '?tab=kanban', ['org-a', 'org-b']), null);
  assert.equal(resolveTaskPriorityOrgId(undefined, '?tab=kanban', ['org-a', 'org-a', null]), 'org-a');
});

test('explicit task and URL organization context takes precedence over available organizations', () => {
  assert.equal(resolveTaskPriorityOrgId('task-org', '?org=url-org', ['available-org']), 'task-org');
  assert.equal(resolveTaskPriorityOrgId(undefined, '?org=url-org', ['available-org']), 'url-org');
});
