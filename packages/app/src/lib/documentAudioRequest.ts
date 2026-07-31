export const DOCUMENT_AUDIO_TIMEOUT_MS = 150_000;

export type DocumentAudioRequestFailureKind =
  | 'cancelled'
  | 'network'
  | 'provider'
  | 'provider-missing'
  | 'timeout'
  | 'unsupported';

export interface DocumentAudioRequestBody {
  documentRef?: string;
  text: string;
  provider: string;
  voice?: string;
  model?: string;
}

export interface DocumentAudioRequestResult {
  audioUrl: string;
  chars: number | null;
  truncated: boolean;
  cached: boolean;
}

export class DocumentAudioRequestError extends Error {
  readonly kind: DocumentAudioRequestFailureKind;

  constructor(kind: DocumentAudioRequestFailureKind, message: string) {
    super(message);
    this.name = 'DocumentAudioRequestError';
    this.kind = kind;
  }
}

interface RequestDocumentAudioOptions {
  urls: string[];
  body: DocumentAudioRequestBody;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  init?: RequestInit;
}

interface TtsPayload {
  audioUrl?: unknown;
  chars?: unknown;
  truncated?: unknown;
  cached?: unknown;
  error?: unknown;
  detail?: unknown;
}

function payloadText(payload: TtsPayload | null): string {
  return [payload?.error, payload?.detail]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
}

function classifyResponseFailure(status: number, payload: TtsPayload | null): DocumentAudioRequestError {
  const text = payloadText(payload);

  if (status === 400 && /not configured|configuration|api[_ -]?key|credential/.test(text)) {
    return new DocumentAudioRequestError(
      'provider-missing',
      'This text-to-speech provider is not configured. Open Voice Settings to choose or configure a provider.',
    );
  }

  if (
    status === 400
    && /empty|required|unsupported|unknown provider|invalid/.test(text)
  ) {
    return new DocumentAudioRequestError(
      'unsupported',
      'This document cannot be converted to audio. Check its content or choose another provider, then try again.',
    );
  }

  return new DocumentAudioRequestError(
    'provider',
    'The audio provider could not generate this document. Try again or choose another provider.',
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

export async function requestDocumentAudio({
  urls,
  body,
  signal,
  timeoutMs = DOCUMENT_AUDIO_TIMEOUT_MS,
  fetchImpl = fetch,
  init,
}: RequestDocumentAudioOptions): Promise<DocumentAudioRequestResult> {
  if (urls.length === 0) {
    throw new DocumentAudioRequestError('network', 'The audio service is unavailable. Try again.');
  }

  const requestController = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => requestController.abort();
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  if (signal?.aborted) {
    requestController.abort();
  }
  const timeout = setTimeout(() => {
    timedOut = true;
    requestController.abort();
  }, timeoutMs);

  let lastNetworkError: unknown = null;
  try {
    for (let index = 0; index < urls.length; index += 1) {
      try {
        const response = await fetchImpl(urls[index], {
          ...init,
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...Object.fromEntries(new Headers(init?.headers).entries()),
          },
          body: JSON.stringify(body),
          signal: requestController.signal,
        });
        const payload = (await response.json().catch(() => null)) as TtsPayload | null;

        if (response.status === 404 && index < urls.length - 1) {
          continue;
        }
        if (!response.ok) {
          throw classifyResponseFailure(response.status, payload);
        }
        if (typeof payload?.audioUrl !== 'string' || !payload.audioUrl.trim()) {
          throw new DocumentAudioRequestError(
            'provider',
            'The audio provider returned no playable audio. Try again or choose another provider.',
          );
        }

        return {
          audioUrl: payload.audioUrl.trim(),
          chars: typeof payload.chars === 'number' ? payload.chars : null,
          truncated: Boolean(payload.truncated),
          cached: Boolean(payload.cached),
        };
      } catch (error) {
        if (error instanceof DocumentAudioRequestError || isAbortError(error)) {
          throw error;
        }
        lastNetworkError = error;
        if (index === urls.length - 1) {
          break;
        }
      }
    }
  } catch (error) {
    if (timedOut) {
      throw new DocumentAudioRequestError('timeout', 'Audio generation timed out. Try again.');
    }
    if (signal?.aborted || isAbortError(error)) {
      throw new DocumentAudioRequestError('cancelled', 'Audio generation was cancelled.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }

  if (timedOut) {
    throw new DocumentAudioRequestError('timeout', 'Audio generation timed out. Try again.');
  }
  if (signal?.aborted) {
    throw new DocumentAudioRequestError('cancelled', 'Audio generation was cancelled.');
  }
  void lastNetworkError;
  throw new DocumentAudioRequestError(
    'network',
    'The audio service could not be reached. Check your connection and try again.',
  );
}

export function resolveSafeDocumentAudioUrl(
  rawUrl: string,
  pageOrigin: string,
  apiBase = '',
): string | null {
  const trimmed = rawUrl.trim();
  if (/^data:audio\/[a-z0-9.+-]+;base64,/i.test(trimmed)) {
    return trimmed;
  }

  try {
    const resolved = new URL(trimmed, pageOrigin);
    const allowedOrigins = new Set([new URL(pageOrigin).origin]);
    if (apiBase) {
      allowedOrigins.add(new URL(apiBase, pageOrigin).origin);
    }

    if (
      (resolved.protocol === 'http:' || resolved.protocol === 'https:')
      && allowedOrigins.has(resolved.origin)
    ) {
      return resolved.toString();
    }
    if (resolved.protocol === 'blob:' && allowedOrigins.has(new URL(resolved.pathname).origin)) {
      return resolved.toString();
    }
  } catch {
    return null;
  }

  return null;
}
