import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const dbPaths: string[] = [];

function tempDbPath(): string {
  const dbPath = path.join(os.tmpdir(), `entity-file-index-${process.pid}-${randomUUID()}.sqlite`);
  dbPaths.push(dbPath);
  return dbPath;
}

afterEach(async () => {
  const closePath = tempDbPath();
  vi.stubEnv('ENTITY_TASK_DB_PATH', closePath);
  try {
    const { getEntityDatabase } = await import('./entity-db');
    getEntityDatabase().close();
  } catch {
    // Best-effort cleanup after a failed import.
  }

  vi.resetModules();
  vi.unstubAllEnvs();
  for (const dbPath of dbPaths.splice(0)) {
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
  }
});

describe('file index reconciliation', () => {
  it('removes paths absent from a completed source scan and keeps current paths', async () => {
    vi.resetModules();
    vi.stubEnv('ENTITY_TASK_DB_PATH', tempDbPath());
    const { createFileIndexRepository } = await import('./file-index');
    const repo = createFileIndexRepository();
    const baseRecord = {
      source_id: 'workspace',
      title: 'Document',
      type: 'one-off' as const,
      agent: 'human',
      origin: 'manual' as const,
      is_recurring: false,
    };

    repo.upsertRecord({
      ...baseRecord,
      id: 'workspace:current.md',
      path: 'current.md',
    });
    repo.upsertRecord({
      ...baseRecord,
      id: 'workspace:deleted.md',
      path: 'deleted.md',
    });

    expect(repo.reconcileSourcePaths('workspace', ['current.md'])).toBe(1);
    expect(repo.search('', { sourceId: 'workspace' }).map((record) => record.path)).toEqual(['current.md']);
  });
});
