import { useEffect, useState } from 'react';
import MCInsightsDashboard from './MCInsightsDashboard';
import KanbanColumn from './KanbanColumn';
import TaskDetailPanel from './TaskDetailPanel';
import ReviewActionModal from './ReviewActionModal';
import { useTaskBoard, type TaskBoardTask, type TaskColumn } from '../../hooks/useTaskBoard';
import type { MCTab } from './MCHeader';
import { fetchProjectOptions, type ProjectOption } from './projectOptions';
import { buildBookmarkMetadata, formatTaskProjectSummary, isTaskBookmarked } from './utils/taskHelpers';
import { toErrorMessage } from '../../lib/http';
import { readUserProfile } from '../../lib/userProfile';
import {
  fetchWorktypeRegistry,
  formatOverlayValue,
  getIndexableWorktypeFields,
  getWorktypeLabel,
  parseJsonRecord,
  readWorktype,
  readWorktypeLayer,
  type WorktypeFieldDefinition,
  type WorktypeRegistryEntry,
} from './utils/worktypeRegistry';

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
  showArchiveColumn?: boolean;
}

type BoardColumn = TaskColumn | 'archive';
type BoardStatusFilter = 'all' | 'active' | 'review' | 'blocked' | 'starred';
type OverlayFilter = { worktype: string; field: WorktypeFieldDefinition };
type OwnerInboxGroup = 'stalled' | 'escalated' | 'review_blocked' | 'gate_pending' | 'receipt_failed' | 'migration_warning';

function matchesStatusFilter(task: TaskBoardTask, filter: BoardStatusFilter): boolean {
  switch (filter) {
    case 'active':
      return task.column === 'doing';
    case 'review':
      return task.column === 'review';
    case 'blocked':
      return task.blocked && task.column !== 'done';
    case 'starred':
      return isTaskBookmarked(task);
    case 'all':
    default:
      return true;
  }
}

const BULK_MOVE_COLUMNS: TaskColumn[] = ['backlog', 'todo', 'doing', 'review', 'done'];

const COLUMN_TITLES: Record<BoardColumn, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  doing: 'Doing',
  review: 'Review',
  done: 'Done',
  archive: 'Archive',
};

function matchesGlobalSearch(task: TaskBoardTask, query: string): boolean {
  if (!query) {
    return true;
  }

  const metadata = buildTaskWorktypeMetadata(task);
  const overlayText = Object.values(readWorktypeLayer(metadata))
    .map(formatOverlayValue)
    .filter((entry): entry is string => Boolean(entry))
    .join(' ');
  const haystack = [
    task.name,
    task.description ?? '',
    task.assignee,
    task.priority,
    formatTaskProjectSummary(task),
    task.blocker_reason ?? '',
    task.worktype ?? '',
    overlayText,
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(query);
}

function buildTaskWorktypeMetadata(task: TaskBoardTask): Record<string, unknown> {
  const metadata = parseJsonRecord(task.metadata) ?? {};
  return {
    ...metadata,
    worktype: task.worktype ?? metadata.worktype,
    policy_inputs_json: task.policy_inputs_json ?? metadata.policy_inputs_json,
  };
}

const OWNER_INBOX_LABELS: Record<OwnerInboxGroup, string> = {
  stalled: 'Stalled',
  escalated: 'Escalated',
  review_blocked: 'Review blocked',
  gate_pending: 'Gate pending',
  receipt_failed: 'Receipt failed',
  migration_warning: 'Migration warning',
};

function ownerInboxGroups(task: TaskBoardTask, now = Date.now()): OwnerInboxGroup[] {
  const metadata = buildTaskWorktypeMetadata(task);
  const groups: OwnerInboxGroup[] = [];
  const add = (group: OwnerInboxGroup) => {
    if (!groups.includes(group)) groups.push(group);
  };
  const updatedAt = Date.parse(task.updated_at || task.created_at);
  const staleHours = Number.isNaN(updatedAt) ? 0 : (now - updatedAt) / (1000 * 60 * 60);
  const blockerReason = task.blocker_reason?.toLowerCase() ?? '';
  const hasOwnerEscalations = Array.isArray(metadata.owner_escalations)
    ? metadata.owner_escalations.length > 0
    : Boolean(metadata.owner_escalations);

  if ((task.column === 'todo' || task.column === 'doing' || task.column === 'review') && staleHours >= 24) add('stalled');
  if (
    metadata.escalated === true ||
    hasOwnerEscalations ||
    (typeof metadata.escalation_marker === 'string' && metadata.escalation_marker !== 'none') ||
    blockerReason.includes('escalat')
  ) add('escalated');
  if (task.column === 'review' || (task.review_required && task.review_state !== 'accepted')) add('review_blocked');
  if (task.human_gate_required && task.human_gate_state !== 'approved') add('gate_pending');
  if (
    metadata.receipt_failed === true ||
    metadata.missing_receipt === true ||
    metadata.receipt_status === 'failed' ||
    metadata.receipt_status === 'missing_receipt' ||
    blockerReason.includes('receipt')
  ) add('receipt_failed');
  if (metadata.migration_warning === true || blockerReason.includes('migration')) add('migration_warning');

  return groups;
}

function matchesOverlayFilter(task: TaskBoardTask, filter: OverlayFilter | null, query: string): boolean {
  if (!filter) {
    return true;
  }
  const metadata = buildTaskWorktypeMetadata(task);
  if (readWorktype(metadata, task.worktype) !== filter.worktype) {
    return false;
  }
  const value = formatOverlayValue(readWorktypeLayer(metadata)[filter.field.name]) ?? '';
  const normalizedQuery = query.trim().toLowerCase();
  return normalizedQuery ? value.toLowerCase().includes(normalizedQuery) : Boolean(value);
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
  showArchiveColumn = true,
}: MCOpsViewProps) {
  const { updateTask } = useTaskBoard({ apiBase, autoLoad: false });
  const shouldShowInsights = showInsights || !compactShell;
  const [draggedTaskId, setDraggedTaskId] = useState<number | null>(null);
  const [movingTaskId, setMovingTaskId] = useState<number | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const [statusFilter, setStatusFilter] = useState<BoardStatusFilter>('all');
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<number>>(() => new Set());
  const [bulkColumn, setBulkColumn] = useState<TaskColumn>('todo');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [reviewModalTask, setReviewModalTask] = useState<TaskBoardTask | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [worktypeRegistry, setWorktypeRegistry] = useState<WorktypeRegistryEntry[]>([]);
  const [overlayFilterKey, setOverlayFilterKey] = useState('');
  const [overlayFilterQuery, setOverlayFilterQuery] = useState('');
  const activeTaskDetailId = selectedTaskId ?? highlightTaskId;
  const query = globalSearch.trim().toLowerCase();
  const indexableOverlayFields = getIndexableWorktypeFields(worktypeRegistry).filter((entry) => entry.worktype !== 'general');
  const selectedOverlayFilter = indexableOverlayFields.find((entry) => `${entry.worktype}.${entry.field.name}` === overlayFilterKey) ?? null;
  const searchMatchedTasks = tasks
    .filter((task) => matchesGlobalSearch(task, query))
    .filter((task) => matchesOverlayFilter(task, selectedOverlayFilter, overlayFilterQuery));
  const filteredTasks = searchMatchedTasks.filter((task) => !task.archived);
  const archivedTasks = searchMatchedTasks.filter((task) => task.archived);
  const boardColumns: BoardColumn[] = showArchiveColumn
    ? ['backlog', 'todo', 'doing', 'review', 'done', 'archive']
    : ['backlog', 'todo', 'doing', 'review', 'done'];
  const activeTasksCount = filteredTasks.filter((task) => task.column === 'doing').length;
  const blockedTasksCount = filteredTasks.filter((task) => task.blocked && task.column !== 'done').length;
  const reviewTasksCount = filteredTasks.filter((task) => task.column === 'review').length;
  const starredTasksCount = filteredTasks.filter((task) => isTaskBookmarked(task)).length;
  const userProfile = readUserProfile();
  const ownerPrincipalOverride = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('ownerPrincipalId')?.trim()
    : null;
  const ownerPrincipal = ownerPrincipalOverride || userProfile.handle || userProfile.displayName;
  const ownerInboxItems = filteredTasks
    .filter((task) => !task.archived && task.column !== 'done' && task.owner_principal_id === ownerPrincipal)
    .map((task) => ({ task, groups: ownerInboxGroups(task) }))
    .filter((entry) => entry.groups.length > 0);
  const ownerInboxCounts = ownerInboxItems.reduce<Record<OwnerInboxGroup, number>>((counts, item) => {
    item.groups.forEach((group) => {
      counts[group] += 1;
    });
    return counts;
  }, {
    stalled: 0,
    escalated: 0,
    review_blocked: 0,
    gate_pending: 0,
    receipt_failed: 0,
    migration_warning: 0,
  });
  const ownerInboxGroupsByGroup = (Object.keys(OWNER_INBOX_LABELS) as OwnerInboxGroup[])
    .map((group) => ({
      group,
      items: ownerInboxItems.filter((item) => item.groups.includes(group)),
    }))
    .filter((entry) => entry.items.length > 0);
  const summaryStateClass = blockedTasksCount > 0 ? 'state-error' : activeTasksCount > 0 ? 'state-active' : 'state-idle';
  // Stat chips reflect totals; the status filter narrows which cards render on the board.
  const statusVisibleTasks = filteredTasks.filter((task) => matchesStatusFilter(task, statusFilter));
  const tasksByColumn: Record<BoardColumn, TaskBoardTask[]> = {
    backlog: [],
    todo: [],
    doing: [],
    review: [],
    done: [],
    // Archive is orthogonal to the active/review/blocked status filters.
    archive: statusFilter === 'all' ? archivedTasks : [],
  };

  statusVisibleTasks.forEach((task) => {
    tasksByColumn[task.column].push(task);
  });

  const selectedCount = selectedTaskIds.size;

  const toggleTaskSelection = (taskId: number) => {
    setBulkError(null);
    setSelectedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedTaskIds(new Set());
    setBulkError(null);
  };

  const handleStatusFilterClick = (next: BoardStatusFilter) => {
    setStatusFilter((current) => (current === next ? 'all' : next));
  };

  const handleToggleBookmark = async (taskId: number) => {
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task) {
      return;
    }
    const nextBookmarked = !isTaskBookmarked(task);
    try {
      await updateTask(taskId, { metadata: buildBookmarkMetadata(task, nextBookmarked) });
    } catch (error) {
      console.error('Failed to toggle task bookmark:', error);
    }
  };

  const handleBulkMove = async () => {
    if (selectedCount === 0 || bulkBusy) {
      return;
    }

    // Completing a task in Review requires a review decision — route it through
    // the review modal instead of failing the bulk move.
    if (bulkColumn === 'done') {
      const reviewTask = tasks.find(
        (candidate) => selectedTaskIds.has(candidate.id) && candidate.column === 'review',
      );
      if (reviewTask) {
        setReviewError(null);
        setReviewModalTask(reviewTask);
        return;
      }
    }

    const ids = Array.from(selectedTaskIds);
    setBulkBusy(true);
    setBulkError(null);
    const failures: number[] = [];
    for (const id of ids) {
      try {
        await onMoveTask(id, bulkColumn);
      } catch {
        failures.push(id);
      }
    }
    setBulkBusy(false);

    if (failures.length > 0) {
      setSelectedTaskIds(new Set(failures));
      setBulkError(
        `Moved ${ids.length - failures.length} of ${ids.length} task(s). ${failures.length} could not be moved to ${COLUMN_TITLES[bulkColumn]}.`,
      );
    } else {
      setSelectedTaskIds(new Set());
    }
  };

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
    let cancelled = false;

    void fetchWorktypeRegistry(apiBase)
      .then((registry) => {
        if (!cancelled) {
          setWorktypeRegistry(registry);
        }
      })
      .catch((error) => {
        console.error('Failed to load worktype registry:', error);
        if (!cancelled) {
          setWorktypeRegistry([]);
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

  const handleMoveTask = async (taskId: number, column: BoardColumn) => {
    if (column === 'archive') {
      setDraggedTaskId(null);
      return;
    }

    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task || task.column === column) {
      setDraggedTaskId(null);
      return;
    }

    if (task.column === 'review' && column === 'done') {
      setReviewError(null);
      setReviewModalTask(task);
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

  const handleReviewSubmit = async (
    action: 'accept' | 'accept_done' | 'needs_fix' | 'reject',
    note: string,
  ) => {
    const task = reviewModalTask;
    if (!task) {
      return;
    }

    let existing: Record<string, unknown> = {};
    try {
      existing = task.metadata ? (JSON.parse(task.metadata) as Record<string, unknown>) : {};
    } catch {
      existing = {};
    }

    const reviewer = readUserProfile().displayName || 'Henry';
    const decision = action === 'reject' ? 'rejected' : action === 'needs_fix' ? 'needs_fix' : 'accepted';
    const nextMeta = {
      ...existing,
      review_type: (existing.review_type as string) || (existing.review_class as string) || 'henry',
      review_decision: decision,
      reviewed_by: reviewer,
      reviewed_at: new Date().toISOString(),
      ...(note.trim() ? { review_note: note.trim() } : {}),
    };

    setReviewBusy(true);
    setReviewError(null);
    try {
      if (action === 'accept_done') {
        await updateTask(task.id, { metadata: JSON.stringify(nextMeta), column: 'done' });
      } else {
        await updateTask(task.id, { metadata: JSON.stringify(nextMeta) });
      }
      setReviewModalTask(null);
      setSelectedTaskIds((current) => {
        if (!current.has(task.id)) {
          return current;
        }
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    } catch (err) {
      setReviewError(toErrorMessage(err, 'Could not update review.'));
    } finally {
      setReviewBusy(false);
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
            <button
              type="button"
              onClick={() => handleStatusFilterClick('all')}
              aria-pressed={statusFilter === 'all'}
              title="Show all tasks"
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] transition hover:border-[var(--border-secondary)] ${
                statusFilter === 'all'
                  ? 'border-[var(--accent)] bg-[var(--surface-accent)] text-[var(--accent)] ring-1 ring-[var(--accent)]'
                  : 'border-[var(--border-primary)] bg-[var(--bg-primary)]'
              }`}
            >
              {filteredTasks.length} tasks
            </button>
            <button
              type="button"
              onClick={() => handleStatusFilterClick('active')}
              aria-pressed={statusFilter === 'active'}
              title="Filter to active (Doing) tasks"
              className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold text-[var(--accent)] transition hover:border-[var(--accent)] ${
                statusFilter === 'active'
                  ? 'border-[var(--accent)] bg-[var(--surface-accent)] ring-1 ring-[var(--accent)]'
                  : 'border-[var(--accent)]/30 bg-[var(--surface-accent)]'
              }`}
            >
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
              {activeTasksCount} active
            </button>
            <button
              type="button"
              onClick={() => handleStatusFilterClick('review')}
              aria-pressed={statusFilter === 'review'}
              title="Filter to tasks in Review"
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold text-amber-300 transition hover:border-amber-500 ${
                statusFilter === 'review'
                  ? 'border-amber-500 bg-amber-500/20 ring-1 ring-amber-500'
                  : 'border-amber-500/30 bg-amber-500/10'
              }`}
            >
              {reviewTasksCount} review
            </button>
            <button
              type="button"
              onClick={() => handleStatusFilterClick('blocked')}
              aria-pressed={statusFilter === 'blocked'}
              title="Filter to blocked tasks"
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold text-[var(--error)] transition hover:border-[var(--error)] ${
                statusFilter === 'blocked'
                  ? 'border-[var(--error)] bg-[var(--surface-error)] ring-1 ring-[var(--error)]'
                  : 'border-[var(--error)]/35 bg-[var(--surface-error)]'
              }`}
            >
              {blockedTasksCount} blocked
            </button>
            <button
              type="button"
              onClick={() => handleStatusFilterClick('starred')}
              aria-pressed={statusFilter === 'starred'}
              title="Filter to starred/bookmarked tasks"
              className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold text-amber-300 transition hover:border-amber-400 ${
                statusFilter === 'starred'
                  ? 'border-amber-400 bg-amber-400/20 ring-1 ring-amber-400'
                  : 'border-amber-400/30 bg-amber-400/10'
              }`}
            >
              <span aria-hidden="true">★</span>
              {starredTasksCount} starred
            </button>
            {query ? (
              <span className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-1.5 text-xs text-[var(--text-muted)]">
                Search: {globalSearch.trim()}
              </span>
            ) : null}
            <label className="flex items-center gap-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-xs text-[var(--text-secondary)]">
              <span>Overlay</span>
              <select
                value={overlayFilterKey}
                onChange={(event) => {
                  setOverlayFilterKey(event.target.value);
                  setOverlayFilterQuery('');
                }}
                className="mc-shell-input h-7 min-w-[190px] px-2 py-1 text-xs"
                data-testid="worktype-overlay-filter-field"
              >
                <option value="">Any indexable field</option>
                {indexableOverlayFields.map((entry) => {
                  const worktypeEntry = worktypeRegistry.find((candidate) => candidate.worktype === entry.worktype);
                  return (
                    <option key={`${entry.worktype}.${entry.field.name}`} value={`${entry.worktype}.${entry.field.name}`}>
                      {worktypeEntry ? getWorktypeLabel(worktypeEntry) : entry.worktype}: {entry.field.plan_label}
                    </option>
                  );
                })}
              </select>
            </label>
            {selectedOverlayFilter ? (
              <input
                value={overlayFilterQuery}
                onChange={(event) => setOverlayFilterQuery(event.target.value)}
                placeholder={`Filter ${selectedOverlayFilter.field.plan_label}`}
                className="mc-shell-input h-8 min-w-[180px] px-2 py-1 text-xs"
                data-testid="worktype-overlay-filter-query"
              />
            ) : null}
          </div>
          {ownerInboxItems.length > 0 ? (
            <section
              data-testid="owner-accountability-inbox"
              className="mt-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]/75 p-3 text-xs text-[var(--text-secondary)]"
              aria-label="Owner accountability inbox"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-semibold text-[var(--text-primary)]">Owner accountability inbox</div>
                  <div>{ownerPrincipal} has {ownerInboxItems.length} accountable task(s) needing attention</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(OWNER_INBOX_LABELS) as OwnerInboxGroup[])
                    .filter((group) => ownerInboxCounts[group] > 0)
                    .map((group) => (
                      <span key={group} className="entity-ops-chip">
                        {OWNER_INBOX_LABELS[group]}: {ownerInboxCounts[group]}
                      </span>
                    ))}
                </div>
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {ownerInboxGroupsByGroup.map(({ group, items }) => (
                  <div
                    key={group}
                    data-testid={`owner-accountability-group-${group}`}
                    className="rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-primary)] p-2"
                  >
                    <div className="font-semibold text-[var(--text-primary)]">
                      {OWNER_INBOX_LABELS[group]} ({items.length})
                    </div>
                    <div className="mt-1 space-y-1">
                      {items.slice(0, 3).map(({ task }) => (
                        <a
                          key={`${group}-${task.id}`}
                          href={`/tasks/${task.id}`}
                          data-testid={`owner-accountability-task-${task.id}`}
                          onClick={(event) => {
                            event.preventDefault();
                            handleOpenTask(task.id);
                          }}
                          className="block rounded border border-transparent px-2 py-1 text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
                        >
                          <span className="font-medium text-[var(--text-primary)]">#{task.id}</span> {task.name}
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          {selectedCount > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--accent)]/40 bg-[var(--surface-accent)] p-2">
              <span className="px-2 text-xs font-semibold text-[var(--accent)]">{selectedCount} selected</span>
              <label className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                <span>Move to</span>
                <select
                  value={bulkColumn}
                  onChange={(event) => setBulkColumn(event.target.value as TaskColumn)}
                  disabled={bulkBusy}
                  className="mc-shell-input h-8 px-2 py-1 text-xs"
                >
                  {BULK_MOVE_COLUMNS.map((column) => (
                    <option key={column} value={column}>
                      {COLUMN_TITLES[column]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => void handleBulkMove()}
                disabled={bulkBusy}
                className="mc-shell-btn mc-shell-btn-active px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
              >
                {bulkBusy ? 'Moving...' : 'Move selected'}
              </button>
              <button
                type="button"
                onClick={clearSelection}
                disabled={bulkBusy}
                className="mc-shell-btn px-3 py-1.5 text-xs font-medium"
              >
                Clear
              </button>
              {bulkError ? <span className="px-2 text-xs text-[var(--error)]">{bulkError}</span> : null}
            </div>
          ) : null}
        </div>
        <div className="board scroll-px-4 md:scroll-px-5" data-testid="mc-react-kanban-board">
          {boardColumns.map((column) => (
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
              selectedTaskIds={selectedTaskIds}
              onToggleSelect={toggleTaskSelection}
              onToggleBookmark={handleToggleBookmark}
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
      <ReviewActionModal
        open={reviewModalTask !== null}
        task={reviewModalTask}
        busy={reviewBusy}
        error={reviewError}
        onClose={() => {
          setReviewModalTask(null);
          setReviewError(null);
        }}
        onSubmit={handleReviewSubmit}
      />
    </div>
  );
}
