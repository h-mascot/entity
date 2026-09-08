export function buildFileLoadKey(
  sourceId: string | null,
  filePath: string,
  orgId?: string | null,
): string {
  return JSON.stringify([sourceId, filePath, orgId?.trim() || null]);
}
