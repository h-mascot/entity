import { describe, expect, it } from 'vitest';
import type { FileSourceRecord, FileSourceType } from '../../../../db/src/file-sources';
import { createFileSourceAdapter } from './registry';

function record(type: FileSourceType, overrides: Partial<FileSourceRecord> = {}): FileSourceRecord {
  const timestamp = '2026-08-26T00:00:00.000Z';
  return {
    id: `${type}-source`,
    display_name: `${type} upstream`,
    type,
    base_url: 'https://example.com/upstream',
    base_path: null,
    auth_type: 'none',
    auth_ref: null,
    enabled: true,
    icon: null,
    capabilities: '{}',
    health: 'ok',
    last_synced_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  };
}

describe('placeholder connector adapters', () => {
  it.each(['github', 's3', 'custom'] as const)('reports the %s connector as not implemented', async (type) => {
    const registry = await import('./registry');
    expect(registry.isFileSourceTypeImplemented(type)).toBe(false);
  });

  it.each(['local', 'docsify', 'http-markdown'] as const)('reports the %s connector as implemented', async (type) => {
    const registry = await import('./registry');
    expect(registry.isFileSourceTypeImplemented(type)).toBe(true);
  });

  it.each(['github', 's3', 'custom'] as const)('advertises no capabilities for the %s placeholder', (type) => {
    const adapter = createFileSourceAdapter(record(type));
    expect(adapter.capabilities()).toEqual({
      read: false,
      write: false,
      rename: false,
      delete: false,
      list: false,
      search: false,
    });
  });

  it.each(['github', 's3', 'custom'] as const)(
    'rejects %s connector operations with a typed CONNECTOR_NOT_IMPLEMENTED error',
    async (type) => {
      const adapter = createFileSourceAdapter(record(type));

      const operations: Array<() => Promise<unknown>> = [
        () => adapter.validate(record(type)),
        () => adapter.list(''),
        () => adapter.read('docs/readme.md'),
        () => adapter.write('docs/readme.md', 'content'),
        () => adapter.mkdir('docs'),
      ];

      for (const operation of operations) {
        await expect(operation()).rejects.toMatchObject({
          name: 'ConnectorNotImplementedError',
          code: 'CONNECTOR_NOT_IMPLEMENTED',
          connectorType: type,
        });
      }
    }
  );

  it('keeps truthful real capabilities for implemented connectors', () => {
    const local = createFileSourceAdapter(record('local', { base_path: process.cwd() }));
    expect(local.capabilities().read).toBe(true);
    expect(local.capabilities().list).toBe(true);
  });
});
