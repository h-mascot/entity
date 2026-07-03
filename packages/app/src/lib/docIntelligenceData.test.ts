import test from 'node:test';
import assert from 'node:assert/strict';

import {
  docFilename,
  docFilenameStem,
  filterRelatedDocResults,
  findTasksReferencingDoc,
} from './docIntelligenceData.ts';

test('docFilename and stem extraction', () => {
  assert.equal(docFilename('output/entity-doc-viewer-demo.md'), 'entity-doc-viewer-demo.md');
  assert.equal(docFilenameStem('output/entity-doc-viewer-demo.md'), 'entity-doc-viewer-demo');
  assert.equal(docFilenameStem('README'), 'README');
  assert.equal(docFilenameStem('.env'), '.env');
});

test('findTasksReferencingDoc matches by full path in output', () => {
  const tasks = [
    { id: 1, name: 'Review demo doc', output: 'See /docs/workspace/output/entity-doc-viewer-demo.md' },
    { id: 2, name: 'Unrelated', output: 'nothing here' },
  ];
  const matched = findTasksReferencingDoc(tasks, 'output/entity-doc-viewer-demo.md');
  assert.deepEqual(matched.map((t) => t.id), [1]);
});

test('findTasksReferencingDoc matches distinctive filename in description', () => {
  const tasks = [
    { id: 3, name: 'Doc work', description: 'update entity-doc-viewer-demo.md soon' },
  ];
  assert.equal(findTasksReferencingDoc(tasks, 'somewhere/else/entity-doc-viewer-demo.md').length, 1);
});

test('findTasksReferencingDoc ignores short generic filenames unless the full path matches', () => {
  const tasks = [{ id: 4, name: 'touch a.md today', description: null, output: null }];
  assert.equal(findTasksReferencingDoc(tasks, 'notes/a.md').length, 0);
  assert.equal(findTasksReferencingDoc([{ id: 5, name: 'see notes/a.md' }], 'notes/a.md').length, 1);
});

test('findTasksReferencingDoc handles empty/null path and empty task list', () => {
  assert.deepEqual(findTasksReferencingDoc([], 'x.md'), []);
  assert.deepEqual(findTasksReferencingDoc([{ id: 1, name: 'n' }], null), []);
  assert.deepEqual(findTasksReferencingDoc([{ id: 1, name: 'n' }], '   '), []);
});

test('filterRelatedDocResults excludes current doc, dedupes, and limits', () => {
  const results = [
    { sourceId: 's1', path: 'docs/current.md' },
    { sourceId: 's1', path: 'docs/other.md' },
    { sourceId: 's1', path: 'docs/other.md' },
    { sourceId: 's2', path: 'docs/other.md' },
  ];
  const related = filterRelatedDocResults(results, 'docs/current.md');
  assert.deepEqual(
    related.map((r) => `${r.sourceId}:${r.path}`),
    ['s1:docs/other.md', 's2:docs/other.md'],
  );

  const limited = filterRelatedDocResults(results, null, 1);
  assert.equal(limited.length, 1);
});
