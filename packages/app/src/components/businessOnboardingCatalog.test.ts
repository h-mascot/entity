import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveBusinessDomainCatalog, type CatalogDomain } from './businessOnboardingCatalog.ts';

const fallback: CatalogDomain[] = [
  {
    id: 'product',
    label: 'Product',
    teamName: 'Product',
    description: 'fallback product',
    seedProject: 'Product Operating System',
    seedTasks: ['a'],
  },
];

test('uses live catalog when domains are present', () => {
  const live: CatalogDomain[] = [
    {
      id: 'finance',
      label: 'Finance',
      teamName: 'Finance',
      description: 'live finance',
      seedProject: 'Finance Approvals',
      seedTasks: ['b'],
    },
  ];
  const resolved = resolveBusinessDomainCatalog(live, fallback, null);
  assert.equal(resolved.degraded, false);
  assert.equal(resolved.notice, null);
  assert.deepEqual(resolved.domains, live);
});

test('falls back with an honest degraded notice when catalog load fails', () => {
  const resolved = resolveBusinessDomainCatalog(null, fallback, 'Network offline');
  assert.equal(resolved.degraded, true);
  assert.match(resolved.notice ?? '', /offline domain catalog/i);
  assert.match(resolved.notice ?? '', /Network offline/);
  assert.deepEqual(resolved.domains, fallback);
});

test('falls back when catalog returns an empty list', () => {
  const resolved = resolveBusinessDomainCatalog([], fallback, null);
  assert.equal(resolved.degraded, true);
  assert.match(resolved.notice ?? '', /no domains/i);
  assert.deepEqual(resolved.domains, fallback);
});
