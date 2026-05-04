const OFFLINE_DB_NAME = 'entity.offline.v1';
const OFFLINE_DB_VERSION = 1;
const API_CACHE_STORE = 'api-cache';
const WRITE_QUEUE_STORE = 'write-queue';
const TASKS_CACHE_KEY = '/tasks';
const REPLAY_INTERVAL_MS = 30_000;
const OFFLINE_META_PREFIX = '__entity_meta__:';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const OFFLINE_QUEUE_STATUS_EVENT = 'entity:offline-queue-status';
export const OFFLINE_QUEUE_DRAINED_EVENT = 'entity:offline-queue-drained';

interface ApiCacheEntry {
  key: string;
  payload: unknown;
  updatedAt: number;
}

interface QueuedWriteEntry {
  id?: number;
  url: string;
  method: string;
  headers: Array<[string, string]>;
  bodyText: string | null;
  createdAt: string;
  optimisticTaskId?: number;
}

type JsonRecord = Record<string, unknown>;

export interface OfflineQueuedResponsePayload {
  __entityOfflineQueued: true;
  queued: true;
  queueId: number;
  queuedAt: string;
  method: string;
  url: string;
}

export interface OfflineQueueSnapshotItem {
  id: number;
  url: string;
  method: string;
  createdAt: string;
  optimisticTaskId?: number;
}

export interface OfflineCachedPayloadEntry<T = unknown> {
  key: string;
  payload: T;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;
let offlineSupportInitialized = false;
let replayInFlight = false;
let nativeFetch: typeof window.fetch | null = null;

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed.')), { once: true });
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.')), {
      once: true,
    });
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB transaction failed.')), {
      once: true,
    });
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeApiPath(pathname: string): string {
  if (pathname === '/api') {
    return '/';
  }

  if (pathname.startsWith('/api/')) {
    return pathname.slice(4);
  }

  return pathname;
}

function supportsOfflineResource(pathname: string): boolean {
  return (
    pathname === '/tasks' ||
    pathname.startsWith('/tasks/') ||
    pathname === '/fs/file' ||
    pathname === '/fs/tree' ||
    pathname === '/documents' ||
    pathname.startsWith('/documents/') ||
    pathname === '/docs' ||
    pathname.startsWith('/docs/')
  );
}

function resolveUrl(url: string): URL | null {
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    return new URL(url, base);
  } catch {
    return null;
  }
}

function isLocalNetworkHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return normalized === 'localhost' || normalized.startsWith('localhost.') || normalized.startsWith('100.');
}

function shouldPreferNetwork(url: string): boolean {
  const parsed = resolveUrl(url);
  if (!parsed) {
    return false;
  }

  return isLocalNetworkHostname(parsed.hostname);
}

function toCacheKey(url: string): string | null {
  const parsed = resolveUrl(url);
  if (!parsed) {
    return null;
  }

  const normalizedPath = normalizeApiPath(parsed.pathname);
  if (!supportsOfflineResource(normalizedPath)) {
    return null;
  }

  return `${normalizedPath}${parsed.search}`;
}

function buildJsonResponse(payload: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return new Response(JSON.stringify(payload), { status, headers });
}

function isAbortError(error: unknown): boolean {
  return Boolean(error) && typeof error === 'object' && (error as { name?: string }).name === 'AbortError';
}

function isWriteMethod(method: string): boolean {
  return WRITE_METHODS.has(method.toUpperCase());
}

function isTaskCollectionPath(pathname: string): boolean {
  return pathname === '/tasks';
}

function extractTaskId(pathname: string): number | null {
  const match = pathname.match(/^\/tasks\/(-?\d+)(?:\/|$)/);
  if (!match) {
    return null;
  }

  const taskId = Number(match[1]);
  return Number.isFinite(taskId) ? taskId : null;
}

function parseBodyJson(bodyText: string | null): JsonRecord | null {
  if (!bodyText || !bodyText.trim()) {
    return null;
  }

  try {
    const payload = JSON.parse(bodyText) as unknown;
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

function nowIsoString(): string {
  return new Date().toISOString();
}

function readString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function readBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
      return false;
    }
  }

  return fallback;
}

function buildOfflineTask(body: JsonRecord | null, id: number): JsonRecord {
  const now = nowIsoString();
  const dueAt = readOptionalString(body?.due_date) ?? readOptionalString(body?.due_at);
  return {
    id,
    name: readString(body?.name, 'Offline Task'),
    description: readOptionalString(body?.description),
    column: readString(body?.column, 'backlog'),
    assignee: readString(body?.assignee, 'Unassigned'),
    model: readOptionalString(body?.model),
    archived: readBoolean(body?.archived, false),
    priority: readString(body?.priority, 'P2'),
    project: readString(body?.project, 'General'),
    blocked: readBoolean(body?.blocked, false),
    blocker_reason: readOptionalString(body?.blocker_reason),
    due_at: dueAt,
    recurring: readBoolean(body?.recurring, false),
    metadata: typeof body?.metadata === 'string' ? body.metadata : null,
    created_at: now,
    updated_at: now,
  };
}

function mergeTask(baseTask: JsonRecord, patch: JsonRecord | null, taskId: number): JsonRecord {
  if (!patch) {
    return {
      ...baseTask,
      id: taskId,
      updated_at: nowIsoString(),
    };
  }

  return {
    ...baseTask,
    ...patch,
    id: taskId,
    updated_at: nowIsoString(),
  };
}

function extractTasksPayload(payload: unknown): { tasks: JsonRecord[]; asArray: boolean } {
  if (Array.isArray(payload)) {
    return {
      tasks: payload.filter((item): item is JsonRecord => isRecord(item)),
      asArray: true,
    };
  }

  if (isRecord(payload) && Array.isArray(payload.tasks)) {
    return {
      tasks: payload.tasks.filter((item): item is JsonRecord => isRecord(item)),
      asArray: false,
    };
  }

  return {
    tasks: [],
    asArray: false,
  };
}

function toTasksPayload(tasks: JsonRecord[], asArray: boolean, originalPayload: unknown): unknown {
  if (asArray) {
    return tasks;
  }

  if (isRecord(originalPayload)) {
    return { ...originalPayload, tasks };
  }

  return { tasks };
}

async function openOfflineDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB unavailable.');
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);

      request.addEventListener('upgradeneeded', () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(API_CACHE_STORE)) {
          db.createObjectStore(API_CACHE_STORE, { keyPath: 'key' });
        }

        if (!db.objectStoreNames.contains(WRITE_QUEUE_STORE)) {
          db.createObjectStore(WRITE_QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
        }
      });

      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error ?? new Error('Failed to open offline database.')), {
        once: true,
      });
    });
  }

  return dbPromise;
}

function shouldCacheReadRequest(request: Request): boolean {
  if (request.method.toUpperCase() !== 'GET') {
    return false;
  }

  return toCacheKey(request.url) !== null;
}

function shouldQueueWriteRequest(request: Request): boolean {
  const method = request.method.toUpperCase();
  if (!isWriteMethod(method)) {
    return false;
  }

  return toCacheKey(request.url) !== null;
}

async function putApiCacheByKey(key: string, payload: unknown): Promise<void> {
  const db = await openOfflineDb();
  const transaction = db.transaction(API_CACHE_STORE, 'readwrite');
  const store = transaction.objectStore(API_CACHE_STORE);
  store.put({ key, payload, updatedAt: Date.now() } satisfies ApiCacheEntry);
  await transactionDone(transaction);
}

async function loadApiCacheEntries(keys: string[]): Promise<ApiCacheEntry[]> {
  if (keys.length === 0) {
    return [];
  }

  const db = await openOfflineDb();
  const transaction = db.transaction(API_CACHE_STORE, 'readonly');
  const store = transaction.objectStore(API_CACHE_STORE);
  const lookups = keys.map(async (key) => {
    const request = store.get(key) as IDBRequest<ApiCacheEntry | undefined>;
    return (await requestAsPromise(request)) ?? null;
  });
  const entries = await Promise.all(lookups);
  return entries.filter((entry): entry is ApiCacheEntry => entry !== null);
}

async function putTaskListPayload(payload: unknown): Promise<void> {
  await putApiCacheByKey(TASKS_CACHE_KEY, payload);
}

async function mutateTasksCache(
  mutator: (tasks: JsonRecord[], originalPayload: unknown) => { tasks: JsonRecord[]; originalPayload?: unknown }
): Promise<void> {
  const existingPayload = await readCachedApiPayload(['/api/tasks', '/tasks']);
  const parsed = extractTasksPayload(existingPayload);
  const mutation = mutator([...parsed.tasks], existingPayload);
  const resolvedOriginalPayload = typeof mutation.originalPayload === 'undefined' ? existingPayload : mutation.originalPayload;
  const nextPayload = toTasksPayload(mutation.tasks, parsed.asArray, resolvedOriginalPayload);
  await putTaskListPayload(nextPayload);
}

async function applyTaskMutation(
  requestUrl: string,
  method: string,
  bodyText: string | null,
  responsePayload: unknown,
  queueEntry?: QueuedWriteEntry
): Promise<void> {
  const parsed = resolveUrl(requestUrl);
  if (!parsed) {
    return;
  }

  const normalizedPath = normalizeApiPath(parsed.pathname);
  if (!normalizedPath.startsWith('/tasks')) {
    return;
  }

  const normalizedMethod = method.toUpperCase();
  const bodyRecord = parseBodyJson(bodyText);
  const responseRecord = isRecord(responsePayload) ? responsePayload : null;

  if (normalizedMethod === 'POST' && isTaskCollectionPath(normalizedPath)) {
    await mutateTasksCache((tasks) => {
      const optimisticId = queueEntry?.optimisticTaskId;
      const queuedTask = buildOfflineTask(bodyRecord, optimisticId ?? -Date.now());
      const nextTask = responseRecord ?? queuedTask;
      const nextTasks = [...tasks];

      if (typeof optimisticId === 'number') {
        const optimisticIndex = nextTasks.findIndex((task) => Number(task.id) === optimisticId);
        if (optimisticIndex >= 0) {
          nextTasks[optimisticIndex] = nextTask;
          return { tasks: nextTasks };
        }
      }

      const responseId = Number((nextTask as JsonRecord).id);
      if (Number.isFinite(responseId)) {
        const existingIndex = nextTasks.findIndex((task) => Number(task.id) === responseId);
        if (existingIndex >= 0) {
          nextTasks[existingIndex] = nextTask;
          return { tasks: nextTasks };
        }
      }

      nextTasks.unshift(nextTask);
      return { tasks: nextTasks };
    });
    return;
  }

  if (normalizedMethod === 'DELETE') {
    const taskId = extractTaskId(normalizedPath);
    if (taskId === null) {
      return;
    }

    await mutateTasksCache((tasks) => {
      const nextTasks = tasks.filter((task) => Number(task.id) !== taskId);
      return { tasks: nextTasks };
    });
    return;
  }

  if (normalizedMethod === 'PUT' || normalizedMethod === 'PATCH') {
    const taskId = extractTaskId(normalizedPath);
    if (taskId === null) {
      return;
    }

    await mutateTasksCache((tasks) => {
      const nextTasks = [...tasks];
      const index = nextTasks.findIndex((task) => Number(task.id) === taskId);
      const existing = index >= 0 ? nextTasks[index] : buildOfflineTask({ name: `Task #${taskId}` }, taskId);
      const nextTask = responseRecord ?? mergeTask(existing, bodyRecord, taskId);

      if (index >= 0) {
        nextTasks[index] = nextTask;
      } else {
        nextTasks.unshift(nextTask);
      }

      return { tasks: nextTasks };
    });
  }
}

async function getQueueEntries(): Promise<QueuedWriteEntry[]> {
  const db = await openOfflineDb();
  const transaction = db.transaction(WRITE_QUEUE_STORE, 'readonly');
  const store = transaction.objectStore(WRITE_QUEUE_STORE);
  const request = store.getAll() as IDBRequest<QueuedWriteEntry[]>;
  const entries = await requestAsPromise(request);
  return entries.sort((left, right) => (left.id ?? 0) - (right.id ?? 0));
}

async function getQueueCount(): Promise<number> {
  const db = await openOfflineDb();
  const transaction = db.transaction(WRITE_QUEUE_STORE, 'readonly');
  const store = transaction.objectStore(WRITE_QUEUE_STORE);
  const request = store.count();
  return requestAsPromise(request);
}

async function deleteQueueEntry(id: number): Promise<void> {
  const db = await openOfflineDb();
  const transaction = db.transaction(WRITE_QUEUE_STORE, 'readwrite');
  const store = transaction.objectStore(WRITE_QUEUE_STORE);
  store.delete(id);
  await transactionDone(transaction);
}

function emitQueueStatus(pending: number): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(OFFLINE_QUEUE_STATUS_EVENT, {
      detail: {
        pending,
      },
    })
  );
}

function emitQueueDrained(applied: number): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(OFFLINE_QUEUE_DRAINED_EVENT, {
      detail: {
        at: nowIsoString(),
        applied,
      },
    })
  );
}

async function publishQueueStatus(): Promise<void> {
  try {
    const pending = await getQueueCount();
    emitQueueStatus(pending);
  } catch {
    emitQueueStatus(0);
  }
}

async function parseResponseJson(response: Response): Promise<unknown | null> {
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return null;
  }

  try {
    return (await response.clone().json()) as unknown;
  } catch {
    return null;
  }
}

async function cacheReadResponse(request: Request, response: Response): Promise<void> {
  if (!response.ok || !shouldCacheReadRequest(request)) {
    return;
  }

  const payload = await parseResponseJson(response);
  if (payload === null) {
    return;
  }

  const cacheKey = toCacheKey(request.url);
  if (!cacheKey) {
    return;
  }

  try {
    await putApiCacheByKey(cacheKey, payload);
  } catch {
    // Ignore cache write errors.
  }
}

async function queueWriteRequest(request: Request): Promise<OfflineQueuedResponsePayload> {
  const method = request.method.toUpperCase();
  const headers = Array.from(request.headers.entries());
  const bodyText = method === 'GET' || method === 'HEAD' ? null : await request.clone().text().catch(() => null);
  const createdAt = nowIsoString();

  const db = await openOfflineDb();
  const transaction = db.transaction(WRITE_QUEUE_STORE, 'readwrite');
  const store = transaction.objectStore(WRITE_QUEUE_STORE);
  const addRequest = store.add({
    url: request.url,
    method,
    headers,
    bodyText,
    createdAt,
  } satisfies QueuedWriteEntry);
  const queueKey = await requestAsPromise(addRequest);
  const queueId = Number(queueKey);
  const cacheKey = toCacheKey(request.url);

  let optimisticTaskId: number | undefined;
  if (cacheKey) {
    const parsed = resolveUrl(request.url);
    if (parsed) {
      const normalizedPath = normalizeApiPath(parsed.pathname);
      if (method === 'POST' && isTaskCollectionPath(normalizedPath)) {
        optimisticTaskId = -queueId;
      }
    }
  }

  if (typeof optimisticTaskId === 'number') {
    store.put({
      id: queueId,
      url: request.url,
      method,
      headers,
      bodyText,
      createdAt,
      optimisticTaskId,
    } satisfies QueuedWriteEntry);
  }

  await transactionDone(transaction);

  if (cacheKey) {
    try {
      await applyTaskMutation(
        request.url,
        method,
        bodyText,
        null,
        typeof optimisticTaskId === 'number' ? { id: queueId, url: request.url, method, headers, bodyText, createdAt, optimisticTaskId } : undefined
      );
    } catch {
      // Ignore optimistic cache update errors.
    }
  }

  await publishQueueStatus();

  return {
    __entityOfflineQueued: true,
    queued: true,
    queueId,
    queuedAt: createdAt,
    method,
    url: request.url,
  };
}

async function loadCachedResponse(request: Request): Promise<Response | null> {
  const cachedEntry = await readCachedApiPayloadEntry([request.url]);
  if (!cachedEntry) {
    return null;
  }

  const ageMs = Math.max(0, Date.now() - cachedEntry.updatedAt);
  return buildJsonResponse(cachedEntry.payload, 200, {
    'X-Entity-Offline-Cache': 'HIT',
    'X-Entity-Offline-Cache-Updated-At': new Date(cachedEntry.updatedAt).toISOString(),
    'X-Entity-Offline-Cache-Age-Ms': String(ageMs),
  });
}

function getNativeFetch(): typeof window.fetch {
  if (nativeFetch) {
    return nativeFetch;
  }

  return window.fetch.bind(window);
}

function installFetchInterceptor(): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (!nativeFetch) {
    nativeFetch = window.fetch.bind(window);
  }

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request && !init ? input : new Request(input, init);
    const method = request.method.toUpperCase();
    const cacheableRead = shouldCacheReadRequest(request);
    const queueableWrite = shouldQueueWriteRequest(request);
    const preferNetwork = shouldPreferNetwork(request.url);
    const readFromCacheFirst = cacheableRead && !preferNetwork && typeof navigator !== 'undefined' && !navigator.onLine;
    const shouldQueueNow = queueableWrite && !preferNetwork && typeof navigator !== 'undefined' && !navigator.onLine;

    if (readFromCacheFirst) {
      const cachedResponse = await loadCachedResponse(request);
      if (cachedResponse) {
        return cachedResponse;
      }
    }

    if (shouldQueueNow) {
      const queuedPayload = await queueWriteRequest(request);
      return buildJsonResponse(queuedPayload, 202, {
        'X-Entity-Offline-Queued': '1',
      });
    }

    try {
      let bodyText: string | null = null;
      let fetchInput: RequestInfo | URL = input;
      let fetchInit: RequestInit | undefined = init;

      if (queueableWrite && method !== 'GET' && method !== 'HEAD') {
        bodyText = await request.clone().text().catch(() => null);
        // Sentry's fetch interceptor consumes Request objects.
        // We pass a URL and reconstructed init to prevent stream-locking errors.
        fetchInput = request.url;
        fetchInit = {
          method: request.method,
          headers: request.headers,
          body: bodyText,
          credentials: request.credentials,
          mode: request.mode,
          cache: request.cache,
          redirect: request.redirect,
        };
      }

      const response = await getNativeFetch()(fetchInput, fetchInit);
      if (cacheableRead) {
        void cacheReadResponse(request, response);
      }

      if (queueableWrite && response.ok) {
        const responsePayload = await parseResponseJson(response);
        if (isOfflineQueuedResponsePayload(responsePayload)) {
          const parsed = resolveUrl(request.url);
          const normalizedPath = parsed ? normalizeApiPath(parsed.pathname) : '';
          const optimisticTaskId =
            method === 'POST' && normalizedPath === '/tasks' ? -Math.abs(responsePayload.queueId) : undefined;
          const headers = Array.from(request.headers.entries());
          const queueEntry: QueuedWriteEntry | undefined =
            typeof optimisticTaskId === 'number'
              ? {
                  id: responsePayload.queueId,
                  url: request.url,
                  method,
                  headers,
                  bodyText,
                  createdAt: responsePayload.queuedAt,
                  optimisticTaskId,
                }
              : undefined;

          void applyTaskMutation(request.url, method, bodyText, null, queueEntry);
          void publishQueueStatus();
        } else {
          void applyTaskMutation(request.url, method, bodyText, responsePayload);
        }
      }

      return response;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      if (cacheableRead) {
        const cachedResponse = await loadCachedResponse(request);
        if (cachedResponse) {
          return cachedResponse;
        }
      }

      if (queueableWrite) {
        const queuedPayload = await queueWriteRequest(request);
        return buildJsonResponse(queuedPayload, 202, {
          'X-Entity-Offline-Queued': '1',
        });
      }

      throw error;
    }
  }) as typeof window.fetch;
}

async function replayQueuedWritesInternal(): Promise<void> {
  if (typeof window === 'undefined') {
    return;
  }

  if (replayInFlight || !navigator.onLine) {
    return;
  }

  replayInFlight = true;
  let drainedAtLeastOne = false;
  let appliedCount = 0;

  try {
    const entries = await getQueueEntries();
    const fetchImpl = getNativeFetch();

    for (const entry of entries) {
      if (typeof entry.id !== 'number') {
        continue;
      }

      const retryRequest = new Request(entry.url, {
        method: entry.method,
        headers: new Headers(entry.headers),
        body: entry.bodyText ?? undefined,
      });

      let response: Response;
      try {
        response = await fetchImpl(retryRequest);
      } catch {
        break;
      }

      const retryableStatus = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
      if (!response.ok && retryableStatus) {
        break;
      }

      if (response.ok) {
        const payload = await parseResponseJson(response);
        await applyTaskMutation(entry.url, entry.method, entry.bodyText, payload, entry);
        appliedCount += 1;
      }

      await deleteQueueEntry(entry.id);
      drainedAtLeastOne = true;
    }
  } catch {
    // Ignore replay errors and retry later.
  } finally {
    replayInFlight = false;
  }

  await publishQueueStatus();

  if (drainedAtLeastOne) {
    const pending = await getQueueCount().catch(() => 0);
    if (pending === 0) {
      emitQueueDrained(appliedCount);
    }
  }
}

function startReplayLoop(): void {
  if (typeof window === 'undefined') {
    return;
  }

  const handleOnline = () => {
    void replayQueuedWritesInternal();
  };

  window.addEventListener('online', handleOnline);
  window.setInterval(() => {
    void replayQueuedWritesInternal();
  }, REPLAY_INTERVAL_MS);
}

export function isOfflineQueuedResponsePayload(payload: unknown): payload is OfflineQueuedResponsePayload {
  if (!isRecord(payload)) {
    return false;
  }

  return payload.__entityOfflineQueued === true && payload.queued === true && typeof payload.queueId === 'number';
}

export async function cacheApiPayload(url: string, payload: unknown): Promise<void> {
  const key = toCacheKey(url);
  if (!key) {
    return;
  }

  try {
    await putApiCacheByKey(key, payload);
  } catch {
    // Ignore cache errors.
  }
}

export async function readCachedApiPayload(urls: string[]): Promise<unknown | null> {
  const entry = await readCachedApiPayloadEntry(urls);
  return entry?.payload ?? null;
}

export async function readCachedApiPayloadEntry<T = unknown>(urls: string[]): Promise<OfflineCachedPayloadEntry<T> | null> {
  const keys = Array.from(
    new Set(
      urls
        .map((url) => toCacheKey(url))
        .filter((key): key is string => typeof key === 'string' && key.length > 0)
    )
  );

  if (keys.length === 0) {
    return null;
  }

  try {
    const entries = await loadApiCacheEntries(keys);
    if (entries.length === 0) {
      return null;
    }

    entries.sort((left, right) => right.updatedAt - left.updatedAt);
    const latest = entries[0];
    if (!latest) {
      return null;
    }

    return {
      key: latest.key,
      payload: latest.payload as T,
      updatedAt: latest.updatedAt,
    };
  } catch {
    return null;
  }
}

function toMetaCacheKey(key: string): string {
  return `${OFFLINE_META_PREFIX}${key}`;
}

export async function cacheOfflineMetaPayload(key: string, payload: unknown): Promise<void> {
  const normalized = key.trim();
  if (!normalized) {
    return;
  }

  try {
    await putApiCacheByKey(toMetaCacheKey(normalized), payload);
  } catch {
    // Ignore cache errors.
  }
}

export async function readOfflineMetaPayload<T = unknown>(key: string): Promise<OfflineCachedPayloadEntry<T> | null> {
  const normalized = key.trim();
  if (!normalized) {
    return null;
  }

  try {
    const entries = await loadApiCacheEntries([toMetaCacheKey(normalized)]);
    const entry = entries[0];
    if (!entry) {
      return null;
    }

    return {
      key: entry.key,
      payload: entry.payload as T,
      updatedAt: entry.updatedAt,
    };
  } catch {
    return null;
  }
}

export async function readOfflineWriteQueueSnapshot(): Promise<OfflineQueueSnapshotItem[]> {
  const entries = await getQueueEntries();
  return entries
    .filter((entry): entry is QueuedWriteEntry & { id: number } => typeof entry.id === 'number')
    .map((entry) => ({
      id: entry.id,
      url: entry.url,
      method: entry.method,
      createdAt: entry.createdAt,
      optimisticTaskId: entry.optimisticTaskId,
    }));
}

export async function readOfflineWriteQueueCount(): Promise<number> {
  return getQueueCount();
}

export async function replayOfflineWriteQueue(): Promise<void> {
  await replayQueuedWritesInternal();
}

export function initializeOfflineSupport(): void {
  if (typeof window === 'undefined' || offlineSupportInitialized) {
    return;
  }

  offlineSupportInitialized = true;
  installFetchInterceptor();
  startReplayLoop();
  void publishQueueStatus();
  void replayQueuedWritesInternal();
}

export function isOfflineApiUrl(url: string): boolean {
  return toCacheKey(url) !== null;
}
