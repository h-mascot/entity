/**
 * Pure decision logic for the TaskDetailPanel view state.
 *
 * Encapsulates the "loading vs. ready vs. not-found vs. error" decision so it
 * is deterministic and unit-testable instead of living only inside the
 * component render.
 *
 * Critical guarantees (see QA-ROUTE-NOT-FOUND):
 *  - `'loading'` is returned for the entire duration of the in-flight fetch,
 *    so we never briefly declare not-found/error while the detail request is
 *    still pending (cold deep-link loads).
 *  - `'not-found'` is reserved for a true HTTP 404 (the caller passes
 *    `notFound`, derived from `loadError instanceof HttpRequestError &&
 *    loadError.status === 404`). A network failure, 5xx, or invalid response
 *    must surface as a distinct generic `'error'` state, never as "not found".
 */

export type TaskDetailViewState = 'loading' | 'ready' | 'not-found' | 'error';

export interface TaskDetailViewStateInput {
  /** True while the task detail (and required supplemental) fetch is in flight. */
  loading: boolean;
  /** True when a normalized task object was successfully loaded. */
  hasTask: boolean;
  /** True when an editable form was derived from the loaded task. */
  hasForm: boolean;
  /** True only for a true HTTP 404 failure (network/5xx/invalid stay false). */
  notFound: boolean;
}

/**
 * Resolve the panel view state.
 *
 * - `'loading'` while `loading` is true (regardless of stale task/form values).
 * - `'ready'` once loading resolved and both task + form are present.
 * - `'not-found'` once loading resolved with no task/form AND a confirmed 404.
 * - `'error'` for any other resolved-without-task outcome (network, 5xx,
 *   invalid response). `notFound` is only meaningful once loading has resolved.
 */
export function resolveTaskDetailViewState(input: TaskDetailViewStateInput): TaskDetailViewState {
  if (input.loading) {
    return 'loading';
  }

  if (input.hasTask && input.hasForm) {
    return 'ready';
  }

  return input.notFound ? 'not-found' : 'error';
}
