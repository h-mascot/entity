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
  assert.equal(buildOpenFileTabKey('src-1', 'docs/readme.md', 'org-a'), 'src-1::org-a::docs/readme.md');
});

test('upserts without duplicating an existing tab', () => {
  const initial = [buildOpenFileTab('src-1', 'a.md')];
  const next = upsertOpenFileTab(initial, buildOpenFileTab('src-1', 'a.md'));
  assert.equal(next.length, 1);
  assert.equal(upsertOpenFileTab(initial, buildOpenFileTab(null, 'b.md')).length, 2);
  assert.equal(upsertOpenFileTab(initial, buildOpenFileTab('src-1', 'a.md', 'org-b')).length, 2);
});

test('keeps same-path local tabs separate across organizations', () => {
  const orgATab = buildOpenFileTab(null, 'docs/shared.md', 'org-a');
  const orgBTab = buildOpenFileTab(null, 'docs/shared.md', 'org-b');

  assert.equal(buildOpenFileTabKey(null, 'docs/shared.md', 'org-a'), 'local::org-a::docs/shared.md');
  assert.equal(upsertOpenFileTab([orgATab], orgBTab).length, 2);
});

test('retains organization scope on source-less tabs', () => {
  assert.deepEqual(buildOpenFileTab(null, 'uploads/proof.md', 'org-beta'), {
    sourceId: null,
    path: 'uploads/proof.md',
    orgId: 'org-beta',
  });
});

test('removes tabs by key and extracts filenames', () => {
  const tabs = [buildOpenFileTab(null, 'output/demo.md'), buildOpenFileTab('src-2', 'notes/todo.md')];
  assert.equal(filenameFromOpenFileTab(tabs[0]!), 'demo.md');
  assert.deepEqual(removeOpenFileTab(tabs, buildOpenFileTabKey(null, 'output/demo.md')), [tabs[1]]);
});
