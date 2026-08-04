/**
 * THE-861 / WP1-A-06 — Deep-link refresh restore for Workplane task + active panel.
 *
 * Cold load / full page reload must rehydrate shell state from the URL alone
 * (pathname + search), without relying on in-memory history.state from THE-859/860.
 */

import {
  isWorkplaneRoutePath,
  resolveWorkplaneShellModel,
  type WorkplaneShellModel,
} from './workplaneShellModel.ts';
import {
  parseWorkplaneUrlState,
  serializeWorkplaneUrlState,
  type WorkplaneUrlState,
  type WorkplaneUrlStateInput,
} from './workplaneUrlState.ts';

export type WorkplaneRefreshRestoreResult = {
  /** True when pathname is under `/workplane` (valid or invalid). */
  isWorkplaneDeepLink: boolean;
  /**
   * When true, App must mount WorkplaneShell ahead of onboarding/Doc Hub gates
   * so a direct visit or refresh is not swallowed.
   */
  bypassWorkspaceGates: boolean;
  model: WorkplaneShellModel;
  /** Canonical state when restore succeeded; null for invalid/missing task id. */
  restoredState: WorkplaneUrlState | null;
  /** True when ready shell restored task id + active panel from the URL. */
  restored: boolean;
};

/**
 * Whether a location is a Workplane deep link that must win over workspace gates
 * (onboarding wizard, Doc Hub sync) on cold load / refresh.
 */
export function shouldBypassGatesForWorkplaneDeepLink(pathname: string): boolean {
  return isWorkplaneRoutePath(pathname);
}

/**
 * Restore Workplane shell model from a location as if after a full page refresh.
 * Invalid/missing task ids yield fail-closed `invalid_route` (never crash / invent healthy).
 */
export function restoreWorkplaneAfterRefresh(
  pathname: string,
  search = '',
): WorkplaneRefreshRestoreResult {
  const isWorkplaneDeepLink = isWorkplaneRoutePath(pathname);
  const model = resolveWorkplaneShellModel(pathname, search);
  const restoredState = model.status === 'ready' ? model.state : null;
  const restored =
    model.status === 'ready' &&
    restoredState !== null &&
    model.taskId === restoredState.taskId &&
    model.activePanel === restoredState.activePanel;

  return {
    isWorkplaneDeepLink,
    bypassWorkspaceGates: isWorkplaneDeepLink,
    model,
    restoredState,
    restored,
  };
}

/**
 * Simulate a browser refresh: serialize state → re-parse from the resulting URL.
 * Used by focused tests and as the THE-861 round-trip guarantee.
 */
export function simulateWorkplaneUrlRefresh(
  state: WorkplaneUrlStateInput,
): WorkplaneRefreshRestoreResult {
  const href = serializeWorkplaneUrlState(state);
  const url = new URL(href, 'https://entity.local');
  return restoreWorkplaneAfterRefresh(url.pathname, url.search);
}

/** Parse-only helper for tests asserting URL → state without shell model fields. */
export function parseWorkplaneStateAfterRefresh(
  pathname: string,
  search = '',
): WorkplaneUrlState | null {
  return parseWorkplaneUrlState(pathname, search);
}
