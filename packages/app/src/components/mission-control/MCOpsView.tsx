import { useEffect, useState } from 'react';
import MCInsightsDashboard from './MCInsightsDashboard';
import KanbanColumn from './KanbanColumn';
import TaskDetailPanel from './TaskDetailPanel';
import { useTaskBoard, type TaskBoardTask, type TaskColumn } from '../../hooks/useTaskBoard';
import type { MCTab } from './MCHeader';
import { fetchProjectOptions, type ProjectOption } from './projectOptions';
import { formatTaskProjectSummary } from './utils/taskHelpers';

interface MCOpsViewProps {
  apiBase?: string;
  compactShell?: boolean;
  showInsights?: boolean;
  activeTab: MCTab;
  globalSearch: string;
  tasks: TaskBoardTask[];
  loading?: boolean;
  error?: string | null;
  onMoveTask: (taskId: number, column: TaskColumn) => Promise<unknown>;
  highlightTaskId?: number | null;
  onOpenTask?: (taskId: number) => void;
  onCloseTask?: () => void;
  onDocsLinkNavigate?: (href: string) => boolean;
}

const COLUMN_TITLES: Record<TaskColumn, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  doing: 'Doing',
  review: 'Review',
  done: 'Done',
};

function matchesGlobalSearch(task: TaskBoardTask, query: string): boolean {
  if (!query) {
    return true;
  }

  const haystack = [
    task.name,
    task.description ?? '',
    task.assignee,
    task.priority,
    formatTaskProjectSummary(task),
    task.blocker_reason ?? '',
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(query);
}

export default function MCOpsView({
  apiBase = '',
  compactShell = false,
  showInsights = true,
  activeTab,
  globalSearch,
  tasks,
  loading = false,
  error = null,
  onMoveTask,
  highlightTaskId = null,
  onOpenTask,
  onCloseTask,
  onDocsLinkNavigate,
}: MCOpsViewProps) {
  const { updateTask } = useTaskBoard({ apiBase, autoLoad: false });
  const shouldShowInsights = showInsights || !compactShell;
  const [draggedTaskId, setDraggedTaskId] = useState<number | null>(null);
  const [movingTaskId, setMovingTaskId] = useState<number | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const activeTaskDetailId = selectedTaskId ?? highlightTaskId;
  const query = globalSearch.trim().toLowerCase();
  const filteredTasks = tasks.filter((task) => !task.archived && matchesGlobalSearch(task, query));
  const activeTasksCount = filteredTasks.filter((task) => task.column === 'doing').length;
  const blockedTasksCount = filteredTasks.filter((task) => task.blocked && task.column !== 'done').length;
  const reviewTasksCount = filteredTasks.filter((task) => task.column === 'review').length;
  const summaryStateClass = blockedTasksCount > 0 ? 'state-error' : activeTasksCount > 0 ? 'state-active' : 'state-idle';
  const tasksByColumn: Record<TaskColumn, TaskBoardTask[]> = {
    backlog: [],
    todo: [],
    doing: [],
    review: [],
    done: [],
  };

  filteredTasks.forEach((task) => {
    tasksByColumn[task.column].push(task);
  });

  useEffect(() => {
    let cancelled = false;

    void fetchProjectOptions(apiBase)
      .then((projects) => {
        if (!cancelled) {
          setProjectOptions(projects);
        }
      })
      .catch((error) => {
        console.error('Failed to load Mission Control project tags:', error);
        if (!cancelled) {
          setProjectOptions([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  useEffect(() => {
    if (highlightTaskId === null) {
      return;
    }

    setSelectedTaskId(highlightTaskId);
  }, [highlightTaskId]);

  const handleMoveTask = async (taskId: number, column: TaskColumn) => {
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task || task.column === column) {
      setDraggedTaskId(null);
      return;
    }

    setMovingTaskId(taskId);
    try {
      await onMoveTask(taskId, column);
    } finally {
      setMovingTaskId(null);
      setDraggedTaskId(null);
    }
  };

  const handleOpenTask = (taskId: number) => {
    setSelectedTaskId(taskId);
    onOpenTask?.(taskId);
  };

  const handleCloseTask = () => {
    setSelectedTaskId(null);
    onCloseTask?.();
  };

  const handleUpdateTaskProjects = async (taskId: number, projectIds: number[]) => {
    const selectedProjectNames = projectOptions
      .filter((project) => projectIds.includes(project.id))
      .map((project) => project.name);

    return updateTask(taskId, {
      projectIds,
      project: selectedProjectNames.length > 0 ? selectedProjectNames.join(', ') : 'General',
    });
  };

  return (
    <div>
      {error ? (
        <div className="entity-state-notice entity-state-error mx-4 mt-5 text-sm md:mx-5">{error}</div>
      ) : null}
      <div className={activeTab === 'insights' && shouldShowInsights ? 'entity-insights-body' : 'hidden'}>
        <MCInsightsDashboard tasks={filteredTasks} onOpenTask={handleOpenTask} />
      </div>
      <div className={activeTab === 'insights' && shouldShowInsights ? 'hidden' : ''}>
        <div className="px-4 pb-3 pt-4 md:px-5">
	          <div className={`entity-state-bar ${summaryStateClass} flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]/80 p-2 shadow-[0_10px_28px_rgba(0,0,0,0.22)]`}>
            <span className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)]">
              {filteredTasks.length} tasks
            </span>
            {activeTasksCount > 0 ? (
              <span className="flex items-center gap-1 rounded-lg border border-[var(--accent)]/30 bg-[var(--surface-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)]">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
                {activeTasksCount} active
              </span>
            ) : null}
            {reviewTasksCount > 0 ? (
              <span className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300">
                {reviewTasksCount} review
              </span>
            ) : null}
            {blockedTasksCount > 0 ? (
              <span className="rounded-lg border border-[var(--error)]/35 bg-[var(--surface-error)] px-3 py-1.5 text-xs font-semibold text-[var(--error)]">
                {blockedTasksCount} blocked
              </span>
            ) : null}
            {query ? (
              <span className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-1.5 text-xs text-[var(--text-muted)]">
                Search: {globalSearch.trim()}
              </span>
            ) : null}
          </div>
        </div>
        <div className="board scroll-px-4 md:scroll-px-5" data-testid="mc-react-kanban-board">
          {(['backlog', 'todo', 'doing', 'review', 'done'] as const).map((column) => (
            <KanbanColumn
              key={column}
              column={column}
              draggedTaskId={draggedTaskId}
              highlightTaskId={highlightTaskId}
              movingTaskId={movingTaskId}
              onDragEnd={() => setDraggedTaskId(null)}
              onDragStart={setDraggedTaskId}
              onMoveTask={handleMoveTask}
              onOpenTask={handleOpenTask}
              onUpdateTaskProjects={handleUpdateTaskProjects}
              projectOptions={projectOptions}
              tasks={tasksByColumn[column]}
              title={COLUMN_TITLES[column]}
            />
          ))}
        </div>
        {!loading && filteredTasks.length === 0 ? (
          <div className="px-4 pb-5 text-sm text-[var(--text-muted)] md:px-5">
            {query ? 'No tasks match the current search.' : 'No tasks available.'}
          </div>
        ) : null}
      </div>
      {activeTaskDetailId !== null ? (
        <TaskDetailPanel
          key={activeTaskDetailId}
          apiBase={apiBase}
          taskId={activeTaskDetailId}
          onClose={handleCloseTask}
          onDocsLinkNavigate={onDocsLinkNavigate}
        />
      ) : null}
    </div>
  );
}
