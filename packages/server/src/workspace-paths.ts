import fs from 'fs';
import path from 'path';

function isContainedPath(root: string, target: string): boolean {
  const relativePath = path.relative(root, target);
  return (
    relativePath === '' ||
    (
      relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath)
    )
  );
}

export async function resolveWorkspaceReadPath(rawPath: string, workspaceRoot: string): Promise<string> {
  if (rawPath.includes('\0')) {
    throw new Error('Invalid path.');
  }

  const resolvedWorkspace = path.resolve(workspaceRoot);
  const requestedPath = rawPath.trim() || resolvedWorkspace;
  const resolvedPath = path.resolve(resolvedWorkspace, requestedPath);
  if (!isContainedPath(resolvedWorkspace, resolvedPath)) {
    throw new Error('Access outside workspace is not allowed.');
  }

  const realWorkspace = await fs.promises.realpath(resolvedWorkspace);
  const realTarget = await fs.promises.realpath(resolvedPath).catch((error) => {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return resolvedPath;
    }
    throw error;
  });

  if (!isContainedPath(realWorkspace, realTarget)) {
    throw new Error('Access outside workspace is not allowed.');
  }

  return resolvedPath;
}
