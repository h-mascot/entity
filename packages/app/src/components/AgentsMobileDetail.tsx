import { useMemo } from 'react';
import type { ActivityEntry } from '../hooks/useActivityStream';

interface AgentsMobileDetailProps {
  agent: {
    id: string;
    name: string;
    emoji: string;
    avatarUrl?: string;
    model: string;
    gateway: string;
    status: 'online' | 'offline';
  };
  activities: ActivityEntry[];
  tasks: Array<{ id: number; name: string; column: string; assignee: string; priority: string }>;
  onBack: () => void;
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
}

function safeParseMetadata(metadata?: string): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(metadata) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  return null;
}

function isErrorLike(entry: ActivityEntry): boolean {
  const meta = safeParseMetadata(entry.metadata);
  const level = typeof meta?.level === 'string' ? meta.level.toLowerCase() : null;
  const status = typeof meta?.status === 'string' ? meta.status.toLowerCase() : null;
  if (level === 'error' || status === 'error') {
    return true;
  }
  const haystack = `${entry.action ?? ''} ${entry.description ?? ''}`.toLowerCase();
  return /(error|failed|exception|traceback)\b/.test(haystack);
}

function priorityRank(priority: string): number {
  switch ((priority || '').toUpperCase()) {
    case 'P0':
      return 0;
    case 'P1':
      return 1;
    case 'P2':
      return 2;
    case 'P3':
      return 3;
    default:
      return 9;
  }
}

function priorityBadgeClass(priority: string): string {
  switch ((priority || '').toUpperCase()) {
    case 'P0':
      return 'border-[var(--error)] bg-[var(--bg-secondary)] text-[var(--error)]';
    case 'P1':
      return 'border-[var(--accent)] bg-[var(--bg-secondary)] text-[var(--accent)]';
    case 'P2':
      return 'border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)]';
    case 'P3':
      return 'border-[var(--border-secondary)] bg-[var(--bg-secondary)] text-[var(--text-muted)]';
    default:
      return 'border-[var(--border-secondary)] bg-[var(--bg-secondary)] text-[var(--text-muted)]';
  }
}

function formatActivityTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
  if (sameDay) {
    return time;
  }
  const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  return `${day} · ${time}`;
}

function isAssigneeMatch(assignee: string, agent: AgentsMobileDetailProps['agent']): boolean {
  const normalized = (assignee || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return normalized === agent.name.trim().toLowerCase() || normalized === agent.id.trim().toLowerCase();
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="mc-shell-card border border-[var(--border-primary)] bg-[var(--card-bg)] px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{value}</div>
    </div>
  );
}

export default function AgentsMobileDetail({ agent, activities, tasks, onBack }: AgentsMobileDetailProps) {
  const agentKey = agent.name.trim().toLowerCase();

  const agentActivities = useMemo(() => {
    const filtered = activities.filter((entry) => (entry.agentName || '').trim().toLowerCase() === agentKey);
    return filtered
      .slice()
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [activities, agentKey]);

  const recentActivities = useMemo(() => agentActivities.slice(0, 10), [agentActivities]);

  const recentFileEdit = useMemo(() => {
    return agentActivities.find((entry) => entry.type === 'file_edit' && entry.filePath) ?? null;
  }, [agentActivities]);

  const assignedTasks = useMemo(() => tasks.filter((task) => isAssigneeMatch(task.assignee, agent)), [agent, tasks]);
  const currentTask = useMemo(() => {
    const doing = assignedTasks.filter((task) => (task.column || '').toLowerCase() === 'doing');
    if (doing.length === 0) {
      return null;
    }
    const sorted = doing.slice().sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
    return sorted[0] ?? null;
  }, [assignedTasks]);

  const stats = useMemo(() => {
    const uniqueFiles = new Set(
      agentActivities
        .filter((entry) => entry.type === 'file_edit' && entry.filePath)
        .map((entry) => (entry.filePath ?? '').trim())
        .filter(Boolean)
    );
    const messages = agentActivities.filter((entry) => entry.type === 'message_sent').length;
    const errors = agentActivities.filter(isErrorLike).length;
    return {
      tasks: assignedTasks.length,
      files: uniqueFiles.size,
      messages,
      errors,
    };
  }, [agentActivities, assignedTasks.length]);

  return (
    <div className="min-h-full w-full bg-[var(--bg-primary)] px-3 pb-6 pt-3 text-[var(--text-primary)]">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="mc-shell-btn inline-flex h-11 min-h-11 items-center gap-2 px-3 text-sm text-[var(--text-primary)]"
          aria-label="Back to agents"
        >
          <span aria-hidden="true">←</span>
          <span>Back</span>
        </button>
      </div>

      <div className="mc-shell-card mb-3 border border-[var(--border-primary)] bg-[var(--card-bg)] p-4">
        <div className="flex items-start gap-3">
          {agent.avatarUrl ? (
            <img
              src={agent.avatarUrl}
              alt={agent.name}
              className="h-12 w-12 min-h-12 min-w-12 shrink-0 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-12 w-12 min-h-12 min-w-12 items-center justify-center rounded-full bg-[var(--bg-tertiary)] text-xl">
              {agent.emoji}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="min-w-0 truncate text-lg font-semibold text-[var(--text-primary)]">{agent.name}</div>
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: agent.status === 'online' ? 'var(--success)' : 'var(--text-muted)' }}
                aria-label={agent.status === 'online' ? 'Online' : 'Offline'}
                title={agent.status === 'online' ? 'Online' : 'Offline'}
              />
            </div>
            <div className="mt-1 text-xs text-[var(--text-secondary)]">
              <span className="truncate">{agent.model || '—'}</span>
              <span className="mx-1 text-[var(--text-muted)]">·</span>
              <span className="truncate">{agent.gateway || '—'}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="Tasks" value={stats.tasks} />
        <StatCard label="Files" value={stats.files} />
        <StatCard label="Messages" value={stats.messages} />
        <StatCard label="Errors" value={stats.errors} />
      </div>

      {currentTask ? (
        <div className="mc-shell-card mb-3 border border-[var(--border-primary)] bg-[var(--card-bg)] p-4">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Current task</div>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-[var(--text-primary)]" title={currentTask.name}>
                {currentTask.name}
              </div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">Doing</div>
            </div>
            <span
              className={`inline-flex h-7 min-h-7 items-center rounded-full border px-2 text-xs font-medium ${priorityBadgeClass(
                currentTask.priority
              )}`}
            >
              {(currentTask.priority || 'P2').toUpperCase()}
            </span>
          </div>
        </div>
      ) : null}

      {recentFileEdit?.filePath ? (
        <div className="mc-shell-card mb-3 border border-[var(--border-primary)] bg-[var(--card-bg)] p-4">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Working on</div>
          <div className="text-sm text-[var(--text-secondary)]">
            <span className="text-[var(--text-muted)]">Currently editing:</span>{' '}
            <span className="font-medium text-[var(--text-primary)]" title={recentFileEdit.filePath}>
              {basename(recentFileEdit.filePath)}
            </span>
          </div>
        </div>
      ) : null}

      <div className="mc-shell-card border border-[var(--border-primary)] bg-[var(--card-bg)] p-4">
        <div className="mb-3 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Recent activity</div>

        {recentActivities.length === 0 ? (
          <div className="text-sm text-[var(--text-muted)]">No activity yet.</div>
        ) : (
          <div className="flex flex-col">
            {recentActivities.map((entry, index) => (
              <div
                key={entry.id}
                className={`flex min-h-11 items-start justify-between gap-3 py-2 ${
                  index === recentActivities.length - 1 ? '' : 'border-b border-[var(--border-primary)]'
                }`}
              >
                <div className="shrink-0 pt-0.5 text-[11px] text-[var(--text-muted)]" title={entry.timestamp}>
                  {formatActivityTimestamp(entry.timestamp)}
                </div>
                <div className="min-w-0 flex-1 text-sm text-[var(--text-secondary)]">
                  <div className="break-words">{entry.description || entry.action || 'Activity'}</div>
                  {entry.type === 'file_edit' && entry.filePath ? (
                    <div className="mt-1 truncate text-xs text-[var(--text-muted)]" title={entry.filePath}>
                      {entry.filePath}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
