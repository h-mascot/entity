import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityEntry, ActivityType } from '../hooks/useActivityStream';

interface ActivityStreamProps {
  activities: ActivityEntry[];
  isOpen: boolean;
  onToggleOpen: () => void;
  onOpenFile: (path: string) => void;
  onOpenTask?: (taskId: number) => void;
  fillHeight?: boolean;
  loading?: boolean;
  error?: string | null;
}

const TYPE_ICON: Record<ActivityType, string> = {
  file_edit: '📝',
  tool_call: '🛠️',
  message_sent: '💬',
  command_run: '⌘',
  research: '🔎',
  thinking: '🧠',
  task_created: '📥',
  task_updated: '✏️',
  task_moved: '📦',
  task_completed: '✅',
  task_deleted: '🗑️',
  task_comment: '💬',
};

function formatTypeLabel(type: ActivityType): string {
  return type.split('_').join(' ');
}

function formatRelativeTime(timestamp: string, nowMs: number): string {
  const ts = new Date(timestamp).getTime();
  if (Number.isNaN(ts)) return 'now';
  const delta = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (delta < 60) return `${delta}s`;
  const mins = Math.floor(delta / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

/* ── Grouping logic ── */
interface ActivityGroup {
  key: string;
  agentName: string;
  agentEmoji: string;
  entries: ActivityEntry[];
}

function groupActivities(activities: ActivityEntry[]): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  for (const entry of activities) {
    const last = groups[groups.length - 1];
    if (last && last.agentName === entry.agentName && last.entries.length < 20) {
      last.entries.push(entry);
    } else {
      groups.push({
        key: entry.id,
        agentName: entry.agentName,
        agentEmoji: entry.agentEmoji,
        entries: [entry],
      });
    }
  }
  return groups;
}

/* ── Single activity row ── */
function ActivityRow({
  entry,
  nowMs,
  expanded,
  onToggle,
  onOpenFile,
  onOpenTask,
}: {
  entry: ActivityEntry;
  nowMs: number;
  expanded: boolean;
  onToggle: () => void;
  onOpenFile: (path: string) => void;
  onOpenTask?: (taskId: number) => void;
}) {
  const time = formatRelativeTime(entry.timestamp, nowMs);

  return (
    <button
      type="button"
      className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
      onClick={() => {
        if (entry.taskId !== undefined) onOpenTask?.(entry.taskId);
        else if (entry.filePath) onOpenFile(entry.filePath);
        else onToggle();
      }}
      title={expanded ? undefined : entry.description}
    >
      <div className="flex items-center gap-1.5 text-xs">
        <span className="opacity-60">{TYPE_ICON[entry.type]}</span>
        <span className="font-medium text-[var(--text-primary)] truncate flex-1">
          {entry.action}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] shrink-0">
          {formatTypeLabel(entry.type)}
        </span>
        <span className="text-[var(--text-muted)] text-[10px] shrink-0 ml-1 tabular-nums">{time}</span>
      </div>
      {expanded && (
        <div className="mt-1 ml-5 text-xs space-y-1">
          <div className="text-[var(--text-secondary)]">{entry.description}</div>
          {entry.taskId !== undefined && (
            <div
              className="text-[var(--accent)] cursor-pointer hover:underline"
              onClick={(e) => { e.stopPropagation(); onOpenTask?.(entry.taskId!); }}
            >
              → Task #{entry.taskId}{entry.taskColumn ? ` · ${entry.taskColumn}` : ''}
            </div>
          )}
          {entry.filePath && (
            <div
              className="text-[var(--accent)] cursor-pointer hover:underline"
              onClick={(e) => { e.stopPropagation(); onOpenFile(entry.filePath!); }}
            >
              → {entry.filePath}
            </div>
          )}
        </div>
      )}
    </button>
  );
}

/* ── Grouped block ── */
function GroupBlock({
  group,
  nowMs,
  onOpenFile,
  onOpenTask,
}: {
  group: ActivityGroup;
  nowMs: number;
  onOpenFile: (path: string) => void;
  onOpenTask?: (taskId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const isSingle = group.entries.length === 1;
  const newest = group.entries[0];
  const oldest = group.entries[group.entries.length - 1];
  const timeRange = formatRelativeTime(newest.timestamp, nowMs);

  if (isSingle) {
    return (
      <div className="mc-shell-card border border-[var(--border-primary)] rounded-lg overflow-hidden">
        <div className="flex items-center gap-1.5 px-3 pt-2 pb-0.5">
          <span className="text-sm">{group.agentEmoji}</span>
          <span className="text-xs font-semibold text-[var(--text-primary)]">{group.agentName}</span>
        </div>
        <ActivityRow
          entry={newest}
          nowMs={nowMs}
          expanded={expandedEntryId === newest.id}
          onToggle={() => setExpandedEntryId(expandedEntryId === newest.id ? null : newest.id)}
          onOpenFile={onOpenFile}
          onOpenTask={onOpenTask}
        />
      </div>
    );
  }

  return (
    <div className="mc-shell-card border border-[var(--border-primary)] rounded-lg overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-1.5 px-3 py-2 hover:bg-[var(--bg-tertiary)] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-sm">{group.agentEmoji}</span>
        <span className="text-xs font-semibold text-[var(--text-primary)]">{group.agentName}</span>
        <span className="text-[10px] text-[var(--text-muted)] ml-1">
          {group.entries.length} actions
        </span>
        <span className="ml-auto text-[10px] text-[var(--text-muted)] tabular-nums">{timeRange}</span>
        <span className="text-[10px] text-[var(--text-muted)] ml-1">{expanded ? '▼' : '▶'}</span>
      </button>
      {!expanded && (
        <div className="px-3 pb-2 text-xs text-[var(--text-secondary)] truncate">
          {newest.action} · {newest.description}
        </div>
      )}
      {expanded && (
        <div className="border-t border-[var(--border-primary)]">
          {group.entries.map((entry) => (
            <ActivityRow
              key={entry.id}
              entry={entry}
              nowMs={nowMs}
              expanded={expandedEntryId === entry.id}
              onToggle={() => setExpandedEntryId(expandedEntryId === entry.id ? null : entry.id)}
              onOpenFile={onOpenFile}
              onOpenTask={onOpenTask}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main component ── */
export default function ActivityStream({
  activities,
  isOpen,
  onToggleOpen,
  onOpenFile,
  onOpenTask,
  fillHeight = false,
  loading = false,
  error = null,
}: ActivityStreamProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const listRef = useRef<HTMLDivElement | null>(null);

  const sortedActivities = useMemo(() => [...activities].reverse(), [activities]);
  const groups = useMemo(() => groupActivities(sortedActivities), [sortedActivities]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (isOpen && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [isOpen, sortedActivities]);

  return (
    <div
      className={`border-t border-[var(--border-primary)] bg-[var(--bg-primary)] ${
        fillHeight ? 'flex h-full min-h-0 flex-col' : ''
      }`}
    >
      <div
        className={`flex items-center justify-between bg-[var(--bg-secondary)] px-4 py-2 ${
          isOpen ? 'border-b border-[var(--border-primary)]' : ''
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[var(--text-secondary)]">Recent Activity</span>
          {activities.length > 0 && (
            <span className="text-[10px] text-[var(--text-muted)]">{activities.length}</span>
          )}
        </div>
        <button type="button" onClick={onToggleOpen} className="mc-shell-btn px-2 py-1 text-xs">
          {isOpen ? 'Hide' : 'Show'}
        </button>
      </div>

      {isOpen && (
        <div
          ref={listRef}
          className={`overflow-y-auto px-2 py-2 space-y-1.5 ${fillHeight ? 'flex-1 min-h-0' : 'h-80'}`}
        >
          {error ? (
            <div className="px-2 py-3 text-sm text-[var(--error)]">Activity unavailable: {error}</div>
          ) : groups.length === 0 ? (
            <div className="px-2 py-3 text-sm text-[var(--text-muted)]">
              {loading ? 'Loading activity…' : 'Waiting for activity…'}
            </div>
          ) : (
            groups.map((group) => (
              <GroupBlock
                key={group.key}
                group={group}
                nowMs={nowMs}
                onOpenFile={onOpenFile}
                onOpenTask={onOpenTask}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
