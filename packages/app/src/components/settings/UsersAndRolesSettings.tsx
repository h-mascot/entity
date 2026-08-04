import { useCallback, useEffect, useMemo, useState } from 'react';
import { toErrorMessage, withApiToken } from '../../lib/http';
import { adminMutationHeaders, persistAdminPrincipalId } from '../../lib/adminRequest';
import { clearAdminRuntimeSettingsCache } from '../../lib/adminRuntimeSettings';

type PrincipalType = 'human' | 'agent' | 'service_account';
type GrantRole = 'viewer' | 'contributor' | 'manager' | 'admin';

interface PrincipalGrant {
  id: string;
  role: GrantRole;
  org_id: string | null;
  team_id: string | null;
  project_id: number | null;
  sensitivity_categories: string[];
}

interface PrincipalRecord {
  id: string;
  principal_type: PrincipalType;
  display_name: string;
  handle: string | null;
  email: string | null;
  status: 'active' | 'disabled';
  grants: PrincipalGrant[];
}

interface UsersAndRolesSettingsProps {
  apiBase?: string;
}

const PRINCIPAL_TYPES: Array<{ value: PrincipalType; label: string }> = [
  { value: 'human', label: 'Human' },
  { value: 'agent', label: 'Agent' },
  { value: 'service_account', label: 'Service account' },
];

const GRANT_ROLES: GrantRole[] = ['viewer', 'contributor', 'manager', 'admin'];

const SENSITIVITY_OPTIONS = [
  'hr',
  'customer',
  'legal',
  'financial',
  'security',
  'production',
  'confidential_strategy',
  'workspace_defined',
];

const EMPTY_FORM = {
  principal_type: 'human' as PrincipalType,
  display_name: '',
  handle: '',
  email: '',
};

const EMPTY_GRANT = {
  role: 'viewer' as GrantRole,
  org_id: '',
  team_id: '',
  project_id: '',
  sensitivity_categories: [] as string[],
};

function apiPath(apiBase: string | undefined, path: string): string {
  return `${apiBase ?? ''}${path}`;
}

export default function UsersAndRolesSettings({ apiBase = '' }: UsersAndRolesSettingsProps) {
  const [principals, setPrincipals] = useState<PrincipalRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [grantForm, setGrantForm] = useState(EMPTY_GRANT);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [confirmRevokeGrantId, setConfirmRevokeGrantId] = useState<string | null>(null);

  const selected = useMemo(
    () => principals.find((principal) => principal.id === selectedId) ?? null,
    [principals, selectedId],
  );

  const loadPrincipals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiPath(apiBase, '/api/admin/principals'), withApiToken());
      if (!res.ok) throw new Error(`Failed to load principals (${res.status})`);
      const body = await res.json() as { principals: PrincipalRecord[] };
      setPrincipals(body.principals);
      if (!selectedId && body.principals.length > 0) {
        setSelectedId(body.principals[0].id);
      }
    } catch (err) {
      setError(toErrorMessage(err, 'Failed to load users and roles.'));
    } finally {
      setLoading(false);
    }
  }, [apiBase, selectedId]);

  useEffect(() => {
    void loadPrincipals();
  }, [loadPrincipals]);

  const handleCreate = async () => {
    if (!form.display_name.trim()) {
      setError('Display name is required.');
      return;
    }
    const wasEmpty = principals.length === 0;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(apiPath(apiBase, '/api/admin/principals'), withApiToken({
        method: 'POST',
        headers: adminMutationHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          principal_type: form.principal_type,
          display_name: form.display_name.trim(),
          handle: form.handle.trim() || null,
          email: form.email.trim() || null,
        }),
      }));
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Create failed (${res.status})`);
      }
      const created = await res.json() as PrincipalRecord;
      if (wasEmpty) {
        persistAdminPrincipalId(created.id);
        const bootstrapRes = await fetch(apiPath(apiBase, `/api/admin/principals/${created.id}/grants`), withApiToken({
          method: 'POST',
          headers: adminMutationHeaders({ 'Content-Type': 'application/json' }, created.id),
          body: JSON.stringify({ role: 'admin' }),
        }));
        if (!bootstrapRes.ok) {
          const body = await bootstrapRes.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? `Bootstrap admin grant failed (${bootstrapRes.status})`);
        }
        await fetch(apiPath(apiBase, '/api/admin/settings/accessControl'), withApiToken({
          method: 'PATCH',
          headers: adminMutationHeaders({ 'Content-Type': 'application/json' }, created.id),
          body: JSON.stringify({ apiPrincipalId: created.id }),
        }));
        clearAdminRuntimeSettingsCache();
      }
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      setSelectedId(created.id);
      setSuccess(`Created ${created.display_name}.`);
      await loadPrincipals();
    } catch (err) {
      setError(toErrorMessage(err, 'Failed to create principal.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDisable = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(apiPath(apiBase, `/api/admin/principals/${selected.id}/disable`), withApiToken({
        method: 'POST',
        headers: adminMutationHeaders(),
      }));
      if (!res.ok) throw new Error(`Disable failed (${res.status})`);
      setConfirmDisable(false);
      setSuccess(`Disabled ${selected.display_name}.`);
      await loadPrincipals();
    } catch (err) {
      setError(toErrorMessage(err, 'Failed to disable principal.'));
    } finally {
      setSaving(false);
    }
  };

  const handleAddGrant = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(apiPath(apiBase, `/api/admin/principals/${selected.id}/grants`), withApiToken({
        method: 'POST',
        headers: adminMutationHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          role: grantForm.role,
          org_id: grantForm.org_id.trim() || null,
          team_id: grantForm.team_id.trim() || null,
          project_id: grantForm.project_id.trim() ? Number(grantForm.project_id) : null,
          sensitivity_categories: grantForm.sensitivity_categories,
        }),
      }));
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Grant create failed (${res.status})`);
      }
      setGrantForm(EMPTY_GRANT);
      setSuccess('Grant added.');
      await loadPrincipals();
    } catch (err) {
      setError(toErrorMessage(err, 'Failed to add grant.'));
    } finally {
      setSaving(false);
    }
  };

  const handleRevokeGrant = async (grantId: string) => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(apiPath(apiBase, `/api/admin/principals/${selected.id}/grants/${grantId}`), withApiToken({
        method: 'DELETE',
        headers: adminMutationHeaders(),
      }));
      if (!res.ok && res.status !== 204) throw new Error(`Revoke failed (${res.status})`);
      setConfirmRevokeGrantId(null);
      setSuccess('Grant revoked.');
      await loadPrincipals();
    } catch (err) {
      setError(toErrorMessage(err, 'Failed to revoke grant.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-[var(--text-primary)]">Users &amp; roles</div>
            <div className="text-xs text-[var(--text-muted)]">Principals and scoped grants</div>
          </div>
          <button
            type="button"
            className="mc-shell-btn px-2.5 py-1 text-xs"
            onClick={() => setCreateOpen((open) => !open)}
            aria-expanded={createOpen}
          >
            {createOpen ? 'Cancel' : 'Add user'}
          </button>
        </div>

        {createOpen && (
          <div className="mb-3 space-y-2 rounded-lg border border-[var(--border-primary)] p-3">
            <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
              <span>Type</span>
              <select
                value={form.principal_type}
                onChange={(event) => setForm((prev) => ({ ...prev, principal_type: event.target.value as PrincipalType }))}
                className="mc-shell-input px-2 py-1.5 text-sm"
              >
                {PRINCIPAL_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
              <span>Display name</span>
              <input
                value={form.display_name}
                onChange={(event) => setForm((prev) => ({ ...prev, display_name: event.target.value }))}
                className="mc-shell-input px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
              <span>Handle</span>
              <input
                value={form.handle}
                onChange={(event) => setForm((prev) => ({ ...prev, handle: event.target.value }))}
                className="mc-shell-input px-2 py-1.5 text-sm"
              />
            </label>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleCreate()}
              className="mc-shell-btn mc-shell-btn-active w-full px-3 py-1.5 text-xs"
            >
              Create principal
            </button>
          </div>
        )}

        {loading ? (
          <div className="text-xs text-[var(--text-muted)]">Loading principals…</div>
        ) : principals.length === 0 ? (
          <div className="text-xs text-[var(--text-muted)]">No principals yet.</div>
        ) : (
          <ul className="space-y-1">
            {principals.map((principal) => (
              <li key={principal.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(principal.id)}
                  className={`w-full rounded-lg px-2 py-2 text-left text-sm ${
                    selectedId === principal.id
                      ? 'bg-[var(--surface-accent)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                  }`}
                  aria-current={selectedId === principal.id ? 'true' : undefined}
                >
                  <div className="font-medium">{principal.display_name}</div>
                  <div className="text-[11px] text-[var(--text-muted)]">
                    {principal.principal_type} · {principal.status}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
        {!selected ? (
          <div className="text-sm text-[var(--text-muted)]">Select a principal to manage grants.</div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">{selected.display_name}</div>
                <div className="text-xs text-[var(--text-muted)]">
                  {selected.id} · {selected.principal_type} · {selected.status}
                </div>
              </div>
              {selected.status === 'active' && (
                <button
                  type="button"
                  className="mc-shell-btn px-3 py-1 text-xs text-[var(--error)]"
                  onClick={() => setConfirmDisable(true)}
                >
                  Disable
                </button>
              )}
            </div>

            {confirmDisable && (
              <div className="mb-4 rounded-lg border border-[var(--error)]/40 bg-[var(--bg-secondary)] p-3 text-xs">
                <p className="mb-2 text-[var(--text-primary)]">Disable {selected.display_name}? Stored grants remain but access fails closed.</p>
                <div className="flex gap-2">
                  <button type="button" className="mc-shell-btn px-2 py-1" onClick={() => setConfirmDisable(false)}>Cancel</button>
                  <button type="button" className="mc-shell-btn px-2 py-1 text-[var(--error)]" disabled={saving} onClick={() => void handleDisable()}>Confirm disable</button>
                </div>
              </div>
            )}

            <div className="mb-4">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Grants</div>
              {selected.grants.length === 0 ? (
                <div className="text-xs text-[var(--text-muted)]">No grants assigned.</div>
              ) : (
                <ul className="space-y-2">
                  {selected.grants.map((grant) => (
                    <li key={grant.id} className="rounded-lg border border-[var(--border-primary)] p-3 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-medium text-[var(--text-primary)]">{grant.role}</div>
                        {confirmRevokeGrantId === grant.id ? (
                          <div className="flex gap-2">
                            <button type="button" className="mc-shell-btn px-2 py-1" onClick={() => setConfirmRevokeGrantId(null)}>Cancel</button>
                            <button type="button" className="mc-shell-btn px-2 py-1 text-[var(--error)]" disabled={saving} onClick={() => void handleRevokeGrant(grant.id)}>Revoke</button>
                          </div>
                        ) : (
                          <button type="button" className="mc-shell-btn px-2 py-1 text-[var(--error)]" onClick={() => setConfirmRevokeGrantId(grant.id)}>Revoke</button>
                        )}
                      </div>
                      <div className="mt-1 text-[var(--text-muted)]">
                        {[
                          grant.org_id ? `org:${grant.org_id}` : null,
                          grant.team_id ? `team:${grant.team_id}` : null,
                          grant.project_id ? `project:${grant.project_id}` : null,
                        ].filter(Boolean).join(' · ') || 'global admin scope'}
                      </div>
                      {grant.sensitivity_categories.length > 0 && (
                        <div className="mt-1 text-[var(--text-muted)]">Sensitivity: {grant.sensitivity_categories.join(', ')}</div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {selected.status === 'active' && (
              <div className="space-y-2 rounded-lg border border-[var(--border-primary)] p-3">
                <div className="text-xs font-medium text-[var(--text-primary)]">Add grant</div>
                <div className="grid gap-2 md:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                    <span>Role</span>
                    <select
                      value={grantForm.role}
                      onChange={(event) => setGrantForm((prev) => ({ ...prev, role: event.target.value as GrantRole }))}
                      className="mc-shell-input px-2 py-1.5 text-sm"
                    >
                      {GRANT_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                    <span>Org ID</span>
                    <input value={grantForm.org_id} onChange={(event) => setGrantForm((prev) => ({ ...prev, org_id: event.target.value }))} className="mc-shell-input px-2 py-1.5 text-sm" />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                    <span>Team ID</span>
                    <input value={grantForm.team_id} onChange={(event) => setGrantForm((prev) => ({ ...prev, team_id: event.target.value }))} className="mc-shell-input px-2 py-1.5 text-sm" />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                    <span>Project ID</span>
                    <input value={grantForm.project_id} onChange={(event) => setGrantForm((prev) => ({ ...prev, project_id: event.target.value }))} className="mc-shell-input px-2 py-1.5 text-sm" />
                  </label>
                </div>
                <fieldset className="space-y-1">
                  <legend className="text-xs text-[var(--text-muted)]">Sensitivity categories</legend>
                  <div className="flex flex-wrap gap-2">
                    {SENSITIVITY_OPTIONS.map((category) => {
                      const checked = grantForm.sensitivity_categories.includes(category);
                      return (
                        <label key={category} className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setGrantForm((prev) => ({
                              ...prev,
                              sensitivity_categories: checked
                                ? prev.sensitivity_categories.filter((entry) => entry !== category)
                                : [...prev.sensitivity_categories, category],
                            }))}
                          />
                          <span>{category}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <button type="button" disabled={saving} onClick={() => void handleAddGrant()} className="mc-shell-btn mc-shell-btn-active px-3 py-1.5 text-xs">Add grant</button>
              </div>
            )}
          </>
        )}

        {error && <div className="mt-3 text-xs text-[var(--error)]" role="alert">{error}</div>}
        {success && <div className="mt-3 text-xs text-[var(--accent)]" role="status">{success}</div>}
      </div>
    </div>
  );
}
