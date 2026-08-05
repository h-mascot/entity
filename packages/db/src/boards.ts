import { getEntityDatabase } from './entity-db';
import { DEFAULT_WORKSPACE_ORG_ID, DEFAULT_WORKSPACE_TEAM_ID } from './index';
import type Database from 'better-sqlite3';

/**
 * Customizable board domain — durable persistence + pure helpers.
 *
 * Boards replace the fixed Mission Control peer tabs (Kanban/Strategic/Insights/Swarm).
 * Required defaults: General (view `board`) and Analytics (view `analytics`).
 * Creation templates: `blank`, `strategic`, `engineering`.
 * Swarm is NOT a board — it is a task execution capability (see BRD-004).
 */

export const BOARD_VIEWS = ['board', 'analytics', 'strategic', 'engineering'] as const;
export type BoardView = (typeof BOARD_VIEWS)[number];

export const BOARD_TEMPLATES = ['blank', 'strategic', 'engineering'] as const;
export type BoardTemplate = (typeof BOARD_TEMPLATES)[number];

export type BoardFilterScope = 'all' | 'projects' | 'workDomain' | 'none';

export interface BoardFilterConfig {
  scope: BoardFilterScope;
  projectIds?: number[];
  workDomain?: string | null;
}

/**
 * Loose, pre-normalization shape accepted at persistence/API boundaries (raw JSON).
 * The repository normalizes this into a strict {@link BoardFilterConfig}.
 */
export type BoardFilterConfigInput = Partial<{
  scope: string;
  projectIds: unknown;
  workDomain: unknown;
}>;

const WORK_DOMAIN_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isBoardView(value: unknown): value is BoardView {
  return typeof value === 'string' && (BOARD_VIEWS as readonly string[]).includes(value);
}

export function isBoardTemplate(value: unknown): value is BoardTemplate {
  return typeof value === 'string' && (BOARD_TEMPLATES as readonly string[]).includes(value);
}

export function boardViewForTemplate(template: BoardTemplate): BoardView {
  switch (template) {
    case 'strategic':
      return 'strategic';
    case 'engineering':
      return 'engineering';
    case 'blank':
    default:
      return 'board';
  }
}

function coerceProjectIds(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const seen = new Set<number>();
  const result: number[] = [];
  for (const entry of raw) {
    const numeric = typeof entry === 'number' ? entry : Number(entry);
    if (Number.isInteger(numeric) && numeric > 0 && !seen.has(numeric)) {
      seen.add(numeric);
      result.push(numeric);
    }
  }
  return result;
}

function coerceWorkDomain(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const candidate = raw.trim().toLowerCase();
  return WORK_DOMAIN_PATTERN.test(candidate) && candidate.length <= 64 ? candidate : null;
}

/** Normalize arbitrary stored/API filter input into a valid config. */
export function normalizeBoardFilterConfig(raw: unknown): BoardFilterConfig {
  if (!raw || typeof raw !== 'object') {
    return { scope: 'all' };
  }
  const obj = raw as Record<string, unknown>;
  const scopeRaw = typeof obj.scope === 'string' ? obj.scope : 'all';
  const scope: BoardFilterScope = (
    ['all', 'projects', 'workDomain', 'none'] as const
  ).includes(scopeRaw as BoardFilterScope)
    ? (scopeRaw as BoardFilterScope)
    : 'all';

  switch (scope) {
    case 'projects': {
      const projectIds = coerceProjectIds(obj.projectIds);
      return projectIds && projectIds.length > 0
        ? { scope, projectIds }
        : { scope: 'all' };
    }
    case 'workDomain': {
      const workDomain = coerceWorkDomain(obj.workDomain);
      return workDomain ? { scope, workDomain } : { scope, workDomain: null };
    }
    case 'none':
      return { scope: 'none' };
    case 'all':
    default:
      return { scope: 'all' };
  }
}

export function defaultFilterForTemplate(template: BoardTemplate): BoardFilterConfig {
  switch (template) {
    case 'engineering':
      return { scope: 'workDomain', workDomain: 'engineering' };
    case 'blank':
    case 'strategic':
    default:
      return { scope: 'all' };
  }
}

/**
 * Strategic filter domain contract (D6). The Strategic view renders roadmaps and
 * ignores the persisted task-inclusion filter, so any non-`all` filter on a
 * Strategic board is a dishonest durable record (it would resurface if the view
 * later changed). This forces Strategic boards to a no-op `{ scope: 'all' }`
 * filter at the repository boundary — the single source of truth — so direct
 * API/repository callers cannot persist a contradictory filter. Non-strategic
 * views pass the filter through unchanged.
 */
export function enforceStrategicFilterContract(
  view: BoardView,
  filter: BoardFilterConfig,
): BoardFilterConfig {
  return view === 'strategic' ? { scope: 'all' } : filter;
}

/**
 * Map a legacy stored `entity.tasks.tab` value to a required default board key.
 * Anything that is not the insights/analytics view falls back to General so a
 * reload never lands on a blank screen (BRD-003 migration boundary).
 */
export function mapLegacyTabToDefaultBoardKey(
  tab: string | null | undefined,
): 'general' | 'analytics' {
  const normalized = typeof tab === 'string' ? tab.trim().toLowerCase() : '';
  if (normalized === 'insights' || normalized === 'analytics') {
    return 'analytics';
  }
  return 'general';
}

// ---------------------------------------------------------------------------
// Persistence (repository) — implemented in slice 1b.
// ---------------------------------------------------------------------------

export interface BoardRecord {
  id: number;
  org_id: string;
  team_id: string;
  key: string | null;
  name: string;
  view: BoardView;
  is_default: boolean;
  sort_order: number;
  filter_config: BoardFilterConfig;
  created_at: string;
  updated_at: string;
}

export interface CreateBoardInput {
  name: string;
  view?: BoardView;
  template?: BoardTemplate;
  key?: string | null;
  is_default?: boolean;
  sort_order?: number;
  filter_config?: BoardFilterConfigInput;
}

export interface UpdateBoardInput {
  name?: string;
  view?: BoardView;
  filter_config?: BoardFilterConfigInput;
}

export interface BoardRepository {
  listBoards: () => BoardRecord[];
  getBoard: (id: number) => BoardRecord | undefined;
  createBoard: (input: CreateBoardInput) => BoardRecord;
  updateBoard: (id: number, updates: UpdateBoardInput) => BoardRecord | undefined;
  reorderBoards: (orderedIds: readonly number[]) => BoardRecord[];
  deleteBoard: (id: number) => boolean;
  seedDefaults: () => void;
}

const DEFAULT_BOARD_DEFINITIONS: ReadonlyArray<{
  key: string;
  name: string;
  view: BoardView;
  sort_order: number;
}> = [
  { key: 'general', name: 'General', view: 'board', sort_order: 0 },
  { key: 'analytics', name: 'Analytics', view: 'analytics', sort_order: 1 },
];

function ensureBoardsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS boards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ORG_ID}',
      team_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_TEAM_ID}',
      key TEXT,
      name TEXT NOT NULL,
      view TEXT NOT NULL DEFAULT 'board',
      is_default INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      filter_config TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_boards_default_key
      ON boards(org_id, team_id, key)
      WHERE key IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_boards_order
      ON boards(org_id, team_id, sort_order, id);
  `);
}

function openEntityDatabase(): Database.Database {
  return getEntityDatabase(ensureBoardsSchema);
}

function serializeFilterConfig(config: BoardFilterConfig): string {
  return JSON.stringify(config);
}

interface BoardRow {
  id: number;
  org_id: string;
  team_id: string;
  key: string | null;
  name: string;
  view: string;
  is_default: number;
  sort_order: number;
  filter_config: string;
  created_at: string;
  updated_at: string;
}

function mapBoardRow(row: BoardRow): BoardRecord {
  return {
    id: row.id,
    org_id: row.org_id,
    team_id: row.team_id,
    key: row.key,
    name: row.name,
    view: (isBoardView(row.view) ? row.view : 'board') as BoardView,
    is_default: row.is_default === 1,
    sort_order: row.sort_order,
    filter_config: normalizeBoardFilterConfig(safeParseJson(row.filter_config)),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function normalizeBoardName(name: string | undefined | null): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) {
    throw new Error('board name is required');
  }
  if (trimmed.length > 80) {
    throw new Error('board name must be 80 characters or fewer');
  }
  return trimmed;
}

function resolveView(input: CreateBoardInput): BoardView {
  if (input.template && isBoardTemplate(input.template)) {
    return boardViewForTemplate(input.template);
  }
  if (input.view && isBoardView(input.view)) {
    return input.view;
  }
  return 'board';
}

export interface BoardScope {
  orgId: string;
  teamId: string;
}

export const DEFAULT_BOARD_SCOPE: BoardScope = {
  orgId: DEFAULT_WORKSPACE_ORG_ID,
  teamId: DEFAULT_WORKSPACE_TEAM_ID,
};

export function createBoardRepository(scope: BoardScope = DEFAULT_BOARD_SCOPE): BoardRepository {
  const db = openEntityDatabase();

  const orgId = scope.orgId;
  const teamId = scope.teamId;

  const listStmt = db.prepare(
    `SELECT * FROM boards WHERE org_id = ? AND team_id = ? ORDER BY sort_order ASC, id ASC`,
  );
  const getStmt = db.prepare(
    `SELECT * FROM boards WHERE id = ? AND org_id = ? AND team_id = ?`,
  );
  const insertStmt = db.prepare(`
    INSERT INTO boards (org_id, team_id, key, name, view, is_default, sort_order, filter_config, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  const maxOrderStmt = db.prepare(
    `SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM boards WHERE org_id = ? AND team_id = ?`,
  );
  const updateStmt = db.prepare(`
    UPDATE boards
    SET name = COALESCE(?, name),
        view = COALESCE(?, view),
        filter_config = COALESCE(?, filter_config),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND org_id = ? AND team_id = ?
  `);
  const setOrderStmt = db.prepare(
    `UPDATE boards SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND org_id = ? AND team_id = ?`,
  );
  const getDefaultStmt = db.prepare(
    `SELECT * FROM boards WHERE id = ? AND org_id = ? AND team_id = ?`,
  );
  const deleteStmt = db.prepare(
    `DELETE FROM boards WHERE id = ? AND org_id = ? AND team_id = ? AND is_default = 0`,
  );
  const findByKeyStmt = db.prepare(
    `SELECT * FROM boards WHERE org_id = ? AND team_id = ? AND key = ?`,
  );

  const reorderTx = db.transaction((orderedIds: readonly number[]) => {
    const known = new Map(
      listStmt.all(orgId, teamId).map((row) => [(row as BoardRow).id, row as BoardRow]),
    );
    let order = 0;
    for (const id of orderedIds) {
      if (!known.has(id)) {
        continue;
      }
      setOrderStmt.run(order, id, orgId, teamId);
      order += 1;
    }
    // Any boards not mentioned keep their relative position after the explicit prefix.
    for (const row of known.values()) {
      if (!orderedIds.includes(row.id)) {
        setOrderStmt.run(order, row.id, orgId, teamId);
        order += 1;
      }
    }
  });

  // Idempotent default seeding shared by the explicit seedDefaults() method and
  // by createBoard() (so defaults are guaranteed regardless of call order).
  const seedDefaultsImpl = (): void => {
    for (const def of DEFAULT_BOARD_DEFINITIONS) {
      const existing = findByKeyStmt.get(orgId, teamId, def.key) as BoardRow | undefined;
      if (existing) {
        continue;
      }
      insertStmt.run(
        orgId,
        teamId,
        def.key,
        def.name,
        def.view,
        1,
        def.sort_order,
        serializeFilterConfig({ scope: 'all' }),
      );
    }
  };

  return {
    listBoards() {
      return listStmt.all(orgId, teamId).map((row) => mapBoardRow(row as BoardRow));
    },
    getBoard(id: number) {
      const row = getStmt.get(id, orgId, teamId) as BoardRow | undefined;
      return row ? mapBoardRow(row) : undefined;
    },
    createBoard(input: CreateBoardInput) {
      // BRD-001: required defaults must always exist before any user board so a
      // first create through the API cannot land a user board ahead of General/
      // Analytics. Idempotent — a no-op when defaults already exist.
      seedDefaultsImpl();
      const name = normalizeBoardName(input.name);
      const view = resolveView(input);
      const resolvedFilter =
        input.filter_config !== undefined
          ? normalizeBoardFilterConfig(input.filter_config)
          : input.template && isBoardTemplate(input.template)
            ? defaultFilterForTemplate(input.template)
            : { scope: 'all' as const };
      // D6: enforce the Strategic filter domain contract at the repository
      // boundary (single source of truth), regardless of the caller.
      const filterConfig = enforceStrategicFilterContract(view, resolvedFilter);
      const isDefault = input.is_default === true ? 1 : 0;
      const key =
        typeof input.key === 'string' && input.key.trim()
          ? input.key.trim().toLowerCase()
          : null;
      const sortOrder =
        typeof input.sort_order === 'number' && Number.isInteger(input.sort_order)
          ? input.sort_order
          : ((maxOrderStmt.get(orgId, teamId) as { max_order: number }).max_order + 1);

      const result = insertStmt.run(
        orgId,
        teamId,
        key,
        name,
        view,
        isDefault,
        sortOrder,
        serializeFilterConfig(filterConfig),
      );
      const row = getStmt.get(result.lastInsertRowid as number, orgId, teamId) as BoardRow;
      return mapBoardRow(row);
    },
    updateBoard(id: number, updates: UpdateBoardInput) {
      const existing = getStmt.get(id, orgId, teamId) as BoardRow | undefined;
      if (!existing) {
        return undefined;
      }
      const name =
        updates.name !== undefined ? normalizeBoardName(updates.name) : null;
      const view =
        updates.view !== undefined && isBoardView(updates.view) ? updates.view : null;
      // D6: enforce the Strategic filter domain contract using the EFFECTIVE
      // view (new view if changing, otherwise the existing view). A Strategic
      // board always persists `{ scope: 'all' }`, overriding any requested or
      // pre-existing filter; non-strategic boards keep the requested filter or
      // leave the stored value untouched.
      const existingView = isBoardView(existing.view) ? existing.view : 'board';
      const effectiveView = view ?? existingView;
      const filterConfig =
        effectiveView === 'strategic'
          ? serializeFilterConfig({ scope: 'all' })
          : updates.filter_config !== undefined
            ? serializeFilterConfig(normalizeBoardFilterConfig(updates.filter_config))
            : null;
      updateStmt.run(name, view, filterConfig, id, orgId, teamId);
      const row = getStmt.get(id, orgId, teamId) as BoardRow;
      return mapBoardRow(row);
    },
    reorderBoards(orderedIds: readonly number[]) {
      reorderTx(orderedIds);
      return listStmt.all(orgId, teamId).map((row) => mapBoardRow(row as BoardRow));
    },
    deleteBoard(id: number) {
      const existing = getDefaultStmt.get(id, orgId, teamId) as BoardRow | undefined;
      if (!existing) {
        return false;
      }
      if (existing.is_default === 1) {
        throw new Error('required default boards cannot be deleted');
      }
      const result = deleteStmt.run(id, orgId, teamId);
      return result.changes > 0;
    },
    seedDefaults() {
      seedDefaultsImpl();
    },
  };
}
