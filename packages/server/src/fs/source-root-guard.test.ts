import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertAllowedLocalSourceBasePath, isBasePathAllowlisted } from './source-root-guard';

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'entity-source-root-'));
  tempRoots.push(root);
  return root;
}

describe('assertAllowedLocalSourceBasePath', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true })));
  });

  it('rejects local source roots outside the configured workspace allowlist', async () => {
    const workspaceRoot = await makeTempRoot();

    await expect(assertAllowedLocalSourceBasePath('/etc', { workspaceRoot })).rejects.toThrow(
      'Local source basePath must stay inside an allowlisted root.',
    );
  });

  it('accepts workspace-relative local source roots', async () => {
    const workspaceRoot = await makeTempRoot();
    const docsRoot = path.join(workspaceRoot, 'docs');
    await fs.promises.mkdir(docsRoot);

    await expect(assertAllowedLocalSourceBasePath(docsRoot, { workspaceRoot })).resolves.toBe(docsRoot);
  });

  it('accepts explicitly configured extra allowlist roots', async () => {
    const workspaceRoot = await makeTempRoot();
    const externalRoot = await makeTempRoot();

    await expect(
      assertAllowedLocalSourceBasePath(externalRoot, {
        workspaceRoot,
        extraAllowedRoots: externalRoot,
      }),
    ).resolves.toBe(externalRoot);
  });

  it('checks local source allowlist containment synchronously', async () => {
    const workspaceRoot = await makeTempRoot();

    expect(isBasePathAllowlisted(path.join(workspaceRoot, 'docs'), { workspaceRoot })).toBe(true);
    expect(isBasePathAllowlisted('/etc', { workspaceRoot })).toBe(false);
  });
});
