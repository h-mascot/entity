import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveActivityOrgId } from './activityFileScope.ts';

test('activity file opens preserve direct and metadata organization scope', () => {
  assert.equal(resolveActivityOrgId({ org_id: 'org-direct' }), 'org-direct');
  assert.equal(resolveActivityOrgId({}, JSON.stringify({ orgId: 'org-metadata' })), 'org-metadata');
  assert.equal(resolveActivityOrgId({ orgId: '  ' }, JSON.stringify({ orgId: 'org-metadata' })), undefined);
});
