import { useMemo, useState } from 'react';
import type { DocumentReviewFinding, DocumentReviewRunRecord, DocumentReviewMode } from '../types/collaboration';

type FindingFilter = 'all' | 'errors' | 'warnings';

function preview(value: string, max = 160): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`;
}

function severityBadgeClass(severity: DocumentReviewFinding['severity']): string {
  switch (severity) {
    case 'error':
      return 'bg-red-500/15 text-red-200 ring-1 ring-red-500/25';
    case 'warning':
      return 'bg-yellow-500/15 text-yellow-100 ring-1 ring-yellow-500/25';
    default:
      return 'bg-blue-500/15 text-blue-100 ring-1 ring-blue-500/25';
  }
}

function statusLabel(status: DocumentReviewRunRecord['status']): string {
  switch (status) {
    case 'running':
      return 'Running…';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    default:
      return 'Pending';
  }
}

function statusToneClass(status: DocumentReviewRunRecord['status']): string {
  switch (status) {
    case 'running':
      return 'text-yellow-100';
    case 'completed':
      return 'text-green-200';
    case 'failed':
      return 'text-red-200';
    default:
      return 'text-[var(--text-muted)]';
  }
}

function toLineNumber(content: string, offset: number | null): number | null {
  if (typeof offset !== 'number' || offset < 0) return null;
  const clamped = Math.min(offset, content.length);
  return content.slice(0, clamped).split('\n').length;
}

export function ReviewPanel({
  mode,
  onChangeMode,
  onRunReview,
  run,
  findings,
  selectedFindingId,
  onSelectFinding,
  onApplyFix,
  onIgnoreFinding,
  content,
}: {
  mode: DocumentReviewMode;
  onChangeMode: (mode: DocumentReviewMode) => void;
  onRunReview: (mode: DocumentReviewMode) => void;
  run: DocumentReviewRunRecord | null;
  findings: readonly DocumentReviewFinding[];
  selectedFindingId: string | null;
  onSelectFinding: (findingId: string) => void;
  onApplyFix: (findingId: string) => void;
  onIgnoreFinding: (findingId: string) => void;
  content: string;
}) {
  const [filter, setFilter] = useState<FindingFilter>('all');
  const filtered = useMemo(() => {
    const list = findings.filter((finding) => finding.status !== 'ignored');
    if (filter === 'errors') return list.filter((f) => f.severity === 'error');
    if (filter === 'warnings') return list.filter((f) => f.severity === 'warning');
    return list;
  }, [filter, findings]);

  const activeFindingCount = useMemo(() => findings.filter((finding) => finding.status !== 'ignored').length, [findings]);

  return (
    <div className="border-b border-[var(--border-primary)]">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="truncate text-sm font-medium text-[var(--text-primary)]">Review</div>
          <span
            className="mc-shell-pill px-2 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]"
            aria-label={`${activeFindingCount} findings`}
            title={`${activeFindingCount} findings`}
          >
            {activeFindingCount}
          </span>
        </div>
      </div>

      <div className="px-3 pb-3">
        <div className="flex items-center gap-2">
          <select
            value={mode}
            onChange={(event) => onChangeMode(event.target.value as DocumentReviewMode)}
            className="mc-shell-input w-full px-3 py-2 text-sm"
            aria-label="Review mode"
          >
            <option value="grammar">Grammar</option>
            <option value="style">Style</option>
            <option value="technical">Technical</option>
            <option value="security">Security</option>
          </select>
          <button
            type="button"
            onClick={() => onRunReview(mode)}
            className="mc-shell-btn mc-shell-btn-active shrink-0 border-[var(--accent)] px-3 py-2 text-xs font-medium text-[var(--text-primary)]"
          >
            Run
          </button>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2 text-xs">
          <div className="text-[var(--text-muted)]">
            Status:{' '}
            <span className={`${run ? statusToneClass(run.status) : 'text-[var(--text-muted)]'}`}>
              {run ? statusLabel(run.status) : 'No runs yet'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {(['all', 'errors', 'warnings'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`mc-shell-btn px-2 py-1 text-[11px] ${filter === key ? 'mc-shell-btn-active text-[var(--text-primary)]' : ''}`}
              >
                {key === 'all' ? 'All' : key === 'errors' ? 'Errors' : 'Warnings'}
              </button>
            ))}
          </div>
        </div>

        {filtered.length > 0 && (
          <div className="mt-3 flex flex-col gap-3">
            {filtered.map((finding) => {
              const selected = selectedFindingId === finding.id;
              const line = finding.range ? toLineNumber(content, finding.range.from) : null;
              const canApply = Boolean(finding.suggestedFix?.replacement) && finding.status !== 'applied';

              return (
                <div
                  key={finding.id}
                  className={`rounded-xl border bg-[var(--bg-secondary)] p-3 transition-colors ${
                    selected ? 'border-[var(--accent)]' : 'border-[var(--border-primary)]'
                  } ${finding.status === 'applied' ? 'opacity-70' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectFinding(finding.id)}
                    className="block w-full text-left"
                    aria-label="Open finding"
                    title="Jump to finding"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ${severityBadgeClass(finding.severity)}`}>
                        {finding.severity.toUpperCase()}
                      </span>
                      {line ? (
                        <span className="text-[11px] text-[var(--text-muted)]">Line {line}</span>
                      ) : (
                        <span className="text-[11px] text-[var(--text-muted)]">No range</span>
                      )}
                    </div>
                    <div className="mt-2 text-sm text-[var(--text-secondary)]">{preview(finding.message)}</div>
                  </button>
                  <div className="mt-3 flex items-center justify-end gap-2 border-t border-[var(--border-primary)] pt-3">
                    <button type="button" onClick={() => onIgnoreFinding(finding.id)} className="mc-shell-btn px-3 py-1 text-xs">
                      Ignore
                    </button>
                    <button
                      type="button"
                      onClick={() => onApplyFix(finding.id)}
                      disabled={!canApply}
                      className={`mc-shell-btn mc-shell-btn-active border-[var(--accent)] px-3 py-1 text-xs font-medium text-[var(--text-primary)] ${
                        canApply ? '' : 'cursor-not-allowed opacity-40'
                      }`}
                    >
                      Apply Fix
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
