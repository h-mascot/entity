/**
 * THE-904 / SRCH-A-05 — Workplane scoped-search navigation guard.
 *
 * Scoped-search results carry server-provided deep links. The Workplane surface must
 * only dispatch Workplane-owned task routes (`/workplane/:taskId`) and reject everything
 * else (document/external API routes, foreign URLs, script URLs) so a malformed or
 * mixed-surface deep link can never route the user out of the Workplane. Fail-closed.
 */

export const WORKPLANE_TASK_ROUTE_RE = /^\/workplane\/([1-9]\d*)(?:[?#].*)?$/;

/**
 * Returns true only for permitted Workplane task deep-link routes. A permitted route
 * is exactly `/workplane/<positive integer>` optionally followed by a `?query` or
 * `#hash` — no trailing slash, no nested path, no id 0. Everything else (including
 * Doc Hub, API, absolute, script URLs, and nested task paths) is rejected.
 */
export function isPermittedWorkplaneScopedRoute(route: unknown): route is string {
  if (typeof route !== 'string') return false;
  if (route.length === 0) return false;
  // Reject anything that looks like an absolute/protocol/script URL before regex match.
  if (/:\/\//.test(route) || /^\s*javascript:/i.test(route)) return false;
  return WORKPLANE_TASK_ROUTE_RE.test(route);
}
