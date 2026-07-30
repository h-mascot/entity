/**
 * THE-858 / WP1-A-03 — Workplane shell presentation model.
 *
 * Pure helpers that turn THE-857 URL state into a minimal shell view model.
 * Panel bodies stay placeholders until WP1-B/C. Open Workplane CTA is THE-859.
 * Return href resolution expanded by THE-860 / WP1-A-05.
 * Cold-load refresh restore is THE-861 (`workplaneRefreshRestore`).
 */

import {
  WORKPLANE_PANEL_SEAM_MAP,
  type WorkplanePanelId,
} from '../components/mission-control/taskDetailWorkplaneSeams.ts';
import {
  resolveWorkplaneReturnDestination,
} from './workplaneReturnNavigation.ts';
import {
  WORKPLANE_PANEL_IDS,
  WORKPLANE_PATH_PREFIX,
  parseWorkplaneUrlState,
  serializeWorkplaneUrlState,
  type WorkplaneReturnContext,
  type WorkplaneUrlState,
} from './workplaneUrlState.ts';

export type WorkplaneShellStatus = 'ready' | 'invalid_route';

export interface WorkplanePanelPlaceholder {
  id: WorkplanePanelId;
  label: string;
  status: 'placeholder';
  seamStatus: (typeof WORKPLANE_PANEL_SEAM_MAP)[WorkplanePanelId]['status'];
  notes: string;
}

export interface WorkplaneShellReturnView {
  present: boolean;
  surface: WorkplaneReturnContext['surface'] | 'fallback' | null;
  board: string | null;
  boardTab: string | null;
  taskId: number | null;
  path: string | null;
  /** App-routable href for return navigation (never null when shell is ready). */
  href: string | null;
  label: string;
}

export interface WorkplaneShellModel {
  status: WorkplaneShellStatus;
  /** True when pathname is under `/workplane` (valid or invalid). */
  isWorkplaneRoute: boolean;
  pathname: string;
  search: string;
  state: WorkplaneUrlState | null;
  taskId: number | null;
  activePanel: WorkplanePanelId | null;
  selectedProof: string | null;
  returnContext: WorkplaneShellReturnView;
  panels: WorkplanePanelPlaceholder[];
  /** Canonical serialized deep link when state is ready; null when invalid. */
  serializedHref: string | null;
  /** Explicit degraded message for invalid/missing task id routes. */
  invalidReason: string | null;
}

function panelPlaceholders(): WorkplanePanelPlaceholder[] {
  return WORKPLANE_PANEL_IDS.map((id) => {
    const seam = WORKPLANE_PANEL_SEAM_MAP[id];
    return {
      id,
      label: seam.panel,
      status: 'placeholder' as const,
      seamStatus: seam.status,
      notes: seam.notes,
    };
  });
}

function returnView(
  context: WorkplaneReturnContext | null,
  taskId?: number | null,
): WorkplaneShellReturnView {
  const destination = resolveWorkplaneReturnDestination(context, { taskId });
  return {
    present: context !== null,
    surface: destination.surface === 'fallback' && !context ? null : destination.surface,
    board: context?.board ?? null,
    boardTab: destination.boardTab,
    taskId: context?.taskId ?? (typeof taskId === 'number' ? taskId : null),
    path: context?.path ?? null,
    href: destination.href,
    label: destination.label,
  };
}

/** True for `/workplane` and `/workplane/...` paths (including invalid ids). */
export function isWorkplaneRoutePath(pathname: string): boolean {
  if (pathname === WORKPLANE_PATH_PREFIX || pathname === `${WORKPLANE_PATH_PREFIX}/`) {
    return true;
  }
  return pathname.startsWith(`${WORKPLANE_PATH_PREFIX}/`);
}

/**
 * Resolve the Workplane shell model from location pathname + search.
 * Invalid `/workplane` paths yield `status: 'invalid_route'` (fail-closed), never silent healthy defaults.
 */
export function resolveWorkplaneShellModel(pathname: string, search = ''): WorkplaneShellModel {
  const panels = panelPlaceholders();
  const isWorkplaneRoute = isWorkplaneRoutePath(pathname);

  if (!isWorkplaneRoute) {
    return {
      status: 'invalid_route',
      isWorkplaneRoute: false,
      pathname,
      search,
      state: null,
      taskId: null,
      activePanel: null,
      selectedProof: null,
      returnContext: returnView(null),
      panels,
      serializedHref: null,
      invalidReason: 'Not a Workplane route.',
    };
  }

  const state = parseWorkplaneUrlState(pathname, search);
  if (!state) {
    return {
      status: 'invalid_route',
      isWorkplaneRoute: true,
      pathname,
      search,
      state: null,
      taskId: null,
      activePanel: null,
      selectedProof: null,
      returnContext: returnView(null),
      panels,
      serializedHref: null,
      invalidReason: 'Workplane requires a positive integer task id in the path (/workplane/:taskId).',
    };
  }

  return {
    status: 'ready',
    isWorkplaneRoute: true,
    pathname,
    search,
    state,
    taskId: state.taskId,
    activePanel: state.activePanel,
    selectedProof: state.selectedProof,
    returnContext: returnView(state.returnContext, state.taskId),
    panels,
    serializedHref: serializeWorkplaneUrlState(state),
    invalidReason: null,
  };
}

/** Build the href after selecting a panel, preserving proof + return context. */
export function buildWorkplanePanelHref(
  state: WorkplaneUrlState,
  panel: WorkplanePanelId,
): string {
  return serializeWorkplaneUrlState({
    ...state,
    activePanel: panel,
  });
}

/** Build the href after selecting a proof token (null clears selection). */
export function buildWorkplaneProofHref(
  state: WorkplaneUrlState,
  selectedProof: string | null,
): string {
  return serializeWorkplaneUrlState({
    ...state,
    selectedProof,
  });
}
