import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BOARD_VIEWS,
  BOARD_TEMPLATES,
  isBoardView,
  isBoardTemplate,
  boardViewForTemplate,
  defaultFilterForTemplate,
  normalizeBoardFilterConfig,
  enforceStrategicFilterContract,
  mapLegacyTabToDefaultBoardKey,
} from './boards';

let activeDbPath: string | null = null;
let cleanupDbPaths: string[] = [];

function removeSqliteFiles(dbPath: string): void {
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    fs.rmSync(file, { force: true });
  }
}

function tempDbPath(): string {
  return path.join(os.tmpdir(), `entity-boards-test-${process.pid}-${randomUUID()}.sqlite`);
}

async function loadBoardRepository(scope?: { orgId: string; teamId: string }) {
  activeDbPath = tempDbPath();
  cleanupDbPaths.push(activeDbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', activeDbPath);
  vi.stubEnv('MISSION_CONTROL_DB_PATH', path.join(os.tmpdir(), `missing-mc-${randomUUID()}.db`));
  const mod = await import('./boards');
  return mod.createBoardRepository(scope);
}

async function loadPreMarkerBoardRepository(options: {
  filterConfig: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}) {
  activeDbPath = tempDbPath();
  cleanupDbPaths.push(activeDbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', activeDbPath);
  vi.stubEnv('MISSION_CONTROL_DB_PATH', path.join(os.tmpdir(), `missing-mc-${randomUUID()}.db`));

  const mod = await import('./boards');
  const { getEntityDatabase } = await import('./entity-db');
  const db = getEntityDatabase();
  db.exec(`
    CREATE TABLE boards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id TEXT NOT NULL,
      team_id TEXT NOT NULL,
      key TEXT,
      name TEXT NOT NULL,
      view TEXT NOT NULL DEFAULT 'board',
      is_default INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      filter_config TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_boards_default_key ON boards(org_id, team_id, key)
      WHERE key IS NOT NULL;
    CREATE INDEX idx_boards_order ON boards(org_id, team_id, sort_order, id);
  `);
  db.prepare(
    `INSERT INTO boards
       (org_id, team_id, key, name, view, is_default, sort_order, filter_config, created_at, updated_at)
     VALUES (?, ?, 'general', 'General', 'board', 1, 0, ?, ?, ?)`,
  ).run(
    mod.DEFAULT_BOARD_SCOPE.orgId,
    mod.DEFAULT_BOARD_SCOPE.teamId,
    JSON.stringify(options.filterConfig),
    options.createdAt,
    options.updatedAt,
  );

  return { boards: mod.createBoardRepository(), db };
}

afterEach(async () => {
  const dbPathToClose = activeDbPath;
  if (dbPathToClose) {
    const closePath = tempDbPath();
    cleanupDbPaths.push(closePath);
    vi.stubEnv('ENTITY_TASK_DB_PATH', closePath);
    try {
      const { getEntityDatabase } = await import('./entity-db');
      getEntityDatabase().close();
    } catch {
      // best-effort close
    }
  }
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const dbPath of cleanupDbPaths) {
    removeSqliteFiles(dbPath);
  }
  activeDbPath = null;
  cleanupDbPaths = [];
});

describe('board domain helpers', () => {
  describe('view and template kinds', () => {
    it('exposes the four board view kinds', () => {
      expect(BOARD_VIEWS).toEqual(['board', 'analytics', 'strategic', 'engineering']);
    });

    it('exposes the three creation templates', () => {
      expect(BOARD_TEMPLATES).toEqual(['blank', 'strategic', 'engineering']);
    });

    it.each([
      ['board'],
      ['analytics'],
      ['strategic'],
      ['engineering'],
    ])('recognizes %s as a board view', (value) => {
      expect(isBoardView(value)).toBe(true);
    });

    it.each([
      ['kanban'],
      ['swarm'],
      [''],
      [null],
      [undefined],
    ])('rejects %p as a board view', (value) => {
      expect(isBoardView(value)).toBe(false);
    });

    it.each([
      ['blank'],
      ['strategic'],
      ['engineering'],
    ])('recognizes %s as a board template', (value) => {
      expect(isBoardTemplate(value)).toBe(true);
    });

    it.each([
      ['board'],
      ['analytics'],
      ['general'],
      [null],
    ])('rejects %p as a board template', (value) => {
      expect(isBoardTemplate(value)).toBe(false);
    });

    it('maps each template to its rendering view', () => {
      expect(boardViewForTemplate('blank')).toBe('board');
      expect(boardViewForTemplate('strategic')).toBe('strategic');
      expect(boardViewForTemplate('engineering')).toBe('engineering');
    });
  });

  describe('filter configuration normalization', () => {
    it('returns an all-tasks default for missing or non-object input', () => {
      expect(normalizeBoardFilterConfig(undefined)).toEqual({ scope: 'all' });
      expect(normalizeBoardFilterConfig(null)).toEqual({ scope: 'all' });
      expect(normalizeBoardFilterConfig('not-an-object')).toEqual({ scope: 'all' });
      expect(normalizeBoardFilterConfig({})).toEqual({ scope: 'all' });
    });

    it('keeps an explicit none scope for empty boards', () => {
      expect(normalizeBoardFilterConfig({ scope: 'none' })).toEqual({ scope: 'none' });
    });

    it('falls an unknown scope back to all', () => {
      expect(normalizeBoardFilterConfig({ scope: 'bogus' })).toEqual({ scope: 'all' });
    });

    it('coerces and filters project ids down to positive integers', () => {
      expect(
        normalizeBoardFilterConfig({
          scope: 'projects',
          projectIds: [3, '2', 0, -1, 2.5, 'nope', null, 5],
        }),
      ).toEqual({ scope: 'projects', projectIds: [3, 2, 5] });
    });

    it('keeps a kebab-case work domain and drops malformed ones', () => {
      expect(
        normalizeBoardFilterConfig({ scope: 'workDomain', workDomain: 'Engineering' }),
      ).toEqual({ scope: 'workDomain', workDomain: 'engineering' });
      expect(
        normalizeBoardFilterConfig({ scope: 'workDomain', workDomain: 'data science!' }),
      ).toEqual({ scope: 'workDomain', workDomain: null });
    });

    it('normalizes excluded work domains and preserves them across scopes', () => {
      expect(
        normalizeBoardFilterConfig({
          scope: 'all',
          excludeWorkDomains: ['Engineering', 'engineering', 'bad domain', 4, 'platform'],
        }),
      ).toEqual({ scope: 'all', excludeWorkDomains: ['engineering', 'platform'] });
      expect(
        normalizeBoardFilterConfig({
          scope: 'projects',
          projectIds: [3],
          excludeWorkDomains: ['engineering'],
        }),
      ).toEqual({ scope: 'projects', projectIds: [3], excludeWorkDomains: ['engineering'] });
    });
  });

  describe('template default filters', () => {
    it('seeds blank and strategic boards with an all-tasks scope', () => {
      expect(defaultFilterForTemplate('blank')).toEqual({ scope: 'all' });
      expect(defaultFilterForTemplate('strategic')).toEqual({ scope: 'all' });
    });

    it('seeds engineering boards with an engineering work-domain default', () => {
      expect(defaultFilterForTemplate('engineering')).toEqual({
        scope: 'workDomain',
        workDomain: 'engineering',
      });
    });
  });

  describe('strategic filter domain contract (D6)', () => {
    it('forces an all-tasks scope for the strategic view', () => {
      expect(enforceStrategicFilterContract('strategic', { scope: 'projects', projectIds: [1, 2] })).toEqual({ scope: 'all' });
      expect(enforceStrategicFilterContract('strategic', { scope: 'workDomain', workDomain: 'engineering' })).toEqual({ scope: 'all' });
      expect(enforceStrategicFilterContract('strategic', { scope: 'none' })).toEqual({ scope: 'all' });
    });

    it.each([
      ['board'],
      ['analytics'],
      ['engineering'],
    ] as const)('passes the filter through unchanged for the %s view', (view) => {
      const filter = { scope: 'projects' as const, projectIds: [7] };
      expect(enforceStrategicFilterContract(view, filter)).toEqual(filter);
    });
  });

  describe('legacy tab migration', () => {
    it.each([
      ['kanban', 'general'],
      ['ops', 'general'],
      ['strategic', 'general'],
      ['engineering', 'general'],
      ['swarm', 'general'],
      ['plugin:geordi', 'general'],
      ['unknown', 'general'],
      ['', 'general'],
    ])('maps legacy tab %p to default board %s', (tab, expected) => {
      expect(mapLegacyTabToDefaultBoardKey(tab)).toBe(expected);
    });

    it('maps the insights tab to the analytics default', () => {
      expect(mapLegacyTabToDefaultBoardKey('insights')).toBe('analytics');
    });

    it.each([null, undefined])('falls back to general for %p', (value) => {
      expect(mapLegacyTabToDefaultBoardKey(value)).toBe('general');
    });
  });
});

describe('board repository persistence', () => {
  it('seeds the General and Analytics defaults idempotently and ordered', async () => {
    const boards = await loadBoardRepository();
    boards.seedDefaults();
    boards.seedDefaults();

    const list = boards.listBoards();
    expect(list).toHaveLength(2);
    expect(list.map((b) => b.key)).toEqual(['general', 'analytics']);
    expect(list.map((b) => b.name)).toEqual(['General', 'Analytics']);
    expect(list.map((b) => b.view)).toEqual(['board', 'analytics']);
    expect(list[0].filter_config).toEqual({
      scope: 'all',
      excludeWorkDomains: ['engineering'],
    });
    expect(list.every((b) => b.is_default)).toBe(true);
    expect(list.map((b) => b.sort_order)).toEqual([0, 1]);
  });

  it('preserves a pre-marker General scope-all row, including same-timestamp state', async () => {
    const { boards, db } = await loadPreMarkerBoardRepository({
      filterConfig: { scope: 'all' },
      createdAt: '2026-08-01 12:00:00',
      updatedAt: '2026-08-01 12:00:00',
    });

    boards.seedDefaults();
    const columns = db.pragma('table_info(boards)') as Array<{ name: string }>;
    expect(columns.some((column) => column.name === 'filter_config_explicit')).toBe(false);
    expect(boards.getBoard(1)?.filter_config).toEqual({ scope: 'all' });
    expect(boards.listBoards().map((board) => board.key)).toEqual(['general', 'analytics']);
  });

  it('preserves a pre-marker explicit scope-all save with a later timestamp', async () => {
    const { boards } = await loadPreMarkerBoardRepository({
      filterConfig: { scope: 'all' },
      createdAt: '2026-08-01 12:00:00',
      updatedAt: '2026-08-01 12:05:00',
    });

    boards.seedDefaults();
    expect(boards.getBoard(1)?.filter_config).toEqual({ scope: 'all' });
  });

  it('preserves a pre-marker customized General filter without inferring provenance', async () => {
    const { boards } = await loadPreMarkerBoardRepository({
      filterConfig: { scope: 'projects', projectIds: [7] },
      createdAt: '2026-08-01 12:00:00',
      updatedAt: '2026-08-01 12:05:00',
    });

    boards.seedDefaults();
    expect(boards.getBoard(1)?.filter_config).toEqual({ scope: 'projects', projectIds: [7] });
  });

  it('preserves an explicit General project filter across repeated default seeding', async () => {
    const boards = await loadBoardRepository();
    boards.seedDefaults();
    const general = boards.listBoards().find((board) => board.key === 'general')!;

    const customized = boards.updateBoard(general.id, {
      filter_config: { scope: 'projects', projectIds: [7, 7, 0] },
    });
    expect(customized?.filter_config).toEqual({ scope: 'projects', projectIds: [7] });
    boards.seedDefaults();
    boards.seedDefaults();
    expect(boards.getBoard(general.id)?.filter_config).toEqual({
      scope: 'projects',
      projectIds: [7],
    });
  });

  it('creates user boards with validated names, derived view, and next sort order', async () => {
    const boards = await loadBoardRepository();
    boards.seedDefaults();

    const created = boards.createBoard({ name: '  Mobile Crash  ', template: 'engineering' });
    expect(created).toMatchObject({
      name: 'Mobile Crash',
      view: 'engineering',
      is_default: false,
      sort_order: 2,
      filter_config: { scope: 'workDomain', workDomain: 'engineering' },
    });

    expect(boards.createBoard({ name: 'Blank one', template: 'blank' })).toMatchObject({
      view: 'board',
      filter_config: { scope: 'all' },
    });

    expect(() => boards.createBoard({ name: '   ' })).toThrow('board name is required');
    expect(() => boards.createBoard({ name: 'x'.repeat(81) })).toThrow('80 characters');
  });

  it('round-trips an explicit project filter config through normalization', async () => {
    const boards = await loadBoardRepository();
    boards.seedDefaults();

    const created = boards.createBoard({
      name: 'Curacel work',
      view: 'board',
      filter_config: { scope: 'projects', projectIds: [9, '3', 0, 9] },
    });
    expect(created.filter_config).toEqual({ scope: 'projects', projectIds: [9, 3] });

    const updated = boards.updateBoard(created.id, {
      filter_config: { scope: 'none' },
    });
    expect(updated?.filter_config).toEqual({ scope: 'none' });
  });

  it('updates name and view and returns undefined for missing boards', async () => {
    const boards = await loadBoardRepository();
    boards.seedDefaults();

    const created = boards.createBoard({ name: 'Sprint', template: 'strategic' });
    const updated = boards.updateBoard(created.id, { name: 'Sprint Plan', view: 'board' });
    expect(updated).toMatchObject({ id: created.id, name: 'Sprint Plan', view: 'board' });

    expect(boards.updateBoard(999_999, { name: 'x' })).toBeUndefined();
    expect(() => boards.updateBoard(created.id, { name: '   ' })).toThrow('board name is required');
  });

  it('reorders known boards and appends unmentioned boards after the explicit prefix', async () => {
    const boards = await loadBoardRepository();
    boards.seedDefaults();
    const a = boards.createBoard({ name: 'A' });
    const b = boards.createBoard({ name: 'B' });

    const reordered = boards.reorderBoards([b.id, a.id]);
    expect(reordered.map((board) => board.name)).toEqual(['B', 'A', 'General', 'Analytics']);

    // Unknown ids are ignored, not stored, and do not corrupt ordering.
    const reorderedAgain = boards.reorderBoards([a.id, 999_999, b.id]);
    expect(reorderedAgain.map((board) => board.name)).toEqual(['A', 'B', 'General', 'Analytics']);
  });

  it('deletes user boards but refuses to delete required defaults and missing ids', async () => {
    const boards = await loadBoardRepository();
    boards.seedDefaults();
    const user = boards.createBoard({ name: 'Temp board' });

    expect(boards.deleteBoard(user.id)).toBe(true);
    expect(boards.getBoard(user.id)).toBeUndefined();
    expect(boards.deleteBoard(user.id)).toBe(false);
    expect(boards.deleteBoard(999_999)).toBe(false);

    const general = boards.listBoards().find((b) => b.key === 'general')!;
    expect(() => boards.deleteBoard(general.id)).toThrow('required default');
    expect(boards.listBoards()).toHaveLength(2);
  });

  it('guarantees General/Analytics defaults before the first user create (no prior seed/list)', async () => {
    const boards = await loadBoardRepository();
    // First mutation is a user create with no prior GET/seedDefaults — defaults
    // must still exist and sort ahead of the user board.
    const user = boards.createBoard({ name: 'First user board' });
    const list = boards.listBoards();
    expect(list.map((b) => b.key)).toEqual(['general', 'analytics', null]);
    expect(user.sort_order).toBe(2);
    expect(list.filter((b) => b.is_default).map((b) => b.key)).toEqual(['general', 'analytics']);
  });

  it('normalizes a non-all Strategic filter to all at create and update (D6)', async () => {
    const boards = await loadBoardRepository();
    boards.seedDefaults();

    // Create from the strategic template with a non-all filter: the resulting
    // view is strategic, so the persisted filter MUST collapse to all.
    const created = boards.createBoard({
      name: 'Roadmap',
      template: 'strategic',
      filter_config: { scope: 'projects', projectIds: [1, 2] },
    });
    expect(created.view).toBe('strategic');
    expect(created.filter_config).toEqual({ scope: 'all' });

    // Explicit view=strategic with a work-domain filter also collapses.
    const explicit = boards.createBoard({
      name: 'Roadmap 2',
      view: 'strategic',
      filter_config: { scope: 'workDomain', workDomain: 'engineering' },
    });
    expect(explicit.filter_config).toEqual({ scope: 'all' });

    // PATCH a board's view to strategic with a project filter: effective view is
    // strategic, so the filter collapses to all regardless of the request.
    const board = boards.createBoard({ name: 'Becomes strategic', view: 'board', filter_config: { scope: 'projects', projectIds: [3] } });
    expect(board.filter_config).toEqual({ scope: 'projects', projectIds: [3] });
    const toStrategic = boards.updateBoard(board.id, { view: 'strategic', filter_config: { scope: 'projects', projectIds: [9] } });
    expect(toStrategic?.view).toBe('strategic');
    expect(toStrategic?.filter_config).toEqual({ scope: 'all' });

    // PATCH only the filter on an already-strategic board: stays all.
    const strategicOnly = boards.updateBoard(created.id, { filter_config: { scope: 'workDomain', workDomain: 'data' } });
    expect(strategicOnly?.filter_config).toEqual({ scope: 'all' });

    // Non-strategic boards keep their filter (regression).
    const plain = boards.createBoard({ name: 'Plain', view: 'board', filter_config: { scope: 'projects', projectIds: [5] } });
    const patched = boards.updateBoard(plain.id, { filter_config: { scope: 'none' } });
    expect(patched?.filter_config).toEqual({ scope: 'none' });
  });

  it('isolates boards by request-derived org/team scope (cross-tenant fail closed)', async () => {
    // Both scoped repositories must share ONE database file; isolation is by
    // org/team scope, not by file. Load a single module instance so the shared
    // entity DB connection is reused.
    const sharedDbPath = tempDbPath();
    cleanupDbPaths.push(sharedDbPath);
    vi.stubEnv('ENTITY_TASK_DB_PATH', sharedDbPath);
    vi.resetModules();
    const mod = await import('./boards');
    const orgA = mod.createBoardRepository({ orgId: 'org-a', teamId: 'team-1' });
    const orgB = mod.createBoardRepository({ orgId: 'org-b', teamId: 'team-1' });
    orgA.seedDefaults();
    orgB.seedDefaults();

    const aBoard = orgA.createBoard({ name: 'Only in A' });

    // Tenant B cannot see, get, update, or delete tenant A's board.
    expect(orgB.listBoards().some((b) => b.id === aBoard.id)).toBe(false);
    expect(orgB.getBoard(aBoard.id)).toBeUndefined();
    expect(orgB.updateBoard(aBoard.id, { name: 'hacked' })).toBeUndefined();
    expect(orgB.deleteBoard(aBoard.id)).toBe(false);

    // Tenant A still owns it unchanged.
    expect(orgA.getBoard(aBoard.id)?.name).toBe('Only in A');
    expect(orgA.listBoards().map((b) => b.name)).toContain('Only in A');
    expect(orgB.listBoards().map((b) => b.name)).not.toContain('Only in A');
  });
});
