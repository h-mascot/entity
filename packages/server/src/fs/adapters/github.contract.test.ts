import { describe, expect, it } from 'vitest';
import type { FileSourceRecord } from '../../../../db/src/file-sources';
import { runFileSourceAdapterContractTests } from './adapter-contract';
import {
  GitHubAuthError,
  GitHubClientError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  GitHubServerError,
  githubErrorFromStatus,
  redactBearerText,
  type GitHubClient,
  type GitHubTreeEntry,
} from './github-client';
import { GitHubFileSourceAdapter, parseGitHubRepositoryRef } from './github';

const SOURCE_TOKEN = 'ghp_contracttoken123';

function githubSource(overrides: Partial<FileSourceRecord> = {}): FileSourceRecord {
  const timestamp = '2026-08-26T00:00:00.000Z';
  return {
    id: 'github-source',
    display_name: 'Widget docs',
    type: 'github',
    base_url: 'https://github.com/acme/widget',
    base_path: null,
    auth_type: 'bearer',
    auth_ref: SOURCE_TOKEN,
    enabled: true,
    icon: null,
    capabilities: JSON.stringify({ ref: 'v2026.08' }),
    health: 'ok',
    last_synced_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  };
}

const CONTRACT_TREE: GitHubTreeEntry[] = [
  { path: 'docs', type: 'tree' },
  { path: 'docs/a.md', type: 'blob', size: 6 },
  { path: 'docs/b.md', type: 'blob', size: 5 },
  { path: 'readme.md', type: 'blob', size: 9 },
];

const CONTRACT_BLOBS: Record<string, string> = {
  'readme.md': '# widget\n',
  'docs/a.md': 'alpha\n',
  'docs/b.md': 'beta\n',
};

interface FailureSpec {
  status: number;
  headers?: Record<string, string>;
}

/** Deterministic in-memory GitHub client: paged trees, exact blobs, scripted typed failures. */
class FakeGitHubClient implements GitHubClient {
  readonly listTreeCalls: Array<{ owner: string; repo: string; ref: string; cursor?: string }> = [];
  readonly getBlobCalls: Array<{ owner: string; repo: string; ref: string; path: string }> = [];
  private readonly pageSize: number;
  private readonly listTreeFailure?: FailureSpec;
  private readonly blobFailure?: FailureSpec;
  private readonly leakToken?: string;
  private readonly infinitePages: boolean;

  constructor(
    private readonly tree: GitHubTreeEntry[],
    private readonly blobs: Record<string, string>,
    options: {
      pageSize?: number;
      listTreeFailure?: FailureSpec;
      blobFailure?: FailureSpec;
      leakToken?: string;
      infinitePages?: boolean;
    } = {},
  ) {
    this.pageSize = options.pageSize ?? 100;
    this.listTreeFailure = options.listTreeFailure;
    this.blobFailure = options.blobFailure;
    this.leakToken = options.leakToken;
    this.infinitePages = options.infinitePages ?? false;
  }

  async listTree(options: { owner: string; repo: string; ref: string; cursor?: string }): Promise<{ entries: GitHubTreeEntry[]; nextCursor: string | null }> {
    this.listTreeCalls.push({ ...options });
    if (this.listTreeFailure) {
      throw githubErrorFromStatus(this.listTreeFailure.status, this.listTreeFailure.headers ?? {});
    }
    if (this.leakToken) {
      throw new Error(`GET https://api.github.com/repos/${options.owner}/${options.repo}/git/trees failed (Authorization: Bearer ${this.leakToken})`);
    }
    const startIndex = options.cursor ? Number(options.cursor) : 0;
    const entries = this.tree.slice(startIndex, startIndex + this.pageSize);
    const nextIndex = startIndex + this.pageSize;
    const done = !this.infinitePages && nextIndex >= this.tree.length;
    return { entries, nextCursor: done ? null : String(nextIndex) };
  }

  async getBlob(options: { owner: string; repo: string; ref: string; path: string }): Promise<Response> {
    this.getBlobCalls.push({ ...options });
    if (this.blobFailure) {
      return new Response(null, {
        status: this.blobFailure.status,
        headers: this.blobFailure.headers ?? {},
      });
    }
    if (this.leakToken) {
      throw new Error(`GET .../contents/${options.path} failed (Authorization: Bearer ${this.leakToken})`);
    }
    const content = this.blobs[options.path];
    if (content === undefined) {
      return new Response(null, { status: 404 });
    }
    return new Response(content, {
      headers: { 'content-length': String(Buffer.byteLength(content, 'utf8')) },
    });
  }
}

/** Shared contract suite: the GitHub adapter must satisfy every clause against synthetic fixtures. */
runFileSourceAdapterContractTests({
  name: 'github connector',
  createAdapter: () =>
    new GitHubFileSourceAdapter(githubSource(), {
      client: new FakeGitHubClient(CONTRACT_TREE, CONTRACT_BLOBS, { pageSize: 2 }),
    }),
  fixture: {
    rootTree: [
      { path: 'docs', isDirectory: true },
      { path: 'readme.md', isDirectory: false },
    ],
    files: CONTRACT_BLOBS,
    subdirectory: {
      path: 'docs',
      expected: [
        { path: 'docs/a.md', isDirectory: false },
        { path: 'docs/b.md', isDirectory: false },
      ],
    },
  },
  readOnly: true,
  capabilities: { read: true, write: false, rename: false, delete: false, list: true, search: false },
  redactedSecret: SOURCE_TOKEN,
});

describe('github connector adapter', () => {
  it('follows tree pagination until the terminal page', async () => {
    const client = new FakeGitHubClient(CONTRACT_TREE, CONTRACT_BLOBS, { pageSize: 2 });
    const adapter = new GitHubFileSourceAdapter(githubSource(), { client });

    const nodes = await adapter.list('');
    expect(nodes.map((node) => node.path)).toEqual(['docs', 'readme.md']);
    // 4 entries over 2-per-page = 2 pages.
    expect(client.listTreeCalls).toHaveLength(2);
    expect(client.listTreeCalls.map((call) => call.cursor)).toEqual([undefined, '2']);
  });

  it('rejects runaway pagination with a typed guard', async () => {
    const client = new FakeGitHubClient(CONTRACT_TREE, CONTRACT_BLOBS, { infinitePages: true });
    const adapter = new GitHubFileSourceAdapter(githubSource(), { client, maxTreePages: 4 });

    await expect(adapter.list('')).rejects.toMatchObject({
      name: 'GitHubPaginationLimitError',
      code: 'GITHUB_PAGINATION_LIMIT',
    });
    expect(client.listTreeCalls).toHaveLength(4);
  });

  it('scopes subtree listings to the requested path', async () => {
    const tree: GitHubTreeEntry[] = [
      ...CONTRACT_TREE,
      { path: 'other', type: 'tree' },
      { path: 'other/file.txt', type: 'blob', size: 4 },
    ];
    const blobs = { ...CONTRACT_BLOBS, 'other/file.txt': 'zzzz' };
    const adapter = new GitHubFileSourceAdapter(githubSource(), {
      client: new FakeGitHubClient(tree, blobs),
    });

    const nodes = await adapter.list('docs');
    expect(nodes.map((node) => node.path)).toEqual(['docs/a.md', 'docs/b.md']);
  });

  it('rejects traversal paths before any client call', async () => {
    const client = new FakeGitHubClient(CONTRACT_TREE, CONTRACT_BLOBS);
    const adapter = new GitHubFileSourceAdapter(githubSource(), { client });

    await expect(adapter.read('../escape.txt')).rejects.toThrow(/traversal|not allowed/i);
    await expect(adapter.list('docs/../../escape')).rejects.toThrow(/traversal|not allowed/i);
    expect(client.listTreeCalls).toHaveLength(0);
    expect(client.getBlobCalls).toHaveLength(0);
  });

  it('rejects invalid repository configuration without contacting the client', async () => {
    for (const baseUrl of ['', null, 'https://gitlab.com/acme/widget', 'acme', 'https://github.com/acme/'] as Array<string | null>) {
      const client = new FakeGitHubClient(CONTRACT_TREE, CONTRACT_BLOBS);
      const adapter = new GitHubFileSourceAdapter(githubSource({ base_url: baseUrl }), { client });
      await expect(adapter.validate(githubSource({ base_url: baseUrl }))).rejects.toMatchObject({
        name: 'GitHubConfigError',
        code: 'GITHUB_CONFIG',
      });
      expect(client.listTreeCalls).toHaveLength(0);
    }
  });

  it('reads blob content with an honest size and markdown content type', async () => {
    const adapter = new GitHubFileSourceAdapter(githubSource(), {
      client: new FakeGitHubClient(CONTRACT_TREE, CONTRACT_BLOBS),
    });

    const result = await adapter.read('docs/a.md');
    expect(result.content).toBe('alpha\n');
    expect(result.size).toBe(6);
    expect(result.contentType).toBe('text/markdown');
  });

  it('rejects reads of paths that are not blobs in the tree', async () => {
    const adapter = new GitHubFileSourceAdapter(githubSource(), {
      client: new FakeGitHubClient(CONTRACT_TREE, CONTRACT_BLOBS),
    });

    await expect(adapter.read('docs')).rejects.toMatchObject({ name: 'GitHubNotFoundError', code: 'GITHUB_NOT_FOUND' });
  });

  it('enforces the bounded read limit', async () => {
    const adapter = new GitHubFileSourceAdapter(githubSource(), {
      client: new FakeGitHubClient(CONTRACT_TREE, CONTRACT_BLOBS),
    });

    await expect(adapter.read('readme.md', { maxBytes: 4 })).rejects.toMatchObject({
      name: 'SourceReadLimitError',
      code: 'SOURCE_READ_LIMIT_EXCEEDED',
    });
  });

  it('validates with a single first-page probe', async () => {
    const client = new FakeGitHubClient(CONTRACT_TREE, CONTRACT_BLOBS, { pageSize: 2 });
    const adapter = new GitHubFileSourceAdapter(githubSource(), { client });

    await adapter.validate(githubSource());
    expect(client.listTreeCalls).toHaveLength(1);
  });

  it('propagates typed auth failures for 401 and plain 403', async () => {
    for (const status of [401, 403]) {
      const client = new FakeGitHubClient(CONTRACT_TREE, CONTRACT_BLOBS, { listTreeFailure: { status } });
      const adapter = new GitHubFileSourceAdapter(githubSource(), { client });

      await expect(adapter.validate(githubSource())).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(GitHubAuthError);
        expect(error).toBeInstanceOf(GitHubClientError);
        expect((error as GitHubAuthError).code).toBe('GITHUB_AUTH');
        expect((error as GitHubAuthError).status).toBe(status);
        return true;
      });
    }
  });

  it('propagates a typed rate-limit failure with retry guidance', async () => {
    const client = new FakeGitHubClient(CONTRACT_TREE, CONTRACT_BLOBS, {
      listTreeFailure: {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'retry-after': '42', 'x-ratelimit-reset': '1893456000' },
      },
    });
    const adapter = new GitHubFileSourceAdapter(githubSource(), { client });

    await expect(adapter.list('')).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(GitHubRateLimitError);
      const rateLimit = error as GitHubRateLimitError;
      expect(rateLimit.code).toBe('GITHUB_RATE_LIMIT');
      expect(rateLimit.retryAfterSeconds).toBe(42);
      expect(rateLimit.resetAtEpochSeconds).toBe(1893456000);
      return true;
    });
  });

  it('classifies 429 with retry-after as a rate-limit failure', async () => {
    const client = new FakeGitHubClient(CONTRACT_TREE, CONTRACT_BLOBS, {
      blobFailure: { status: 429, headers: { 'retry-after': '7' } },
    });
    const adapter = new GitHubFileSourceAdapter(githubSource(), { client });

    await expect(adapter.read('readme.md')).rejects.toMatchObject({
      name: 'GitHubRateLimitError',
      code: 'GITHUB_RATE_LIMIT',
      retryAfterSeconds: 7,
    });
  });

  it('propagates typed 5xx failures', async () => {
    for (const status of [500, 503]) {
      const client = new FakeGitHubClient(CONTRACT_TREE, CONTRACT_BLOBS, { listTreeFailure: { status } });
      const adapter = new GitHubFileSourceAdapter(githubSource(), { client });

      await expect(adapter.list('')).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(GitHubServerError);
        expect((error as GitHubServerError).code).toBe('GITHUB_SERVER_ERROR');
        expect((error as GitHubServerError).status).toBe(status);
        return true;
      });
    }
  });

  it('propagates typed not-found failures', async () => {
    const client = new FakeGitHubClient(CONTRACT_TREE, CONTRACT_BLOBS, { listTreeFailure: { status: 404 } });
    const adapter = new GitHubFileSourceAdapter(githubSource(), { client });

    await expect(adapter.list('')).rejects.toMatchObject({
      name: 'GitHubNotFoundError',
      code: 'GITHUB_NOT_FOUND',
      status: 404,
    });
  });

  it('redacts bearer tokens leaked by transport errors (default auth_ref resolution)', async () => {
    const client = new FakeGitHubClient(CONTRACT_TREE, CONTRACT_BLOBS, { leakToken: SOURCE_TOKEN });
    const adapter = new GitHubFileSourceAdapter(githubSource(), { client });

    await expect(adapter.list('')).rejects.toSatisfy((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('[REDACTED]');
      expect(message).not.toContain(SOURCE_TOKEN);
      return true;
    });
  });

  it('never caches by default and caches explicitly under a memory policy', async () => {
    const noCacheClient = new FakeGitHubClient(CONTRACT_TREE, CONTRACT_BLOBS, { pageSize: 2 });
    const noCacheAdapter = new GitHubFileSourceAdapter(githubSource(), { client: noCacheClient });
    await noCacheAdapter.list('');
    await noCacheAdapter.list('');
    expect(noCacheClient.listTreeCalls).toHaveLength(4); // 2 pages per listing, no caching

    let clock = 1_000_000;
    const cachedClient = new FakeGitHubClient(CONTRACT_TREE, CONTRACT_BLOBS, { pageSize: 2 });
    const cachedAdapter = new GitHubFileSourceAdapter(githubSource(), {
      client: cachedClient,
      cachePolicy: { mode: 'memory', ttlMs: 60_000 },
      now: () => clock,
    });
    await cachedAdapter.list('');
    await cachedAdapter.list('docs');
    expect(cachedClient.listTreeCalls).toHaveLength(2); // one paged fetch only

    clock += 60_001; // ttl expiry forces a refetch
    await cachedAdapter.list('');
    expect(cachedClient.listTreeCalls).toHaveLength(4);
  });
});

describe('github bounded transport boundary', () => {
  it('rejects an oversized blob stream without materializing content beyond the configured cap', async () => {
    const CHUNK = 1024;
    const CAP = 4 * CHUNK;
    const TOTAL_BYTES = 64 * CHUNK;
    let produced = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (produced >= TOTAL_BYTES) {
          controller.close();
          return;
        }
        produced += CHUNK;
        controller.enqueue(new Uint8Array(CHUNK).fill(0x61));
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 });
    const tree: GitHubTreeEntry[] = [
      // Tree metadata lies small; the actual body dwarfs the cap.
      { path: 'big.md', type: 'blob', size: CHUNK },
    ];
    const client: GitHubClient = {
      listTree: async () => ({ entries: tree, nextCursor: null }),
      getBlob: async () => new Response(stream, { headers: { 'content-type': 'text/markdown' } }),
    };
    const adapter = new GitHubFileSourceAdapter(githubSource(), { client });

    await expect(adapter.read('big.md', { maxBytes: CAP })).rejects.toMatchObject({
      name: 'SourceReadLimitError',
      code: 'SOURCE_READ_LIMIT_EXCEEDED',
    });
    expect(cancelled).toBe(true);
    // At most the cap plus the single in-flight chunk is ever pulled from the
    // transport: the 64 KiB body is never materialized.
    expect(produced).toBeLessThanOrEqual(CAP + CHUNK);
    expect(produced).toBeLessThan(TOTAL_BYTES);
  });

  it('rejects an oversized declared content-length before pulling any body bytes', async () => {
    let produced = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        produced += 1024;
        controller.enqueue(new Uint8Array(1024));
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 });
    const tree: GitHubTreeEntry[] = [{ path: 'huge.md', type: 'blob', size: 1024 }];
    const client: GitHubClient = {
      listTree: async () => ({ entries: tree, nextCursor: null }),
      getBlob: async () =>
        new Response(stream, { headers: { 'content-length': String(64 * 1024) } }),
    };
    const adapter = new GitHubFileSourceAdapter(githubSource(), { client });

    await expect(adapter.read('huge.md', { maxBytes: 4096 })).rejects.toMatchObject({
      name: 'SourceReadLimitError',
      code: 'SOURCE_READ_LIMIT_EXCEEDED',
    });
    expect(produced).toBe(0);
    expect(cancelled).toBe(true);
  });
});

describe('github client helpers', () => {
  it('maps unclassified statuses to a typed request error', () => {
    const error = githubErrorFromStatus(400, {});
    expect(error).toBeInstanceOf(GitHubClientError);
    expect(error.name).toBe('GitHubClientRequestError');
    expect(error.code).toBe('GITHUB_REQUEST_ERROR');
    expect(error.status).toBe(400);
  });

  it('parses owner/repository from supported base_url shapes', () => {
    expect(parseGitHubRepositoryRef('https://github.com/acme/widget')).toEqual({ owner: 'acme', repo: 'widget' });
    expect(parseGitHubRepositoryRef('https://github.com/acme/widget/')).toEqual({ owner: 'acme', repo: 'widget' });
    expect(parseGitHubRepositoryRef('https://github.com/acme/widget.git')).toEqual({ owner: 'acme', repo: 'widget' });
    expect(parseGitHubRepositoryRef('acme/widget')).toEqual({ owner: 'acme', repo: 'widget' });
    expect(() => parseGitHubRepositoryRef('https://gitlab.com/acme/widget')).toThrow(/github/i);
    expect(() => parseGitHubRepositoryRef('acme')).toThrow(/owner\/repository/i);
    expect(() => parseGitHubRepositoryRef('')).toThrow(/base_url/i);
  });

  it('redacts bearer tokens from arbitrary text', () => {
    expect(redactBearerText('Bearer ghp abc-123 leaked', 'abc-123')).toBe('Bearer ghp [REDACTED] leaked');
    expect(redactBearerText('clean message', 'abc-123')).toBe('clean message');
    expect(redactBearerText('empty token stays', '')).toBe('empty token stays');
    expect(redactBearerText('undefined token stays', undefined)).toBe('undefined token stays');
  });
});
