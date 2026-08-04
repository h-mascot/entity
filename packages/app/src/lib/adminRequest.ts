const ADMIN_PRINCIPAL_KEY = 'entity-admin-principal-id';

export const LOCAL_ADMIN_PRINCIPAL_ID = 'entity-local-user';

export function readStoredAdminPrincipalId(): string {
  if (typeof window === 'undefined') return LOCAL_ADMIN_PRINCIPAL_ID;
  try {
    const stored = window.localStorage.getItem(ADMIN_PRINCIPAL_KEY)?.trim();
    return stored || LOCAL_ADMIN_PRINCIPAL_ID;
  } catch {
    return LOCAL_ADMIN_PRINCIPAL_ID;
  }
}

export function persistAdminPrincipalId(principalId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ADMIN_PRINCIPAL_KEY, principalId.trim());
  } catch {
    // ignore storage failures
  }
}

export function adminMutationHeaders(
  extra?: Record<string, string>,
  principalId = readStoredAdminPrincipalId(),
): Record<string, string> {
  return {
    'x-entity-principal-id': principalId,
    'x-entity-role': 'admin',
    ...extra,
  };
}
