import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boardViewToRenderTab,
  preferredBoardKeyFromLegacyTab,
  initBoardsState,
  selectBoard,
  applyBoardCreated,
  applyBoardUpdated,
  applyBoardsReordered,
  applyBoardDeleted,
  getOrderedBoards,
  getActiveBoard,
  getActiveBoardView,
  parseBoardSummary,
  parseBoardsListResponse,
  type BoardSummary,
} from './boardsState.js';

const general: BoardSummary = {
  id: 1,
  key: 'general',
  name: 'General',
  view: 'board',
  is_default: true,
  sort_order: 0,
  filter_config: { scope: 'all' },
};
const analytics: BoardSummary = {
  id: 2,
  key: 'analytics',
  name: 'Analytics',
  view: 'analytics',
  is_default: true,
  sort_order: 1,
  filter_config: { scope: 'all' },
};
const platform: BoardSummary = {
  id: 3,
  key: null,
  name: 'Platform Eng',
  view: 'engineering',
  is_default: false,
  sort_order: 2,
  filter_config: { scope: 'workDomain', workDomain: 'engineering' },
};

test('boardViewToRenderTab bridges the new board views onto existing render surfaces', () => {
  assert.equal(boardViewToRenderTab('board'), 'kanban');
  assert.equal(boardViewToRenderTab('analytics'), 'insights');
  assert.equal(boardViewToRenderTab('strategic'), 'strategic');
  assert.equal(boardViewToRenderTab('engineering'), 'engineering');
});

test('preferredBoardKeyFromLegacyTab restores a safe default for every legacy tab', () => {
  assert.equal(preferredBoardKeyFromLegacyTab('kanban'), 'general');
  assert.equal(preferredBoardKeyFromLegacyTab('ops'), 'general');
  assert.equal(preferredBoardKeyFromLegacyTab('strategic'), 'general');
  assert.equal(preferredBoardKeyFromLegacyTab('engineering'), 'general');
  assert.equal(preferredBoardKeyFromLegacyTab('plugin:geordi'), 'general');
  assert.equal(preferredBoardKeyFromLegacyTab(''), 'general');
  assert.equal(preferredBoardKeyFromLegacyTab(null), 'general');
  assert.equal(preferredBoardKeyFromLegacyTab('insights'), 'analytics');
});

test('initBoardsState selects General by default, honors a preferred key, never lands blank', () => {
  const boards = [general, analytics];
  assert.equal(getActiveBoard(initBoardsState(boards))?.key, 'general');
  assert.equal(getActiveBoard(initBoardsState(boards, 'analytics'))?.key, 'analytics');
  assert.equal(getActiveBoard(initBoardsState(boards, 'general'))?.key, 'general');
  // Unknown preferred key falls back to General.
  assert.equal(getActiveBoard(initBoardsState(boards, 'nope'))?.key, 'general');
  // Empty board list leaves no active board (rendered as a loading/empty state).
  assert.equal(getActiveBoard(initBoardsState([], 'general')), null);
});

test('initBoardsState falls back to the first board when no General default exists', () => {
  const onlyCustom = [{ ...platform, sort_order: 0 }];
  assert.equal(getActiveBoard(initBoardsState(onlyCustom))?.id, platform.id);
});

test('selectBoard sets the active board for a known id and ignores unknown ids', () => {
  const state = initBoardsState([general, analytics]);
  const switched = selectBoard(state, analytics.id);
  assert.equal(getActiveBoard(switched)?.id, analytics.id);
  // Unknown id leaves the active selection untouched.
  assert.equal(getActiveBoard(selectBoard(state, 9999))?.id, general.id);
});

test('applyBoardCreated appends the new board and switches to it', () => {
  const state = initBoardsState([general, analytics]);
  const next = applyBoardCreated(state, platform);
  assert.deepEqual(
    getOrderedBoards(next).map((b) => b.id),
    [general.id, analytics.id, platform.id],
  );
  assert.equal(getActiveBoard(next)?.id, platform.id);
  // Immutability: original state untouched.
  assert.equal(getOrderedBoards(state).length, 2);
});

test('applyBoardUpdated replaces a board in place and keeps the active selection', () => {
  const state = initBoardsState([general, analytics, platform]);
  const renamed: BoardSummary = { ...platform, name: 'Platform Engineering' };
  const next = applyBoardUpdated(state, renamed);
  assert.equal(getOrderedBoards(next).find((b) => b.id === platform.id)?.name, 'Platform Engineering');
  assert.equal(getActiveBoard(next)?.id, getActiveBoard(state)?.id);
});

test('applyBoardsReordered replaces the ordered list without losing the active board', () => {
  const state = initBoardsState([general, analytics]);
  // The server reassigns sort_order to match the new order; mirror that here.
  const reordered = applyBoardsReordered(state, [
    { ...analytics, sort_order: 0 },
    { ...general, sort_order: 1 },
  ]);
  assert.deepEqual(
    getOrderedBoards(reordered).map((b) => b.id),
    [analytics.id, general.id],
  );
  assert.equal(getActiveBoard(reordered)?.id, general.id);
});

test('applyBoardDeleted removes a user board and falls back to General when active is deleted', () => {
  const state = selectBoard(initBoardsState([general, analytics, platform]), platform.id);
  assert.equal(getActiveBoard(state)?.id, platform.id);

  const afterDelete = applyBoardDeleted(state, platform.id);
  assert.deepEqual(
    getOrderedBoards(afterDelete).map((b) => b.id),
    [general.id, analytics.id],
  );
  assert.equal(getActiveBoard(afterDelete)?.key, 'general');
});

test('applyBoardDeleted keeps the active board when a different board is removed', () => {
  const state = initBoardsState([general, analytics, platform]);
  const afterDelete = applyBoardDeleted(state, analytics.id);
  assert.equal(getActiveBoard(afterDelete)?.id, general.id);
  // Unknown id is a no-op.
  assert.deepEqual(getOrderedBoards(applyBoardDeleted(state, 9999)), getOrderedBoards(state));
});

test('applyBoardDeleted leaves no active board when the last board is removed', () => {
  const state = initBoardsState([general]);
  const emptied = applyBoardDeleted(state, general.id);
  // Note: defaults are not deletable via the API, but the reducer must still be total.
  assert.equal(getOrderedBoards(emptied).length, 0);
  assert.equal(getActiveBoard(emptied), null);
  assert.equal(getActiveBoardView(emptied), null);
});

test('getOrderedBoards sorts by sort_order then id regardless of input order', () => {
  const shuffled = [{ ...platform, sort_order: 5 }, { ...general, sort_order: 5 }, analytics];
  assert.deepEqual(
    getOrderedBoards({ boards: shuffled, activeBoardId: null }).map((b) => b.id),
    [analytics.id, general.id, platform.id],
  );
});

test('parseBoardSummary validates and coerces the API payload defensively', () => {
  assert.equal(parseBoardSummary(null), null);
  assert.equal(parseBoardSummary({ id: 'x' }), null);
  assert.equal(parseBoardSummary({ id: 1 }), null); // missing name

  const parsed = parseBoardSummary({
    id: 7,
    key: 'Analytics',
    name: '  Analytics  ',
    view: 'analytics',
    is_default: 1,
    sort_order: '3',
    filter_config: { scope: 'projects', projectIds: [2, 'bad', 2] },
  });
  assert.deepEqual(parsed, {
    id: 7,
    key: 'analytics',
    name: 'Analytics',
    view: 'analytics',
    is_default: true,
    sort_order: 3,
    filter_config: { scope: 'projects', projectIds: [2] },
  });

  // Unknown view coerces to the safe General render view.
  assert.equal(parseBoardSummary({ id: 1, name: 'X', view: 'wat' })?.view, 'board');
  assert.equal(parseBoardSummary({ id: 1, name: 'X' })?.key, null);
});

test('parseBoardsListResponse reads { boards: [...] } and drops invalid rows', () => {
  const list = parseBoardsListResponse({
    boards: [
      { id: 1, key: 'general', name: 'General', view: 'board', is_default: true, sort_order: 0 },
      { id: 2, key: 'analytics', name: 'Analytics', view: 'analytics', is_default: true, sort_order: 1 },
      { id: 'bad' },
    ],
  });
  assert.deepEqual(list.map((b) => b.id), [1, 2]);
  assert.deepEqual(list.map((b) => b.key), ['general', 'analytics']);

  assert.deepEqual(parseBoardsListResponse(null), []);
  assert.deepEqual(parseBoardsListResponse({ boards: 'nope' }), []);
});
