import { describe, expect, it } from 'vitest';
import type { FileSourceRecord } from '../../../../db/src/file-sources';
import { runFileSourceAdapterContractTests } from './adapter-contract';
import {
  S3AuthError,
  S3ClientError,
  S3NotFoundError,
  S3ThrottleError,
  extractS3ErrorCode,
  interpretS3Response,
  normalizeS3ETag,
  normalizeS3VersionId,
  parseS3Uri,
  type S3Client,
} from './s3-client';
import { S3FileSourceAdapter } from './s3';

function s3Source(overrides: Partial<FileSourceRecord> = {}): FileSourceRecord {
  const timestamp = '2026-08-26T00:00:00.000Z';
  return {
    id: 's3-source',
    display_name: 'Widget docs bucket',
    type: 's3',
    base_url: 's3://widget-docs/docs-root/',
    base_path: null,
    auth_type: 'none',
    auth_ref: null,
    enabled: true,
    icon: null,
    capabilities: '{}',
    health: 'ok',
    last_synced_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  };
}

interface FakeObject {
  content: string;
  etag?: string;
  versionId?: string;
  lastModified?: string;
}

const CONTRACT_OBJECTS: Record<string, FakeObject> = {
  'docs-root/readme.md': { content: '# widget\n', etag: '"9a8b7c"', versionId: 'v-1' },
  'docs-root/docs/a.md': { content: 'alpha\n', etag: '"aaaa-1"' },
  'docs-root/docs/b.md': { content: 'beta\n', etag: 'W/"bbbb"' },
};

interface S3FailureSpec {
  status: number;
  errorCode: string;
  headers?: Record<string, string>;
}

/**
 * Deterministic in-memory S3 client emulating ListObjectsV2 delimiter
 * semantics with real continuation tokens and fetch Response objects for
 * GetObject, including scripted typed XML failures.
 */
class FakeS3Client implements S3Client {
  readonly listCalls: Array<{ bucket: string; prefix: string; continuationToken?: string; delimiter?: string }> = [];
  readonly getCalls: Array<{ bucket: string; key: string }> = [];
  private readonly maxKeys: number;
  private readonly listFailure?: S3FailureSpec;
  private readonly getFailure?: S3FailureSpec;
  private readonly infinitePages: boolean;
  private readonly extraOutOfScopeKeys: string[];

  constructor(
    private readonly objects: Record<string, FakeObject>,
    options: {
      maxKeys?: number;
      listFailure?: S3FailureSpec;
      getFailure?: S3FailureSpec;
      infinitePages?: boolean;
      extraOutOfScopeKeys?: string[];
    } = {},
  ) {
    this.maxKeys = options.maxKeys ?? 100;
    this.listFailure = options.listFailure;
    this.getFailure = options.getFailure;
    this.infinitePages = options.infinitePages ?? false;
    this.extraOutOfScopeKeys = options.extraOutOfScopeKeys ?? [];
  }

  async listObjectsV2(options: {
    bucket: string;
    prefix: string;
    continuationToken?: string;
    maxKeys?: number;
    delimiter?: string;
  }): Promise<{
    objects: Array<{ key: string; size: number; lastModified?: string; etag?: string; versionId?: string }>;
    commonPrefixes: string[];
    nextContinuationToken: string | null;
  }> {
    this.listCalls.push({ ...options });
    if (this.listFailure) {
      // A real transport client interprets the XML error body; this fake uses
      // the same canonical mapping the adapter contract requires.
      throw interpretS3Response(this.listFailure.status, this.listFailure.headers ?? {}, this.listFailure.errorCode);
    }

    const effectiveMaxKeys = Math.min(options.maxKeys ?? this.maxKeys, this.maxKeys);
    const keys = Object.keys(this.objects)
      .filter((key) => key.startsWith(options.prefix))
      .concat(this.extraOutOfScopeKeys.filter((key) => key.startsWith(options.prefix)))
      .sort();

    const objectEntries: Array<{ key: string; size: number; lastModified?: string; etag?: string; versionId?: string }> = [];
    const prefixSet = new Set<string>();
    for (const key of keys) {
      const remainder = key.slice(options.prefix.length);
      if (options.delimiter && remainder.includes('/')) {
        prefixSet.add(`${options.prefix}${remainder.split('/')[0]}/`);
        continue;
      }
      const object = this.objects[key];
      if (!object) continue; // out-of-scope garbage: no object body exists
      objectEntries.push({
        key,
        size: Buffer.byteLength(object.content, 'utf8'),
        ...(object.lastModified ? { lastModified: object.lastModified } : {}),
        ...(object.etag ? { etag: object.etag } : {}),
        ...(object.versionId ? { versionId: object.versionId } : {}),
      });
    }

    // Merge objects and common prefixes into one S3-ordered page stream.
    const merged: Array<{ kind: 'object' | 'prefix'; sortKey: string }> = [
      ...objectEntries.map((entry) => ({ kind: 'object' as const, sortKey: entry.key })),
      ...Array.from(prefixSet).map((prefix) => ({ kind: 'prefix' as const, sortKey: prefix })),
    ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    const startIndex = options.continuationToken ? Number(options.continuationToken) : 0;
    const page = merged.slice(startIndex, startIndex + effectiveMaxKeys);
    const nextIndex = startIndex + effectiveMaxKeys;
    const done = !this.infinitePages && nextIndex >= merged.length;
    return {
      objects: page.filter((entry) => entry.kind === 'object').map((entry) => objectEntries.find((o) => o.key === entry.sortKey)!),
      commonPrefixes: page.filter((entry) => entry.kind === 'prefix').map((entry) => entry.sortKey),
      nextContinuationToken: done ? null : String(nextIndex),
    };
  }

  async getObject(options: { bucket: string; key: string }): Promise<Response> {
    this.getCalls.push({ ...options });
    if (this.getFailure) {
      const body = `<?xml version="1.0"?><Error><Code>${this.getFailure.errorCode}</Code></Error>`;
      return new Response(body, { status: this.getFailure.status, headers: this.getFailure.headers });
    }
    const object = this.objects[options.key];
    if (!object) {
      return new Response('<?xml version="1.0"?><Error><Code>NoSuchKey</Code></Error>', { status: 404 });
    }
    const headers: Record<string, string> = {
      'content-type': options.key.endsWith('.md') ? 'text/markdown' : 'application/octet-stream',
    };
    if (object.etag) headers.etag = object.etag;
    if (object.versionId) headers['x-amz-version-id'] = object.versionId;
    return new Response(object.content, { status: 200, headers });
  }
}

/** Shared contract suite: the S3 adapter must satisfy every clause against synthetic fixtures. */
runFileSourceAdapterContractTests({
  name: 's3 connector',
  createAdapter: () =>
    new S3FileSourceAdapter(s3Source(), {
      client: new FakeS3Client(CONTRACT_OBJECTS, { maxKeys: 2 }),
    }),
  fixture: {
    rootTree: [
      { path: 'docs', isDirectory: true },
      { path: 'readme.md', isDirectory: false },
    ],
    files: {
      'readme.md': '# widget\n',
      'docs/a.md': 'alpha\n',
      'docs/b.md': 'beta\n',
    },
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
});

describe('s3 connector adapter', () => {
  it('follows ListObjectsV2 pagination until the terminal page', async () => {
    const client = new FakeS3Client(CONTRACT_OBJECTS, { maxKeys: 1 });
    const adapter = new S3FileSourceAdapter(s3Source(), { client });

    const nodes = await adapter.list('');
    expect(nodes.map((node) => node.path)).toEqual(['docs', 'readme.md']);
    // Under delimiter semantics the root has 2 merged entries (the docs/
    // common prefix + readme.md); at 1 per page that is 2 pages.
    expect(client.listCalls).toHaveLength(2);
    expect(client.listCalls.map((call) => call.continuationToken)).toEqual([undefined, '1']);
    expect(client.listCalls.every((call) => call.delimiter === '/')).toBe(true);
  });

  it('rejects runaway pagination with a typed guard', async () => {
    const client = new FakeS3Client(CONTRACT_OBJECTS, { infinitePages: true });
    const adapter = new S3FileSourceAdapter(s3Source(), { client, maxListPages: 3 });

    await expect(adapter.list('')).rejects.toMatchObject({
      name: 'S3PaginationLimitError',
      code: 'S3_PAGINATION_LIMIT',
    });
    expect(client.listCalls).toHaveLength(3);
  });

  it('filters out-of-scope keys a buggy upstream might return', async () => {
    const client = new FakeS3Client(
      { ...CONTRACT_OBJECTS, 'other-root/leak.txt': { content: 'leak\n' } },
      { extraOutOfScopeKeys: ['other-root/leak.txt'] },
    );
    const adapter = new S3FileSourceAdapter(s3Source(), { client });

    const nodes = await adapter.list('');
    expect(nodes.map((node) => node.path)).toEqual(['docs', 'readme.md']);
  });

  it('rejects traversal paths before any client call', async () => {
    const client = new FakeS3Client(CONTRACT_OBJECTS);
    const adapter = new S3FileSourceAdapter(s3Source(), { client });

    await expect(adapter.read('../escape.txt')).rejects.toThrow(/traversal|not allowed/i);
    await expect(adapter.list('docs/../../escape')).rejects.toThrow(/traversal|not allowed/i);
    expect(client.listCalls).toHaveLength(0);
    expect(client.getCalls).toHaveLength(0);
  });

  it('rejects invalid S3 URIs without contacting the client', async () => {
    for (const baseUrl of ['', null, 'https://widget-docs.s3.amazonaws.com/', 's3://', 's3:///docs/'] as Array<string | null>) {
      const client = new FakeS3Client(CONTRACT_OBJECTS);
      const adapter = new S3FileSourceAdapter(s3Source({ base_url: baseUrl }), { client });
      await expect(adapter.validate(s3Source({ base_url: baseUrl }))).rejects.toMatchObject({
        name: 'S3ConfigError',
        code: 'S3_CONFIG',
      });
      expect(client.listCalls).toHaveLength(0);
    }
  });

  it('reads objects with normalized ETag and version metadata', async () => {
    const client = new FakeS3Client(CONTRACT_OBJECTS);
    const adapter = new S3FileSourceAdapter(s3Source(), { client });

    const quoted = await adapter.read('readme.md');
    expect(quoted.content).toBe('# widget\n');
    expect(quoted.etag).toBe('9a8b7c');
    expect(quoted.versionId).toBe('v-1');

    const weak = await adapter.read('docs/b.md');
    expect(weak.etag).toBe('bbbb');

    const unversioned = await adapter.read('docs/a.md');
    expect(unversioned.etag).toBe('aaaa-1');
    expect(unversioned.versionId).toBeUndefined();
  });

  it('bounds GetObject reads with the typed read-limit error', async () => {
    const adapter = new S3FileSourceAdapter(s3Source(), {
      client: new FakeS3Client(CONTRACT_OBJECTS),
    });

    await expect(adapter.read('readme.md', { maxBytes: 4 })).rejects.toMatchObject({
      name: 'SourceReadLimitError',
      code: 'SOURCE_READ_LIMIT_EXCEEDED',
    });
  });

  it('validates with a single bounded list probe', async () => {
    const client = new FakeS3Client(CONTRACT_OBJECTS);
    const adapter = new S3FileSourceAdapter(s3Source(), { client });

    await adapter.validate(s3Source());
    expect(client.listCalls).toHaveLength(1);
  });

  it('maps missing keys to a typed not-found error', async () => {
    const client = new FakeS3Client(CONTRACT_OBJECTS);
    const adapter = new S3FileSourceAdapter(s3Source(), { client });

    await expect(adapter.read('docs/missing.md')).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(S3NotFoundError);
      expect(error).toBeInstanceOf(S3ClientError);
      expect((error as S3NotFoundError).code).toBe('S3_NOT_FOUND');
      return true;
    });
  });

  it('maps 403 access failures to a typed auth error', async () => {
    for (const errorCode of ['AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch']) {
      const adapter = new S3FileSourceAdapter(s3Source(), {
        client: new FakeS3Client(CONTRACT_OBJECTS, {
          listFailure: { status: 403, errorCode },
        }),
      });

      await expect(adapter.validate(s3Source())).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(S3AuthError);
        expect((error as S3AuthError).code).toBe('S3_AUTH');
        expect((error as S3AuthError).errorCode).toBe(errorCode);
        expect((error as S3AuthError).status).toBe(403);
        return true;
      });
    }
  });

  it('maps SlowDown to a typed throttle error with retry guidance', async () => {
    const adapter = new S3FileSourceAdapter(s3Source(), {
      client: new FakeS3Client(CONTRACT_OBJECTS, {
        getFailure: { status: 503, errorCode: 'SlowDown', headers: { 'retry-after': '30' } },
      }),
    });

    await expect(adapter.read('readme.md')).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(S3ThrottleError);
      const throttle = error as S3ThrottleError;
      expect(throttle.code).toBe('S3_THROTTLE');
      expect(throttle.retryAfterSeconds).toBe(30);
      expect(throttle.errorCode).toBe('SlowDown');
      return true;
    });
  });
});

describe('s3 client helpers', () => {
  it('parses supported s3:// URI shapes', () => {
    expect(parseS3Uri('s3://widget-docs')).toEqual({ bucket: 'widget-docs', prefix: '' });
    expect(parseS3Uri('s3://widget-docs/')).toEqual({ bucket: 'widget-docs', prefix: '' });
    expect(parseS3Uri('s3://widget-docs/docs-root/')).toEqual({ bucket: 'widget-docs', prefix: 'docs-root/' });
    expect(parseS3Uri('s3://widget-docs/docs-root')).toEqual({ bucket: 'widget-docs', prefix: 'docs-root/' });
  });

  it('rejects malformed or non-s3 URIs', () => {
    expect(() => parseS3Uri('')).toThrow(/s3:\/\//i);
    expect(() => parseS3Uri('https://widget-docs.s3.amazonaws.com/')).toThrow(/s3:\/\//i);
    expect(() => parseS3Uri('s3://')).toThrow(/bucket/i);
    expect(() => parseS3Uri('s3:///docs/')).toThrow(/bucket/i);
    expect(() => parseS3Uri('s3://widget-docs/../escape/')).toThrow(/traversal/i);
    expect(() => parseS3Uri('s3://widget-docs/docs?x=1')).toThrow(/query|fragment/i);
  });

  it('normalizes ETags by stripping quotes, weak markers, and whitespace', () => {
    expect(normalizeS3ETag('"abc123"')).toBe('abc123');
    expect(normalizeS3ETag('W/"abc123"')).toBe('abc123');
    expect(normalizeS3ETag('  "abc-2" ')).toBe('abc-2');
    expect(normalizeS3ETag('')).toBeUndefined();
    expect(normalizeS3ETag(undefined)).toBeUndefined();
    expect(normalizeS3ETag('""')).toBeUndefined();
  });

  it('normalizes version ids, treating the unversioned literal as absent', () => {
    expect(normalizeS3VersionId(' v-3 ')).toBe('v-3');
    expect(normalizeS3VersionId('null')).toBeUndefined();
    expect(normalizeS3VersionId('')).toBeUndefined();
    expect(normalizeS3VersionId(undefined)).toBeUndefined();
  });

  it('extracts S3 error codes from XML error bodies', () => {
    expect(extractS3ErrorCode('<?xml version="1.0"?><Error><Code>NoSuchKey</Code></Error>')).toBe('NoSuchKey');
    expect(extractS3ErrorCode('<Error><Code>SlowDown</Code><Message>slow</Message></Error>')).toBe('SlowDown');
    expect(extractS3ErrorCode('not xml')).toBeUndefined();
    expect(extractS3ErrorCode('')).toBeUndefined();
  });
});
