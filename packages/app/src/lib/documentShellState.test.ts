import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getDocumentShellCollapseState,
  shouldShowDocumentRightRail,
} from './documentShellState.ts';

test('documents default both workspace sidebars to focused mode', () => {
  assert.deepEqual(getDocumentShellCollapseState('["workspace","output/report.html"]'), {
    left: true,
    right: true,
  });
});

test('non-document workspace pages default both sidebars open', () => {
  assert.deepEqual(getDocumentShellCollapseState(null), {
    left: false,
    right: false,
  });
});

test('document right rail stays visible while collaboration is unavailable', () => {
  assert.equal(shouldShowDocumentRightRail({ agentNativeEditorEnabled: true, documentsReady: false }), true);
});

test('document right rail stays hidden when the agent-native editor is disabled', () => {
  assert.equal(shouldShowDocumentRightRail({ agentNativeEditorEnabled: false, documentsReady: true }), false);
});
