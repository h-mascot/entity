import fs from 'fs';
import path from 'path';
import type { FileSourceRecord } from '../../../../db/src/file-sources';
import { detectContentType } from '../../file-types';
import { assertAllowedLocalSourceBasePath, isBasePathAllowlisted } from '../source-root-guard';
import { assertRealpathContained, assertWriteTargetRealpathContained, normalizeSourceRelativePath, resolveLocalPath } from '../security';
import type { FileSourceAdapter, SourceCapability, SourceNode, SourcePathMetadata } from './types';

function toIsoTimestamp(value: Date): string {
  return value.toISOString();
}

function toKind(stats: fs.Stats): SourcePathMetadata['kind'] {
  if (stats.isFile()) {
    return 'file';
  }
  if (stats.isDirectory()) {
    return 'directory';
  }
  return 'other';
}

export const LOCAL_SOURCE_CAPABILITY_POLICY: SourceCapability = {
  read: true,
  write: false,
  rename: false,
  delete: false,
  list: true,
  search: true,
};

export function deriveLocalSourceCapabilities(basePath: string | undefined | null): SourceCapability {
  return {
    ...LOCAL_SOURCE_CAPABILITY_POLICY,
    write: isBasePathAllowlisted(basePath),
  };
}

export function localSourceCapabilitiesJson(basePath?: string | null): string {
  return JSON.stringify(deriveLocalSourceCapabilities(basePath));
}

function toNode(sourceId: string, rootPath: string, entryName: string, stats: fs.Stats): SourceNode {
  const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const relativePath = normalizedRoot ? `${normalizedRoot}/${entryName}` : entryName;
  const kind = toKind(stats);
  const isDirectory = kind === 'directory';

  return {
    sourceId,
    path: relativePath,
    name: entryName,
    isDirectory,
    kind,
    size: kind === 'file' ? stats.size : undefined,
    updatedAt: toIsoTimestamp(stats.mtime),
  };
}

export class LocalFileSourceAdapter implements FileSourceAdapter {
  readonly key = 'local';
  private readonly source: FileSourceRecord;

  constructor(source: FileSourceRecord) {
    this.source = source;
  }

  async validate(source: FileSourceRecord): Promise<void> {
    const basePath = source.base_path?.trim();
    const resolved = await assertAllowedLocalSourceBasePath(basePath);
    const stats = await fs.promises.stat(resolved).catch((err) => {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        throw new Error('Local source path does not exist.');
      }
      throw err;
    });
    if (!stats.isDirectory()) {
      throw new Error('Local source basePath must be a directory.');
    }
  }

  capabilities(): SourceCapability {
    return deriveLocalSourceCapabilities(this.source.base_path);
  }

  async list(relativePath: string): Promise<SourceNode[]> {
    const basePath = this.source.base_path?.trim();
    if (!basePath) {
      throw new Error('Local source basePath is not configured.');
    }

    const normalizedRelative = normalizeSourceRelativePath(relativePath);
    const absolutePath = resolveLocalPath(basePath, normalizedRelative);
    await assertRealpathContained(basePath, absolutePath);
    const entries = await fs.promises.readdir(absolutePath, { withFileTypes: true });

    const nodes = (
      await Promise.all(
        entries
          .filter((entry) => !entry.name.startsWith('.'))
          .map(async (entry) => {
            try {
              const entryAbsolutePath = path.join(absolutePath, entry.name);
              const stats = await fs.promises.lstat(entryAbsolutePath);
              const rootPath = normalizedRelative;
              return toNode(this.source.id, rootPath, entry.name, stats);
            } catch (err) {
              const code = (err as NodeJS.ErrnoException)?.code;
              if (code === 'ENOENT') {
                return null;
              }
              throw err;
            }
          })
      )
    ).filter((node): node is SourceNode => node !== null);

    return nodes.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) {
        return -1;
      }
      if (!a.isDirectory && b.isDirectory) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });
  }

  async stat(relativePath: string): Promise<SourcePathMetadata> {
    const basePath = this.source.base_path?.trim();
    if (!basePath) {
      throw new Error('Local source basePath is not configured.');
    }

    const normalizedRelative = normalizeSourceRelativePath(relativePath);
    const absolutePath = resolveLocalPath(basePath, normalizedRelative);
    await assertRealpathContained(basePath, absolutePath);
    const stats = await fs.promises.lstat(absolutePath);
    const name = normalizedRelative ? path.posix.basename(normalizedRelative) : path.basename(absolutePath);
    const kind = toKind(stats);
    return {
      sourceId: this.source.id,
      path: normalizedRelative,
      name,
      kind,
      size: kind === 'file' ? stats.size : undefined,
      updatedAt: toIsoTimestamp(stats.mtime),
    };
  }

  async read(relativePath: string): Promise<{ content: string; contentType: string; updatedAt?: string; size?: number; isBinary?: boolean }> {
    const basePath = this.source.base_path?.trim();
    if (!basePath) {
      throw new Error('Local source basePath is not configured.');
    }

    const normalizedRelative = normalizeSourceRelativePath(relativePath);
    if (!normalizedRelative) {
      throw new Error('Path is required.');
    }

    const absolutePath = resolveLocalPath(basePath, normalizedRelative);
    await assertRealpathContained(basePath, absolutePath);
    const stats = await fs.promises.stat(absolutePath);
    if (!stats.isFile()) {
      throw new Error('Target path is not a file.');
    }

    const buffer = await fs.promises.readFile(absolutePath);
    const detected = detectContentType({ filePath: absolutePath, content: buffer });
    return {
      content: detected.isBinary ? '' : buffer.toString('utf-8'),
      contentType: detected.contentType,
      updatedAt: toIsoTimestamp(stats.mtime),
      size: stats.size,
      isBinary: detected.isBinary,
    };
  }

  async readRaw(relativePath: string): Promise<{ content: Buffer; contentType: string; updatedAt?: string; size: number }> {
    const basePath = this.source.base_path?.trim();
    if (!basePath) {
      throw new Error('Local source basePath is not configured.');
    }

    const normalizedRelative = normalizeSourceRelativePath(relativePath);
    if (!normalizedRelative) {
      throw new Error('Path is required.');
    }

    const absolutePath = resolveLocalPath(basePath, normalizedRelative);
    await assertRealpathContained(basePath, absolutePath);
    const stats = await fs.promises.stat(absolutePath);
    if (!stats.isFile()) {
      throw new Error('Target path is not a file.');
    }

    const content = await fs.promises.readFile(absolutePath);
    const detected = detectContentType({ filePath: absolutePath, content });
    return {
      content,
      contentType: detected.contentType,
      updatedAt: toIsoTimestamp(stats.mtime),
      size: stats.size,
    };
  }

  async write(relativePath: string, content: string): Promise<{ updatedAt?: string }> {
    const basePath = this.source.base_path?.trim();
    if (!basePath) {
      throw new Error('Local source basePath is not configured.');
    }

    const normalizedRelative = normalizeSourceRelativePath(relativePath);
    if (!normalizedRelative) {
      throw new Error('Path is required.');
    }

    const absolutePath = resolveLocalPath(basePath, normalizedRelative);
    await assertWriteTargetRealpathContained(basePath, absolutePath);
    try {
      const stats = await fs.promises.stat(absolutePath);
      if (!stats.isFile()) {
        throw new Error('Target path is not a file.');
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        throw err;
      }
    }

    await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
    await assertWriteTargetRealpathContained(basePath, absolutePath);
    await fs.promises.writeFile(absolutePath, content, 'utf-8');
    const updatedStats = await fs.promises.stat(absolutePath);
    return {
      updatedAt: toIsoTimestamp(updatedStats.mtime),
    };
  }

  async mkdir(relativePath: string): Promise<void> {
    const basePath = this.source.base_path?.trim();
    if (!basePath) {
      throw new Error('Local source basePath is not configured.');
    }

    const normalizedRelative = normalizeSourceRelativePath(relativePath);
    if (!normalizedRelative) {
      throw new Error('Path is required.');
    }

    const absolutePath = resolveLocalPath(basePath, normalizedRelative);
    await assertWriteTargetRealpathContained(basePath, absolutePath);
    try {
      const stats = await fs.promises.stat(absolutePath);
      if (stats.isDirectory()) {
        throw new Error('Folder already exists.');
      }
      throw new Error('Target path is not a directory.');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        throw err;
      }
    }

    await fs.promises.mkdir(absolutePath, { recursive: true });
    await assertRealpathContained(basePath, absolutePath);
  }
}
