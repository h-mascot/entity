import type { TaskBoardTask } from '../../hooks/useTaskBoard';

interface MCRightSidebarProps {
  tasks: TaskBoardTask[];
  onOpenTask?: (taskId: number) => void;
}

interface AssigneeSummary {
  assignee: string;
  total: number;
  doing: number;
  blocked: number;
}

function isOpenTask(task: TaskBoardTask): boolean {
  return !task.archived && task.column !== 'done';
}

function isOverdue(task: TaskBoardTask): boolean {
  if (!task.due_at || !isOpenTask(task)) {
    return false;
  }

  const dueAt = new Date(task.due_at);
  if (Number.isNaN(dueAt.getTime())) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return dueAt.getTime() < today.getTime();
}

function taskAgeDays(task: TaskBoardTask): number {
  const updatedAt = new Date(task.updated_at || task.created_at);
  if (Number.isNaN(updatedAt.getTime())) {
    return 0;
  }

  return Math.max(0, Math.floor((Date.now() - updatedAt.getTime()) / (24 * 60 * 60 * 1000)));
}

export default function MCRightSidebar({ tasks, onOpenTask }: MCRightSidebarProps) {
  const activeTasks = tasks.filter(isOpenTask);
  const blockedTasks = activeTasks.filter((task) => task.blocked);
  const overdueTasks = activeTasks.filter(isOverdue);
  const staleTasks = activeTasks
    .filter((task) => taskAgeDays(task) >= 7)
    .sort((left, right) => taskAgeDays(right) - taskAgeDays(left))
    .slice(0, 5);

  const assigneeSummaries = Array.from(
    activeTasks.reduce<Map<string, AssigneeSummary>>((map, task) => {
      const key = task.assignee || 'Unassigned';
      const summary = map.get(key) ?? { assignee: key, total: 0, doing: 0, blocked: 0 };
      summary.total += 1;
      if (task.column === 'doing') {
        summary.doing += 1;
      }
      if (task.blocked) {
        summary.blocked += 1;
      }
      map.set(key, summary);
      return map;
    }, new Map())
  )
    .map(([, summary]) => summary)
    .sort((left, right) => right.total - left.total || left.assignee.localeCompare(right.assignee))
    .slice(0, 6);

  const attentionTasks = [...blockedTasks, ...overdueTasks]
    .filter((task, index, list) => list.findIndex((candidate) => candidate.id === task.id) === index)
    .slice(0, 6);

  return (
    <div id="insightsRow" data-testid="mc-right-sidebar">
      <section>
        <h4>Snapshot</h4>
        <ul className="space-y-2 text-sm">
          <li>{activeTasks.length} active tasks</li>
          <li>{blockedTasks.length} blocked</li>
          <li>{tasks.filter((task) => task.column === 'doing' && !task.archived).length} in progress</li>
          <li>{tasks.filter((task) => task.column === 'review' && !task.archived).length} in review</li>
        </ul>
      </section>

      <section>
        <h4>Needs Attention</h4>
        {attentionTasks.length === 0 && staleTasks.length === 0 ? (
          <div className="text-sm text-[var(--text-muted)]">Nothing urgent right now.</div>
        ) : (
          <ul className="space-y-2 text-sm">
            {attentionTasks.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => onOpenTask?.(task.id)}
                  className="text-left text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
                >
                  {task.name}
                  <span className="ml-2 text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                    {task.blocked ? 'Blocked' : 'Overdue'}
                  </span>
                </button>
              </li>
            ))}
            {attentionTasks.length === 0
              ? staleTasks.map((task) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      onClick={() => onOpenTask?.(task.id)}
                      className="text-left text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
                    >
                      {task.name}
                      <span className="ml-2 text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                        {taskAgeDays(task)}d stale
                      </span>
                    </button>
                  </li>
                ))
              : null}
          </ul>
        )}
      </section>

      <section>
        <h4>Ownership</h4>
        {assigneeSummaries.length === 0 ? (
          <div className="text-sm text-[var(--text-muted)]">No active assignments.</div>
        ) : (
          <ul className="space-y-2 text-sm">
            {assigneeSummaries.map((summary) => (
              <li key={summary.assignee}>
                <span className="font-medium text-[var(--text-primary)]">{summary.assignee}</span>
                <span className="ml-2 text-[var(--text-secondary)]">
                  {summary.total} total, {summary.doing} doing, {summary.blocked} blocked
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
