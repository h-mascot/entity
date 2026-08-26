import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useFileSources } from './useFileSources.ts';

const API_BASE = 'https://entity.test';
const API_TOKEN = 'secret-abc';
const FILE_CACHE_KEY = '/fs/file?sourceId=protected&path=secret.md';

type CacheEntry = {
  key: string;
  payload: unknown;
  updatedAt: number;
};

class FakeRequest<T = unknown> {
  result!: T;
  error: Error | null = null;
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  addEventListener(type: string, listener: (event: unknown) => void, options?: { once?: boolean }): void {
    const wrapped = options?.once
      ? (event: unknown) => {
          listener(event);
          this.listeners.get(type)?.delete(wrapped);
        }
      : listener;
    const listeners = this.listeners.get(type) ?? new Set<(event: unknown) => void>();
    listeners.add(wrapped);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener({ target: this });
    }
  }
}

class FakeTransaction {
  private readonly listeners = new Map<string, Set<() => void>>();
  readonly store: FakeObjectStore;

  constructor(entries: Map<string, CacheEntry>, getCounts: Map<string, number>) {
    this.store = new FakeObjectStore(entries, getCounts, this);
  }

  objectStore(): FakeObjectStore {
    return this.store;
  }

  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void {
    const wrapped = options?.once
      ? () => {
          listener();
          this.listeners.get(type)?.delete(wrapped);
        }
      : listener;
    const listeners = this.listeners.get(type) ?? new Set<() => void>();
    listeners.add(wrapped);
    this.listeners.set(type, listeners);
  }

  complete(): void {
    for (const listener of [...(this.listeners.get('complete') ?? [])]) {
      listener();
    }
  }
}

class FakeObjectStore {
  constructor(
    private readonly entries: Map<string, CacheEntry>,
    private readonly getCounts: Map<string, number>,
    private readonly transaction: FakeTransaction,
  ) {}

  put(value: CacheEntry): void {
    this.entries.set(value.key, value);
    queueMicrotask(() => this.transaction.complete());
  }

  get(key: string): FakeRequest<CacheEntry | undefined> {
    this.getCounts.set(key, (this.getCounts.get(key) ?? 0) + 1);
    const request = new FakeRequest<CacheEntry | undefined>();
    queueMicrotask(() => {
      request.result = this.entries.get(key);
      request.dispatch('success');
    });
    return request;
  }
}

class FakeDatabase {
  readonly objectStoreNames = { contains: () => true };

  constructor(
    private readonly entries: Map<string, CacheEntry>,
    private readonly getCounts: Map<string, number>,
  ) {}

  createObjectStore(): FakeObjectStore {
    return new FakeObjectStore(this.entries, this.getCounts, new FakeTransaction(this.entries, this.getCounts));
  }

  transaction(): FakeTransaction {
    return new FakeTransaction(this.entries, this.getCounts);
  }
}

class FakeIndexedDb {
  private readonly database: FakeDatabase;

  constructor(entries: Map<string, CacheEntry>, getCounts: Map<string, number>) {
    this.database = new FakeDatabase(entries, getCounts);
  }

  open(): FakeRequest<FakeDatabase> {
    const request = new FakeRequest<FakeDatabase>();
    queueMicrotask(() => {
      request.result = this.database;
      request.dispatch('upgradeneeded');
      request.dispatch('success');
    });
    return request;
  }
}

const cacheEntries = new Map<string, CacheEntry>();
const cacheGetCounts = new Map<string, number>();
Object.defineProperty(globalThis, 'indexedDB', {
  configurable: true,
  value: new FakeIndexedDb(cacheEntries, cacheGetCounts),
});

type HookApi = ReturnType<typeof useFileSources>;
let currentHook: HookApi | null = null;

function HookProbe({ enabled = false }: { enabled?: boolean }) {
  currentHook = useFileSources({ apiBase: API_BASE, enabled });
  return null;
}

function renderHook(enabled = false): HookApi {
  currentHook = null;
  renderToStaticMarkup(React.createElement(HookProbe, { enabled }));
  assert.ok(currentHook, 'hook probe must expose the real hook API');
  return currentHook;
}

function installWindow(): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { origin: API_BASE },
      localStorage: {
        getItem: (key: string) => (key === 'entity-api-token' ? API_TOKEN : null),
      },
    },
  });
}

function clearWindow(): void {
  delete (globalThis as { window?: unknown }).window;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function resetCache(): void {
  cacheEntries.clear();
  cacheGetCounts.clear();
}

function seedCachedFile(): void {
  cacheEntries.set(FILE_CACHE_KEY, {
    key: FILE_CACHE_KEY,
    payload: { sourceId: 'protected', path: 'secret.md', content: 'PRIVATE CACHED CONTENT' },
    updatedAt: Date.now() - 1_000,
  });
}

function headersOf(init: RequestInit | undefined): Headers {
  return new Headers(init?.headers);
}

test('useFileSources attaches the bearer token to every file-source request and preserves caller headers', async () => {
  installWindow();
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('/sources?') || url.endsWith('/api/sources') || url.endsWith('/sources/source-1') || url.includes('/sources/source-1/enabled')) {
      return jsonResponse({ id: 'source-1', displayName: 'Source', type: 'local', enabled: true });
    }
    if (url.includes('/sources/source-1/test')) {
      return jsonResponse({ status: 'ok', message: 'healthy' });
    }
    if (url.includes('/sources/source-1/sync')) {
      return jsonResponse({ sourceId: 'source-1', status: 'ok', latestSyncRun: null });
    }
    if (url.includes('/fs/tree')) {
      return jsonResponse({ sourceId: 'source-1', path: '', nodes: [] });
    }
    if (url.includes('/fs/file') && init?.method === 'GET') {
      return jsonResponse({ sourceId: 'source-1', path: 'guide.md', content: 'hello' });
    }
    if (url.includes('/fs/file')) {
      return jsonResponse({ sourceId: 'source-1', path: 'guide.md', updatedAt: null });
    }
    if (url.includes('/fs/folder')) {
      return jsonResponse({ sourceId: 'source-1', path: 'docs' });
    }
    if (url.includes('/fs/search')) {
      return jsonResponse({ results: [] });
    }
    if (init?.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected test URL: ${url}`);
  }) as typeof fetch;

  try {
    const hook = renderHook();
    await hook.createSource({ displayName: 'Source', type: 'local', basePath: '/workspace' });
    await hook.updateSource('source-1', { displayName: 'Renamed' });
    await hook.setSourceEnabled('source-1', false);
    await hook.deleteSource('source-1');
    await hook.testSource('source-1');
    await hook.syncSource('source-1');
    await hook.fetchTree('source-1');
    await hook.fetchFile('source-1', 'guide.md');
    await hook.createFile('source-1', 'guide.md', 'hello');
    await hook.writeFile('source-1', 'guide.md', 'updated');
    await hook.createFolder('source-1', 'docs');
    await hook.searchFiles('guide');

    assert.ok(calls.length >= 12, `expected all hook request paths to execute, got ${calls.length}`);
    for (const call of calls) {
      assert.equal(
        headersOf(call.init).get('authorization'),
        `Bearer ${API_TOKEN}`,
        `missing bearer token on ${call.init?.method ?? 'GET'} ${call.url}`,
      );
    }
    const createCall = calls.find((call) => call.url.endsWith('/api/sources') && call.init?.method === 'POST');
    assert.ok(createCall, 'createSource must issue its POST through the hook request path');
    assert.equal(headersOf(createCall.init).get('content-type'), 'application/json');
  } finally {
    globalThis.fetch = originalFetch;
    clearWindow();
  }
});

test('useFileSources never reads or serves cached file content after a non-cache-eligible HTTP status', async () => {
  installWindow();
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [400, 401, 403, 404, 409, 429]) {
      resetCache();
      seedCachedFile();
      globalThis.fetch = (async () => jsonResponse({ error: 'denied' }, status)) as typeof fetch;
      const hook = renderHook();

      await assert.rejects(
        () => hook.fetchFile('protected', 'secret.md'),
        /Request failed \(\d+\)/,
        `${status} must remain an error rather than serving cached content`,
      );
      assert.equal(
        cacheGetCounts.get(FILE_CACHE_KEY) ?? 0,
        0,
        `${status} must not even read the cached protected file entry`,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
    clearWindow();
  }
});

test('useFileSources retains offline cache fallback for network and server-transient failures', async () => {
  installWindow();
  const originalFetch = globalThis.fetch;
  try {
    for (const failure of ['network', 500, 503] as const) {
      resetCache();
      seedCachedFile();
      globalThis.fetch = (async () => {
        if (failure === 'network') throw new TypeError('Failed to fetch');
        return jsonResponse({ error: 'server unavailable' }, failure);
      }) as typeof fetch;
      const result = await renderHook().fetchFile('protected', 'secret.md');

      assert.equal(result.content, 'PRIVATE CACHED CONTENT');
      assert.equal(result.cached, true);
      assert.equal(cacheGetCounts.get(FILE_CACHE_KEY), 1, `${failure} should consult the offline cache once`);
    }
  } finally {
    globalThis.fetch = originalFetch;
    clearWindow();
  }
});

test.after(() => {
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
  clearWindow();
});
