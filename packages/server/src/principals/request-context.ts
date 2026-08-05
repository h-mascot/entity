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
import {
  resolveInheritedRole,
  roleMeets,
  type PermissionRole,
  type PrincipalGrant,
  type PrincipalPermissionContext,
} from '../permissions';

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

/**
 * True when no customer credential resolved (trusted service/admin path).
 *
 * R1 enforcement boundary: the production-mounted `createDataPlaneCredentialGuard`
 * (`middleware/data-plane-credential.ts`) rejects any customer data-plane request
 * that lacks a valid per-principal `x-entity-access-token` BEFORE route handlers
 * run. So when this helper returns true on a data-plane route, the request can
 * only have arrived via local dev (API auth disabled) or a misrouted path; it is
 * never reached in API-auth production for the customer data plane. Control-plane
 * routes (`/api/admin`) legitimately operate as the trusted path here.
 */
export function isTrustedServiceContext(req: Request): boolean {
  return !req.entityCustomerPrincipal;
}

/**
 * Orgs the customer principal may access. Returns null when the request is
 * the trusted service/admin path (unrestricted) OR the customer is a global
 * admin (unrestricted but still a bound individual identity).
 *
 * R1: in API-auth production the data-plane guard guarantees a customer
 * principal is present before any data-plane route handler runs, so the
 * `null` (unrestricted) trusted return is only reachable on the control plane
 * (`/api/admin`) or in local dev. It is never the result of a shared
 * bearer holder reaching the customer data plane.
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

export type TaskOperation =
  | 'read' | 'create' | 'update' | 'move' | 'comment' | 'note' | 'activity'
  | 'subtask' | 'project_link' | 'handoff' | 'merge' | 'delete' | 'review' | 'human_gate';

export interface TaskDurableScope {
  org_id?: string | null;
  team_id?: string | null;
  project_id?: number | string | null;
  projects?: Array<{ id?: number | string | null }>;
}

const TASK_ROLE_RANK: Record<PermissionRole, number> = {
  none: 0, viewer: 1, contributor: 2, manager: 3, admin: 4,
};

function requiredTaskRole(operation: TaskOperation): PermissionRole {
  if (operation === 'read') return 'viewer';
  if (operation === 'review' || operation === 'human_gate') return 'manager';
  return 'contributor';
}

/** Resolve the least privilege shared by every durable project linked to a task. */
export function effectiveTaskRole(
  ctx: CustomerPrincipalContext,
  task: TaskDurableScope,
): PermissionRole {
  if (ctx.isGlobalAdmin) return 'admin';
  const orgId = typeof task.org_id === 'string' ? task.org_id.trim() : '';
  if (!orgId) return 'none';
  const projectIds = new Set<string>();
  const addProject = (value: unknown) => {
    if ((typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.trim())) {
      projectIds.add(String(value).trim());
    }
  };
  addProject(task.project_id);
  for (const project of task.projects ?? []) addProject(project.id);
  const base = { org_id: orgId, team_id: task.team_id };
  if (projectIds.size === 0) return resolveInheritedRole(ctx.permission, base);
  let minimum: PermissionRole = 'admin';
  for (const projectId of projectIds) {
    const role = resolveInheritedRole(ctx.permission, { ...base, project_id: projectId });
    if (TASK_ROLE_RANK[role] < TASK_ROLE_RANK[minimum]) minimum = role;
  }
  return minimum;

}

export function authorizeTaskOperation(
  req: Request,
  res: Response,
  task: TaskDurableScope | null | undefined,
  operation: TaskOperation,
): boolean {
  if (isTrustedServiceContext(req)) return true;
  if (!task) {
    res.status(404).json({ error: 'task not found' });
    return false;
  }
  const role = effectiveTaskRole(getCustomerPrincipal(req)!, task);
  if (role === 'none') {
    res.status(404).json({ error: 'task not found' });
    return false;
  }
  const required = requiredTaskRole(operation);
  if (!roleMeets(role, required)) {
    sendPermissionDenied(res, `${operation} requires ${required} role`);
    return false;
  }
  return true;
}

export function authorizeTaskCreateScope(req: Request, res: Response, scope: TaskDurableScope): boolean {
  return authorizeTaskOperation(req, res, scope, 'create');
}

/** Compatibility wrapper for existing routes; operation-specific callers use authorizeTaskOperation. */
export function authorizeTaskOrg(
  req: Request,
  res: Response,
  task: TaskDurableScope | null | undefined,
  action: 'read' | 'write',
): boolean {
  return authorizeTaskOperation(req, res, task, action === 'read' ? 'read' : 'update');
}

/** Filter with the same durable-scope evaluator used by direct authorization. */
export function filterTasksForRequest<T extends TaskDurableScope>(req: Request, tasks: T[]): T[] {
  const ctx = getCustomerPrincipal(req);
  if (!ctx) return tasks;
  return tasks.filter((task) => effectiveTaskRole(ctx, task) !== 'none');
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
