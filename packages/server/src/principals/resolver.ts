import {
  createPrincipalRepository,
  parseGrantSensitivityCategories,
  type PrincipalRepository,
} from '../../../db/src/principals';
import type { PrincipalGrant, PrincipalPermissionContext } from '../permissions';

export type StoredPrincipalResolution =
  | { kind: 'stored'; principal: PrincipalPermissionContext; status: 'active' | 'disabled' }
  | { kind: 'local_compat' };

function mapStoredGrants(repo: PrincipalRepository, principalId: string): PrincipalGrant[] {
  return repo.listGrantsForPrincipal(principalId).map((grant) => ({
    role: grant.role,
    org_id: grant.org_id,
    team_id: grant.team_id,
    project_id: grant.project_id,
    sensitivity_categories: parseGrantSensitivityCategories(grant),
  }));
}

export function resolveStoredPrincipalContext(
  principalId: string,
  repo: PrincipalRepository = createPrincipalRepository(),
): StoredPrincipalResolution {
  const record = repo.getPrincipal(principalId);
  if (!record) {
    return { kind: 'local_compat' };
  }

  if (record.status === 'disabled') {
    return {
      kind: 'stored',
      status: 'disabled',
      principal: {
        principal_id: record.id,
        grants: [],
      },
    };
  }

  return {
    kind: 'stored',
    status: 'active',
    principal: {
      principal_id: record.id,
      grants: mapStoredGrants(repo, record.id),
    },
  };
}

export function buildLocalCompatPrincipalContext(
  principalId: string,
  orgId: string,
  roleHeader: string | undefined,
  sensitivityHeader: string | undefined,
): PrincipalPermissionContext {
  const role = roleHeader === 'viewer' || roleHeader === 'contributor' || roleHeader === 'manager' || roleHeader === 'admin'
    ? roleHeader
    : 'manager';
  const sensitivity_categories = (sensitivityHeader ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return {
    principal_id: principalId,
    grants: [{ role, org_id: orgId, sensitivity_categories }],
  };
}
