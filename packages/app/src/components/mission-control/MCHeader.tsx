import { useUserProfile } from "../../lib/userProfile";

export type MCTab = "kanban" | "insights";

interface MCHeaderProps {
  activeTab: MCTab;
  onTabChange: (tab: MCTab) => void;
  globalSearch: string;
  onGlobalSearchChange: (value: string) => void;
  reviewFilter?: string;
  onReviewFilterChange?: (value: string) => void;
}

export default function MCHeader({
  activeTab,
  onTabChange,
  globalSearch,
  onGlobalSearchChange,
  reviewFilter = "all",
  onReviewFilterChange,
}: MCHeaderProps) {
  const [userProfile] = useUserProfile();

  return (
    <header
      className="border-b border-[var(--border-primary)] bg-[var(--bg-primary)]/85 px-4 pb-3 pt-3 backdrop-blur md:px-5"
      data-testid="mc-header"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
            Mission Control
          </div>
          <h1 className="truncate text-lg font-semibold leading-tight text-[var(--text-primary)]">
            Tasks
          </h1>
        </div>

        <div
          className="ml-auto flex items-center gap-1 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-1"
          role="tablist"
          aria-label="Mission Control views"
        >
          <button
            type="button"
            onClick={() => onTabChange("kanban")}
            role="tab"
            aria-selected={activeTab === "kanban"}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
              activeTab === "kanban"
                ? "border-[var(--accent)] bg-[var(--surface-accent)] text-[var(--text-primary)]"
                : "border-[var(--border-primary)] text-[var(--text-muted)] hover:border-[var(--border-secondary)] hover:text-[var(--text-secondary)]"
            }`}
          >
            Kanban
          </button>
          <button
            type="button"
            onClick={() => onTabChange("insights")}
            role="tab"
            aria-selected={activeTab === "insights"}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
              activeTab === "insights"
                ? "border-[var(--accent)] bg-[var(--surface-accent)] text-[var(--text-primary)]"
                : "border-[var(--border-primary)] text-[var(--text-muted)] hover:border-[var(--border-secondary)] hover:text-[var(--text-secondary)]"
            }`}
          >
            Insights
          </button>
        </div>

        <label className="flex min-w-[260px] flex-1 items-center gap-2 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-3 py-2 md:max-w-[460px]">
          <span
            className="text-xs font-semibold text-[var(--text-muted)]"
            aria-hidden="true"
          >
            /
          </span>
          <input
            type="text"
            value={globalSearch}
            onChange={(event) => onGlobalSearchChange(event.target.value)}
            placeholder="Search tasks, assignees, projects"
            className="w-full bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            aria-label="Search all tasks"
          />
        </label>

        <div
          className="flex flex-wrap items-center gap-1 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-1"
          aria-label="Review filters"
        >
          {[
            ["all", "All"],
            ["henry", userProfile.displayName],
            ["peer", "Peer"],
            ["needs_fix", "Needs Fix"],
            ["escalated", "Escalated"],
            ["accepted", "Recently Accepted"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onReviewFilterChange?.(value)}
              className={`rounded-md border px-2 py-1 text-xs font-medium transition ${
                reviewFilter === value
                  ? "border-[var(--accent)] bg-[var(--surface-accent)] text-[var(--text-primary)]"
                  : "border-transparent text-[var(--text-muted)] hover:border-[var(--border-secondary)] hover:text-[var(--text-secondary)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] text-sm text-[var(--text-muted)] transition hover:border-[var(--border-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          onClick={() =>
            (
              window as typeof window & { toggleSettings?: () => void }
            ).toggleSettings?.()
          }
          aria-label="Settings"
          title="Settings"
        >
          ...
        </button>
      </div>
    </header>
  );
}
