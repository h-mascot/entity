import path from 'path';
import type { FileSourceRecord } from '../../../../db/src/file-sources';
import { detectContentType } from '../../file-types';
import { ManagedStorageBrokerClient, ManagedStorageBrokerError } from '../managed-storage-broker';
import { isBasePathAllowlisted } from '../source-root-guard';
import { normalizeSourceRelativePath } from '../security';
import { SourceReadLimitError } from './bounded-read';
import type { FileSourceAdapter, SourceCapability, SourceNode, SourcePathMetadata, SourceReadOptions } from './types';

type ManagedStorageOperations = Pick<ManagedStorageBrokerClient, 'stat' | 'read' | 'write' | 'exclusiveCreate' | 'mkdir' | 'list'>;

export type LocalFileSourceAdapterOptions = {
  brokerClient?: ManagedStorageOperations;
  brokerExecutable?: string;
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
  if (error instanceof ManagedStorageBrokerError && error.code === 'not_found') return new Error(message);
  return error instanceof Error ? error : new Error(message);
}

export class LocalFileSourceAdapter implements FileSourceAdapter {
  readonly key = 'local';
  private readonly source: FileSourceRecord;
  private readonly broker: ManagedStorageOperations;

  constructor(source: FileSourceRecord, options: LocalFileSourceAdapterOptions = {}) {
    this.source = source;
    this.broker = options.brokerClient ?? new ManagedStorageBrokerClient({
      executable: options.brokerExecutable ?? process.env.MANAGED_STORAGE_BROKER_EXECUTABLE ?? path.resolve(process.cwd(), 'packages/server/native/managed-storage-broker/.build/broker'),
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
    const nodes = await Promise.all(names.filter((name) => !name.startsWith('.')).map(async (name) => {
      const childPath = normalized ? `${normalized}/${name}` : name;
      const stats = await this.broker.stat(childPath);
      const isDirectory = stats.isDirectory;
      return { sourceId: this.source.id, path: childPath, name, isDirectory, kind: isDirectory ? 'directory' : 'file', size: isDirectory ? undefined : stats.size } satisfies SourceNode;
    }));
    return nodes.sort((a, b) => a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1);
  }

  private async readBytes(relativePath: string, options?: SourceReadOptions): Promise<{ content: Buffer; size: number }> {
    const normalized = normalizePath(relativePath);
    if (!normalized) throw new Error('Path is required.');
    const stats = await this.broker.stat(normalized);
    if (stats.isDirectory) throw new Error('Target path is not a file.');
    if (options?.maxBytes !== undefined && stats.size > options.maxBytes) throw new SourceReadLimitError(options.maxBytes);
    const content = Buffer.from(await this.broker.read(normalized));
    return { content, size: stats.size };
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
