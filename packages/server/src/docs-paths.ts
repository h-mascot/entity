import path from 'path';

export function buildDocsRootCandidates(
  rootKey: string,
  configuredRoot: string,
  workspaces: string[]
): string[] {
  const workspaceCandidates = workspaces.map((workspace) => {
    if (rootKey === 'output') return path.join(workspace, 'output');
    if (rootKey === 'memory') return path.join(workspace, 'memory');
    return workspace;
  });

  return [configuredRoot, ...workspaceCandidates].filter(
    (value, index, list) => list.indexOf(value) === index
  );
}
