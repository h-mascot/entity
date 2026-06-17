import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileSourceRecord } from '../../../db/src/file-sources';

const listSourcesMock = vi.fn();
const getSourceMock = vi.fn();
const updateSourceMock = vi.fn();
const startSyncRunMock = vi.fn();
const finishSyncRunMock = vi.fn();
const upsertRecordMock = vi.fn();
const deleteBySourcePathPrefixMock = vi.fn();
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
    expect(bookAdapter.read).toHaveBeenCalledWith('notes/unreadable.md');
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
