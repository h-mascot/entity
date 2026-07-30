import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILTIN_MC_BOARD_TABS,
  getMCBoardTabLabel,
  isBuiltInMCBoardTab,
  isMobileMCBoardTabActive,
  normalizeStoredMCBoardTab,
} from './mcBoardTabs.js';

test('Engineering is a built-in Mission Control entry point', () => {
  assert.deepEqual(BUILTIN_MC_BOARD_TABS, [
    'kanban',
    'engineering',
    'strategic',
    'insights',
  ]);
  assert.equal(getMCBoardTabLabel('engineering'), 'Engineering');
  assert.equal(isBuiltInMCBoardTab('engineering'), true);
});

test('persisted Engineering selection restores without changing legacy ops fallback', () => {
  assert.equal(normalizeStoredMCBoardTab('engineering'), 'engineering');
  assert.equal(normalizeStoredMCBoardTab('ops'), 'kanban');
  assert.equal(normalizeStoredMCBoardTab(null), 'kanban');
  assert.equal(normalizeStoredMCBoardTab('  '), 'kanban');
});

test('mobile board controls do not present unsupported persisted tabs as Kanban', () => {
  assert.equal(isMobileMCBoardTabActive('kanban', 'kanban'), true);
  assert.equal(isMobileMCBoardTabActive('engineering', 'engineering'), true);
  assert.equal(isMobileMCBoardTabActive('strategic', 'kanban'), false);
  assert.equal(isMobileMCBoardTabActive('insights', 'kanban'), false);
  assert.equal(isMobileMCBoardTabActive('plugin-view', 'kanban'), false);
});
