import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveTaskOutputDocTarget } from './taskOutputDocTarget.ts';

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
