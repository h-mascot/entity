import path from 'path';
import type { FileSourceRecord } from '../../../../db/src/file-sources';
import { normalizeSourceRelativePath } from '../security';
import { readResponseTextBounded } from './bounded-read';
import {
  S3ConfigError,
  S3NotFoundError,
  S3PaginationLimitError,
  extractS3ErrorCode,
  interpretS3Response,
  normalizeS3ETag,
  normalizeS3VersionId,
  parseS3Uri,
  type S3Client,
} from './s3-client';
import type { FileSourceAdapter, SourceCapability, SourceNode, SourceReadOptions } from './types';

/**
 * S3 file-source adapter over an injectable {@link S3Client} (GQR-005).
 * Ships as a synthetic contract only: the registry still serves the truthful
 * "connector not implemented" placeholder for `s3` sources until repository
 * authority approves a live client, because this build contains no networked
 * client implementation.
 */

export const DEFAULT_S3_MAX_LIST_PAGES = 100;

export interface S3AdapterOptions {
  client: S3Client;
  /** Guard against unbounded ListObjectsV2 walks; default 100 pages. */
  maxListPages?: number;
}

interface S3SourceConfig {
  bucket: string;
  prefix: string;
}

function parseCapabilities(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function resolveConfig(source: FileSourceRecord): S3SourceConfig {
  const { bucket, prefix } = parseS3Uri(source.base_url ?? '');
  const capabilities = parseCapabilities(source.capabilities);
  if (capabilities.region !== undefined && (typeof capabilities.region !== 'string' || !capabilities.region.trim())) {
    throw new S3ConfigError('S3 source region, when configured, must be a non-empty string.');
  }
  return { bucket, prefix };
}

export class S3FileSourceAdapter implements FileSourceAdapter {
  readonly key = 's3';
  private readonly source: FileSourceRecord;
  private readonly client: S3Client;
  private readonly maxListPages: number;

  constructor(source: FileSourceRecord, options: S3AdapterOptions) {
    this.source = source;
    this.client = options.client;
    this.maxListPages = options.maxListPages ?? DEFAULT_S3_MAX_LIST_PAGES;
  }

  async validate(source: FileSourceRecord): Promise<void> {
    const config = resolveConfig(source);
    // Connectivity + authorization probe: a single bounded listing page.
    await this.client.listObjectsV2({ bucket: config.bucket, prefix: config.prefix, maxKeys: 1 });
  }

  capabilities(): SourceCapability {
    return {
      read: true,
      write: false,
      rename: false,
      delete: false,
      list: true,
      search: false,
    };
  }

  async list(relativePath: string): Promise<SourceNode[]> {
    const normalized = normalizeSourceRelativePath(relativePath);
    const config = resolveConfig(this.source);
    const listingPrefix = `${config.prefix}${normalized}${normalized ? '/' : ''}`;

    const objects = new Map<string, { size: number; lastModified?: string }>();
    const directories = new Set<string>();
    let continuationToken: string | undefined;
    let pages = 0;
    while (true) {
      if (pages >= this.maxListPages) {
        throw new S3PaginationLimitError(this.maxListPages);
      }
      const page = await this.client.listObjectsV2({
        bucket: config.bucket,
        prefix: listingPrefix,
        delimiter: '/',
        ...(continuationToken ? { continuationToken } : {}),
      });
      pages += 1;
      for (const object of page.objects) {
        // Path bounds: a buggy upstream returning keys outside the requested
        // prefix must never leak into the tree.
        if (!object.key.startsWith(listingPrefix)) {
          continue;
        }
        objects.set(object.key, { size: object.size, ...(object.lastModified ? { lastModified: object.lastModified } : {}) });
      }
      for (const commonPrefix of page.commonPrefixes) {
        if (commonPrefix.startsWith(listingPrefix)) {
          directories.add(commonPrefix);
        }
      }
      if (page.nextContinuationToken === null || page.nextContinuationToken === undefined) {
        break;
      }
      continuationToken = page.nextContinuationToken;
    }

    const nodes: SourceNode[] = [];
    for (const commonPrefix of directories) {
      const directoryPath = commonPrefix.slice(config.prefix.length, commonPrefix.length - 1);
      nodes.push({
        sourceId: this.source.id,
        path: directoryPath,
        name: path.posix.basename(directoryPath),
        isDirectory: true,
        kind: 'directory',
      });
    }
    for (const [key, meta] of objects) {
      nodes.push({
        sourceId: this.source.id,
        path: key.slice(config.prefix.length),
        name: path.posix.basename(key),
        isDirectory: false,
        kind: 'file',
        size: meta.size,
        ...(meta.lastModified ? { updatedAt: meta.lastModified } : {}),
      });
    }

    return nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async read(relativePath: string, options?: SourceReadOptions): Promise<{
    content: string;
    contentType: string;
    updatedAt?: string;
    size?: number;
    isBinary?: boolean;
    etag?: string;
    versionId?: string;
  }> {
    const normalized = normalizeSourceRelativePath(relativePath);
    const config = resolveConfig(this.source);
    const key = `${config.prefix}${normalized}`;
    if (!key.startsWith(config.prefix)) {
      throw new S3NotFoundError(`Resolved key escapes the source prefix: ${normalized}`);
    }

    const response = await this.client.getObject({ bucket: config.bucket, key });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw interpretS3Response(response.status, Object.fromEntries(response.headers), extractS3ErrorCode(body));
    }

    const { content, size } = await readResponseTextBounded(response, options);
    const headerValue = (name: string): string | undefined => {
      const raw = response.headers.get(name);
      return raw === null ? undefined : raw;
    };

    return {
      content,
      contentType: headerValue('content-type')?.split(';')[0]?.trim().toLowerCase() || 'application/octet-stream',
      ...(headerValue('last-modified') ? { updatedAt: headerValue('last-modified') } : {}),
      size,
      etag: normalizeS3ETag(headerValue('etag')),
      versionId: normalizeS3VersionId(headerValue('x-amz-version-id')),
    };
  }

  async write(_relativePath: string, _content: string): Promise<{ updatedAt?: string }> {
    throw new Error('S3 source is read-only.');
  }

  async mkdir(_relativePath: string): Promise<void> {
    throw new Error('S3 source is read-only.');
  }
}
