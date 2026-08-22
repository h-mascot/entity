import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createDocumentIntegrationsRepository } from '../../../../db/src/document-integrations';
import { createDocumentRegistry } from '../registry';
import { afterEach, describe, expect, it } from 'vitest';
import type { FileSourceRecord, FileSourceRepository } from '../../../../db/src/file-sources';
import type { DocumentRegistry } from '../registry';
import { ManagedLocalStorage, createManagedLocalFileReference, parseManagedLocalFileReference } from './managed-storage';

const roots: string[] = [];
const originalAllowedRoots = process.env.ENTITY_FS_LOCAL_SOURCE_ROOTS;
function source(root: string): FileSourceRecord { return { id: 'source-local', display_name: 'Managed Local', type: 'local', base_url: null, base_path: root, auth_type: 'none', auth_ref: null, enabled: true, icon: null, capabilities: '{}', health: 'ok', last_synced_at: null, created_at: '', updated_at: '' }; }
function repository(record: FileSourceRecord): FileSourceRepository { return { listSources: () => [record], getSource: (id) => id === record.id ? record : undefined, createSource: () => record, updateSource: () => record, setEnabled: () => record, deleteSource: () => false }; }
function documentRegistry(): DocumentRegistry { return { create: () => { throw new Error('unused'); }, register: (input, workspaceId) => ({ created: true, record: { id: `doc-${workspaceId}`, workspace_id: workspaceId, ...input, provider_connection_id: input.provider_connection_id ?? null, destination_id: null, external_id: input.external_id ?? null, provider_url: null, owner_summary: null, tenant_external_id: null, permissions_summary_json: null, sensitivity_label: null, degraded_reason_code: null, provider_modified_at: null, indexed_at: null, preview_state: 'not_requested', conflict_state: 'none', created_at: '', updated_at: '', deleted_at: null } } as never), get: () => undefined, findByProviderIdentity: () => undefined, update: () => undefined, rediscover: () => { throw new Error('unused'); } }; }
async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'entity-managed-storage-'));
  roots.push(root);
  process.env.ENTITY_FS_LOCAL_SOURCE_ROOTS = root;
  return root;
}

describe('ManagedLocalStorage', () => {
  afterEach(async () => {
    if (originalAllowedRoots === undefined) delete process.env.ENTITY_FS_LOCAL_SOURCE_ROOTS;
    else process.env.ENTITY_FS_LOCAL_SOURCE_ROOTS = originalAllowedRoots;
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });
  it('registers through File Sources and the Entity document registry, rejecting raw absolute paths', async () => {
    const root = await makeRoot(); await fs.writeFile(path.join(root, 'brief.docx'), 'document');
    const storage = new ManagedLocalStorage(repository(source(root)), documentRegistry());
    const registered = await storage.register({ sourceId: 'source-local', relativePath: 'brief.docx', workspaceId: 'workspace-a' });
    expect(registered).toMatchObject({ sourceId: 'source-local', relativePath: 'brief.docx', status: 'ready', documentId: 'doc-workspace-a' });
    await expect(storage.register({ sourceId: 'source-local', relativePath: 'nested/../brief.docx', workspaceId: 'workspace-a' })).resolves.toMatchObject({ status: 'ready' });
    for (const relativePath of [path.join(root, 'brief.docx'), '/etc/passwd', 'C:\\Users\\Henry\\brief.docx', '\\\\server\\share\\brief.docx']) {
      await expect(storage.register({ sourceId: 'source-local', relativePath, workspaceId: 'workspace-a' })).rejects.toThrow('source-relative');
    }
    expect(() => parseManagedLocalFileReference(path.join(root, 'brief.docx'))).toThrow('Invalid managed local file reference');
  });
  it('fails closed for disabled, unhealthy, and mismatched sources without leaking details', async () => {
    const root = await makeRoot(); await fs.writeFile(path.join(root, 'brief.docx'), 'document');
    const ref = createManagedLocalFileReference({ sourceId: 'source-local', relativePath: 'brief.docx' });
    const disabled = new ManagedLocalStorage(repository({ ...source(root), enabled: false }), documentRegistry());
    expect(await disabled.refresh(ref)).toMatchObject({ status: 'unavailable', unavailableReason: 'source_unavailable' });
    const unhealthy = new ManagedLocalStorage(repository({ ...source(root), health: 'degraded' }), documentRegistry());
    expect(await unhealthy.refresh(ref)).toMatchObject({ status: 'unavailable', unavailableReason: 'source_unavailable' });
    const errored = new ManagedLocalStorage(repository({ ...source(root), health: 'error' }), documentRegistry());
    expect(await errored.refresh(ref)).toMatchObject({ status: 'unavailable', unavailableReason: 'source_unavailable' });
    const mismatched = new ManagedLocalStorage(repository({ ...source(root), type: 'custom' }), documentRegistry());
    expect(await mismatched.refresh(ref)).toMatchObject({ status: 'unavailable', unavailableReason: 'source_unavailable' });
  });
  it('rejects an unallowlisted source root before adapter filesystem access', async () => {
    const root = await makeRoot(); await fs.writeFile(path.join(root, 'brief.docx'), 'document');
    const ref = createManagedLocalFileReference({ sourceId: 'source-local', relativePath: 'brief.docx' });
    delete process.env.ENTITY_FS_LOCAL_SOURCE_ROOTS;
    const storage = new ManagedLocalStorage(repository(source(root)), documentRegistry());
    expect(await storage.refresh(ref)).toMatchObject({ status: 'unavailable', unavailableReason: 'file_unavailable' });
  });
  it('persists unavailable state through the real registry and preserves workspace isolation', async () => {
    const root = await makeRoot(); const file = path.join(root, 'brief.docx'); await fs.writeFile(file, 'document');
    const db = new Database(':memory:');
    const dbRepository = createDocumentIntegrationsRepository(db); dbRepository.ensureSchema();
    const registry = createDocumentRegistry(db);
    const storage = new ManagedLocalStorage(repository(source(root)), registry);
    const first = await storage.register({ sourceId: 'source-local', relativePath: 'brief.docx', workspaceId: 'workspace-a' });
    expect(first.documentId).toBeTruthy();
    await expect(storage.register({ sourceId: 'source-local', relativePath: 'brief.docx', workspaceId: 'workspace-b' })).rejects.toThrow(/different workspace|isolation/i);
    await fs.rm(file);
    const unavailable = await storage.register({ sourceId: 'source-local', relativePath: 'brief.docx', workspaceId: 'workspace-a' });
    expect(unavailable).toMatchObject({ status: 'unavailable', documentId: first.documentId });
    expect(registry.get(first.documentId!, 'workspace-a')).toMatchObject({ readiness_state: 'degraded', current_revision: expect.any(String) });
    const crossWorkspace = await storage.register({ sourceId: 'source-local', relativePath: 'brief.docx', workspaceId: 'workspace-b' });
    expect(crossWorkspace.documentId).toBeUndefined();
    expect(registry.get(first.documentId!, 'workspace-a')?.workspace_id).toBe('workspace-a');
    db.close();
  });

  it('reports move/delete as sanitized unavailable and recovers after restart', async () => {
    const root = await makeRoot(); const file = path.join(root, 'brief.docx'); await fs.writeFile(file, 'document');
    const ref = createManagedLocalFileReference({ sourceId: 'source-local', relativePath: 'brief.docx' });
    const storage = new ManagedLocalStorage(repository(source(root)), documentRegistry());
    expect(await storage.refresh(ref)).toMatchObject({ status: 'ready' });
    const outside = path.join(root, '..', 'entity-managed-storage-outside.txt');
    await fs.writeFile(outside, 'outside');
    await fs.symlink(outside, path.join(root, 'escape.docx'));
    const escape = createManagedLocalFileReference({ sourceId: 'source-local', relativePath: 'escape.docx' });
    expect(await storage.refresh(escape)).toMatchObject({ status: 'unavailable', unavailableReason: 'file_unavailable' });
    await fs.rm(outside, { force: true });
    await fs.rename(file, path.join(root, 'moved.docx'));
    expect(await storage.refresh(ref)).toMatchObject({ status: 'unavailable', unavailableReason: 'file_unavailable' });
    await fs.rm(path.join(root, 'moved.docx'));
    expect(await new ManagedLocalStorage(repository(source(root)), documentRegistry()).refresh(ref)).toMatchObject({ status: 'unavailable' });
  });
});
