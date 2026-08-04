/**
 * Per-request customer principal + tenant authorization context (Terra B1–B4).
 *
 * This module layers an *individual, revocable* customer identity on top of the
 * existing deployment-wide bearer (ENTITY_API_TOKEN) + server-trusted admin
 * principal (PR #71/#72). It does NOT replace them:
 *
 *   - `createCustomerPrincipalMiddleware()` runs AFTER api-auth. If the request
 *     carries a valid `x-entity-access-token` it resolves the bound active
 *     principal and attaches a CustomerPrincipalContext to req.
 *   - If the header is absent, NO customer principal is attached and every
 *     helper below treats the request as the trusted service/admin path —
 *     identical to today's behavior (PR #71/#72 preserved, not regressed).
 *   - If the header is present but invalid/revoked/disabled, the middleware
 *     fails closed with 403 (a presented credential must not silently fall
 *     back to the shared trusted identity).
 *
 * All authorization helpers consult the attached customer context only. They
 * never trust `x-entity-org-id`, `x-entity-principal-id`, `x-entity-role`,
 * `x-entity-actor`, or body org/actor fields for identity, role, or tenant.
 */

import type { Request, RequestHandler, Response } from 'express';
import {
  createAccessTokenRepository,
  type AccessTokenRepository,
} from '../../../db/src/access-tokens';
import { resolveStoredPrincipalContext } from './resolver';
import type { PrincipalGrant, PrincipalPermissionContext } from '../permissions';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by createCustomerPrincipalMiddleware when a customer credential resolves. */
    entityCustomerPrincipal?: CustomerPrincipalContext;
  }
}

export interface CustomerPrincipalContext {
  principalId: string;
  principalType: 'human' | 'agent' | 'service_account';
  /** Server-resolved grants for this principal (empty when disabled/revoked). */
  permission: PrincipalPermissionContext;
  /** Distinct org_ids from this principal's grants (excludes global admin). */
  orgIds: string[];
  /** True when the principal holds an org-less admin grant (global scope). */
  isGlobalAdmin: boolean;
}

export type ReviewGateActorType = 'human' | 'agent' | 'system' | 'workflow' | 'unknown';

const ACCESS_TOKEN_HEADER = 'x-entity-access-token';

function principalTypeToActorType(
  type: 'human' | 'agent' | 'service_account',
): ReviewGateActorType {
  if (type === 'human') return 'human';
  if (type === 'agent') return 'agent';
  return 'system';
}

/** Build the customer context from a resolved access token. Exported for tests. */
export function buildCustomerPrincipalContext(args: {
  principalId: string;
  principalType: 'human' | 'agent' | 'service_account';
  permission: PrincipalPermissionContext;
}): CustomerPrincipalContext {
  const grants = args.permission.grants;
  const isGlobalAdmin = grants.some(
    (g) => g.role === 'admin' && !g.org_id && !g.team_id && !g.project_id,
  );
  const orgSet = new Set<string>();
  for (const grant of grants) {
    if (typeof grant.org_id === 'string' && grant.org_id.trim()) {
      orgSet.add(grant.org_id.trim());
    }
  }
  return {
    principalId: args.principalId,
    principalType: args.principalType,
    permission: args.permission,
    orgIds: [...orgSet],
    isGlobalAdmin,
  };
}

/**
 * Middleware that resolves an optional customer access token to a per-request
 * principal. Mount AFTER createApiAuthMiddleware so the transport bearer has
 * already been validated.
 */
export function createCustomerPrincipalMiddleware(
  tokenRepo: AccessTokenRepository = createAccessTokenRepository(),
): RequestHandler {
  return (req, _res, next) => {
    const raw = req.header(ACCESS_TOKEN_HEADER);
    if (typeof raw !== 'string' || !raw.trim()) {
      // No customer credential -> trusted service/admin path (unchanged).
      return next();
    }
    const resolved = tokenRepo.resolveToken(raw.trim());
    if (!resolved) {
      // A presented but invalid/revoked/disabled credential must fail closed.
      // It must NOT silently degrade to the shared trusted identity.
      _res.status(403).json({
        error: 'permission denied',
        code: 'customer_credential_invalid',
        reason: 'access token is missing, revoked, or bound to a disabled principal',
      });
      return;
    }
    const stored = resolveStoredPrincipalContext(resolved.principal.id);
    // resolved.principal is guaranteed active by resolveToken; stored mirrors it.
    const permission: PrincipalPermissionContext =
      stored.kind === 'stored' && stored.status === 'active'
        ? stored.principal
        : { principal_id: resolved.principal.id, grants: resolved.grants.map(toPermissionGrant) };
    req.entityCustomerPrincipal = buildCustomerPrincipalContext({
      principalId: resolved.principal.id,
      principalType: resolved.principal.principal_type,
      permission,
    });
    next();
  };
}

function toPermissionGrant(grant: {
  role: string;
  org_id: string | null;
  team_id: string | null;
  project_id: number | null;
  sensitivity_categories_json?: string;
  sensitivity_categories?: string[];
}): PrincipalGrant {
  return {
    role: grant.role as PrincipalGrant['role'],
    org_id: grant.org_id,
    team_id: grant.team_id,
    project_id: grant.project_id,
    sensitivity_categories: grant.sensitivity_categories ?? [],
  };
}

// ---------------------------------------------------------------------------
// Authorization helpers. All read req.entityCustomerPrincipal only.
// ---------------------------------------------------------------------------

/** The resolved customer principal, or null when this is a trusted service/admin request. */
export function getCustomerPrincipal(req: Request): CustomerPrincipalContext | null {
  return req.entityCustomerPrincipal ?? null;
}

/** True when no customer credential resolved (trusted service/admin path). */
export function isTrustedServiceContext(req: Request): boolean {
  return !req.entityCustomerPrincipal;
}

/**
 * Orgs the customer principal may access. Returns null when the request is
 * the trusted service/admin path (unrestricted) OR the customer is a global
 * admin (unrestricted but still a bound individual identity).
 */
export function authorizedOrgIds(req: Request): string[] | null {
  const ctx = getCustomerPrincipal(req);
  if (!ctx || ctx.isGlobalAdmin) return null;
  return ctx.orgIds;
}

export function isOrgAuthorized(req: Request, orgId: string | null | undefined): boolean {
  const allowed = authorizedOrgIds(req);
  if (allowed === null) return true; // trusted service/admin or customer global admin
  if (typeof orgId !== 'string' || !orgId.trim()) return false;
  return allowed.includes(orgId.trim());
}

export function sendPermissionDenied(res: Response, reason: string): Response {
  return res.status(403).json({
    error: 'permission denied',
    code: 'permission_denied',
    reason,
  });
}

/**
 * Resolve the effective request org for a customer principal. The caller may
 * propose an org (from header/query/body); it is honored ONLY if it lies
 * within the principal's membership. Writes a 403/400 response on failure and
 * returns null. For the trusted path, returns null and lets the caller use the
 * existing readRequestOrg convention (this helper does not alter trusted behavior).
 */
export function resolveAuthorizedOrg(
  req: Request,
  res: Response,
  requestedOrg: string | null,
): { orgId: string } | null {
  const ctx = getCustomerPrincipal(req);
  if (!ctx) return null; // trusted path: caller decides
  if (ctx.isGlobalAdmin) {
    if (requestedOrg) return { orgId: requestedOrg };
    // global admin without an explicit org: defer to caller (default-org path)
    return null;
  }
  if (requestedOrg && !ctx.orgIds.includes(requestedOrg)) {
    sendPermissionDenied(res, 'requested org is outside the principal membership');
    return null;
  }
  const orgId = requestedOrg ?? (ctx.orgIds.length === 1 ? ctx.orgIds[0] : null);
  if (!orgId) {
    res.status(400).json({
      error: 'request org required',
      code: 'request_org_required',
      reason: 'customer principal has multiple org scopes; specify one',
    });
    return null;
  }
  return { orgId };
}

/**
 * Authorize a loaded task against the customer principal's org membership.
 * Trusted path always passes (PR #71/#72 behavior preserved). Returns true on
 * allow; on deny writes 403 and returns false. `action` is included for audits.
 */
export function authorizeTaskOrg(
  req: Request,
  res: Response,
  task: { org_id?: string | null } | null | undefined,
  action: 'read' | 'write',
): boolean {
  if (isTrustedServiceContext(req)) return true;
  if (!task) {
    res.status(404).json({ error: 'task not found' });
    return false;
  }
  if (!isOrgAuthorized(req, task.org_id)) {
    // 404 to avoid leaking cross-tenant existence, matching the list filter.
    res.status(404).json({ error: 'task not found' });
    return false;
  }
  return true;
}

/** Filter an in-memory task list to the customer principal's authorized orgs. */
export function filterTasksForRequest<T extends { org_id?: string | null }>(
  req: Request,
  tasks: T[],
): T[] {
  const allowed = authorizedOrgIds(req);
  if (allowed === null) return tasks;
  const set = new Set(allowed);
  return tasks.filter((task) => typeof task.org_id === 'string' && set.has(task.org_id));
}

/**
 * Resolve the durable actor identity for audit + authorization. For a customer
 * principal this is ALWAYS the server-resolved principal id — caller-supplied
 * X-Entity-Actor / X-Agent-Name / body actor fields are ignored for authority
 * and attribution (Terra B2). For the trusted service/admin path, the existing
 * header/body convention is preserved (server-trusted deployment credential).
 */
export function resolveRequestActorId(req: Request, fallback: string): string {
  const ctx = getCustomerPrincipal(req);
  if (ctx) return ctx.principalId;
  const headerActor = req.header('x-entity-actor') ?? req.header('x-agent-name');
  if (typeof headerActor === 'string' && headerActor.trim()) return headerActor.trim();
  const body = req.body as Record<string, unknown> | undefined;
  const bodyActor = body?.actor_principal_id ?? body?.actorPrincipalId ?? body?.actor;
  return typeof bodyActor === 'string' && bodyActor.trim() ? bodyActor.trim() : fallback;
}

export function resolveRequestActorType(
  req: Request,
  fallback: ReviewGateActorType,
): ReviewGateActorType {
  const ctx = getCustomerPrincipal(req);
  if (ctx) return principalTypeToActorType(ctx.principalType);
  return fallback;
}

export { toPermissionGrant as _toPermissionGrant };
