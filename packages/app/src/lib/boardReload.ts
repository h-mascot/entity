/**
 * Cancellable board-reload orchestration (D7 / BRD-002).
 *
 * The customizable-board surface loads its board list in a React effect. The
 * effect MUST return the cancellation cleanup so that a late response (after the
 * effect cleans up on unmount or a dependency change) cannot update stale or
 * unmounted state. This helper encapsulates the cancellation contract so it is
 * unit-testable independently of the React tree (the app has no DOM test harness).
 *
 * Contract:
 *   - `onStart` fires synchronously when the reload begins.
 *   - `onResult` / `onError` / `onComplete` fire only while the reload is alive.
 *   - The returned `cancel()` flips the reload to cancelled; once invoked, none
 *     of the downstream state callbacks fire, so a late resolution is a no-op.
 *
 * The cancel function returned here MUST be returned from the React effect that
 * starts the reload.
 */

import type { BoardSummary } from './boardsState.js';

export interface BoardReloadHandlers {
  fetchBoards: () => Promise<BoardSummary[]>;
  /** Fires synchronously when the reload starts (e.g. set loading flag). */
  onStart?: () => void;
  /** Fires with the loaded board list, only if not cancelled. */
  onResult: (boards: BoardSummary[]) => void;
  /** Fires with a human-readable message on failure, only if not cancelled. */
  onError: (message: string) => void;
  /** Fires when the reload settles, only if not cancelled. */
  onComplete?: () => void;
}

export function runBoardReload(handlers: BoardReloadHandlers): () => void {
  let cancelled = false;
  handlers.onStart?.();
  handlers
    .fetchBoards()
    .then((boards) => {
      if (!cancelled) handlers.onResult(boards);
    })
    .catch((error: unknown) => {
      if (!cancelled) {
        handlers.onError(error instanceof Error ? error.message : 'Unable to load boards.');
      }
    })
    .finally(() => {
      if (!cancelled) handlers.onComplete?.();
    });
  return () => {
    cancelled = true;
  };
}
