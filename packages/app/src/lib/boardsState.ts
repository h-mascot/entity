/**
 * Customizable board UI state — pure reducers, selectors, and adapters.
 *
 * Self-contained (the app cannot import the native @entity/db package). The
 * types mirror the `/api/boards` contract defined in packages/db/src/boards.ts.
 *
 * Boards replace the fixed Mission Control peer tabs. General (view `board`) and
 * Analytics (view `analytics`) are required defaults. Swarm is NOT a board.
 */

export const BOARD_VIEWS = ['board', 'analytics', 'strategic', 'engineering'] as const;
export type BoardView = (typeof BOARD_VIEWS)[number];

export const BOARD_TEMPLATES = ['blank', 'strategic', 'engineering'] as const;
export type BoardTemplate = (typeof BOARD_TEMPLATES)[number];

export type BoardFilterScope = 'all' | 'projects' | 'workDomain' | 'none';

const WORK_DOMAIN_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Normalize raw filter config from the API into a strict shape (mirrors server). */
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
      const projectIds = Array.isArray(obj.projectIds)
        ? obj.projectIds
            .map((entry) => (typeof entry === 'number' ? entry : Number(entry)))
            .filter((value): value is number => Number.isInteger(value) && value > 0)
            .filter((value, index, arr) => arr.indexOf(value) === index)
        : [];
      return projectIds.length > 0 ? { scope, projectIds } : { scope: 'all' };
    }
    case 'workDomain': {
      const candidate =
        typeof obj.workDomain === 'string' ? obj.workDomain.trim().toLowerCase() : '';
      const workDomain =
        candidate && WORK_DOMAIN_PATTERN.test(candidate) && candidate.length <= 64
          ? candidate
          : null;
      return { scope, workDomain };
    }
    case 'none':
      return { scope: 'none' };
    case 'all':
    default:
      return { scope: 'all' };
  }
}

export interface BoardFilterConfig {
  scope: BoardFilterScope;
  projectIds?: number[];
  workDomain?: string | null;
}

export interface BoardSummary {
  id: number;
  key: string | null;
  name: string;
  view: BoardView;
  is_default: boolean;
  sort_order: number;
  filter_config: BoardFilterConfig;
}

export interface BoardsState {
  boards: BoardSummary[];
  activeBoardId: number | null;
}

/**
 * The existing render surfaces still key off the legacy MC tab vocabulary. This
 * adapter maps a customizable board view onto the render tab the surfaces expect,
 * so a new board model drives existing TaskBoard/analytics components unchanged.
 */
export type BoardRenderTab = 'kanban' | 'insights' | 'strategic' | 'engineering';

export function boardViewToRenderTab(view: BoardView): BoardRenderTab {
  switch (view) {
    case 'analytics':
      return 'insights';
    case 'strategic':
      return 'strategic';
    case 'engineering':
      return 'engineering';
    case 'board':
    default:
      return 'kanban';
  }
}

/**
 * Resolve a stored legacy `entity.tasks.tab` value to the required default board
 * key to restore on load. Anything that is not the analytics/insights view falls
 * back to General so a reload never lands on a blank screen (BRD-003 boundary).
 */
export function preferredBoardKeyFromLegacyTab(
  tab: string | null | undefined,
): 'general' | 'analytics' {
  const normalized = typeof tab === 'string' ? tab.trim().toLowerCase() : '';
  if (normalized === 'insights' || normalized === 'analytics') {
    return 'analytics';
  }
  return 'general';
}

function findDefaultGeneral(boards: readonly BoardSummary[]): BoardSummary | undefined {
  return boards.find((board) => board.key === 'general' && board.is_default);
}

function firstOrdered(boards: readonly BoardSummary[]): BoardSummary | undefined {
  return [...boards].sort(compareBoardOrder)[0];
}

function compareBoardOrder(a: BoardSummary, b: BoardSummary): number {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  return a.id - b.id;
}

function resolveActiveId(
  boards: readonly BoardSummary[],
  preferredKey?: string | null,
): number | null {
  if (boards.length === 0) return null;
  if (preferredKey) {
    const preferred = boards.find((board) => board.key === preferredKey);
    if (preferred) return preferred.id;
  }
  const general = findDefaultGeneral(boards);
  if (general) return general.id;
  return firstOrdered(boards)!.id;
}

/** Build the initial state from a freshly loaded board list. */
export function initBoardsState(
  boards: BoardSummary[],
  preferredKey?: string | null,
): BoardsState {
  return {
    boards: boards.map((board) => ({ ...board })),
    activeBoardId: resolveActiveId(boards, preferredKey),
  };
}

export function selectBoard(state: BoardsState, boardId: number): BoardsState {
  if (!state.boards.some((board) => board.id === boardId)) {
    return state;
  }
  return { ...state, activeBoardId: boardId };
}

export function applyBoardCreated(state: BoardsState, board: BoardSummary): BoardsState {
  const boards = [...state.boards, { ...board }];
  return { boards, activeBoardId: board.id };
}

export function applyBoardUpdated(state: BoardsState, board: BoardSummary): BoardsState {
  let found = false;
  const boards = state.boards.map((existing) => {
    if (existing.id === board.id) {
      found = true;
      return { ...board };
    }
    return existing;
  });
  if (!found) return state;
  return { ...state, boards };
}

export function applyBoardsReordered(state: BoardsState, boards: BoardSummary[]): BoardsState {
  return {
    boards: boards.map((board) => ({ ...board })),
    activeBoardId: state.activeBoardId,
  };
}

export function applyBoardDeleted(state: BoardsState, id: number): BoardsState {
  const remaining = state.boards.filter((board) => board.id !== id);
  if (remaining.length === state.boards.length) {
    return state;
  }
  let activeBoardId = state.activeBoardId;
  if (activeBoardId === id) {
    const general = findDefaultGeneral(remaining);
    activeBoardId = general ? general.id : (firstOrdered(remaining)?.id ?? null);
  }
  return { boards: remaining, activeBoardId };
}

export function getOrderedBoards(state: BoardsState): BoardSummary[] {
  return [...state.boards].sort(compareBoardOrder);
}

export function getActiveBoard(state: BoardsState): BoardSummary | null {
  if (state.activeBoardId === null) return null;
  return state.boards.find((board) => board.id === state.activeBoardId) ?? null;
}

export function getActiveBoardView(state: BoardsState): BoardView | null {
  return getActiveBoard(state)?.view ?? null;
}

/** Defensively parse a single board row from the API. Returns null if invalid. */
export function parseBoardSummary(raw: unknown): BoardSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === 'number' ? obj.id : Number(obj.id);
  if (!Number.isInteger(id) || id <= 0) return null;

  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  if (!name) return null;

  const rawView = typeof obj.view === 'string' ? obj.view : '';
  const view: BoardView = (BOARD_VIEWS as readonly string[]).includes(rawView)
    ? (rawView as BoardView)
    : 'board';

  const key = typeof obj.key === 'string' && obj.key.trim() ? obj.key.trim().toLowerCase() : null;
  const isDefault = obj.is_default === true || obj.is_default === 1;
  const sortOrderRaw = typeof obj.sort_order === 'number' ? obj.sort_order : Number(obj.sort_order);
  const sortOrder = Number.isInteger(sortOrderRaw) ? sortOrderRaw : 0;

  return {
    id,
    key,
    name,
    view,
    is_default: isDefault,
    sort_order: sortOrder,
    filter_config: normalizeBoardFilterConfig(obj.filter_config),
  };
}

/** Parse the `{ boards: [...] }` list response, dropping invalid rows. */
export function parseBoardsListResponse(raw: unknown): BoardSummary[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.boards)) return [];
  return obj.boards
    .map((row) => parseBoardSummary(row))
    .filter((board): board is BoardSummary => board !== null);
}
