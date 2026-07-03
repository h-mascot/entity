export interface OpenFileTab {
  sourceId: string | null;
  path: string;
}

export function buildOpenFileTabKey(sourceId: string | null, path: string): string {
  return sourceId ? `${sourceId}::${path}` : `local::${path}`;
}

export function buildOpenFileTab(sourceId: string | null, path: string): OpenFileTab {
  return { sourceId, path };
}

export function filenameFromOpenFileTab(tab: OpenFileTab): string {
  const segments = tab.path.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? tab.path;
}

export function upsertOpenFileTab(tabs: OpenFileTab[], tab: OpenFileTab): OpenFileTab[] {
  const key = buildOpenFileTabKey(tab.sourceId, tab.path);
  if (tabs.some((entry) => buildOpenFileTabKey(entry.sourceId, entry.path) === key)) {
    return tabs;
  }
  return [...tabs, tab];
}

export function removeOpenFileTab(tabs: OpenFileTab[], tabKey: string): OpenFileTab[] {
  return tabs.filter((entry) => buildOpenFileTabKey(entry.sourceId, entry.path) !== tabKey);
}
