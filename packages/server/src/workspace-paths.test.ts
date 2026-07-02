import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveWorkspaceReadPath } from './workspace-paths';

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'entity-workspace-read-'));
  tempRoots.push(root);
  return root;
}

describe('resolveWorkspaceReadPath', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true })));
  });

  it('rejects absolute paths outside the workspace before local file reads', async () => {
    const workspaceRoot = await makeTempRoot();

    await expect(resolveWorkspaceReadPath('/etc/passwd', workspaceRoot)).rejects.toThrow(
      'Access outside workspace is not allowed.',
    );
  });

  it('allows files inside the workspace', async () => {
    const workspaceRoot = await makeTempRoot();
    const filePath = path.join(workspaceRoot, 'notes', 'plan.md');
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, '# Plan\n', 'utf-8');

    await expect(resolveWorkspaceReadPath('notes/plan.md', workspaceRoot)).resolves.toBe(filePath);
  });

  it('rejects symlinks that resolve outside the workspace', async () => {
    const workspaceRoot = await makeTempRoot();
    const outsideRoot = await makeTempRoot();
    const outsideFile = path.join(outsideRoot, 'secret.txt');
    const linkPath = path.join(workspaceRoot, 'linked-secret.txt');
    await fs.promises.writeFile(outsideFile, 'secret', 'utf-8');
    await fs.promises.symlink(outsideFile, linkPath);

    await expect(resolveWorkspaceReadPath('linked-secret.txt', workspaceRoot)).rejects.toThrow(
      'Access outside workspace is not allowed.',
    );
  });
});
