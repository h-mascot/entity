/**
 * THE-866 / WP1-B-05 — Workplane missing-proof warning panel.
 *
 * Explicitly surfaces when a task lacks required proof/evidence/output links.
 * Fail-closed for empty, loading, error, unknown, and unavailable metadata.
 * Never claims the task is review-ready.
 */

import {
  buildMissingProofWarningView,
  type MissingProofWarning,
  type MissingProofWarningView,
} from '../../lib/workplaneMissingProof.ts';
import type { WorkplaneProofBundleLoadState } from '../../lib/workplaneProofBundle.ts';

export interface MissingProofWarningPanelProps {
  /** Proof bundle load state from WorkplaneShell (THE-864). */
  proofLoadState: WorkplaneProofBundleLoadState;
  /** Optional precomputed view (tests). */
  view?: MissingProofWarningView;
  /** Retry handler when proof metadata failed to load. */
  onRetry?: () => void;
}

function WarningRow({ warning }: { warning: MissingProofWarning }) {
  return (
    <li
      className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2"
      data-testid="workplane-missing-proof-warning"
      data-warning-id={warning.id}
      data-warning-kind={warning.kind}
      data-warning-severity={warning.severity}
    >
      <p
        className="text-xs font-medium text-[var(--text-primary)]"
        data-testid="workplane-missing-proof-warning-title"
      >
        {warning.title}
      </p>
      <p
        className="mt-1 text-[11px] text-[var(--text-muted)]"
        data-testid="workplane-missing-proof-warning-message"
      >
        {warning.message}
      </p>
    </li>
  );
}

export default function MissingProofWarningPanel({
  proofLoadState,
  view: controlledView,
  onRetry,
}: MissingProofWarningPanelProps) {
  const view = controlledView ?? buildMissingProofWarningView(proofLoadState);
  const { status, taskId, warningVisible, warnings, errorMessage, reviewReady } = view;

  return (
    <section
      className="mc-shell-card rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-3"
      aria-label="Missing-proof warnings"
      data-testid="workplane-missing-proof"
      data-missing-proof-status={status}
      data-missing-proof-warning-visible={warningVisible ? 'true' : 'false'}
      data-missing-proof-review-ready={reviewReady ? 'true' : 'false'}
      data-missing-proof-task-id={taskId !== null ? String(taskId) : undefined}
      data-proof-present={view.proofPresent ? 'true' : 'false'}
      data-proof-item-count={String(view.proofItemCount)}
      data-unknown-item-count={String(view.unknownItemCount)}
      data-missing-evidence={view.missingEvidence ? 'true' : 'false'}
    >
      <header className="mb-2">
        <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
          Missing-proof warnings
        </p>
      </header>

      {status === 'loading' ? (
        <div
          className="text-sm text-[var(--text-muted)]"
          role="status"
          aria-live="polite"
          data-testid="workplane-missing-proof-loading"
        >
          Checking proof and evidence…
        </div>
      ) : null}

      {status === 'empty' ? (
        <div
          className="text-sm"
          role="alert"
          data-testid="workplane-missing-proof-empty"
          data-missing-proof-warning-visible="true"
        >
          <p className="font-medium text-[var(--text-primary)]">No proof payload</p>
          <p className="mt-1 text-[var(--text-muted)]">
            {taskId
              ? `Task ${taskId} was not found or has no proof payload. Missing proof — not review-ready.`
              : 'Open a Workplane with a valid task id to inspect missing-proof warnings.'}
          </p>
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="text-sm" role="alert" data-testid="workplane-missing-proof-error">
          <p className="font-medium text-[var(--text-primary)]">Proof metadata unavailable</p>
          <p className="mt-1 text-[var(--text-muted)]">
            {errorMessage ??
              'Something went wrong while loading proof metadata. Do not treat this task as review-ready.'}
          </p>
          {onRetry ? (
            <button
              type="button"
              className="mc-shell-btn mt-3 rounded border border-[var(--border-primary)] px-2 py-1 text-[var(--text-primary)]"
              data-testid="workplane-missing-proof-retry"
              onClick={onRetry}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {status === 'warning' || status === 'degraded' ? (
        <div
          data-testid="workplane-missing-proof-ready"
          data-missing-proof-warning-visible="true"
          role="alert"
        >
          <p
            className="text-sm font-medium text-[var(--text-primary)]"
            data-testid="workplane-missing-proof-banner"
          >
            {status === 'warning'
              ? 'Proof is missing or incomplete — not review-ready'
              : 'Proof metadata is degraded — not review-ready'}
          </p>
          <ul
            className="mt-3 flex flex-col gap-2"
            data-testid="workplane-missing-proof-warning-list"
          >
            {warnings.map((warning) => (
              <WarningRow key={warning.id} warning={warning} />
            ))}
          </ul>
        </div>
      ) : null}

      {status === 'clear' ? (
        <div
          className="text-sm text-[var(--text-muted)]"
          role="status"
          data-testid="workplane-missing-proof-clear"
          data-missing-proof-warning-visible="false"
        >
          <p className="font-medium text-[var(--text-primary)]">No missing-proof warning</p>
          <p className="mt-1">
            Required proof/evidence or output links appear present
            {view.proofItemCount > 0 ? ` (${view.proofItemCount} item${view.proofItemCount === 1 ? '' : 's'})` : ''}
            . This panel does not mark the task review-ready.
          </p>
          {view.evidenceSummary ? (
            <p className="mt-2 text-[11px]" data-testid="workplane-missing-proof-summary">
              {view.evidenceSummary}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
