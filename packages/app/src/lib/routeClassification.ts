/**
 * Pure, deterministic route classification for the Entity app shell.
 *
 * The browser SPA has no real 404 — historically every unrecognized pathname
 * silently fell through to the default workspace shell, which produced blank
 * content on cold/deep-link loads (see QA-ROUTE-NOT-FOUND). This module is the
 * single source of truth for "is this pathname a supported surface?" so the
 * shell can render a visible not-found state for anything unsupported instead
 * of a blank default.
 *
 * The classification intentionally mirrors the explicit early-return routing in
 * App.tsx plus the Doc Hub / Workplane deep-link shapes resolved by
 * {@linkcode resolveDocHubRouteTarget} / {@linkcode isWorkplaneRoutePath}. Any
 * pathname that is not one of the enumerated surfaces below classifies as
 * `'not-found'`. Add new top-level surfaces here (and cover them with tests)
 * rather than letting them fall through to the workspace.
 */

import { isWorkplaneRoutePath } from './workplaneShellModel.ts';

/** Coarse route kind for the current browser pathname. */
export type AppRouteKind =
  /** `/showclaw/entity-featured` (rendered before App mounts, kept for completeness). */
  | 'showclaw-featured'
  /** `/workplane` and `/workplane/...`. */
  | 'workplane'
  /** `/onboarding/business`. */
  | 'business-onboarding'
  /** `/onboarding` exactly. */
  | 'onboarding'
  /** `/onboard/agent/:token`. */
  | 'onboard-agent'
  /** `/task/:id` or `/tasks/:id`. */
  | 'task-detail'
  /** `/tasks` exactly (the board/list workspace). */
  | 'tasks-board'
  /** `/docs`, `/docs/...`, and Doc Hub workspace deep links (`/workspace/...`, `/<output|memory|projects>/...`). */
  | 'docs'
  /** `/` (the workspace root, with optional `?tab=`). */
  | 'workspace'
  /** Anything else — render the visible not-found state. */
  | 'not-found';

const TASK_ROUTE_PATTERN = /^\/(?:task|tasks)\/(\d+)(?:\/|$)/i;
const ONBOARD_AGENT_TOKEN_PATTERN = /^\/onboard\/agent\/([^/]+)$/;

/** Doc Hub workspace-root segments that resolve as Doc Hub deep links. */
const DOC_HUB_WORKSPACE_ROOTS = new Set(['output', 'memory', 'projects']);

export const ONBOARDING_PATH = '/onboarding';
export const BUSINESS_ONBOARDING_PATH = '/onboarding/business';

/**
 * Extract a positive integer task id from a `/task/:id` or `/tasks/:id` pathname.
 * Returns `null` for any other shape (including non-numeric ids).
 */
export function extractTaskRouteId(pathname: string): number | null {
  const match = pathname.match(TASK_ROUTE_PATTERN);
  if (!match) {
    return null;
  }

  const taskId = Number(match[1]);
  return Number.isInteger(taskId) && taskId > 0 ? taskId : null;
}

/**
 * Extract the onboarding token from a `/onboard/agent/:token` pathname.
 * Returns `null` for any other shape (including unknown `/onboard/...` paths).
 */
export function extractOnboardingToken(pathname: string): string | null {
  const match = pathname.match(ONBOARD_AGENT_TOKEN_PATTERN);
  if (!match) {
    return null;
  }

  const token = match[1];
  return token.length > 0 ? token : null;
}

function isDocHubPath(pathname: string): boolean {
  if (pathname === '/docs' || pathname.startsWith('/docs/')) {
    return true;
  }

  // Doc Hub deep-link shapes also root directly under workspace segments
  // (mirrors resolveDocHubRouteTarget in docHubRoute.ts without coupling).
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length >= 2) {
    const [root] = segments;
    if (root === 'workspace' || DOC_HUB_WORKSPACE_ROOTS.has(root)) {
      return true;
    }
  }

  return false;
}

/**
 * Classify a browser pathname (with optional search) into a coarse route kind.
 *
 * `search` is accepted for symmetry/future use but does not change the kind:
 * workspace-tab selection (`?tab=`) is handled by the workspace shell, and a
 * `?tab=` on an otherwise unsupported pathname does not make it supported.
 */
export function classifyAppRoute(pathname: string, _search = ''): AppRouteKind {
  if (!pathname || pathname === '/') {
    return 'workspace';
  }

  if (pathname === '/showclaw/entity-featured') {
    return 'showclaw-featured';
  }

  if (isWorkplaneRoutePath(pathname)) {
    return 'workplane';
  }

  // Onboarding family — exact matches are supported; anything else under these
  // prefixes is an unsupported (not-found) onboarding path and must NOT fall
  // through to the workspace shell.
  if (pathname === BUSINESS_ONBOARDING_PATH) {
    return 'business-onboarding';
  }
  if (pathname === ONBOARDING_PATH) {
    return 'onboarding';
  }
  if (pathname.startsWith('/onboarding/') || pathname.startsWith('/onboard/')) {
    if (extractOnboardingToken(pathname) !== null) {
      return 'onboard-agent';
    }
    return 'not-found';
  }

  if (extractTaskRouteId(pathname) !== null) {
    return 'task-detail';
  }

  if (pathname === '/tasks') {
    return 'tasks-board';
  }

  if (isDocHubPath(pathname)) {
    return 'docs';
  }

  return 'not-found';
}
