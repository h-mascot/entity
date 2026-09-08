import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFileLoadKey } from './fileLoadIdentity.ts';

test('file load keys distinguish local, source, and delimiter-containing identities', () => {
  const identities: Array<[string | null, string, string | null]> = [
    [null, 'foo.md', null],
    ['local', 'foo.md', null],
    ['a:b', 'c.md', null],
    ['a', 'b:c.md', null],
  ];

  const keys = identities.map(([sourceId, filePath, orgId]) => buildFileLoadKey(sourceId, filePath, orgId));
  assert.equal(new Set(keys).size, identities.length);
});

test('file load keys distinguish organization-scoped copies and normalize blank scopes', () => {
  assert.notEqual(buildFileLoadKey('source', 'foo.md', 'org-a'), buildFileLoadKey('source', 'foo.md', 'org-b'));
  assert.equal(buildFileLoadKey('source', 'foo.md'), buildFileLoadKey('source', 'foo.md', null));
  assert.equal(buildFileLoadKey('source', 'foo.md', '  '), buildFileLoadKey('source', 'foo.md', null));
  assert.equal(buildFileLoadKey(null, 'foo.md', ' org-a '), buildFileLoadKey(null, 'foo.md', 'org-a'));
});
