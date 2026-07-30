import { useCallback, useEffect, useRef, useState } from 'react';
import TaskBoard, { type MCViewport } from '../TaskBoard';
import { useEntityWebSocket } from '../../hooks/useEntityWebSocket';
import { useTaskBoard, type TaskBoardTask, type TaskColumn } from '../../hooks/useTaskBoard';
import {
  isEngineeringViewportMatch,
  loadEngineeringTasks,
  resolveEngineeringHighlightTaskId,
  toEngineeringLoadError,
} from '../../lib/engineeringTasks';
import { toErrorMessage } from '../../lib/http';
import { createLatestRequestGuard } from '../../lib/taskLoadingGuards';

interface MCEngineeringEntryProps {
  apiBase?: string;
  viewport: MCViewport;
  searchQuery?: string;
  highlightTaskId?: number | null;
  onCloseTask?: () => void;
  onDocsLinkNavigate?: (href: string) => boolean;
  showArchiveColumn?: boolean;
  onArchiveColumnVisibilityChange?: (visible: boolean) => void;
}

export default function MCEngineeringEntry({
  apiBase = '',
  viewport,
  searchQuery,
  highlightTaskId = null,
  onCloseTask,
  onDocsLinkNavigate,
  showArchiveColumn = true,
  onArchiveColumnVisibilityChange,
}: MCEngineeringEntryProps) {
  const [tasks, setTasks] = useState<TaskBoardTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeViewport, setActiveViewport] = useState(false);
  const reloadGuardRef = useRef<ReturnType<typeof createLatestRequestGuard> | null>(null);
  if (reloadGuardRef.current === null) {
    reloadGuardRef.current = createLatestRequestGuard();
  }
  const reloadGuard = reloadGuardRef.current;
  const { moveTask } = useTaskBoard({ apiBase, autoLoad: false });

  const reload = useCallback(async () => {
    if (!activeViewport) {
      return [];
    }
    const requestId = reloadGuard.begin();
    setLoading(true);
    setError(null);
    try {
      const nextTasks = await loadEngineeringTasks({ apiBase });
      if (reloadGuard.isCurrent(requestId)) {
        setTasks(nextTasks);
      }
      return nextTasks;
    } catch (loadError) {
      if (reloadGuard.isCurrent(requestId)) {
        setTasks([]);
        setError(toEngineeringLoadError(loadError));
      }
      return [];
    } finally {
      if (reloadGuard.isCurrent(requestId)) {
        setLoading(false);
      }
    }
  }, [activeViewport, apiBase, reloadGuard]);

  useEffect(() => {
    const updateViewport = () => {
      setActiveViewport(isEngineeringViewportMatch(viewport, window.innerWidth));
    };
    updateViewport();
    window.addEventListener('resize', updateViewport);
    return () => {
      reloadGuard.invalidate();
      window.removeEventListener('resize', updateViewport);
    };
  }, [reloadGuard, viewport]);

  useEffect(() => {
    if (!activeViewport) {
      reloadGuard.invalidate();
      setTasks([]);
      setLoading(false);
    }
  }, [activeViewport, reloadGuard]);

  useEffect(() => {
    if (!activeViewport) {
      return;
    }
    void reload();
    const intervalId = window.setInterval(() => void reload(), 30_000);
    const handleOnline = () => void reload();
    window.addEventListener('online', handleOnline);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('online', handleOnline);
    };
  }, [activeViewport, reload]);

  useEntityWebSocket(
    (message) => {
      const type = (message as { type?: unknown }).type;
      if (type === 'task:created' || type === 'task:updated' || type === 'task:deleted') {
        void reload();
      }
    },
    { enabled: activeViewport },
  );

  const handleMoveTask = useCallback(async (taskId: number, column: TaskColumn) => {
    try {
      const movedTask = await moveTask(taskId, column);
      await reload();
      return movedTask;
    } catch (moveError) {
      setError(
        `Engineering board could not update task: ${toErrorMessage(moveError, 'Task move failed.')}`,
      );
      throw moveError;
    }
  }, [moveTask, reload]);

  const handleCloseTask = useCallback(() => {
    void reload();
    onCloseTask?.();
  }, [onCloseTask, reload]);
  const safeHighlightTaskId = resolveEngineeringHighlightTaskId(tasks, highlightTaskId);

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]"
      aria-labelledby="engineering-board-title"
      data-testid="engineering-board"
    >
      <header className="flex w-full items-center justify-between gap-3 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]/80 px-4 py-3 md:px-5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
            Work domain · engineering
          </p>
          <h1 id="engineering-board-title" className="text-base font-semibold text-[var(--text-primary)]">
            Engineering board
          </h1>
        </div>
        <div
          className="rounded-full border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-1 text-xs text-[var(--text-muted)]"
          aria-live="polite"
          data-testid="engineering-board-load-state"
        >
          {loading ? 'Loading…' : error ? 'Degraded' : `${tasks.length} engineering task${tasks.length === 1 ? '' : 's'}`}
        </div>
      </header>
      <div className="min-h-0 w-full flex-1">
        <TaskBoard
          viewport={viewport}
          compactShell
          apiBase={apiBase}
          tasks={tasks}
          loading={loading}
          error={error}
          onMoveTask={handleMoveTask}
          searchQuery={searchQuery}
          highlightTaskId={safeHighlightTaskId}
          onCloseTask={handleCloseTask}
          onDocsLinkNavigate={onDocsLinkNavigate}
          showArchiveColumn={showArchiveColumn}
          onArchiveColumnVisibilityChange={onArchiveColumnVisibilityChange}
          scopeTaskDetailsToTasks
        />
      </div>
    </section>
  );
}
