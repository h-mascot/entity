import { constants as bufferConstants } from 'node:buffer';
import http from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileSourceRecord } from '../../../db/src/file-sources';

const listSourcesMock = vi.fn();
const getSourceMock = vi.fn();
const updateSourceMock = vi.fn();
const startSyncRunMock = vi.fn();
const finishSyncRunMock = vi.fn();
const upsertRecordMock = vi.fn();
const deleteBySourcePathPrefixMock = vi.fn();
const reconcileSourcePathsMock = vi.fn();
const createFileSourceAdapterMock = vi.fn();
const emitFsAuditMock = vi.fn();
const recordFsOperationMock = vi.fn();

vi.mock('../../../db/src/file-sources', () => ({
  createFileSourceRepository: () => ({
    listSources: listSourcesMock,
    getSource: getSourceMock,
    createSource: vi.fn(),
    updateSource: updateSourceMock,
    setEnabled: vi.fn(),
    deleteSource: vi.fn(),
  }),
}));

vi.mock('../../../db/src/file-index', () => ({
  createFileIndexRepository: () => ({
    upsertRecord: upsertRecordMock,
    search: vi.fn(),
    listBySource: vi.fn(),
    deleteBySourcePathPrefix: deleteBySourcePathPrefixMock,
    reconcileSourcePaths: reconcileSourcePathsMock,
    startSyncRun: startSyncRunMock,
    finishSyncRun: finishSyncRunMock,
    getLatestSyncRun: vi.fn(),
  }),
}));

vi.mock('./adapters/registry', () => ({
  createFileSourceAdapter: createFileSourceAdapterMock,
}));

vi.mock('./security', async () => {
  const actual = await vi.importActual<typeof import('./security')>('./security');

  return {
    ...actual,
    emitFsAudit: emitFsAuditMock,
  };
});

vi.mock('./metrics', () => ({
  recordFsOperation: recordFsOperationMock,
}));

const bookSource: FileSourceRecord = {
  id: 'book',
  display_name: 'Book',
  type: 'local',
  base_url: null,
  base_path: '/book',
  auth_type: 'none',
  auth_ref: null,
  enabled: true,
  icon: null,
  capabilities: '{}',
  health: 'ok',
  last_synced_at: null,
  created_at: '2026-06-17T00:00:00.000Z',
  updated_at: '2026-06-17T00:00:00.000Z',
};

const spockSource: FileSourceRecord = {
  ...bookSource,
  id: 'spock',
  display_name: 'Spock',
  base_path: '/spock',
};

type FixtureNode = {
  path: string;
  name: string;
  isDirectory: boolean;
  size?: number;
  updatedAt?: string;
};

type FixtureMetadata = {
  path: string;
  name: string;
  kind: 'file' | 'directory' | 'other';
  size?: number;
  updatedAt?: string;
};

function node(path: string, isDirectory: boolean, size?: number): FixtureNode {
  return {
    path,
    name: path.split('/').pop() ?? path,
    isDirectory,
    ...(size === undefined ? {} : { size }),
    updatedAt: '2026-06-17T00:00:00.000Z',
  };
}

function metadata(path: string, kind: FixtureMetadata['kind'], size?: number): FixtureMetadata {
  return {
    path,
    name: path.split('/').pop() ?? path,
    kind,
    ...(size === undefined ? {} : { size }),
    updatedAt: '2026-06-17T00:00:00.000Z',
  };
}

function createAdapter(
  fixtures: Map<string, FixtureNode[]>,
  metadataByPath: Map<string, FixtureMetadata>,
  forbiddenReadPaths: Set<string>
) {
  const list = vi.fn(async (path: string) => fixtures.get(path) ?? []);
  const stat = vi.fn(async (path: string) => {
    const result = metadataByPath.get(path);
    if (!result) {
      throw new Error(`missing test metadata: ${path}`);
    }
    return result;
  });
  const read = vi.fn(async (path: string) => {
    if (forbiddenReadPaths.has(path)) {
      throw new Error(`deterministic skip fixture should not be read: ${path}`);
    }

    if (path === 'notes/unreadable.md') {
      throw new Error('permission denied');
    }

    return {
      content: `# ${path}\ncontent`,
      updatedAt: '2026-06-17T00:00:00.000Z',
    };
  });

  return {
    adapter: {
      validate: vi.fn(async () => undefined),
      capabilities: vi.fn(() => ({ read: true, write: false, rename: false, delete: false, list: true, search: false })),
      list,
      stat,
      read,
      write: vi.fn(),
      mkdir: vi.fn(),
    },
    list,
    stat,
    read,
  };
}

describe('FileIndexRunner deterministic incident skips', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    listSourcesMock.mockReturnValue([bookSource, spockSource]);
    getSourceMock.mockImplementation((id: string) => (id === 'book' ? bookSource : id === 'spock' ? spockSource : undefined));
    updateSourceMock.mockImplementation((id: string) => (id === 'book' ? bookSource : spockSource));
    startSyncRunMock.mockImplementation((sourceId: string) => ({
      id: sourceId === 'book' ? 1 : 2,
      source_id: sourceId,
      status: 'running',
      started_at: '2026-06-17T00:00:00.000Z',
      finished_at: null,
      error: null,
      files_scanned: 0,
      files_indexed: 0,
    }));
    finishSyncRunMock.mockImplementation((id: number, status: string) => ({
      id,
      source_id: id === 1 ? 'book' : 'spock',
      status,
      started_at: '2026-06-17T00:00:00.000Z',
      finished_at: '2026-06-17T00:00:01.000Z',
      error: null,
      files_scanned: 0,
      files_indexed: 0,
    }));
    upsertRecordMock.mockImplementation((input) => input);
    deleteBySourcePathPrefixMock.mockReturnValue(0);
    reconcileSourcePathsMock.mockReturnValue(0);
  });

  it('removes stale index records after a complete source scan', async () => {
    listSourcesMock.mockReturnValue([bookSource]);
    const fixtures = new Map<string, FixtureNode[]>([['', [node('notes/current.md', false)]]]);
    const metadataByPath = new Map<string, FixtureMetadata>([
      ['notes/current.md', metadata('notes/current.md', 'file')],
    ]);
    const bookAdapter = createAdapter(fixtures, metadataByPath, new Set());
    createFileSourceAdapterMock.mockReturnValue(bookAdapter.adapter);

    const { FileIndexRunner } = await import('./index-runner');
    const runner = new FileIndexRunner({ maxConcurrentSources: 1 });

    await runner.runOnce();

    expect(reconcileSourcePathsMock).toHaveBeenCalledWith('book', ['notes/current.md']);
  });

  it('stores readable titles and previews for generated HTML files', async () => {
    listSourcesMock.mockReturnValue([bookSource]);
    const htmlPath = 'quickstart.html';
    const fixtures = new Map<string, FixtureNode[]>([['', [node(htmlPath, false)]]]);
    const metadataByPath = new Map<string, FixtureMetadata>([[htmlPath, metadata(htmlPath, 'file')]]);
    const bookAdapter = createAdapter(fixtures, metadataByPath, new Set());
    bookAdapter.read.mockResolvedValue({
      content: '<!doctype html><html><head><style>.x{}</style></head><body><h1>Entity Quickstart</h1><p>Start &amp; verify.</p></body></html>',
      updatedAt: '2026-06-17T00:00:00.000Z',
    });
    createFileSourceAdapterMock.mockReturnValue(bookAdapter.adapter);

    const { FileIndexRunner } = await import('./index-runner');
    const runner = new FileIndexRunner({ maxConcurrentSources: 1 });
    await runner.runOnce();

    expect(upsertRecordMock).toHaveBeenCalledWith(expect.objectContaining({
      path: htmlPath,
      title: 'Entity Quickstart',
      preview: 'Entity Quickstart Start & verify.',
    }));
  });

  it('indexes markdown files listed by an HTTP manifest', async () => {
    const { HttpMarkdownFileSourceAdapter } = await import('./adapters/http-markdown');
    const manifest = JSON.stringify({
      version: 1,
      generatedAt: '2026-08-23T00:00:00.000Z',
      files: [{
        path: 'docs/alpha.md',
        size: 13,
        sha256: 'a'.repeat(64),
        updatedAt: '2026-08-23T00:00:00.000Z',
      }],
    });
    const server = http.createServer((request, response) => {
      const body = request.url === '/manifest.json'
        ? manifest
        : request.url === '/docs/alpha.md'
          ? '# Alpha\ncontent'
          : 'ok';
      response.writeHead(200, {
        'content-type': request.url === '/manifest.json' ? 'application/json' : 'text/markdown',
      });
      response.end(body);
    });
    let fixtureAvailable = true;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
    } catch (error) {
      server.close();
      server.unref();
      if ((error as NodeJS.ErrnoException)?.code === 'EPERM') fixtureAvailable = false;
      else throw error;
    }
    const address = fixtureAvailable ? server.address() : null;
    if (fixtureAvailable && (!address || typeof address === 'string')) throw new Error('fixture server failed to bind');

    const originalFetch = globalThis.fetch;
    if (!fixtureAvailable) {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const inputUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const pathname = new URL(inputUrl).pathname || '/';
        const body = pathname === '/manifest.json'
          ? manifest
          : pathname === '/docs/alpha.md'
            ? '# Alpha\ncontent'
            : 'ok';
        return new Response(body, {
          status: 200,
          headers: { 'content-type': pathname === '/manifest.json' ? 'application/json' : 'text/markdown' },
        });
      });
    }

    const source: FileSourceRecord = {
      ...bookSource,
      id: 'manifest-http',
      type: 'http-markdown',
      base_path: null,
      base_url: fixtureAvailable ? `http://127.0.0.1:${(address as { port: number }).port}` : 'http://fixture.test',
      capabilities: JSON.stringify({ manifestPath: 'manifest.json' }),
    };
    listSourcesMock.mockReturnValue([source]);
    getSourceMock.mockReturnValue(source);
    updateSourceMock.mockReturnValue(source);
    createFileSourceAdapterMock.mockReturnValue(new HttpMarkdownFileSourceAdapter(source));

    try {
      const { FileIndexRunner } = await import('./index-runner');
      const runner = new FileIndexRunner({ maxConcurrentSources: 1 });
      await runner.runOnceForSource(source.id);

      expect(upsertRecordMock).toHaveBeenCalledWith(expect.objectContaining({
        source_id: source.id,
        path: 'docs/alpha.md',
        title: 'Alpha',
        preview: '# Alpha\ncontent',
      }));
      expect(reconcileSourcePathsMock).toHaveBeenCalledWith(source.id, ['docs/alpha.md']);
    } finally {
      if (fixtureAvailable) {
        server.closeAllConnections();
        server.close();
        server.unref();
      } else {
        globalThis.fetch = originalFetch;
      }
    }
  });

  it('does not remove index records when the source scan hits its file limit', async () => {
    listSourcesMock.mockReturnValue([bookSource]);
    const paths = Array.from({ length: 11 }, (_, index) => `notes/file-${index}.md`);
    const fixtures = new Map<string, FixtureNode[]>([
      ['', paths.map((filePath) => node(filePath, false))],
    ]);
    const metadataByPath = new Map<string, FixtureMetadata>(
      paths.map((filePath) => [filePath, metadata(filePath, 'file')]),
    );
    const bookAdapter = createAdapter(fixtures, metadataByPath, new Set());
    createFileSourceAdapterMock.mockReturnValue(bookAdapter.adapter);

    const { FileIndexRunner } = await import('./index-runner');
    const runner = new FileIndexRunner({ maxConcurrentSources: 1, maxFilesPerSource: 10 });

    await runner.runOnce();

    expect(reconcileSourcePathsMock).not.toHaveBeenCalled();
  });

  it('serializes overlapping scans for the same source across runner instances', async () => {
    listSourcesMock.mockReturnValue([bookSource]);
    let activeLists = 0;
    let maxActiveLists = 0;
    const adapter = createAdapter(new Map([['', []]]), new Map(), new Set());
    adapter.list.mockImplementation(async () => {
      activeLists += 1;
      maxActiveLists = Math.max(maxActiveLists, activeLists);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeLists -= 1;
      return [];
    });
    createFileSourceAdapterMock.mockReturnValue(adapter.adapter);

    const { FileIndexRunner } = await import('./index-runner');
    const firstRunner = new FileIndexRunner({ maxConcurrentSources: 1 });
    const secondRunner = new FileIndexRunner({ maxConcurrentSources: 1 });

    await Promise.all([
      firstRunner.runOnceForSource('book'),
      secondRunner.runOnceForSource('book'),
    ]);

    expect(maxActiveLists).toBe(1);
    expect(reconcileSourcePathsMock).toHaveBeenCalledTimes(2);
  });

  it('pre-classifies exact incident fixtures before read/index and preserves unexpected read errors', async () => {
    const bookIncidentPaths = [
      'skills/webapp-testing',
      'skills/workspace-dispatch',
      'skills/creative/imagegen-taste',
      'skills/devops/project-caddy-route',
      'skills/research/ec-deep-research-router',
      'skills/software-development/super-spec',
      'state-snapshots/20260611-181830-pre-update/state.db',
    ];
    const spockIncidentPaths = ['memory/_shared'];
    const forbiddenReadPaths = new Set([...bookIncidentPaths, ...spockIncidentPaths]);

    const bookFixtures = new Map<string, FixtureNode[]>([
      [
        '',
        [
          node('skills/webapp-testing', false),
          node('skills/workspace-dispatch', false),
          node('skills/creative/imagegen-taste', false),
          node('skills/devops/project-caddy-route', false),
          node('skills/research/ec-deep-research-router', false),
          node('skills/software-development/super-spec', false),
          node('state-snapshots/20260611-181830-pre-update/state.db', false, 3722362880),
          node('notes/ok.md', false),
          node('notes/unreadable.md', false),
        ],
      ],
    ]);
    const bookMetadata = new Map<string, FixtureMetadata>([
      ...bookIncidentPaths
        .filter((path) => !path.startsWith('state-snapshots/'))
        .map((path): [string, FixtureMetadata] => [path, metadata(path, 'directory')]),
      ['notes/ok.md', metadata('notes/ok.md', 'file')],
      ['notes/unreadable.md', metadata('notes/unreadable.md', 'file')],
    ]);
    const spockFixtures = new Map<string, FixtureNode[]>([
      ['', [node('memory/_shared', false), node('memory/keep.md', false)]],
    ]);
    const spockMetadata = new Map<string, FixtureMetadata>([
      ['memory/_shared', metadata('memory/_shared', 'directory')],
      ['memory/keep.md', metadata('memory/keep.md', 'file')],
    ]);
    const bookAdapter = createAdapter(bookFixtures, bookMetadata, forbiddenReadPaths);
    const spockAdapter = createAdapter(spockFixtures, spockMetadata, forbiddenReadPaths);

    createFileSourceAdapterMock.mockImplementation((source: FileSourceRecord) => {
      if (source.id === 'book') {
        return bookAdapter.adapter;
      }

      return spockAdapter.adapter;
    });

    const { FileIndexRunner } = await import('./index-runner');
    const runner = new FileIndexRunner({ maxConcurrentSources: 1 });

    await runner.runOnce();
    await runner.runOnce();

    const skippedReadPaths = [...bookIncidentPaths, ...spockIncidentPaths];
    const allReadPaths = [...bookAdapter.read.mock.calls, ...spockAdapter.read.mock.calls].map(([path]) => path);
    const indexedPaths = upsertRecordMock.mock.calls.map(([record]) => record.path);

    for (const skippedPath of skippedReadPaths) {
      expect(allReadPaths).not.toContain(skippedPath);
      expect(indexedPaths).not.toContain(skippedPath);
    }

    for (const directoryPath of [...bookIncidentPaths.slice(0, -1), ...spockIncidentPaths]) {
      if (directoryPath.startsWith('memory/')) {
        expect(spockAdapter.stat).toHaveBeenCalledWith(directoryPath);
      } else {
        expect(bookAdapter.stat).toHaveBeenCalledWith(directoryPath);
      }
    }

    expect(bookAdapter.stat).not.toHaveBeenCalledWith('state-snapshots/20260611-181830-pre-update/state.db');
    expect(bookAdapter.read).toHaveBeenCalledWith('notes/unreadable.md', { maxBytes: 16 * 1024 * 1024 });
    expect(emitFsAuditMock).toHaveBeenCalledWith('index.file.error', {
      sourceId: 'book',
      path: 'notes/unreadable.md',
      error: 'permission denied',
    });

    const skipErrors = emitFsAuditMock.mock.calls.filter(
      ([event, payload]) =>
        event === 'index.file.error' &&
        typeof payload === 'object' &&
        payload !== null &&
        skippedReadPaths.includes(String((payload as { path?: string }).path))
    );
    expect(skipErrors).toHaveLength(0);

    expect(allReadPaths.filter((path) => skippedReadPaths.includes(path))).toHaveLength(0);
  });

  it('skips oversized files before read/index and does not repeat deterministic skip logs for unchanged metadata', async () => {
    const oversizedPath = 'state-snapshots/20260611-181830-pre-update/state.db';
    const fixtures = new Map<string, FixtureNode[]>([['', [node(oversizedPath, false, 3722362880)]]]);
    const metadataByPath = new Map<string, FixtureMetadata>([
      [oversizedPath, metadata(oversizedPath, 'file', 3722362880)],
    ]);
    const bookAdapter = createAdapter(fixtures, metadataByPath, new Set([oversizedPath]));
    const spockAdapter = createAdapter(new Map([['', []]]), new Map(), new Set());

    createFileSourceAdapterMock.mockImplementation((source: FileSourceRecord) => {
      if (source.id === 'book') {
        return bookAdapter.adapter;
      }

      return spockAdapter.adapter;
    });

    const { FileIndexRunner } = await import('./index-runner');
    const runner = new FileIndexRunner({ maxConcurrentSources: 1, excludes: [] });

    await runner.runOnce();
    await runner.runOnce();

    expect(bookAdapter.stat).toHaveBeenCalledWith(oversizedPath);
    expect(bookAdapter.read).not.toHaveBeenCalledWith(oversizedPath);
    expect(deleteBySourcePathPrefixMock).toHaveBeenCalledWith('book', oversizedPath);
    expect(upsertRecordMock).not.toHaveBeenCalledWith(expect.objectContaining({ path: oversizedPath }));

    const oversizeSkips = emitFsAuditMock.mock.calls.filter(
      ([event, payload]) =>
        event === 'index.path.skipped' &&
        typeof payload === 'object' &&
        payload !== null &&
        (payload as { path?: string; reason?: string }).path === oversizedPath &&
        (payload as { path?: string; reason?: string }).reason === 'oversize'
    );
    expect(oversizeSkips).toHaveLength(1);

    const oversizeErrors = emitFsAuditMock.mock.calls.filter(
      ([event, payload]) =>
        event === 'index.file.error' &&
        typeof payload === 'object' &&
        payload !== null &&
        (payload as { path?: string }).path === oversizedPath
    );
    expect(oversizeErrors).toHaveLength(0);
  });

  it('skips files larger than Node can decode into a string before read/index', async () => {
    const oversizedPath = 'logs/oversized-output.log';
    const unsafeTextSize = bufferConstants.MAX_STRING_LENGTH + 1;
    const fixtures = new Map<string, FixtureNode[]>([['', [node(oversizedPath, false, unsafeTextSize)]]]);
    const metadataByPath = new Map<string, FixtureMetadata>([
      [oversizedPath, metadata(oversizedPath, 'file', unsafeTextSize)],
    ]);
    const bookAdapter = createAdapter(fixtures, metadataByPath, new Set([oversizedPath]));
    const spockAdapter = createAdapter(new Map([['', []]]), new Map(), new Set());

    createFileSourceAdapterMock.mockImplementation((source: FileSourceRecord) => (
      source.id === 'book' ? bookAdapter.adapter : spockAdapter.adapter
    ));

    const { FileIndexRunner } = await import('./index-runner');
    const runner = new FileIndexRunner({ maxConcurrentSources: 1, excludes: [] });

    await runner.runOnce();

    expect(bookAdapter.stat).toHaveBeenCalledWith(oversizedPath);
    expect(bookAdapter.read).not.toHaveBeenCalledWith(oversizedPath);
    expect(upsertRecordMock).not.toHaveBeenCalledWith(expect.objectContaining({ path: oversizedPath }));
    expect(emitFsAuditMock).toHaveBeenCalledWith('index.path.skipped', expect.objectContaining({
      sourceId: 'book',
      path: oversizedPath,
      reason: 'oversize',
    }));
  });

  it('passes the hard byte ceiling into reads when source metadata omits size', async () => {
    const unknownPath = 'remote/unknown-size.md';
    const fixtures = new Map<string, FixtureNode[]>([['', [node(unknownPath, false)]]]);
    const metadataByPath = new Map<string, FixtureMetadata>([
      [unknownPath, metadata(unknownPath, 'file')],
    ]);
    const bookAdapter = createAdapter(fixtures, metadataByPath, new Set());
    const spockAdapter = createAdapter(new Map([['', []]]), new Map(), new Set());
    createFileSourceAdapterMock.mockImplementation((record: FileSourceRecord) => (
      record.id === 'book' ? bookAdapter.adapter : spockAdapter.adapter
    ));

    const { FileIndexRunner } = await import('./index-runner');
    await new FileIndexRunner({ maxConcurrentSources: 1, excludes: [] }).runOnce();

    expect(bookAdapter.read).toHaveBeenCalledWith(unknownPath, { maxBytes: 16 * 1024 * 1024 });
  });

  it('enforces the 16 MiB hard ceiling at the exact boundary', async () => {
    const belowPath = 'notes/below-limit.md';
    const exactPath = 'notes/exact-limit.md';
    const abovePath = 'notes/above-limit.md';
    const limit = 16 * 1024 * 1024;
    const fixtures = new Map<string, FixtureNode[]>([['', [
      node(belowPath, false, limit - 1),
      node(exactPath, false, limit),
      node(abovePath, false, limit + 1),
    ]]]);
    const metadataByPath = new Map<string, FixtureMetadata>([
      [belowPath, metadata(belowPath, 'file', limit - 1)],
      [exactPath, metadata(exactPath, 'file', limit)],
      [abovePath, metadata(abovePath, 'file', limit + 1)],
    ]);
    const bookAdapter = createAdapter(fixtures, metadataByPath, new Set([abovePath]));
    const spockAdapter = createAdapter(new Map([['', []]]), new Map(), new Set());
    createFileSourceAdapterMock.mockImplementation((source: FileSourceRecord) => (
      source.id === 'book' ? bookAdapter.adapter : spockAdapter.adapter
    ));

    const { FileIndexRunner } = await import('./index-runner');
    await new FileIndexRunner({ maxConcurrentSources: 1, excludes: [] }).runOnce();

    expect(bookAdapter.read).toHaveBeenCalledWith(belowPath, { maxBytes: limit });
    expect(bookAdapter.read).toHaveBeenCalledWith(exactPath, { maxBytes: limit });
    expect(bookAdapter.read.mock.calls.map(([path]) => path)).not.toContain(abovePath);
  });

  it.each([
    ['constructor', { maxFileBytes: bufferConstants.MAX_STRING_LENGTH + 100 }],
    ['non-finite constructor', { maxFileBytes: Number.NaN }],
    ['environment', undefined],
  ])('does not let an unsafe %s override bypass the hard file ceiling', async (source, options) => {
    const oversizedPath = `logs/${source}-override.log`;
    const oversizedBytes = 16 * 1024 * 1024 + 1;
    const fixtures = new Map<string, FixtureNode[]>([['', [node(oversizedPath, false, oversizedBytes)]]]);
    const metadataByPath = new Map<string, FixtureMetadata>([
      [oversizedPath, metadata(oversizedPath, 'file', oversizedBytes)],
    ]);
    const bookAdapter = createAdapter(fixtures, metadataByPath, new Set([oversizedPath]));
    const spockAdapter = createAdapter(new Map([['', []]]), new Map(), new Set());
    createFileSourceAdapterMock.mockImplementation((record: FileSourceRecord) => (
      record.id === 'book' ? bookAdapter.adapter : spockAdapter.adapter
    ));
    if (source === 'environment') {
      vi.stubEnv('ENTITY_FS_AUDIT_MAX_FILE_BYTES', String(bufferConstants.MAX_STRING_LENGTH + 100));
    }

    try {
      const { FileIndexRunner } = await import('./index-runner');
      await new FileIndexRunner({ maxConcurrentSources: 1, excludes: [], ...options }).runOnce();
      expect(bookAdapter.read).not.toHaveBeenCalledWith(oversizedPath);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('removes stale index rows when a path is excluded before classification', async () => {
    const excludedPath = 'state-snapshots/20260611-181830-pre-update/state.db';
    const fixtures = new Map<string, FixtureNode[]>([['', [node(excludedPath, false, 3722362880)]]]);
    const bookAdapter = createAdapter(fixtures, new Map(), new Set([excludedPath]));
    const spockAdapter = createAdapter(new Map([['', []]]), new Map(), new Set());

    deleteBySourcePathPrefixMock.mockReturnValue(1);
    createFileSourceAdapterMock.mockImplementation((source: FileSourceRecord) => {
      if (source.id === 'book') {
        return bookAdapter.adapter;
      }

      return spockAdapter.adapter;
    });

    const { FileIndexRunner } = await import('./index-runner');
    const runner = new FileIndexRunner({ maxConcurrentSources: 1 });

    await runner.runOnce();

    expect(bookAdapter.stat).not.toHaveBeenCalledWith(excludedPath);
    expect(bookAdapter.read).not.toHaveBeenCalledWith(excludedPath);
    expect(deleteBySourcePathPrefixMock).toHaveBeenCalledWith('book', excludedPath);
  });
});
