import { useEffect, useMemo, useState } from 'react';
import type { ActivityEntry } from '../hooks/useActivityStream';
import type { TaskBoardTask } from '../hooks/useTaskBoard';

interface AgentCapability {
  adapterType?: string;
  runtimeType?: string;
  moduleCount?: number;
  status?: string;
  ownerLabel?: string;
  verificationLabel?: string;
  capabilityLabels?: string[];
  permissionLabels?: string[];
  scopeLabels?: string[];
  runtimeLabel?: string;
  identityLabel?: string;
}

interface SidebarAgent {
  id: string;
  name: string;
  emoji: string;
  avatarUrl?: string;
  description?: string;
  focusFile?: string;
  model: string;
  runtime: string;
  status: 'online' | 'offline';
  rawStatus?: string;
  adapterType?: string;
  runtimeType?: string;
  lastActivity?: {
    action: string;
    timestamp: string;
  };
  capabilities?: AgentCapability;
}

interface AgentFocus {
  filePath: string;
  fileName: string;
  lastEditMs: number;
}

interface AgentsSidebarTabProps {
  agents: SidebarAgent[];
  agentsLoading: boolean;
  agentsError: string | null;
  selectedAgentId: string | null;
  followingAgentId: string | null;
  watchMode: boolean;
  activities: ActivityEntry[];
  onSelectAgent: (agentId: string | null) => void;
  onFollowAgent: (agentId: string | null) => void;
  onSetFollowDetached: (detached: boolean) => void;
  onOpenFile: (path: string) => void;
  tasks?: TaskBoardTask[];
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeIdentity(value: unknown): string {
  return normalizeText(value).toLowerCase().replace(/[\s_-]+/g, '');
}

function buildIdentityKeys(agent: Pick<SidebarAgent, 'id' | 'name'>): string[] {
  const keys = new Set<string>();
  const normalizedId = normalizeIdentity(agent.id);
  const normalizedName = normalizeIdentity(agent.name);

  if (normalizedId) {
    keys.add(normalizedId);
  }
  if (normalizedName) {
    keys.add(normalizedName);
  }

  return Array.from(keys);
}

function parseMetadataRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function matchesAgentIdentity(agent: Pick<SidebarAgent, 'id' | 'name'>, candidate: unknown): boolean {
  const normalizedCandidate = normalizeIdentity(candidate);
  if (!normalizedCandidate) {
    return false;
  }

  return buildIdentityKeys(agent).includes(normalizedCandidate);
}

const ACTIVE_WRITING_WINDOW_MS = 10_000;
const IDLE_WINDOW_MS = 60_000;

function AgentAvatar({ agent }: { agent: SidebarAgent }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setImageFailed(false);
  }, [agent.avatarUrl]);

  if (agent.avatarUrl && !imageFailed) {
    return (
      <img
        src={agent.avatarUrl}
        alt={agent.name}
        className="h-9 w-9 min-w-9 shrink-0 rounded-full object-cover"
        onError={() => setImageFailed(true)}
      />
    );
  }

  const fallback = agent.emoji || agent.name.slice(0, 2).toUpperCase();
  return (
    <span className="flex h-9 w-9 min-w-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface-muted)] text-lg">
      {fallback}
    </span>
  );
}

export default function AgentsSidebarTab({
  agents,
  agentsLoading,
  agentsError,
  selectedAgentId,
  followingAgentId,
  watchMode,
  activities,
  onSelectAgent,
  onFollowAgent,
  onSetFollowDetached,
}: AgentsSidebarTabProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  const focusByAgentId = useMemo(() => {
    const map = new Map<string, AgentFocus>();

    for (const agent of agents) {
      if (!agent.focusFile) continue;

      const tsMs = Date.parse(agent.lastActivity?.timestamp ?? '');
      if (!Number.isFinite(tsMs)) continue;

      map.set(agent.id, {
        filePath: agent.focusFile,
        fileName: basename(agent.focusFile),
        lastEditMs: tsMs,
      });
    }

    // Activities arrive newest-first. Take the first matching file_edit per agent as their current file.
    for (const entry of activities) {
      if (entry.type !== 'file_edit') continue;
      if (!entry.filePath) continue;

      const tsMs = Date.parse(entry.timestamp);
      if (!Number.isFinite(tsMs)) continue;

      const metadata = parseMetadataRecord(entry.metadata);
      const assignee = metadata?.assignee;

      const agent = agents.find((candidate) => {
        if (map.has(candidate.id)) {
          return false;
        }

        return (
          matchesAgentIdentity(candidate, entry.agentName) ||
          matchesAgentIdentity(candidate, assignee)
        );
      });

      if (!agent) continue;

      map.set(agent.id, {
        filePath: entry.filePath,
        fileName: basename(entry.filePath),
        lastEditMs: tsMs,
      });
    }

    return map;
  }, [activities, agents]);

  const onlineCount = agents.filter((agent) => agent.status === 'online').length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="entity-ops-panel-strong px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="entity-ops-section-title">Crew</div>
            <div className="mt-0.5 text-sm font-semibold text-[var(--text-primary)]">
              {onlineCount}/{agents.length} online
            </div>
          </div>
          <span
            className={`entity-ops-chip max-md:flex max-md:min-h-[44px] max-md:items-center max-md:px-4 max-md:text-[13px] max-md:font-medium max-md:capitalize ${
              onlineCount > 0 ? 'entity-ops-chip-green' : ''
            }`}
          >
            {watchMode ? 'watching' : 'select'}
          </span>
        </div>
      </div>

      {agentsLoading && (
        <div className="entity-ops-panel border px-3 py-2 text-xs text-[var(--text-muted)]">Loading agents…</div>
      )}
      {agentsError && (
        <div className="entity-ops-panel border border-[var(--error)] px-3 py-2 text-xs text-[var(--error)]">
          OpenClaw unavailable. Showing fallback agent data.
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
        {agents.map((agent) => {
          const isOnline = agent.status === 'online';
          const isSelected = selectedAgentId === agent.id;
          const isFollowing = watchMode && followingAgentId === agent.id;
          const focus = focusByAgentId.get(agent.id) ?? null;
          const isWriting = focus ? nowMs - focus.lastEditMs <= ACTIVE_WRITING_WINDOW_MS : false;
          const statusLabel = isOnline ? (isWriting ? 'writing' : 'online') : 'offline';
          const capabilityLabels = agent.capabilities?.capabilityLabels ?? [];
          const permissionLabels = agent.capabilities?.permissionLabels ?? [];
          const scopeLabels = agent.capabilities?.scopeLabels ?? [];

          return (
            <button
              key={agent.id}
              onClick={() => {
                if (watchMode) {
                  onFollowAgent(agent.id);
                  onSelectAgent(agent.id);
                  onSetFollowDetached(false);
                  return;
                }
                onSelectAgent(agent.id);
              }}
              className={`entity-ops-row entity-ops-focus w-full p-2.5 text-left max-md:min-h-[56px] max-md:rounded-2xl max-md:px-4 max-md:py-3.5 ${
                isSelected
                  ? 'border-[var(--accent)] bg-[var(--surface-accent)] text-[var(--text-primary)] shadow-[inset_3px_0_0_var(--accent)]'
                  : isFollowing
                    ? 'border-[var(--accent)] text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)]'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <AgentAvatar agent={agent} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold text-[var(--text-primary)]">{agent.name}</span>
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        isOnline ? (isWriting ? 'mc-agent-writing-dot' : 'bg-[var(--success)]') : 'bg-[var(--text-muted)]'
                      }`}
                    />
                    <span className={`entity-ops-chip ml-auto ${isOnline ? 'entity-ops-chip-green' : ''}`}>
                      {statusLabel}
                    </span>
                  </div>
                  <div className="mt-1 space-y-0.5 text-[11px] text-[var(--text-muted)]">
                    <div className="truncate">
                      <span className="text-[var(--text-secondary)]">Runtime</span> · {agent.runtime || 'registry'}
                    </div>
                    <div className="truncate">
                      <span className="text-[var(--text-secondary)]">Model</span> · {agent.model || 'default resolving'}
                    </div>
                  </div>
                  <div className="mt-2 grid gap-1 text-[11px] text-[var(--text-muted)]">
                    <div className="truncate">
                      <span className="text-[var(--text-secondary)]">Owner</span> · {agent.capabilities?.ownerLabel || 'Entity'}
                    </div>
                    <div className="truncate">
                      <span className="text-[var(--text-secondary)]">Verification</span> · {agent.capabilities?.verificationLabel || 'Registry'}
                    </div>
                  </div>
                  {(capabilityLabels.length > 0 || permissionLabels.length > 0 || scopeLabels.length > 0) && (
                    <div className="mt-2 space-y-1">
                      {capabilityLabels.length > 0 && (
                        <div className="flex min-w-0 flex-wrap gap-1">
                          {capabilityLabels.map((label) => (
                            <span key={'capability-' + label} className="entity-ops-chip max-w-full truncate">
                              {label}
                            </span>
                          ))}
                        </div>
                      )}
                      {permissionLabels.length > 0 && (
                        <div className="flex min-w-0 flex-wrap gap-1">
                          {permissionLabels.map((label) => (
                            <span key={'permission-' + label} className="entity-ops-chip max-w-full truncate">
                              {label}
                            </span>
                          ))}
                        </div>
                      )}
                      {scopeLabels.length > 0 && (
                        <div className="flex min-w-0 flex-wrap gap-1">
                          {scopeLabels.map((label) => (
                            <span key={'scope-' + label} className="entity-ops-chip max-w-full truncate">
                              {label}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {isFollowing && (
                <div className="mt-2 text-[11px] font-medium uppercase tracking-wide text-[var(--accent)]">
                  Following in watch mode
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
