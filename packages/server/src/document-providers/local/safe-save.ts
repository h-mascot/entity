import { createHash } from 'node:crypto';
import path from 'node:path';
import type { FileSourceRepository } from '../../../../db/src/file-sources';
import type { DocumentRegistry } from '../registry';
import { parseManagedLocalFileReference } from './managed-storage';
import type { LocalRevision } from './file-watcher';
import { ManagedStorageBrokerClient, ManagedStorageBrokerError, resolveManagedStorageBrokerExecutable } from '../../fs/managed-storage-broker';
import { assertAllowedLocalSourceBasePath } from '../../fs/source-root-guard';
import { normalizeSourceRelativePath } from '../../fs/security';

export type SaveStage = 'inspected' | 'candidate_validated' | 'before_replace' | 'replaced' | 'reopened';

type ManagedSaveBroker = Pick<ManagedStorageBrokerClient, 'read' | 'mkdir' | 'replaceIfEqual' | 'close'>;

export interface SafeSaveRequest {
  documentId: string;
  candidate: string | Buffer;
  expectedRevision: LocalRevision;
  validate: (content: Buffer) => Promise<void> | void;
  crashAt?: SaveStage;
}

export interface SafeSaveResult {
  revision: LocalRevision;
  recoveryReference: string;
  atomicReplacement: true;
  linearization: 'broker-serialized-conditional-replace';
}

export interface SafeSaveCoordinatorOptions {
  /** Trusted request context resolved by the server before constructing the coordinator. */
  workspaceId: string;
  repository: FileSourceRepository;
  registry: DocumentRegistry;
  brokerFactory?: (root: string) => ManagedSaveBroker;
}

export class SafeSaveError extends Error {
  constructor(public readonly code: 'stale' | 'validation' | 'crash' | 'scope' | 'reopen', message: string) {
    super(message);
    this.name = 'SafeSaveError';
  }
}

function revisionFor(content: Uint8Array): LocalRevision {
  const contentHash = createHash('sha256').update(content).digest('hex');
  return { token: contentHash, size: content.byteLength, modifiedAtMs: 0, contentHash };
}

function crash(request: SafeSaveRequest, stage: SaveStage): void {
  if (request.crashAt === stage) throw new SafeSaveError('crash', `injected save interruption at ${stage}`);
}

function recoveryPath(relativePath: string, documentId: string): string {
  const safeId = createHash('sha256').update(documentId).digest('hex').slice(0, 24);
  return `.entity-recovery/${safeId}-${path.posix.basename(relativePath)}`;
}

/**
 * Resolve authority only from the workspace-scoped registry record and its persisted
 * File Source reference. The save payload has no filesystem path or root fields.
 *
 * The native broker provides a serialized conditional-replace linearization point.
 * Participating broker writes for the bound root share one operation lock; conditional
 * replacement compares exact expected bytes, writes recovery, and atomically renames
 * before releasing it. Arbitrary external filesystem writers cannot participate in
 * this portable contract and no generic filesystem CAS is claimed.
 */
export class LocalSafeSaveCoordinator {
  constructor(private readonly options: SafeSaveCoordinatorOptions) {}

  async save(request: SafeSaveRequest): Promise<SafeSaveResult> {
    const record = this.options.registry.get(request.documentId, this.options.workspaceId);
    if (!record || record.provider !== 'local_office' || record.auth_state !== 'authorized' || record.readiness_state !== 'ready' || !record.external_id) {
      throw new SafeSaveError('scope', 'managed save target is unavailable');
    }

    let reference: ReturnType<typeof parseManagedLocalFileReference>;
    try { reference = parseManagedLocalFileReference(record.external_id); }
    catch { throw new SafeSaveError('scope', 'managed save target is invalid'); }
    const source = this.options.repository.getSource(reference.sourceId);
    if (!source || source.type !== 'local' || !source.enabled || source.health !== 'ok' || !source.base_path) {
      throw new SafeSaveError('scope', 'managed save source is unavailable');
    }
    let managedRoot: string;
    try { managedRoot = await assertAllowedLocalSourceBasePath(source.base_path); }
    catch { throw new SafeSaveError('scope', 'managed save source is unavailable'); }

    const relativePath = normalizeSourceRelativePath(reference.relativePath);
    const broker = this.options.brokerFactory?.(managedRoot) ?? new ManagedStorageBrokerClient({
      executable: resolveManagedStorageBrokerExecutable(),
      root: managedRoot,
    });

    try {
      const before = Buffer.from(await broker.read(relativePath));
      if (revisionFor(before).contentHash !== request.expectedRevision.contentHash) {
        throw new SafeSaveError('stale', 'local file revision is stale');
      }
      crash(request, 'inspected');

      const candidate = Buffer.isBuffer(request.candidate) ? request.candidate : Buffer.from(request.candidate);
      try { await request.validate(candidate); }
      catch { throw new SafeSaveError('validation', 'candidate validation failed'); }
      crash(request, 'candidate_validated');

      const recovery = recoveryPath(relativePath, record.id);
      try { await broker.mkdir('.entity-recovery'); }
      catch (error) {
        if (!(error instanceof ManagedStorageBrokerError && error.code === 'exists')) throw error;
      }
      crash(request, 'before_replace');
      try { await broker.replaceIfEqual(relativePath, recovery, before, candidate); }
      catch (error) {
        if (error instanceof ManagedStorageBrokerError && error.code === 'exists') {
          throw new SafeSaveError('stale', 'local file revision changed during save');
        }
        throw error;
      }
      crash(request, 'replaced');

      const finalContent = Buffer.from(await broker.read(relativePath));
      if (!finalContent.equals(candidate)) throw new SafeSaveError('reopen', 'replacement could not be reopened');
      crash(request, 'reopened');
      return {
        revision: revisionFor(finalContent),
        recoveryReference: `${reference.sourceId}:${recovery}`,
        atomicReplacement: true,
        linearization: 'broker-serialized-conditional-replace',
      };
    } catch (error) {
      if (error instanceof SafeSaveError) throw error;
      throw new SafeSaveError('reopen', 'local save could not be completed');
    } finally {
      await broker.close().catch(() => undefined);
    }
  }
}
