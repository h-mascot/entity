import { useEffect, useMemo, useState } from 'react';
import { buildApiCandidates, requestJsonWithFallback, toErrorMessage } from '../lib/http';
import { getServiceRegistryStatus, type ServiceRegistryState } from './entityServicesState';
import type { PluginUIEntry } from '../stores/pluginStore';

type ServiceStatus = 'operational' | 'degraded' | 'offline' | 'unknown';
type ServicesViewMode = 'table' | 'cards';
type ServiceVisibility = 'managed' | 'related' | 'ambient';
type ServiceScope = 'focus' | 'all' | 'ambient';

interface ServiceFamilyRecord {
  key: string;
  name: string;
  memberCount: number;
}

interface ServiceLinkRecord {
  label: string;
  url: string;
  external: boolean;
}

interface ServiceHealthRecord {
  status: ServiceStatus;
  message: string;
  checkedAt: string;
  endpoint?: string;
  latencyMs?: number;
  statusCode?: number;
}

interface ServiceRegistryEntry {
  id: string;
  name: string;
  serviceType: 'internal-plugin' | 'external-http' | 'host-process';
  category: string;
  description: string;
  status: ServiceStatus;
  visibility?: ServiceVisibility;
  relevanceScore?: number;
  relevanceReason?: string;
  family?: ServiceFamilyRecord;
  health: ServiceHealthRecord;
  link: ServiceLinkRecord;
  healthLink?: ServiceLinkRecord;
  tags: string[];
  meta: Record<string, unknown>;
}

interface ServiceRegistryPayload {
  plugin: {
    id: string;
    name: string;
    enabled: boolean;
    kind: string;
    settings: Record<string, unknown>;
  };
  summary: Record<ServiceStatus, number>;
  checkedAt: string;
  services: ServiceRegistryEntry[];
  state?: ServiceRegistryState;
  partial?: boolean;
  refreshError?: string;
}

interface EntityServicesBoardProps {
  plugin: PluginUIEntry;
  apiBase?: string;
}

const SUMMARY_ORDER: ServiceStatus[] = ['operational', 'degraded', 'offline', 'unknown'];
const VIEW_STORAGE_KEY = 'entity.services.view';
const SCOPE_STORAGE_KEY = 'entity.services.scope';

const STATUS_TONE: Record<ServiceStatus, { chip: string; dot: string; card: string; note: string }> = {
  operational: {
    chip: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    dot: 'bg-emerald-400',
    card: 'border-emerald-500/35 bg-emerald-500/[0.06]',
    note: 'All systems nominal',
  },
  degraded: {
    chip: 'border-amber-500/45 bg-amber-500/10 text-amber-300',
    dot: 'bg-amber-300',
    card: 'border-amber-500/35 bg-amber-500/[0.07]',
    note: 'Performance issues detected',
  },
  offline: {
    chip: 'border-[var(--error)]/45 bg-[var(--surface-error)] text-[var(--error)]',
    dot: 'bg-[var(--error)]',
    card: 'border-[var(--error)]/35 bg-[var(--surface-error)]',
    note: 'Services not responding',
  },
  unknown: {
    chip: 'border-slate-500/35 bg-slate-500/10 text-slate-300',
    dot: 'bg-slate-400',
    card: 'border-[var(--border-primary)] bg-[var(--bg-secondary)]',
    note: 'Status unknown',
  },
};

function statusClassName(status: ServiceStatus): string {
  return STATUS_TONE[status].chip;
}

function statusLabel(status: ServiceStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatCheckedAt(value: string | undefined): string {
  if (!value) return 'Not checked yet';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

function formatLatency(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${Math.round(value)} ms`;
}

function buildRegistryUrls(plugin: PluginUIEntry, apiBase: string): string[] {
  const routeBase = plugin.routes[0]?.basePath?.trim() || '/api/entity-services';
  const normalized = routeBase.startsWith('/api/') ? routeBase.slice(4) : routeBase;
  return buildApiCandidates(`${normalized}/registry`, apiBase);
}

function readMetaString(meta: Record<string, unknown>, key: string, fallback = '—'): string {
  const value = meta[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function getInitialViewMode(): ServicesViewMode {
  if (typeof window === 'undefined' || !window.localStorage) return 'table';
  const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
  return stored === 'cards' ? 'cards' : 'table';
}


function getInitialScope(): ServiceScope {
  if (typeof window === 'undefined' || !window.localStorage) return 'focus';
  const stored = window.localStorage.getItem(SCOPE_STORAGE_KEY);
  return stored === 'all' || stored === 'ambient' ? stored : 'focus';
}

function getVisibility(service: ServiceRegistryEntry): ServiceVisibility {
  return service.visibility ?? (readMetaString(service.meta, 'source') === 'curated' ? 'managed' : 'ambient');
}

function getFamily(service: ServiceRegistryEntry): ServiceFamilyRecord {
  if (service.family) return service.family;
  const processName = readMetaString(service.meta, 'processName', '');
  const fallbackName = processName || service.name.replace(/\s*:\d+\b/g, '').trim() || service.name;
  return { key: fallbackName.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: fallbackName, memberCount: 1 };
}

function scopeLabel(scope: ServiceScope): string {
  if (scope === 'focus') return 'Focus';
  if (scope === 'ambient') return 'Ambient';
  return 'All';
}

function visibilityLabel(visibility: ServiceVisibility): string {
  if (visibility === 'managed') return 'Managed';
  if (visibility === 'related') return 'Related';
  return 'Ambient';
}

function renderTags(tags: string[]) {
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {tags.slice(0, 6).map((tag) => (
        <span
          key={tag}
          className="rounded-full border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function ServiceActions({ service }: { service: ServiceRegistryEntry }) {
  return (
    <div className="flex flex-wrap gap-2 pt-2">
      <a
        href={service.link.url}
        target="_blank"
        rel="noreferrer noopener"
        className="mc-shell-btn px-3 py-1 text-xs"
      >
        Open service
      </a>
      {service.healthLink ? (
        <a
          href={service.healthLink.url}
          target="_blank"
          rel="noreferrer noopener"
          className="mc-shell-btn px-3 py-1 text-xs"
        >
          Health endpoint
        </a>
      ) : null}
    </div>
  );
}

function SummaryCard({ status, count }: { status: ServiceStatus; count: number }) {
  const tone = STATUS_TONE[status];
  return (
    <div className={`rounded-lg border p-4 ${tone.card}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} />
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">{statusLabel(status)}</div>
        </div>
        <div className="text-2xl font-semibold text-[var(--text-primary)]">{count}</div>
      </div>
      <div className="mt-3 text-xs text-[var(--text-secondary)]">{tone.note}</div>
    </div>
  );
}

export default function EntityServicesBoard({ plugin, apiBase = '' }: EntityServicesBoardProps) {
  const [payload, setPayload] = useState<ServiceRegistryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ServicesViewMode>(() => getInitialViewMode());
  const [scope, setScope] = useState<ServiceScope>(() => getInitialScope());

  useEffect(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(VIEW_STORAGE_KEY, viewMode);
    }
  }, [viewMode]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(SCOPE_STORAGE_KEY, scope);
    }
  }, [scope]);

  useEffect(() => {
    let disposed = false;

    const load = async (background = false) => {
      if (background) setRefreshing(true);
      else setLoading(true);

      try {
        const data = await requestJsonWithFallback<ServiceRegistryPayload>({
          urls: buildRegistryUrls(plugin, apiBase),
          fallbackError: 'Unable to load services registry.',
        });

        if (!disposed) {
          setPayload(data);
          setError(null);
        }
      } catch (loadError) {
        if (!disposed) setError(toErrorMessage(loadError, 'Unable to load services registry.'));
      } finally {
        if (!disposed) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    void load(false);
    const interval = window.setInterval(() => void load(true), 30_000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [apiBase, plugin]);

  const services = payload?.services ?? [];
  const registryStatus = getServiceRegistryStatus(payload?.state, payload?.partial, payload?.refreshError);
  const filteredServices = useMemo(() => {
    const visible = services.filter((service) => {
      const visibility = getVisibility(service);
      if (scope === 'all') return true;
      if (scope === 'ambient') return visibility === 'ambient';
      return visibility !== 'ambient';
    });

    return [...visible].sort((left, right) => {
      const visibilityRank: Record<ServiceVisibility, number> = { managed: 0, related: 1, ambient: 2 };
      return (visibilityRank[getVisibility(left)] - visibilityRank[getVisibility(right)])
        || getFamily(left).name.localeCompare(getFamily(right).name)
        || left.name.localeCompare(right.name);
    });
  }, [services, scope]);

  const scopeCounts = useMemo(() => ({
    focus: services.filter((service) => getVisibility(service) !== 'ambient').length,
    ambient: services.filter((service) => getVisibility(service) === 'ambient').length,
    all: services.length,
  }), [services]);

  const familyGroups = useMemo(() => {
    const groups = new Map<string, { family: ServiceFamilyRecord; services: ServiceRegistryEntry[] }>();
    for (const service of filteredServices) {
      const family = getFamily(service);
      const group = groups.get(family.key) ?? { family, services: [] };
      group.services.push(service);
      groups.set(family.key, group);
    }
    return Array.from(groups.values());
  }, [filteredServices]);

  const summary = useMemo(
    () => ({
      operational: payload?.summary.operational ?? 0,
      degraded: payload?.summary.degraded ?? 0,
      offline: payload?.summary.offline ?? 0,
      unknown: payload?.summary.unknown ?? 0,
    }),
    [payload],
  );

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xl font-semibold text-[var(--text-primary)]">Operational services registry</div>
            <div className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">
              Focus view shows managed and inferred Entity-adjacent services; noisy host listeners are grouped under Ambient.
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="mc-shell-pill px-3 py-1 text-[var(--text-secondary)]">{services.length} discovered</span>
              <span className="mc-shell-pill px-3 py-1 text-[var(--text-secondary)]">{familyGroups.length} groups shown</span>
              <span className="mc-shell-pill px-3 py-1 text-[var(--text-secondary)]">
                Last check {formatCheckedAt(payload?.checkedAt)}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-xs">
              {(['focus', 'all', 'ambient'] as ServiceScope[]).map((nextScope, index) => (
                <button
                  key={nextScope}
                  type="button"
                  onClick={() => setScope(nextScope)}
                  className={`${index > 0 ? 'border-l border-[var(--border-primary)]' : ''} px-3 py-1 ${scope === nextScope ? 'bg-[var(--accent)]/15 text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}
                  title={nextScope === 'focus' ? 'Managed and inferred Entity-adjacent services' : nextScope === 'ambient' ? 'Grouped host listeners that are probably background noise' : 'Every discovered listener'}
                >
                  {scopeLabel(nextScope)} {scopeCounts[nextScope]}
                </button>
              ))}
            </div>
            <div className="inline-flex overflow-hidden rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-xs">
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`px-3 py-1 ${viewMode === 'table' ? 'bg-[var(--accent)]/15 text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}
              >
                Table
              </button>
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                className={`border-l border-[var(--border-primary)] px-3 py-1 ${viewMode === 'cards' ? 'bg-[var(--accent)]/15 text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}
              >
                List
              </button>
            </div>
            <span className="mc-shell-pill px-3 py-1 text-xs text-[var(--text-secondary)]">
              {loading ? 'Loading…' : refreshing ? 'Refreshing…' : registryStatus.label}
            </span>
            <button
              type="button"
              onClick={() => {
                setRefreshing(true);
                void requestJsonWithFallback<ServiceRegistryPayload>({
                  urls: buildRegistryUrls(plugin, apiBase),
                  fallbackError: 'Unable to load services registry.',
                })
                  .then((data) => {
                    setPayload(data);
                    setError(null);
                  })
                  .catch((loadError) => setError(toErrorMessage(loadError, 'Unable to load services registry.')))
                  .finally(() => setRefreshing(false));
              }}
              className="mc-shell-btn px-3 py-1 text-xs"
              disabled={loading || refreshing}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {SUMMARY_ORDER.map((status) => (
            <SummaryCard key={status} status={status} count={summary[status]} />
          ))}
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-[var(--error)]/40 bg-[var(--surface-error)] px-4 py-3 text-sm text-[var(--error)]">
          {error}
        </div>
      ) : null}

      {!error && registryStatus.message ? (
        <div
          className={registryStatus.tone === 'error'
            ? 'rounded-xl border border-[var(--error)]/40 bg-[var(--surface-error)] px-4 py-3 text-sm text-[var(--error)]'
            : 'rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-200'}
          role={registryStatus.tone === 'error' ? 'alert' : 'status'}
        >
          <span className="font-medium">{registryStatus.label}.</span> {registryStatus.message}
        </div>
      ) : null}

      {viewMode === 'cards' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {filteredServices.length === 0 ? (
            <div className="mc-shell-card border border-dashed border-[var(--border-primary)] px-5 py-8 lg:col-span-2">
              <div className="text-sm font-medium text-[var(--text-primary)]">
                {loading ? 'Loading services registry...' : 'No services to display'}
              </div>
              <div className="mt-2 text-sm text-[var(--text-muted)]">
                Auto-discovered services will appear here after the registry responds. Last check:{' '}
                {formatCheckedAt(payload?.checkedAt)}.
              </div>
            </div>
          ) : filteredServices.map((service) => {
            const host = readMetaString(service.meta, 'host');
            const source = readMetaString(service.meta, 'source');
            const processName = readMetaString(service.meta, 'processName', '—');
            const detectedTitle = readMetaString(service.meta, 'detectedTitle', '');
            const detectedServerHeader = readMetaString(service.meta, 'detectedServerHeader', '');
            return (
              <div key={service.id} className="mc-shell-card border border-[var(--border-secondary)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <a
                      href={service.link.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-sm font-medium text-[var(--accent)] underline-offset-2 hover:underline"
                    >
                      {service.name}
                    </a>
                    <div className="mt-1 text-xs text-[var(--text-muted)]">{service.description}</div>
                  </div>
                  <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${statusClassName(service.status)}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${STATUS_TONE[service.status].dot}`} />
                    {statusLabel(service.status)}
                  </span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3 text-xs text-[var(--text-secondary)]">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Host</div>
                    <div className="mt-1">{host}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{source}</div>
                  </div>
                  <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3 text-xs text-[var(--text-secondary)]">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Probe</div>
                    <div className="mt-1">{service.health.statusCode ? `HTTP ${service.health.statusCode}` : service.health.message}</div>
                    <div className="mt-1">{formatLatency(service.health.latencyMs)}</div>
                  </div>
                </div>
                <div className="mt-3 space-y-1 text-xs text-[var(--text-secondary)]">
                  <div><span className="text-[var(--text-muted)]">Category:</span> {service.category}</div>
                  <div><span className="text-[var(--text-muted)]">Group:</span> {getFamily(service).name} ({getFamily(service).memberCount}) · {visibilityLabel(getVisibility(service))}</div>
                  <div><span className="text-[var(--text-muted)]">Process:</span> {processName}</div>
                  {detectedTitle ? <div><span className="text-[var(--text-muted)]">Title:</span> {detectedTitle}</div> : null}
                  {detectedServerHeader ? <div><span className="text-[var(--text-muted)]">Server:</span> {detectedServerHeader}</div> : null}
                  <div><span className="text-[var(--text-muted)]">Checked:</span> {formatCheckedAt(service.health.checkedAt)}</div>
                </div>
                {renderTags(service.tags)}
                <ServiceActions service={service} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mc-shell-card overflow-hidden border border-[var(--border-secondary)]">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[var(--border-primary)] text-sm">
              <thead className="bg-[var(--bg-secondary)]/80">
                <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                  <th className="px-4 py-3">Service</th>
                  <th className="px-4 py-3">Host</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">URL</th>
                  <th className="px-4 py-3">Health</th>
                  <th className="px-4 py-3">Details</th>
                  <th className="px-4 py-3">Checked</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-primary)]">
                {filteredServices.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-20 text-center">
                      <div className="mx-auto max-w-sm">
                        <div className="text-sm font-medium text-[var(--text-primary)]">
                          {loading ? 'Loading services registry...' : 'No services to display'}
                        </div>
                        <div className="mt-2 text-sm text-[var(--text-muted)]">
                          Auto-discovered services will appear here. Last check: {formatCheckedAt(payload?.checkedAt)}.
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : filteredServices.map((service) => {
                  const host = readMetaString(service.meta, 'host');
                  const source = readMetaString(service.meta, 'source');
                  const processName = readMetaString(service.meta, 'processName', '—');
                  const detectedTitle = readMetaString(service.meta, 'detectedTitle', '—');
                  const detectedServerHeader = readMetaString(service.meta, 'detectedServerHeader', '—');
                  return (
                    <tr key={service.id} className="align-top hover:bg-[var(--bg-secondary)]/40">
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <a
                            href={service.link.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="font-medium text-[var(--accent)] underline-offset-2 hover:underline"
                          >
                            {service.name}
                          </a>
                          <div className="text-xs text-[var(--text-muted)]">{service.description}</div>
                          {renderTags(service.tags)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">
                        <div>{host}</div>
                        <div className="mt-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{source}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">{service.category}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${statusClassName(service.status)}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_TONE[service.status].dot}`} />
                          {statusLabel(service.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <a
                          href={service.link.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="break-all text-[var(--accent)] underline-offset-2 hover:underline"
                        >
                          {service.link.url}
                        </a>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">
                        <div>{service.health.statusCode ? `HTTP ${service.health.statusCode}` : service.health.message}</div>
                        <div className="mt-1">{formatLatency(service.health.latencyMs)}</div>
                        {service.healthLink ? (
                          <a
                            href={service.healthLink.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="mt-1 inline-block break-all text-[var(--accent)] underline-offset-2 hover:underline"
                          >
                            {service.healthLink.url}
                          </a>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">
                        <div><span className="text-[var(--text-muted)]">Group:</span> {getFamily(service).name} ({getFamily(service).memberCount})</div>
                        <div className="mt-1"><span className="text-[var(--text-muted)]">Scope:</span> {visibilityLabel(getVisibility(service))}</div>
                        <div className="mt-1"><span className="text-[var(--text-muted)]">Process:</span> {processName}</div>
                        <div className="mt-1"><span className="text-[var(--text-muted)]">Title:</span> {detectedTitle}</div>
                        <div className="mt-1"><span className="text-[var(--text-muted)]">Server:</span> {detectedServerHeader}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">{formatCheckedAt(service.health.checkedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
