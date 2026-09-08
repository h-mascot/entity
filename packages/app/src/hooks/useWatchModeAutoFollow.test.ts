import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isWatchModeFileTargetCurrent,
  resolveWatchModeOrgId,
} from './useWatchModeAutoFollow.ts';

test('watch mode prefers known event organization and otherwise uses browser scope', () => {
  assert.equal(resolveWatchModeOrgId('org-event', 'org-browser'), 'org-event');
  assert.equal(resolveWatchModeOrgId(null, 'org-browser'), 'org-browser');
  assert.equal(resolveWatchModeOrgId(undefined, undefined), null);
});

test('watch mode does not treat same-path files from different organizations as current', () => {
  assert.equal(
    isWatchModeFileTargetCurrent('docs/shared.md', 'docs/shared.md', null, null, 'org-b', 'org-a', 'org-a'),
    false,
  );
  assert.equal(
    isWatchModeFileTargetCurrent('docs/shared.md', 'docs/shared.md', null, null, null, 'org-a', 'org-a'),
    true,
  );
});
