import test from 'node:test';
import assert from 'node:assert/strict';

import { withApiToken, requestJsonWithFallback, buildApiCandidates } from './http.ts';

// Minimal localStorage + window shim. http.ts reads the API token from
// window.localStorage at call time, so we install a fake window for these
// contract tests and tear it down afterwards.
interface FakeStorage {
  store: Record<string, string>;
}
function installFakeWindow(storage: FakeStorage) {
  const fakeWindow = {
    localStorage: {
      getItem: (key: string) => (key in storage.store ? storage.store[key] : null),
      setItem: (key: string, value: string) => {
        storage.store[key] = String(value);
      },
      removeItem: (key: string) => {
        delete storage.store[key];
      },
    },
  };
  (globalThis as unknown as { window: unknown }).window = fakeWindow;
}
function clearFakeWindow() {
  delete (globalThis as unknown as { window?: unknown }).window;
}

test('withApiToken attaches Authorization: Bearer when a token is stored', () => {
  const storage: FakeStorage = { store: { 'entity-api-token': 'secret-abc' } };
  installFakeWindow(storage);
  try {
    const init = withApiToken({ method: 'GET' });
    const headers = init.headers as Headers;
    assert.equal(headers.get('Authorization'), 'Bearer secret-abc');
  } finally {
    clearFakeWindow();
  }
});

test('withApiToken is a no-op when no token is stored', () => {
  const storage: FakeStorage = { store: {} };
  installFakeWindow(storage);
  try {
    // No token => init is returned unchanged, so no Authorization header exists.
    const init = withApiToken({ method: 'GET' });
    const headers = new Headers(init.headers);
    assert.equal(headers.get('Authorization'), null);
  } finally {
    clearFakeWindow();
  }
});

test('withApiToken does not overwrite an existing Authorization header', () => {
  const storage: FakeStorage = { store: { 'entity-api-token': 'secret-abc' } };
  installFakeWindow(storage);
  try {
    const init = withApiToken({
      method: 'GET',
      headers: { Authorization: 'Bearer preset' },
    });
    const headers = init.headers as Headers;
    assert.equal(headers.get('Authorization'), 'Bearer preset');
  } finally {
    clearFakeWindow();
  }
});

test('requestJsonWithFallback injects the stored bearer token into fetch', async () => {
  const storage: FakeStorage = { store: { 'entity-api-token': 'secret-abc' } };
  installFakeWindow(storage);
  let captured: HeadersInit | undefined;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (((url: string, init?: RequestInit) => {
      captured = init?.headers;
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as typeof fetch);
    await requestJsonWithFallback({ urls: ['/api/fs/file?path=x'], fallbackError: 'fail' });
    const headers = new Headers(captured);
    assert.equal(headers.get('Authorization'), 'Bearer secret-abc');
  } finally {
    globalThis.fetch = originalFetch;
    clearFakeWindow();
  }
});

test('buildApiCandidates produces both api-prefixed and bare relative paths', () => {
  const candidates = buildApiCandidates('/file?path=x');
  assert.ok(candidates.includes('/api/file?path=x'));
  assert.ok(candidates.includes('/file?path=x'));
});
