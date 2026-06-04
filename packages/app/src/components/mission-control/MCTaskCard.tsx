import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import type { TaskBoardTask } from '../../hooks/useTaskBoard';
import { resolveAgentAvatarUrl, resolveAgentDisplayName, resolveAgentEmoji } from '../../lib/agentRegistry';
import { formatDate } from './utils/taskHelpers';

interface MCTaskCardProps {
  task: TaskBoardTask;
  isDragging?: boolean;
  isHighlighted?: boolean;
  isArchiveColumn?: boolean;
  onDragStart: (taskId: number) => void;
  onDragEnd: () => void;
  onOpenTask?: (taskId: number) => void;
}

function AssigneeAvatar({ assignee }: { assignee: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const avatarUrl = resolveAgentAvatarUrl(assignee);
  const label = resolveAgentDisplayName(assignee);
  const emoji = assignee === 'Unassigned' ? '👤' : resolveAgentEmoji(assignee);

  if (avatarUrl && !imageFailed) {
    return (
      <img
        src={avatarUrl}
        alt={label}
        className="assignee-avatar"
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <span className="assignee-avatar assignee-avatar-fallback" aria-hidden="true">
      {emoji}
    </span>
  );
}

export default function MCTaskCard({
  task,
  isDragging = false,
  isHighlighted = false,
  isArchiveColumn = false,
  onDragStart,
  onDragEnd,
  onOpenTask,
}: MCTaskCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const assignee = task.assignee || 'Unassigned';
  const assigneeLabel = resolveAgentDisplayName(assignee);
  const dueDate = formatDate(task.due_at);

  const cardClassName = [
    'task',
    task.blocked ? 'blocked' : '',
    isDragging ? 'dragging' : '',
    isHighlighted ? 'task-highlighted' : '',
    isArchiveColumn ? 'task-archived' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const taskState = task.blocked ? 'error' : task.column === 'done' ? 'success' : 'idle';
  const statefulCardClassName = `${cardClassName} task-state-${taskState}`;

  useEffect(() => {
    if (isHighlighted) {
      cardRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }, [isHighlighted]);

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(task.id));
    onDragStart(task.id);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onOpenTask?.(task.id);
  };

  return (
    <div
      ref={cardRef}
      className={statefulCardClassName}
      data-state={taskState}
      draggable
      onClick={() => onOpenTask?.(task.id)}
      onDragEnd={onDragEnd}
      onDragStart={handleDragStart}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      title={task.name}
      aria-current={isHighlighted ? 'true' : undefined}
      data-testid={`mc-task-card-${task.id}`}
    >
      <div className="task-header task-header-minimal">
        <div className="task-name">{task.name}</div>
        {task.recurring ? <span className="task-kicker-pill" title="Recurring">Recurring</span> : null}
      </div>

      <div className="task-meta task-meta-minimal">
        <span className="assignee-avatar-wrap" title={`Assigned to ${assigneeLabel}`} aria-label={`Assigned to ${assigneeLabel}`}>
          <AssigneeAvatar assignee={assignee} />
        </span>
        {dueDate ? <span className="task-due-date" title={`Due ${dueDate}`}>{dueDate}</span> : null}
      </div>
    </div>
  );
}
