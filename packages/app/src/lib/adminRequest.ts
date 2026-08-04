const LOCAL_ADMIN_PRINCIPAL_ID = 'entity-local-user';

export function adminMutationHeaders(
  extra?: Record<string, string>,
  principalId = LOCAL_ADMIN_PRINCIPAL_ID,
): Record<string, string> {
  return {
    'x-entity-principal-id': principalId,
    'x-entity-role': 'admin',
    ...extra,
  };
}

export { LOCAL_ADMIN_PRINCIPAL_ID };
