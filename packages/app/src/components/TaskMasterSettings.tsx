import { useCallback, useEffect, useState } from 'react';

interface AgentStatus {
  lastRun: string | null;
  totalActions: number;
  provider: string;
  model: string;
  enabled: boolean;
  apiKeyConfigured: boolean;
  apiKeySource: 'database' | 'env' | 'none';
}

interface AgentLog {
  timestamp: string;
  event: string;
  taskId: number | null;
  taskName: string | null;
  taskAssignee: string | null;
  action: string;
  result: string | null;
  model: string;
  tokensUsed: number;
}

interface TaskMasterSettingsProps {
  apiBase: string;
}

interface TaskAgentProviderOption {
  id: string;
  label: string;
  keyLabel: string;
  envKeys: string[];
  models: Array<{ id: string; label: string }>;
  supportsBaseUrl?: boolean;
  baseUrlPlaceholder?: string;
}

interface TaskAgentSettings {
  provider: string;
  model: string;
  apiKeyConfigured: boolean;
  apiKeySource: 'database' | 'env' | 'none';
  baseUrl?: string | null;
  baseUrlSource?: string;
  supportsBaseUrl?: boolean;
  staleThresholdHours: {
    doing: number;
    review: number;
  };
  maxActionsPerScan: number;
  providers: TaskAgentProviderOption[];
}

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const EVENT_STYLES: Record<string, { bg: string; text: string }> = {
  review_check: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  stale_scan: { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  manual: { bg: 'bg-purple-500/20', text: 'text-purple-400' },
};

const ACTION_LABELS: Record<string, string> = {
  notify_assignee: '📩 Notified assignee',
  escalate_blocker: '🚨 Escalated blocker',
  validate_output: '🔍 Validated output',
  move_to_done: '✅ Moved to done',
  request_fix: '🔧 Requested fix',
  add_comment: '💬 Added comment',
};

export default function TaskMasterSettings({ apiBase }: TaskMasterSettingsProps) {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [settings, setSettings] = useState<TaskAgentSettings | null>(null);
  const [draftProvider, setDraftProvider] = useState('');
  const [draftModel, setDraftModel] = useState('');
  const [draftApiKey, setDraftApiKey] = useState('');
  const [draftBaseUrl, setDraftBaseUrl] = useState('');
  const [clearBaseUrl, setClearBaseUrl] = useState(false);
  const [draftDoingThreshold, setDraftDoingThreshold] = useState(24);
  const [draftReviewThreshold, setDraftReviewThreshold] = useState(48);
  const [draftMaxActions, setDraftMaxActions] = useState(10);
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [triggerResult, setTriggerResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedLog, setExpandedLog] = useState<number | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/agent/status`);
      if (res.ok) setStatus(await res.json());
    } catch { /* ignore */ }
  }, [apiBase]);

  const applySettings = useCallback((next: TaskAgentSettings) => {
    setSettings(next);
    setDraftProvider(next.provider);
    setDraftModel(next.model);
    setDraftApiKey('');
    setDraftBaseUrl(next.baseUrl ?? '');
    setClearBaseUrl(false);
    setDraftDoingThreshold(next.staleThresholdHours.doing);
    setDraftReviewThreshold(next.staleThresholdHours.review);
    setDraftMaxActions(next.maxActionsPerScan);
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/agent/settings`);
      if (res.ok) applySettings(await res.json());
    } catch { /* ignore */ }
  }, [apiBase, applySettings]);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/agent/log?limit=30`);
      if (res.ok) {
        const data = await res.json();
        setLogs(Array.isArray(data) ? data : data.entries ?? []);
      }
    } catch { /* ignore */ }
  }, [apiBase]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchStatus(), fetchSettings(), fetchLogs()]).finally(() => setLoading(false));
  }, [fetchStatus, fetchSettings, fetchLogs]);

  const selectedProvider = settings?.providers.find((provider) => provider.id === draftProvider)
    ?? settings?.providers[0]
    ?? null;

  const saveSettings = async (clearApiKey = false) => {
    setSaving(true);
    setTriggerResult(null);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/agent/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: draftProvider,
          model: draftModel,
          apiKey: draftApiKey,
          clearApiKey,
          ...(selectedProvider?.supportsBaseUrl ? { baseUrl: draftBaseUrl, clearBaseUrl } : {}),
          staleThresholdHours: {
            doing: draftDoingThreshold,
            review: draftReviewThreshold,
          },
          maxActionsPerScan: draftMaxActions,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        applySettings(data);
        await fetchStatus();
        setTriggerResult('Task Master settings saved.');
      } else {
        setError(data.error ?? 'Settings save failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const trigger = async (event: string) => {
    setTriggering(true);
    setTriggerResult(null);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/agent/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event }),
      });
      const data = await res.json();
      if (res.ok) {
        setTriggerResult(`${data.actions?.length ?? 0} actions — ${data.summary ?? 'done'}`);
        await fetchStatus();
        await fetchLogs();
      } else {
        setError(data.error ?? 'Trigger failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setTriggering(false);
    }
  };

  if (loading) {
    return <div className="p-4 text-xs text-[var(--text-muted)]">Loading Task Master status...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Status Card */}
      <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">⚡ Task Master</h3>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            status?.enabled ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
          }`}>
            {status?.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Provider</div>
            <div className="mt-1 text-sm text-[var(--text-primary)]">
              {settings?.providers.find((provider) => provider.id === status?.provider)?.label ?? status?.provider ?? '—'}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Model</div>
            <div className="mt-1 text-sm text-[var(--text-primary)]">{status?.model ?? '—'}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Total Actions</div>
            <div className="mt-1 text-sm text-[var(--text-primary)]">{status?.totalActions ?? 0}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Last Run</div>
            <div className="mt-1 text-sm text-[var(--text-primary)]">
              {status?.lastRun ? timeAgo(status.lastRun) : 'Never'}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">API Key</div>
            <div className="mt-1 text-sm text-[var(--text-primary)]">
              {status?.apiKeyConfigured ? `Set (${status.apiKeySource})` : 'Missing'}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Stale Thresholds</div>
            <div className="mt-1 text-sm text-[var(--text-primary)]">
              {settings ? `${settings.staleThresholdHours.doing}h / ${settings.staleThresholdHours.review}h` : '—'}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Max Scan Actions</div>
            <div className="mt-1 text-sm text-[var(--text-primary)]">{settings?.maxActionsPerScan ?? '—'}</div>
          </div>
        </div>
      </div>

      <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-[var(--text-primary)]">Review and Human Gate Policy</h3>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Task detail uses these states to decide what review controls are visible.
            </p>
          </div>
          <span className="rounded-full border border-[var(--accent)]/25 bg-[var(--surface-accent)] px-2 py-0.5 text-[11px] text-[var(--accent)]">
            Policy-backed
          </span>
        </div>
        <div className="grid gap-2 text-xs text-[var(--text-secondary)] md:grid-cols-2">
          <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Resolver</div>
            <p className="mt-1">
              Workspace, org, team, task, risk, agent-trust, and external-side-effect inputs produce a reason chain.
            </p>
          </div>
          <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Separation of duties</div>
            <p className="mt-1">
              Eligible review controls stay hidden when the current profile is the wrong reviewer or approver.
            </p>
          </div>
          <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Human gate</div>
            <p className="mt-1">
              Human approval is tracked separately from review and must approve before required work can move to done.
            </p>
          </div>
          <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Override audit</div>
            <p className="mt-1">
              Any override metadata is surfaced as audit context, not hidden inside raw task JSON.
            </p>
          </div>
        </div>
      </div>

      {/* Trigger Controls */}
      <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
        <h3 className="mb-3 text-sm font-medium text-[var(--text-primary)]">Manual Trigger</h3>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => trigger('manual')} disabled={triggering || !status?.enabled}
            className={`mc-shell-btn px-3 py-1.5 text-xs font-medium ${triggering ? 'opacity-50' : ''}`}>
            {triggering ? 'Running...' : '▶ Run All Checks'}
          </button>
          <button type="button" onClick={() => trigger('review_check')} disabled={triggering || !status?.enabled}
            className={`mc-shell-btn px-3 py-1.5 text-xs ${triggering ? 'opacity-50' : ''}`}>
            Review Check
          </button>
          <button type="button" onClick={() => trigger('stale_scan')} disabled={triggering || !status?.enabled}
            className={`mc-shell-btn px-3 py-1.5 text-xs ${triggering ? 'opacity-50' : ''}`}>
            Stale Scan
          </button>
        </div>
        {triggerResult && (
          <div className="mt-2 rounded bg-green-500/10 px-3 py-2 text-xs text-green-400">{triggerResult}</div>
        )}
        {error && (
          <div className="mt-2 rounded bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>
        )}
      </div>

      {/* Configuration */}
      <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">Model Provider</h3>
          <span className="text-[11px] text-[var(--text-muted)]">
            {settings?.apiKeyConfigured ? `Key set from ${settings.apiKeySource}` : 'No key configured'}
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-xs text-[var(--text-secondary)]">
            <span className="mb-1 block text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Provider</span>
            <select
              value={draftProvider}
              onChange={(event) => {
                const nextProvider = event.target.value;
                const provider = settings?.providers.find((item) => item.id === nextProvider);
                setDraftProvider(nextProvider);
                setDraftModel(provider?.models[0]?.id ?? '');
              }}
              className="mc-shell-input w-full px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              {settings?.providers.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.label}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-[var(--text-secondary)]">
            <span className="mb-1 block text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Model</span>
            <select
              value={draftModel}
              onChange={(event) => setDraftModel(event.target.value)}
              className="mc-shell-input w-full px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              {selectedProvider && !selectedProvider.models.some((model) => model.id === draftModel) && draftModel && (
                <option value={draftModel}>{draftModel}</option>
              )}
              {selectedProvider?.models.map((model) => (
                <option key={model.id} value={model.id}>{model.label}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-[var(--text-secondary)] md:col-span-2">
            <span className="mb-1 block text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Custom model ID</span>
            <input
              value={draftModel}
              onChange={(event) => setDraftModel(event.target.value)}
              className="mc-shell-input w-full px-3 py-2 text-sm text-[var(--text-primary)]"
              placeholder="provider/model-id"
            />
          </label>
          <label className="block text-xs text-[var(--text-secondary)] md:col-span-2">
            <span className="mb-1 block text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
              {selectedProvider?.keyLabel ?? 'API key'}
            </span>
            <input
              type="password"
              value={draftApiKey}
              onChange={(event) => setDraftApiKey(event.target.value)}
              className="mc-shell-input w-full px-3 py-2 text-sm text-[var(--text-primary)]"
              placeholder={settings?.apiKeyConfigured ? 'Stored key is hidden. Enter a new key to replace it.' : 'Paste API key'}
              autoComplete="off"
            />
          </label>
          {selectedProvider?.supportsBaseUrl && (
            <div className="md:col-span-2">
              <label className="block text-xs text-[var(--text-secondary)]">
                <span className="mb-1 block text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Base URL</span>
                <input
                  value={draftBaseUrl}
                  onChange={(event) => {
                    setDraftBaseUrl(event.target.value);
                    setClearBaseUrl(false);
                  }}
                  className="mc-shell-input w-full px-3 py-2 text-sm text-[var(--text-primary)]"
                  placeholder={selectedProvider?.baseUrlPlaceholder ?? 'https://api.openai.com/v1'}
                  autoComplete="off"
                />
              </label>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-[var(--text-muted)]">
                  {settings?.baseUrlSource === 'env'
                    ? 'Using environment OPENAI_BASE_URL'
                    : settings?.baseUrlSource === 'default'
                      ? 'Using provider default'
                      : ''}
                </span>
                {settings?.baseUrlSource === 'database' && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraftBaseUrl('');
                      setClearBaseUrl(true);
                    }}
                    className="mc-shell-btn px-2 py-0.5 text-[11px]"
                  >
                    Use default base URL
                  </button>
                )}
              </div>
            </div>
          )}
          <label className="block text-xs text-[var(--text-secondary)]">
            <span className="mb-1 block text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Stale threshold (doing)</span>
            <input
              type="number"
              min={1}
              max={720}
              value={draftDoingThreshold}
              onChange={(event) => setDraftDoingThreshold(Number(event.target.value))}
              className="mc-shell-input w-full px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
          <label className="block text-xs text-[var(--text-secondary)]">
            <span className="mb-1 block text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Stale threshold (review)</span>
            <input
              type="number"
              min={1}
              max={720}
              value={draftReviewThreshold}
              onChange={(event) => setDraftReviewThreshold(Number(event.target.value))}
              className="mc-shell-input w-full px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
          <label className="block text-xs text-[var(--text-secondary)] md:col-span-2">
            <span className="mb-1 block text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Max actions per scan</span>
            <input
              type="number"
              min={1}
              max={100}
              value={draftMaxActions}
              onChange={(event) => setDraftMaxActions(Number(event.target.value))}
              className="mc-shell-input w-full px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] text-[var(--text-muted)]">
            Env fallback: {selectedProvider?.envKeys.join(', ') ?? 'none'}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => saveSettings(true)}
              disabled={saving || settings?.apiKeySource !== 'database'}
              className={`mc-shell-btn px-3 py-1.5 text-xs ${saving || settings?.apiKeySource !== 'database' ? 'opacity-50' : ''}`}
            >
              Clear saved key
            </button>
            <button
              type="button"
              onClick={() => saveSettings(false)}
              disabled={saving || !draftProvider || !draftModel}
              className={`mc-shell-btn px-3 py-1.5 text-xs font-medium ${saving || !draftProvider || !draftModel ? 'opacity-50' : ''}`}
            >
              {saving ? 'Saving...' : 'Save provider'}
            </button>
          </div>
        </div>
      </div>

      {/* Agent Logs */}
      <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">Recent Logs</h3>
          <button type="button" onClick={() => { fetchLogs(); }} className="mc-shell-btn px-2 py-0.5 text-[11px]">
            Refresh
          </button>
        </div>
        <div className="mt-3 max-h-[400px] space-y-1 overflow-auto">
          {logs.length === 0 && (
            <div className="text-xs text-[var(--text-muted)]">No logs yet</div>
          )}
          {logs.map((log, i) => {
            const isExpanded = expandedLog === i;
            const style = EVENT_STYLES[log.event] ?? { bg: 'bg-gray-500/20', text: 'text-gray-400' };
            const actionLabel = ACTION_LABELS[log.action] ?? log.action;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setExpandedLog(isExpanded ? null : i)}
                className="w-full cursor-pointer rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-3 py-2 text-left transition-colors hover:border-[var(--border-primary)]"
              >
                {/* Header row */}
                <div className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${style.bg} ${style.text}`}>
                      {log.event.replace('_', ' ')}
                    </span>
                    {log.taskId && (
                      <span className="text-[var(--text-muted)]">#{log.taskId}</span>
                    )}
                    {log.taskAssignee && (
                      <span className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
                        → {log.taskAssignee}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2 text-[var(--text-muted)]">
                    <span>{timeAgo(log.timestamp)}</span>
                    <span className="text-[10px]">{isExpanded ? '▲' : '▼'}</span>
                  </span>
                </div>

                {/* Task name + action */}
                <div className="mt-1 text-xs text-[var(--text-primary)]">{actionLabel}</div>
                {log.taskName && (
                  <div className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)]">
                    📋 {log.taskName}
                  </div>
                )}

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="mt-2 space-y-1 border-t border-[var(--border-secondary)] pt-2">
                    {log.result && (
                      <div className="text-xs text-[var(--text-secondary)]">
                        <span className="text-[var(--text-muted)]">Result:</span> {log.result}
                      </div>
                    )}
                    <div className="flex gap-4 text-[10px] text-[var(--text-muted)]">
                      <span>Model: {log.model}</span>
                      {log.tokensUsed > 0 && <span>{log.tokensUsed.toLocaleString()} tokens</span>}
                      <span>{new Date(log.timestamp).toLocaleString()}</span>
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
