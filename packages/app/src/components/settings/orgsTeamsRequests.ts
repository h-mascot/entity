import { withApiToken } from '../../lib/http.js';
import { adminMutationHeaders } from '../../lib/adminRequest.js';
import { appendOrgScope } from '../../lib/legacyFileScope.js';

export const ADMIN_WORKSPACE_BASE_PATH = '/api/admin/workspace';

export function adminWorkspaceOrgListPath(): string {
  return `${ADMIN_WORKSPACE_BASE_PATH}/orgs`;
}

export function adminWorkspaceTeamsPath(orgId: string): string {
  return `${ADMIN_WORKSPACE_BASE_PATH}/orgs/${encodeURIComponent(orgId)}/teams`;
}

export function adminWorkspaceTeamRenamePath(teamId: string, orgId: string): string {
  return appendOrgScope(`${ADMIN_WORKSPACE_BASE_PATH}/teams/${encodeURIComponent(teamId)}`, orgId);
}

export type GrantRole = 'viewer' | 'contributor' | 'manager' | 'admin';

export interface PrincipalGrantRequestInput {
  role: GrantRole;
  orgId: string;
  teamId: string;
}

/**
 * Build a grant request whose URL identifies the target principal while its
 * admin header remains the currently authenticated acting principal.
 */
export function buildPrincipalGrantRequest(
  apiBase: string | undefined,
  targetPrincipalId: string,
  input: PrincipalGrantRequestInput,
): { url: string; init: RequestInit } {
  return {
    url: `${apiBase ?? ''}/api/admin/principals/${encodeURIComponent(targetPrincipalId)}/grants`,
    init: withApiToken({
      method: 'POST',
      headers: adminMutationHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        role: input.role,
        org_id: input.orgId,
        team_id: input.teamId || null,
      }),
    }),
  };
}
