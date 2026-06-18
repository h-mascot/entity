import path from 'path';
import type { FileSourceRecord } from '../../../../db/src/file-sources';
import { assertAllowedRemoteUrl, normalizeSourceRelativePath } from '../security';
import type { FileSourceAdapter, SourceCapability, SourceNode } from './types';

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

export class HttpMarkdownFileSourceAdapter implements FileSourceAdapter {
  readonly key = 'http-markdown';
  private readonly source: FileSourceRecord;
  private readonly baseUrl: string;

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
  }

  capabilities(): SourceCapability {
    return {
      read: true,
      write: false,
      rename: false,
      delete: false,
      list: false,
      search: false,
    };
  }

  async list(_relativePath: string): Promise<SourceNode[]> {
    return [];
  }

  async read(relativePath: string): Promise<{ content: string; contentType: string; updatedAt?: string }> {
    const normalized = normalizeSourceRelativePath(relativePath);

    const targetUrl = normalized ? joinUrl(this.baseUrl, normalized) : this.baseUrl;
    assertAllowedRemoteUrl(targetUrl);

    const response = await fetch(targetUrl);
    if (!response.ok) {
      throw new Error(`Unable to read remote markdown (${response.status}).`);
    }

    const contentTypeHeader = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!isAllowedTextDocument(targetUrl, contentTypeHeader)) {
      throw new Error('Remote resource is not an allowed text document.');
    }

    const content = await response.text();
    return {
      content,
      contentType: 'text/markdown',
      updatedAt: response.headers.get('last-modified') || undefined,
    };
  }

  async write(_relativePath: string, _content: string): Promise<{ updatedAt?: string }> {
    throw new Error('HTTP markdown source is read-only.');
  }

  async mkdir(_relativePath: string): Promise<void> {
    throw new Error('HTTP markdown source is read-only.');
  }
}
