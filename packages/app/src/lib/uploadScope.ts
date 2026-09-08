export const UPLOAD_ORG_WIDE_SCOPE = '__org-wide__';

export interface UploadTeamOption {
  id: string;
  name: string;
}

export interface UploadScopeOptions {
  orgId?: string;
  teamId?: string | null;
}

export function buildUploadScopeOptions(
  orgId: string,
  teamId: string,
): UploadScopeOptions | undefined {
  if (!orgId && !teamId) return undefined;
  return {
    ...(orgId ? { orgId } : {}),
    ...(teamId ? { teamId: teamId === UPLOAD_ORG_WIDE_SCOPE ? null : teamId } : {}),
  };
}

/**
 * Keep an existing upload choice when it is still valid. Team responses do
 * not carry grant roles, so visible teams remain unselected until the user
 * makes an explicit choice. The server remains authoritative for contributor
 * access.
 */
export function normalizeUploadTeamSelection(
  current: string,
  teams: UploadTeamOption[],
): string {
  if (current === UPLOAD_ORG_WIDE_SCOPE) return current;
  if (current && teams.some((team) => team.id === current)) return current;
  return '';
}

export function uploadScopeNeedsSelection(
  orgCount: number,
  selectedOrgId: string,
  teams: UploadTeamOption[],
  selectedTeamId: string,
): boolean {
  if (orgCount > 1 && !selectedOrgId) return true;
  return teams.length > 0 && !selectedTeamId;
}
