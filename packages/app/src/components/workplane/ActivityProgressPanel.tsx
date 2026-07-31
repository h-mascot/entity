/**
 * THE-871 / WP1-C-03 — Workplane activity/progress panel.
 *
 * Renders typed THE-869 spine events (plan/progress/log/proof/status/blocker)
 * from THE-870 task-scoped storage/API. Explicit empty state; fail-closed for
 * unavailable/degraded data; never claims review-ready.
 */

import {
  ACTIVITY_PROGRESS_SPINE_TYPES,
  ACTIVITY_PROGRESS_TYPE_LABELS,
  countActivityProgressTypes,
  formatActivityProgressEventSummary,
  type ActivityProgressBundle,
  type ActivityProgressEvent,
  type ActivityProgressSpineType,
  type WorkplaneActivityProgressLoadState,
} from '../../lib/workplaneActivityProgress.ts';

export interface ActivityProgressPanelProps {
  loadState: WorkplaneActivityProgressLoadState;
  /** Retry handler for error state (optional). */
  onRetry?: () => void;
}

function TypeBadge({ eventType }: { eventType: ActivityProgressSpineType }) {
  return (
    <span
      className="mc-shell-pill rounded border border-[var(--border-primary)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]"
      data-testid={`workplane-activity-type-badge-${eventType}`}
      data-activity-type={eventType}
    >
      {ACTIVITY_PROGRESS_TYPE_LABELS[eventType]}
    </span>
  );
}

function TypeCounts({ bundle }: { bundle: ActivityProgressBundle }) {
  const counts = countActivityProgressTypes(bundle);
  return (
    <div
      className="flex flex-wrap gap-1.5"
      data-testid="workplane-activity-type-counts"
      aria-label="Activity event type counts"
    >
      {ACTIVITY_PROGRESS_SPINE_TYPES.map((type) => (
        <span
          key={type}
          className="rounded border border-[var(--border-primary)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]"
          data-testid={`workplane-activity-type-count-${type}`}
          data-activity-type={type}
          data-count={String(counts[type])}
        >
          {ACTIVITY_PROGRESS_TYPE_LABELS[type]} · {counts[type]}
        </span>
      ))}
    </div>
  );
}

function EventRow({ event }: { event: ActivityProgressEvent }) {
  const summary = formatActivityProgressEventSummary(event);
  const actorLabel = event.actor.principalId
    ? `${event.actor.type}:${event.actor.principalId}`
    : event.actor.type;

  return (
    <li
      className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2"
      data-testid="workplane-activity-event"
      data-activity-type={event.eventType}
      data-activity-sequence={String(event.sequence)}
      data-activity-id={event.id !== null ? String(event.id) : undefined}
      data-activity-actor={event.actor.type}
      data-activity-proof-incomplete={event.proofIncomplete ? 'true' : 'false'}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <TypeBadge eventType={event.eventType} />
            <span
              className="text-[11px] text-[var(--text-muted)]"
              data-testid="workplane-activity-event-sequence"
            >
              #{event.sequence}
            </span>
          </div>
          <p
            className="mt-1 text-xs font-medium text-[var(--text-primary)]"
            data-testid="workplane-activity-event-summary"
          >
            {summary}
          </p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-muted)]">
            <span data-testid="workplane-activity-event-actor">{actorLabel}</span>
            {event.timestamp ? (
              <span data-testid="workplane-activity-event-timestamp">{event.timestamp}</span>
            ) : (
              <span data-testid="workplane-activity-event-timestamp-missing">No timestamp</span>
            )}
            {event.payloadRef ? (
              <span data-testid="workplane-activity-event-ref" className="truncate">
                {event.payloadRef}
              </span>
            ) : null}
          </div>
          {event.proofIncomplete ? (
            <p
              className="mt-1 text-[11px] text-[var(--text-muted)]"
              data-testid="workplane-activity-event-proof-incomplete"
            >
              Incomplete proof signal — not review-ready.
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function ReadyBundle({ bundle }: { bundle: ActivityProgressBundle }) {
  return (
    <div
      data-testid="workplane-activity-progress-ready"
      data-task-id={bundle.taskId !== null ? String(bundle.taskId) : undefined}
      data-activity-empty={bundle.empty ? 'true' : 'false'}
      data-activity-count={String(bundle.events.length)}
      data-activity-degraded={bundle.degraded ? 'true' : 'false'}
      data-activity-review-ready="false"
    >
      <TypeCounts bundle={bundle} />

      {bundle.degraded || bundle.warnings.length > 0 ? (
        <div
          className="mt-3 rounded border border-[var(--border-primary)] px-3 py-2 text-xs text-[var(--text-primary)]"
          role="status"
          data-testid="workplane-activity-progress-degraded"
          data-activity-review-ready="false"
        >
          <p className="font-medium">Activity stream degraded</p>
          <p className="mt-1 text-[var(--text-muted)]">
            Some events are unavailable or incomplete. This panel never marks review as ready.
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

      {bundle.empty ? (
        <div
          className="mt-3 text-sm text-[var(--text-muted)]"
          role="status"
          data-testid="workplane-activity-progress-empty-events"
        >
          <p className="font-medium text-[var(--text-primary)]">No activity events yet</p>
          <p className="mt-1">
            This task has no plan, progress, log, proof, status, or blocker events on the
            ActivityEvent spine.
          </p>
        </div>
      ) : (
        <ol
          className="mt-3 flex flex-col gap-2"
          data-testid="workplane-activity-event-list"
        >
          {bundle.events.map((event) => (
            <EventRow
              key={
                event.id !== null
                  ? `id-${event.id}`
                  : `${event.sequence}-${event.eventType}-${event.timestamp}`
              }
              event={event}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

export default function ActivityProgressPanel({
  loadState,
  onRetry,
}: ActivityProgressPanelProps) {
  const { status, taskId, bundle, errorMessage } = loadState;

  return (
    <section
      className="mc-shell-card rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-3"
      aria-label="Activity and progress"
      data-testid="workplane-activity-progress"
      data-activity-status={status}
      data-activity-task-id={taskId !== null ? String(taskId) : undefined}
      data-activity-review-ready="false"
    >
      <header className="mb-2">
        <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
          Activity / progress
        </p>
      </header>

      {status === 'loading' ? (
        <div
          className="text-sm text-[var(--text-muted)]"
          role="status"
          aria-live="polite"
          data-testid="workplane-activity-progress-loading"
        >
          Loading activity events…
        </div>
      ) : null}

      {status === 'empty' ? (
        <div
          className="text-sm text-[var(--text-muted)]"
          role="status"
          data-testid="workplane-activity-progress-empty"
        >
          <p className="font-medium text-[var(--text-primary)]">No activity stream available</p>
          <p className="mt-1">
            {taskId
              ? `Task ${taskId} was not found or has no activity-spine payload.`
              : 'Open a Workplane with a valid task id to inspect activity events.'}
          </p>
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="text-sm" role="alert" data-testid="workplane-activity-progress-error">
          <p className="font-medium text-[var(--text-primary)]">Unable to load activity events</p>
          <p className="mt-1 text-[var(--text-muted)]">
            {errorMessage ?? 'Something went wrong while loading activity for this task.'}
          </p>
          {onRetry ? (
            <button
              type="button"
              className="mc-shell-btn mt-3 rounded border border-[var(--border-primary)] px-2 py-1 text-[var(--text-primary)]"
              data-testid="workplane-activity-progress-retry"
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
