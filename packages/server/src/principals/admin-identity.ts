import type { Request } from 'express';
import type { PrincipalRepository } from '../../../db/src/principals';
import { getEntityDatabase } from '../../../db/src/entity-db';
import { ensureAppSettingsTable } from '../config/settings-store';
import { ADMIN_SETTINGS_KEYS } from '../config/admin-settings';
import { getAdminSettings } from '../config/admin-settings-store';
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

export function resolveTrustedPrincipalId(
  req: Request,
  repo: PrincipalRepository,
): string | null {
  const principalCount = repo.listPrincipals({ includeDisabled: true }).length;
  const headerPrincipalId = req.header('x-entity-principal-id')?.trim() || null;

  if (principalCount === 0) {
    return headerPrincipalId || LOCAL_ADMIN_PRINCIPAL_ID;
  }

  // Server-trusted binding via the persisted accessControl.apiPrincipalId
  // setting (or the ENTITY_API_PRINCIPAL_ID env fallback). This is consulted
  // in BOTH API-auth and local-dev modes so the authorization does not depend
  // on a client-supplied x-entity-role header once a stored principal exists.
  // This is the root-cause fix for the "Failed to load principals (403)"
  // regression: previously local-dev mode ignored the persisted binding and
  // always fell back to LOCAL_ADMIN_PRINCIPAL_ID (no stored row), which made
  // the admin middleware 403 unless the browser sent x-entity-role: admin.
  //
  // A persisted binding is a SERVER trust decision, so it must be validated
  // against the repository: if it points at a missing or disabled principal
  // the binding is broken and the resolver MUST fail closed (return null).
  // Falling through to the local-dev header path on a broken binding would
  // resurrect the legacy client-header authorization that the task forbids.
  const settings = readAccessControlSettings() as { apiPrincipalId?: string | null } | null;
  const settingsPrincipalId = (typeof settings?.apiPrincipalId === 'string' ? settings.apiPrincipalId.trim() : '')
    || process.env.ENTITY_API_PRINCIPAL_ID?.trim()
    || null;
  if (settingsPrincipalId) {
    const bound = resolveStoredPrincipalContext(settingsPrincipalId, repo);
    if (bound.kind === 'stored' && bound.status === 'active') {
      return settingsPrincipalId;
    }
    // Broken binding (missing or disabled target): fail closed in BOTH modes.
    // Do NOT fall through to header/local-dev compat — that would let a stale
    // binding silently re-enable client-header authorization.
    return null;
  }

  // Self-heal: when exactly one stored principal exists, it is unambiguously
  // the identity of every admin request (there is no other candidate to pick
  // between). The resolver returns that identity; the admin middleware then
  // independently enforces grant/status checks (global admin grant required,
  // principal disabled, self-bootstrap grant carve-out). This keeps identity
  // resolution decoupled from authorization and avoids trusting any client
  // header once a stored principal exists. It also repairs sandboxes
  // bootstrapped before the apiPrincipalId persistence fix without a DB
  // migration, and keeps the self-bootstrap grant POST reachable (the sole
  // principal has no grant yet at that instant, but the middleware's
  // isSelfBootstrapGrant carve-out authorizes the grant creation).
  if (principalCount === 1) {
    const solePrincipal = repo.listPrincipals({ includeDisabled: true })[0];
    if (solePrincipal) {
      return solePrincipal.id;
    }
  }

  // Once stored principals exist, a missing/ambiguous server identity MUST
  // fail closed in BOTH API-auth and local-dev modes. Returning a client-
  // supplied x-entity-principal-id or LOCAL_ADMIN_PRINCIPAL_ID here would let
  // any localhost caller spoof an admin identity (resolved as local_compat,
  // then authorized via the client-supplied x-entity-role: admin header) —
  // exactly the elevation the task forbids once a stored principal exists.
  // The operator must re-establish a binding via the bootstrap flow (reduce
  // to a sole principal, or set accessControl.apiPrincipalId explicitly).
  return null;
}

/** @deprecated Use resolveTrustedPrincipalId */
export function resolveTrustedAdminPrincipalId(
  req: Request,
  repo: PrincipalRepository,
): string | null {
  return resolveTrustedPrincipalId(req, repo);
}
