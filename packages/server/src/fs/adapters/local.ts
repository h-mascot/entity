import path from 'path';
import type { FileSourceRecord } from '../../../../db/src/file-sources';
import { detectContentType } from '../../file-types';
import { ManagedStorageBrokerClient, ManagedStorageBrokerClientPool, ManagedStorageBrokerError, acquireManagedStorageBrokerClient, resolveManagedStorageBrokerExecutable, type BrokerStat } from '../managed-storage-broker';
import { isBasePathAllowlisted } from '../source-root-guard';
import { normalizeSourceRelativePath } from '../security';
import { DEFAULT_SOURCE_READ_LIMIT_BYTES, SourceReadLimitError } from './bounded-read';
import type { FileSourceAdapter, SourceCapability, SourceNode, SourcePathMetadata, SourceReadOptions } from './types';

type ManagedStorageOperations = Pick<ManagedStorageBrokerClient, 'stat' | 'read' | 'write' | 'exclusiveCreate' | 'mkdir' | 'list'>;

export type LocalFileSourceAdapterOptions = {
  brokerClient?: ManagedStorageOperations;
  brokerExecutable?: string;
  /**
   * Broker client pool to draw from (defaults to the per-process pool). Use to
   * bound child-process creation and to close pooled clients in tests.
   */
  brokerPool?: ManagedStorageBrokerClientPool;
};

function sourceIsReadOnly(source: FileSourceRecord): boolean {
  try {
    const parsed = JSON.parse(source.capabilities) as { readOnly?: unknown };
    return parsed.readOnly === true;
  } catch {
    return false;
  }
}

export const LOCAL_SOURCE_CAPABILITY_POLICY: SourceCapability = {
  read: true, write: false, rename: false, delete: false, list: true, search: true,
};

export function deriveLocalSourceCapabilities(basePath: string | undefined | null, options: { readOnly?: boolean } = {}): SourceCapability {
  return { ...LOCAL_SOURCE_CAPABILITY_POLICY, write: !options.readOnly && isBasePathAllowlisted(basePath) };
}

export function localSourceCapabilitiesJson(basePath?: string | null, options: { readOnly?: boolean } = {}): string {
  return JSON.stringify({ ...deriveLocalSourceCapabilities(basePath, options), readOnly: options.readOnly === true });
}

function normalizePath(relativePath: string): string {
  return normalizeSourceRelativePath(relativePath);
}

function unavailable(error: unknown, message: string): Error {
  // A broker whose startup root cannot be opened exits before it can emit a
  // typed response. Keep the public validation contract explicit in that case.
  if (error instanceof ManagedStorageBrokerError && error.code === 'not_found') return new Error(message);
  if (error instanceof Error && error.message === 'managed storage broker exited') return new Error(message);
  return error instanceof Error ? error : new Error(message);
}

// The broker describes failures with a small typed error-code vocabulary. The
// route layer, however, maps HTTP statuses from human-readable error messages.
// Re-surface the broker's typed failures as ManagedStorageBrokerError with the
// same typed code but a message the routes already recognize, so the public
// status codes and bodies are preserved without losing the typed code:
//   - not_found -> 404 (missing file), via the "no such file" contract.
//   - invalid   -> 403 (symlink/invalid descriptor-relative target), fail-closed.
function translateBrokerReadError(error: unknown): Error {
  if (error instanceof ManagedStorageBrokerError) {
    if (error.code === 'not_found') return new ManagedStorageBrokerError('not_found', 'ENOENT: no such file or directory');
    if (error.code === 'invalid') return new ManagedStorageBrokerError('invalid', 'Access outside source root is not allowed.');
  }
  return error instanceof Error ? error : new Error(String(error));
}

function unboundedReadLimit(): number {
  return DEFAULT_SOURCE_READ_LIMIT_BYTES;
}

export class LocalFileSourceAdapter implements FileSourceAdapter {
  readonly key = 'local';
  private readonly source: FileSourceRecord;
  private readonly broker: ManagedStorageOperations;

  constructor(source: FileSourceRecord, options: LocalFileSourceAdapterOptions = {}) {
    this.source = source;
    // Reuse a pooled broker child (per executable+root) unless a specific client
    // was injected, so repeated adapter construction for the same source does not
    // spawn a fresh long-lived broker process each time.
    this.broker = options.brokerClient
      ?? options.brokerPool?.acquire({
        executable: options.brokerExecutable ?? resolveManagedStorageBrokerExecutable(),
        root: source.base_path?.trim() ?? '',
      })
      ?? acquireManagedStorageBrokerClient({
        executable: options.brokerExecutable ?? resolveManagedStorageBrokerExecutable(),
        root: source.base_path?.trim() ?? '',
      });
  }

  async validate(source: FileSourceRecord): Promise<void> {
    const basePath = source.base_path?.trim();
    if (!basePath) throw new Error('Local source basePath is not configured.');
    let stats;
    try {
      stats = await this.broker.stat('.');
    } catch (error) {
      if (error instanceof ManagedStorageBrokerError && error.code === 'invalid') {
        throw new Error('Local source basePath must be a directory.');
      }
      throw unavailable(error, 'Local source path does not exist.');
    }
    if (!stats.isDirectory) throw new Error('Local source basePath must be a directory.');
  }

  private assertWritable(): void {
    if (sourceIsReadOnly(this.source)) throw new Error('Local source is read-only.');
  }

  capabilities(): SourceCapability {
    return deriveLocalSourceCapabilities(this.source.base_path, { readOnly: sourceIsReadOnly(this.source) });
  }

  async stat(relativePath: string): Promise<SourcePathMetadata> {
    const normalized = normalizePath(relativePath);
    const stats = await this.broker.stat(normalized || '.');
    const name = normalized ? path.posix.basename(normalized) : path.posix.basename(this.source.base_path?.replace(/[\\/]+$/, '') ?? '');
    return { sourceId: this.source.id, path: normalized, name, kind: stats.isDirectory ? 'directory' : 'file', size: stats.isDirectory ? undefined : stats.size };
  }

  async list(relativePath: string): Promise<SourceNode[]> {
    const normalized = normalizePath(relativePath);
    const names = await this.broker.list(normalized || '.');
    const nodes = await Promise.all(names.filter((name) => !name.startsWith('.')).map(async (name): Promise<SourceNode | null> => {
      const childPath = normalized ? `${normalized}/${name}` : name;
      try {
        const stats = await this.broker.stat(childPath);
        const isDirectory = stats.isDirectory;
        return { sourceId: this.source.id, path: childPath, name, isDirectory, kind: isDirectory ? 'directory' : 'file', size: isDirectory ? undefined : stats.size } satisfies SourceNode;
      } catch (error) {
        // Directory listings can legitimately contain child symlinks, which the
        // broker rejects fail-closed, or entries removed between list and stat.
        // Omit only those inaccessible children; preserve IO/limit failures so
        // a real broker fault cannot masquerade as an empty/partial directory.
        if (error instanceof ManagedStorageBrokerError && (error.code === 'invalid' || error.code === 'not_found')) {
          return null;
        }
        throw error;
      }
    }));
    return nodes.filter((node): node is SourceNode => node !== null)
      .sort((a, b) => a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1);
  }

  private async readBytes(relativePath: string, options?: SourceReadOptions): Promise<{ content: Buffer; size: number }> {
    const normalized = normalizePath(relativePath);
    if (!normalized) throw new Error('Path is required.');
    let stats: BrokerStat;
    try {
      stats = await this.broker.stat(normalized);
    } catch (error) {
      throw translateBrokerReadError(error);
    }
    if (stats.isDirectory) throw new Error('Target path is not a file.');
    // Enforce the same shared hard ceiling the unbounded route path guarantees,
    // so an oversized local read yields 413 (not a broker 500) with the standard
    // read-limit message when no explicit maxBytes is supplied.
    const maxBytes = options?.maxBytes === undefined || !Number.isFinite(options.maxBytes) || options.maxBytes < 1
      ? unboundedReadLimit()
      : Math.min(Math.floor(options.maxBytes), unboundedReadLimit());
    if (stats.size > maxBytes) throw new SourceReadLimitError(maxBytes);
    let content: Uint8Array;
    try {
      content = await this.broker.read(normalized);
    } catch (error) {
      throw translateBrokerReadError(error);
    }
    return { content: Buffer.from(content), size: stats.size };
  }

  async read(relativePath: string, options?: SourceReadOptions) {
    const normalized = normalizePath(relativePath);
    const { content, size } = await this.readBytes(normalized, options);
    const detected = detectContentType({ filePath: normalized, content });
    return { content: detected.isBinary ? '' : content.toString('utf8'), contentType: detected.contentType, size, isBinary: detected.isBinary };
  }

  async readRaw(relativePath: string, options?: SourceReadOptions) {
    const normalized = normalizePath(relativePath);
    const { content, size } = await this.readBytes(normalized, options);
    const detected = detectContentType({ filePath: normalized, content });
    return { content, contentType: detected.contentType, size };
  }

  async write(relativePath: string, content: string): Promise<{ updatedAt?: string }> {
    this.assertWritable();
    const normalized = normalizePath(relativePath);
    if (!normalized) throw new Error('Path is required.');
    await this.broker.write(normalized, Buffer.from(content, 'utf8'));
    return {};
  }

  async writeExclusive(relativePath: string, content: string): Promise<{ updatedAt?: string }> {
    this.assertWritable();
    const normalized = normalizePath(relativePath);
    if (!normalized) throw new Error('Path is required.');
    try {
      await this.broker.exclusiveCreate(normalized, Buffer.from(content, 'utf8'));
    } catch (error) {
      if (error instanceof ManagedStorageBrokerError && error.code === 'exists') throw new Error('Converted document already exists.');
      throw error;
    }
    return {};
  }

  async mkdir(relativePath: string): Promise<void> {
    this.assertWritable();
    const normalized = normalizePath(relativePath);
    if (!normalized) throw new Error('Path is required.');
    await this.broker.mkdir(normalized);
  }
}
