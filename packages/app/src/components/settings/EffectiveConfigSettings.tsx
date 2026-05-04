import { useCallback, useEffect, useMemo, useState } from 'react';
import { toErrorMessage } from '../../lib/http';

interface SourceMetadata {
  source: string;
  editableInUi: boolean;
  secret: boolean;
  sensitive: boolean;
  adminOnly: boolean;
  advanced: boolean;
  requiresRestart: boolean;
  overriddenBy: string | null;
}

interface EffectiveConfigResponse {
  version: number;
  settings: {
    profile?: {
      displayName?: string;
      ownerName?: string;
    };
    server?: {
      host?: string;
      port?: number;
      workspaceRoot?: string;
      publicBaseUrl?: string;
      apiBaseUrl?: string;
      wsBaseUrl?: string;
      databasePath?: string;
    };
    docs?: {
      allowedExtensions?: string[];
    };
    agents?: Array<{ id: string; name: string; enabled?: boolean; role?: string }>;
    tasks?: {
      defaultAssignee?: string;
      assigneesFromAgents?: boolean;
    };
    fileSources?: Array<{ id: string; displayName: string; enabled?: boolean }>;
    services?: Array<{ id: string; name: string; enabled?: boolean }>;
  };
  sources: Record<string, SourceMetadata>;
  files: {
    configPath: string;
    profilePath: string | null;
  };
  warnings: string[];
}

interface EffectiveConfigSettingsProps {
  apiBase?: string;
}

function sourceBadge(source?: SourceMetadata) {
  if (!source) return 'unknown';
  const suffix = source.requiresRestart ? ' · restart' : '';
  return `${source.source}${suffix}`;
}

export default function EffectiveConfigSettings({ apiBase = '' }: EffectiveConfigSettingsProps) {
  const [config, setConfig] = useState<EffectiveConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [publicBaseUrl, setPublicBaseUrl] = useState('');
  const [defaultAssignee, setDefaultAssignee] = useState('');

  const base = apiBase.replace(/\/$/, '');

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${base}/api/config/effective`);
      if (!res.ok) throw new Error(`Failed to load effective config: ${res.status}`);
      const data = (await res.json()) as EffectiveConfigResponse;
      setConfig(data);
      setDisplayName(data.settings.profile?.displayName ?? '');
      setOwnerName(data.settings.profile?.ownerName ?? '');
      setPublicBaseUrl(data.settings.server?.publicBaseUrl ?? '');
      setDefaultAssignee(data.settings.tasks?.defaultAssignee ?? 'assistant');
    } catch (err) {
      setError(toErrorMessage(err, 'Failed to load effective config.'));
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const changed = useMemo(() => {
    return (
      displayName !== (config?.settings.profile?.displayName ?? '') ||
      ownerName !== (config?.settings.profile?.ownerName ?? '') ||
      publicBaseUrl !== (config?.settings.server?.publicBaseUrl ?? '') ||
      defaultAssignee !== (config?.settings.tasks?.defaultAssignee ?? 'assistant')
    );
  }, [config?.settings.profile?.displayName, config?.settings.profile?.ownerName, config?.settings.server?.publicBaseUrl, config?.settings.tasks?.defaultAssignee, defaultAssignee, displayName, ownerName, publicBaseUrl]);

  const handleSaveProfile = async () => {
    const trimmedPublicUrl = publicBaseUrl.trim();
    if (trimmedPublicUrl) {
      try {
        const parsed = new URL(trimmedPublicUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid protocol');
      } catch {
        setError('Public URL must be a valid http:// or https:// URL.');
        return;
      }
    }

    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      const res = await fetch(`${base}/api/settings/config/runtime`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: {
            displayName: displayName.trim() || 'Entity Workspace',
            ownerName: ownerName.trim() || 'Local User',
          },
          server: {
            publicBaseUrl: trimmedPublicUrl || 'http://localhost:3000',
          },
          tasks: {
            defaultAssignee: defaultAssignee.trim() || 'assistant',
          },
        }),
      });
      if (!res.ok) throw new Error(`Failed to save workspace profile: ${res.status}`);
      const data = (await res.json()) as EffectiveConfigResponse;
      setConfig(data);
      setDisplayName(data.settings.profile?.displayName ?? '');
      setOwnerName(data.settings.profile?.ownerName ?? '');
      setPublicBaseUrl(data.settings.server?.publicBaseUrl ?? '');
      setDefaultAssignee(data.settings.tasks?.defaultAssignee ?? 'assistant');
      setSavedMessage('Workspace profile, public URL, and default assignee saved to DB-backed runtime settings.');
    } catch (err) {
      setError(toErrorMessage(err, 'Failed to save workspace profile.'));
    } finally {
      setSaving(false);
    }
  };

  const agentCount = config?.settings.agents?.length ?? 0;
  const sourceCount = config?.settings.fileSources?.length ?? 0;
  const serviceCount = config?.settings.services?.length ?? 0;
  const allowedExtensions = config?.settings.docs?.allowedExtensions ?? [];

  return (
    <section className="mc-shell-card border border-[var(--border-secondary)] p-4" aria-labelledby="effective-config-heading">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div id="effective-config-heading" className="text-sm font-medium text-[var(--text-primary)]">Effective Entity Config</div>
          <div className="text-xs text-[var(--text-muted)]">Shows resolved settings, their source, and safe DB-backed runtime edit paths.</div>
        </div>
        <button type="button" onClick={() => void loadConfig()} className="mc-shell-btn px-3 py-1 text-xs" disabled={loading || saving}>
          Refresh
        </button>
      </div>

      {loading && <div className="text-xs text-[var(--text-muted)]">Loading effective config…</div>}
      {error && <div className="mb-3 rounded border border-[var(--error)]/40 bg-[var(--error)]/10 p-2 text-xs text-[var(--error)]">{error}</div>}
      {savedMessage && <div className="mb-3 rounded border border-[var(--accent)]/40 bg-[var(--accent-dim)] p-2 text-xs text-[var(--text-primary)]">{savedMessage}</div>}

      {config && (
        <div className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-4">
            <label className="grid gap-1 text-xs text-[var(--text-secondary)]">
              <span>Workspace display name</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="mc-shell-input px-3 py-2 text-sm"
                aria-label="Workspace display name"
              />
              <span className="text-[10px] text-[var(--text-muted)]">source: {sourceBadge(config.sources['profile.displayName'])}</span>
            </label>
            <label className="grid gap-1 text-xs text-[var(--text-secondary)]">
              <span>Workspace owner</span>
              <input
                value={ownerName}
                onChange={(event) => setOwnerName(event.target.value)}
                className="mc-shell-input px-3 py-2 text-sm"
                aria-label="Workspace owner"
              />
              <span className="text-[10px] text-[var(--text-muted)]">source: {sourceBadge(config.sources['profile.ownerName'])}</span>
            </label>
            <label className="grid gap-1 text-xs text-[var(--text-secondary)]">
              <span>Public URL</span>
              <input
                value={publicBaseUrl}
                onChange={(event) => setPublicBaseUrl(event.target.value)}
                className="mc-shell-input px-3 py-2 text-sm"
                aria-label="Public URL"
                placeholder="https://entity.example.com"
              />
              <span className="text-[10px] text-[var(--text-muted)]">source: {sourceBadge(config.sources['server.publicBaseUrl'])}</span>
            </label>
            <label className="grid gap-1 text-xs text-[var(--text-secondary)]">
              <span>Default assignee</span>
              <input
                list="effective-config-agent-options"
                value={defaultAssignee}
                onChange={(event) => setDefaultAssignee(event.target.value)}
                className="mc-shell-input px-3 py-2 text-sm"
                aria-label="Default assignee"
                placeholder="assistant"
              />
              <datalist id="effective-config-agent-options">
                {(config.settings.agents ?? []).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </datalist>
              <span className="text-[10px] text-[var(--text-muted)]">source: {sourceBadge(config.sources['tasks.defaultAssignee'])}</span>
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => void loadConfig()} className="mc-shell-btn px-3 py-1.5 text-xs" disabled={loading || saving}>
              Reset
            </button>
            <button
              type="button"
              onClick={() => void handleSaveProfile()}
              className="mc-shell-btn mc-shell-btn-active border-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)]"
              disabled={!changed || saving}
            >
              {saving ? 'Saving…' : 'Save runtime settings'}
            </button>
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            <div className="rounded border border-[var(--border-primary)] p-3 text-xs">
              <div className="text-[var(--text-muted)]">Workspace root</div>
              <div className="mt-1 break-all font-mono text-[11px] text-[var(--text-primary)]">{config.settings.server?.workspaceRoot ?? 'unset'}</div>
              <div className="mt-1 text-[10px] text-[var(--text-muted)]">source: {sourceBadge(config.sources['server.workspaceRoot'])}</div>
            </div>
            <div className="rounded border border-[var(--border-primary)] p-3 text-xs">
              <div className="text-[var(--text-muted)]">Public URL</div>
              <div className="mt-1 break-all font-mono text-[11px] text-[var(--text-primary)]">{config.settings.server?.publicBaseUrl ?? 'unset'}</div>
              <div className="mt-1 text-[10px] text-[var(--text-muted)]">source: {sourceBadge(config.sources['server.publicBaseUrl'])}</div>
            </div>
            <div className="rounded border border-[var(--border-primary)] p-3 text-xs">
              <div className="text-[var(--text-muted)]">Default assignee</div>
              <div className="mt-1 break-all font-mono text-[11px] text-[var(--text-primary)]">{config.settings.tasks?.defaultAssignee ?? 'assistant'}</div>
              <div className="mt-1 text-[10px] text-[var(--text-muted)]">source: {sourceBadge(config.sources['tasks.defaultAssignee'])}</div>
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-4">
            <div className="rounded border border-[var(--border-primary)] p-3 text-xs"><span className="text-[var(--text-muted)]">Agents</span><div className="mt-1 text-lg text-[var(--text-primary)]">{agentCount}</div><div className="mt-1 line-clamp-2 text-[10px] text-[var(--text-muted)]">{(config.settings.agents ?? []).map((agent) => `${agent.name} (${agent.id})`).join(', ') || 'none'}</div></div>
            <div className="rounded border border-[var(--border-primary)] p-3 text-xs"><span className="text-[var(--text-muted)]">File sources</span><div className="mt-1 text-lg text-[var(--text-primary)]">{sourceCount}</div></div>
            <div className="rounded border border-[var(--border-primary)] p-3 text-xs"><span className="text-[var(--text-muted)]">Services</span><div className="mt-1 text-lg text-[var(--text-primary)]">{serviceCount}</div></div>
            <div className="rounded border border-[var(--border-primary)] p-3 text-xs"><span className="text-[var(--text-muted)]">Doc extensions</span><div className="mt-1 text-[11px] text-[var(--text-primary)]">{allowedExtensions.join(', ')}</div></div>
          </div>

          {config.warnings.length > 0 && (
            <div className="rounded border border-[var(--warning)]/40 p-3 text-xs text-[var(--text-secondary)]">
              <div className="mb-1 font-medium text-[var(--text-primary)]">Config warnings</div>
              <ul className="list-disc pl-4">
                {config.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
