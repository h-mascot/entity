import { describe, expect, it, vi } from 'vitest';
import type { FileSourceRecord } from '../../../../db/src/file-sources';
import { ManagedStorageBrokerError } from '../managed-storage-broker';
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
});
