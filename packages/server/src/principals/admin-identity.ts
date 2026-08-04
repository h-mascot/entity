import type { Request } from 'express';
import type { PrincipalRepository } from '../../../db/src/principals';
import { getEntityDatabase } from '../../../db/src/entity-db';
import { ensureAppSettingsTable } from '../config/settings-store';
import { ADMIN_SETTINGS_KEYS } from '../config/admin-settings';
import { getAdminSettings } from '../config/admin-settings-store';
import { isApiAuthEnabled } from '../middleware/api-auth';
import { resolveStoredPrincipalContext } from './resolver';

export const LOCAL_ADMIN_PRINCIPAL_ID = 'entity-local-user';

function readAccessControlSettings() {
  try {
    const db = getEntityDatabase(ensureAppSettingsTable);
    return getAdminSettings(db, ADMIN_SETTINGS_KEYS.accessControl);
  } catch {
    return null;
  }
}

export function hasGlobalAdminGrant(principalId: string, repo: PrincipalRepository): boolean {
  const stored = resolveStoredPrincipalContext(principalId, repo);
  if (stored.kind !== 'stored' || stored.status !== 'active') return false;
  return stored.principal.grants.some((grant) =>
    grant.role === 'admin'
    && !grant.org_id
    && !grant.team_id
    && !grant.project_id);
}

export function resolveTrustedAdminPrincipalId(
  req: Request,
  repo: PrincipalRepository,
): string | null {
  const principalCount = repo.listPrincipals({ includeDisabled: true }).length;
  const headerPrincipalId = req.header('x-entity-principal-id')?.trim() || null;

  if (principalCount === 0) {
    return headerPrincipalId || LOCAL_ADMIN_PRINCIPAL_ID;
  }

  if (isApiAuthEnabled()) {
    const settings = readAccessControlSettings() as { apiPrincipalId?: string | null } | null;
    const settingsPrincipalId = (typeof settings?.apiPrincipalId === 'string' ? settings.apiPrincipalId.trim() : '')
      || process.env.ENTITY_API_PRINCIPAL_ID?.trim()
      || null;
    if (settingsPrincipalId) {
      return settingsPrincipalId;
    }
    if (principalCount === 1 && headerPrincipalId) {
      const solePrincipal = repo.listPrincipals({ includeDisabled: true })[0];
      if (solePrincipal?.id === headerPrincipalId) {
        return headerPrincipalId;
      }
    }
    return null;
  }

  return headerPrincipalId || LOCAL_ADMIN_PRINCIPAL_ID;
}
