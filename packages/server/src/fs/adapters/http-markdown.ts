import path from 'path';
import type { FileSourceRecord } from '../../../../db/src/file-sources';
import { SourceTextUnsupportedError } from '../errors';
import { assertAllowedRemoteUrl, normalizeSourceRelativePath } from '../security';
import { readResponseBufferBounded, readResponseTextBounded } from './bounded-read';
import type { FileSourceAdapter, SourceCapability, SourceNode, SourceFileRawResult, SourceReadOptions } from './types';

const MANIFEST_VERSION = 1;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_MANIFEST_FILES = 10_000;
const MAX_MANIFEST_FILE_BYTES = 16 * 1024 * 1024;
const MAX_MANIFEST_PATH_LENGTH = 1024;
const MAX_MANIFEST_TITLE_LENGTH = 256;

interface HttpMarkdownManifestFile {
  path: string;
  size: number;
  sha256: string;
  updatedAt: string;
  title?: string;
}

interface HttpMarkdownManifest {
  version: typeof MANIFEST_VERSION;
  generatedAt: string;
  files: HttpMarkdownManifestFile[];
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function joinUrl(baseUrl: string, relativePath: string): string {
  const cleanRelative = relativePath.replace(/^\/+/, '');
  return cleanRelative ? `${baseUrl}/${cleanRelative}` : baseUrl;
}

function isAllowedTextDocument(targetUrl: string, contentTypeHeader: string): boolean {
  const ext = path.extname(targetUrl).toLowerCase();
  if (['.md', '.markdown', '.txt', '.log', '.json', '.jsonl', '.yaml', '.yml', '.csv', '.tsv', '.sh', '.bash', '.zsh', '.py', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.css', '.html', '.xml', '.toml', '.ini'] .includes(ext)) {
    return true;
  }

  if (!contentTypeHeader) {
    return false;
  }

  return contentTypeHeader.includes('markdown')
    || contentTypeHeader.includes('text/plain')
    || contentTypeHeader.includes('application/json')
    || contentTypeHeader.includes('application/x-ndjson')
    || contentTypeHeader.includes('application/yaml')
    || contentTypeHeader.includes('application/x-yaml')
    || contentTypeHeader.includes('text/yaml')
    || contentTypeHeader.includes('text/csv')
    || contentTypeHeader.includes('text/tab-separated-values');
}

function parseCapabilities(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function normalizeManifestPath(value: string): string {
  const normalized = normalizeSourceRelativePath(value);
  if (!normalized || normalized.length > MAX_MANIFEST_PATH_LENGTH || normalized.endsWith('/')) {
    throw new Error('HTTP markdown manifest contains an invalid file path.');
  }

  if (!isAllowedTextDocument(normalized, '')) {
    throw new Error(`HTTP markdown manifest contains a non-text file: ${normalized}.`);
  }

  return normalized;
}

function parseManifestTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`HTTP markdown manifest ${field} must be a valid timestamp.`);
  }

  return new Date(value).toISOString();
}

function parseManifest(value: unknown): HttpMarkdownManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('HTTP markdown manifest must be a JSON object.');
  }

  const record = value as Record<string, unknown>;
  if (record.version !== MANIFEST_VERSION) {
    throw new Error(`HTTP markdown manifest version must be ${MANIFEST_VERSION}.`);
  }
  const generatedAt = parseManifestTimestamp(record.generatedAt, 'generatedAt');
  if (!Array.isArray(record.files) || record.files.length > MAX_MANIFEST_FILES) {
    throw new Error(`HTTP markdown manifest must contain at most ${MAX_MANIFEST_FILES} files.`);
  }

  const paths = new Set<string>();
  const files = record.files.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('HTTP markdown manifest file entries must be objects.');
    }

    const file = value as Record<string, unknown>;
    const filePath = normalizeManifestPath(typeof file.path === 'string' ? file.path : '');
    if (paths.has(filePath)) {
      throw new Error(`HTTP markdown manifest contains a duplicate path: ${filePath}.`);
    }
    for (const existingPath of paths) {
      if (existingPath.startsWith(`${filePath}/`) || filePath.startsWith(`${existingPath}/`)) {
        throw new Error(`HTTP markdown manifest contains ambiguous file/directory paths: ${existingPath} and ${filePath}.`);
      }
    }
    paths.add(filePath);

    if (!Number.isSafeInteger(file.size) || (file.size as number) < 0 || (file.size as number) > MAX_MANIFEST_FILE_BYTES) {
      throw new Error(`HTTP markdown manifest size is invalid for ${filePath}.`);
    }
    if (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(file.sha256)) {
      throw new Error(`HTTP markdown manifest sha256 is invalid for ${filePath}.`);
    }
    const updatedAt = parseManifestTimestamp(file.updatedAt, `updatedAt for ${filePath}`);
    const title = typeof file.title === 'undefined' ? undefined : file.title;
    if (typeof title !== 'undefined' && (typeof title !== 'string' || !title.trim() || title.length > MAX_MANIFEST_TITLE_LENGTH)) {
      throw new Error(`HTTP markdown manifest title is invalid for ${filePath}.`);
    }

    return {
      path: filePath,
      size: file.size as number,
      sha256: file.sha256,
      updatedAt,
      ...(typeof title === 'string' ? { title: title.trim() } : {}),
    };
  });

  return { version: MANIFEST_VERSION, generatedAt, files };
}

export class HttpMarkdownFileSourceAdapter implements FileSourceAdapter {
  readonly key = 'http-markdown';
  private readonly source: FileSourceRecord;
  private readonly baseUrl: string;
  private manifest: HttpMarkdownManifest | null = null;
  private manifestPromise: Promise<HttpMarkdownManifest | null> | null = null;

  constructor(source: FileSourceRecord) {
    this.source = source;
    this.baseUrl = normalizeBaseUrl(source.base_url ?? '');
  }

  async validate(source: FileSourceRecord): Promise<void> {
    const baseUrl = source.base_url?.trim();
    if (!baseUrl) {
      throw new Error('HTTP markdown source requires baseUrl.');
    }

    assertAllowedRemoteUrl(baseUrl);
    const response = await fetch(baseUrl, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`HTTP markdown source unreachable (${response.status}).`);
    }
    await this.loadManifest();
  }

  capabilities(): SourceCapability {
    const manifestBacked = this.manifest !== null;
    return {
      read: true,
      write: false,
      rename: false,
      delete: false,
      list: manifestBacked,
      search: manifestBacked,
    };
  }

  private manifestUrl(): string | null {
    const capabilities = parseCapabilities(this.source.capabilities);
    const configuredPath = typeof capabilities.manifestPath === 'string' ? capabilities.manifestPath.trim() : '';
    const configuredUrl = typeof capabilities.manifestUrl === 'string' ? capabilities.manifestUrl.trim() : '';
    if (configuredPath && configuredUrl) {
      throw new Error('HTTP markdown source may configure only one manifestPath or manifestUrl.');
    }
    if (configuredPath) {
      const normalizedPath = normalizeSourceRelativePath(configuredPath);
      if (!normalizedPath) {
        throw new Error('HTTP markdown manifestPath cannot be empty.');
      }
      const targetUrl = joinUrl(this.baseUrl, normalizedPath);
      assertAllowedRemoteUrl(targetUrl);
      return targetUrl;
    }
    if (!configuredUrl) {
      return null;
    }

    const base = new URL(`${this.baseUrl}/`);
    const target = new URL(configuredUrl, base);
    const basePath = base.pathname.replace(/\/+$/, '');
    const targetIsUnderBase = target.origin === base.origin
      && target.pathname.startsWith(`${basePath}/`);
    if (!targetIsUnderBase) {
      throw new Error('HTTP markdown manifestUrl must use the source origin and stay under baseUrl.');
    }
    assertAllowedRemoteUrl(target.href);
    return target.href;
  }

  private async loadManifest(): Promise<HttpMarkdownManifest | null> {
    if (this.manifest || this.manifestPromise) {
      return this.manifestPromise ?? this.manifest;
    }

    const targetUrl = this.manifestUrl();
    if (!targetUrl) {
      return null;
    }

    this.manifestPromise = (async () => {
      const response = await fetch(targetUrl);
      if (!response.ok) {
        throw new Error(`HTTP markdown manifest unavailable (${response.status}).`);
      }
      const { content } = await readResponseTextBounded(response, { maxBytes: MAX_MANIFEST_BYTES });
      let parsed: unknown;
      try {
        parsed = JSON.parse(content) as unknown;
      } catch {
        throw new Error('HTTP markdown manifest is not valid JSON.');
      }
      const manifest = parseManifest(parsed);
      this.manifest = manifest;
      return manifest;
    })();

    try {
      return await this.manifestPromise;
    } finally {
      this.manifestPromise = null;
    }
  }

  async list(relativePath: string): Promise<SourceNode[]> {
    const manifest = await this.loadManifest();
    if (!manifest) {
      return [];
    }

    const normalizedDirectory = normalizeSourceRelativePath(relativePath);
    const prefix = normalizedDirectory ? `${normalizedDirectory}/` : '';
    const nodes = new Map<string, SourceNode>();
    for (const file of manifest.files) {
      if (!file.path.startsWith(prefix)) {
        continue;
      }

      const remainder = file.path.slice(prefix.length);
      if (!remainder) {
        continue;
      }
      const separator = remainder.indexOf('/');
      if (separator >= 0) {
        const directoryName = remainder.slice(0, separator);
        const directoryPath = `${prefix}${directoryName}`.replace(/\/$/, '');
        nodes.set(directoryPath, {
          sourceId: this.source.id,
          path: directoryPath,
          name: directoryName,
          isDirectory: true,
          kind: 'directory',
        });
        continue;
      }

      nodes.set(file.path, {
        sourceId: this.source.id,
        path: file.path,
        name: file.title ?? path.posix.basename(file.path),
        isDirectory: false,
        kind: 'file',
        size: file.size,
        updatedAt: file.updatedAt,
      });
    }

    return Array.from(nodes.values()).sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async read(relativePath: string, options?: SourceReadOptions): Promise<{ content: string; contentType: string; updatedAt?: string; size?: number }> {
    const normalized = normalizeSourceRelativePath(relativePath);

    const targetUrl = normalized ? joinUrl(this.baseUrl, normalized) : this.baseUrl;
    assertAllowedRemoteUrl(targetUrl);

    const response = await fetch(targetUrl);
    if (!response.ok) {
      throw new Error(`Unable to read remote markdown (${response.status}).`);
    }

    const contentTypeHeader = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!isAllowedTextDocument(targetUrl, contentTypeHeader)) {
      await response.body?.cancel().catch(() => undefined);
      throw new SourceTextUnsupportedError('Remote resource is not an allowed text document.');
    }

    const { content, size } = await readResponseTextBounded(response, options);
    return {
      content,
      contentType: 'text/markdown',
      updatedAt: response.headers.get('last-modified') || undefined,
      size,
    };
  }

  async write(_relativePath: string, _content: string): Promise<{ updatedAt?: string }> {
    throw new Error('HTTP markdown source is read-only.');
  }

  async mkdir(_relativePath: string): Promise<void> {
    throw new Error('HTTP markdown source is read-only.');
  }

  async readRaw(relativePath: string, options?: SourceReadOptions): Promise<SourceFileRawResult> {
    const normalized = normalizeSourceRelativePath(relativePath);

    const targetUrl = normalized ? joinUrl(this.baseUrl, normalized) : this.baseUrl;
    assertAllowedRemoteUrl(targetUrl);

    const response = await fetch(targetUrl);
    if (!response.ok) {
      throw new Error(`Unable to read remote resource (${response.status}).`);
    }

    const content = await readResponseBufferBounded(response, options);
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || 'application/octet-stream';

    return {
      content,
      contentType,
      updatedAt: response.headers.get('last-modified') || undefined,
      size: content.length,
    };
  }
}
