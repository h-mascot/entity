import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import type { TaskBoardTask } from '../../hooks/useTaskBoard';
import type { ProjectOption } from './projectOptions';
import {
  formatBlockerReason,
  formatDate,
  getTaskAge,
  getTaskProjectNames,
  hasRecentTaskActivity,
  isTransientBlocker,
  statusClass,
} from './utils/taskHelpers';

interface MCTaskCardProps {
  task: TaskBoardTask;
  isDragging?: boolean;
  isHighlighted?: boolean;
  onDragStart: (taskId: number) => void;
  onDragEnd: () => void;
  onOpenTask?: (taskId: number) => void;
  onUpdateProjects: (taskId: number, projectIds: number[]) => Promise<unknown>;
  projectOptions: ProjectOption[];
}

export default function MCTaskCard({
  task,
  isDragging = false,
  isHighlighted = false,
  onDragStart,
  onDragEnd,
  onOpenTask,
  onUpdateProjects,
  projectOptions,
}: MCTaskCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const projectDropdownRef = useRef<HTMLDivElement>(null);
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const [projectSaveError, setProjectSaveError] = useState<string | null>(null);
  const [savingProjects, setSavingProjects] = useState(false);
  const assignee = task.assignee || 'Unassigned';
  const priority = (task.priority || 'P2').toUpperCase();
  const priorityClass = `priority-${priority.toLowerCase()}`;
  const taskAge = getTaskAge(task);
  const dueDate = formatDate(task.due_at);
  const isStale = taskAge.days >= 7 && !['done', 'complete', 'archive'].includes((task.column || '').toLowerCase());
  const ageBadgeClass = isStale ? 'task-age-badge stale' : 'task-age-badge';

  const isWorking = task.progress_status === 'working' || (task.column === 'doing' && !task.blocked && hasRecentTaskActivity(task));

  const blockedReason = task.blocked && task.blocker_reason ? formatBlockerReason(task.blocker_reason) : null;
  const blockerIcon = blockedReason && isTransientBlocker(task.blocker_reason) ? '⚠️' : '❌';

	  const cardClassName = [
	    'task',
	    task.blocked ? 'blocked' : '',
	    isDragging ? 'dragging' : '',
	    isWorking ? 'working' : '',
	    isHighlighted ? 'task-highlighted' : '',
	  ]
	    .filter(Boolean)
	    .join(' ');
	  const taskState = task.blocked ? 'error' : isWorking ? 'active' : task.column === 'done' ? 'success' : 'idle';
	  const statefulCardClassName = `${cardClassName} task-state-${taskState}`;

  useEffect(() => {
    if (isHighlighted) {
      cardRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }, [isHighlighted]);

  useEffect(() => {
    if (!projectDropdownOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!projectDropdownRef.current) {
        return;
      }

      if (!projectDropdownRef.current.contains(event.target as Node)) {
        setProjectDropdownOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [projectDropdownOpen]);

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

  const hasOutput = (task.output ?? '').trim().length > 0;
  const outputLinksCount = task.output_links_count > 0 ? task.output_links_count : hasOutput ? 1 : 0;
  const hasSubtasks = task.subtask_count > 0;
  const taskProjectNames = useMemo(() => getTaskProjectNames(task), [task]);
  const displayedProjects = useMemo(() => {
    const structuredProjects = new Map(task.projects.map((project) => [project.name.trim().toLowerCase(), project]));
    const projectOptionsByName = new Map(projectOptions.map((project) => [project.name.trim().toLowerCase(), project]));

    return taskProjectNames.map((projectName) => {
      const normalizedName = projectName.toLowerCase();
      const structuredProject = structuredProjects.get(normalizedName);
      if (structuredProject) {
        return structuredProject;
      }

      const option = projectOptionsByName.get(normalizedName);
      return {
        name: projectName,
        color: option?.color ?? null,
      };
    });
  }, [projectOptions, task.projects, taskProjectNames]);
  const selectedProjectIds = useMemo(() => {
    const explicitIds = task.projects
      .map((project) => project.id)
      .filter((projectId): projectId is number => typeof projectId === 'number' && projectId > 0);

    if (explicitIds.length > 0) {
      return explicitIds;
    }

    const selectedNames = new Set(taskProjectNames.map((projectName) => projectName.toLowerCase()));
    return projectOptions
      .filter((project) => selectedNames.has(project.name.toLowerCase()))
      .map((project) => project.id);
  }, [projectOptions, task.projects, taskProjectNames]);
  const selectedProjectIdSet = useMemo(() => new Set(selectedProjectIds), [selectedProjectIds]);

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
      title={task.blocked && blockedReason ? blockedReason : task.name}
      aria-current={isHighlighted ? 'true' : undefined}
      data-testid={`mc-task-card-${task.id}`}
    >
      {task.blocked ? <div className="blocked-indicator" aria-hidden="true">🚨</div> : null}
      {!task.blocked && isWorking ? <div className="working-indicator" aria-hidden="true" /> : null}

      <div className="task-kicker">
        <span>Task #{task.id}</span>
        {task.recurring ? <span className="task-kicker-pill">Recurring</span> : null}
      </div>

      <div className="task-header">
        <div className="task-name">{task.name}</div>
        {task.blocked ? <div className="priority-badge priority-p0">Blocked</div> : null}
      </div>

      {task.description ? <div className="task-desc">{task.description}</div> : null}

      {(hasOutput || hasSubtasks) ? (
        <div className="task-status" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {hasOutput ? <span title="Deliverables saved on card">🔗 {outputLinksCount} output{outputLinksCount === 1 ? '' : 's'}</span> : null}
          {hasSubtasks ? <span title="Subtask progress">🧩 {task.subtask_done_count}/{task.subtask_count} subtasks</span> : null}
        </div>
      ) : null}

      {blockedReason ? (
        <div className="task-status blocked-status">
          {blockerIcon} {blockedReason.slice(0, 80)}{blockedReason.length > 80 ? '...' : ''}
        </div>
      ) : null}

      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap gap-2">
          {displayedProjects.length > 0 ? (
            displayedProjects.map((project) => (
              <span
                key={project.name}
                className="inline-flex items-center rounded-full border border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)]"
                title={project.name}
              >
                <span>{project.name}</span>
              </span>
            ))
          ) : (
            <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
              No project tag
            </span>
          )}
        </div>

        <div
          ref={projectDropdownRef}
          className="relative shrink-0"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="mc-shell-btn px-2.5 py-1 text-[11px] font-medium"
            disabled={savingProjects || projectOptions.length === 0}
            onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
              event.preventDefault();
              event.stopPropagation();
              setProjectDropdownOpen((current) => !current);
              setProjectSaveError(null);
            }}
            title={projectOptions.length === 0 ? 'No project tags available.' : 'Edit project tags'}
          >
            {savingProjects ? 'Saving...' : 'Tags'}
          </button>

          {projectDropdownOpen ? (
            <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-2 shadow-[0_16px_40px_rgba(0,0,0,0.35)]">
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                Project Tags
              </div>
              {projectOptions.length > 0 ? (
                projectOptions.map((project) => (
                  <label
                    key={project.id}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-[var(--bg-tertiary)]"
                  >
                    <input
                      type="checkbox"
                      checked={selectedProjectIdSet.has(project.id)}
                      disabled={savingProjects}
                      onChange={async () => {
                        if (savingProjects) {
                          return;
                        }

                        const orderedSelectedIds = projectOptions
                          .filter((option) => selectedProjectIdSet.has(option.id))
                          .map((option) => option.id);
                        const nextProjectIds = selectedProjectIdSet.has(project.id)
                          ? orderedSelectedIds.filter((projectId) => projectId !== project.id)
                          : [...orderedSelectedIds, project.id];

                        setSavingProjects(true);
                        setProjectSaveError(null);
                        try {
                          await onUpdateProjects(task.id, nextProjectIds);
                        } catch (error) {
                          setProjectSaveError(
                            error instanceof Error && error.message.trim()
                              ? error.message
                              : 'Unable to update project tags.'
                          );
                        } finally {
                          setSavingProjects(false);
                        }
                      }}
                    />
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: project.color ?? '#6b7280' }}
                      aria-hidden="true"
                    />
                    <span>{project.name}</span>
                  </label>
                ))
              ) : (
                <div className="px-3 py-2 text-sm text-[var(--text-muted)]">No project tags available.</div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {projectSaveError ? (
        <div className="task-status blocked-status">
          ⚠️ {projectSaveError}
        </div>
      ) : null}

      <div className="task-meta">
        <div className="task-meta-left">
          <span className="task-id-badge">#{task.id}</span>
          <span className="assignee-pill">{assignee}</span>
          <span className={`priority-badge ${priorityClass}`}>{priority}</span>
          <span className={ageBadgeClass} title="Task age based on created date">
            {taskAge.label}
          </span>
        </div>
        <span>{dueDate}</span>
      </div>
    </div>
  );
}
