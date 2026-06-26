import { useEffect, useMemo, useState } from 'react';
import type { TaskBoardTask } from '../hooks/useTaskBoard';

type RuntimeState = 'healthy' | 'degraded' | 'unavailable' | 'unknown';
type RuntimeReadiness = 'ready' | 'degraded' | 'unavailable' | 'unknown';
type BindingState = 'bound' | 'unbound' | 'stale' | 'unknown';
type HelmLightControlAction = 'pause' | 'resume' | 'request_retry';

interface HelmRuntimeStatusSummary {
  source: 'helm';
  binding_id: string | null;
  state: RuntimeState;
  health: RuntimeState;
  readiness: RuntimeReadiness;
  current_work: string | null;
  heartbeat_at: string | null;
  checked_at: string;
  stale: boolean;
  reason: string;
  helm_link: string | null;
}

interface AgentCapabilities {
  runtimeLabel?: string;
  ownerLabel?: string;
  verificationLabel?: string;
  capabilityLabels?: string[];
  permissionLabels?: string[];
  scopeLabels?: string[];
}

interface RegistryAgent {
  id: string;
  slug?: string;
  name: string;
  status?: string;
  description?: string | null;
  adapter_type?: string | null;
  runtime_type?: string | null;
  runtime_binding_id?: string | null;
  provider_type?: string | null;
  helm_managed?: boolean;
  binding_state?: BindingState;
  metadata_json?: string | null;
  capabilities?: AgentCapabilities;
  runtime_status?: HelmRuntimeStatusSummary;
  runtimeStatus?: HelmRuntimeStatusSummary;
}

interface AgentManagementSurfaceProps {
  agentId: string;
  agentName: string;
  runtime: string;
  model: string;
  currentTaskTitle: string | null;
  runtimeStatus?: HelmRuntimeStatusSummary;
  tasks: TaskBoardTask[];
}

interface ControlResult {
  accepted: boolean;
  status: 'accepted' | 'denied' | 'unavailable';
  action: HelmLightControlAction;
  reason: string;
  audit?: {
    event_type?: string;
    policy_allowed?: boolean;
    forwarded_to_helm?: boolean;
    created_at?: string;
  };
}

const SAFE_CONTROLS: Array<{ action: HelmLightControlAction; label: string }> = [
  { action: 'pause', label: 'Pause' },
  { action: 'resume', label: 'Resume' },
  { action: 'request_retry', label: 'Request retry' },
];

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeIdentity(value: unknown): string {
  return normalize(value).toLowerCase().replace(/[\s_-]+/g, '');
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => normalize(entry)).filter(Boolean);
}

function labelsFromCapabilities(capabilities?: AgentCapabilities): string[] {
  const labels = [
    ...(capabilities?.capabilityLabels ?? []),
    ...(capabilities?.permissionLabels ?? []),
    ...(capabilities?.scopeLabels ?? []),
  ];
  const seen = new Set<string>();
  return labels.filter((label) => {
    const key = label.trim().toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) {
    return 'unknown';
  }
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) {
    return 'unknown';
  }
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function statusClass(state: string | undefined): string {
  const normalized = (state ?? 'unknown').toLowerCase();
  if (normalized === 'healthy' || normalized === 'ready' || normalized === 'bound' || normalized === 'active' || normalized === 'accepted') {
    return 'entity-ops-chip-green';
  }
  if (normalized === 'degraded' || normalized === 'stale') {
    return 'entity-ops-chip-blue';
  }
  if (normalized === 'unavailable' || normalized === 'disabled') {
    return 'entity-ops-chip-red';
  }
  return '';
}

function isSameAgent(task: TaskBoardTask, agent: RegistryAgent | null, fallbackId: string, fallbackName: string): boolean {
  const taskAssignee = normalizeIdentity(task.assignee);
  if (!taskAssignee) {
    return false;
  }
  const keys = [fallbackId, fallbackName, agent?.id, agent?.slug, agent?.name]
    .map(normalizeIdentity)
    .filter(Boolean);
  return keys.includes(taskAssignee);
}

function recurringLabels(agent: RegistryAgent | null, tasks: TaskBoardTask[], fallbackId: string, fallbackName: string): string[] {
  const taskLabels = tasks
    .filter((task) => task.recurring && isSameAgent(task, agent, fallbackId, fallbackName))
    .slice(0, 3)
    .map((task) => task.name);
  const metadata = parseMetadata(agent?.metadata_json);
  const metadataLabels = [
    ...toStringList(metadata.crons),
    ...toStringList(metadata.loops),
    ...toStringList(metadata.schedules),
  ];
  return [...taskLabels, ...metadataLabels].slice(0, 4);
}

export default function AgentManagementSurface({
  agentId,
  agentName,
  runtime,
  model,
  currentTaskTitle,
  runtimeStatus,
  tasks,
}: AgentManagementSurfaceProps) {
  const [registryAgents, setRegistryAgents] = useState<RegistryAgent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [controlResult, setControlResult] = useState<ControlResult | null>(null);
  const [controlLoading, setControlLoading] = useState<HelmLightControlAction | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/agents/registry')
      .then((response) => {
        if (!response.ok) {
          throw new Error(`registry ${response.status}`);
        }
        return response.json();
      })
      .then((json: { list?: RegistryAgent[] }) => {
        if (!cancelled) {
          setRegistryAgents(Array.isArray(json.list) ? json.list : []);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load agent registry');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const registryAgent = useMemo(() => {
    const targetKeys = [agentId, agentName].map(normalizeIdentity).filter(Boolean);
    return registryAgents.find((agent) => {
      const keys = [agent.id, agent.slug, agent.name].map(normalizeIdentity).filter(Boolean);
      return keys.some((key) => targetKeys.includes(key));
    }) ?? null;
  }, [agentId, agentName, registryAgents]);

  const effectiveRuntimeStatus = registryAgent?.runtime_status ?? registryAgent?.runtimeStatus ?? runtimeStatus;
  const bindingState = registryAgent?.binding_state ?? 'unknown';
  const capabilityLabels = labelsFromCapabilities(registryAgent?.capabilities);
  const schedules = recurringLabels(registryAgent, tasks, agentId, agentName);
  const runtimeLabel = registryAgent?.capabilities?.runtimeLabel || runtime;
  const currentWork = effectiveRuntimeStatus?.current_work || currentTaskTitle;
  const runtimeBindingId = registryAgent?.runtime_binding_id || effectiveRuntimeStatus?.binding_id || '';
  const helmDeepLink = effectiveRuntimeStatus?.helm_link && /^https?:\/\//.test(effectiveRuntimeStatus.helm_link)
    ? effectiveRuntimeStatus.helm_link
    : null;
  const controlsAllowed = Boolean(
    registryAgent?.helm_managed &&
    runtimeBindingId &&
    bindingState === 'bound' &&
    effectiveRuntimeStatus?.state !== 'unavailable',
  );
  const controlDisabledReason = controlsAllowed
    ? ''
    : !registryAgent?.helm_managed
      ? 'Not Helm-managed.'
      : !runtimeBindingId
        ? 'Missing runtime binding.'
        : bindingState !== 'bound'
          ? `Binding is ${titleCase(bindingState)}.`
          : 'Runtime unavailable.';

  const requestControl = async (action: HelmLightControlAction) => {
    if (!registryAgent || !controlsAllowed) {
      setControlResult({ accepted: false, status: 'denied', action, reason: controlDisabledReason || 'control_not_allowed' });
      return;
    }
    setControlLoading(action);
    setControlResult(null);
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(registryAgent.id)}/runtime-controls`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, actorPrincipalId: 'entity-ui' }),
      });
      const json = await response.json().catch(() => ({})) as ControlResult & { error?: string };
      setControlResult({
        accepted: Boolean(json.accepted),
        status: json.status ?? (response.ok ? 'accepted' : 'unavailable'),
        action,
        reason: json.reason || json.error || `runtime control ${response.status}`,
        audit: json.audit,
      });
    } catch (err) {
      setControlResult({
        accepted: false,
        status: 'unavailable',
        action,
        reason: err instanceof Error ? err.message : 'runtime control unavailable',
      });
    } finally {
      setControlLoading(null);
    }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      {error && (
        <div className="entity-ops-panel border-[var(--error)] px-3 py-2 text-xs text-[var(--error)] lg:col-span-2" role="status">
          Agent registry unavailable. Management details are partially degraded: {error}
        </div>
      )}

      <section className="entity-ops-panel px-4 py-3">
        <div className="entity-ops-section-title">Agent Management</div>
        <div className="mt-2 text-lg font-semibold text-[var(--text-primary)]">{registryAgent?.name ?? agentName}</div>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {registryAgent?.description || 'Registry-backed agent identity and work-plane readiness.'}
        </p>
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Identity</dt>
            <dd className="mt-1 font-mono text-xs text-[var(--text-primary)]">{registryAgent?.slug ?? agentId}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Lifecycle</dt>
            <dd className={`entity-ops-chip mt-1 ${statusClass(registryAgent?.status)}`}>{titleCase(registryAgent?.status ?? 'unknown')}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Runtime</dt>
            <dd className="mt-1 text-[var(--text-primary)]">{runtimeLabel || 'registry'}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Model</dt>
            <dd className="mt-1 text-[var(--text-primary)]">{model || 'default resolving'}</dd>
          </div>
        </dl>
      </section>

      <section className="entity-ops-panel px-4 py-3">
        <div className="entity-ops-section-title">Runtime Binding</div>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Binding state</div>
            <div className={`entity-ops-chip mt-1 ${statusClass(bindingState)}`}>{titleCase(bindingState)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Runtime status</div>
            <div className={`entity-ops-chip mt-1 ${statusClass(effectiveRuntimeStatus?.state)}`}>
              {titleCase(effectiveRuntimeStatus?.state ?? 'unknown')}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Binding ID</div>
            <div className="mt-1 truncate font-mono text-xs text-[var(--text-primary)]">
              {registryAgent?.runtime_binding_id || effectiveRuntimeStatus?.binding_id || 'not bound'}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Checked</div>
            <div className="mt-1 text-[var(--text-primary)]">{formatRelative(effectiveRuntimeStatus?.checked_at)}</div>
          </div>
        </div>
        <p className="mt-3 text-xs text-[var(--text-secondary)]">
          Runtime setup and deep configuration stay outside Entity. This surface shows work-plane readiness only.
        </p>
        <div className="mt-3 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)]/35 px-3 py-2 text-xs">
          <div className="text-[var(--text-muted)]">Helm deep link</div>
          {helmDeepLink ? (
            <a href={helmDeepLink} target="_blank" rel="noreferrer" className="mt-1 inline-flex text-[var(--accent)]">
              Open in Helm for deep admin/configuration
            </a>
          ) : (
            <div className="mt-1 text-[var(--text-secondary)]">No Helm deep link reported.</div>
          )}
        </div>
      </section>

      <section className="entity-ops-panel px-4 py-3 lg:col-span-2">
        <div className="entity-ops-section-title">Safe Light Controls</div>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Entity only requests reversible actions after policy checks. Deep runtime administration remains in Helm.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {SAFE_CONTROLS.map((control) => (
            <button
              key={control.action}
              type="button"
              className="mc-shell-btn px-3 py-1.5 text-xs"
              disabled={!controlsAllowed || controlLoading !== null}
              title={controlsAllowed ? control.label : controlDisabledReason}
              onClick={() => void requestControl(control.action)}
            >
              {controlLoading === control.action ? 'Requesting...' : control.label}
            </button>
          ))}
        </div>
        {!controlsAllowed && (
          <div className="mt-2 text-xs text-[var(--text-muted)]">Controls unavailable: {controlDisabledReason}</div>
        )}
        {controlResult && (
          <div className={`mt-3 rounded border border-[var(--border-primary)] px-3 py-2 text-xs ${controlResult.accepted ? 'text-[var(--success)]' : 'text-[var(--text-secondary)]'}`} role="status">
            <div>
              {titleCase(controlResult.action)}: {titleCase(controlResult.status)} - {titleCase(controlResult.reason)}
            </div>
            <div className="mt-1 text-[var(--text-muted)]">
              Audit: {controlResult.audit?.event_type ?? 'local request'} · policy {String(controlResult.audit?.policy_allowed ?? controlResult.accepted)} · forwarded {String(controlResult.audit?.forwarded_to_helm ?? false)}
            </div>
          </div>
        )}
      </section>

      <section className="entity-ops-panel px-4 py-3">
        <div className="entity-ops-section-title">Capabilities and Skills</div>
        {capabilityLabels.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {capabilityLabels.map((label) => (
              <span key={label} className="entity-ops-chip">{label}</span>
            ))}
          </div>
        ) : (
          <div className="mt-3 text-sm text-[var(--text-secondary)]">No capability grants reported.</div>
        )}
        <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
          <div>
            <div className="text-[var(--text-muted)]">Owner</div>
            <div className="mt-1 text-[var(--text-primary)]">{registryAgent?.capabilities?.ownerLabel ?? 'Entity'}</div>
          </div>
          <div>
            <div className="text-[var(--text-muted)]">Verification</div>
            <div className="mt-1 text-[var(--text-primary)]">{registryAgent?.capabilities?.verificationLabel ?? 'Registry pending'}</div>
          </div>
        </div>
      </section>

      <section className="entity-ops-panel px-4 py-3">
        <div className="entity-ops-section-title">Work and Recurring Loops</div>
        <div className="mt-3 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)]/35 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Current work</div>
          <div className="mt-1 text-sm text-[var(--text-primary)]">{currentWork || 'No active work reported.'}</div>
        </div>
        <div className="mt-3 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)]/35 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Recurring crons/loops</div>
          {schedules.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {schedules.map((label) => (
                <span key={label} className="entity-ops-chip">{label}</span>
              ))}
            </div>
          ) : (
            <div className="mt-1 text-sm text-[var(--text-secondary)]">No recurring work visible for this agent.</div>
          )}
        </div>
        {effectiveRuntimeStatus?.reason && (
          <div className="mt-3 text-xs text-[var(--text-secondary)]">
            Runtime reason: {titleCase(effectiveRuntimeStatus.reason)}
          </div>
        )}
      </section>
    </div>
  );
}
