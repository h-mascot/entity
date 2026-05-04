import type { TaskBoardTask } from '../../hooks/useTaskBoard';
import { formatDate } from './utils/taskHelpers';

interface MCInsightsDashboardProps {
  tasks: TaskBoardTask[];
  onOpenTask?: (taskId: number) => void;
}

interface AssigneeSummary {
  assignee: string;
  total: number;
  doing: number;
  dueToday: number;
  overdue: number;
  blocked: number;
}

const DEFAULT_CAPACITY_PER_ASSIGNEE = 4;

function normalizeAssignee(value: string | null | undefined): string {
  const normalized = value?.trim();
  return normalized ? normalized : 'Unassigned';
}

function isOpenTask(task: TaskBoardTask): boolean {
  return !task.archived && task.column !== 'done';
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function isDueToday(task: TaskBoardTask, today: Date): boolean {
  if (!isOpenTask(task)) {
    return false;
  }

  const dueAt = parseDate(task.due_at);
  if (!dueAt) {
    return false;
  }

  return startOfDay(dueAt).getTime() === today.getTime();
}

function isOverdue(task: TaskBoardTask, today: Date): boolean {
  if (!isOpenTask(task)) {
    return false;
  }

  const dueAt = parseDate(task.due_at);
  if (!dueAt) {
    return false;
  }

  return startOfDay(dueAt).getTime() < today.getTime();
}

function taskAgeDays(task: TaskBoardTask): number {
  const updatedAt = parseDate(task.updated_at) ?? parseDate(task.created_at);
  if (!updatedAt) {
    return 0;
  }

  return Math.max(0, Math.floor((Date.now() - updatedAt.getTime()) / (24 * 60 * 60 * 1000)));
}

function formatPercent(value: number, total: number): string {
  if (total <= 0) {
    return '0%';
  }

  return `${Math.round((value / total) * 100)}%`;
}

function formatCapacityLabel(used: number, limit: number): string {
  if (limit <= 0) {
    return '0%';
  }

  return `${Math.round((used / limit) * 100)}%`;
}

function toneClass(tone: 'default' | 'warning' | 'danger' | 'success'): string {
  if (tone === 'success') {
    return 'border-emerald-500/30 bg-emerald-500/10';
  }

  if (tone === 'warning') {
    return 'border-amber-500/30 bg-amber-500/10';
  }

  if (tone === 'danger') {
    return 'border-rose-500/30 bg-rose-500/10';
  }

  return 'border-[var(--border-primary)] bg-[var(--bg-secondary)]';
}

export default function MCInsightsDashboard({ tasks, onOpenTask }: MCInsightsDashboardProps) {
  const today = startOfDay(new Date());
  const nonArchivedTasks = tasks.filter((task) => !task.archived);
  const activeTasks = nonArchivedTasks.filter(isOpenTask);
  const assignedTasks = activeTasks.filter((task) => normalizeAssignee(task.assignee) !== 'Unassigned');
  const doingTasks = activeTasks.filter((task) => task.column === 'doing');
  const reviewTasks = activeTasks.filter((task) => task.column === 'review');
  const blockedTasks = activeTasks.filter((task) => task.blocked);
  const dueTodayTasks = activeTasks
    .filter((task) => isDueToday(task, today))
    .sort((left, right) => (parseDate(left.due_at)?.getTime() ?? 0) - (parseDate(right.due_at)?.getTime() ?? 0));
  const overdueTasks = activeTasks
    .filter((task) => isOverdue(task, today))
    .sort((left, right) => (parseDate(left.due_at)?.getTime() ?? 0) - (parseDate(right.due_at)?.getTime() ?? 0));
  const doneTasks = nonArchivedTasks.filter((task) => task.column === 'done');
  const staleTasks = activeTasks
    .filter((task) => taskAgeDays(task) >= 7)
    .sort((left, right) => taskAgeDays(right) - taskAgeDays(left));

  const ownerSummaries = Array.from(
    assignedTasks.reduce<Map<string, AssigneeSummary>>((map, task) => {
      const assignee = normalizeAssignee(task.assignee);
      const summary = map.get(assignee) ?? {
        assignee,
        total: 0,
        doing: 0,
        dueToday: 0,
        overdue: 0,
        blocked: 0,
      };

      summary.total += 1;
      if (task.column === 'doing') {
        summary.doing += 1;
      }
      if (isDueToday(task, today)) {
        summary.dueToday += 1;
      }
      if (isOverdue(task, today)) {
        summary.overdue += 1;
      }
      if (task.blocked) {
        summary.blocked += 1;
      }

      map.set(assignee, summary);
      return map;
    }, new Map())
  )
    .map(([, summary]) => summary)
    .sort((left, right) => right.total - left.total || left.assignee.localeCompare(right.assignee));

  const capacityLimit = ownerSummaries.length * DEFAULT_CAPACITY_PER_ASSIGNEE;
  const capacityUsed = assignedTasks.length;
  const capacityRemaining = Math.max(capacityLimit - capacityUsed, 0);
  const attentionTasks = [...blockedTasks, ...overdueTasks, ...staleTasks]
    .filter((task, index, list) => list.findIndex((candidate) => candidate.id === task.id) === index)
    .slice(0, 6);

  const statCards = [
    {
      label: 'Assigned',
      value: assignedTasks.length,
      detail: `${activeTasks.length} active tasks in current view`,
      tone: 'default' as const,
    },
    {
      label: 'Due Today',
      value: dueTodayTasks.length,
      detail: dueTodayTasks.length > 0 ? 'Tasks that need same-day attention' : 'No active tasks due today',
      tone: dueTodayTasks.length > 0 ? ('warning' as const) : ('success' as const),
    },
    {
      label: 'Overdue',
      value: overdueTasks.length,
      detail: overdueTasks.length > 0 ? 'Past due and still open' : 'Nothing overdue right now',
      tone: overdueTasks.length > 0 ? ('danger' as const) : ('success' as const),
    },
    {
      label: 'Capacity',
      value: formatCapacityLabel(capacityUsed, capacityLimit),
      detail:
        capacityLimit > 0
          ? `${capacityUsed}/${capacityLimit} assignment slots used`
          : 'No named owners in current filter',
      tone:
        capacityLimit > 0 && capacityUsed >= capacityLimit
          ? ('danger' as const)
          : capacityLimit > 0 && capacityUsed >= Math.ceil(capacityLimit * 0.75)
            ? ('warning' as const)
            : ('default' as const),
    },
  ];

  const metrics = [
    {
      label: 'Completion rate',
      value: formatPercent(doneTasks.length, nonArchivedTasks.length),
      detail: `${doneTasks.length} of ${nonArchivedTasks.length} non-archived tasks are done`,
    },
    {
      label: 'Blocked rate',
      value: formatPercent(blockedTasks.length, activeTasks.length),
      detail: `${blockedTasks.length} active tasks are blocked`,
    },
    {
      label: 'Flow load',
      value: `${doingTasks.length} doing / ${reviewTasks.length} review`,
      detail: 'Current work in progress versus review queue',
    },
    {
      label: 'Stale work',
      value: staleTasks.length === 0 ? 'Healthy' : `${staleTasks.length} stale`,
      detail: 'Tasks untouched for at least 7 days',
    },
  ];

  return (
    <div className="px-[30px] pb-[30px] pt-5">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Insights Dashboard</div>
          <h3 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">Stats, metrics, and team load</h3>
        </div>
        <div className="text-xs text-[var(--text-muted)]">
          {capacityLimit > 0 ? `${capacityRemaining} capacity slots open` : 'Adjust filters to inspect a focused slice'}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {statCards.map((card) => (
          <section key={card.label} className={`rounded-2xl border p-4 ${toneClass(card.tone)}`}>
            <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">{card.label}</div>
            <div className="mt-3 text-3xl font-semibold text-[var(--text-primary)]">{card.value}</div>
            <div className="mt-2 text-xs text-[var(--text-secondary)]">{card.detail}</div>
          </section>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="grid gap-4">
          <section className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-5">
            <h4 className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Metrics</h4>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {metrics.map((metric) => (
                <div key={metric.label} className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-4">
                  <div className="text-xs text-[var(--text-muted)]">{metric.label}</div>
                  <div className="mt-2 text-lg font-semibold text-[var(--text-primary)]">{metric.value}</div>
                  <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{metric.detail}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-5">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Needs Attention</h4>
              <span className="text-xs text-[var(--text-muted)]">{attentionTasks.length} surfaced</span>
            </div>
            {attentionTasks.length === 0 ? (
              <div className="mt-4 text-sm text-[var(--text-muted)]">No blocked, overdue, or stale tasks in this slice.</div>
            ) : (
              <div className="mt-4 space-y-2">
                {attentionTasks.map((task) => {
                  const isBlocked = task.blocked;
                  const overdue = isOverdue(task, today);
                  const stale = taskAgeDays(task) >= 7;
                  const label = isBlocked ? 'Blocked' : overdue ? 'Overdue' : `${taskAgeDays(task)}d stale`;

                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => onOpenTask?.(task.id)}
                      className="flex w-full items-start justify-between gap-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] px-4 py-3 text-left transition hover:border-[var(--border-secondary)] hover:bg-[var(--bg-tertiary)]"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[var(--text-primary)]">{task.name}</div>
                        <div className="mt-1 text-xs text-[var(--text-secondary)]">
                          #{task.id} • {normalizeAssignee(task.assignee)} • {task.column}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] ${
                        isBlocked
                          ? 'bg-rose-500/15 text-rose-200'
                          : overdue
                            ? 'bg-amber-500/15 text-amber-100'
                            : stale
                              ? 'bg-slate-500/20 text-slate-200'
                              : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                      }`}>
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="grid gap-4">
          <section className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-5">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Due Today</h4>
              <span className="text-xs text-[var(--text-muted)]">{dueTodayTasks.length} tasks</span>
            </div>
            {dueTodayTasks.length === 0 ? (
              <div className="mt-4 text-sm text-[var(--text-muted)]">Nothing due today in the current view.</div>
            ) : (
              <div className="mt-4 space-y-2">
                {dueTodayTasks.slice(0, 6).map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onOpenTask?.(task.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] px-4 py-3 text-left transition hover:border-[var(--border-secondary)] hover:bg-[var(--bg-tertiary)]"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[var(--text-primary)]">{task.name}</div>
                      <div className="mt-1 text-xs text-[var(--text-secondary)]">
                        {normalizeAssignee(task.assignee)} • {task.column}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-[var(--text-muted)]">{formatDate(task.due_at)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-5">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Capacity by Owner</h4>
              <span className="text-xs text-[var(--text-muted)]">{ownerSummaries.length} owners</span>
            </div>
            {ownerSummaries.length === 0 ? (
              <div className="mt-4 text-sm text-[var(--text-muted)]">No assigned tasks in the current view.</div>
            ) : (
              <div className="mt-4 space-y-3">
                {ownerSummaries.map((summary) => {
                  const ownerCapacity = DEFAULT_CAPACITY_PER_ASSIGNEE;
                  const ownerLoadPercent = Math.min(100, Math.round((summary.total / ownerCapacity) * 100));

                  return (
                    <div key={summary.assignee} className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-[var(--text-primary)]">{summary.assignee}</div>
                          <div className="mt-1 text-xs text-[var(--text-secondary)]">
                            {summary.total} assigned • {summary.doing} doing • {summary.blocked} blocked
                          </div>
                        </div>
                        <div className="text-right text-xs text-[var(--text-muted)]">
                          <div>{ownerLoadPercent}% load</div>
                          <div>{summary.dueToday} due today • {summary.overdue} overdue</div>
                        </div>
                      </div>
                      <div className="mt-3 h-2 rounded-full bg-[var(--bg-tertiary)]">
                        <div
                          className={`h-2 rounded-full ${
                            ownerLoadPercent >= 100
                              ? 'bg-rose-400'
                              : ownerLoadPercent >= 75
                                ? 'bg-amber-400'
                                : 'bg-emerald-400'
                          }`}
                          style={{ width: `${ownerLoadPercent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
