import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

let tmpDbPath: string;
const originalEnv = process.env.ENTITY_TASK_DB_PATH;

function freshDb() {
  tmpDbPath = path.join(os.tmpdir(), `entity-fs-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
}

function cleanupDb() {
  if (originalEnv !== undefined) {
    process.env.ENTITY_TASK_DB_PATH = originalEnv;
  } else {
    delete process.env.ENTITY_TASK_DB_PATH;
  }
  try { if (tmpDbPath) fs.unlinkSync(tmpDbPath); } catch {}
  try { if (tmpDbPath) fs.unlinkSync(tmpDbPath + '-wal'); } catch {}
  try { if (tmpDbPath) fs.unlinkSync(tmpDbPath + '-shm'); } catch {}
}

describe('FileSourceRepository', () => {
  beforeEach(() => freshDb());
  afterEach(() => cleanupDb());

  it('should create and retrieve a file source', async () => {
    const { createFileSourceRepository } = await import('../../../../packages/db/src/file-sources');
    const repo = createFileSourceRepository();

    const source = repo.createSource({
      display_name: 'Local Docs',
      type: 'local',
      base_path: '/home/user/docs',
    });

    expect(source.display_name).toBe('Local Docs');
    expect(source.type).toBe('local');
    expect(source.base_path).toBe('/home/user/docs');
    expect(source.enabled).toBe(true);
    expect(source.health).toBe('ok');
    expect(source.auth_type).toBe('none');

    const fetched = repo.getSource(source.id);
    expect(fetched).toBeDefined();
    expect(fetched!.display_name).toBe('Local Docs');
  });

  it('should list only enabled sources by default', async () => {
    const { createFileSourceRepository } = await import('../../../../packages/db/src/file-sources');
    const repo = createFileSourceRepository();

    repo.createSource({ display_name: 'Enabled', type: 'local', enabled: true });
    repo.createSource({ display_name: 'Disabled', type: 'local', enabled: false });

    const enabledOnly = repo.listSources();
    expect(enabledOnly.every(s => s.enabled)).toBe(true);

    const all = repo.listSources(true);
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('should update a file source', async () => {
    const { createFileSourceRepository } = await import('../../../../packages/db/src/file-sources');
    const repo = createFileSourceRepository();

    const source = repo.createSource({ display_name: 'Original', type: 'local' });
    const updated = repo.updateSource(source.id, { display_name: 'Updated', health: 'degraded' });

    expect(updated).toBeDefined();
    expect(updated!.display_name).toBe('Updated');
    expect(updated!.health).toBe('degraded');
  });

  it('should return undefined when updating non-existent source', async () => {
    const { createFileSourceRepository } = await import('../../../../packages/db/src/file-sources');
    const repo = createFileSourceRepository();
    expect(repo.updateSource('nonexistent', { display_name: 'X' })).toBeUndefined();
  });

  it('should toggle enabled state', async () => {
    const { createFileSourceRepository } = await import('../../../../packages/db/src/file-sources');
    const repo = createFileSourceRepository();

    const source = repo.createSource({ display_name: 'Toggle', type: 'local' });
    expect(source.enabled).toBe(true);

    const disabled = repo.setEnabled(source.id, false);
    expect(disabled!.enabled).toBe(false);

    const enabled = repo.setEnabled(source.id, true);
    expect(enabled!.enabled).toBe(true);
  });

  it('should delete a file source', async () => {
    const { createFileSourceRepository } = await import('../../../../packages/db/src/file-sources');
    const repo = createFileSourceRepository();

    const source = repo.createSource({ display_name: 'Deletable', type: 'local' });
    expect(repo.deleteSource(source.id)).toBe(true);
    expect(repo.deleteSource(source.id)).toBe(false);
    expect(repo.getSource(source.id)).toBeUndefined();
  });

  it('should throw on empty display_name', async () => {
    const { createFileSourceRepository } = await import('../../../../packages/db/src/file-sources');
    const repo = createFileSourceRepository();
    expect(() => repo.createSource({ display_name: '', type: 'local' })).toThrow('display_name is required');
  });

  it('should throw on invalid source type', async () => {
    const { createFileSourceRepository } = await import('../../../../packages/db/src/file-sources');
    const repo = createFileSourceRepository();
    expect(() => repo.createSource({ display_name: 'Bad', type: 'invalid' })).toThrow('Invalid source type');
  });

  it('should accept all valid source types', async () => {
    const { createFileSourceRepository, FILE_SOURCE_TYPES } = await import('../../../../packages/db/src/file-sources');
    const repo = createFileSourceRepository();

    for (const type of FILE_SOURCE_TYPES) {
      const source = repo.createSource({ display_name: `Type: ${type}`, type });
      expect(source.type).toBe(type);
    }
  });

  it('should create source with custom id', async () => {
    const { createFileSourceRepository } = await import('../../../../packages/db/src/file-sources');
    const repo = createFileSourceRepository();

    const source = repo.createSource({ id: 'my-custom-id', display_name: 'Custom', type: 'local' });
    expect(source.id).toBe('my-custom-id');
  });

  it('should handle auth types', async () => {
    const { createFileSourceRepository } = await import('../../../../packages/db/src/file-sources');
    const repo = createFileSourceRepository();

    const source = repo.createSource({
      display_name: 'Authed',
      type: 'github',
      auth_type: 'bearer',
      auth_ref: 'my-token-ref',
    });

    expect(source.auth_type).toBe('bearer');
    expect(source.auth_ref).toBe('my-token-ref');
  });
});
