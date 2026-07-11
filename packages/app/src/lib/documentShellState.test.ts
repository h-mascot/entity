import test from 'node:test';
import assert from 'node:assert/strict';

import { getDocumentShellCollapseState } from './documentShellState.ts';

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
