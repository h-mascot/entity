import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
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

    await expect(adapter.stat('linked-dir')).resolves.toMatchObject({
      path: 'linked-dir',
      kind: 'other',
    });
  });

  it('honors stored read-only local source capabilities', () => {
    const adapter = new LocalFileSourceAdapter(sourceFor('/workspace'));
    const readOnlyAdapter = new LocalFileSourceAdapter(
      sourceFor('/workspace', {
        capabilities: JSON.stringify({
          read: true,
          write: false,
          list: true,
          search: true,
        }),
      }),
    );

    expect(adapter.capabilities().write).toBe(true);
    expect(readOnlyAdapter.capabilities().write).toBe(false);
  });
});
