import { describe, expect, it, vi } from 'vitest';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { spawn as spawnType } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { FileSourceRecord } from '../../../../db/src/file-sources';
import { ManagedStorageBrokerClientPool, ManagedStorageBrokerError } from '../managed-storage-broker';
import { LocalFileSourceAdapter } from './local';

function sourceFor(basePath: string, overrides: Partial<FileSourceRecord> = {}): FileSourceRecord {
  return {
    id: 'local-test', display_name: 'Local Test', type: 'local', base_url: null, base_path: basePath,
    auth_type: 'none', auth_ref: null, enabled: true, icon: null, capabilities: '{}', health: 'ok',
    last_synced_at: null, created_at: '2026-06-17T00:00:00.000Z', updated_at: '2026-06-17T00:00:00.000Z', ...overrides,
  };
}

function controlledBroker() {
  return {
    stat: vi.fn(async (path: string) => ({ size: path === 'guide.md' ? 8 : 0, mode: 0, isDirectory: path === '.' || path === 'docs' })),
    read: vi.fn(async () => new Uint8Array(Buffer.from('# guide\n'))),
    write: vi.fn(async () => undefined),
    exclusiveCreate: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    list: vi.fn(async () => ['guide.md', 'docs']),
  };
}

describe('LocalFileSourceAdapter managed-storage integration', () => {
  it('delegates every managed operation without using or overriding the startup root', async () => {
    const broker = controlledBroker();
    const adapter = new LocalFileSourceAdapter(sourceFor('/managed/root'), { brokerClient: broker });

    await adapter.stat('guide.md');
    await adapter.read('guide.md');
    await adapter.readRaw('guide.md');
    await adapter.write('guide.md', 'changed');
    await adapter.writeExclusive('new.md', 'new');
    await adapter.mkdir('new-folder');
    await adapter.list('');

    expect(broker.stat).toHaveBeenCalledWith('guide.md');
    expect(broker.read).toHaveBeenCalledWith('guide.md');
    expect(broker.write).toHaveBeenCalledWith('guide.md', Buffer.from('changed'));
    expect(broker.exclusiveCreate).toHaveBeenCalledWith('new.md', Buffer.from('new'));
    expect(broker.mkdir).toHaveBeenCalledWith('new-folder');
    expect(broker.list).toHaveBeenCalledWith('.');
    expect(broker.stat).not.toHaveBeenCalledWith('/other/root/guide.md');
  });

  it('validates the broker-bound root and ignores a different validation record root', async () => {
    const broker = controlledBroker();
    const adapter = new LocalFileSourceAdapter(sourceFor('/bound/root'), { brokerClient: broker });

    await adapter.validate(sourceFor('/other/root'));

    expect(broker.stat).toHaveBeenCalledWith('.');
    expect(broker.stat).not.toHaveBeenCalledWith('/other/root');
  });

  it('does not synchronously fail for a missing root and preserves typed unavailable validation', async () => {
    const broker = controlledBroker();
    broker.stat.mockRejectedValue(new ManagedStorageBrokerError('not_found'));
    const adapter = new LocalFileSourceAdapter(sourceFor('/missing/root'), { brokerClient: broker });

    expect(adapter).toBeDefined();
    await expect(adapter.validate(sourceFor('/missing/root'))).rejects.toThrow('Local source path does not exist.');
  });

  it('reports an existing file root as a directory error', async () => {
    const broker = controlledBroker();
    broker.stat.mockResolvedValue({ size: 12, mode: 0o644, isDirectory: false });
    const adapter = new LocalFileSourceAdapter(sourceFor('/existing-file'), { brokerClient: broker });

    expect(adapter).toBeDefined();
    await expect(adapter.validate(sourceFor('/existing-file'))).rejects.toThrow('Local source basePath must be a directory.');
  });

  it('preserves broker errors for operations while translating only missing-root validation', async () => {
    const broker = controlledBroker();
    broker.read.mockRejectedValue(new ManagedStorageBrokerError('io'));
    const adapter = new LocalFileSourceAdapter(sourceFor('/managed/root'), { brokerClient: broker });

    await expect(adapter.read('guide.md')).rejects.toMatchObject({ code: 'io' });
  });

  it('re-surfaces broker not_found reads as the public 404 missing-path message', async () => {
    const broker = controlledBroker();
    broker.stat.mockRejectedValue(new ManagedStorageBrokerError('not_found'));
    const adapter = new LocalFileSourceAdapter(sourceFor('/managed/root'), { brokerClient: broker });

    await expect(adapter.read('deleted.md')).rejects.toThrow('ENOENT: no such file or directory');
    await expect(adapter.readRaw('deleted.md')).rejects.toThrow('ENOENT: no such file or directory');
  });

  it('translates broker invalid (symlink escape) reads to the 403 source-root message', async () => {
    const broker = controlledBroker();
    broker.stat.mockRejectedValue(new ManagedStorageBrokerError('invalid'));
    const adapter = new LocalFileSourceAdapter(sourceFor('/managed/root'), { brokerClient: broker });

    await expect(adapter.read('read-link.md')).rejects.toThrow('Access outside source root is not allowed.');
    await expect(adapter.readRaw('read-link.md')).rejects.toThrow('Access outside source root is not allowed.');
  });

  it('applies the default 16 MiB read ceiling to oversized local reads without an explicit maxBytes', async () => {
    const broker = controlledBroker();
    broker.stat.mockResolvedValue({ size: (16 * 1024 * 1024) + 1, mode: 0o644, isDirectory: false });
    const adapter = new LocalFileSourceAdapter(sourceFor('/managed/root'), { brokerClient: broker });

    await expect(adapter.read('oversized.bin')).rejects.toThrow(
      'Source file exceeds the configured read limit of 16777216 bytes.',
    );
  });
});

// A fake broker child that mimics a real process: closing stdin (EOF) exits it,
// so ManagedStorageBrokerClient.close() resolves instead of hanging.
function liveControllableChild(): ChildProcessWithoutNullStreams {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const child = Object.assign(new EventEmitter(), { stdin, stdout }) as unknown as ChildProcessWithoutNullStreams;
  stdin.on('finish', () => child.emit('exit', 0, null));
  return child;
}

describe('LocalFileSourceAdapter broker lifecycle (reuse bounds children)', () => {
  it('reuses one broker client across many adapter constructions for the same source root and closes on teardown', async () => {
    let spawned = 0;
    const spawnMock = (() => {
      spawned += 1;
      return liveControllableChild();
    }) as unknown as typeof spawnType;
    const pool = new ManagedStorageBrokerClientPool({ spawn: spawnMock });

    // Repeated adapter construction is what every route handler and index scan
    // does. All constructions for one root must draw the same pooled client.
    const adapters: LocalFileSourceAdapter[] = [];
    for (let i = 0; i < 50; i += 1) {
      adapters.push(new LocalFileSourceAdapter(sourceFor('/managed/root'), { brokerPool: pool }));
    }
    expect(spawned).toBe(1);
    expect(pool.createdCount).toBe(1);

    // A second source root is isolated with its own child (tenant/source isolation).
    new LocalFileSourceAdapter(sourceFor('/other/root'), { brokerPool: pool });
    expect(pool.createdCount).toBe(2);

    // Teardown closes every pooled child; repeated close is idempotent and safe.
    await pool.close();
    await pool.close();
    expect(pool.size).toBe(0);
  });
});
