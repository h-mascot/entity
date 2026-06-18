const STATIC_CACHE = 'entity-static-v4';
const RUNTIME_CACHE = 'entity-runtime-v4';
const OFFLINE_DB_NAME = 'entity.offline.v1';
const OFFLINE_DB_VERSION = 1;
const WRITE_QUEUE_STORE = 'write-queue';
const BUILD_HASH_HEADER = 'X-Entity-Build-Hash';
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/register-sw.js',
  '/entity-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

let dbPromise = null;
let lastNotifiedBuildHash = '';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name !== STATIC_CACHE && name !== RUNTIME_CACHE)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error || new Error('IndexedDB request failed.')), { once: true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error || new Error('IndexedDB transaction aborted.')), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error || new Error('IndexedDB transaction failed.')), { once: true });
  });
}

function openOfflineDb() {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);

    request.addEventListener('upgradeneeded', () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WRITE_QUEUE_STORE)) {
        db.createObjectStore(WRITE_QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
      }
    });

    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error || new Error('Failed to open offline database.')), { once: true });
  });

  return dbPromise;
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach((client) => {
    client.postMessage(message);
  });
}

function isSameOrigin(urlValue) {
  try {
    const url = new URL(urlValue);
    return url.origin === self.location.origin;
  } catch {
    return false;
  }
}

function isLocalNetworkHostname(hostname) {
  const normalized = String(hostname || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized.startsWith('localhost.') ||
    normalized.startsWith('127.') ||
    normalized.startsWith('100.')
  );
}

function shouldPreferNetwork() {
  return isLocalNetworkHostname(self.location.hostname);
}

function isWriteMethod(method) {
  return WRITE_METHODS.has(String(method || '').toUpperCase());
}

function normalizeApiPath(pathname) {
  if (pathname === '/api') {
    return '/';
  }
  if (pathname.startsWith('/api/')) {
    return pathname.slice(4);
  }
  return pathname;
}

function isQueueableApiWrite(url, method) {
  return isWriteMethod(method) && url.pathname.startsWith('/api/');
}

function isApiTasksGet(url, method) {
  if (String(method || '').toUpperCase() !== 'GET') {
    return false;
  }
  return (
    url.pathname === '/api/tasks' ||
    url.pathname === '/api/tasks/' ||
    url.pathname === '/tasks' ||
    url.pathname === '/tasks/'
  );
}

function isApiChatGet(url, method) {
  if (String(method || '').toUpperCase() !== 'GET') {
    return false;
  }

  const normalizedPath = normalizeApiPath(url.pathname);
  return (
    normalizedPath === '/chat/channels' ||
    normalizedPath === '/chat/categories' ||
    normalizedPath === '/chat/messages'
  );
}

async function queueWriteRequest(request) {
  const method = request.method.toUpperCase();
  const headers = Array.from(request.headers.entries());
  const bodyText = method === 'GET' || method === 'HEAD' ? null : await request.clone().text().catch(() => null);
  const createdAt = new Date().toISOString();

  const db = await openOfflineDb();
  const transaction = db.transaction(WRITE_QUEUE_STORE, 'readwrite');
  const store = transaction.objectStore(WRITE_QUEUE_STORE);
  const addRequest = store.add({
    url: request.url,
    method,
    headers,
    bodyText,
    createdAt,
  });
  const queueKey = await requestAsPromise(addRequest);
  const queueId = Number(queueKey);

  let optimisticTaskId;
  try {
    const url = new URL(request.url);
    const normalizedPath = normalizeApiPath(url.pathname);
    if (method === 'POST' && normalizedPath === '/tasks') {
      optimisticTaskId = -queueId;
      store.put({
        id: queueId,
        url: request.url,
        method,
        headers,
        bodyText,
        createdAt,
        optimisticTaskId,
      });
    }
  } catch {
    // Ignore URL parse errors.
  }

  await transactionDone(transaction);
  await notifyClients({ type: 'ENTITY_OFFLINE_QUEUE_CHANGED' });

  return {
    __entityOfflineQueued: true,
    queued: true,
    queueId,
    queuedAt: createdAt,
    method,
    url: request.url,
  };
}

async function maybeNotifyBuildHashChange(cachedResponse, networkResponse) {
  if (!networkResponse || !networkResponse.ok) {
    return;
  }

  const latestHash = networkResponse.headers.get(BUILD_HASH_HEADER);
  const previousHash = cachedResponse ? cachedResponse.headers.get(BUILD_HASH_HEADER) : null;
  if (!latestHash || !previousHash || latestHash === previousHash) {
    return;
  }

  if (lastNotifiedBuildHash === latestHash) {
    return;
  }
  lastNotifiedBuildHash = latestHash;

  await notifyClients({
    type: 'ENTITY_BUILD_HASH_CHANGED',
    previousHash,
    latestHash,
  });
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    const staticCache = await caches.open(STATIC_CACHE);
    return staticCache.match('/index.html');
  }
}

async function networkFirstApiTasks(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cachedResponse = await cache.match(request);

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      await maybeNotifyBuildHashChange(cachedResponse, networkResponse);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    if (cachedResponse) {
      return cachedResponse;
    }

    return new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function networkFirstApi(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cachedResponse = await cache.match(request);

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    if (cachedResponse) {
      return cachedResponse;
    }

    return new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cachedResponse = await cache.match(request);
  const networkFetch = fetch(request)
    .then((networkResponse) => {
      if (networkResponse && networkResponse.ok) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(() => null);

  if (cachedResponse) {
    return cachedResponse;
  }

  const networkResponse = await networkFetch;
  if (networkResponse) {
    return networkResponse;
  }

  return new Response('Offline', { status: 503, statusText: 'Offline' });
}

async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function handleApiWrite(request) {
  try {
    return await fetch(request);
  } catch {
    const queuedPayload = await queueWriteRequest(request);
    return new Response(JSON.stringify(queuedPayload), {
      status: 202,
      headers: {
        'Content-Type': 'application/json',
        'X-Entity-Offline-Queued': '1',
      },
    });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!isSameOrigin(request.url)) {
    return;
  }

  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (isApiTasksGet(url, method)) {
    event.respondWith(networkFirstApiTasks(request));
    return;
  }

  if (isApiChatGet(url, method)) {
    event.respondWith(networkFirstApi(request));
    return;
  }

  if (url.pathname.startsWith('/api/') && isQueueableApiWrite(url, method)) {
    event.respondWith(handleApiWrite(request));
    return;
  }

  if (method !== 'GET') {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'worker' ||
    request.destination === 'document'
  ) {
    if (shouldPreferNetwork()) {
      event.respondWith(networkFirst(request));
      return;
    }
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (request.destination === 'image' || request.destination === 'font') {
    if (shouldPreferNetwork()) {
      event.respondWith(networkFirst(request));
      return;
    }
    event.respondWith(cacheFirst(request));
  }
});
