import { useEffect, useMemo, useRef, useState } from "react";
import MCHeader from "./mission-control/MCHeader";
import MCOpsView from "./mission-control/MCOpsView";
import { useMCData } from "../hooks/useMCData";
import {
  useTaskBoard,
  type TaskBoardTask,
  type TaskColumn,
  type CreateTaskPayload,
} from "../hooks/useTaskBoard";
import {
  fetchWorktypeRegistry,
  formatOverlayValue,
  getIndexableWorktypeFields,
  getWorktypeLabel,
  readWorktype,
  readWorktypeLayer,
  type WorktypeRegistryEntry,
} from "./mission-control/utils/worktypeRegistry";

export type MCViewport = "desktop" | "tablet" | "mobile";

interface TaskBoardProps {
  viewport: MCViewport;
  compactShell?: boolean;
  className?: string;
  showInsights?: boolean;
  activeTab?: "kanban" | "insights";
  onActiveTabChange?: (tab: "kanban" | "insights") => void;
  searchQuery?: string;
  apiBase?: string;
  tasks?: TaskBoardTask[];
  columns?: readonly TaskColumn[];
  loading?: boolean;
  error?: string | null;
  onCreateTask?: (payload: CreateTaskPayload) => Promise<unknown>;
  onMoveTask?: (taskId: number, column: TaskColumn) => Promise<unknown>;
  highlightTaskId?: number | null;
  onOpenTask?: (taskId: number) => void;
  onCloseTask?: () => void;
  onDocsLinkNavigate?: (href: string) => boolean;
  showArchiveColumn?: boolean;
  onArchiveColumnVisibilityChange?: (visible: boolean) => void;
  scopeTaskDetailsToTasks?: boolean;
  /** THE-860 — board/tab key preserved into Workplane return context. */
  returnBoard?: string | null;
}

function parseTaskMetadata(task: TaskBoardTask): Record<string, any> {
  if (!task.metadata) return {};
  try {
    const parsed = JSON.parse(task.metadata);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function matchesReviewFilter(task: TaskBoardTask, filter: string): boolean {
  if (!filter || filter === "all") return true;
  const metadata = parseTaskMetadata(task);
  if (filter === "henry")
    return metadata.review_type === "henry" || metadata.henry_required === true;
  if (filter === "peer") return metadata.review_type === "peer";
  if (filter === "needs_fix")
    return (
      metadata.review_decision === "needs_fix" ||
      Boolean(
        task.blocker_reason
          ?.toLowerCase()
          .includes("insufficient review packet"),
      )
    );
  if (filter === "escalated")
    return (
      metadata.review_decision === "escalated" ||
      metadata.henry_required === true
    );
  if (filter === "accepted") return metadata.review_decision === "accepted";
  return true;
}

function matchesWorktypeFilter(task: TaskBoardTask, filter: string): boolean {
  if (!filter || filter === "all") return true;
  return readWorktype(parseTaskMetadata(task), task.worktype) === filter;
}

function matchesOverlayFieldFilter(task: TaskBoardTask, filterKey: string, value: string): boolean {
  if (!filterKey || !value.trim()) return true;
  const [worktype, fieldName] = filterKey.split('.', 2);
  if (!worktype || !fieldName) return true;
  const metadata = parseTaskMetadata(task);
  const normalizedMetadata = {
    ...metadata,
    worktype: task.worktype,
    policy_inputs_json: task.policy_inputs_json ?? metadata.policy_inputs_json,
  };
  if (readWorktype(normalizedMetadata, task.worktype) !== worktype) return false;
  const layer = readWorktypeLayer(normalizedMetadata);
  const formatted = formatOverlayValue(layer[fieldName]);
  return Boolean(formatted && formatted.toLowerCase().includes(value.trim().toLowerCase()));
}

function isKnownPrincipal(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized) && !normalized.startsWith("legacy-") && normalized !== "unknown";
}

function isExecutableTask(task: TaskBoardTask): boolean {
  return task.column === "todo" || task.column === "doing" || task.column === "review";
}

function isViewportMatch(viewport: MCViewport, width: number): boolean {
  if (viewport === "desktop") {
    return width >= 1024;
  }

  if (viewport === "tablet") {
    return width >= 768 && width < 1024;
  }

  return width < 768;
}

export default function TaskBoard({
  viewport,
  compactShell = false,
  className = "",
  showInsights = true,
  activeTab: controlledActiveTab,
  onActiveTabChange,
  searchQuery,
  apiBase,
  tasks: tasksProp,
  loading: loadingProp,
  error: errorProp,
  onMoveTask,
  highlightTaskId = null,
  onOpenTask,
  onCloseTask,
  onDocsLinkNavigate,
  showArchiveColumn = true,
  onArchiveColumnVisibilityChange,
  scopeTaskDetailsToTasks = false,
  returnBoard = null,
}: TaskBoardProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [activeViewport, setActiveViewport] = useState(false);
  const [activeTab, setActiveTab] = useState<"kanban" | "insights">("kanban");
  const [globalSearch, setGlobalSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [reviewFilter, setReviewFilter] = useState("all");
  const [worktypeFilter, setWorktypeFilter] = useState("all");
  const [overlayFieldFilter, setOverlayFieldFilter] = useState("");
  const [overlayFieldValue, setOverlayFieldValue] = useState("");
  const [worktypeRegistry, setWorktypeRegistry] = useState<WorktypeRegistryEntry[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const taskBoardState = useTaskBoard({ autoLoad: false });
  const tasks = tasksProp ?? taskBoardState.tasks;
  const loading = loadingProp ?? taskBoardState.loading;
  const error = errorProp ?? taskBoardState.error;
  const moveTask = onMoveTask ?? taskBoardState.moveTask;
  useEffect(() => {
    (window as any).filterByUser = (assignee: string) => {
      setAssigneeFilter(assignee);
    };
    (window as any).filterByReview = (filter: string) => {
      setReviewFilter(filter || "all");
    };
    return () => {
      delete (window as any).filterByUser;
      delete (window as any).filterByReview;
    };
  }, []);

  useEffect(() => {
    setMounted(true);

    const updateViewport = () => {
      setActiveViewport(isViewportMatch(viewport, window.innerWidth));
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);

    return () => {
      window.removeEventListener("resize", updateViewport);
    };
  }, [viewport]);

  useEffect(() => {
    if (!mounted || !activeViewport) {
      return;
    }
    let cancelled = false;
    void fetchWorktypeRegistry(apiBase ?? '').then((registry) => {
      if (!cancelled) {
        setWorktypeRegistry(registry.filter((entry) => entry.worktype !== 'general'));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeViewport, apiBase, mounted]);

  useMCData(mounted && activeViewport);

  useEffect(() => {
    if (!controlledActiveTab) {
      return;
    }
    setActiveTab(controlledActiveTab);
  }, [controlledActiveTab]);

  useEffect(() => {
    if (typeof searchQuery !== "string") {
      return;
    }
    setGlobalSearch(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    if (!mounted || !activeViewport || !rootRef.current) {
      return;
    }

    const updateAvailableHeight = () => {
      const root = rootRef.current;
      if (!root) return;

      const rect = root.getBoundingClientRect();
      const bottomViewportPadding = 12;
      const availableHeight = Math.max(
        240,
        Math.floor(window.innerHeight - rect.top - bottomViewportPadding),
      );
      root.style.setProperty(
        "--mc-columns-available-height",
        `${availableHeight}px`,
      );
    };

    updateAvailableHeight();
    window.addEventListener("resize", updateAvailableHeight);

    return () => {
      window.removeEventListener("resize", updateAvailableHeight);
    };
  }, [mounted, activeViewport]);

  const handleTabChange = (tab: "kanban" | "insights") => {
    setActiveTab(tab);
    onActiveTabChange?.(tab);
  };

  const indexableOverlayFields = useMemo(() => getIndexableWorktypeFields(worktypeRegistry), [worktypeRegistry]);
  const selectedOverlayField = indexableOverlayFields.find(({ worktype, field }) => `${worktype}.${field.name}` === overlayFieldFilter) ?? null;

  if (!mounted || !activeViewport) {
    return null;
  }

  const isMobileViewport = viewport === "mobile";
  const filteredTasks = (() => {
    let result = tasks;
    if (assigneeFilter && assigneeFilter !== "all") {
      result = result.filter((t) => t.assignee === assigneeFilter);
    }
    if (reviewFilter && reviewFilter !== "all") {
      result = result.filter((t) => matchesReviewFilter(t, reviewFilter));
    }
    if (worktypeFilter && worktypeFilter !== "all") {
      result = result.filter((t) => matchesWorktypeFilter(t, worktypeFilter));
    }
    if (overlayFieldFilter && overlayFieldValue.trim()) {
      result = result.filter((t) => matchesOverlayFieldFilter(t, overlayFieldFilter, overlayFieldValue));
    }
    return result;
  })();
  const workPlaneSummary = (() => {
    const projectKeys = new Set<string>();
    for (const task of tasks) {
      for (const project of task.projects) {
        projectKeys.add(project.id ? `id:${project.id}` : `name:${project.name.toLowerCase()}`);
      }
      if (task.project_id) {
        projectKeys.add(`id:${task.project_id}`);
      }
    }

    const ownedTasks = tasks.filter((task) => isKnownPrincipal(task.owner_principal_id)).length;
    const unknownAccountabilityTasks = tasks.filter(
      (task) => !isKnownPrincipal(task.initiator_principal_id) || !isKnownPrincipal(task.owner_principal_id)
    ).length;
    const executableTasks = tasks.filter(isExecutableTask);
    const executableWithAssigneeOrExecutor = executableTasks.filter(
      (task) =>
        isKnownPrincipal(task.executor_principal_id) ||
        (task.assignee.trim() !== "" && task.assignee.toLowerCase() !== "unassigned") ||
        task.taskmaster_drivable
    ).length;

    return {
      projects: projectKeys.size,
      ownedTasks,
      unknownAccountabilityTasks,
      executableTasks: executableTasks.length,
      executableWithAssigneeOrExecutor,
    };
  })();

  return (
    <div
      ref={rootRef}
      className={`mc-root entity-ops-surface h-full overflow-auto text-[var(--text-secondary)] ${className}`}
    >
      <div
        className={compactShell ? "hidden" : ""}
        style={isMobileViewport ? { display: "none" } : undefined}
      >
        <MCHeader
          activeTab={activeTab}
          onTabChange={handleTabChange}
          globalSearch={globalSearch}
          onGlobalSearchChange={setGlobalSearch}
          reviewFilter={reviewFilter}
          onReviewFilterChange={setReviewFilter}
          onSettingsOpen={() => setSettingsOpen(true)}
        />
        <section
          data-testid="work-plane-summary"
          className="border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]/70 px-4 py-2 text-xs text-[var(--text-secondary)] md:px-5"
          aria-label="Entity work plane summary"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
              Work plane
            </span>
            <span className="rounded-full border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-0.5">
              {workPlaneSummary.projects} project{workPlaneSummary.projects === 1 ? "" : "s"}
            </span>
            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-emerald-200">
              {workPlaneSummary.ownedTasks}/{tasks.length} tasks have owners
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 ${
                workPlaneSummary.unknownAccountabilityTasks > 0
                  ? "border-amber-500/25 bg-amber-500/10 text-amber-200"
                  : "border-[var(--accent)]/25 bg-[var(--surface-accent)] text-[var(--accent)]"
              }`}
            >
              {workPlaneSummary.unknownAccountabilityTasks} unknown accountability
            </span>
            <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-sky-200">
              {workPlaneSummary.executableWithAssigneeOrExecutor}/{workPlaneSummary.executableTasks} active executable
            </span>
          </div>
        </section>
        <section
          data-testid="worktype-overlay-filters"
          className="border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]/60 px-4 py-2 text-xs text-[var(--text-secondary)] md:px-5"
          aria-label="Worktype overlay filters"
        >
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[180px]">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                Worktype
              </span>
              <select
                value={worktypeFilter}
                onChange={(event) => setWorktypeFilter(event.target.value)}
                className="mc-shell-input h-8 w-full px-2 py-1 text-xs"
                data-testid="worktype-filter-select"
              >
                <option value="all">All worktypes</option>
                {worktypeRegistry.map((entry) => (
                  <option key={entry.worktype} value={entry.worktype}>
                    {getWorktypeLabel(entry)}
                  </option>
                ))}
              </select>
            </label>

            <label className="min-w-[220px]">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                Indexable overlay field
              </span>
              <select
                value={overlayFieldFilter}
                onChange={(event) => {
                  setOverlayFieldFilter(event.target.value);
                  setOverlayFieldValue('');
                }}
                className="mc-shell-input h-8 w-full px-2 py-1 text-xs"
                data-testid="worktype-indexable-filter-select"
              >
                <option value="">No overlay field filter</option>
                {indexableOverlayFields.map(({ worktype, field }) => {
                  const worktypeEntry = worktypeRegistry.find((entry) => entry.worktype === worktype);
                  return (
                    <option key={`${worktype}:${field.name}`} value={`${worktype}.${field.name}`}>
                      {worktypeEntry ? `${getWorktypeLabel(worktypeEntry)}: ` : ''}{field.plan_label}
                    </option>
                  );
                })}
              </select>
            </label>

            <label className="min-w-[220px] flex-1">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                Filter value
              </span>
              <input
                type="text"
                value={overlayFieldValue}
                onChange={(event) => setOverlayFieldValue(event.target.value)}
                disabled={!overlayFieldFilter}
                placeholder={selectedOverlayField ? `Filter ${selectedOverlayField.field.plan_label}` : 'Choose an indexable overlay field'}
                className="mc-shell-input h-8 w-full px-2 py-1 text-xs disabled:opacity-60"
                data-testid="worktype-indexable-filter-value"
              />
            </label>

            <div className="pb-1 text-[11px] text-[var(--text-muted)]">
              Filters only use declared indexable overlay fields.
            </div>
          </div>
        </section>
      </div>
      {settingsOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-labelledby="mc-settings-title">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border-secondary)] bg-[var(--card-bg)] p-4 shadow-[0_24px_64px_rgba(0,0,0,0.45)]">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 id="mc-settings-title" className="text-base font-semibold text-[var(--text-primary)]">Mission Control settings</h2>
                <p className="mt-1 text-xs text-[var(--text-muted)]">Board preferences are saved on this device.</p>
              </div>
              <button type="button" onClick={() => setSettingsOpen(false)} className="mc-shell-btn inline-flex h-8 w-8 items-center justify-center px-0 py-0 text-sm" aria-label="Close Mission Control settings">
                ✕
              </button>
            </div>
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3">
              <span>
                <span className="block text-sm font-medium text-[var(--text-primary)]">Archive column</span>
                <span className="mt-1 block text-xs text-[var(--text-muted)]">Show archived tasks as a separate board column.</span>
              </span>
              <input
                type="checkbox"
                checked={showArchiveColumn}
                onChange={(event) => onArchiveColumnVisibilityChange?.(event.target.checked)}
                aria-label="Show Archive column"
                className="h-5 w-5 accent-[var(--accent)]"
              />
            </label>
          </div>
        </div>
      ) : null}
      <MCOpsView
        apiBase={apiBase}
        compactShell={compactShell}
        showInsights={showInsights}
        activeTab={activeTab}
        error={error}
        globalSearch={globalSearch}
        highlightTaskId={highlightTaskId}
        loading={loading}
        onMoveTask={moveTask}
        onOpenTask={onOpenTask}
        onCloseTask={onCloseTask}
        onDocsLinkNavigate={onDocsLinkNavigate}
        tasks={filteredTasks}
        showArchiveColumn={showArchiveColumn}
        scopeTaskDetailsToTasks={scopeTaskDetailsToTasks}
        returnBoard={returnBoard}
      />
    </div>
  );
}
