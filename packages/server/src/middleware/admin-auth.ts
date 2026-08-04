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

export function createRequireAdminPrincipal(repo: PrincipalRepository = createPrincipalRepository()) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const principalCount = repo.listPrincipals({ includeDisabled: true }).length;
    if (principalCount === 0) {
      if (isApiAuthEnabled()) {
        const isCreatePrincipal =
          req.method === 'POST'
          && (req.path === '/principals' || req.path.endsWith('/principals'));
        if (!isCreatePrincipal) {
          res.status(403).json({
            error: 'create the first principal before other admin mutations',
            code: 'admin_bootstrap_required',
          });
          return;
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
    const isSelfBootstrapGrant =
      req.method === 'POST'
      && req.path.endsWith('/grants')
      && grantPrincipalId
      && grantPrincipalId === principalId
      && principalCount === 1
      && typeof req.body?.role === 'string'
      && req.body.role === 'admin';

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

export { LOCAL_ADMIN_PRINCIPAL_ID };
