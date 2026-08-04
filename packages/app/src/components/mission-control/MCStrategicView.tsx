import { useCallback, useEffect, useState } from 'react';
import { buildApiCandidates, requestJsonWithFallback, toErrorMessage } from '../../lib/http';
import { runtime } from '../../config/runtime';
import { loadAdminRuntimeSettings } from '../../lib/adminRuntimeSettings';

interface RoadmapItem {
  id: number;
  roadmap_id: number;
  title: string;
  description: string | null;
  priority: string;
  target_period: string | null;
  status: string;
  linked_task_id: number | null;
  notes: string | null;
  created_at: string;
}

interface Roadmap {
  id: number;
  name: string;
  theme: string | null;
  color: string | null;
  created_at: string;
  items: RoadmapItem[];
}

interface Task {
  id: number;
  name: string;
  description: string | null;
  column: string;
  assignee: string | null;
  recurring: number;
  recurring_config: string | null;
  due_date: string | null;
  progress_status: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  planned: 'var(--text-muted)',
  'in-progress': 'var(--accent)',
  done: 'var(--success)',
  blocked: 'var(--error)',
};

const PRIORITY_BADGE: Record<string, { bg: string; text: string }> = {
  P0: { bg: 'var(--error)', text: '#fff' },
  P1: { bg: '#f59e0b', text: '#000' },
  P2: { bg: 'var(--accent)', text: '#fff' },
  P3: { bg: 'var(--bg-tertiary)', text: 'var(--text-muted)' },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export default function MCStrategicView() {
  const [roadmaps, setRoadmaps] = useState<Roadmap[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [expandedRoadmap, setExpandedRoadmap] = useState<number | null>(null);
  const [roadmapSettings, setRoadmapSettings] = useState({
    showBacklogLane: true,
    showRecurringLane: true,
    showDependencyHints: true,
  });

  const apiBase = runtime.apiBase;
  useEffect(() => {
    void loadAdminRuntimeSettings(apiBase).then((settings) => {
      if (settings) {
        setRoadmapSettings(settings.strategicRoadmap);
      }
    });
  }, [apiBase]);
  useEffect(() => {
    (window as any).filterByUser = (assignee: string) => {
      setAssigneeFilter(assignee);
    };
    return () => {
      delete (window as any).filterByUser;
    };
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [roadmapData, taskData] = await Promise.all([
        requestJsonWithFallback<Roadmap[]>({
          urls: buildApiCandidates('/roadmaps', apiBase),
          fallbackError: 'Unable to load roadmaps.',
        }),
        requestJsonWithFallback<Task[] | { tasks: Task[] }>({
          urls: buildApiCandidates('/tasks', apiBase),
          fallbackError: 'Unable to load tasks.',
        }),
      ]);
      setRoadmaps(roadmapData ?? []);
      // Handle both bare array and { tasks: [...] } response shapes
      const taskList = Array.isArray(taskData) ? taskData : (taskData as { tasks: Task[] })?.tasks ?? [];
      setTasks(taskList);
      setError(null);
    } catch (err) {
      setError(toErrorMessage(err, 'Unable to load strategic data.'));
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);
  // Split tasks
  const filteredTasks = tasks.filter(t => !assigneeFilter || assigneeFilter === 'all' || t.assignee === assigneeFilter);
  const recurringTasks = filteredTasks.filter((t) => t.recurring === 1 || t.recurring_config);
  const backlogTasks = filteredTasks.filter((t) => t.column === 'Backlog' || t.column === 'backlog');
  const futureTasks = filteredTasks.filter(
    (t) => t.column === 'Future' || t.column === 'future' || t.column === 'Someday',
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[var(--text-muted)]">
        Loading strategic view...
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 lg:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        {error && (
          <div
            className="rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 px-3 py-2 text-sm text-[var(--error)] cursor-pointer"
            onClick={() => setError(null)}
          >
            {error}
          </div>
        )}

        {/* ── Roadmaps ── */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Roadmaps</h2>
            <span className="rounded-full bg-[var(--bg-tertiary)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
              {roadmaps.length} roadmap{roadmaps.length !== 1 ? 's' : ''}
            </span>
          </div>

          {roadmaps.length === 0 ? (
            <div className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">
              No roadmaps yet. Create one via the API.
            </div>
          ) : (
            <div className="space-y-3">
              {roadmaps.map((rm) => {
                const isExpanded = expandedRoadmap === rm.id;
                const doneCount = rm.items.filter((i) => i.status === 'done').length;
                const totalCount = rm.items.length;
                const progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

                return (
                  <div
                    key={rm.id}
                    className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] overflow-hidden"
                  >
                    {/* Roadmap header */}
                    <div
                      className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[var(--bg-tertiary)] transition-colors"
                      onClick={() => setExpandedRoadmap(isExpanded ? null : rm.id)}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="inline-block h-3 w-3 rounded-full"
                          style={{ backgroundColor: rm.color || 'var(--accent)' }}
                        />
                        <div>
                          <h3 className="text-sm font-medium text-[var(--text-primary)]">{rm.name}</h3>
                          {rm.theme && (
                            <span className="text-xs text-[var(--text-muted)]">{rm.theme}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 rounded-full bg-[var(--bg-primary)]">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${progress}%`,
                                backgroundColor: rm.color || 'var(--accent)',
                              }}
                            />
                          </div>
                          <span className="text-xs text-[var(--text-muted)]">
                            {doneCount}/{totalCount}
                          </span>
                        </div>
                        <span className="text-xs text-[var(--text-muted)]">
                          {isExpanded ? '▾' : '▸'}
                        </span>
                      </div>
                    </div>

                    {/* Roadmap items */}
                    {isExpanded && (
                      <div className="border-t border-[var(--border-primary)] px-4 py-2 space-y-1.5">
                        {rm.items.length === 0 ? (
                          <div className="py-4 text-center text-xs text-[var(--text-muted)]">
                            No items in this roadmap
                          </div>
                        ) : (
                          rm.items.map((item) => {
                            const badge = PRIORITY_BADGE[item.priority] ?? PRIORITY_BADGE.P3;
                            return (
                              <div
                                key={item.id}
                                className="flex items-center justify-between rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2"
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <span
                                    className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                                    style={{ backgroundColor: STATUS_COLORS[item.status] ?? 'var(--text-muted)' }}
                                  />
                                  <span className="text-sm text-[var(--text-primary)] truncate">
                                    {item.title}
                                  </span>
                                  {roadmapSettings.showDependencyHints && item.linked_task_id ? (
                                    <span className="text-[10px] text-[var(--text-muted)]">→ task #{item.linked_task_id}</span>
                                  ) : null}
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                  <span
                                    className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                                    style={{ backgroundColor: badge.bg, color: badge.text }}
                                  >
                                    {item.priority}
                                  </span>
                                  <span className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[10px] capitalize text-[var(--text-muted)]">
                                    {item.status}
                                  </span>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Recurring Tasks ── */}
        {roadmapSettings.showRecurringLane ? (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Recurring Tasks</h2>
            <span className="rounded-full bg-[var(--bg-tertiary)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
              {recurringTasks.length}
            </span>
          </div>

          {recurringTasks.length === 0 ? (
            <div className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">
              No recurring tasks. Mark a task as recurring to see it here.
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {recurringTasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-3"
                >
                  <div className="flex items-start justify-between">
                    <span className="text-sm font-medium text-[var(--text-primary)] line-clamp-2">
                      {task.name}
                    </span>
                    <span className="ml-2 rounded bg-[var(--accent)]/10 px-1.5 py-0.5 text-[10px] text-[var(--accent)]">
                      ↻
                    </span>
                  </div>
                  {task.recurring_config && (
                    <div className="mt-1 text-xs text-[var(--text-muted)] font-mono">
                      {task.recurring_config}
                    </div>
                  )}
                  <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                    <span>{task.column}</span>
                    <span>{task.assignee || 'unassigned'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        ) : null}

        {/* ── Backlog / Future ── */}
        {roadmapSettings.showBacklogLane && (backlogTasks.length > 0 || futureTasks.length > 0) && (
          <section>
            <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">Backlog & Future</h2>
            <div className="space-y-1.5">
              {[...backlogTasks, ...futureTasks].map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-[var(--text-primary)] truncate">{task.name}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    <span className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                      {task.column}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {timeAgo(task.created_at)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
