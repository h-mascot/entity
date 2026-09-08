/** Decides where a task-output docs link should open. */

import type { RelativeDocHubNavigation } from './docHubRoute';

export interface DocTargetSource {
  id: string;
  enabled?: boolean;
}

export type TaskOutputDocTarget =
  | { kind: 'source'; sourceId: string; path: string }
  | { kind: 'docs-route' };

/** Scope the resolved target and canonical route together at the navigation boundary. */
export function scopeTaskOutputDocNavigation(
  navigation: RelativeDocHubNavigation,
  taskOrgId: string | null | undefined,
): RelativeDocHubNavigation {
  const routeUrl = new URL(navigation.route, 'https://entity.invalid');
  const targetOrgId = navigation.target.orgId?.trim();
  const routeOrgId = routeUrl.searchParams.get('org')?.trim();
  const scopedOrgId = targetOrgId || routeOrgId || taskOrgId?.trim();
  if (!scopedOrgId) {
    return navigation;
  }

  const target = targetOrgId
    ? navigation.target
    : { ...navigation.target, orgId: scopedOrgId };
  if (routeOrgId === scopedOrgId) {
    return target === navigation.target ? navigation : { ...navigation, target };
  }

  routeUrl.searchParams.set('org', scopedOrgId);
  return {
    ...navigation,
    target,
    route: `${routeUrl.pathname}${routeUrl.search}${routeUrl.hash}`,
  };
}

/**
 * Docs paths look like "<root>/<rest>". When the root names a configured file
 * source, open that source directly in the Doc Hub. Paths without a source
 * prefix (e.g. "output/x.md") resolve relative to the workspace root on the
 * server, so the workspace source can serve them. Anything else falls back to
 * the standalone /docs route.
 */
export function resolveTaskOutputDocTarget(
  docsPath: string,
  sources: readonly DocTargetSource[],
  fsMultiSourceEnabled: boolean,
): TaskOutputDocTarget {
  if (!fsMultiSourceEnabled) {
    return { kind: 'docs-route' };
  }

  const segments = docsPath.split('/').filter(Boolean);
  const [root, ...rest] = segments;
  const restPath = rest.join('/');
  const enabledSources = sources.filter((source) => source.enabled !== false);

  if (root && restPath && enabledSources.some((source) => source.id === root)) {
    return { kind: 'source', sourceId: root, path: restPath };
  }

  const workspaceSource = enabledSources.find((source) => source.id === 'workspace');
  if (workspaceSource && segments.length > 0) {
    return { kind: 'source', sourceId: workspaceSource.id, path: segments.join('/') };
  }

  return { kind: 'docs-route' };
}
