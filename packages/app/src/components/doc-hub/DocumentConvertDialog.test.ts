import assert from 'node:assert/strict';
import test from 'node:test';

async function loadHelpers(): Promise<{
  buildDocumentConvertRequest: (apiBase: string, body: Record<string, unknown>, orgId?: string) => [string, RequestInit];
  isCurrentConversionRequest: (requestId: number, currentRequestId: number, requestIdentity?: string, currentIdentity?: string) => boolean;
}> {
  const mod = await import('./DocumentConvertDialog.tsx');
  return {
    buildDocumentConvertRequest: mod.buildDocumentConvertRequest,
    isCurrentConversionRequest: mod.isCurrentConversionRequest,
  };
}

test('document conversion requests carry the selected organization on both URL and header', async () => {
  const { buildDocumentConvertRequest } = await loadHelpers();
  const [url, init] = buildDocumentConvertRequest('https://entity.test', { sourceId: 'docs', path: 'guide.md' }, '  org-beta  ');
  const parsed = new URL(url);

  assert.equal(parsed.pathname, '/api/fs/documents/convert');
  assert.equal(parsed.searchParams.get('orgId'), 'org-beta');
  assert.equal(new Headers(init.headers).get('x-entity-org-id'), 'org-beta');
  assert.deepEqual(JSON.parse(String(init.body)), { sourceId: 'docs', path: 'guide.md' });
});

test('document conversion preserves legacy unscoped requests when no organization is selected', async () => {
  const { buildDocumentConvertRequest } = await loadHelpers();
  const [url, init] = buildDocumentConvertRequest('', { sourceId: 'docs', path: 'guide.md' });

  assert.equal(url, '/api/fs/documents/convert');
  assert.equal(new Headers(init.headers).has('x-entity-org-id'), false);
  assert.deepEqual(JSON.parse(String(init.body)), { sourceId: 'docs', path: 'guide.md' });
});

test('stale conversion completions are ignored after the source scope changes', async () => {
  const { isCurrentConversionRequest } = await loadHelpers();
  assert.equal(isCurrentConversionRequest(8, 8), true);
  assert.equal(isCurrentConversionRequest(8, 9), false);
  assert.equal(isCurrentConversionRequest(8, 8, '["org-a",true,"source", "guide.md"]', '["org-b",true,"source", "guide.md"]'), false);
});
