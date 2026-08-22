import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FileSourceRecord, FileSourceRepository } from '../../../../db/src/file-sources';
import {
  ManagedLocalStorage,
  createManagedLocalFileReference,
  parseManagedLocalFileReference,
} from './managed-storage';

const roots: string[] = [];

function source(root: string): FileSourceRecord {
  return {
    id: 'source-local', display_name: 'Managed Local', type: 'local', base_url: null,
    base_path: root, auth_type: 'none', auth_ref: null, enabled: true, icon: null,
    capabilities: '{}', health: 'ok', last_synced_at: null,
    created_at: '2026-08-22T00:00:00.000Z', updated_at: '2026-08-22T00:00:00.000Z',
  };
}

function repository(record: FileSourceRecord): FileSourceRepository {
  return {
    listSources: () => [record], getSource: (id) => id === record.id ? record : undefined,
    createSource: () => record, updateSource: () => record, setEnabled: () => record,
    deleteSource: () => false,
  };
}

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'entity-managed-storage-'));
  roots.push(root);
  return root;
}

describe('ManagedLocalStorage', () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it('registers through a File Source and never accepts an absolute client path', async () => {
    const root = await makeRoot();
    await fs.writeFile(path.join(root, 'brief.docx'), 'document');
    const storage = new ManagedLocalStorage(repository(source(root)));

    const registered = await storage.register({ sourceId: 'source-local', relativePath: 'brief.docx' });
    expect(registered).toMatchObject({ sourceId: 'source-local', relativePath: 'brief.docx', status: 'ready' });
    expect(registered.reference).toMatch(/^file-source:v1\./);
    expect(() => parseManagedLocalFileReference(path.join(root, 'brief.docx'))).toThrow('Invalid managed local file reference');
  });

  it('reports an external move or delete as unavailable without leaking a host error', async () => {
    const root = await makeRoot();
    const file = path.join(root, 'brief.docx');
    await fs.writeFile(file, 'document');
    const storage = new ManagedLocalStorage(repository(source(root)));
    const reference = createManagedLocalFileReference({ sourceId: 'source-local', relativePath: 'brief.docx' });

    await fs.rename(file, path.join(root, 'moved.docx'));
    await expect(storage.refresh(reference)).resolves.toMatchObject({ status: 'unavailable', unavailableReason: 'file_unavailable' });
    await fs.rm(path.join(root, 'moved.docx'));
    await expect(storage.refresh(reference)).resolves.toMatchObject({ status: 'unavailable' });
  });

  it('re-resolves the managed source after a fresh storage instance (restart behavior)', async () => {
    const root = await makeRoot();
    await fs.writeFile(path.join(root, 'brief.docx'), 'document');
    const ref = createManagedLocalFileReference({ sourceId: 'source-local', relativePath: 'brief.docx' });
    const first = await new ManagedLocalStorage(repository(source(root))).refresh(ref);
    const restarted = await new ManagedLocalStorage(repository(source(root))).refresh(ref);
    expect(restarted).toEqual(first);
  });
});
