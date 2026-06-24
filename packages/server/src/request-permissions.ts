import type { Request, Response } from 'express';
import {
  buildPermissionSafeEnvelope,
  evaluatePermission,
  type PermissionAction,
  type PrincipalPermissionContext,
  type ProtectedObject,
} from './permissions';

export interface RequestOrgBinding {
  orgId: string;
  principal: PrincipalPermissionContext;
}

export function readRequestOrg(req: Request): string | null {
  const headerOrg = req.header('x-entity-org-id') ?? req.header('x-entity-org');
  const queryOrg = typeof req.query.org_id === 'string'
    ? req.query.org_id
    : typeof req.query.orgId === 'string'
      ? req.query.orgId
      : null;
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {};
  const bodyOrg = typeof body.org_id === 'string' ? body.org_id : typeof body.orgId === 'string' ? body.orgId : null;
  const candidate = headerOrg ?? queryOrg ?? bodyOrg;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

export function readRequestPrincipal(req: Request, orgId: string): PrincipalPermissionContext {
  const principalId = req.header('x-entity-principal-id')?.trim() || 'entity-local-user';
  const roleHeader = req.header('x-entity-role')?.trim().toLowerCase();
  const role = roleHeader === 'viewer' || roleHeader === 'contributor' || roleHeader === 'manager' || roleHeader === 'admin'
    ? roleHeader
    : 'manager';
  const sensitivityHeader = req.header('x-entity-sensitivity') ?? '';
  const sensitivity_categories = sensitivityHeader
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return {
    principal_id: principalId,
    grants: [{ role, org_id: orgId, sensitivity_categories }],
  };
}

export function requireRequestOrg(req: Request, res: Response): RequestOrgBinding | null {
  const orgId = readRequestOrg(req);
  if (!orgId) {
    res.status(400).json({
      error: 'request org required',
      code: 'request_org_required',
    });
    return null;
  }
  return { orgId, principal: readRequestPrincipal(req, orgId) };
}

export function sendPermissionDenied(res: Response, reason: string): Response {
  return res.status(403).json({
    error: 'permission denied',
    code: 'permission_denied',
    reason,
  });
}

export function ensureRequestOrgMatches(
  res: Response,
  binding: RequestOrgBinding,
  objectOrgId: string | null | undefined,
): boolean {
  if (!objectOrgId || objectOrgId === binding.orgId) return true;
  sendPermissionDenied(res, 'object is outside the request org');
  return false;
}

export function ensureObjectPermission(
  res: Response,
  binding: RequestOrgBinding,
  object: ProtectedObject,
  action: PermissionAction,
): boolean {
  if (!ensureRequestOrgMatches(res, binding, object.org_id)) return false;
  const decision = evaluatePermission({ principal: binding.principal, object, action });
  if (decision.allowed) return true;
  sendPermissionDenied(res, decision.reasons[0] ?? 'access denied by object policy');
  return false;
}

export function permissionSafeObject<T extends ProtectedObject>(
  binding: RequestOrgBinding,
  object: T,
  action: PermissionAction,
) {
  return buildPermissionSafeEnvelope(binding.principal, object, action);
}
