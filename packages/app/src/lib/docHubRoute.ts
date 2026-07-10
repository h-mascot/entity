export interface DocHubRouteTarget {
  sourceId: string;
  path: string;
}

const WORKSPACE_ROOTS = new Set(['output', 'memory', 'projects']);
const WORKSPACE_TABS = new Set(['files', 'agents', 'tasks', 'services', 'chat', 'admin']);

export type DocHubWorkspaceTab = 'files' | 'agents' | 'tasks' | 'services' | 'chat' | 'admin';

export function resolveWorkspaceTabRoute(pathname: string, search = ''): DocHubWorkspaceTab | null {
  if (pathname !== '/') {
    return null;
  }
  const requestedTab = new URLSearchParams(search).get('tab');
  return requestedTab && WORKSPACE_TABS.has(requestedTab)
    ? requestedTab as DocHubWorkspaceTab
    : 'files';
}

function decodePathSegments(pathname: string): string[] {
  return pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

function normalizedTarget(sourceId: string | null, path: string): DocHubRouteTarget | null {
  const normalizedPath = path.split('/').filter(Boolean).join('/');
  if (!normalizedPath || normalizedPath.includes('..') || normalizedPath.includes('~')) {
    return null;
  }

  const normalizedSourceId = sourceId?.trim() || 'workspace';
  return { sourceId: normalizedSourceId, path: normalizedPath };
}

export function resolveDocHubRouteTarget(pathname: string, search = ''): DocHubRouteTarget | null {
  const segments = decodePathSegments(pathname);
  const [root, second, ...rest] = segments;

  if (root === 'docs' && second === 'source' && rest.length >= 2) {
    const [sourceId, ...sourcePath] = rest;
    return normalizedTarget(sourceId, sourcePath.join('/'));
  }

  if (root === 'docs' && second === 'workspace' && rest.length > 0) {
    return normalizedTarget('workspace', rest.join('/'));
  }

  if (root === 'docs' && second && WORKSPACE_ROOTS.has(second) && rest.length > 0) {
    return normalizedTarget('workspace', [second, ...rest].join('/'));
  }

  if (root === 'docs' && second && rest.length > 0) {
    return normalizedTarget(second, rest.join('/'));
  }

  if (root === 'workspace' && second) {
    return normalizedTarget('workspace', [second, ...rest].join('/'));
  }

  if (root && WORKSPACE_ROOTS.has(root) && second) {
    return normalizedTarget('workspace', [root, second, ...rest].join('/'));
  }

  if (pathname !== '/') {
    return null;
  }

  const params = new URLSearchParams(search);
  const workspaceTab = resolveWorkspaceTabRoute(pathname, search);
  if (workspaceTab && workspaceTab !== 'files') {
    return null;
  }
  const filePath = params.get('file');
  return filePath ? normalizedTarget(params.get('source'), filePath) : null;
}

export function buildDocHubRoutePath(target: DocHubRouteTarget): string {
  const encodedPath = target.path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return `/docs/source/${encodeURIComponent(target.sourceId)}/${encodedPath}`;
}

export function buildDocHubExitPath(returnTaskId: unknown): string {
  return typeof returnTaskId === 'number' && Number.isSafeInteger(returnTaskId) && returnTaskId > 0
    ? `/task/${returnTaskId}`
    : '/';
}

export function shouldRestoreLastDocHubFile(pathname: string, search = ''): boolean {
  return resolveWorkspaceTabRoute(pathname, search) === 'files';
}
