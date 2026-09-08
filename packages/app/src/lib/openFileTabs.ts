export interface OpenFileTab {
  sourceId: string | null;
  path: string;
  orgId?: string | null;
}

function normalizeOrgId(orgId: string | null | undefined): string | null {
  const normalized = orgId?.trim();
  return normalized || null;
}

export function buildOpenFileTabKey(
  sourceId: string | null,
  path: string,
  orgId?: string | null,
): string {
  const normalizedOrgId = normalizeOrgId(orgId);
  return sourceId
    ? `${sourceId}::${normalizedOrgId ? `${normalizedOrgId}::` : ''}${path}`
    : `local::${normalizedOrgId ? `${normalizedOrgId}::` : ''}${path}`;
}

export function buildOpenFileTab(
  sourceId: string | null,
  path: string,
  orgId?: string | null,
): OpenFileTab {
  const normalizedOrgId = normalizeOrgId(orgId);
  return normalizedOrgId ? { sourceId, path, orgId: normalizedOrgId } : { sourceId, path };
}

export function filenameFromOpenFileTab(tab: OpenFileTab): string {
  const segments = tab.path.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? tab.path;
}

export function upsertOpenFileTab(tabs: OpenFileTab[], tab: OpenFileTab): OpenFileTab[] {
  const key = buildOpenFileTabKey(tab.sourceId, tab.path, tab.orgId);
  if (tabs.some((entry) => buildOpenFileTabKey(entry.sourceId, entry.path, entry.orgId) === key)) {
    return tabs;
  }
  return [...tabs, tab];
}

export function removeOpenFileTab(tabs: OpenFileTab[], tabKey: string): OpenFileTab[] {
  return tabs.filter((entry) => buildOpenFileTabKey(entry.sourceId, entry.path, entry.orgId) !== tabKey);
}
