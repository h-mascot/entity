import test from 'node:test';
import assert from 'node:assert/strict';

import { sortSearchResults } from './fileSearchSort.ts';

const results = [
  { title: 'Bravo doc', path: 'b.md', type: 'prd', modifiedAt: '2026-07-02T10:00:00Z' },
  { title: 'alpha notes', path: 'a.md', type: 'script', modifiedAt: '2026-07-05T10:00:00Z' },
  { title: 'Charlie log', path: 'c.md', type: 'daily-review', updatedAt: '2026-07-01T10:00:00Z' },
  { title: '', path: 'zz/no-title.md', type: 'prd' },
];

test('relevance keeps the server order and returns a copy', () => {
  const sorted = sortSearchResults(results, 'relevance');
  assert.deepEqual(sorted.map((r) => r.path), ['b.md', 'a.md', 'c.md', 'zz/no-title.md']);
  assert.notEqual(sorted, results);
});

test('newest/oldest sort by modifiedAt falling back to updatedAt, missing dates last/first', () => {
  assert.deepEqual(
    sortSearchResults(results, 'newest').map((r) => r.path),
    ['a.md', 'b.md', 'c.md', 'zz/no-title.md'],
  );
  assert.deepEqual(
    sortSearchResults(results, 'oldest').map((r) => r.path),
    ['zz/no-title.md', 'c.md', 'b.md', 'a.md'],
  );
});

test('name sorts case-insensitively and falls back to path when title is empty', () => {
  assert.deepEqual(
    sortSearchResults(results, 'name-asc').map((r) => r.title || r.path),
    ['alpha notes', 'Bravo doc', 'Charlie log', 'zz/no-title.md'],
  );
  assert.deepEqual(
    sortSearchResults(results, 'name-desc').map((r) => r.title || r.path),
    ['zz/no-title.md', 'Charlie log', 'Bravo doc', 'alpha notes'],
  );
});

test('type groups by type then name', () => {
  assert.deepEqual(
    sortSearchResults(results, 'type').map((r) => r.path),
    ['c.md', 'b.md', 'zz/no-title.md', 'a.md'],
  );
});

test('empty input stays empty', () => {
  assert.deepEqual(sortSearchResults([], 'newest'), []);
});
