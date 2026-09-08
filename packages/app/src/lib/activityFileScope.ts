export function resolveActivityOrgId(
  record: Record<string, unknown>,
  metadata?: string,
): string | undefined {
  let metadataOrgId: unknown;
  if (metadata) {
    try {
      const parsedMetadata = JSON.parse(metadata) as Record<string, unknown>;
      metadataOrgId = parsedMetadata.orgId ?? parsedMetadata.org_id ?? parsedMetadata.organizationId;
    } catch {
      metadataOrgId = undefined;
    }
  }

  const rawOrgId = record.orgId ?? record.org_id ?? record.organizationId ?? metadataOrgId;
  if (typeof rawOrgId !== 'string') {
    return undefined;
  }

  const normalized = rawOrgId.trim();
  return normalized || undefined;
}
