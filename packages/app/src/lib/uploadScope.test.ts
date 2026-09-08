import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUploadScopeOptions,
  normalizeUploadTeamSelection,
  uploadScopeNeedsSelection,
  UPLOAD_ORG_WIDE_SCOPE,
} from './uploadScope.js';

const teamA = { id: 'team-a', name: 'Team A' };
const teamB = { id: 'team-b', name: 'Team B' };

test('does not infer a contributor grant from a sole visible team', () => {
  assert.equal(normalizeUploadTeamSelection('', [teamA]), '');
  assert.equal(uploadScopeNeedsSelection(1, 'org-a', [teamA], ''), true);
});

test('requires an explicit choice when multiple teams are available', () => {
  assert.equal(normalizeUploadTeamSelection('', [teamA, teamB]), '');
  assert.equal(uploadScopeNeedsSelection(1, 'org-a', [teamA, teamB], ''), true);
  assert.equal(uploadScopeNeedsSelection(1, 'org-a', [teamA, teamB], 'team-b'), false);
});

test('preserves an explicit organization-wide scope', () => {
  assert.equal(normalizeUploadTeamSelection(UPLOAD_ORG_WIDE_SCOPE, [teamA, teamB]), UPLOAD_ORG_WIDE_SCOPE);
  assert.deepEqual(buildUploadScopeOptions('org-a', UPLOAD_ORG_WIDE_SCOPE), { orgId: 'org-a', teamId: null });
  assert.deepEqual(buildUploadScopeOptions('org-a', 'team-a'), { orgId: 'org-a', teamId: 'team-a' });
  assert.equal(buildUploadScopeOptions('', ''), undefined);
});
