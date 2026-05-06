import { useEffect, useMemo, useState } from 'react';
import { describePluginMountPoint, usePluginStore, type PluginUIEntry, type SwarmProviderUIEntry } from '../../stores/pluginStore';

// ── Shared helpers ──────────────────────────────────────────────────────────────

interface TabConfig {
  id: 'plugins' | 'swarm';
  label: string;
  count: number;
}

function ExternalLinkIcon() {
  return (
    <svg
      className="inline-block h-3.5 w-3.5 opacity-60"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path d="M11.5 3.5a2 2 0 114.24 4.24l-6.5 6.5H7.5V11.5l6.5-6.5-1.5-1.5z" />
      <path d="M8.5 8.5h3v3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RestartIcon() {
  return (
    <svg
      className="inline-block h-3.5 w-3.5"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path d="M10 3v3.5a4.5 4.5 0 11-4.5 4.5H3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 6.5L6.5 3 10 6.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Plugin helpers ─────────────────────────────────────────────────────────────

function statusTone(plugin: PluginUIEntry): string {
  if (!plugin.status.loaded || plugin.status.lastError) {
    return 'text-[var(--error)]';
  }

  return plugin.enabled ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]';
}

function pluginStateLabel(plugin: PluginUIEntry): string {
  if (plugin.status.lastError) return 'Error';
  if (!plugin.status.loaded) return 'Not loaded';
  return plugin.enabled ? 'Enabled' : 'Disabled';
}

function pluginStateClassName(plugin: PluginUIEntry): string {
  if (plugin.status.lastError || !plugin.status.loaded) {
    return 'border-[var(--error)]/40 bg-[var(--surface-error)] text-[var(--error)]';
  }

  if (plugin.enabled) {
    return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  }

  return 'border-[var(--border-primary)] bg-[var(--bg-tertiary)] text-[var(--text-muted)]';
}

function PluginStateChip({ plugin }: { plugin: PluginUIEntry }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${pluginStateClassName(plugin)}`}>
      {pluginStateLabel(plugin)}
    </span>
  );
}

// ── Swarm Provider helpers ─────────────────────────────────────────────────────

function providerBadgeClassName(provider: SwarmProviderUIEntry): string {
  if (provider.status.available) {
    return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  }
  if (provider.status.installed) {
    return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
  }
  return 'border-[var(--error)]/40 bg-[var(--surface-error)] text-[var(--error)]';
}

function providerStateLabel(provider: SwarmProviderUIEntry): string {
  if (provider.status.available) return 'Available';
  if (provider.status.installed) return 'Installed';
  return 'Not found';
}

function ProviderStatusBadge({ provider }: { provider: SwarmProviderUIEntry }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${providerBadgeClassName(provider)}`}>
      {providerStateLabel(provider)}
    </span>
  );
}


interface NodeOperationMetric {
  count: number;
  success: number;
  error: number;
  avgDurationMs?: number;
  errorRate?: number;
  lastAt?: string | null;
}

interface NodeOperationStatus {
  id: string;
  label: string;
  method: string;
  path: string;
  enabled: boolean;
  description: string;
  metric?: NodeOperationMetric | null;
}

interface NodeOperationSourceStatus {
  id: string;
  displayName: string;
  type: string;
  enabled: boolean;
  health: string;
  lastSyncedAt?: string | null;
  lastError?: string | null;
}

interface WebhookIngressStatus {
  id: string;
  label: string;
  method: string;
  path: string;
  enabled: boolean;
  auth: string;
  env?: string;
  description: string;
}

interface NodeOperationsStatusResponse {
  generatedAt: string;
  fileTransfer: {
    enabled: boolean;
    operations: NodeOperationStatus[];
    sources: NodeOperationSourceStatus[];
  };
  webhooks: {
    routes: WebhookIngressStatus[];
  };
}

function compactNumber(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0';
  return value > 999 ? value.toLocaleString() : String(value);
}

function NodeOperationsStatusPanel({ apiBase = '' }: { apiBase?: string }) {
  const [status, setStatus] = useState<NodeOperationsStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = apiBase.replace(/\/$/, '');

  const loadStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${base}/api/node-operations`);
      if (!res.ok) throw new Error(`Node operations status failed: ${res.status}`);
      setStatus((await res.json()) as NodeOperationsStatusResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load node operations status.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, [apiBase]);

  const activeTransferOps = status?.fileTransfer.operations.filter((operation) => operation.enabled).length ?? 0;
  const webhookRoutes = status?.webhooks.routes ?? [];
  const configuredWebhooks = webhookRoutes.filter((route) => route.enabled).length;

  return (
    <section className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-[var(--text-primary)]">Node operations</div>
          <div className="text-xs text-[var(--text-muted)]">
            OpenClaw 2026.5.3 file transfer and webhook ingress status surfaced from server capabilities.
          </div>
        </div>
        <button type="button" onClick={() => void loadStatus()} className="mc-shell-btn px-3 py-1 text-xs" disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="mb-3 rounded border border-[var(--error)]/40 bg-[var(--error)]/10 p-2 text-xs text-[var(--error)]">{error}</div>}

      {status ? (
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3">
            <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">File transfer</div>
            <div className="mt-2 text-sm text-[var(--text-primary)]">
              {activeTransferOps}/{status.fileTransfer.operations.length} operations available
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {status.fileTransfer.operations.map((operation) => (
                <span
                  key={operation.id}
                  title={`${operation.method} ${operation.path} — ${operation.description}`}
                  className={`rounded-full border px-2 py-0.5 text-[10px] ${
                    operation.enabled
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      : 'border-[var(--border-primary)] bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                  }`}
                >
                  {operation.id} · {compactNumber(operation.metric?.count)}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3">
            <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Sources</div>
            <div className="mt-2 text-sm text-[var(--text-primary)]">
              {status.fileTransfer.sources.filter((source) => source.enabled).length}/{status.fileTransfer.sources.length} enabled
            </div>
            <div className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
              {status.fileTransfer.sources.slice(0, 4).map((source) => (
                <div key={source.id} className="flex justify-between gap-2">
                  <span className="truncate">{source.displayName}</span>
                  <span className={source.health === 'ok' ? 'text-emerald-300' : 'text-amber-300'}>{source.health}</span>
                </div>
              ))}
              {status.fileTransfer.sources.length === 0 && <span>No sources configured.</span>}
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3">
            <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Webhook ingress</div>
            <div className="mt-2 text-sm text-[var(--text-primary)]">
              {configuredWebhooks}/{webhookRoutes.length} routes configured
            </div>
            <div className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
              {webhookRoutes.map((route) => (
                <div key={route.id} title={route.description} className="flex justify-between gap-2">
                  <span className="truncate">{route.method} {route.path}</span>
                  <span className={route.enabled ? 'text-emerald-300' : 'text-amber-300'}>{route.auth}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : !loading ? (
        <div className="text-xs text-[var(--text-muted)]">Node operations status has not loaded yet.</div>
      ) : null}
    </section>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function PluginAdminPanel({ apiBase = '' }: { apiBase?: string }) {
  const plugins = usePluginStore((state) => state.plugins);
  const swarmProviders = usePluginStore((state) => state.swarmProviders);
  const loading = usePluginStore((state) => state.loading);
  const error = usePluginStore((state) => state.error);
  const initialized = usePluginStore((state) => state.initialized);
  const fetchPlugins = usePluginStore((state) => state.fetchPlugins);
  const fetchSwarmProviders = usePluginStore((state) => state.fetchSwarmProviders);
  const togglePlugin = usePluginStore((state) => state.togglePlugin);
  const restartPlugin = usePluginStore((state) => state.restartPlugin);
  const restartProvider = usePluginStore((state) => state.restartProvider);
  const installFromGitHub = usePluginStore((state) => state.installFromGitHub);

  const [activeTab, setActiveTab] = useState<'plugins' | 'swarm'>('plugins');
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [selectedProviderName, setSelectedProviderName] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [restartingId, setRestartingId] = useState<string | null>(null);
  const [installUrl, setInstallUrl] = useState('');
  const [installing, setInstalling] = useState(false);
  const [installMessage, setInstallMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Known repo mappings for display
  const knownPluginRepos: Record<string, string> = {
    'entity-linker': 'https://github.com/h-mascot/entity-plugins',
    'entity-services': 'https://github.com/h-mascot/entity-plugins',
    'geordi-swarm': 'https://github.com/h-mascot/entity-plugins',
  };

  const tabs: TabConfig[] = [
    { id: 'plugins', label: 'Plugins', count: plugins.length },
    { id: 'swarm', label: 'Swarm Providers', count: swarmProviders.length },
  ];

  useEffect(() => {
    if (!initialized && !loading) {
      void fetchPlugins(apiBase);
      void fetchSwarmProviders(apiBase);
    }
  }, [apiBase, fetchPlugins, fetchSwarmProviders, initialized, loading]);

  // Select first item when list changes
  useEffect(() => {
    if (activeTab === 'plugins') {
      if (plugins.length > 0 && (!selectedPluginId || !plugins.some((p) => p.id === selectedPluginId))) {
        setSelectedPluginId(plugins[0].id);
      } else if (plugins.length === 0) {
        setSelectedPluginId(null);
      }
    } else {
      if (swarmProviders.length > 0 && (!selectedProviderName || !swarmProviders.some((p) => p.name === selectedProviderName))) {
        setSelectedProviderName(swarmProviders[0].name);
      } else if (swarmProviders.length === 0) {
        setSelectedProviderName(null);
      }
    }
  }, [activeTab, plugins, swarmProviders, selectedPluginId, selectedProviderName]);

  const selectedPlugin = useMemo(
    () => plugins.find((plugin) => plugin.id === selectedPluginId) ?? plugins[0] ?? null,
    [plugins, selectedPluginId],
  );

  const selectedProvider = useMemo(
    () => swarmProviders.find((p) => p.name === selectedProviderName) ?? swarmProviders[0] ?? null,
    [swarmProviders, selectedProviderName],
  );

  const enabledCount = plugins.filter((plugin) => plugin.enabled).length;
  const errorCount = plugins.filter((plugin) => plugin.status.lastError || !plugin.status.loaded).length;
  const availableCount = swarmProviders.filter((p) => p.status.available).length;

  const handleInstallFromGitHub = async () => {
    if (!installUrl.trim()) return;
    setInstalling(true);
    setInstallMessage(null);
    const result = await installFromGitHub(installUrl.trim(), apiBase);
    setInstalling(false);
    if (result.success) {
      setInstallMessage({ type: 'success', text: 'Installation initiated. Refresh to see the new plugin.' });
      setInstallUrl('');
      void fetchPlugins(apiBase);
    } else {
      setInstallMessage({ type: 'error', text: result.error ?? 'Install failed' });
    }
  };

  return (
    <div className="space-y-4">
      <NodeOperationsStatusPanel apiBase={apiBase} />

      {/* Tab header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-primary)] pb-3">
        <div className="flex gap-1 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {tab.label}
              <span className="rounded-full bg-[var(--bg-tertiary)] px-2 py-0.5 text-[11px]">{tab.count}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => {
              void fetchPlugins(apiBase);
              void fetchSwarmProviders(apiBase);
            }}
            className="mc-shell-btn px-3 py-1.5 text-xs"
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh All'}
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error ? (
        <div className="rounded-xl border border-[var(--error)]/40 bg-[var(--surface-error)] px-4 py-3 text-sm text-[var(--error)]">
          {error}
        </div>
      ) : null}

      {/* Install from GitHub - always visible */}
      <div className="rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-[var(--text-primary)]">Install from GitHub</div>
            <div className="mt-1 text-xs text-[var(--text-muted)]">
              Enter a GitHub repository URL to install a plugin
            </div>
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-initial">
            <input
              type="url"
              value={installUrl}
              onChange={(e) => setInstallUrl(e.target.value)}
              placeholder="https://github.com/user/repo"
              className="mc-shell-input min-w-0 flex-1 px-3 py-1.5 text-xs sm:w-64"
            />
            <button
              type="button"
              onClick={() => void handleInstallFromGitHub()}
              disabled={installing || !installUrl.trim()}
              className="mc-shell-btn px-3 py-1.5 text-xs"
            >
              {installing ? 'Installing…' : 'Install'}
            </button>
          </div>
        </div>
        {installMessage ? (
          <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${
            installMessage.type === 'success'
              ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : 'border border-[var(--error)]/40 bg-[var(--surface-error)] text-[var(--error)]'
          }`}>
            {installMessage.text}
          </div>
        ) : null}
      </div>

      {/* Main content grid */}
      <div className="grid gap-4 xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.35fr)]">
        {/* Left panel */}
        <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                {activeTab === 'plugins' ? 'Plugin registry' : 'Swarm Providers'}
              </div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">
                {activeTab === 'plugins'
                  ? 'Server-loaded plugins, current status, and controls.'
                  : 'Execution providers for build and test jobs.'}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {activeTab === 'plugins' ? (
                  <>
                    <span className="mc-shell-pill px-2.5 py-1 text-[11px] text-[var(--text-secondary)]">
                      {plugins.length} installed
                    </span>
                    <span className="mc-shell-pill px-2.5 py-1 text-[11px] text-[var(--text-secondary)]">
                      {enabledCount} active
                    </span>
                    {errorCount > 0 && (
                      <span className="mc-shell-pill px-2.5 py-1 text-[11px] text-[var(--error)]">
                        {errorCount} needs attention
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="mc-shell-pill px-2.5 py-1 text-[11px] text-[var(--text-secondary)]">
                      {swarmProviders.length} registered
                    </span>
                    <span className="mc-shell-pill px-2.5 py-1 text-[11px] text-emerald-300">
                      {availableCount} available
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Plugins list */}
          {activeTab === 'plugins' ? (
            plugins.length === 0 && !loading ? (
              <div className="rounded-xl border border-dashed border-[var(--border-primary)] bg-[var(--bg-primary)] px-4 py-6 text-sm text-[var(--text-muted)]">
                No plugins are registered in this workspace.
              </div>
            ) : (
              <div className="space-y-2">
                {plugins.map((plugin) => (
                  <div
                    key={plugin.id}
                    onClick={() => setSelectedPluginId(plugin.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedPluginId(plugin.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                      selectedPlugin?.id === plugin.id
                        ? 'border-[var(--accent)] bg-[var(--surface-accent)]'
                        : 'border-[var(--border-primary)] bg-[var(--bg-primary)] hover:bg-[var(--bg-tertiary)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-[var(--text-primary)]">{plugin.name}</span>
                          <span className="mc-shell-pill px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
                            {plugin.kind}
                          </span>
                          <span className="text-[11px] text-[var(--text-muted)]">v{plugin.version}</span>
                          {knownPluginRepos[plugin.id] && (
                            <a
                              href={knownPluginRepos[plugin.id]}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--accent)]"
                              title="View on GitHub"
                            >
                              <ExternalLinkIcon />
                            </a>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-[var(--text-muted)]">{describePluginMountPoint(plugin.mountPoint)}</div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {plugin.capabilities.slice(0, 3).map((capability) => (
                            <span
                              key={capability}
                              className="rounded-full border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]"
                            >
                              {capability}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <PluginStateChip plugin={plugin} />
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setRestartingId(plugin.id);
                              void restartPlugin(plugin.id, apiBase)
                                .catch((err) => console.error('Restart failed:', err))
                                .finally(() => setRestartingId(null));
                            }}
                            className="mc-shell-btn px-2 py-0.5 text-xs"
                            title="Restart plugin"
                          >
                            {restartingId === plugin.id ? (
                              <span className="animate-pulse">...</span>
                            ) : (
                              <RestartIcon />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setTogglingId(plugin.id);
                              void togglePlugin(plugin.id, apiBase)
                                .finally(() => setTogglingId(null));
                            }}
                            className={`mc-shell-btn px-2 py-0.5 text-xs ${
                              plugin.enabled ? 'mc-shell-btn-active text-[var(--text-primary)]' : ''
                            }`}
                            disabled={togglingId === plugin.id}
                          >
                            {togglingId === plugin.id ? '…' : plugin.enabled ? 'On' : 'Off'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            /* Swarm Providers list */
            swarmProviders.length === 0 && !loading ? (
              <div className="rounded-xl border border-dashed border-[var(--border-primary)] bg-[var(--bg-primary)] px-4 py-6 text-sm text-[var(--text-muted)]">
                No swarm providers registered.
              </div>
            ) : (
              <div className="space-y-2">
                {swarmProviders.map((provider) => (
                  <div
                    key={provider.name}
                    onClick={() => setSelectedProviderName(provider.name)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedProviderName(provider.name);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                      selectedProvider?.name === provider.name
                        ? 'border-[var(--accent)] bg-[var(--surface-accent)]'
                        : 'border-[var(--border-primary)] bg-[var(--bg-primary)] hover:bg-[var(--bg-tertiary)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-[var(--text-primary)]">{provider.label}</span>
                          <span className="mc-shell-pill px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
                            {provider.category ?? 'provider'}
                          </span>
                          {provider.repo && (
                            <a
                              href={provider.repo.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--accent)]"
                              title={`View ${provider.repo.label} on GitHub`}
                            >
                              <ExternalLinkIcon />
                            </a>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-[var(--text-muted)]">
                          {provider.description ?? `Swarm provider: ${provider.name}`}
                        </div>
                        {provider.capabilities && provider.capabilities.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {provider.capabilities.slice(0, 4).map((cap) => (
                              <span
                                key={cap}
                                className="rounded-full border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]"
                              >
                                {cap}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <ProviderStatusBadge provider={provider} />
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setRestartingId(provider.name);
                            void restartProvider(provider.name, apiBase)
                              .catch((err) => console.error('Restart provider failed:', err))
                              .finally(() => setRestartingId(null));
                          }}
                          className="mc-shell-btn px-2 py-0.5 text-xs"
                          title="Check health / restart"
                        >
                          {restartingId === provider.name ? (
                            <span className="animate-pulse">...</span>
                          ) : (
                            <RestartIcon />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>

        {/* Right panel - Detail view */}
        <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
          {activeTab === 'plugins' ? (
            selectedPlugin ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-primary)] pb-4">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                      Plugin detail
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <div className="text-lg font-semibold text-[var(--text-primary)]">{selectedPlugin.name}</div>
                      <span className="text-xs text-[var(--text-muted)]">v{selectedPlugin.version}</span>
                      {knownPluginRepos[selectedPlugin.id] && (
                        <a
                          href={knownPluginRepos[selectedPlugin.id]}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--accent)]"
                          title="View on GitHub"
                        >
                          <ExternalLinkIcon />
                          <span className="text-xs">GitHub</span>
                        </a>
                      )}
                    </div>
                    <div className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">
                      {selectedPlugin.description || 'No plugin description provided.'}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <PluginStateChip plugin={selectedPlugin} />
                    <span className="mc-shell-pill px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
                      {selectedPlugin.kind}
                    </span>
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-3">
                  <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Mount point</div>
                    <div className="mt-2 text-sm text-[var(--text-primary)]">
                      {describePluginMountPoint(selectedPlugin.mountPoint)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Status</div>
                    <div className={`mt-2 text-sm font-medium ${statusTone(selectedPlugin)}`}>
                      {selectedPlugin.status.lastError ? selectedPlugin.status.lastError : selectedPlugin.enabled ? 'Enabled' : 'Disabled'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Registered</div>
                    <div className="mt-2 text-sm text-[var(--text-primary)]">
                      {selectedPlugin.status.registeredAt || 'Not reported'}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                    Capabilities
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedPlugin.capabilities.length > 0 ? (
                      selectedPlugin.capabilities.map((capability) => (
                        <span
                          key={capability}
                          className="rounded-full border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-1 text-xs text-[var(--text-secondary)]"
                        >
                          {capability}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-[var(--text-muted)]">No capabilities declared.</span>
                    )}
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                    Settings
                  </div>
                  <pre className="overflow-x-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-3 text-xs text-[var(--text-secondary)]">
                    {JSON.stringify(selectedPlugin.settings, null, 2)}
                  </pre>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Hooks</div>
                    <div className="mt-2 text-sm text-[var(--text-primary)]">
                      {selectedPlugin.hooks.length > 0 ? selectedPlugin.hooks.join(', ') : 'No hooks declared'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Mounted routes</div>
                    <div className="mt-2 text-sm text-[var(--text-primary)]">
                      {selectedPlugin.status.routesMounted.length > 0
                        ? selectedPlugin.status.routesMounted.join(', ')
                        : 'No plugin routes mounted'}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-[var(--border-primary)] bg-[var(--bg-primary)] px-4 py-6 text-sm text-[var(--text-muted)]">
                Select a plugin to inspect its details.
              </div>
            )
          ) : selectedProvider ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-primary)] pb-4">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    Provider detail
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <div className="text-lg font-semibold text-[var(--text-primary)]">{selectedProvider.label}</div>
                    <span className="mc-shell-pill px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
                      {selectedProvider.category ?? 'provider'}
                    </span>
                    {selectedProvider.repo && (
                      <a
                        href={selectedProvider.repo.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--accent)]"
                        title={`View ${selectedProvider.repo.label} on GitHub`}
                      >
                        <ExternalLinkIcon />
                        <span className="text-xs">{selectedProvider.repo.label}</span>
                      </a>
                    )}
                  </div>
                  <div className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">
                    {selectedProvider.description ?? `Swarm execution provider: ${selectedProvider.name}`}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ProviderStatusBadge provider={selectedProvider} />
                  <button
                    type="button"
                    onClick={() => {
                      setRestartingId(selectedProvider.name);
                      void restartProvider(selectedProvider.name, apiBase)
                        .catch((err) => console.error('Restart provider failed:', err))
                        .finally(() => setRestartingId(null));
                    }}
                    className="mc-shell-btn flex items-center gap-1.5 px-3 py-1.5 text-xs"
                    disabled={restartingId === selectedProvider.name}
                  >
                    {restartingId === selectedProvider.name ? (
                      <>
                        <span className="animate-pulse">Checking…</span>
                      </>
                    ) : (
                      <>
                        <RestartIcon />
                        <span>Check Health</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Provider name</div>
                  <div className="mt-2 text-sm text-[var(--text-primary)] font-mono">{selectedProvider.name}</div>
                </div>
                <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Health status</div>
                  <div className={`mt-2 text-sm font-medium ${
                    selectedProvider.status.available ? 'text-emerald-300' : 'text-amber-300'
                  }`}>
                    {selectedProvider.status.available ? 'Healthy' : 'Unavailable'}
                  </div>
                  {selectedProvider.status.message && (
                    <div className="mt-1 text-xs text-[var(--text-muted)]">{selectedProvider.status.message}</div>
                  )}
                </div>
              </div>

              {selectedProvider.capabilities && selectedProvider.capabilities.length > 0 && (
                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                    Capabilities
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedProvider.capabilities.map((cap) => (
                      <span
                        key={cap}
                        className="rounded-full border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-1 text-xs text-[var(--text-secondary)]"
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {selectedProvider.repo && (
                <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-4">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Repository</div>
                  <div className="mt-2">
                    <a
                      href={selectedProvider.repo.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-[var(--accent)] hover:underline"
                    >
                      <ExternalLinkIcon />
                      {selectedProvider.repo.url}
                    </a>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--border-primary)] bg-[var(--bg-primary)] px-4 py-6 text-sm text-[var(--text-muted)]">
              Select a swarm provider to inspect its details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
