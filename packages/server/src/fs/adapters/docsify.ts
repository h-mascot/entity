import path from 'path';
import type { FileSourceRecord } from '../../../../db/src/file-sources';
import { assertAllowedRemoteUrl, normalizeSourceRelativePath } from '../security';
import { DEFAULT_SOURCE_READ_LIMIT_BYTES, readResponseTextBounded } from './bounded-read';
import type { FileSourceAdapter, SourceCapability, SourceNode, SourceReadOptions } from './types';

interface MarkdownLink {
  label: string;
  href: string;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function joinUrl(baseUrl: string, relativePath: string): string {
  const cleanRelative = relativePath.replace(/^\/+/, '');
  return cleanRelative ? `${baseUrl}/${cleanRelative}` : baseUrl;
}

function parseMarkdownLinks(markdown: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null = regex.exec(markdown);

  while (match) {
    const label = match[1]?.trim();
    const href = match[2]?.trim();
    if (label && href && !href.startsWith('http://') && !href.startsWith('https://')) {
      links.push({ label, href });
    }
    match = regex.exec(markdown);
  }

  return links;
}

function classifyLink(href: string): { isDirectory: boolean; normalized: string } {
  const cleaned = href.split('#')[0].split('?')[0].trim();
  const normalized = cleaned.replace(/^\/+/, '');
  const ext = path.extname(normalized).toLowerCase();
  const isDirectory = normalized.endsWith('/') || (!ext && !normalized.includes('.'));
  return { isDirectory, normalized };
}

export class DocsifyFileSourceAdapter implements FileSourceAdapter {
  readonly key = 'docsify';
  private readonly source: FileSourceRecord;
  private readonly baseUrl: string;

  constructor(source: FileSourceRecord) {
    this.source = source;
    this.baseUrl = normalizeBaseUrl(source.base_url ?? '');
  }

  async validate(source: FileSourceRecord): Promise<void> {
    const baseUrl = source.base_url?.trim();
    if (!baseUrl) {
      throw new Error('Docsify source requires baseUrl.');
    }

    assertAllowedRemoteUrl(baseUrl);
    const response = await fetch(joinUrl(normalizeBaseUrl(baseUrl), '_sidebar.md'));
    if (!response.ok) {
      throw new Error(`Docsify source unreachable (${response.status}).`);
    }
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
    const sidebarPath = normalized ? `${normalized.replace(/\/+$/, '')}/_sidebar.md` : '_sidebar.md';
    const response = await fetch(joinUrl(this.baseUrl, sidebarPath));
    if (!response.ok) {
      if (response.status === 404) {
        return [];
      }
      throw new Error(`Unable to list docsify source (${response.status}).`);
    }

    const { content: markdown } = await readResponseTextBounded(response, {
      maxBytes: DEFAULT_SOURCE_READ_LIMIT_BYTES,
    });
    const links = parseMarkdownLinks(markdown);
    return links.map((link) => {
      const parsed = classifyLink(link.href);
      const nodePath = normalizeSourceRelativePath(path.posix.join(normalized, parsed.normalized));
      return {
        sourceId: this.source.id,
        path: nodePath,
        name: link.label || path.posix.basename(parsed.normalized),
        isDirectory: parsed.isDirectory,
      };
    });
  }

  async read(relativePath: string, options?: SourceReadOptions): Promise<{ content: string; contentType: string; updatedAt?: string; size?: number }> {
    const normalized = normalizeSourceRelativePath(relativePath);
    if (!normalized) {
      throw new Error('Path is required.');
    }

    const candidates = [normalized, normalized.endsWith('.md') ? normalized : `${normalized}.md`];
    let lastStatus = 404;

    for (const candidate of candidates) {
      const response = await fetch(joinUrl(this.baseUrl, candidate));
      lastStatus = response.status;
      if (!response.ok) {
        continue;
      }

      const { content, size } = await readResponseTextBounded(response, options);
      return {
        content,
        contentType: 'text/markdown',
        size,
      };
    }

    throw new Error(`Unable to read docsify file (${lastStatus}).`);
  }

  async write(_relativePath: string, _content: string): Promise<{ updatedAt?: string }> {
    throw new Error('Docsify source is read-only.');
  }

  async mkdir(_relativePath: string): Promise<void> {
    throw new Error('Docsify source is read-only.');
  }
}
