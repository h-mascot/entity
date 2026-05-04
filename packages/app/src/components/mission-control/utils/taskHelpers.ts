import type { TaskBoardTask } from '../../../hooks/useTaskBoard';

// Type values from API response
const PASSIVE_TYPE_VALUES = new Set(['task_updated', 'agent_note', 'note', 'status_updated', 'task_comment']);

// Action display strings that indicate passive activity (not real work)
const PASSIVE_ACTION_STRINGS = new Set(['updated task', 'added comment', 'created task', 'moved task']);

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function getTaskProjectNames(task: Pick<TaskBoardTask, 'project' | 'projects'>): string[] {
  const structuredNames = task.projects
    .map((project) => project.name.trim())
    .filter(Boolean);

  if (structuredNames.length > 0) {
    return structuredNames;
  }

  const names: string[] = [];
  const seen = new Set<string>();
  for (const rawName of task.project.split(',')) {
    const trimmed = rawName.trim();
    const normalized = trimmed.toLowerCase();
    if (!trimmed || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    names.push(trimmed);
  }

  return names;
}

export function formatTaskProjectSummary(task: Pick<TaskBoardTask, 'project' | 'projects'>): string {
  const names = getTaskProjectNames(task);
  return names.length > 0 ? names.join(', ') : 'General';
}

export function hasTaskProjectName(task: Pick<TaskBoardTask, 'project' | 'projects'>, projectName: string): boolean {
  const normalizedTarget = projectName.trim().toLowerCase();
  if (!normalizedTarget) {
    return false;
  }

  return getTaskProjectNames(task).some((name) => name.toLowerCase() === normalizedTarget);
}

export function statusClass(column: string | null | undefined, blocked?: boolean): string {
  if (blocked) return 'status-blocked';
  const normalized = (column ?? '').toLowerCase();
  if (normalized === 'backlog') return 'status-backlog';
  if (normalized === 'todo') return 'status-todo';
  if (normalized === 'doing' || normalized === 'in-progress') return 'status-doing';
  if (normalized === 'review') return 'status-review';
  if (normalized === 'done' || normalized === 'complete') return 'status-done';
  return 'status-backlog';
}

export function isTransientBlocker(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return reason.includes('fetch failed') || reason.includes('Agent trigger failed');
}

export function formatBlockerReason(reason: string | null | undefined): string {
  if (!reason) return '';
  if (reason.includes('Agent trigger failed') && reason.includes('fetch failed')) {
    return 'Agent connection failed — will retry';
  }
  if (reason.includes('fetch failed')) {
    return 'Connection error — check agent status';
  }
  return reason;
}

export function getTimeAgo(timestamp: string | null | undefined): string {
  if (!timestamp) return 'just now';
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  if (Number.isNaN(then)) return 'just now';

  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function hasRecentTaskActivity(task: TaskBoardTask): boolean {
  const latest = task.activity?.[0];
  if (!latest) return false;

  const latestTime = new Date(latest.created_at).getTime();
  if (Number.isNaN(latestTime)) return false;

  // Check type field (API enum like "task_updated") - may exist at runtime
  const typeVal = ((latest as unknown as Record<string, unknown>).type as string ?? '').toLowerCase();
  if (PASSIVE_TYPE_VALUES.has(typeVal)) return false;

  // Check action display string (like "Updated task")
  const action = (latest.action ?? '').toLowerCase();
  if (PASSIVE_ACTION_STRINGS.has(action)) return false;

  return latestTime > Date.now() - 10 * 60 * 1000;
}

export function getTaskAge(task: TaskBoardTask): { label: string; days: number } {
  const fallback = { label: 'NEW', days: 0 };
  const rawDate = task.created_at || task.updated_at;
  if (!rawDate) return fallback;

  const createdAt = new Date(rawDate).getTime();
  if (Number.isNaN(createdAt)) return fallback;

  const days = Math.max(0, Math.floor((Date.now() - createdAt) / (24 * 60 * 60 * 1000)));
  if (days < 1) return { label: 'TODAY', days };
  if (days < 7) return { label: `${days}D`, days };
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return { label: `${weeks}W`, days };
  const months = Math.floor(days / 30);
  return { label: `${months}MO`, days };
}
