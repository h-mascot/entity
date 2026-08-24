import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FileSourceRecord } from '../../../../db/src/file-sources';
import { ManagedStorageBrokerError, managedStorageBrokerPoolStats, resetManagedStorageBrokerPool } from '../managed-storage-broker';
import { createFileSourceAdapter } from './registry';
import { LocalFileSourceAdapter } from './local';

const brokerExecutable = path.resolve(process.cwd(), 'native/managed-storage-broker/.build/broker');

function sourceFor(basePath: string): FileSourceRecord {
  return {
    id: 'local-integrated-test', display_name: 'Integrated local test', type: 'local', base_url: null,
    base_path: basePath, auth_type: 'none', auth_ref: null, enabled: true, icon: null,
    capabilities: '{}', health: 'ok', last_synced_at: null, created_at: '2026-06-17T00:00:00.000Z',
    updated_at: '2026-06-17T00:00:00.000Z',
  };
}

describe('LocalFileSourceAdapter through the native broker IPC route', () => {
  it('rejects parent and child symlink escapes for every managed operation', async () => {
    const fixture = await mkdtemp(path.join(os.tmpdir(), 'entity-t027-'));
    const managed = path.join(fixture, 'managed');
    const outside = path.join(fixture, 'outside');
    await Promise.all([writeFile(path.join(fixture, 'sentinel'), 'outside-sentinel'),
      writeFile(path.join(fixture, 'outside-file'), 'outside-file')]);
    const { mkdir } = await import('node:fs/promises');
    await mkdir(managed); await mkdir(outside);
    await writeFile(path.join(managed, 'inside.txt'), 'inside');
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    await symlink(outside, path.join(managed, 'parent-link'));
    await symlink(path.join(outside, 'secret.txt'), path.join(managed, 'child-link'));

    const adapter = new LocalFileSourceAdapter(sourceFor(managed), { brokerExecutable });
    const rejected = [
      adapter.stat('child-link'), adapter.read('child-link'), adapter.readRaw('child-link'),
      adapter.write('child-link', 'overwrite'), adapter.writeExclusive('child-link', 'create'),
      adapter.mkdir('child-link/new-dir'), adapter.list('child-link'),
      adapter.stat('parent-link/secret.txt'), adapter.read('parent-link/secret.txt'),
      adapter.readRaw('parent-link/secret.txt'), adapter.write('parent-link/new.txt', 'write'),
      adapter.writeExclusive('parent-link/new-exclusive.txt', 'create'),
      adapter.mkdir('parent-link/new-dir'), adapter.list('parent-link'),
    ];
    for (const operation of rejected) await expect(operation).rejects.toBeInstanceOf(ManagedStorageBrokerError);
    await expect(readFile(path.join(outside, 'secret.txt'), 'utf8')).resolves.toBe('secret');
    await expect(readFile(path.join(outside, 'new.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(path.join(outside, 'new-exclusive.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(import('node:fs/promises').then(({ stat }) => stat(path.join(outside, 'new-dir')))).rejects.toMatchObject({ code: 'ENOENT' });
    await rm(fixture, { recursive: true, force: true });
  });

  it('covers normal stat/read/readRaw/write/writeExclusive/mkdir/list and preserves metadata after deletion', async () => {
    const fixture = await mkdtemp(path.join(os.tmpdir(), 'entity-t027-'));
    const managed = path.join(fixture, 'managed');
    await (await import('node:fs/promises')).mkdir(managed);
    const adapter = new LocalFileSourceAdapter(sourceFor(managed), { brokerExecutable });

    await expect(adapter.validate(sourceFor(managed))).resolves.toBeUndefined();
    await expect(adapter.stat('.')).resolves.toMatchObject({ path: '', kind: 'directory' });
    await expect(adapter.write('note.txt', 'hello')).resolves.toEqual({});
    await expect(adapter.read('note.txt')).resolves.toMatchObject({ content: 'hello', size: 5 });
    await expect(adapter.readRaw('note.txt')).resolves.toMatchObject({ content: Buffer.from('hello'), size: 5 });
    await expect(adapter.writeExclusive('new.txt', 'new')).resolves.toEqual({});
    await expect(adapter.mkdir('nested')).resolves.toBeUndefined();
    await expect(adapter.list('.')).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'note.txt', kind: 'file' }),
      expect.objectContaining({ path: 'nested', kind: 'directory' }),
    ]));

    const metadata = await adapter.stat('note.txt');
    await rm(path.join(managed, 'note.txt'));
    await expect(adapter.stat('note.txt')).rejects.toMatchObject({ code: 'not_found' });
    await expect(adapter.read('note.txt')).rejects.toMatchObject({ code: 'not_found' });
    expect(metadata).toMatchObject({ path: 'note.txt', kind: 'file', size: 5 });
    await rm(fixture, { recursive: true, force: true });
  });

  it('keeps construction non-throwing for a missing root while preserving unavailable validation', async () => {
    const fixture = await mkdtemp(path.join(os.tmpdir(), 'entity-t027-'));
    const missing = path.join(fixture, 'missing');
    const missingAdapter = new LocalFileSourceAdapter(sourceFor(missing), { brokerExecutable });
    expect(missingAdapter).toBeDefined();
    await expect(missingAdapter.validate(sourceFor(missing))).rejects.toThrow('Local source path does not exist.');
    await rm(fixture, { recursive: true, force: true });
  });

  it('keeps broker child count bounded across repeated route/index-style adapter operations and tears down', async () => {
    // Route handlers, index scans, and document providers create an adapter per
    // operation through createFileSourceAdapter. Each construction must draw the
    // same pooled broker child for one source root, never a fresh process.
    const fixture = await mkdtemp(path.join(os.tmpdir(), 'entity-t027-'));
    const managed = path.join(fixture, 'managed');
    await (await import('node:fs/promises')).mkdir(managed);
    await writeFile(path.join(managed, 'guide.md'), '# guide\n');

    const baseline = managedStorageBrokerPoolStats().created;
    try {
      for (let i = 0; i < 30; i += 1) {
        const adapter = createFileSourceAdapter(sourceFor(managed));
        await expect(adapter.stat!('.')).resolves.toMatchObject({ kind: 'directory' });
        await expect(adapter.list('.')).resolves.toEqual(expect.arrayContaining([
          expect.objectContaining({ path: 'guide.md', kind: 'file' }),
        ]));
      }
      const after = managedStorageBrokerPoolStats();
      // One new pooled child for this source; it is reused, not respawned.
      expect(after.created - baseline).toBe(1);
      // Scanning again neither grows the pool nor respawns the child.
      const stable = managedStorageBrokerPoolStats().created;
      for (let i = 0; i < 30; i += 1) {
        await createFileSourceAdapter(sourceFor(managed)).stat!('.');
      }
      expect(managedStorageBrokerPoolStats().created).toBe(stable);
    } finally {
      await resetManagedStorageBrokerPool();
      await rm(fixture, { recursive: true, force: true });
    }
  });
});
