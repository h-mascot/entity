import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOpenFileTab,
  buildOpenFileTabKey,
  filenameFromOpenFileTab,
  removeOpenFileTab,
  upsertOpenFileTab,
} from './openFileTabs.ts';

test('builds stable keys for local and source-backed tabs', () => {
  assert.equal(buildOpenFileTabKey(null, 'docs/readme.md'), 'local::docs/readme.md');
  assert.equal(buildOpenFileTabKey('src-1', 'docs/readme.md'), 'src-1::docs/readme.md');
});

test('upserts without duplicating an existing tab', () => {
  const initial = [buildOpenFileTab('src-1', 'a.md')];
  const next = upsertOpenFileTab(initial, buildOpenFileTab('src-1', 'a.md'));
  assert.equal(next.length, 1);
  assert.equal(upsertOpenFileTab(initial, buildOpenFileTab(null, 'b.md')).length, 2);
});

test('removes tabs by key and extracts filenames', () => {
  const tabs = [buildOpenFileTab(null, 'output/demo.md'), buildOpenFileTab('src-2', 'notes/todo.md')];
  assert.equal(filenameFromOpenFileTab(tabs[0]!), 'demo.md');
  assert.deepEqual(removeOpenFileTab(tabs, buildOpenFileTabKey(null, 'output/demo.md')), [tabs[1]]);
});
