import { useMemo, useState } from 'react';
import type { DocumentSuggestionUiRecord } from '../types/collaboration';

function normalizeActorId(value: string): string {
  return value.trim().toLowerCase();
}

function actorPillClass(actorId: string): string {
  switch (normalizeActorId(actorId)) {
    case 'ada':
      return 'bg-purple-500/15 text-purple-200 ring-1 ring-purple-500/25';
    case 'spock':
      return 'bg-blue-500/15 text-blue-200 ring-1 ring-blue-500/25';
    case 'scotty':
      return 'bg-green-500/15 text-green-200 ring-1 ring-green-500/25';
    case 'human':
      return 'bg-gray-400/10 text-gray-200 ring-1 ring-gray-500/20';
    default:
      return 'bg-gray-500/10 text-gray-200 ring-1 ring-gray-500/20';
  }
}

function preview(value: string, max = 80): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`;
}

function statusLabel(status: DocumentSuggestionUiRecord['status']): string {
  if (status === 'accepted') return 'Accepted';
  if (status === 'rejected') return 'Rejected';
  return 'Pending';
}

function statusToneClass(status: DocumentSuggestionUiRecord['status']): string {
  if (status === 'accepted') return 'text-green-200';
  if (status === 'rejected') return 'text-red-200';
  return 'text-yellow-100';
}

export interface EditorSelectionSnapshot {
  from: number;
  to: number;
  text: string;
}

export function SuggestionPanel({
  suggestions,
  selectedSuggestionId,
  onSelectSuggestion,
  onAccept,
  onReject,
  selection,
  onCreateSuggestion,
}: {
  suggestions: readonly DocumentSuggestionUiRecord[];
  selectedSuggestionId: string | null;
  onSelectSuggestion: (suggestionId: string) => void;
  onAccept: (suggestionId: string) => void;
  onReject: (suggestionId: string) => void;
  selection: EditorSelectionSnapshot | null;
  onCreateSuggestion: (input: { from: number; to: number; originalText: string; suggestedText: string; reason?: string | null }) => void;
}) {
  const pendingCount = useMemo(() => suggestions.filter((s) => s.status === 'pending').length, [suggestions]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [suggestedText, setSuggestedText] = useState('');
  const [reason, setReason] = useState('');

  const canCompose = Boolean(selection) && selection!.to > selection!.from;
  const badgeCount = pendingCount > 0 ? pendingCount : suggestions.length;
  const badgeTitle = pendingCount > 0 ? `${pendingCount} pending · ${suggestions.length} total` : `${suggestions.length} total`;

  return (
    <div className="border-b border-[var(--border-primary)]">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="truncate text-sm font-medium text-[var(--text-primary)]">Suggestions</div>
          <span
            className="mc-shell-pill px-2 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]"
            aria-label={badgeTitle}
            title={badgeTitle}
          >
            {badgeCount}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setComposerOpen((prev) => !prev)}
          className={`mc-shell-btn px-2.5 py-1 text-xs ${composerOpen ? 'mc-shell-btn-active text-[var(--text-primary)]' : ''}`}
          aria-label="Create suggestion from selection"
          title="Create suggestion from selection"
        >
          +
        </button>
      </div>

      <div className="px-3 pb-3">
        {composerOpen && (
          <div className="mb-4 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-[var(--text-primary)]">New Suggestion</div>
              <span className="text-[11px] text-[var(--text-muted)]">From selection</span>
            </div>
            <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-2 py-1 text-xs text-[var(--text-muted)]">
              {canCompose ? `“${preview(selection!.text, 120)}”` : 'Select text in the editor to suggest a change.'}
            </div>
            <textarea
              value={suggestedText}
              onChange={(event) => setSuggestedText(event.target.value)}
              placeholder="Suggested replacement…"
              className="mc-shell-input mt-2 h-20 w-full resize-none px-3 py-2 text-sm"
              disabled={!canCompose}
            />
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Reason (optional)"
              className="mc-shell-input mt-2 w-full px-3 py-2 text-sm"
              disabled={!canCompose}
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setComposerOpen(false);
                  setSuggestedText('');
                  setReason('');
                }}
                className="mc-shell-btn px-3 py-1.5 text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!selection || selection.to <= selection.from) return;
                  const value = suggestedText.trim();
                  if (!value) return;
                  onCreateSuggestion({
                    from: selection.from,
                    to: selection.to,
                    originalText: selection.text,
                    suggestedText: value,
                    reason: reason.trim() ? reason.trim() : null,
                  });
                  setComposerOpen(false);
                  setSuggestedText('');
                  setReason('');
                }}
                disabled={!canCompose || !suggestedText.trim()}
                className={`mc-shell-btn mc-shell-btn-active border-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] ${
                  canCompose && suggestedText.trim() ? '' : 'cursor-not-allowed opacity-40'
                }`}
              >
                Create
              </button>
            </div>
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="flex flex-col gap-3">
            {suggestions.map((suggestion) => {
              const selected = selectedSuggestionId === suggestion.id;
              return (
                <div
                  key={suggestion.id}
                  className={`rounded-xl border bg-[var(--bg-secondary)] p-3 transition-colors ${
                    selected ? 'border-[var(--accent)]' : 'border-[var(--border-primary)]'
                  } ${suggestion.status !== 'pending' ? 'opacity-70' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectSuggestion(suggestion.id)}
                    className="block w-full text-left"
                    aria-label="Open suggestion"
                    title="Jump to suggestion"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ${actorPillClass(suggestion.author)}`}>
                        {suggestion.author}
                      </span>
                      <span className={`text-[11px] ${statusToneClass(suggestion.status)}`}>{statusLabel(suggestion.status)}</span>
                    </div>
                    <div className="mt-2 text-sm text-[var(--text-secondary)]">
                      <span className="rounded bg-red-500/10 px-1 py-0.5 text-red-200">
                        {preview(suggestion.originalText || '(empty)')}
                      </span>{' '}
                      <span className="text-[var(--text-muted)]">→</span>{' '}
                      <span className="rounded bg-green-500/10 px-1 py-0.5 text-green-200">
                        {preview(suggestion.suggestedText || '(empty)')}
                      </span>
                    </div>
                    {suggestion.reason ? (
                      <div className="mt-1 text-xs text-[var(--text-muted)]">Reason: {preview(suggestion.reason, 120)}</div>
                    ) : null}
                  </button>
                  <div className="mt-3 flex items-center justify-end gap-2 border-t border-[var(--border-primary)] pt-3">
                    <button
                      type="button"
                      onClick={() => onReject(suggestion.id)}
                      disabled={suggestion.status !== 'pending'}
                      className={`mc-shell-btn px-3 py-1 text-xs ${suggestion.status !== 'pending' ? 'cursor-not-allowed opacity-40' : ''}`}
                      aria-label="Reject suggestion"
                    >
                      ✕ Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => onAccept(suggestion.id)}
                      disabled={suggestion.status !== 'pending'}
                      className={`mc-shell-btn mc-shell-btn-active border-[var(--accent)] px-3 py-1 text-xs font-medium text-[var(--text-primary)] ${
                        suggestion.status !== 'pending' ? 'cursor-not-allowed opacity-40' : ''
                      }`}
                      aria-label="Accept suggestion"
                    >
                      ✓ Accept
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
