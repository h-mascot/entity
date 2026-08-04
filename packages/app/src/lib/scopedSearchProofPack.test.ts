/**
 * THE-905 / SRCH-A-06 — durable scoped search proof pack.
 *
 * Covers Docs + task/proof object-type surfaces and the required
 * success / healthy-empty / degraded-partial / failure / restricted states.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DOC_HUB_SCOPED_OBJECT_TYPES,
  WORKPLANE_SCOPED_OBJECT_TYPES,
  buildScopedSearchViewModel,
  objectTypesForSurface,
  scopedSearchEmptyKind,
  toDisplayResult,
  type ScopedSearchEnvelope,
  type ScopedSearchResult,
} from './scopedSearch.ts';

function baseEnvelope(overrides: Partial<ScopedSearchEnvelope> = {}): ScopedSearchEnvelope {
  return {
    version: 'entity.scoped-search.v1',
    query: 'renewal',
    scope: { orgId: 'default-org', teamId: null, projectId: null },
    filters: { objectTypes: ['native_document', 'file'] },
    searchState: {
      state: 'healthy',
      partial: false,
      reasons: [],
      backends: [
        { name: 'documents', state: 'healthy', indexedAt: '2026-07-31T00:00:00.000Z', lagSeconds: 1 },
      ],
    },
    count: 0,
    nextCursor: null,
    results: [],
    ...overrides,
  };
}

const visibleDoc: ScopedSearchResult = {
  objectType: 'native_document',
  objectId: 'doc-1',
  title: 'Renewal checklist',
  snippet: 'renewal steps',
  deepLink: { route: '/files?doc=doc-1' },
  permission: { state: 'visible', reasons: [] },
  provenance: { backend: 'documents' },
};

const visibleTask: ScopedSearchResult = {
  objectType: 'task',
  objectId: '42',
  title: 'Prepare renewal packet',
  snippet: 'task renewal evidence',
  deepLink: { route: '/task/42' },
  permission: { state: 'visible', reasons: [] },
  state: 'in_progress',
  provenance: { backend: 'tasks' },
};

const visibleProof: ScopedSearchResult = {
  objectType: 'evidence_artifact',
  objectId: 'ev-9',
  title: 'Renewal receipt',
  snippet: 'proof renewal',
  deepLink: null,
  permission: { state: 'visible', reasons: [] },
  reviewState: 'accepted',
  provenance: { backend: 'proofs' },
};

const restrictedDoc: ScopedSearchResult = {
  objectType: 'file',
  objectId: 'restricted:opaque',
  title: 'Restricted result',
  snippet: null,
  deepLink: null,
  permission: { state: 'restricted', reasons: ['acl_denied'] },
  sensitivity: 'secret',
};

test('proof pack surfaces: Doc Hub uses docs types; Workplane uses task/proof types', () => {
  assert.deepEqual([...objectTypesForSurface('doc_hub')], [...DOC_HUB_SCOPED_OBJECT_TYPES]);
  assert.deepEqual([...objectTypesForSurface('workplane')], [...WORKPLANE_SCOPED_OBJECT_TYPES]);
  assert.ok(DOC_HUB_SCOPED_OBJECT_TYPES.includes('native_document'));
  assert.ok(DOC_HUB_SCOPED_OBJECT_TYPES.includes('file'));
  assert.ok(WORKPLANE_SCOPED_OBJECT_TYPES.includes('task'));
  assert.ok(WORKPLANE_SCOPED_OBJECT_TYPES.includes('evidence_artifact'));
  assert.ok(WORKPLANE_SCOPED_OBJECT_TYPES.includes('receipt'));
});

test('proof pack success: docs and task/proof results remain visible with deep links where present', () => {
  const docs = buildScopedSearchViewModel({
    query: 'renewal',
    envelope: baseEnvelope({
      count: 1,
      results: [visibleDoc],
      filters: { objectTypes: [...DOC_HUB_SCOPED_OBJECT_TYPES] },
    }),
  });
  assert.equal(docs.status, 'success');
  assert.equal(scopedSearchEmptyKind(docs), 'none');
  assert.equal(docs.results[0]?.title, 'Renewal checklist');
  assert.equal(docs.results[0]?.deepLinkRoute, '/files?doc=doc-1');

  const workplane = buildScopedSearchViewModel({
    query: 'renewal',
    envelope: baseEnvelope({
      count: 2,
      results: [visibleTask, visibleProof],
      filters: { objectTypes: [...WORKPLANE_SCOPED_OBJECT_TYPES] },
      searchState: {
        state: 'healthy',
        partial: false,
        reasons: [],
        backends: [
          { name: 'tasks', state: 'healthy', indexedAt: '2026-07-31T00:00:00.000Z', lagSeconds: 1 },
          { name: 'proofs', state: 'healthy', indexedAt: '2026-07-31T00:00:00.000Z', lagSeconds: 2 },
        ],
      },
    }),
  });
  assert.equal(workplane.status, 'success');
  assert.equal(workplane.results.length, 2);
  assert.equal(workplane.results[0]?.objectType, 'task');
  assert.equal(workplane.results[1]?.objectType, 'evidence_artifact');
});

test('proof pack healthy empty is distinct from degraded/failed empty', () => {
  const healthyEmpty = buildScopedSearchViewModel({
    query: 'zzzz-no-match',
    envelope: baseEnvelope({ query: 'zzzz-no-match', count: 0, results: [] }),
  });
  assert.equal(healthyEmpty.status, 'empty');
  assert.equal(scopedSearchEmptyKind(healthyEmpty), 'healthy-empty');
  assert.match(healthyEmpty.detail ?? '', /Healthy search/);

  const degradedEmpty = buildScopedSearchViewModel({
    query: 'zzzz-no-match',
    envelope: baseEnvelope({
      query: 'zzzz-no-match',
      count: 0,
      results: [],
      searchState: {
        state: 'degraded',
        partial: true,
        reasons: ['documents_backend_unavailable'],
        backends: [
          { name: 'documents', state: 'failed', indexedAt: null, lagSeconds: null },
          { name: 'tasks', state: 'healthy', indexedAt: '2026-07-31T00:00:00.000Z', lagSeconds: 1 },
        ],
      },
    }),
  });
  assert.equal(degradedEmpty.status, 'degraded');
  assert.equal(scopedSearchEmptyKind(degradedEmpty), 'degraded-empty');
  assert.notEqual(scopedSearchEmptyKind(degradedEmpty), 'healthy-empty');

  const failedEmpty = buildScopedSearchViewModel({
    query: 'zzzz-no-match',
    httpStatus: 503,
    envelope: baseEnvelope({
      query: 'zzzz-no-match',
      count: 0,
      results: [],
      searchState: {
        state: 'failed',
        partial: false,
        reasons: ['tasks_backend_unavailable', 'proofs_backend_unavailable'],
        backends: [
          { name: 'tasks', state: 'failed', indexedAt: null, lagSeconds: null },
          { name: 'proofs', state: 'failed', indexedAt: null, lagSeconds: null },
        ],
      },
    }),
  });
  assert.equal(failedEmpty.status, 'failed');
  assert.equal(scopedSearchEmptyKind(failedEmpty), 'failed-empty');
  assert.match(failedEmpty.headline, /failed/i);
});

test('proof pack degraded/partial keeps visible results and marks partial', () => {
  const partial = buildScopedSearchViewModel({
    query: 'renewal',
    envelope: baseEnvelope({
      count: 1,
      results: [visibleTask],
      searchState: {
        state: 'degraded',
        partial: true,
        reasons: ['proofs_backend_unavailable'],
        backends: [
          { name: 'tasks', state: 'healthy', indexedAt: '2026-07-31T00:00:00.000Z', lagSeconds: 1 },
          { name: 'proofs', state: 'failed', indexedAt: null, lagSeconds: null },
        ],
      },
    }),
  });
  assert.equal(partial.status, 'degraded');
  assert.equal(partial.partial, true);
  assert.equal(partial.results.length, 1);
  assert.equal(scopedSearchEmptyKind(partial), 'none');
  assert.match(partial.headline, /Partial results/i);
});

test('proof pack restricted redacts snippet, deep link, and private metadata', () => {
  const view = buildScopedSearchViewModel({
    query: 'compensation',
    envelope: baseEnvelope({
      query: 'compensation',
      count: 1,
      results: [restrictedDoc],
    }),
  });
  assert.equal(view.status, 'success');
  const row = view.results[0];
  assert.ok(row);
  assert.equal(row.restricted, true);
  assert.equal(row.title, 'Restricted result');
  assert.equal(row.snippet, null);
  assert.equal(row.deepLinkRoute, null);
  assert.equal(row.metaLine?.includes('secret'), false);
  assert.equal(row.metaLine?.includes('acl_denied'), false);
  assert.equal(row.metaLine?.includes('compensation'), false);

  // Guard against accidental display of private fields if a buggy payload leaks them.
  const leaky: ScopedSearchResult = {
    ...restrictedDoc,
    objectId: 'workspace:secret/payroll.md',
    title: 'Payroll secret',
    snippet: 'salary band confidential',
    deepLink: { route: '/files?path=secret/payroll.md' },
    sensitivity: 'secret',
  };
  const display = toDisplayResult(leaky, 0);
  assert.equal(display.title, 'Restricted result');
  assert.equal(display.objectId, 'restricted:opaque');
  assert.equal(display.snippet, null);
  assert.equal(display.deepLinkRoute, null);
  assert.equal(JSON.stringify(display).includes('salary'), false);
  assert.equal(JSON.stringify(display).includes('payroll'), false);
  assert.equal(JSON.stringify(display).includes('secret'), false);
});

test('proof pack transport/error path is not healthy empty', () => {
  const errorView = buildScopedSearchViewModel({
    query: 'renewal',
    errorMessage: 'Scoped search endpoint not found.',
    httpStatus: 404,
  });
  assert.equal(errorView.status, 'error');
  assert.equal(scopedSearchEmptyKind(errorView), 'none');
  assert.match(errorView.headline, /unavailable/i);
});
