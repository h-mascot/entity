import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveQuickSwitcherOrgId } from '../lib/quickSwitcherScope.ts';

async function loadHelpers(): Promise<{
  buildQuickSwitcherSearchRequest: (options: {
    query: string;
    apiBase: string;
    useUnifiedSearch: boolean;
    orgId?: string;
  }) => { urls: string[]; init?: RequestInit };
  isQuickSwitcherSearchCurrent: (requestId: number, currentRequestId: number) => boolean;
}> {
  const mod = await import('./QuickSwitcher.tsx');
  return {
    buildQuickSwitcherSearchRequest: mod.buildQuickSwitcherSearchRequest,
    isQuickSwitcherSearchCurrent: mod.isQuickSwitcherSearchCurrent,
  };
}

test('Quick Switcher sends the selected organization to unified and legacy search', async () => {
  const { buildQuickSwitcherSearchRequest } = await loadHelpers();

  for (const useUnifiedSearch of [true, false]) {
    const request = buildQuickSwitcherSearchRequest({
      query: 'customer guide',
      apiBase: 'https://entity.test',
      useUnifiedSearch,
      orgId: '  org-beta  ',
    });
    const firstUrl = new URL(request.urls[0]);

    assert.equal(firstUrl.searchParams.get('q'), 'customer guide');
    assert.equal(firstUrl.searchParams.get('orgId'), 'org-beta');
    assert.equal(firstUrl.searchParams.get('limit'), useUnifiedSearch ? '10' : null);
    assert.equal(firstUrl.pathname, useUnifiedSearch ? '/api/fs/search' : '/api/search');
    assert.equal(new Headers(request.init?.headers).get('x-entity-org-id'), 'org-beta');
  }
});

test('Quick Switcher keeps Unicode organization scope in the URL without an invalid header', async () => {
  const { buildQuickSwitcherSearchRequest } = await loadHelpers();
  const request = buildQuickSwitcherSearchRequest({
    query: 'guide',
    apiBase: 'https://entity.test',
    useUnifiedSearch: true,
    orgId: '销售组织',
  });
  const url = new URL(request.urls[0]);
  const browserRequest = new Request(url, request.init);

  assert.equal(url.searchParams.get('orgId'), '销售组织');
  assert.equal(browserRequest.headers.has('x-entity-org-id'), false);
});

test('Quick Switcher preserves absent-organization request behavior', async () => {
  const { buildQuickSwitcherSearchRequest } = await loadHelpers();
  const request = buildQuickSwitcherSearchRequest({
    query: 'guide',
    apiBase: '',
    useUnifiedSearch: true,
  });

  assert.equal(new URL(request.urls[0], 'https://entity.test').searchParams.has('orgId'), false);
  assert.equal(request.init, undefined);
});

test('Quick Switcher uses the target pane scope and only inherits left scope when right is unscoped', () => {
  assert.equal(resolveQuickSwitcherOrgId('left', 'org-beta', 'org-alpha'), 'org-alpha');
  assert.equal(resolveQuickSwitcherOrgId('right', 'org-beta', 'org-alpha'), 'org-beta');
  assert.equal(resolveQuickSwitcherOrgId('right', null, 'org-alpha'), 'org-alpha');
  assert.equal(resolveQuickSwitcherOrgId('right', '  ', 'org-alpha'), 'org-alpha');
  assert.equal(resolveQuickSwitcherOrgId('left', null, null), undefined);
});

test('stale Quick Switcher responses are ignored after the request identity changes', async () => {
  const { isQuickSwitcherSearchCurrent } = await loadHelpers();
  assert.equal(isQuickSwitcherSearchCurrent(4, 4), true);
  assert.equal(isQuickSwitcherSearchCurrent(4, 5), false);
});
