/**
 * THE-865 / WP1-B-04 — Workplane files/docs panel linked to Doc Hub openers.
 *
 * Renders task-linked documents/files with Doc Hub / docs-route / external
 * open actions. Fail-closed for empty, loading, error, and restricted rows.
 */

import {
  FILES_DOCS_KIND_LABELS,
  FILES_DOCS_KIND_ORDER,
  countFilesDocsKinds,
  type WorkplaneFilesDocsBundle,
  type WorkplaneFilesDocsItem,
  type WorkplaneFilesDocsItemKind,
  type WorkplaneFilesDocsLoadState,
} from '../../lib/workplaneFilesDocs.ts';

export interface FilesDocsPanelProps {
  loadState: WorkplaneFilesDocsLoadState;
  /** Retry handler for error state (optional). */
  onRetry?: () => void;
}

function KindBadge({ kind }: { kind: WorkplaneFilesDocsItemKind }) {
  return (
    <span
      className="mc-shell-pill rounded border border-[var(--border-primary)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]"
      data-testid={`workplane-files-docs-kind-badge-${kind}`}
      data-files-docs-kind={kind}
    >
      {FILES_DOCS_KIND_LABELS[kind]}
    </span>
  );
}

function KindCounts({ bundle }: { bundle: WorkplaneFilesDocsBundle }) {
  const counts = countFilesDocsKinds(bundle);
  return (
    <div
      className="flex flex-wrap gap-1.5"
      data-testid="workplane-files-docs-kind-counts"
      aria-label="Files and docs kind counts"
    >
      {FILES_DOCS_KIND_ORDER.map((kind) => (
        <span
          key={kind}
          className="rounded border border-[var(--border-primary)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]"
          data-testid={`workplane-files-docs-kind-count-${kind}`}
          data-files-docs-kind={kind}
          data-count={String(counts[kind])}
        >
          {FILES_DOCS_KIND_LABELS[kind]} · {counts[kind]}
        </span>
      ))}
    </div>
  );
}

function OpenerLink({ item }: { item: WorkplaneFilesDocsItem }) {
  const { opener } = item;
  if (opener.kind === 'unavailable' || !opener.href) {
    return (
      <p
        className="mt-1 text-[11px] text-[var(--text-muted)]"
        data-testid="workplane-files-docs-opener-unavailable"
        data-opener-kind="unavailable"
      >
        {opener.reason ?? 'No openable document link'}
      </p>
    );
  }

  const external = opener.kind === 'external';
  const label =
    opener.kind === 'doc_hub'
      ? `Open in Doc Hub (${opener.sourceId}/${opener.path})`
      : opener.kind === 'docs_route'
        ? 'Open document route'
        : 'Open external document';

  return (
    <a
      className="mt-1 block truncate text-[11px] text-[var(--text-secondary)] underline-offset-2 hover:underline"
      href={opener.href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noreferrer noopener' : undefined}
      data-testid="workplane-files-docs-opener"
      data-opener-kind={opener.kind}
      data-opener-href={opener.href}
      data-opener-source-id={opener.sourceId ?? undefined}
      data-opener-path={opener.path ?? undefined}
      aria-label={label}
    >
      {opener.href}
    </a>
  );
}

function FilesDocsItemRow({ item }: { item: WorkplaneFilesDocsItem }) {
  return (
    <li
      className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2"
      data-testid="workplane-files-docs-item"
      data-files-docs-id={item.id}
      data-files-docs-kind={item.kind}
      data-files-docs-source={item.source}
      data-files-docs-restricted={item.restricted ? 'true' : 'false'}
      data-opener-kind={item.opener.kind}
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <KindBadge kind={item.kind} />
            <span
              className="truncate text-xs font-medium text-[var(--text-primary)]"
              data-testid="workplane-files-docs-item-title"
            >
              {item.title}
            </span>
          </div>
          <OpenerLink item={item} />
          {item.degradedMessages.length > 0 ? (
            <ul
              className="mt-1 list-disc pl-4 text-[11px] text-[var(--text-muted)]"
              data-testid="workplane-files-docs-item-degraded"
            >
              {item.degradedMessages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function ReadyBundle({ bundle }: { bundle: WorkplaneFilesDocsBundle }) {
  return (
    <div
      data-testid="workplane-files-docs-ready"
      data-task-id={bundle.taskId !== null ? String(bundle.taskId) : undefined}
      data-files-docs-empty={bundle.empty ? 'true' : 'false'}
      data-files-docs-count={String(bundle.items.length)}
    >
      <KindCounts bundle={bundle} />

      {bundle.empty ? (
        <div
          className="mt-3 text-sm text-[var(--text-muted)]"
          role="status"
          data-testid="workplane-files-docs-empty-items"
        >
          <p className="font-medium text-[var(--text-primary)]">No linked files or docs</p>
          <p className="mt-1">
            This task has no linked documents, files, or Doc Hub openers yet.
          </p>
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-2" data-testid="workplane-files-docs-item-list">
          {bundle.items.map((item) => (
            <FilesDocsItemRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default function FilesDocsPanel({ loadState, onRetry }: FilesDocsPanelProps) {
  const { status, taskId, bundle, errorMessage } = loadState;

  return (
    <section
      className="mc-shell-card rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-3"
      aria-label="Files and docs"
      data-testid="workplane-files-docs"
      data-files-docs-status={status}
      data-files-docs-task-id={taskId !== null ? String(taskId) : undefined}
    >
      <header className="mb-2">
        <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Files / docs</p>
      </header>

      {status === 'loading' ? (
        <div
          className="text-sm text-[var(--text-muted)]"
          role="status"
          aria-live="polite"
          data-testid="workplane-files-docs-loading"
        >
          Loading files and docs…
        </div>
      ) : null}

      {status === 'empty' ? (
        <div
          className="text-sm text-[var(--text-muted)]"
          role="status"
          data-testid="workplane-files-docs-empty"
        >
          <p className="font-medium text-[var(--text-primary)]">No files or docs available</p>
          <p className="mt-1">
            {taskId
              ? `Task ${taskId} was not found or has no files/docs payload.`
              : 'Open a Workplane with a valid task id to inspect linked files and docs.'}
          </p>
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="text-sm" role="alert" data-testid="workplane-files-docs-error">
          <p className="font-medium text-[var(--text-primary)]">Unable to load files and docs</p>
          <p className="mt-1 text-[var(--text-muted)]">
            {errorMessage ?? 'Something went wrong while loading files and docs for this task.'}
          </p>
          {onRetry ? (
            <button
              type="button"
              className="mc-shell-btn mt-3 rounded border border-[var(--border-primary)] px-2 py-1 text-[var(--text-primary)]"
              data-testid="workplane-files-docs-retry"
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
