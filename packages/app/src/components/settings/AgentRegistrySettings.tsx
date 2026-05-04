import { useEffect, useMemo, useState, type FormEvent } from 'react';

interface RegistryAgent {
  id: string;
  slug: string;
  name: string;
  emoji: string;
  avatar_url: string | null;
  description: string | null;
  adapter_type: string | null;
  runtime_type: string | null;
  status: string;
  instructions_path: string | null;
  metadata_json: string;
  capabilities?: {
    runtimeLabel?: string;
    ownerLabel?: string;
    verificationLabel?: string;
    capabilityLabels?: string[];
    permissionLabels?: string[];
  };
}

interface ModuleRecord {
  id: string;
  slug: string;
  name: string;
  permissions_schema_json: string;
}

interface GrantRecord {
  module_id: string;
  enabled: boolean;
  permissions_json: string;
  scope_json: string;
}

interface AgentRegistrySettingsProps {
  apiBase?: string;
  onRegistryChanged?: () => void;
}

const EMPTY_AGENT = {
  slug: '',
  name: '',
  emoji: '🤖',
  avatar_url: '',
  description: '',
  adapter_type: '',
  runtime_type: '',
  status: 'active',
  metadata_json: '{}',
};

function apiPath(apiBase: string | undefined, path: string): string {
  return `${apiBase ?? ''}${path}`;
}

function parsePermissions(module: ModuleRecord): string[] {
  try {
    const parsed = JSON.parse(module.permissions_schema_json || '[]');
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

export default function AgentRegistrySettings({ apiBase, onRegistryChanged }: AgentRegistrySettingsProps) {
  const [agents, setAgents] = useState<RegistryAgent[]>([]);
  const [modules, setModules] = useState<ModuleRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [grants, setGrants] = useState<GrantRecord[]>([]);
  const [form, setForm] = useState(EMPTY_AGENT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedId || agent.slug === selectedId) ?? null,
    [agents, selectedId],
  );

  const grantByModule = useMemo(() => {
    const map = new Map<string, GrantRecord>();
    for (const grant of grants) map.set(grant.module_id, grant);
    return map;
  }, [grants]);

  const loadRegistry = async () => {
    setLoading(true);
    setError(null);
    try {
      const [agentsRes, modulesRes] = await Promise.all([
        fetch(apiPath(apiBase, '/api/agents/registry')),
        fetch(apiPath(apiBase, '/api/modules')),
      ]);
      if (!agentsRes.ok) throw new Error(`agents ${agentsRes.status}`);
      if (!modulesRes.ok) throw new Error(`modules ${modulesRes.status}`);
      const agentsJson = await agentsRes.json() as { list?: RegistryAgent[] };
      const modulesJson = await modulesRes.json() as { list?: ModuleRecord[] };
      setAgents(agentsJson.list ?? []);
      setModules(modulesJson.list ?? []);
      if (!selectedId && agentsJson.list?.length) setSelectedId(agentsJson.list[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load agent registry');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRegistry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);

  useEffect(() => {
    if (!selectedAgent) {
      setGrants([]);
      setForm(EMPTY_AGENT);
      return;
    }
    setForm({
      slug: selectedAgent.slug,
      name: selectedAgent.name,
      emoji: selectedAgent.emoji || '🤖',
      avatar_url: selectedAgent.avatar_url ?? '',
      description: selectedAgent.description ?? '',
      adapter_type: selectedAgent.adapter_type ?? '',
      runtime_type: selectedAgent.runtime_type ?? '',
      status: selectedAgent.status || 'active',
      metadata_json: selectedAgent.metadata_json || '{}',
    });
    fetch(apiPath(apiBase, `/api/agents/${encodeURIComponent(selectedAgent.id)}/grants`))
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`grants ${res.status}`))))
      .then((json: { grants?: GrantRecord[] }) => setGrants(json.grants ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : 'Unable to load grants'));
  }, [apiBase, selectedAgent]);

  const saveAgent = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      JSON.parse(form.metadata_json || '{}');
      const payload = {
        slug: form.slug,
        name: form.name,
        emoji: form.emoji || '🤖',
        avatar_url: form.avatar_url || null,
        description: form.description || null,
        adapter_type: form.adapter_type || null,
        runtime_type: form.runtime_type || null,
        status: form.status || 'active',
        metadata_json: form.metadata_json || '{}',
      };
      const url = selectedAgent
        ? apiPath(apiBase, `/api/agents/${encodeURIComponent(selectedAgent.id)}`)
        : apiPath(apiBase, '/api/agents');
      const res = await fetch(url, {
        method: selectedAgent ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `save ${res.status}`);
      }
      const json = await res.json() as { agent: RegistryAgent };
      setSelectedId(json.agent.id);
      await loadRegistry();
      onRegistryChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save agent');
    } finally {
      setSaving(false);
    }
  };

  const disableAgent = async () => {
    if (!selectedAgent) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(apiPath(apiBase, `/api/agents/${encodeURIComponent(selectedAgent.id)}`), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'disabled' }),
      });
      if (!res.ok) throw new Error(`disable ${res.status}`);
      const json = await res.json() as { agent: RegistryAgent };
      setSelectedId(json.agent.id);
      await loadRegistry();
      onRegistryChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to disable agent');
    } finally {
      setSaving(false);
    }
  };

  const deleteAgent = async () => {
    if (!selectedAgent) return;
    const confirmed = window.confirm(`Permanently delete ${selectedAgent.name} from the registry? Disable instead if you want to preserve the record.`);
    if (!confirmed) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(apiPath(apiBase, `/api/agents/${encodeURIComponent(selectedAgent.id)}`), { method: 'DELETE' });
      if (!res.ok) throw new Error(`delete ${res.status}`);
      setSelectedId(null);
      setForm(EMPTY_AGENT);
      setGrants([]);
      await loadRegistry();
      onRegistryChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete agent');
    } finally {
      setSaving(false);
    }
  };

  const toggleGrant = async (module: ModuleRecord, enabled: boolean) => {
    if (!selectedAgent) return;
    setError(null);
    const existing = grantByModule.get(module.id);
    try {
      const res = enabled
        ? await fetch(apiPath(apiBase, `/api/agents/${encodeURIComponent(selectedAgent.id)}/grants/${encodeURIComponent(module.id)}`), {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled: true, permissions: existing ? parseJsonArray(existing.permissions_json) : ['read'], scope: {} }),
          })
        : await fetch(apiPath(apiBase, `/api/agents/${encodeURIComponent(selectedAgent.id)}/grants/${encodeURIComponent(module.id)}`), { method: 'DELETE' });
      if (!res.ok) throw new Error(`grant ${res.status}`);
      const grantsRes = await fetch(apiPath(apiBase, `/api/agents/${encodeURIComponent(selectedAgent.id)}/grants`));
      const json = await grantsRes.json() as { grants?: GrantRecord[] };
      setGrants(json.grants ?? []);
      await loadRegistry();
      onRegistryChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update grant');
    }
  };

  const updateGrantPermissions = async (module: ModuleRecord, permissions: string[]) => {
    if (!selectedAgent) return;
    const res = await fetch(apiPath(apiBase, `/api/agents/${encodeURIComponent(selectedAgent.id)}/grants/${encodeURIComponent(module.id)}`), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true, permissions, scope: {} }),
    });
    if (!res.ok) {
      setError(`Unable to update ${module.name} permissions`);
      return;
    }
    const grantsRes = await fetch(apiPath(apiBase, `/api/agents/${encodeURIComponent(selectedAgent.id)}/grants`));
    const json = await grantsRes.json() as { grants?: GrantRecord[] };
    setGrants(json.grants ?? []);
    await loadRegistry();
    onRegistryChanged?.();
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="mc-shell-card border border-[var(--border-secondary)] p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-[var(--text-primary)]">Agents</div>
            <div className="text-xs text-[var(--text-muted)]">Registry-backed crew entries</div>
          </div>
          <button type="button" className="mc-shell-btn px-2 py-1 text-xs" onClick={() => { setSelectedId(null); setForm(EMPTY_AGENT); setGrants([]); }}>
            Add
          </button>
        </div>
        {loading && <div className="text-xs text-[var(--text-muted)]">Loading registry…</div>}
        <div className="space-y-1">
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => setSelectedId(agent.id)}
              className={`w-full rounded border px-2 py-2 text-left ${selectedAgent?.id === agent.id ? 'border-[var(--accent)] bg-[var(--bg-tertiary)]' : 'border-[var(--border-secondary)] hover:bg-[var(--bg-tertiary)]'}`}
            >
              <div className="flex items-center gap-2">
                <span>{agent.emoji || '🤖'}</span>
                <span className="truncate text-sm text-[var(--text-primary)]">{agent.name}</span>
                <span className="ml-auto text-[10px] text-[var(--text-muted)]">{agent.status}</span>
              </div>
              <div className="mt-1 truncate text-[11px] text-[var(--text-muted)]">{agent.capabilities?.runtimeLabel || `${agent.adapter_type ?? 'registry'} · ${agent.runtime_type ?? 'unknown'}`}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-[var(--text-primary)]">{selectedAgent ? 'Edit agent' : 'Add agent'}</div>
            <div className="text-xs text-[var(--text-muted)]">Identity, runtime metadata, and module scopes. Disable preserves the record; delete removes it from the registry.</div>
          </div>
          {selectedAgent && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="mc-shell-btn px-3 py-1 text-xs" onClick={() => void disableAgent()} disabled={saving || selectedAgent.status === 'disabled'}>
                Disable
              </button>
              <button type="button" className="mc-shell-btn px-3 py-1 text-xs text-[var(--error)]" onClick={() => void deleteAgent()} disabled={saving}>
                Delete
              </button>
            </div>
          )}
        </div>

        {error && <div className="mb-3 rounded border border-[var(--error)] px-3 py-2 text-xs text-[var(--error)]">{error}</div>}

        <form onSubmit={saveAgent} className="grid gap-3 md:grid-cols-2">
          <label className="text-xs text-[var(--text-muted)]">Slug<input className="mt-1 w-full rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-2 py-1.5 text-sm text-[var(--text-primary)]" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} required /></label>
          <label className="text-xs text-[var(--text-muted)]">Name<input className="mt-1 w-full rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-2 py-1.5 text-sm text-[var(--text-primary)]" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
          <label className="text-xs text-[var(--text-muted)]">Emoji<input className="mt-1 w-full rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-2 py-1.5 text-sm text-[var(--text-primary)]" value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} /></label>
          <label className="text-xs text-[var(--text-muted)]">Status<select className="mt-1 w-full rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-2 py-1.5 text-sm text-[var(--text-primary)]" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{['active', 'idle', 'disabled', 'template', 'archived'].map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
          <label className="text-xs text-[var(--text-muted)]">Adapter<input className="mt-1 w-full rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-2 py-1.5 text-sm text-[var(--text-primary)]" value={form.adapter_type} onChange={(e) => setForm({ ...form, adapter_type: e.target.value })} placeholder="openclaw / hermes / codex" /></label>
          <label className="text-xs text-[var(--text-muted)]">Runtime<input className="mt-1 w-full rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-2 py-1.5 text-sm text-[var(--text-primary)]" value={form.runtime_type} onChange={(e) => setForm({ ...form, runtime_type: e.target.value })} placeholder="remote / local / mac" /></label>
          <label className="text-xs text-[var(--text-muted)] md:col-span-2">Avatar URL<input className="mt-1 w-full rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-2 py-1.5 text-sm text-[var(--text-primary)]" value={form.avatar_url} onChange={(e) => setForm({ ...form, avatar_url: e.target.value })} placeholder="/agent-avatars/name.png" /></label>
          <label className="text-xs text-[var(--text-muted)] md:col-span-2">Description<textarea className="mt-1 min-h-16 w-full rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-2 py-1.5 text-sm text-[var(--text-primary)]" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <label className="text-xs text-[var(--text-muted)] md:col-span-2">Metadata JSON<textarea className="mt-1 min-h-20 w-full font-mono rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs text-[var(--text-primary)]" value={form.metadata_json} onChange={(e) => setForm({ ...form, metadata_json: e.target.value })} /></label>
          <div className="md:col-span-2 flex justify-end">
            <button type="submit" className="mc-shell-btn mc-shell-btn-active border-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)]" disabled={saving}>{saving ? 'Saving…' : 'Save agent'}</button>
          </div>
        </form>

        <div className="mt-5 border-t border-[var(--border-secondary)] pt-4">
          <div className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Module scopes</div>
          {!selectedAgent && <div className="text-xs text-[var(--text-muted)]">Save the agent first, then assign scopes.</div>}
          {selectedAgent && (
            <div className="grid gap-2 md:grid-cols-2">
              {modules.map((module) => {
                const grant = grantByModule.get(module.id);
                const selectedPermissions = grant ? parseJsonArray(grant.permissions_json) : [];
                const available = parsePermissions(module);
                return (
                  <div key={module.id} className="rounded border border-[var(--border-secondary)] p-3">
                    <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                      <input type="checkbox" checked={Boolean(grant)} onChange={(e) => void toggleGrant(module, e.target.checked)} />
                      <span>{module.name}</span>
                    </label>
                    {grant && available.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {available.map((permission) => (
                          <label key={permission} className="entity-ops-chip cursor-pointer px-1.5 py-0.5 text-[10px]">
                            <input
                              type="checkbox"
                              className="mr-1"
                              checked={selectedPermissions.includes(permission)}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? Array.from(new Set([...selectedPermissions, permission]))
                                  : selectedPermissions.filter((entry) => entry !== permission);
                                void updateGrantPermissions(module, next);
                              }}
                            />
                            {permission}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
