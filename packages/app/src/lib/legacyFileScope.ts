export function normalizeOptionalOrgId(orgId?: string | null): string | undefined {
  const normalized = orgId?.trim();
  return normalized || undefined;
}

/**
 * Keep the legacy compatibility header for ordinary ASCII organization IDs.
 * Fetch headers are ByteStrings, so non-ASCII/control IDs must use the URL or
 * JSON scope already carried by the caller instead of throwing before request.
 */
export function orgScopeHeaders(orgId?: string | null): Record<string, string> {
  const normalized = normalizeOptionalOrgId(orgId);
  if (!normalized || /[^\x20-\x7e]/.test(normalized)) {
    return {};
  }
  return { 'x-entity-org-id': normalized };
}

/**
 * Keep an existing valid organization, auto-selecting only the sole available
 * organization. Multiple organizations require an explicit user choice.
 */
export function resolveLegacyFileOrgSelection(
  currentOrgId: string | null | undefined,
  availableOrgIds: readonly string[],
): string | undefined {
  const normalizedCurrent = normalizeOptionalOrgId(currentOrgId ?? undefined);
  const normalizedAvailable = availableOrgIds
    .map((orgId) => normalizeOptionalOrgId(orgId))
    .filter((orgId): orgId is string => Boolean(orgId));
  if (normalizedCurrent && normalizedAvailable.includes(normalizedCurrent)) {
    return normalizedCurrent;
  }
  return normalizedAvailable.length === 1 ? normalizedAvailable[0] : undefined;
}

export function appendOrgScope(path: string, orgId?: string): string {
  const normalized = normalizeOptionalOrgId(orgId);
  if (!normalized) return path;
  return `${path}${path.includes('?') ? '&' : '?'}orgId=${encodeURIComponent(normalized)}`;
}

export function withOrgScope(init: RequestInit | undefined, orgId?: string): RequestInit | undefined {
  const normalized = normalizeOptionalOrgId(orgId);
  if (!normalized) return init;
  const headers = new Headers(init?.headers);
  const plainHeaders: Record<string, string> = {};
  headers.forEach((value, key) => {
    plainHeaders[key] = value;
  });
  delete plainHeaders['x-entity-org'];
  delete plainHeaders['x-entity-org-id'];
  Object.assign(plainHeaders, orgScopeHeaders(normalized));
  return { ...init, headers: plainHeaders };
}

export function buildOrgScopedRequestIdentity(orgId: string | undefined, ...parts: unknown[]): string {
  return JSON.stringify([normalizeOptionalOrgId(orgId) ?? '', ...parts]);
}

export function isOrgScopedRequestCurrent(
  requestId: number,
  currentRequestId: number,
  requestIdentity: string,
  currentIdentity: string,
): boolean {
  return requestId === currentRequestId && requestIdentity === currentIdentity;
}
