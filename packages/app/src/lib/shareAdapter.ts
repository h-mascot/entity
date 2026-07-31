export interface SharePayload {
  title?: string;
  text?: string;
  url?: string;
}

export type CopyResult =
  | { status: 'copied' }
  | { status: 'manual-required'; value: string }
  | { status: 'cancelled' }
  | { status: 'failed'; safeMessage: string };

interface ClipboardWriter {
  writeText: (value: string) => Promise<void>;
}

export interface ShareAdapterEnvironment {
  isSecureContext: boolean;
  clipboard?: ClipboardWriter;
  share?: (payload: SharePayload) => Promise<void>;
}

export interface ShareAdapter {
  copy: (value: string) => Promise<CopyResult>;
  share: (payload: SharePayload) => Promise<CopyResult>;
}

function browserEnvironment(): ShareAdapterEnvironment {
  return {
    isSecureContext: globalThis.isSecureContext === true,
    clipboard: typeof navigator !== 'undefined' ? navigator.clipboard : undefined,
    share: typeof navigator !== 'undefined' && typeof navigator.share === 'function'
      ? (payload) => navigator.share(payload)
      : undefined,
  };
}

function isClipboardAccessError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const name = 'name' in error ? String(error.name) : '';
  return name === 'NotAllowedError' || name === 'SecurityError';
}

function isNativeShareCancellation(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  return 'name' in error && String(error.name) === 'AbortError';
}

export function createShareAdapter(
  environment?: ShareAdapterEnvironment,
): ShareAdapter {
  const copy = async (value: string): Promise<CopyResult> => {
    const activeEnvironment = environment ?? browserEnvironment();
    if (!activeEnvironment.isSecureContext || !activeEnvironment.clipboard) {
      return { status: 'manual-required', value };
    }

    try {
      await activeEnvironment.clipboard.writeText(value);
      return { status: 'copied' };
    } catch (error) {
      if (isClipboardAccessError(error)) {
        return { status: 'manual-required', value };
      }
      return {
        status: 'failed',
        safeMessage: 'The link could not be copied automatically.',
      };
    }
  };

  return {
    copy,
    share: async (payload) => {
      const value = payload.url?.trim() || payload.text?.trim();
      if (!value) {
        return { status: 'failed', safeMessage: 'There is nothing available to share.' };
      }

      const activeEnvironment = environment ?? browserEnvironment();
      if (activeEnvironment.isSecureContext && activeEnvironment.share) {
        try {
          await activeEnvironment.share({
            ...(payload.title?.trim() ? { title: payload.title.trim() } : {}),
            ...(payload.url?.trim() ? { url: payload.url.trim() } : { text: value }),
          });
          return { status: 'copied' };
        } catch (error) {
          if (isNativeShareCancellation(error)) {
            return { status: 'cancelled' };
          }
        }
      }

      return copy(value);
    },
  };
}
