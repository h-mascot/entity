import assert from 'node:assert/strict';
import test from 'node:test';
import { LOCAL_ADMIN_PRINCIPAL_ID } from '../../lib/adminRequest.js';
import {
  adminWorkspaceOrgListPath,
  adminWorkspaceTeamRenamePath,
  adminWorkspaceTeamsPath,
  buildPrincipalGrantRequest,
} from './orgsTeamsRequests.js';

test('Access Control panel workspace requests stay on the narrow admin control-plane paths', () => {
  assert.equal(adminWorkspaceOrgListPath(), '/api/admin/workspace/orgs');
  assert.equal(adminWorkspaceTeamsPath('org/組織'), '/api/admin/workspace/orgs/org%2F%E7%B5%84%E7%B9%94/teams');
  assert.equal(
    adminWorkspaceTeamRenamePath('team/one', 'org/組織'),
    '/api/admin/workspace/teams/team%2Fone?orgId=org%2F%E7%B5%84%E7%B9%94',
  );
});

test('buildPrincipalGrantRequest keeps the acting admin header distinct from the target principal path', () => {
    const request = buildPrincipalGrantRequest('', 'created/user', {
      role: 'contributor',
      orgId: 'org-1',
      teamId: 'team-1',
    });

    assert.equal(request.url, '/api/admin/principals/created%2Fuser/grants');
    assert.deepEqual(request.init.headers, {
      'x-entity-principal-id': LOCAL_ADMIN_PRINCIPAL_ID,
      'x-entity-role': 'admin',
      'Content-Type': 'application/json',
    });
    assert.deepEqual(JSON.parse(String(request.init.body)), {
      role: 'contributor',
      org_id: 'org-1',
      team_id: 'team-1',
    });
});

test('buildPrincipalGrantRequest builds the same target request for a retry without changing the acting identity', () => {
    const input = { role: 'manager' as const, orgId: 'org-1', teamId: '' };
    const first = buildPrincipalGrantRequest('/entity', 'principal-42', input);
    const retry = buildPrincipalGrantRequest('/entity', 'principal-42', input);

    assert.equal(retry.url, first.url);
    assert.deepEqual(retry.init.headers, first.init.headers);
    assert.deepEqual(JSON.parse(String(retry.init.body)), {
      role: 'manager',
      org_id: 'org-1',
      team_id: null,
    });
});
