import { useCallback, useEffect, useMemo, useState } from 'react';
import { toErrorMessage, withApiToken } from '../../lib/http';
import { adminMutationHeaders } from '../../lib/adminRequest';

type TeamRecord = {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  status: string;
  created_at?: string;
};

type OrgRecord = {
  id: string;
  name: string;
  slug: string;
  status: string;
  deployment_mode?: string | null;
  mission?: string | null;
};

type GrantRole = 'viewer' | 'contributor' | 'manager' | 'admin';

interface OrgsTeamsSettingsProps {
  apiBase?: string;
}

const GRANT_ROLES: Array<{ value: GrantRole; label: string; description: string }> = [
  { value: 'viewer', label: 'Viewer', description: 'Read-only access within the granted scope' },
  { value: 'contributor', label: 'Contributor', description: 'Create and edit content within the granted scope' },
  { value: 'manager', label: 'Manager', description: 'Manage work and members within the granted scope' },
  { value: 'admin', label: 'Admin', description: 'Full administration of the granted scope' },
];

const EMPTY_TEAM_FORM = { name: '', slug: '' };
const EMPTY_INVITE_FORM = {
  display_name: '',
  email: '',
  handle: '',
  role: 'contributor' as GrantRole,
  team_id: '',
};

function apiPath(apiBase: string | undefined, path: string): string {
  return `${apiBase ?? ''}${path}`;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({})) as { error?: string };
  return body.error ?? `${fallback} (${res.status})`;
}

export default function OrgsTeamsSettings({ apiBase = '' }: OrgsTeamsSettingsProps) {
  const [orgs, setOrgs] = useState<OrgRecord[]>([]);
  const [orgId, setOrgId] = useState<string>('');
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [teamFormOpen, setTeamFormOpen] = useState(false);
  const [teamForm, setTeamForm] = useState(EMPTY_TEAM_FORM);
  const [inviteFormOpen, setInviteFormOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState(EMPTY_INVITE_FORM);
  const [confirmRenameId, setConfirmRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const selectedOrg = useMemo(
    () => orgs.find((org) => org.id === orgId) ?? null,
    [orgs, orgId],
  );

  const loadOrgs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiPath(apiBase, '/api/orgs'), withApiToken());
      if (!res.ok) throw new Error(await readError(res, 'Failed to load orgs'));
      const body = await res.json() as { orgs: OrgRecord[] };
      setOrgs(body.orgs);
      setOrgId((current) => {
        if (current && body.orgs.some((org) => org.id === current)) return current;
        return body.orgs[0]?.id ?? '';
      });
    } catch (err) {
      setError(toErrorMessage(err, 'Failed to load organizations.'));
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  const loadTeams = useCallback(async (targetOrgId: string) => {
    if (!targetOrgId) {
      setTeams([]);
      return;
    }
    try {
      const res = await fetch(apiPath(apiBase, `/api/orgs/${encodeURIComponent(targetOrgId)}/teams`), withApiToken());
      if (!res.ok) throw new Error(await readError(res, 'Failed to load teams'));
      const body = await res.json() as { teams: TeamRecord[] };
      setTeams(body.teams);
    } catch (err) {
      setError(toErrorMessage(err, 'Failed to load teams.'));
      setTeams([]);
    }
  }, [apiBase]);

  useEffect(() => {
    void loadOrgs();
  }, [loadOrgs]);

  useEffect(() => {
    if (orgId) void loadTeams(orgId);
  }, [orgId, loadTeams]);

  const handleCreateTeam = async () => {
    if (!orgId) return;
    const name = teamForm.name.trim();
    if (!name) {
      setError('Team name is required.');
      return;
    }
    setWorking(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(apiPath(apiBase, `/api/orgs/${encodeURIComponent(orgId)}/teams`), withApiToken({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          ...(teamForm.slug.trim() ? { id: teamForm.slug.trim(), slug: teamForm.slug.trim() } : {}),
        }),
      }));
      if (!res.ok) throw new Error(await readError(res, 'Team create failed'));
      const body = await res.json() as { team: TeamRecord };
      setTeamForm(EMPTY_TEAM_FORM);
      setTeamFormOpen(false);
      setSuccess(`Team “${body.team.name}” created.`);
      await loadTeams(orgId);
    } catch (err) {
      setError(toErrorMessage(err, 'Failed to create team.'));
    } finally {
      setWorking(false);
    }
  };

  const handleRenameTeam = async (teamId: string) => {
    if (!orgId) return;
    const name = renameValue.trim();
    if (!name) {
      setError('Team name is required.');
      return;
    }
    setWorking(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(apiPath(apiBase, `/api/teams/${encodeURIComponent(teamId)}`), withApiToken({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ...(orgId ? { org_id: orgId } : {}) }),
      }));
      if (!res.ok) throw new Error(await readError(res, 'Team rename failed'));
      setConfirmRenameId(null);
      setRenameValue('');
      setSuccess('Team renamed.');
      await loadTeams(orgId);
    } catch (err) {
      setError(toErrorMessage(err, 'Failed to rename team.'));
    } finally {
      setWorking(false);
    }
  };

  const handleInvite = async () => {
    if (!orgId) return;
    const displayName = inviteForm.display_name.trim();
    if (!displayName) {
      setError('Display name is required.');
      return;
    }
    setWorking(true);
    setError(null);
    setSuccess(null);
    try {
      // 1. Create the human principal.
      const created = await (async () => {
        const res = await fetch(apiPath(apiBase, '/api/admin/principals'), withApiToken({
          method: 'POST',
          headers: adminMutationHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            principal_type: 'human',
            display_name: displayName,
            handle: inviteForm.handle.trim() || null,
            email: inviteForm.email.trim() || null,
          }),
        }));
        if (!res.ok) throw new Error(await readError(res, 'Invite (create principal) failed'));
        return await res.json() as { id: string; display_name: string };
      })();
      // 2. Grant the chosen role on the selected team (or org-wide when no team selected).
      const grant = await (async () => {
        const res = await fetch(apiPath(apiBase, `/api/admin/principals/${encodeURIComponent(created.id)}/grants`), withApiToken({
          method: 'POST',
          headers: adminMutationHeaders({ 'Content-Type': 'application/json' }, created.id),
          body: JSON.stringify({
            role: inviteForm.role,
            org_id: orgId,
            team_id: inviteForm.team_id || null,
          }),
        }));
        if (!res.ok) throw new Error(await readError(res, 'Grant failed'));
        return true;
      })();
      if (!grant) return;
      setInviteForm(EMPTY_INVITE_FORM);
      setInviteFormOpen(false);
      const scope = inviteForm.team_id
        ? `team ${inviteForm.team_id}`
        : `org ${orgId} (all teams)`;
      setSuccess(`Invited ${created.display_name} as ${inviteForm.role} on ${scope}. Manage grants under Users & roles.`);
    } catch (err) {
      setError(toErrorMessage(err, 'Failed to invite user.'));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-[var(--text-primary)]">Orgs &amp; teams</div>
          <div className="text-xs text-[var(--text-muted)]">Create teams and invite people with scoped roles</div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
            <span>Org</span>
            <select
              value={orgId}
              onChange={(event) => setOrgId(event.target.value)}
              className="mc-shell-input px-2 py-1.5 text-sm"
              disabled={loading || orgs.length === 0}
            >
              {orgs.length === 0 && <option value="">No orgs</option>}
              {orgs.map((org) => (
                <option key={org.id} value={org.id}>{org.name} ({org.id})</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="mc-shell-btn px-2.5 py-1 text-xs"
            onClick={() => { setInviteFormOpen((open) => !open); setTeamFormOpen(false); }}
            aria-expanded={inviteFormOpen}
            disabled={!selectedOrg}
          >
            {inviteFormOpen ? 'Cancel' : 'Invite user'}
          </button>
          <button
            type="button"
            className="mc-shell-btn px-2.5 py-1 text-xs"
            onClick={() => { setTeamFormOpen((open) => !open); setInviteFormOpen(false); }}
            aria-expanded={teamFormOpen}
            disabled={!selectedOrg}
          >
            {teamFormOpen ? 'Cancel' : 'New team'}
          </button>
        </div>
      </div>

      {selectedOrg && (
        <div className="mb-3 text-xs text-[var(--text-muted)]">
          {selectedOrg.name} · {selectedOrg.deployment_mode ?? 'deployment mode n/a'}
          {selectedOrg.mission ? ` · ${selectedOrg.mission}` : ''}
        </div>
      )}

      {inviteFormOpen && selectedOrg && (
        <div className="mb-4 space-y-2 rounded-lg border border-[var(--border-primary)] p-3">
          <div className="text-xs font-medium text-[var(--text-primary)]">Invite a person</div>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
              <span>Display name</span>
              <input
                value={inviteForm.display_name}
                onChange={(event) => setInviteForm((prev) => ({ ...prev, display_name: event.target.value }))}
                className="mc-shell-input px-2 py-1.5 text-sm"
                placeholder="Sam Seller"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
              <span>Email</span>
              <input
                value={inviteForm.email}
                onChange={(event) => setInviteForm((prev) => ({ ...prev, email: event.target.value }))}
                className="mc-shell-input px-2 py-1.5 text-sm"
                placeholder="sam@curacel.example"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
              <span>Handle (optional)</span>
              <input
                value={inviteForm.handle}
                onChange={(event) => setInviteForm((prev) => ({ ...prev, handle: event.target.value }))}
                className="mc-shell-input px-2 py-1.5 text-sm"
                placeholder="sam"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
              <span>Team</span>
              <select
                value={inviteForm.team_id}
                onChange={(event) => setInviteForm((prev) => ({ ...prev, team_id: event.target.value }))}
                className="mc-shell-input px-2 py-1.5 text-sm"
              >
                <option value="">All teams (org-wide grant)</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name} ({team.id})</option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="space-y-1">
            <legend className="text-xs text-[var(--text-muted)]">Role</legend>
            <div className="grid gap-1 md:grid-cols-2">
              {GRANT_ROLES.map((role) => {
                const checked = inviteForm.role === role.value;
                return (
                  <label
                    key={role.value}
                    className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-xs ${
                      checked
                        ? 'border-[var(--accent)] bg-[var(--bg-tertiary)]'
                        : 'border-[var(--border-primary)]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="invite-role"
                      className="mt-0.5"
                      checked={checked}
                      onChange={() => setInviteForm((prev) => ({ ...prev, role: role.value }))}
                    />
                    <span>
                      <span className="font-medium text-[var(--text-primary)]">{role.label}</span>
                      <span className="block text-[11px] text-[var(--text-muted)]">{role.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <button
            type="button"
            disabled={working}
            onClick={() => void handleInvite()}
            className="mc-shell-btn mc-shell-btn-active px-3 py-1.5 text-xs"
          >
            Create principal + grant
          </button>
          <p className="text-[11px] text-[var(--text-muted)]">
            Creates a human principal and assigns the selected {inviteForm.team_id ? 'team' : 'org'} grant.
            Full grant editing (sensitivity categories, extra scopes, revoke) lives under Users &amp; roles.
          </p>
        </div>
      )}

      {teamFormOpen && selectedOrg && (
        <div className="mb-4 space-y-2 rounded-lg border border-[var(--border-primary)] p-3">
          <div className="text-xs font-medium text-[var(--text-primary)]">New team in {selectedOrg.name}</div>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
              <span>Team name</span>
              <input
                value={teamForm.name}
                onChange={(event) => setTeamForm((prev) => ({ ...prev, name: event.target.value }))}
                className="mc-shell-input px-2 py-1.5 text-sm"
                placeholder="Sales"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
              <span>Team ID / slug (optional)</span>
              <input
                value={teamForm.slug}
                onChange={(event) => setTeamForm((prev) => ({ ...prev, slug: event.target.value }))}
                className="mc-shell-input px-2 py-1.5 text-sm"
                placeholder="sales"
              />
            </label>
          </div>
          <button
            type="button"
            disabled={working}
            onClick={() => void handleCreateTeam()}
            className="mc-shell-btn mc-shell-btn-active px-3 py-1.5 text-xs"
          >
            Create team
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-xs text-[var(--text-muted)]">Loading orgs…</div>
      ) : !selectedOrg ? (
        <div className="text-xs text-[var(--text-muted)]">No organizations found.</div>
      ) : (
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Teams ({teams.length})
          </div>
          {teams.length === 0 ? (
            <div className="text-xs text-[var(--text-muted)]">No teams yet. Create one (e.g. Sales, Claims Ops).</div>
          ) : (
            <ul className="grid gap-2 md:grid-cols-2">
              {teams.map((team) => (
                <li key={team.id} className="rounded-lg border border-[var(--border-primary)] p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium text-[var(--text-primary)]">{team.name}</div>
                    {confirmRenameId === team.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          value={renameValue}
                          onChange={(event) => setRenameValue(event.target.value)}
                          className="mc-shell-input px-2 py-1 text-xs"
                          aria-label={`New name for ${team.name}`}
                        />
                        <button type="button" className="mc-shell-btn px-2 py-1" onClick={() => setConfirmRenameId(null)}>Cancel</button>
                        <button type="button" className="mc-shell-btn px-2 py-1" disabled={working} onClick={() => void handleRenameTeam(team.id)}>Save</button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="mc-shell-btn px-2 py-1"
                        onClick={() => { setConfirmRenameId(team.id); setRenameValue(team.name); }}
                      >
                        Rename
                      </button>
                    )}
                  </div>
                  <div className="mt-1 text-[var(--text-muted)]">
                    id {team.id} · slug {team.slug} · {team.status}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <div className="mt-3 text-xs text-[var(--error)]" role="alert">{error}</div>}
      {success && <div className="mt-3 text-xs text-[var(--accent)]" role="status">{success}</div>}
    </div>
  );
}
