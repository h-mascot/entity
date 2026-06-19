import { useEffect, useState, type DragEvent } from 'react';
import type { TaskBoardTask, TaskColumn } from '../../hooks/useTaskBoard';
import MCTaskCard from './MCTaskCard';
import type { ProjectOption } from './projectOptions';

const BACKLOG_PAGE_SIZE = 50;
const COLUMN_COLORS: Record<TaskColumn | 'archive', string> = {
  backlog: '#6b7280',
  todo: '#94a3b8',
  doing: 'var(--accent)',
  review: '#f59e0b',
  done: 'var(--success)',
  archive: '#8b5cf6',
};

interface KanbanColumnProps {
  column: TaskColumn | 'archive';
  title: string;
  tasks: TaskBoardTask[];
  draggedTaskId: number | null;
  movingTaskId: number | null;
  highlightTaskId: number | null;
  onDragStart: (taskId: number) => void;
  onDragEnd: () => void;
  onMoveTask: (taskId: number, column: TaskColumn | 'archive') => Promise<unknown>;
  onOpenTask?: (taskId: number) => void;
  onUpdateTaskProjects: (taskId: number, projectIds: number[]) => Promise<unknown>;
  projectOptions: ProjectOption[];
  selectedTaskIds?: Set<number>;
  onToggleSelect?: (taskId: number) => void;
  onToggleBookmark?: (taskId: number) => void;
}

export default function KanbanColumn({
  column,
  title,
  tasks,
  draggedTaskId,
  movingTaskId,
  highlightTaskId,
  onDragStart,
  onDragEnd,
  onMoveTask,
  onOpenTask,
  onUpdateTaskProjects,
  projectOptions,
  selectedTaskIds,
  onToggleSelect,
  onToggleBookmark,
}: KanbanColumnProps) {
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [visibleCount, setVisibleCount] = useState(() =>
    column === 'backlog' ? Math.min(tasks.length, BACKLOG_PAGE_SIZE) : tasks.length
  );

  useEffect(() => {
    if (column !== 'backlog') {
      setVisibleCount(tasks.length);
      return;
    }

    const minimumVisibleCount = Math.min(tasks.length, BACKLOG_PAGE_SIZE);
    const highlightedIndex =
      highlightTaskId === null ? -1 : tasks.findIndex((task) => task.id === highlightTaskId);

    if (highlightedIndex >= 0) {
      const requiredVisibleCount = Math.ceil((highlightedIndex + 1) / BACKLOG_PAGE_SIZE) * BACKLOG_PAGE_SIZE;
      setVisibleCount((current) => Math.min(tasks.length, Math.max(current, requiredVisibleCount)));
      return;
    }

    setVisibleCount((current) => {
      if (current > tasks.length) {
        return tasks.length;
      }

      return Math.max(minimumVisibleCount, current);
    });
  }, [column, highlightTaskId, tasks]);

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (!isDropTarget) {
      setIsDropTarget(true);
    }
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDropTarget(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    setIsDropTarget(false);
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDropTarget(false);

    const taskId = Number(event.dataTransfer.getData('text/plain'));
    if (!Number.isInteger(taskId) || taskId === 0 || column === 'archive') {
      return;
    }

    try {
      await onMoveTask(taskId, column);
    } catch (error) {
      console.error('Failed to move task:', error);
    }
  };

  const visibleTasks = column === 'backlog' ? tasks.slice(0, visibleCount) : tasks;
  const hasMoreTasks = column === 'backlog' && visibleTasks.length < tasks.length;

  return (
	    <div
	      className={`column column-${column} ${isDropTarget ? 'column-drop-target' : ''}`}
	      data-column={column}
	      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={
        isDropTarget
          ? {
              borderColor: 'var(--accent)',
              boxShadow: '0 0 0 1px var(--accent) inset',
              background: 'var(--surface-accent)',
            }
          : undefined
      }
    >
      <div className="column-header mb-3 shrink-0">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: COLUMN_COLORS[column] }}
            aria-hidden="true"
          />
          <span className="column-title">{title}</span>
        </div>
        <span className="column-count">{tasks.length}</span>
      </div>
      <div className="tasks min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {tasks.length === 0 ? (
          <div className="column-empty-state">
            No tasks
          </div>
        ) : (
          visibleTasks.map((task) => (
            <MCTaskCard
              key={task.id}
              isDragging={draggedTaskId === task.id || movingTaskId === task.id}
              isHighlighted={highlightTaskId === task.id}
              isArchiveColumn={column === 'archive'}
              isSelected={selectedTaskIds?.has(task.id) ?? false}
              onToggleSelect={onToggleSelect}
              onToggleBookmark={onToggleBookmark}
              onDragEnd={onDragEnd}
              onDragStart={onDragStart}
              onOpenTask={onOpenTask}
              onUpdateProjects={onUpdateTaskProjects}
              projectOptions={projectOptions}
              task={task}
            />
          ))
        )}
        {hasMoreTasks ? (
          <button
            type="button"
            onClick={() => setVisibleCount((current) => Math.min(tasks.length, current + BACKLOG_PAGE_SIZE))}
            className="mt-2 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-secondary)] transition hover:border-[var(--border-secondary)] hover:text-[var(--text-primary)]"
          >
            Show more ({tasks.length - visibleTasks.length} remaining)
          </button>
        ) : null}
      </div>
    </div>
  );
}
