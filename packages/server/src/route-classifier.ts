/**
 * Centralized route classification (Terra R1).
 *
 * The deployment-wide `ENTITY_API_TOKEN` authenticates TRANSPORT only. It MUST
 * NEVER imply customer/data-plane authority. This module is the single source
 * of truth that the production-mounted `createDataPlaneCredentialGuard` (see
 * `middleware/data-plane-credential.ts`) consults to decide, per request,
 * whether a valid per-principal customer credential (`x-entity-access-token`)
 * is additionally required.
 *
 * Classification is FAIL-CLOSED. Only two kinds of protected API path bypass
 * the customer credential:
 *
 *   1. PUBLIC — the exact public surface already exempt from the transport
 *      bearer (`isPublicRoute` in `middleware/api-auth.ts`): health/version,
 *      the ClickClack proxy, and the path-token-authenticated onboarding
 *      agent-session entrypoints, plus (when the agent-native editor is
 *      enabled, the default) the document self-auth surface. The static/SPA/
 *      docs shell is outside the protected API surface entirely and is also
 *      public.
 *   2. CONTROL — the narrow admin boundary (`/api/admin`), which is governed
 *      by the server-trusted principal binding + its own admin authorization
 *      (`createRequireAdminPrincipal` mounted on the principals router,
 *      PR #71/#72). This is the ONLY protected surface that legitimately
 *      relies on a server-resolved admin identity rather than a customer
 *      credential.
 *
 * EVERY other protected API path — onboarding state/business setup, config
 * reads, runtime/db-mode feature-flag reads, migration-cleanup queues, node
 * operations, plugin management, and all task/document/chat/activity/customer
 * object routes — is DATA-PLANE and requires a valid, active, individually
 * revocable customer credential. A previously broad carve-out that treated
 * onboarding/config/runtime/db-mode/operations/plugins as control was
 * explicitly rejected (R6: onboarding and operations share the same principal
 * model as the rest of the customer surface), so the control set is
 * intentionally just `/api/admin`.
 *
 * Adding a new customer-object route requires no change here: it is
 * data-plane by default.
 */

import { isProtectedApiPath, isPublicRoute } from './middleware/api-auth';

export type RoutePlane = 'public' | 'control' | 'data-plane';

/**
 * The single control-plane prefix: admin / principal management. The whole
 * router mounted at `/api/admin` (`registerPrincipalRoutes`) applies
 * `createRequireAdminPrincipal`, so every sub-path here carries independent
 * admin authorization via the server-trusted principal binding (PR #71/#72).
 */
const CONTROL_PREFIX = '/api/admin';

/**
 * True when the protected API path is the narrow admin control-plane
 * exception. Non-protected paths (static/SPA) return false — they are public,
 * not control. The match is exact-string OR prefix-followed-by-'/' so a
 * partial token like '/api/administrivia' never leaks through.
 */
export function isControlPlanePath(path: string): boolean {
  if (typeof path !== 'string' || !path) return false;
  if (!isProtectedApiPath(path)) return false;
  return path === CONTROL_PREFIX || path.startsWith(CONTROL_PREFIX + '/');
}

/**
 * Classify a request path into its security plane. Centralized so the
 * production-mounted data-plane guard and the request-context helpers share
 * one definition.
 *
 *   - 'public': static/SPA/docs shell, plus the health/version/clickclack and
 *     path-token-authenticated onboarding-session routes that already bypass
 *     the transport bearer. The data-plane guard is inert here.
 *   - 'control': the narrow `/api/admin` boundary that retains the
 *     server-trusted principal + its own admin authorization; no customer
 *     credential required.
 *   - 'data-plane': everything else in the protected API surface, including
 *     onboarding/config/runtime/db-mode/operations/plugins and all customer
 *     object routes. A valid, active, individually revocable
 *     `x-entity-access-token` is REQUIRED.
 */
export function classifyRoute(path: string): RoutePlane {
  if (typeof path !== 'string' || !path) return 'public';
  // Static assets, SPA shell, docs rendering — never blocked.
  if (!isProtectedApiPath(path)) return 'public';
  // Public route patterns already bypass the transport bearer; they bypass the
  // data-plane guard too.
  if (isPublicRoute(path)) return 'public';
  if (isControlPlanePath(path)) return 'control';
  // Fail-closed: any protected API path that is not an explicit exception is
  // customer data-plane and requires a customer credential.
  return 'data-plane';
}
