export class HttpRequestError extends Error {
  readonly status?: number;
  readonly url?: string;
  readonly payload?: unknown;

  constructor(message: string, options: { status?: number; url?: string; payload?: unknown } = {}) {
    super(message);
    this.name = 'HttpRequestError';
    this.status = options.status;
    this.url = options.url;
    this.payload = options.payload;
  }
}

function toObject(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  return payload as Record<string, unknown>;
}

function parseErrorMessage(payload: unknown, status: number): string {
  const record = toObject(payload);
  if (record) {
    const errorText = typeof record.error === 'string' ? record.error.trim() : '';
    const messageText = typeof record.message === 'string' ? record.message.trim() : '';

    const duplicateList = Array.isArray(record.duplicates)
      ? record.duplicates
          .map((item) => toObject(item))
          .filter((item): item is Record<string, unknown> => Boolean(item))
          .slice(0, 3)
          .map((item) => {
            const id = typeof item.id === 'number' ? `#${item.id}` : null;
            const name = typeof item.name === 'string' ? item.name.trim() : '';
            if (id && name) return `${id} ${name}`;
            return id ?? name;
          })
          .filter(Boolean)
      : [];

    const duplicateSuffix = duplicateList.length > 0 ? ` Similar tasks: ${duplicateList.join(' • ')}` : '';
    if (errorText && messageText) {
      return `${errorText}: ${messageText}${duplicateSuffix}`;
    }

    if (errorText) {
      return `${errorText}${duplicateSuffix}`;
    }

    if (messageText) {
      return `${messageText}${duplicateSuffix}`;
    }
  }

  return `Request failed with status ${status}.`;
}

export function toErrorMessage(error: unknown, fallback = 'Request failed.'): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpRequestError('Server returned invalid JSON.');
  }
}

function normalizeBase(base: string): string {
  return base.trim().replace(/\/+$/, '');
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

export function buildApiCandidates(path: string, apiBase = ''): string[] {
  const normalizedPath = normalizePath(path);
  const base = normalizeBase(apiBase);
  const apiPath = normalizedPath.startsWith('/api/') ? normalizedPath : `/api${normalizedPath}`;

  if (!base) {
    return Array.from(new Set([apiPath, normalizedPath]));
  }

  return Array.from(new Set([`${base}${apiPath}`, `${base}${normalizedPath}`]));
}

interface RequestJsonWithFallbackOptions {
  urls: string[];
  init?: RequestInit;
  continueOnStatuses?: number[];
  fallbackError?: string;
}

export async function requestJsonWithFallback<T = unknown>({
  urls,
  init,
  continueOnStatuses = [404],
  fallbackError = 'Unable to reach endpoint.',
}: RequestJsonWithFallbackOptions): Promise<T> {
  let lastError: Error | null = null;

  for (const url of urls) {
    try {
      const response = await fetch(url, init);
      if (continueOnStatuses.includes(response.status)) {
        continue;
      }

      const payload = await parseJson(response);
      if (!response.ok) {
        // Throw immediately for definitive HTTP errors (401, 403, etc.) instead of
        // retrying fallback URLs which may return HTML and mask the real error.
        const httpError = new HttpRequestError(parseErrorMessage(payload, response.status), {
          status: response.status,
          url,
          payload,
        });
        if (response.status === 401 || response.status === 403 || response.status >= 500) {
          throw httpError;
        }
        lastError = httpError;
        continue;
      }

      return payload as T;
    } catch (error) {
      if (error instanceof HttpRequestError && error.status && (error.status === 401 || error.status === 403 || error.status >= 500)) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(fallbackError);
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new HttpRequestError(fallbackError);
}
