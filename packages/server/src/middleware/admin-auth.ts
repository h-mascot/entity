import type { NextFunction, Request, Response } from 'express';
import { createPrincipalRepository, type PrincipalRepository } from '../../../db/src/principals';
import { resolveStoredPrincipalContext } from '../principals/resolver';
import {
  hasGlobalAdminGrant,
  LOCAL_ADMIN_PRINCIPAL_ID,
  resolveTrustedPrincipalId,
} from '../principals/admin-identity';
import { getEntityDatabase } from '../../../db/src/entity-db';
import { ensureAppSettingsTable } from '../config/settings-store';
import { ADMIN_SETTINGS_KEYS } from '../config/admin-settings';
import { getAdminSettings } from '../config/admin-settings-store';
import { isApiAuthEnabled } from './api-auth';

function isLocalPeer(req: Request): boolean {
  const peer = req.socket?.remoteAddress ?? '';
  return peer === '127.0.0.1'
    || peer === '::1'
    || peer === '::ffff:127.0.0.1'
    || peer.endsWith('127.0.0.1');
}

function isLocalHost(req: Request): boolean {
  return isLocalPeer(req);
}

function readAllowHeaderCompat(): boolean {
  try {
    const db = getEntityDatabase(ensureAppSettingsTable);
    return getAdminSettings(db, ADMIN_SETTINGS_KEYS.accessControl).allowHeaderCompat;
  } catch {
    return true;
  }
}

function localHeaderCompatAdmin(req: Request): boolean {
  if (!isLocalHost(req) || isApiAuthEnabled() || !readAllowHeaderCompat()) return false;
  return req.header('x-entity-role')?.trim().toLowerCase() === 'admin';
}

function readGrantPrincipalIdFromPath(req: Request): string {
  const path = typeof req.path === 'string' ? req.path : '';
  const match = path.match(/\/principals\/([^/]+)\/grants\/?$/);
  return match?.[1] ?? '';
}

export const ADMIN_BOOTSTRAP_READ_LOCALS = 'entityAdminBootstrapRead';

export function createRequireAdminPrincipal(repo: PrincipalRepository = createPrincipalRepository()) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const principalCount = repo.listPrincipals({ includeDisabled: true }).length;
    if (principalCount === 0) {
      if (isApiAuthEnabled()) {
        // Normalize trailing slashes so '/principals/' is treated as the
        // collection while sub-paths ('/principals/:id', '/.../grants') are not.
        const normalizedPath = (typeof req.path === 'string' ? req.path : '').replace(/\/+$/, '') || '/';
        const isPrincipalCollection = normalizedPath === '/principals';
        const isCreatePrincipal =
          req.method === 'POST'
          && isPrincipalCollection;
        // During the empty bootstrap state the principal list is empty, so a
        // read-only GET leaks nothing and is required for the browser UI to
        // discover bootstrap state and render the create form. All other
        // (mutating) routes stay blocked until the first principal exists.
        const isBootstrapPrincipalListRead =
          req.method === 'GET'
          && isPrincipalCollection;
        if (!isCreatePrincipal && !isBootstrapPrincipalListRead) {
          res.status(403).json({
            error: 'create the first principal before other admin mutations',
            code: 'admin_bootstrap_required',
          });
          return;
        }
        // Mark the request as bootstrap-authorized so the list handler returns
        // a deterministic empty list. This removes any time-of-check/time-of-use
        // window between this count and the handler's read: once a request is
        // authorized as a bootstrap read it can never surface principal records,
        // even if a concurrent request creates the first principal mid-flight.
        if (isBootstrapPrincipalListRead) {
          const locals: Record<string, unknown> = res.locals ?? {};
          locals[ADMIN_BOOTSTRAP_READ_LOCALS] = true;
          res.locals = locals;
        }
      }
      next();
      return;
    }

    const principalId = resolveTrustedPrincipalId(req, repo);
    if (!principalId) {
      res.status(403).json({
        error: 'admin principal binding required when API auth is enabled',
        code: 'admin_principal_binding_required',
      });
      return;
    }

    const targetPrincipalId = typeof req.params.id === 'string' ? req.params.id : '';
    const grantPrincipalId = typeof req.params.principalId === 'string'
      ? req.params.principalId
      : targetPrincipalId || readGrantPrincipalIdFromPath(req);
    // The self-bootstrap carve-out authorizes the FIRST global-admin grant on
    // the sole ACTIVE principal. It is narrowed on all three axes flagged by
    // the governed review:
    //   1. The resolved sole principal must be ACTIVE (a disabled sole
    //      principal must not be able to create a fresh admin grant — that
    //      would be an authorization elevation).
    //   2. The grant body must be a GLOBAL admin grant (no org/team/project
    //      scope). A scoped grant is not a bootstrap grant and must go
    //      through normal authorization.
    //   3. The sole principal must NOT already have a global admin grant
    //      (the carve-out is for the first-grant transition only).
    // Identity was resolved unambiguously to the sole principal, so checking
    // it here is consistent with the identity/authorization separation.
    const isSelfBootstrapGrant =
      req.method === 'POST'
      && req.path.endsWith('/grants')
      && grantPrincipalId
      && grantPrincipalId === principalId
      && principalCount === 1
      && typeof req.body?.role === 'string'
      && req.body.role === 'admin'
      && req.body.org_id == null
      && req.body.team_id == null
      && req.body.project_id == null
      && !hasGlobalAdminGrant(principalId, repo)
      && storedPrincipalIsActive(principalId, repo);

    if (isSelfBootstrapGrant) {
      next();
      return;
    }

    const stored = resolveStoredPrincipalContext(principalId, repo);
    if (stored.kind === 'stored') {
      if (stored.status === 'disabled') {
        res.status(403).json({ error: 'principal disabled', code: 'principal_disabled' });
        return;
      }
      if (!hasGlobalAdminGrant(principalId, repo)) {
        res.status(403).json({ error: 'global admin grant required', code: 'admin_grant_required' });
        return;
      }
    } else if (!localHeaderCompatAdmin(req)) {
      res.status(403).json({ error: 'global admin grant required', code: 'admin_grant_required' });
      return;
    }

    if (!isApiAuthEnabled() && !isLocalHost(req)) {
      res.status(403).json({ error: 'admin mutations require API auth outside local dev', code: 'admin_api_auth_required' });
      return;
    }

    next();
  };
}

export function canUseStoredPrincipalResolution(): boolean {
  return isApiAuthEnabled();
}

export function storedPrincipalFailsClosed(principalId: string): boolean {
  const stored = resolveStoredPrincipalContext(principalId);
  return stored.kind === 'stored' && stored.status === 'disabled';
}

function storedPrincipalIsActive(principalId: string, repo: PrincipalRepository): boolean {
  const stored = resolveStoredPrincipalContext(principalId, repo);
  return stored.kind === 'stored' && stored.status === 'active';
}

export { LOCAL_ADMIN_PRINCIPAL_ID };
