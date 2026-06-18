import { useEffect, useRef, type DragEvent, type KeyboardEvent } from 'react';
import type { TaskBoardTask } from '../../hooks/useTaskBoard';

interface TaskCardProps {
  task: TaskBoardTask;
  isDragging?: boolean;
  isHighlighted?: boolean;
  onDragStart: (taskId: number) => void;
  onDragEnd: () => void;
  onOpenTask?: (taskId: number) => void;
}

interface TaskAge {
  label: string;
  days: number;
}

function formatDueAt(dueAt: string | null): string {
  if (!dueAt) {
    return '';
  }

  const parsed = new Date(dueAt);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getTaskAge(task: TaskBoardTask): TaskAge {
  const fallback = { label: 'NEW', days: 0 };
  const rawDate = task.created_at || task.updated_at;
  if (!rawDate) {
    return fallback;
  }

  const createdAt = new Date(rawDate).getTime();
  if (Number.isNaN(createdAt)) {
    return fallback;
  }

  const days = Math.max(0, Math.floor((Date.now() - createdAt) / (24 * 60 * 60 * 1000)));
  if (days < 1) {
    return { label: 'TODAY', days };
  }
  if (days < 7) {
    return { label: `${days}D`, days };
  }

  const weeks = Math.floor(days / 7);
  if (weeks < 5) {
    return { label: `${weeks}W`, days };
  }

  const months = Math.floor(days / 30);
  return { label: `${months}MO`, days };
}

function statusClass(task: TaskBoardTask): string {
  if (task.blocked) {
    return 'status-blocked';
  }

  if (task.column === 'backlog') {
    return 'status-backlog';
  }
  if (task.column === 'todo') {
    return 'status-todo';
  }
  if (task.column === 'doing') {
    return 'status-doing';
  }
  if (task.column === 'review') {
    return 'status-review';
  }
  if (task.column === 'done') {
    return 'status-done';
  }

  return 'status-backlog';
}

function formatBlockerReason(reason: string): string {
  if (reason.includes('Agent trigger failed') && reason.includes('fetch failed')) {
    return '⚠️ Agent connection failed - will retry';
  }
  if (reason.includes('fetch failed')) {
    return '⚠️ Connection error - check agent status';
  }

  return reason;
}

function parseMetadata(task: TaskBoardTask): Record<string, unknown> {
  if (!task.metadata) {
    return {};
  }

  try {
    const parsed = JSON.parse(task.metadata);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  return false;
}

function reviewSummary(task: TaskBoardTask): string | null {
  if (task.column !== 'review' && task.column !== 'done') {
    return null;
  }

  const metadata = parseMetadata(task);
  const reviewType = readString(metadata.review_type ?? metadata.review_class);
  const reviewer = readString(metadata.reviewer ?? metadata.review_owner);
  const decision = readString(metadata.review_decision);
  const henryRequired = readBoolean(metadata.henry_required ?? metadata.requires_henry);

  if (!reviewType && !reviewer && !decision && !henryRequired) {
    return task.column === 'review' ? 'Review: needs packet' : null;
  }

  const owner = henryRequired ? 'Henry' : reviewer || 'Unassigned';
  const status = decision || 'pending';
  return `Review: ${owner} / ${status}`;
}

export default function TaskCard({
  task,
  isDragging = false,
  isHighlighted = false,
  onDragStart,
  onDragEnd,
  onOpenTask,
}: TaskCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const assignee = task.assignee || 'Unassigned';
  const priority = (task.priority || 'P2').toUpperCase();
  const priorityClass = `priority-${priority.toLowerCase()}`;
  const taskAge = getTaskAge(task);
  const isStale = taskAge.days >= 7 && task.column !== 'done';
  const ageBadgeClass = isStale ? 'task-age-badge stale' : 'task-age-badge';
  const dueDate = formatDueAt(task.due_at);
  const blockedReason = task.blocker_reason ? formatBlockerReason(task.blocker_reason) : null;
  const reviewStatus = reviewSummary(task);
  const cardClassName = ['task', task.blocked ? 'blocked' : '', isDragging ? 'dragging' : '', isHighlighted ? 'task-highlighted' : '']
    .filter(Boolean)
    .join(' ');

  useEffect(() => {
    if (!isHighlighted) {
      return;
    }

    cardRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [isHighlighted]);

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(task.id));
    onDragStart(task.id);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    onOpenTask?.(task.id);
  };

  return (
    <div
      ref={cardRef}
      className={cardClassName}
      draggable
      onClick={() => onOpenTask?.(task.id)}
      onDragEnd={onDragEnd}
      onDragStart={handleDragStart}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      title={task.blocked && blockedReason ? blockedReason : task.name}
      aria-current={isHighlighted ? 'true' : undefined}
    >
      {task.blocked ? <div className="blocked-indicator" aria-hidden="true">🚨</div> : null}
      <div className="task-header">
        <span className={`status-dot ${statusClass(task)}`} title={`Status: ${task.column}`} />
        <div className="task-name">{task.name}</div>
        {task.blocked ? <div className="priority-badge priority-p0">Blocked</div> : null}
      </div>
      {task.description ? <div className="task-desc">{task.description}</div> : null}
      {blockedReason ? <div className="task-status blocked-status">{blockedReason}</div> : null}
      {reviewStatus ? <div className="task-status">{reviewStatus}</div> : null}
      <div className="task-meta">
        <div className="task-meta-left">
          <span className="assignee-pill">{assignee}</span>
          <span className={`priority-badge ${priorityClass}`}>{priority}</span>
          <span className={ageBadgeClass} title="Task age based on created date">
            {taskAge.label}
          </span>
        </div>
        {dueDate ? <span>{dueDate}</span> : <span />}
      </div>
    </div>
  );
}
