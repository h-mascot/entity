import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { FileSourceRecord, FileSourceRepository } from '../../../../db/src/file-sources';
import type { DocumentAuthState, DocumentReadinessState } from '../../../../db/src/document-integrations';
import type { DocumentRegistry } from '../registry';
import { createManagedLocalFileReference } from './managed-storage';
import { LocalVersionWatcher, type LocalRevision } from './file-watcher';
import { LocalSafeSaveCoordinator } from './safe-save';
import { ManagedStorageBrokerError } from '../../fs/managed-storage-broker';

const originalAllowedRoots = process.env.ENTITY_FS_LOCAL_SOURCE_ROOTS;
afterEach(() => {
  if (originalAllowedRoots === undefined) delete process.env.ENTITY_FS_LOCAL_SOURCE_ROOTS;
  else process.env.ENTITY_FS_LOCAL_SOURCE_ROOTS = originalAllowedRoots;
});

const revision = (content: string): LocalRevision => {
  const contentHash = createHash('sha256').update(content).digest('hex');
  return { token: contentHash, size: content.length, modifiedAtMs: 0, contentHash };
};

function source(root = '/trusted/managed'): FileSourceRecord {
  return { id: 'source-local', display_name: 'Managed', type: 'local', base_url: null, base_path: root, auth_type: 'none', auth_ref: null, enabled: true, icon: null, capabilities: '{}', health: 'ok', last_synced_at: null, created_at: '', updated_at: '' };
}

function repository(record: FileSourceRecord): FileSourceRepository {
  return { listSources: () => [record], getSource: (id) => id === record.id ? record : undefined, createSource: () => record, updateSource: () => record, setEnabled: () => record, deleteSource: () => false };
}

function registry(workspaceId = 'workspace-a', reference = createManagedLocalFileReference({ sourceId: 'source-local', relativePath: 'document.txt' }), authState: DocumentAuthState = 'authorized', readinessState: DocumentReadinessState = 'ready'): DocumentRegistry {
  const record = { id: 'document-1', workspace_id: workspaceId, provider: 'local_office', artifact_type: 'document', provider_connection_id: null, destination_id: null, external_id: reference, title: 'document.txt', provider_url: null, owner_summary: null, tenant_external_id: null, permissions_summary_json: null, sensitivity_label: null, auth_state: authState, readiness_state: readinessState, degraded_reason_code: null, current_revision: revision('old').token, provider_modified_at: null, indexed_at: null, preview_state: 'not_requested', conflict_state: 'none', created_at: '', updated_at: '', deleted_at: null } as const;
  return { create: () => { throw new Error('unused'); }, register: () => { throw new Error('unused'); }, get: (id, workspace) => id === record.id && workspace === workspaceId ? record : undefined, findByProviderIdentity: () => undefined, update: () => undefined, rediscover: () => { throw new Error('unused'); } };
}

function broker(initial = 'old') {
  let content = Buffer.from(initial);
  let recovery: Buffer | undefined;
  let finalWindowWriter: (() => void) | undefined;
  let closes = 0;
  return {
    api: {
      read: async () => content,
      mkdir: async () => {},
      close: async () => { closes++; },
      replaceIfEqual: async (_path: string, _recovery: string, expected: Uint8Array, replacement: Uint8Array) => {
        finalWindowWriter?.();
        if (!content.equals(Buffer.from(expected))) throw new ManagedStorageBrokerError('exists');
        recovery = Buffer.from(content);
        content = Buffer.from(replacement);
        finalWindowWriter = undefined;
      },
    },
    content: () => content.toString(),
    recovery: () => recovery?.toString(),
    closes: () => closes,
    compete: (writer: () => void) => { finalWindowWriter = writer; },
    externalWrite: (value: string) => { content = Buffer.from(value); },
  };
}

function coordinator(options: { workspaceId?: string; registryWorkspaceId?: string; reference?: string; root?: string; broker?: ReturnType<typeof broker>; authState?: DocumentAuthState; readinessState?: DocumentReadinessState } = {}) {
  const managedBroker = options.broker ?? broker();
  const brokerRoots: string[] = [];
  const root = options.root ?? '/trusted/managed';
  process.env.ENTITY_FS_LOCAL_SOURCE_ROOTS = root;
  const coordinatorOptions = {
    workspaceId: options.workspaceId ?? 'workspace-a',
    repository: repository(source(root)),
    registry: registry(options.registryWorkspaceId, options.reference, options.authState, options.readinessState),
    brokerFactory: (managedRoot: string) => { brokerRoots.push(managedRoot); return managedBroker.api; },
  };
  return {
    managedBroker,
    brokerRoots,
    coordinator: new LocalSafeSaveCoordinator(coordinatorOptions),
  };
}

const request = (overrides: Partial<Parameters<LocalSafeSaveCoordinator['save']>[0]> = {}) => ({ documentId: 'document-1', candidate: 'new', expectedRevision: revision('old'), validate: () => {}, ...overrides });

describe('local version watcher and safe save', () => {
  it('deduplicates identical revisions deterministically', async () => {
    let calls = 0;
    const watcher = new LocalVersionWatcher({ inspect: async () => revision('same'), onChange: () => calls++ });
    expect(await watcher.observe()).toEqual(revision('same'));
    expect(await watcher.observe()).toBeNull();
    expect(calls).toBe(1);
    watcher.stop();
  });

  it('resolves the target from trusted workspace registry and source state', async () => {
    const { coordinator: save, managedBroker } = coordinator();
    const result = await save.save(request());
    expect(managedBroker.content()).toBe('new');
    expect(managedBroker.recovery()).toBe('old');
    expect(managedBroker.closes()).toBe(1);
    expect(result).toMatchObject({ atomicReplacement: true, linearization: 'broker-serialized-conditional-replace' });
  });

  it('rejects attacker-chosen document/root authority because paths are not request fields', async () => {
    const { coordinator: save, managedBroker, brokerRoots } = coordinator();
    const attack = { ...request(), workspaceId: 'workspace-attacker', authority: 'degraded', canonicalPath: '/tmp/attacker', approvedRoot: '/tmp' };
    await expect(save.save(attack)).resolves.toMatchObject({ atomicReplacement: true });
    expect(managedBroker.content()).toBe('new');
    expect(Object.keys(request())).not.toContain('canonicalPath');
    expect(Object.keys(request())).not.toContain('approvedRoot');
    expect(Object.keys(request())).not.toContain('workspaceId');
    expect(Object.keys(request())).not.toContain('authority');
    expect(brokerRoots).toEqual(['/trusted/managed']);
    await expect(coordinator({ workspaceId: 'workspace-attacker' }).coordinator.save(request())).rejects.toMatchObject({ code: 'scope' });
  });

  it('rejects stale writes and preserves the original', async () => {
    const managedBroker = broker('changed');
    await expect(coordinator({ broker: managedBroker }).coordinator.save(request())).rejects.toMatchObject({ code: 'stale' });
    expect(managedBroker.content()).toBe('changed');
    expect(managedBroker.closes()).toBe(1);
  });

  it('accepts a watcher-shaped revision when its content hash still matches', async () => {
    const { coordinator: save } = coordinator();
    const expectedRevision = { ...revision('old'), token: `1:2:3:4:${revision('old').contentHash}` };
    await expect(save.save(request({ expectedRevision }))).resolves.toMatchObject({ atomicReplacement: true });
  });

  it('deterministically rejects a competing writer in the final broker window', async () => {
    const managedBroker = broker();
    managedBroker.compete(() => managedBroker.externalWrite('external'));
    await expect(coordinator({ broker: managedBroker }).coordinator.save(request())).rejects.toMatchObject({ code: 'stale' });
    expect(managedBroker.content()).toBe('external');
    expect(managedBroker.recovery()).toBeUndefined();
  });

  it('uses only the registry reference even when hostile path/root properties are supplied', async () => {
    const seen: string[] = [];
    const managedBroker = broker();
    const original = managedBroker.api.replaceIfEqual;
    managedBroker.api.replaceIfEqual = async (target, recovery, expected, replacement) => {
      seen.push(target, recovery);
      return original(target, recovery, expected, replacement);
    };
    const { coordinator: save } = coordinator({ broker: managedBroker });
    const hostilePayload = { ...request(), canonicalPath: '/tmp/attacker', approvedRoot: '/tmp' };
    await save.save(hostilePayload);
    expect(seen[0]).toBe('document.txt');
    expect(seen[1]).toMatch(/^\.entity-recovery\//);
    expect(seen.join(' ')).not.toContain('/tmp/attacker');
  });

  it.each(['inspected', 'candidate_validated', 'before_replace'] as const)('crash before replacement at %s preserves the original', async (stage) => {
    const { coordinator: save, managedBroker } = coordinator();
    await expect(save.save(request({ crashAt: stage }))).rejects.toMatchObject({ code: 'crash' });
    expect(managedBroker.content()).toBe('old');
  });

  it.each(['replaced', 'reopened'] as const)('crash after replacement at %s leaves the new file and recovery valid', async (stage) => {
    const { coordinator: save, managedBroker } = coordinator();
    await expect(save.save(request({ crashAt: stage }))).rejects.toMatchObject({ code: 'crash' });
    expect(managedBroker.content()).toBe('new');
    expect(managedBroker.recovery()).toBe('old');
  });

  it('fails closed for persisted unknown/degraded authority and untrusted roots', async () => {
    for (const authState of ['unknown', 'degraded'] as const) {
      await expect(coordinator({ authState }).coordinator.save(request())).rejects.toMatchObject({ code: 'scope' });
    }
    await expect(coordinator({ readinessState: 'degraded' }).coordinator.save(request())).rejects.toMatchObject({ code: 'scope' });
    const untrusted = coordinator({ root: '/untrusted/root' }).coordinator;
    process.env.ENTITY_FS_LOCAL_SOURCE_ROOTS = '/trusted/managed';
    await expect(untrusted.save(request())).rejects.toMatchObject({ code: 'scope' });
  });
});
