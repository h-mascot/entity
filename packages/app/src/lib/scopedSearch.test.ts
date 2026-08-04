import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildScopedSearchViewModel,
  fetchScopedSearch,
  isRestrictedScopedResult,
  parseScopedSearchEnvelope,
  toDisplayResult,
  type ScopedSearchEnvelope,
} from './scopedSearch.ts';

function envelope(overrides: Partial<ScopedSearchEnvelope> = {}): ScopedSearchEnvelope {
  return {
    version: 'entity.scoped-search.v1',
    query: 'renewal',
    scope: { orgId: 'default-org', teamId: null, projectId: null },
    filters: { objectTypes: ['task'] },
    searchState: {
      state: 'healthy',
      partial: false,
      reasons: [],
      backends: [{ name: 'tasks', state: 'healthy', indexedAt: '2026-07-31T00:00:00.000Z', lagSeconds: 1 }],
    },
    count: 1,
    nextCursor: null,
    results: [
      {
        objectType: 'task',
        objectId: '42',
        title: 'Prepare renewal packet',
        snippet: 'renewal evidence',
        deepLink: { route: '/task/42' },
        permission: { state: 'visible', reasons: [] },
      },
    ],
    ...overrides,
  };
}

test('buildScopedSearchViewModel distinguishes idle/loading/success/empty', () => {
  assert.equal(buildScopedSearchViewModel({ query: '' }).status, 'idle');
  assert.equal(buildScopedSearchViewModel({ query: 'x', loading: true }).status, 'loading');
  assert.equal(buildScopedSearchViewModel({ query: 'renewal', envelope: envelope() }).status, 'success');
  assert.equal(
    buildScopedSearchViewModel({
      query: 'missing',
      envelope: envelope({ query: 'missing', count: 0, results: [] }),
    }).status,
    'empty',
  );
});

test('buildScopedSearchViewModel keeps empty degraded distinct from healthy empty', () => {
  const degradedEmpty = buildScopedSearchViewModel({
    query: 'missing',
    envelope: envelope({
      query: 'missing',
      count: 0,
      results: [],
      searchState: {
        state: 'degraded',
        partial: true,
        reasons: ['documents_backend_unavailable'],
        backends: [
          { name: 'documents', state: 'failed', indexedAt: null, lagSeconds: null },
          { name: 'tasks', state: 'healthy', indexedAt: '2026-07-31T00:00:00.000Z', lagSeconds: 2 },
        ],
      },
    }),
  });
  assert.equal(degradedEmpty.status, 'degraded');
  assert.match(degradedEmpty.headline, /degraded/i);
  assert.ok(degradedEmpty.detail?.includes('documents_backend_unavailable'));

  const healthyEmpty = buildScopedSearchViewModel({
    query: 'missing',
    envelope: envelope({ query: 'missing', count: 0, results: [] }),
  });
  assert.equal(healthyEmpty.status, 'empty');
  assert.match(healthyEmpty.detail ?? '', /Healthy search/);
});

test('buildScopedSearchViewModel maps all-failed 503 envelope to failed, not empty', () => {
  const failed = buildScopedSearchViewModel({
    query: 'renewal',
    httpStatus: 503,
    envelope: envelope({
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
  assert.equal(failed.status, 'failed');
  assert.equal(failed.results.length, 0);
  assert.match(failed.headline, /failed/i);
});

test('restricted results hide snippet deep link and private meta', () => {
  const restricted = {
    objectType: 'file',
    objectId: 'restricted:opaque',
    title: 'Restricted result',
    snippet: null,
    deepLink: null,
    permission: { state: 'restricted' as const, reasons: ['acl_denied'] },
    sensitivity: 'secret',
  };
  assert.equal(isRestrictedScopedResult(restricted), true);
  const display = toDisplayResult(restricted, 0);
  assert.equal(display.title, 'Restricted result');
  assert.equal(display.snippet, null);
  assert.equal(display.deepLinkRoute, null);
  assert.equal(display.restricted, true);
  assert.equal(display.metaLine?.includes('secret'), false);
  assert.equal(display.metaLine?.includes('acl_denied'), false);
});

test('parseScopedSearchEnvelope rejects wrong version', () => {
  assert.throws(() => parseScopedSearchEnvelope({ version: 'other' }));
});

test('fetchScopedSearch accepts 503 envelope and org header', async () => {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const result = await fetchScopedSearch({
    q: 'renewal',
    objectTypes: ['task'],
    orgId: 'org-a',
    apiBase: 'http://example.test',
    fetchImpl: async (input, init) => {
      const url = String(input);
      calls.push({ url, headers: new Headers(init?.headers) });
      return new Response(
        JSON.stringify(
          envelope({
            count: 0,
            results: [],
            searchState: {
              state: 'failed',
              partial: false,
              reasons: ['tasks_backend_unavailable'],
              backends: [{ name: 'tasks', state: 'failed', indexedAt: null, lagSeconds: null }],
            },
          }),
        ),
        { status: 503, headers: { 'content-type': 'application/json' } },
      );
    },
  });
  assert.equal(result.httpStatus, 503);
  assert.equal(result.envelope.searchState.state, 'failed');
  assert.equal(calls[0]?.headers.get('x-entity-org-id'), 'org-a');
  assert.match(calls[0]?.url ?? '', /\/api\/search\/scoped\?/);
});

test('fetchScopedSearch surfaces non-envelope errors', async () => {
  await assert.rejects(
    () =>
      fetchScopedSearch({
        q: 'renewal',
        objectTypes: ['file'],
        apiBase: 'http://example.test',
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: 'q required', code: 'query_required' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          }),
      }),
    /q required/,
  );
});
