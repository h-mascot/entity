/**
 * THE-859 / WP1-A-04 — Open Workplane action helpers from task detail.
 * THE-860 / WP1-A-05 — Stash returnHref on history state for history.back().
 *
 * Builds a THE-857 deep link with return context derived from the current
 * task-detail / board surface.
 */

import {
  resolveWorkplaneReturnDestination,
} from './workplaneReturnNavigation.ts';
import {
  parseWorkplaneUrlState,
  serializeWorkplaneUrlState,
  type WorkplaneReturnContext,
  type WorkplaneReturnSurface,
  type WorkplaneUrlStateInput,
} from './workplaneUrlState.ts';

export interface OpenWorkplaneFromTaskDetailInput {
  taskId: number;
  /** Current location pathname when opening (defaults to `/task/:taskId`). */
  currentPathname?: string | null;
  /** Optional Mission Control board/tab key when known. */
  returnBoard?: string | null;
  /** Optional panel override; defaults via serialize (task_summary). */
  activePanel?: WorkplaneUrlStateInput['activePanel'];
  /** Optional proof selection to carry into the Workplane URL. */
  selectedProof?: string | null;
}

function resolveReturnSurface(
  taskId: number,
  currentPathname: string | null | undefined,
  returnBoard: string | null | undefined,
): { surface: WorkplaneReturnSurface; path: string } {
  const pathname = currentPathname?.trim() || `/task/${taskId}`;
  const detailPath = `/task/${taskId}`;

  if (/^\/task\/\d+\/?$/.test(pathname)) {
    return { surface: 'detail', path: detailPath };
  }
  if (pathname === '/tasks' || pathname.startsWith('/tasks/')) {
    return {
      surface: returnBoard?.trim() ? 'board' : 'tasks',
      path: '/tasks',
    };
  }
  // Root tasks tab (/?tab=tasks) counts as board/list origin when present.
  if (pathname === '/' || pathname === '') {
    return {
      surface: returnBoard?.trim() ? 'board' : 'tasks',
      path: '/tasks',
    };
  }
  // Overlay / unknown path while viewing a task: still return to detail.
  return { surface: 'detail', path: detailPath };
}

/** Serialize return context from the current task-detail (or board) surface. */
export function buildTaskDetailReturnContext(
  taskId: number,
  options: {
    currentPathname?: string | null;
    returnBoard?: string | null;
  } = {},
): WorkplaneReturnContext {
  if (!Number.isInteger(taskId) || taskId < 1) {
    throw new TypeError('Open Workplane task id must be a positive integer.');
  }

  const { surface, path } = resolveReturnSurface(
    taskId,
    options.currentPathname,
    options.returnBoard,
  );
  const board = options.returnBoard?.trim() || undefined;

  const context: WorkplaneReturnContext = {
    surface,
    taskId,
    path,
  };
  if (board) {
    context.board = board;
  }
  return context;
}

/** Canonical Open Workplane href for the given task + optional return/panel/proof. */
export function buildOpenWorkplaneHref(input: OpenWorkplaneFromTaskDetailInput): string {
  if (!Number.isInteger(input.taskId) || input.taskId < 1) {
    throw new TypeError('Open Workplane task id must be a positive integer.');
  }

  return serializeWorkplaneUrlState({
    taskId: input.taskId,
    activePanel: input.activePanel,
    selectedProof: input.selectedProof ?? null,
    returnContext: buildTaskDetailReturnContext(input.taskId, {
      currentPathname: input.currentPathname,
      returnBoard: input.returnBoard,
    }),
  });
}

/**
 * Navigate into a Workplane deep link.
 * Uses history + popstate so App can mount WorkplaneShell without a full reload.
 * Stashes returnHref on history state so THE-860 can prefer history.back().
 */
export function navigateToWorkplane(
  href: string,
  navigate?: (href: string, options?: { replace?: boolean; state?: unknown }) => void,
): void {
  const url = new URL(href, 'https://entity.local');
  const parsed = parseWorkplaneUrlState(url.pathname, url.search);
  const destination = resolveWorkplaneReturnDestination(parsed?.returnContext ?? null, {
    taskId: parsed?.taskId ?? null,
  });
  const state = {
    mode: 'workplane' as const,
    returnHref: destination.href,
    returnSurface: destination.surface,
    returnBoard: destination.boardTab,
  };

  if (navigate) {
    navigate(href, { replace: false, state });
    return;
  }
  if (typeof window === 'undefined') {
    return;
  }
  const nextUrl = new URL(href, window.location.origin);
  window.history.pushState(state, '', nextUrl.pathname + nextUrl.search);
  window.dispatchEvent(new PopStateEvent('popstate', { state }));
}
