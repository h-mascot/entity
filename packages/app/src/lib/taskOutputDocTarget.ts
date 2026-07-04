/** Decides where a task-output docs link should open. */

export interface DocTargetSource {
  id: string;
  enabled?: boolean;
}

export type TaskOutputDocTarget =
  | { kind: 'source'; sourceId: string; path: string }
  | { kind: 'docs-route' };

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
