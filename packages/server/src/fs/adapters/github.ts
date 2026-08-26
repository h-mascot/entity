import path from 'path';
import type { FileSourceRecord } from '../../../../db/src/file-sources';
import { normalizeSourceRelativePath } from '../security';
import { DEFAULT_SOURCE_READ_LIMIT_BYTES, SourceReadLimitError } from './bounded-read';
import {
  GitHubNotFoundError,
  GitHubPaginationLimitError,
  redactBearerText,
  type GitHubClient,
  type GitHubTreeEntry,
} from './github-client';
import type { FileSourceAdapter, SourceCapability, SourceNode, SourceReadOptions } from './types';

/**
 * GitHub file-source adapter over an injectable {@link GitHubClient}
 * (GQR-005). Ships as a synthetic contract only: the registry still serves
 * the truthful "connector not implemented" placeholder for `github` sources
 * until repository authority approves a live client, because this build
 * contains no networked client implementation.
 */

export const DEFAULT_GITHUB_MAX_TREE_PAGES = 100;

export type GitHubCachePolicy =
  | { mode: 'none' }
  | { mode: 'memory'; ttlMs: number };

/** Explicit no-cache default: caching is always an opt-in policy. */
export const DEFAULT_GITHUB_CACHE_POLICY: GitHubCachePolicy = { mode: 'none' };

export interface GitHubAdapterOptions {
  client: GitHubClient;
  /** Resolves the bearer token for redaction; defaults to auth_type 'bearer' + auth_ref. */
  tokenResolver?: (source: FileSourceRecord) => string | undefined;
  cachePolicy?: GitHubCachePolicy;
  /** Injectable clock for deterministic cache-expiry proof. */
  now?: () => number;
  maxTreePages?: number;
}

export class GitHubConfigError extends Error {
  readonly code = 'GITHUB_CONFIG';

  constructor(message: string) {
    super(message);
    this.name = 'GitHubConfigError';
  }
}

const GITHUB_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

/**
 * Parses owner/repository from a GitHub base_url. Accepted shapes:
 * `https://github.com/owner/repo[/]`, `https://github.com/owner/repo.git`,
 * and the shorthand `owner/repo`.
 */
export function parseGitHubRepositoryRef(raw: string): { owner: string; repo: string } {
  const value = (raw ?? '').trim();
  if (!value) {
    throw new GitHubConfigError('GitHub source requires base_url of the form "https://github.com/owner/repo".');
  }

  let candidate = value;
  if (/^https?:\/\//i.test(candidate)) {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new GitHubConfigError('GitHub source base_url is not a valid URL.');
    }
    if (parsed.hostname.toLowerCase() !== 'github.com') {
      throw new GitHubConfigError('GitHub source base_url must point at github.com.');
    }
    candidate = parsed.pathname.replace(/^\/+|\/+$/g, '');
  }

  const [owner, repo, ...extra] = candidate.split('/');
  if (!owner || !repo || extra.length > 0) {
    throw new GitHubConfigError('GitHub source base_url must include owner/repository.');
  }
  const cleanRepo = repo.endsWith('.git') ? repo.slice(0, -'.git'.length) : repo;
  if (!GITHUB_NAME_PATTERN.test(owner) || !GITHUB_NAME_PATTERN.test(cleanRepo)) {
    throw new GitHubConfigError('GitHub source owner/repository contains invalid characters.');
  }

  return { owner, repo: cleanRepo };
}

interface GitHubSourceConfig {
  owner: string;
  repo: string;
  ref: string;
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

function resolveConfig(source: FileSourceRecord): GitHubSourceConfig {
  const { owner, repo } = parseGitHubRepositoryRef(source.base_url ?? '');
  const capabilities = parseCapabilities(source.capabilities);
  const ref = typeof capabilities.ref === 'string' && capabilities.ref.trim() ? capabilities.ref.trim() : 'main';
  return { owner, repo, ref };
}

function blobContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.md' || ext === '.markdown') return 'text/markdown';
  if (ext === '.json' || ext === '.jsonl') return 'application/json';
  if (ext === '.yaml' || ext === '.yml') return 'application/yaml';
  return 'text/plain';
}

function effectiveReadLimit(options?: SourceReadOptions): number {
  const value = options?.maxBytes;
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return DEFAULT_SOURCE_READ_LIMIT_BYTES;
  }
  return Math.min(Math.floor(value), DEFAULT_SOURCE_READ_LIMIT_BYTES);
}

export class GitHubFileSourceAdapter implements FileSourceAdapter {
  readonly key = 'github';
  private readonly source: FileSourceRecord;
  private readonly client: GitHubClient;
  private readonly tokenResolver: (source: FileSourceRecord) => string | undefined;
  private readonly cachePolicy: GitHubCachePolicy;
  private readonly now: () => number;
  private readonly maxTreePages: number;
  private treeCache: { entries: Map<string, GitHubTreeEntry>; fetchedAt: number } | null = null;

  constructor(source: FileSourceRecord, options: GitHubAdapterOptions) {
    this.source = source;
    this.client = options.client;
    this.tokenResolver = options.tokenResolver
      ?? ((record) => (record.auth_type === 'bearer' ? record.auth_ref ?? undefined : undefined));
    this.cachePolicy = options.cachePolicy ?? DEFAULT_GITHUB_CACHE_POLICY;
    this.now = options.now ?? Date.now;
    this.maxTreePages = options.maxTreePages ?? DEFAULT_GITHUB_MAX_TREE_PAGES;
  }

  /**
   * Runs a client call with defense-in-depth bearer redaction: any error
   * message is scrubbed of the resolved token before it can surface.
   */
  private async guarded<T>(run: () => Promise<T>): Promise<T> {
    const token = this.tokenResolver(this.source);
    try {
      return await run();
    } catch (error) {
      if (error instanceof Error) {
        error.message = redactBearerText(error.message, token);
        throw error;
      }
      throw new Error(redactBearerText(String(error), token));
    }
  }

  async validate(source: FileSourceRecord): Promise<void> {
    const config = resolveConfig(source);
    // Connectivity + authorization probe: a single first tree page.
    await this.guarded(() => this.client.listTree({ owner: config.owner, repo: config.repo, ref: config.ref }));
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

  private async fetchTree(config: GitHubSourceConfig): Promise<Map<string, GitHubTreeEntry>> {
    const entries = new Map<string, GitHubTreeEntry>();
    let cursor: string | undefined;
    let pages = 0;
    while (true) {
      if (pages >= this.maxTreePages) {
        throw new GitHubPaginationLimitError(this.maxTreePages);
      }
      const page = await this.guarded(() =>
        this.client.listTree({ owner: config.owner, repo: config.repo, ref: config.ref, cursor }),
      );
      pages += 1;
      for (const entry of page.entries) {
        entries.set(entry.path, entry);
      }
      if (page.nextCursor === null || page.nextCursor === undefined) {
        break;
      }
      cursor = page.nextCursor;
    }

    this.treeCache = { entries, fetchedAt: this.now() };
    return entries;
  }

  private async getTree(config: GitHubSourceConfig): Promise<Map<string, GitHubTreeEntry>> {
    if (
      this.cachePolicy.mode === 'memory' &&
      this.treeCache &&
      this.now() - this.treeCache.fetchedAt < this.cachePolicy.ttlMs
    ) {
      return this.treeCache.entries;
    }
    return this.fetchTree(config);
  }

  async list(relativePath: string): Promise<SourceNode[]> {
    const normalized = normalizeSourceRelativePath(relativePath);
    const config = resolveConfig(this.source);
    const tree = await this.getTree(config);

    if (normalized !== '') {
      const entry = tree.get(normalized);
      if (!entry || entry.type !== 'tree') {
        throw new GitHubNotFoundError(`Path not found in repository tree: ${normalized}`);
      }
    }

    const prefix = normalized ? `${normalized}/` : '';
    const nodes: SourceNode[] = [];
    for (const entry of tree.values()) {
      if (!entry.path.startsWith(prefix) || entry.path === prefix) {
        continue;
      }
      const remainder = entry.path.slice(prefix.length);
      if (remainder.includes('/')) {
        continue; // grandchild: surfaced via its own parent directory node
      }
      const isDirectory = entry.type === 'tree';
      nodes.push({
        sourceId: this.source.id,
        path: entry.path,
        name: remainder,
        isDirectory,
        kind: isDirectory ? 'directory' : 'file',
        ...(isDirectory ? {} : typeof entry.size === 'number' ? { size: entry.size } : {}),
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
  }> {
    const normalized = normalizeSourceRelativePath(relativePath);
    const config = resolveConfig(this.source);
    const tree = await this.getTree(config);

    const entry = tree.get(normalized);
    if (!entry || entry.type !== 'blob') {
      throw new GitHubNotFoundError(`Path is not a readable file in the repository tree: ${normalized}`);
    }

    const maxBytes = effectiveReadLimit(options);
    if (typeof entry.size === 'number' && entry.size > maxBytes) {
      throw new SourceReadLimitError(maxBytes);
    }

    const blob = await this.guarded(() =>
      this.client.getBlob({ owner: config.owner, repo: config.repo, ref: config.ref, path: normalized }),
    );
    if (Buffer.byteLength(blob.content, 'utf8') > maxBytes) {
      throw new SourceReadLimitError(maxBytes);
    }

    return {
      content: blob.content,
      contentType: blobContentType(normalized),
      size: Buffer.byteLength(blob.content, 'utf8'),
    };
  }

  async write(_relativePath: string, _content: string): Promise<{ updatedAt?: string }> {
    throw new Error('GitHub source is read-only.');
  }

  async mkdir(_relativePath: string): Promise<void> {
    throw new Error('GitHub source is read-only.');
  }
}
