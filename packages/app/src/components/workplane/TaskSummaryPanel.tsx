/**
 * THE-862 / WP1-B-01 — Workplane task summary panel.
 *
 * Presentational empty / loading / error / ready states for the active task.
 */

import type {
  WorkplaneTaskSummaryLoadState,
  WorkplaneTaskSummaryView,
} from '../../lib/workplaneTaskSummary.ts';

export interface TaskSummaryPanelProps {
  loadState: WorkplaneTaskSummaryLoadState;
  /** Retry handler for error state (optional). */
  onRetry?: () => void;
}

function MetaRow({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs" data-testid={testId}>
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="text-[var(--text-primary)]">{value}</span>
    </div>
  );
}

function ReadySummary({ summary }: { summary: WorkplaneTaskSummaryView }) {
  return (
    <div data-testid="workplane-task-summary-ready" data-task-id={String(summary.taskId)}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span
          className="font-mono text-[11px] text-[var(--text-muted)]"
          data-testid="workplane-task-summary-identifier"
        >
          {summary.identifier}
        </span>
        <h2
          className="text-sm font-semibold text-[var(--text-primary)]"
          data-testid="workplane-task-summary-title"
        >
          {summary.title}
        </h2>
      </div>

      <div className="mt-3 flex flex-col gap-1.5">
        <MetaRow
          label="Status"
          value={summary.statusLabel}
          testId="workplane-task-summary-status"
        />
        {summary.priority ? (
          <MetaRow
            label="Priority"
            value={summary.priority}
            testId="workplane-task-summary-priority"
          />
        ) : null}
        {summary.assignee ? (
          <MetaRow
            label="Assignee"
            value={summary.assignee}
            testId="workplane-task-summary-assignee"
          />
        ) : null}
        {summary.blocked ? (
          <MetaRow
            label="Blocked"
            value={summary.blockerReason ?? 'Yes'}
            testId="workplane-task-summary-blocked"
          />
        ) : null}
        {summary.reviewLabel ? (
          <MetaRow
            label="Review"
            value={summary.reviewLabel}
            testId="workplane-task-summary-review"
          />
        ) : (
          <p
            className="text-xs text-[var(--text-muted)]"
            data-testid="workplane-task-summary-review-empty"
          >
            No review metadata
          </p>
        )}
      </div>

      {summary.descriptionPreview ? (
        <p
          className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]"
          data-testid="workplane-task-summary-description"
        >
          {summary.descriptionPreview}
        </p>
      ) : (
        <p
          className="mt-3 text-xs text-[var(--text-muted)]"
          data-testid="workplane-task-summary-description-empty"
        >
          No description
        </p>
      )}

      <div
        className="mt-3 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2"
        data-testid="workplane-task-summary-proof"
        data-missing-proof={summary.missingProof ? 'true' : 'false'}
      >
        <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
          Proof context
        </p>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          {summary.proofSummary ?? 'No evidence summary recorded.'}
        </p>
        {summary.missingProof ? (
          <p
            className="mt-1 text-xs text-[var(--text-primary)]"
            data-testid="workplane-task-summary-missing-proof"
          >
            {summary.missingProofReason ?? 'Proof/evidence appears missing for this task.'}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default function TaskSummaryPanel({ loadState, onRetry }: TaskSummaryPanelProps) {
  const { status, taskId, summary, errorMessage } = loadState;

  return (
    <section
      className="mc-shell-card rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-3"
      aria-label="Task summary"
      data-testid="workplane-task-summary"
      data-summary-status={status}
      data-summary-task-id={taskId !== null ? String(taskId) : undefined}
    >
      <header className="mb-2">
        <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Task summary</p>
      </header>

      {status === 'loading' ? (
        <div
          className="text-sm text-[var(--text-muted)]"
          role="status"
          aria-live="polite"
          data-testid="workplane-task-summary-loading"
        >
          Loading task summary…
        </div>
      ) : null}

      {status === 'empty' ? (
        <div
          className="text-sm text-[var(--text-muted)]"
          role="status"
          data-testid="workplane-task-summary-empty"
        >
          <p className="font-medium text-[var(--text-primary)]">No task available</p>
          <p className="mt-1">
            {taskId
              ? `Task ${taskId} was not found or has no summary data.`
              : 'Open a Workplane with a valid task id to see summary context.'}
          </p>
        </div>
      ) : null}

      {status === 'error' ? (
        <div
          className="text-sm"
          role="alert"
          data-testid="workplane-task-summary-error"
        >
          <p className="font-medium text-[var(--text-primary)]">Unable to load task summary</p>
          <p className="mt-1 text-[var(--text-muted)]">
            {errorMessage ?? 'Something went wrong while loading this task.'}
          </p>
          {onRetry ? (
            <button
              type="button"
              className="mc-shell-btn mt-3 rounded border border-[var(--border-primary)] px-2 py-1 text-[var(--text-primary)]"
              data-testid="workplane-task-summary-retry"
              onClick={onRetry}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {status === 'ready' && summary ? <ReadySummary summary={summary} /> : null}
    </section>
  );
}
