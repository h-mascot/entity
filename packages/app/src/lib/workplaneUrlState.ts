/**
 * THE-857 / WP1-A-02 — Workplane URL state schema.
 *
 * Pure parse/serialize contract for Q36 deep links:
 * task id, active panel, selected proof, return context.
 *
 * Consumed by THE-858 (route/shell), THE-859 (Open Workplane),
 * THE-860 (return navigation), and THE-861 (`workplaneRefreshRestore`).
 * This module does not register a route or UI action.
 */

import {
  WORKPLANE_PANEL_SEAM_MAP,
  type WorkplanePanelId,
} from '../components/mission-control/taskDetailWorkplaneSeams.ts';

/** Canonical path prefix for task Workplanes (THE-858 owns wiring). */
export const WORKPLANE_PATH_PREFIX = '/workplane';

/** Default active panel when URL omits or invalidates `panel`. */
export const DEFAULT_WORKPLANE_PANEL: WorkplanePanelId = 'task_summary';

/** Query keys reserved for Workplane URL state (stable for THE-858..THE-861). */
export const WORKPLANE_URL_QUERY_KEYS = {
  panel: 'panel',
  proof: 'proof',
  returnSurface: 'return',
  returnBoard: 'returnBoard',
  returnTask: 'returnTask',
  returnPath: 'returnPath',
} as const;

export type WorkplaneReturnSurface = 'board' | 'detail' | 'tasks';

export const WORKPLANE_RETURN_SURFACES: readonly WorkplaneReturnSurface[] = [
  'board',
  'detail',
  'tasks',
] as const;

export const WORKPLANE_PANEL_IDS: readonly WorkplanePanelId[] = Object.freeze(
  Object.keys(WORKPLANE_PANEL_SEAM_MAP) as WorkplanePanelId[],
);

const WORKPLANE_PANEL_ID_SET = new Set<string>(WORKPLANE_PANEL_IDS);
const WORKPLANE_RETURN_SURFACE_SET = new Set<string>(WORKPLANE_RETURN_SURFACES);

/** Safe proof / board identifiers: no whitespace, protocols, or path traversal. */
const SAFE_URL_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * Return-to surface after leaving a Workplane.
 * Paths must be same-origin relative app paths (no open redirects).
 */
export interface WorkplaneReturnContext {
  surface: WorkplaneReturnSurface;
  /** Mission Control board/tab key when surface is `board`. */
  board?: string;
  /** Task id when returning to detail (`/task/:id`). */
  taskId?: number;
  /** Safe relative restore path (e.g. `/task/42`, `/tasks`). */
  path?: string;
}

/** Canonical Workplane URL state after parse/normalize. */
export interface WorkplaneUrlState {
  taskId: number;
  activePanel: WorkplanePanelId;
  /** Selected proof/artifact id, or null when none. */
  selectedProof: string | null;
  returnContext: WorkplaneReturnContext | null;
}

/** Partial input accepted by normalize/serialize helpers. */
export type WorkplaneUrlStateInput = {
  taskId: number;
  activePanel?: WorkplanePanelId | string | null;
  selectedProof?: string | null;
  returnContext?: WorkplaneReturnContext | null;
};

export function isWorkplanePanelId(value: unknown): value is WorkplanePanelId {
  return typeof value === 'string' && WORKPLANE_PANEL_ID_SET.has(value);
}

export function isWorkplaneReturnSurface(value: unknown): value is WorkplaneReturnSurface {
  return typeof value === 'string' && WORKPLANE_RETURN_SURFACE_SET.has(value);
}

export function createDefaultWorkplaneUrlState(taskId: number): WorkplaneUrlState {
  if (!Number.isInteger(taskId) || taskId < 1) {
    throw new TypeError('Workplane task id must be a positive integer.');
  }
  return {
    taskId,
    activePanel: DEFAULT_WORKPLANE_PANEL,
    selectedProof: null,
    returnContext: null,
  };
}

export function extractWorkplaneTaskId(pathname: string): number | null {
  const match = pathname.match(/^\/workplane\/(\d+)\/?$/);
  if (!match) {
    return null;
  }
  const taskId = Number(match[1]);
  return Number.isInteger(taskId) && taskId >= 1 ? taskId : null;
}

export function buildWorkplanePath(taskId: number): string {
  if (!Number.isInteger(taskId) || taskId < 1) {
    throw new TypeError('Workplane task id must be a positive integer.');
  }
  return `${WORKPLANE_PATH_PREFIX}/${taskId}`;
}

function safeUrlToken(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized || !SAFE_URL_TOKEN.test(normalized)) {
    return undefined;
  }
  if (normalized.includes('..') || normalized.includes('//')) {
    return undefined;
  }
  return normalized;
}

function safeReturnPath(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized || !normalized.startsWith('/')) {
    return undefined;
  }
  if (
    normalized.startsWith('//') ||
    normalized.includes('://') ||
    normalized.includes('\\') ||
    normalized.includes('..') ||
    /[\s?#]/.test(normalized)
  ) {
    return undefined;
  }
  // Keep return paths inside known Entity app surfaces.
  if (
    !(
      normalized === '/tasks' ||
      normalized.startsWith('/tasks/') ||
      normalized === '/task' ||
      /^\/task\/\d+\/?$/.test(normalized) ||
      normalized.startsWith('/workplane/')
    )
  ) {
    return undefined;
  }
  return normalized.replace(/\/+$/, '') || normalized;
}

function parsePositiveInt(value: string | null | undefined): number | undefined {
  if (value == null || value.trim() === '') {
    return undefined;
  }
  if (!/^\d+$/.test(value.trim())) {
    return undefined;
  }
  const n = Number(value.trim());
  return Number.isInteger(n) && n >= 1 ? n : undefined;
}

function parseReturnContext(params: URLSearchParams): WorkplaneReturnContext | null {
  const surface = params.get(WORKPLANE_URL_QUERY_KEYS.returnSurface);
  if (!isWorkplaneReturnSurface(surface)) {
    return null;
  }

  const board = safeUrlToken(params.get(WORKPLANE_URL_QUERY_KEYS.returnBoard));
  const taskId = parsePositiveInt(params.get(WORKPLANE_URL_QUERY_KEYS.returnTask));
  const path = safeReturnPath(params.get(WORKPLANE_URL_QUERY_KEYS.returnPath));

  const context: WorkplaneReturnContext = { surface };
  if (board) context.board = board;
  if (taskId !== undefined) context.taskId = taskId;
  if (path) context.path = path;
  return context;
}

function normalizeReturnContext(
  value: WorkplaneReturnContext | null | undefined,
): WorkplaneReturnContext | null {
  if (!value || !isWorkplaneReturnSurface(value.surface)) {
    return null;
  }
  const board = safeUrlToken(value.board);
  const taskId =
    typeof value.taskId === 'number' && Number.isInteger(value.taskId) && value.taskId >= 1
      ? value.taskId
      : undefined;
  const path = safeReturnPath(value.path);
  const context: WorkplaneReturnContext = { surface: value.surface };
  if (board) context.board = board;
  if (taskId !== undefined) context.taskId = taskId;
  if (path) context.path = path;
  return context;
}

/**
 * Normalize partial/invalid optional fields to a canonical state.
 * Invalid panel/proof/return values are dropped (defaults / null), never coerced to healthy unknowns.
 */
export function normalizeWorkplaneUrlState(input: WorkplaneUrlStateInput): WorkplaneUrlState {
  if (!Number.isInteger(input.taskId) || input.taskId < 1) {
    throw new TypeError('Workplane task id must be a positive integer.');
  }

  const activePanel = isWorkplanePanelId(input.activePanel)
    ? input.activePanel
    : DEFAULT_WORKPLANE_PANEL;
  const selectedProof = safeUrlToken(input.selectedProof ?? undefined) ?? null;

  return {
    taskId: input.taskId,
    activePanel,
    selectedProof,
    returnContext: normalizeReturnContext(input.returnContext),
  };
}

/**
 * Parse Workplane URL state from pathname + search.
 * Returns null when the path is not a Workplane route or task id is invalid.
 * Invalid optional query values are ignored (defaults applied).
 */
export function parseWorkplaneUrlState(pathname: string, search = ''): WorkplaneUrlState | null {
  const taskId = extractWorkplaneTaskId(pathname);
  if (taskId === null) {
    return null;
  }

  const params = new URLSearchParams(
    search.startsWith('?') || search === '' ? search : `?${search}`,
  );
  const panelParam = params.get(WORKPLANE_URL_QUERY_KEYS.panel);
  const proofParam = params.get(WORKPLANE_URL_QUERY_KEYS.proof);

  return normalizeWorkplaneUrlState({
    taskId,
    activePanel: panelParam,
    selectedProof: proofParam,
    returnContext: parseReturnContext(params),
  });
}

/**
 * Serialize canonical Workplane URL state to a relative path + query string.
 * Omits default panel and null optional fields for stable, short deep links.
 */
export function serializeWorkplaneUrlState(state: WorkplaneUrlStateInput): string {
  const normalized = normalizeWorkplaneUrlState(state);
  const params = new URLSearchParams();

  if (normalized.activePanel !== DEFAULT_WORKPLANE_PANEL) {
    params.set(WORKPLANE_URL_QUERY_KEYS.panel, normalized.activePanel);
  }
  if (normalized.selectedProof) {
    params.set(WORKPLANE_URL_QUERY_KEYS.proof, normalized.selectedProof);
  }
  if (normalized.returnContext) {
    params.set(WORKPLANE_URL_QUERY_KEYS.returnSurface, normalized.returnContext.surface);
    if (normalized.returnContext.board) {
      params.set(WORKPLANE_URL_QUERY_KEYS.returnBoard, normalized.returnContext.board);
    }
    if (normalized.returnContext.taskId !== undefined) {
      params.set(WORKPLANE_URL_QUERY_KEYS.returnTask, String(normalized.returnContext.taskId));
    }
    if (normalized.returnContext.path) {
      params.set(WORKPLANE_URL_QUERY_KEYS.returnPath, normalized.returnContext.path);
    }
  }

  const path = buildWorkplanePath(normalized.taskId);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** Round-trip helper used by tests and THE-861 refresh restore. */
export function roundTripWorkplaneUrlState(state: WorkplaneUrlStateInput): WorkplaneUrlState | null {
  const serialized = serializeWorkplaneUrlState(state);
  const url = new URL(serialized, 'https://entity.local');
  return parseWorkplaneUrlState(url.pathname, url.search);
}
