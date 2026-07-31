/**
 * THE-860 / WP1-A-05 — Preserve return-to-board/detail navigation.
 *
 * Resolves a safe in-app destination from THE-857 return context and navigates
 * without stranding the user on the Workplane shell. Prefers history.back()
 * when the prior entry matches the return surface; otherwise navigates explicitly.
 */

import { isBuiltInMCBoardTab, normalizeStoredMCBoardTab } from './mcBoardTabs.ts';
import type { WorkplaneReturnContext, WorkplaneReturnSurface } from './workplaneUrlState.ts';

export type WorkplaneReturnNavMethod = 'history_back' | 'navigate';

export interface WorkplaneReturnDestination {
  /** Concrete same-origin relative href for App routing. */
  href: string;
  surface: WorkplaneReturnSurface | 'fallback';
  /** Mission Control board tab to restore when returning to board/tasks. */
  boardTab: string | null;
  label: string;
  historyState: {
    mode: 'task' | 'tasks';
    fromWorkplaneReturn: true;
    taskId?: number;
    board?: string;
  };
}

export interface NavigateWorkplaneReturnInput {
  returnContext: WorkplaneReturnContext | null;
  /** Workplane task id — used for detail fallback when return context is absent. */
  taskId?: number | null;
  /** Injected navigate (tests / shell). Defaults to history API + popstate. */
  navigate?: (href: string, options?: { replace?: boolean; state?: unknown }) => void;
  /** Prefer browser back when prior entry likely matches return href. */
  preferHistoryBack?: boolean;
  historyLength?: number;
  historyState?: unknown;
}

export interface NavigateWorkplaneReturnResult {
  method: WorkplaneReturnNavMethod;
  href: string;
  destination: WorkplaneReturnDestination;
}

const BOARD_KEY_TO_TAB: Record<string, string> = {
  'entity-engineering': 'engineering',
  engineering: 'engineering',
  kanban: 'kanban',
  ops: 'kanban',
  strategic: 'strategic',
  insights: 'insights',
};

/** Map returnBoard token (project key or MC tab) onto a Mission Control board tab. */
export function mapReturnBoardToMcTab(board: string | null | undefined): string | null {
  const normalized = board?.trim();
  if (!normalized) {
    return null;
  }
  if (BOARD_KEY_TO_TAB[normalized]) {
    return BOARD_KEY_TO_TAB[normalized];
  }
  if (isBuiltInMCBoardTab(normalized)) {
    return normalized;
  }
  // Plugin / custom board ids — keep as-is after light normalize.
  return normalizeStoredMCBoardTab(normalized);
}

/**
 * Translate stored returnPath (`/tasks`, `/task/:id`) into an App-routable href.
 * `/tasks` alone is not a workspace tab route; board/list returns use `/?tab=tasks`.
 */
export function coerceReturnPathToAppHref(
  path: string | null | undefined,
  surface: WorkplaneReturnSurface | 'fallback',
  taskId?: number | null,
): string {
  const trimmed = path?.trim();
  if (trimmed === '/tasks' || trimmed?.startsWith('/tasks/')) {
    return '/?tab=tasks';
  }
  if (trimmed && /^\/task\/\d+\/?$/.test(trimmed)) {
    return trimmed.replace(/\/+$/, '');
  }
  if (surface === 'detail' && typeof taskId === 'number' && Number.isInteger(taskId) && taskId >= 1) {
    return `/task/${taskId}`;
  }
  if (surface === 'board' || surface === 'tasks' || surface === 'fallback') {
    return '/?tab=tasks';
  }
  return '/?tab=tasks';
}

function surfaceLabel(surface: WorkplaneReturnSurface | 'fallback'): string {
  switch (surface) {
    case 'detail':
      return 'task detail';
    case 'board':
      return 'board';
    case 'tasks':
      return 'task list';
    default:
      return 'tasks';
  }
}

/** Resolve the destination for an explicit Workplane return action. */
export function resolveWorkplaneReturnDestination(
  returnContext: WorkplaneReturnContext | null,
  options: { taskId?: number | null } = {},
): WorkplaneReturnDestination {
  if (returnContext) {
    const boardTab = mapReturnBoardToMcTab(returnContext.board);
    const taskId =
      returnContext.taskId ??
      (typeof options.taskId === 'number' && Number.isInteger(options.taskId) && options.taskId >= 1
        ? options.taskId
        : null);
    const href = coerceReturnPathToAppHref(returnContext.path, returnContext.surface, taskId);
    const historyState: WorkplaneReturnDestination['historyState'] = {
      mode: returnContext.surface === 'detail' ? 'task' : 'tasks',
      fromWorkplaneReturn: true,
    };
    if (returnContext.surface === 'detail' && taskId !== null) {
      historyState.taskId = taskId;
    }
    if (boardTab) {
      historyState.board = boardTab;
    }
    return {
      href,
      surface: returnContext.surface,
      boardTab,
      label: `Return to ${surfaceLabel(returnContext.surface)}`,
      historyState,
    };
  }

  const fallbackTaskId =
    typeof options.taskId === 'number' && Number.isInteger(options.taskId) && options.taskId >= 1
      ? options.taskId
      : null;

  if (fallbackTaskId !== null) {
    return {
      href: `/task/${fallbackTaskId}`,
      surface: 'fallback',
      boardTab: null,
      label: 'Return to task detail',
      historyState: {
        mode: 'task',
        taskId: fallbackTaskId,
        fromWorkplaneReturn: true,
      },
    };
  }

  return {
    href: '/?tab=tasks',
    surface: 'fallback',
    boardTab: null,
    label: 'Return to tasks',
    historyState: {
      mode: 'tasks',
      fromWorkplaneReturn: true,
    },
  };
}

/**
 * Prefer history.back() when Workplane was opened via pushState from the return surface.
 * Avoids stacking a duplicate return entry that would strand Back on the Workplane again.
 */
export function shouldPreferHistoryBack(options: {
  destinationHref: string;
  historyLength?: number;
  historyState?: unknown;
}): boolean {
  const length = options.historyLength ?? (typeof window !== 'undefined' ? window.history.length : 0);
  if (length <= 1) {
    return false;
  }

  const state =
    options.historyState !== undefined
      ? options.historyState
      : typeof window !== 'undefined'
        ? window.history.state
        : null;

  if (!state || typeof state !== 'object') {
    return false;
  }

  const record = state as Record<string, unknown>;
  if (record.mode !== 'workplane') {
    return false;
  }

  const stashedReturn =
    typeof record.returnHref === 'string' ? record.returnHref.trim() : '';
  if (!stashedReturn) {
    // Opened as workplane via pushState — prior entry is the launch surface.
    return true;
  }

  return (
    stashedReturn === options.destinationHref ||
    stashedReturn === '/tasks' && options.destinationHref === '/?tab=tasks'
  );
}

function defaultNavigate(href: string, options?: { replace?: boolean; state?: unknown }): void {
  if (typeof window === 'undefined') {
    return;
  }
  const nextUrl = new URL(href, window.location.origin);
  const method = options?.replace ? 'replaceState' : 'pushState';
  const state = options?.state ?? { mode: 'tasks', fromWorkplaneReturn: true };
  window.history[method](state, '', nextUrl.pathname + nextUrl.search + nextUrl.hash);
  window.dispatchEvent(new PopStateEvent('popstate', { state }));
}

/**
 * Leave the Workplane for the preserved return surface (or safe fallback).
 * Never no-ops: always history.back() or navigate away from `/workplane`.
 */
export function navigateWorkplaneReturn(
  input: NavigateWorkplaneReturnInput,
): NavigateWorkplaneReturnResult {
  const destination = resolveWorkplaneReturnDestination(input.returnContext, {
    taskId: input.taskId,
  });

  const preferBack =
    input.preferHistoryBack !== false &&
    shouldPreferHistoryBack({
      destinationHref: destination.href,
      historyLength: input.historyLength,
      historyState: input.historyState,
    });

  if (preferBack && typeof window !== 'undefined' && !input.navigate) {
    window.history.back();
    return { method: 'history_back', href: destination.href, destination };
  }

  const navigate = input.navigate ?? defaultNavigate;
  navigate(destination.href, { replace: false, state: destination.historyState });
  return { method: 'navigate', href: destination.href, destination };
}
