import { useEffect, useRef, useState } from "react";
import MCHeader from "./mission-control/MCHeader";
import MCOpsView from "./mission-control/MCOpsView";
import { useMCData } from "../hooks/useMCData";
import {
  useTaskBoard,
  type TaskBoardTask,
  type TaskColumn,
  type CreateTaskPayload,
} from "../hooks/useTaskBoard";

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
  showArchiveColumn?: boolean;
  onArchiveColumnVisibilityChange?: (visible: boolean) => void;
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
  showArchiveColumn = true,
  onArchiveColumnVisibilityChange,
}: TaskBoardProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [activeViewport, setActiveViewport] = useState(false);
  const [activeTab, setActiveTab] = useState<"kanban" | "insights">("kanban");
  const [globalSearch, setGlobalSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [reviewFilter, setReviewFilter] = useState("all");
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
    return result;
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
        tasks={filteredTasks}
        showArchiveColumn={showArchiveColumn}
      />
    </div>
  );
}
