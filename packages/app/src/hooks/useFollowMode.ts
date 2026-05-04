import { useEffect, useState } from 'react';

export interface UseFollowModeOptions<TCursor = unknown> {
  enabled: boolean;
  cursor: TCursor | null;
  debounceMs?: number;
}

export function useFollowMode<TCursor = unknown>({
  enabled,
  cursor,
  debounceMs = 100,
}: UseFollowModeOptions<TCursor>) {
  const [debouncedCursor, setDebouncedCursor] = useState<TCursor | null>(() => (enabled ? cursor : null));

  useEffect(() => {
    if (!enabled) {
      setDebouncedCursor(null);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setDebouncedCursor(cursor ?? null);
    }, Math.max(0, debounceMs));

    return () => window.clearTimeout(timeoutId);
  }, [cursor, debounceMs, enabled]);

  return { cursor: debouncedCursor };
}

