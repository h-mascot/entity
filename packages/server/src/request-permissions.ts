import type { Request, Response } from 'express';
import {
  buildPermissionSafeEnvelope,
  buildPermissionSafeRecordEnvelope,
  evaluatePermission,
  type PermissionAction,
  type PrincipalPermissionContext,
  type ProtectedObject,
} from './permissions';
import {
  buildLocalCompatPrincipalContext,
  resolveStoredPrincipalContext,
} from './principals/resolver';
import type { PrincipalRepository } from '../../db/src/principals';
import { createPrincipalRepository } from '../../db/src/principals';
import { isApiAuthEnabled } from './middleware/api-auth';
import { readAccessControlRuntimeSettings, readDefaultOrgId } from './config/admin-runtime';
import { LOCAL_ADMIN_PRINCIPAL_ID, resolveTrustedPrincipalId } from './principals/admin-identity';
import { getCustomerPrincipal, isOrgAuthorized } from './principals/request-context';

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
  if (typeof candidate === 'string' && candidate.trim()) {
    return candidate.trim();
  }
  return readDefaultOrgId();
}

function readEnforceStoredPrincipals(): boolean {
  try {
    return readAccessControlRuntimeSettings().enforceStoredPrincipals;
  } catch {
    return true;
  }
}

export interface ReadRequestPrincipalOptions {
  enforceStoredPrincipals?: boolean;
}

function readRequestPrincipalId(req: Request, repo?: PrincipalRepository): string {
  if (isApiAuthEnabled()) {
    const trusted = resolveTrustedPrincipalId(req, repo ?? createPrincipalRepository());
    if (!trusted) {
      return '__untrusted_principal__';
    }
    return trusted;
  }
  return req.header('x-entity-principal-id')?.trim() || LOCAL_ADMIN_PRINCIPAL_ID;
}

export function readRequestPrincipal(
  req: Request,
  orgId: string,
  repo?: PrincipalRepository,
  options?: ReadRequestPrincipalOptions,
): PrincipalPermissionContext {
  // Server-resolved customer principal wins: caller x-entity-principal-id /
  // x-entity-role headers MUST NOT override an authenticated customer identity
  // (Terra B1/B4). The customer context is attached by the customer-principal
  // middleware from a validated, individually revocable access token.
  const customer = getCustomerPrincipal(req);
  if (customer) {
    return customer.permission;
  }
  const principalId = readRequestPrincipalId(req, repo);
  const roleHeader = req.header('x-entity-role')?.trim().toLowerCase();
  const sensitivityHeader = req.header('x-entity-sensitivity') ?? undefined;
  if (principalId === '__untrusted_principal__') {
    return { principal_id: principalId, grants: [] };
  }
  const stored = resolveStoredPrincipalContext(principalId, repo);
  const enforceStored = options?.enforceStoredPrincipals ?? readEnforceStoredPrincipals();
  if (stored.kind === 'stored') {
    if (stored.status === 'disabled') {
      return stored.principal;
    }
    if (enforceStored) {
      return stored.principal;
    }
  }
  return buildLocalCompatPrincipalContext(principalId, orgId, roleHeader, sensitivityHeader);
}

export function requireRequestOrg(req: Request, res: Response, repo?: PrincipalRepository): RequestOrgBinding | null {
  const customer = getCustomerPrincipal(req);
  if (customer) {
    // Membership-derived tenant scope (Terra B4): a caller-selected org header /
    // query / body value is honored ONLY if it lies within the authenticated
    // principal's membership. It can never expand access to another tenant.
    const candidate = readRequestOrg(req);
    if (candidate && !isOrgAuthorized(req, candidate)) {
      sendPermissionDenied(res, 'requested org is outside the principal membership');
      return null;
    }
    let orgId: string | null = candidate;
    if (!orgId) {
      if (customer.isGlobalAdmin) {
        orgId = readDefaultOrgId();
      } else if (customer.orgIds.length === 1) {
        orgId = customer.orgIds[0];
      }
    }
    if (!orgId) {
      res.status(400).json({
        error: 'request org required',
        code: 'request_org_required',
        reason: 'customer principal has multiple org scopes; specify one',
      });
      return null;
    }
    return { orgId, principal: readRequestPrincipal(req, orgId, repo) };
  }
  const orgId = readRequestOrg(req);
  if (!orgId) {
    res.status(400).json({
      error: 'request org required',
      code: 'request_org_required',
    });
    return null;
  }
  return { orgId, principal: readRequestPrincipal(req, orgId, repo) };
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

export function permissionSafeRecord<T extends Record<string, unknown>>(
  binding: RequestOrgBinding,
  object: ProtectedObject,
  record: T,
  action: PermissionAction,
) {
  return buildPermissionSafeRecordEnvelope(binding.principal, object, record, action);
}
