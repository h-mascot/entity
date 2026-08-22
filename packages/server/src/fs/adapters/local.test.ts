import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileSourceRecord } from '../../../../db/src/file-sources';
import { LocalFileSourceAdapter } from './local';

const tempRoots: string[] = [];

function sourceFor(basePath: string, overrides: Partial<FileSourceRecord> = {}): FileSourceRecord {
  return {
    id: 'local-test',
    display_name: 'Local Test',
    type: 'local',
    base_url: null,
    base_path: basePath,
    auth_type: 'none',
    auth_ref: null,
    enabled: true,
    icon: null,
    capabilities: '{}',
    health: 'ok',
    last_synced_at: null,
    created_at: '2026-06-17T00:00:00.000Z',
    updated_at: '2026-06-17T00:00:00.000Z',
    ...overrides,
  };
}

async function makeTempRoot(): Promise<string> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'entity-local-adapter-'));
  tempRoots.push(root);
  return root;
}

describe('LocalFileSourceAdapter metadata', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(
      tempRoots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true }))
    );
  });

  it('does not classify symlinked directories as traversable directories', async () => {
    const root = await makeTempRoot();
    const outside = await makeTempRoot();
    await fs.promises.writeFile(path.join(outside, 'secret.md'), '# outside\n', 'utf-8');
    await fs.promises.symlink(outside, path.join(root, 'linked-dir'), 'dir');

    const adapter = new LocalFileSourceAdapter(sourceFor(root));

    await expect(adapter.list('')).resolves.toEqual([
      expect.objectContaining({
        path: 'linked-dir',
        isDirectory: false,
        kind: 'other',
      }),
    ]);

    await expect(adapter.stat('linked-dir')).rejects.toThrow('Access outside source root is not allowed.');
  });

  it('denies a source-root swap after containment validation', async () => {
    const root = await makeTempRoot();
    const outside = await makeTempRoot();
    await fs.promises.writeFile(path.join(root, 'inside.md'), '# inside\\n', 'utf-8');
    await fs.promises.writeFile(path.join(outside, 'inside.md'), '# outside\\n', 'utf-8');
    const adapter = new LocalFileSourceAdapter(sourceFor(root));
    const originalLstat = fs.promises.lstat;
    vi.spyOn(fs.promises, 'lstat').mockImplementation(async (target) => {
      await fs.promises.rename(root, `${root}-authorized`);
      await fs.promises.symlink(outside, root, 'dir');
      return originalLstat.call(fs.promises, target);
    });

    await expect(adapter.stat('inside.md')).rejects.toThrow('basePath changed during access');
    await expect(fs.promises.readFile(path.join(outside, 'inside.md'), 'utf-8')).resolves.toBe('# outside\\n');
  });

  it('rejects symlink escapes on read and write while allowing in-root files', async () => {
    const root = await makeTempRoot();
    const outside = await makeTempRoot();
    const outsideFile = path.join(outside, 'secret.md');
    await fs.promises.writeFile(path.join(root, 'inside.md'), '# inside\n', 'utf-8');
    await fs.promises.writeFile(outsideFile, '# outside\n', 'utf-8');
    await fs.promises.symlink(outsideFile, path.join(root, 'secret-link.md'));

    const adapter = new LocalFileSourceAdapter(sourceFor(root));

    await expect(adapter.readRaw('inside.md')).resolves.toMatchObject({
      content: Buffer.from('# inside\n'),
    });
    await expect(adapter.write('inside.md', '# updated\n')).resolves.toEqual({
      updatedAt: expect.any(String),
    });
    await expect(fs.promises.readFile(path.join(root, 'inside.md'), 'utf-8')).resolves.toBe('# updated\n');

    await expect(adapter.readRaw('secret-link.md')).rejects.toThrow('Access outside source root is not allowed.');
    await expect(adapter.write('secret-link.md', '# pwned\n')).rejects.toThrow('Access outside source root is not allowed.');
    await expect(fs.promises.readFile(outsideFile, 'utf-8')).resolves.toBe('# outside\n');
  });

  it('rejects writes through an allowlisted symlinked directory that resolves outside the real root', async () => {
    const root = await makeTempRoot();
    const outside = await makeTempRoot();
    vi.stubEnv('WORKSPACE', root);
    await fs.promises.symlink(outside, path.join(root, 'linked-dir'), 'dir');

    const adapter = new LocalFileSourceAdapter(sourceFor(root));

    expect(adapter.capabilities().write).toBe(true);
    await expect(adapter.write('linked-dir/pwned.md', '# pwned\n')).rejects.toThrow(
      'Access outside source root is not allowed.',
    );
    await expect(fs.promises.readdir(outside)).resolves.toEqual([]);
  });

  it('keeps configured read-only local sources readable but blocks mutations', async () => {
    const root = await makeTempRoot();
    vi.stubEnv('WORKSPACE', root);
    await fs.promises.writeFile(path.join(root, 'guide.md'), '# guide\n', 'utf-8');
    const adapter = new LocalFileSourceAdapter(
      sourceFor(root, { capabilities: JSON.stringify({ readOnly: true }) }),
    );

    expect(adapter.capabilities()).toMatchObject({ read: true, write: false, list: true, search: true });
    await expect(adapter.read('guide.md')).resolves.toMatchObject({ content: '# guide\n' });
    await expect(adapter.write('guide.md', '# changed\n')).rejects.toThrow('Local source is read-only.');
    await expect(adapter.mkdir('new-folder')).rejects.toThrow('Local source is read-only.');
    await expect(fs.promises.readFile(path.join(root, 'guide.md'), 'utf-8')).resolves.toBe('# guide\n');
  });

  it('derives write access for allowlisted roots instead of stored client JSON', () => {
    const workspaceRoot = process.env.WORKSPACE ?? process.cwd();
    const adapter = new LocalFileSourceAdapter(sourceFor(workspaceRoot));
    const clientWritableAdapter = new LocalFileSourceAdapter(
      sourceFor('/etc', {
        capabilities: JSON.stringify({
          read: true,
          write: true,
          list: true,
          search: true,
        }),
      }),
    );

    expect(adapter.capabilities()).toMatchObject({ read: true, write: true, list: true, search: true });
    expect(clientWritableAdapter.capabilities().write).toBe(false);
  });
});
