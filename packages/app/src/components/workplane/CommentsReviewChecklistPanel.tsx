/**
 * THE-873 / WP1-C-05 — Workplane comments/review checklist panel.
 *
 * Displays task comments and a review checklist derived from existing
 * reviewActions + task metadata. Explicit empty/loading/error; never claims
 * review-ready (WP1-C-06 owns the gate).
 */

import {
  REVIEW_DECISION_LABELS,
  type ReviewDecision,
} from '../mission-control/reviewActions.ts';
import {
  type CommentsReviewBundle,
  type ReviewChecklistItem,
  type WorkplaneCommentItem,
  type WorkplaneCommentsReviewLoadState,
} from '../../lib/workplaneCommentsReview.ts';

export interface CommentsReviewChecklistPanelProps {
  loadState: WorkplaneCommentsReviewLoadState;
  /** Retry handler for error state (optional). */
  onRetry?: () => void;
}

function DecisionBadge({ decision }: { decision: ReviewDecision }) {
  return (
    <span
      className="mc-shell-pill rounded border border-[var(--border-primary)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]"
      data-testid="workplane-comments-review-decision-badge"
      data-review-decision={decision}
    >
      {REVIEW_DECISION_LABELS[decision]}
    </span>
  );
}

function ChecklistRow({ item }: { item: ReviewChecklistItem }) {
  return (
    <li
      className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2"
      data-testid="workplane-review-checklist-item"
      data-checklist-id={item.id}
      data-checklist-source={item.source}
      data-checklist-status={item.status}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className="text-xs font-medium text-[var(--text-primary)]"
          data-testid="workplane-review-checklist-item-label"
        >
          {item.label}
        </p>
        <span
          className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]"
          data-testid="workplane-review-checklist-item-status"
        >
          {item.status}
        </span>
      </div>
    </li>
  );
}

function CommentRow({ comment }: { comment: WorkplaneCommentItem }) {
  return (
    <li
      className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2"
      data-testid="workplane-comment-item"
      data-comment-id={String(comment.id)}
      data-comment-author={comment.author}
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
        <span data-testid="workplane-comment-author">{comment.author}</span>
        {comment.createdAt ? (
          <span data-testid="workplane-comment-timestamp">{comment.createdAt}</span>
        ) : null}
      </div>
      <p
        className="mt-1 whitespace-pre-wrap text-xs text-[var(--text-primary)]"
        data-testid="workplane-comment-body"
      >
        {comment.body || '(empty comment)'}
      </p>
    </li>
  );
}

function ReadyBundle({ bundle }: { bundle: CommentsReviewBundle }) {
  return (
    <div
      data-testid="workplane-comments-review-ready"
      data-task-id={bundle.taskId !== null ? String(bundle.taskId) : undefined}
      data-review-decision={bundle.decision}
      data-review-required={bundle.reviewRequired ? 'true' : 'false'}
      data-has-review-metadata={bundle.hasReviewMetadata ? 'true' : 'false'}
      data-comments-available={bundle.commentsAvailable ? 'true' : 'false'}
      data-comments-empty={bundle.commentsEmpty ? 'true' : 'false'}
      data-comments-count={String(bundle.comments.length)}
      data-checklist-count={String(bundle.checklist.length)}
      data-review-empty={bundle.empty ? 'true' : 'false'}
      data-review-degraded={bundle.degraded ? 'true' : 'false'}
      data-review-ready="false"
    >
      <div className="flex flex-wrap items-center gap-2">
        <DecisionBadge decision={bundle.decision} />
        {bundle.reviewRequired ? (
          <span
            className="text-[11px] text-[var(--text-muted)]"
            data-testid="workplane-comments-review-required"
          >
            Review required
          </span>
        ) : (
          <span
            className="text-[11px] text-[var(--text-muted)]"
            data-testid="workplane-comments-review-not-required"
          >
            Review not required
          </span>
        )}
      </div>

      <dl className="mt-3 grid gap-2 text-xs text-[var(--text-secondary)] sm:grid-cols-2">
        <div className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5">
          <dt className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Reviewer</dt>
          <dd data-testid="workplane-comments-review-reviewer">
            {bundle.reviewer ?? 'Unassigned'}
          </dd>
        </div>
        <div className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5">
          <dt className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Type</dt>
          <dd data-testid="workplane-comments-review-type">{bundle.reviewType ?? '—'}</dd>
        </div>
        <div className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5 sm:col-span-2">
          <dt className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Packet</dt>
          <dd data-testid="workplane-comments-review-packet">
            {bundle.packetSummary ??
              (bundle.hasReviewMetadata ? 'Review metadata present' : 'No legacy packet metadata')}
          </dd>
        </div>
        {bundle.reviewNote ? (
          <div className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5 sm:col-span-2">
            <dt className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Note</dt>
            <dd data-testid="workplane-comments-review-note">{bundle.reviewNote}</dd>
          </div>
        ) : null}
      </dl>

      {bundle.degraded || bundle.warnings.length > 0 ? (
        <div
          className="mt-3 rounded border border-[var(--border-primary)] px-3 py-2 text-xs text-[var(--text-primary)]"
          role="status"
          data-testid="workplane-comments-review-degraded"
          data-review-ready="false"
        >
          <p className="font-medium">Comments/review stream degraded</p>
          <p className="mt-1 text-[var(--text-muted)]">
            Some comments or review fields are unavailable. This panel never marks review as ready.
          </p>
          {bundle.warnings.length > 0 ? (
            <ul className="mt-2 list-disc pl-4 text-[11px] text-[var(--text-muted)]">
              {bundle.warnings.map((warning) => (
                <li key={`${warning.code}:${warning.message}`} data-warning-code={warning.code}>
                  {warning.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <section className="mt-4" data-testid="workplane-review-checklist">
        <h3 className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
          Review checklist
        </h3>
        {bundle.checklist.length === 0 ? (
          <p
            className="mt-2 text-sm text-[var(--text-muted)]"
            data-testid="workplane-review-checklist-empty"
          >
            No review checklist items for this task.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2" data-testid="workplane-review-checklist-list">
            {bundle.checklist.map((item) => (
              <ChecklistRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4" data-testid="workplane-review-actions">
        <h3 className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
          Review actions (via reviewActions)
        </h3>
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          Action semantics match Mission Control. Writes stay on the task detail human-gate path.
        </p>
        <ul
          className="mt-2 flex flex-wrap gap-1.5"
          data-testid="workplane-review-action-list"
        >
          {bundle.availableActions.map((action) => (
            <li
              key={action.action}
              className="rounded border border-[var(--border-primary)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]"
              data-testid={`workplane-review-action-${action.action}`}
              data-review-action={action.action}
              data-review-decision={action.decision}
            >
              {action.label} → {action.decisionLabel}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-4" data-testid="workplane-comments-list-section">
        <h3 className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Comments</h3>
        {!bundle.commentsAvailable ? (
          <p
            className="mt-2 text-sm text-[var(--text-muted)]"
            role="status"
            data-testid="workplane-comments-unavailable"
          >
            Comments endpoint unavailable. New comments may fall back to activity entries.
          </p>
        ) : bundle.commentsEmpty ? (
          <p
            className="mt-2 text-sm text-[var(--text-muted)]"
            role="status"
            data-testid="workplane-comments-empty"
          >
            No comments yet.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2" data-testid="workplane-comments-list">
            {bundle.comments.map((comment) => (
              <CommentRow key={comment.id} comment={comment} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function CommentsReviewChecklistPanel({
  loadState,
  onRetry,
}: CommentsReviewChecklistPanelProps) {
  const { status, taskId, bundle, errorMessage } = loadState;

  return (
    <section
      className="mc-shell-card rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-3"
      aria-label="Comments and review checklist"
      data-testid="workplane-comments-review"
      data-comments-review-status={status}
      data-comments-review-task-id={taskId !== null ? String(taskId) : undefined}
      data-review-ready="false"
    >
      <header className="mb-2">
        <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
          Comments / review checklist
        </p>
      </header>

      {status === 'loading' ? (
        <div
          className="text-sm text-[var(--text-muted)]"
          role="status"
          aria-live="polite"
          data-testid="workplane-comments-review-loading"
        >
          Loading comments and review checklist…
        </div>
      ) : null}

      {status === 'empty' ? (
        <div
          className="text-sm text-[var(--text-muted)]"
          role="status"
          data-testid="workplane-comments-review-empty"
        >
          <p className="font-medium text-[var(--text-primary)]">No comments/review payload</p>
          <p className="mt-1">
            {taskId
              ? `Task ${taskId} was not found or has no comments/review payload.`
              : 'Open a Workplane with a valid task id to inspect comments and review.'}
          </p>
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="text-sm" role="alert" data-testid="workplane-comments-review-error">
          <p className="font-medium text-[var(--text-primary)]">
            Unable to load comments and review checklist
          </p>
          <p className="mt-1 text-[var(--text-muted)]">
            {errorMessage ?? 'Something went wrong while loading comments/review for this task.'}
          </p>
          {onRetry ? (
            <button
              type="button"
              className="mc-shell-btn mt-3 rounded border border-[var(--border-primary)] px-2 py-1 text-[var(--text-primary)]"
              data-testid="workplane-comments-review-retry"
              onClick={onRetry}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {status === 'ready' && bundle ? <ReadyBundle bundle={bundle} /> : null}
    </section>
  );
}
