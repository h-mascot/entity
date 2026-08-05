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
  selectActiveBoardAfterDeletion,
  renderTabAfterDeletion,
  buildBoardCustomizationPatch,
  resolveInitialActiveBoard,
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

test('resolveInitialActiveBoard restores a stored board id when it still exists', () => {
  const boards = [general, analytics, platform];
  assert.equal(resolveInitialActiveBoard(boards, { storedBoardId: platform.id }), platform.id);
});

test('resolveInitialActiveBoard migrates a stale stored id via the legacy tab to analytics', () => {
  const boards = [general, analytics];
  // stored id 999 no longer exists; legacy tab 'insights' -> analytics
  assert.equal(
    resolveInitialActiveBoard(boards, { storedBoardId: 999, legacyTab: 'insights' }),
    analytics.id,
  );
});

test('resolveInitialActiveBoard falls back to General for kanban/unknown/plugin tabs and empty storage', () => {
  const boards = [general, analytics];
  assert.equal(resolveInitialActiveBoard(boards, { legacyTab: 'kanban' }), general.id);
  assert.equal(resolveInitialActiveBoard(boards, { legacyTab: 'strategic' }), general.id);
  assert.equal(resolveInitialActiveBoard(boards, { legacyTab: 'plugin:geordi' }), general.id);
  assert.equal(resolveInitialActiveBoard(boards, {}), general.id);
});

test('resolveInitialActiveBoard never returns a blank screen: falls to first board / null only when empty', () => {
  assert.equal(resolveInitialActiveBoard([platform], {}), platform.id);
  assert.equal(resolveInitialActiveBoard([], { legacyTab: 'kanban' }), null);
});

test('renderTabAfterDeletion switches the visible tab to the reducer-selected replacement only when the active board is deleted', () => {
  // Active = Platform (engineering). Deleting it falls back to General (kanban).
  const onPlatform = selectBoard(initBoardsState([general, analytics, platform]), platform.id);
  assert.equal(renderTabAfterDeletion(onPlatform, platform.id), 'kanban');

  // Active = Analytics. Deleting it falls back to General (kanban).
  const onAnalytics = selectBoard(initBoardsState([general, analytics, platform]), analytics.id);
  assert.equal(renderTabAfterDeletion(onAnalytics, analytics.id), 'kanban');

  // Deleting a NON-active board must not change the visible tab (null = no switch).
  // This is the BRD-003 regression: previously it always switched to General.
  const onGeneral = initBoardsState([general, analytics, platform]);
  assert.equal(renderTabAfterDeletion(onGeneral, platform.id), null);
  assert.equal(renderTabAfterDeletion(onGeneral, analytics.id), null);
});

test('selectActiveBoardAfterDeletion reports the replacement board chosen by the reducer', () => {
  const onPlatform = selectBoard(initBoardsState([general, analytics, platform]), platform.id);
  assert.equal(selectActiveBoardAfterDeletion(onPlatform, platform.id)?.key, 'general');

  // When no General default remains but other boards do, the first ordered one wins.
  const custom = [{ ...platform, sort_order: 0 }];
  const another = { ...platform, id: 9, sort_order: 1, name: 'Other' };
  const onCustom = selectBoard(initBoardsState([custom[0], another]), another.id);
  assert.equal(selectActiveBoardAfterDeletion(onCustom, another.id)?.id, platform.id);

  // When the last board is deleted there is no replacement.
  const onlyOne = selectBoard(initBoardsState([platform]), platform.id);
  assert.equal(selectActiveBoardAfterDeletion(onlyOne, platform.id), null);
});

test('buildBoardCustomizationPatch normalizes a customize-form into a PATCH payload (BRD-002)', () => {
  // workDomain scope with a view override.
  const eng = buildBoardCustomizationPatch({
    view: 'engineering',
    scope: 'workDomain',
    workDomain: 'Platform',
  });
  assert.deepEqual(eng, {
    view: 'engineering',
    filter_config: { scope: 'workDomain', workDomain: 'platform' },
  });

  // projects scope parses a comma-separated id list and drops junk.
  const proj = buildBoardCustomizationPatch({
    scope: 'projects',
    projectIdsCsv: ' 3, 9, nope, 0, 9 ',
  });
  assert.deepEqual(proj.filter_config, { scope: 'projects', projectIds: [3, 9] });

  // none scope and default fall back safely.
  assert.deepEqual(
    buildBoardCustomizationPatch({ scope: 'none' }).filter_config,
    { scope: 'none' },
  );
  assert.deepEqual(
    buildBoardCustomizationPatch({}).filter_config,
    { scope: 'all' },
  );

  // Empty projects list collapses to all (matches normalize semantics).
  assert.deepEqual(
    buildBoardCustomizationPatch({ scope: 'projects', projectIdsCsv: '' }).filter_config,
    { scope: 'all' },
  );
});
