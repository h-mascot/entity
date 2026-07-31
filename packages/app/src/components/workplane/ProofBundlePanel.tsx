/**
 * THE-864 / WP1-B-03 — Workplane proof bundle panel.
 * THE-897 / EEPC-B-02 — Renders execution-job proof items merged from activity.
 *
 * Renders normalized ProofBundle items with raw / curated / external / unknown
 * kinds. Fail-closed for empty, loading, error, and malformed-missing proof.
 */

import type { ProofBundle, ProofBundleItem, ProofBundleItemKind } from '../../lib/proofBundle.ts';
import {
  PROOF_BUNDLE_KIND_LABELS,
  PROOF_BUNDLE_KIND_ORDER,
  countProofBundleKinds,
  isProofBundleItemSelected,
  toProofBundleSelectionToken,
  type WorkplaneProofBundleLoadState,
} from '../../lib/workplaneProofBundle.ts';

export interface ProofBundlePanelProps {
  loadState: WorkplaneProofBundleLoadState;
  /** Currently selected proof token from Workplane URL state. */
  selectedProof?: string | null;
  /** Called when an operator selects a proof item (URL-safe token). */
  onSelectProof?: (proofToken: string | null) => void;
  /** Retry handler for error state (optional). */
  onRetry?: () => void;
}

function KindBadge({ kind }: { kind: ProofBundleItemKind }) {
  return (
    <span
      className="mc-shell-pill rounded border border-[var(--border-primary)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]"
      data-testid={`workplane-proof-kind-badge-${kind}`}
      data-proof-kind={kind}
    >
      {PROOF_BUNDLE_KIND_LABELS[kind]}
    </span>
  );
}

function KindCounts({ bundle }: { bundle: ProofBundle }) {
  const counts = countProofBundleKinds(bundle);
  return (
    <div
      className="flex flex-wrap gap-1.5"
      data-testid="workplane-proof-kind-counts"
      aria-label="Proof kind counts"
    >
      {PROOF_BUNDLE_KIND_ORDER.map((kind) => (
        <span
          key={kind}
          className="rounded border border-[var(--border-primary)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]"
          data-testid={`workplane-proof-kind-count-${kind}`}
          data-proof-kind={kind}
          data-count={String(counts[kind])}
        >
          {PROOF_BUNDLE_KIND_LABELS[kind]} · {counts[kind]}
        </span>
      ))}
    </div>
  );
}

function ProofItemRow({
  item,
  selected,
  onSelect,
}: {
  item: ProofBundleItem;
  selected: boolean;
  onSelect?: (token: string | null) => void;
}) {
  const token = toProofBundleSelectionToken(item);
  const href = item.href;
  const secondary = item.meta ?? item.artifactKind ?? item.source;

  return (
    <li
      className={`rounded border px-3 py-2 ${
        selected
          ? 'border-[var(--text-primary)] bg-[var(--bg-primary)]'
          : 'border-[var(--border-primary)] bg-[var(--bg-primary)]'
      }`}
      data-testid="workplane-proof-item"
      data-proof-id={item.id}
      data-proof-kind={item.kind}
      data-proof-source={item.source}
      data-proof-selected={selected ? 'true' : 'false'}
      data-proof-external={item.external ? 'true' : 'false'}
      data-proof-job-linked={item.source === 'execution_job_proof' ? 'true' : 'false'}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <KindBadge kind={item.kind} />
            {item.source === 'execution_job_proof' ? (
              <span
                className="rounded border border-[var(--border-primary)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]"
                data-testid="workplane-proof-job-badge"
              >
                Job proof
              </span>
            ) : null}
            <span
              className="truncate text-xs font-medium text-[var(--text-primary)]"
              data-testid="workplane-proof-item-title"
            >
              {item.title}
            </span>
          </div>
          {href ? (
            <a
              className="mt-1 block truncate text-[11px] text-[var(--text-secondary)] underline-offset-2 hover:underline"
              href={href}
              target={item.external ? '_blank' : undefined}
              rel={item.external ? 'noreferrer noopener' : undefined}
              data-testid="workplane-proof-item-href"
            >
              {href}
            </a>
          ) : (
            <p
              className="mt-1 text-[11px] text-[var(--text-muted)]"
              data-testid="workplane-proof-item-href-missing"
            >
              No openable link
            </p>
          )}
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-muted)]">
            {secondary ? <span data-testid="workplane-proof-item-meta">{secondary}</span> : null}
            {item.status ? <span data-testid="workplane-proof-item-status">{item.status}</span> : null}
          </div>
        </div>
        {onSelect && token ? (
          <button
            type="button"
            className="mc-shell-btn shrink-0 rounded border border-[var(--border-primary)] px-2 py-0.5 text-[11px] text-[var(--text-primary)]"
            data-testid="workplane-proof-item-select"
            aria-pressed={selected}
            onClick={() => onSelect(selected ? null : token)}
          >
            {selected ? 'Clear' : 'Select'}
          </button>
        ) : null}
      </div>
    </li>
  );
}

function ReadyBundle({
  bundle,
  selectedProof,
  onSelectProof,
}: {
  bundle: ProofBundle;
  selectedProof?: string | null;
  onSelectProof?: (proofToken: string | null) => void;
}) {
  return (
    <div
      data-testid="workplane-proof-bundle-ready"
      data-task-id={bundle.taskId !== null ? String(bundle.taskId) : undefined}
      data-proof-empty={bundle.empty ? 'true' : 'false'}
      data-proof-count={String(bundle.items.length)}
      data-missing-evidence={bundle.missingEvidence ? 'true' : 'false'}
    >
      <KindCounts bundle={bundle} />

      {bundle.evidenceSummary ? (
        <p
          className="mt-3 text-xs text-[var(--text-secondary)]"
          data-testid="workplane-proof-bundle-summary"
        >
          {bundle.evidenceSummary}
        </p>
      ) : null}

      {bundle.missingEvidence ? (
        <div
          className="mt-3 rounded border border-[var(--border-primary)] px-3 py-2 text-xs text-[var(--text-primary)]"
          role="status"
          data-testid="workplane-proof-bundle-missing"
        >
          {bundle.missingEvidenceReason ?? 'Proof/evidence appears missing for this task.'}
        </div>
      ) : null}

      {bundle.empty ? (
        <div
          className="mt-3 text-sm text-[var(--text-muted)]"
          role="status"
          data-testid="workplane-proof-bundle-empty-items"
        >
          <p className="font-medium text-[var(--text-primary)]">No proof items</p>
          <p className="mt-1">
            This task has no normalized raw, curated, external, or unknown proof links yet.
          </p>
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-2" data-testid="workplane-proof-item-list">
          {bundle.items.map((item) => (
            <ProofItemRow
              key={item.id}
              item={item}
              selected={isProofBundleItemSelected(item, selectedProof)}
              onSelect={onSelectProof}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ProofBundlePanel({
  loadState,
  selectedProof = null,
  onSelectProof,
  onRetry,
}: ProofBundlePanelProps) {
  const { status, taskId, bundle, errorMessage } = loadState;

  return (
    <section
      className="mc-shell-card rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-3"
      aria-label="Proof bundle"
      data-testid="workplane-proof-bundle"
      data-proof-status={status}
      data-proof-task-id={taskId !== null ? String(taskId) : undefined}
    >
      <header className="mb-2">
        <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Proof bundle</p>
      </header>

      {status === 'loading' ? (
        <div
          className="text-sm text-[var(--text-muted)]"
          role="status"
          aria-live="polite"
          data-testid="workplane-proof-bundle-loading"
        >
          Loading proof bundle…
        </div>
      ) : null}

      {status === 'empty' ? (
        <div
          className="text-sm text-[var(--text-muted)]"
          role="status"
          data-testid="workplane-proof-bundle-empty"
        >
          <p className="font-medium text-[var(--text-primary)]">No proof available</p>
          <p className="mt-1">
            {taskId
              ? `Task ${taskId} was not found or has no proof payload.`
              : 'Open a Workplane with a valid task id to inspect proof items.'}
          </p>
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="text-sm" role="alert" data-testid="workplane-proof-bundle-error">
          <p className="font-medium text-[var(--text-primary)]">Unable to load proof bundle</p>
          <p className="mt-1 text-[var(--text-muted)]">
            {errorMessage ?? 'Something went wrong while loading proof for this task.'}
          </p>
          {onRetry ? (
            <button
              type="button"
              className="mc-shell-btn mt-3 rounded border border-[var(--border-primary)] px-2 py-1 text-[var(--text-primary)]"
              data-testid="workplane-proof-bundle-retry"
              onClick={onRetry}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {status === 'ready' && bundle ? (
        <ReadyBundle
          bundle={bundle}
          selectedProof={selectedProof}
          onSelectProof={onSelectProof}
        />
      ) : null}
    </section>
  );
}
