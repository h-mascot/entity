import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFileLoadKey } from './fileLoadIdentity.ts';

test('file load keys distinguish local, source, and delimiter-containing identities', () => {
  const identities: Array<[string | null, string]> = [
    [null, 'foo.md'],
    ['local', 'foo.md'],
    ['a:b', 'c.md'],
    ['a', 'b:c.md'],
  ];

  const keys = identities.map(([sourceId, filePath]) => buildFileLoadKey(sourceId, filePath));
  assert.equal(new Set(keys).size, identities.length);
});
