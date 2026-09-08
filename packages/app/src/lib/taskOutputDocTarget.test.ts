import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveRelativeDocHubNavigation,
} from './docHubRoute.ts';
import {
  resolveTaskOutputDocTarget,
  scopeTaskOutputDocNavigation,
} from './taskOutputDocTarget.ts';

const sources = [{ id: 'workspace', enabled: true }, { id: 'notes', enabled: false }];

test('routes to the matching source when the docs root is a source id', () => {
  assert.deepEqual(
    resolveTaskOutputDocTarget('workspace/output/demo.md', sources, true),
    { kind: 'source', sourceId: 'workspace', path: 'output/demo.md' },
  );
});

test('ignores disabled sources as roots but falls back to workspace', () => {
  assert.deepEqual(
    resolveTaskOutputDocTarget('notes/todo.md', sources, true),
    { kind: 'source', sourceId: 'workspace', path: 'notes/todo.md' },
  );
});

test('unprefixed docs paths open on the workspace source', () => {
  assert.deepEqual(
    resolveTaskOutputDocTarget('output/entity-doc-viewer-demo.md', sources, true),
    { kind: 'source', sourceId: 'workspace', path: 'output/entity-doc-viewer-demo.md' },
  );
});

test('configured task-output targets carry the selected task organization', () => {
  const resolved = resolveTaskOutputDocTarget('output/task.md', sources, true);
  if (resolved.kind !== 'source') {
    throw new Error('expected a configured source target');
  }
  assert.deepEqual(
    scopeTaskOutputDocNavigation(
      {
        target: { sourceId: resolved.sourceId, path: resolved.path },
        route: '/docs/source/workspace/output/task.md',
      },
      'org-task',
    ).target,
    { sourceId: 'workspace', path: 'output/task.md', orgId: 'org-task' },
  );
});

test('falls back to the docs route without multisource or workspace source', () => {
  assert.deepEqual(resolveTaskOutputDocTarget('output/demo.md', sources, false), { kind: 'docs-route' });
  assert.deepEqual(resolveTaskOutputDocTarget('output/demo.md', [], true), { kind: 'docs-route' });
  assert.deepEqual(
    resolveTaskOutputDocTarget('output/demo.md', [{ id: 'workspace', enabled: false }], true),
    { kind: 'docs-route' },
  );
});

test('empty path falls back to the docs route', () => {
  assert.deepEqual(resolveTaskOutputDocTarget('', sources, true), { kind: 'docs-route' });
  assert.deepEqual(resolveTaskOutputDocTarget('///', sources, true), { kind: 'docs-route' });
});

test('resolved task output navigation scopes the target while preserving explicit links', () => {
  const unscoped = resolveRelativeDocHubNavigation(
    '/task/26',
    '',
    '/docs/source/workspace/output/task.md#section',
    true,
    'https://entity.invalid',
  );
  assert.ok(unscoped);
  assert.deepEqual(scopeTaskOutputDocNavigation(unscoped, 'org-task'), {
    target: { sourceId: 'workspace', path: 'output/task.md', orgId: 'org-task' },
    route: '/docs/source/workspace/output/task.md?org=org-task#section',
  });

  const explicit = resolveRelativeDocHubNavigation(
    '/task/26',
    '',
    '/docs/source/workspace/output/task.md?org=org-explicit#section',
    true,
    'https://entity.invalid',
  );
  assert.ok(explicit);
  assert.deepEqual(scopeTaskOutputDocNavigation(explicit, 'org-task'), {
    target: { sourceId: 'workspace', path: 'output/task.md', orgId: 'org-explicit' },
    route: '/docs/source/workspace/output/task.md?org=org-explicit#section',
  });

  const empty = resolveRelativeDocHubNavigation(
    '/task/26',
    '',
    '/docs/source/workspace/output/task.md?org=#section',
    true,
    'https://entity.invalid',
  );
  assert.ok(empty);
  assert.deepEqual(scopeTaskOutputDocNavigation(empty, 'org-task'), {
    target: { sourceId: 'workspace', path: 'output/task.md', orgId: 'org-task' },
    route: '/docs/source/workspace/output/task.md?org=org-task#section',
  });
});
