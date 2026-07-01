import fs from 'fs';
import path from 'path';

export interface LocalSourceRootGuardOptions {
  workspaceRoot?: string;
  extraAllowedRoots?: string;
}

function splitAllowedRoots(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(/[,:]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

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

export function getAllowedLocalSourceRoots(options: LocalSourceRootGuardOptions = {}): string[] {
  const workspaceRoot = options.workspaceRoot ?? process.env.WORKSPACE ?? process.cwd();
  return Array.from(
    new Set(
      [workspaceRoot, ...splitAllowedRoots(options.extraAllowedRoots ?? process.env.ENTITY_FS_LOCAL_SOURCE_ROOTS)]
        .map((entry) => path.resolve(entry)),
    ),
  );
}

export async function assertAllowedLocalSourceBasePath(
  basePath: string | undefined | null,
  options: LocalSourceRootGuardOptions = {},
): Promise<string> {
  const trimmed = basePath?.trim();
  if (!trimmed) {
    throw new Error('Local source requires basePath.');
  }

  const resolvedBasePath = path.resolve(trimmed);
  const allowedRoots = getAllowedLocalSourceRoots(options);
  const lexicalAllowed = allowedRoots.some((root) => isContainedPath(root, resolvedBasePath));
  if (!lexicalAllowed) {
    throw new Error('Local source basePath must stay inside an allowlisted root.');
  }

  const realBasePath = await fs.promises.realpath(resolvedBasePath).catch((error) => {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return resolvedBasePath;
    }
    throw error;
  });
  const realAllowedRoots = await Promise.all(
    allowedRoots.map((root) =>
      fs.promises.realpath(root).catch((error) => {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === 'ENOENT') {
          return root;
        }
        throw error;
      }),
    ),
  );

  if (!realAllowedRoots.some((root) => isContainedPath(root, realBasePath))) {
    throw new Error('Local source basePath must stay inside an allowlisted root.');
  }

  return resolvedBasePath;
}
