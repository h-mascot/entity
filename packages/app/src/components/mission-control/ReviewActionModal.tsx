import { useEffect, useState } from 'react';
import type { TaskBoardTask } from '../../hooks/useTaskBoard';

import type { ReviewAction } from './reviewActions';

const DEFAULT_REVIEW_NOTE = 'Reviewed and verified this task meets its done criteria.';
const MIN_REVIEW_NOTE_LENGTH = 20;

interface ReviewActionModalProps {
  open: boolean;
  task: TaskBoardTask | null;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (action: ReviewAction, note: string) => void;
}

export default function ReviewActionModal({
  open,
  task,
  busy = false,
  error = null,
  onClose,
  onSubmit,
}: ReviewActionModalProps) {
  const [visible, setVisible] = useState(false);
  const [note, setNote] = useState(DEFAULT_REVIEW_NOTE);

  useEffect(() => {
    if (!open) {
      setVisible(false);
      return;
    }

    const animationId = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(animationId);
  }, [open]);

  useEffect(() => {
    setNote(DEFAULT_REVIEW_NOTE);
  }, [task?.id]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open || !task) {
    return null;
  }

  const acceptDoneDisabled = busy || note.trim().length < MIN_REVIEW_NOTE_LENGTH;

  return (
    <div className="fixed inset-0 z-[88]">
      <button
        type="button"
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
        aria-label="Close review modal"
      />
      <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-6">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="mc-review-action-title"
          className={`relative w-full max-w-xl rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] shadow-[0_24px_80px_rgba(0,0,0,0.45)] transition-[transform,opacity] duration-200 ${
            visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
          }`}
        >
          <div className="border-b border-[var(--border-primary)] px-5 py-4 sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 id="mc-review-action-title" className="text-xl font-semibold text-[var(--text-primary)]">
                  Review · Task #{task.id}
                </h2>
                <p className="mt-1 truncate text-sm text-[var(--text-muted)]">{task.name}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="mc-shell-btn inline-flex h-9 w-9 items-center justify-center px-0 py-0 text-base text-[var(--text-primary)]"
                aria-label="Close review modal"
              >
                ×
              </button>
            </div>
          </div>

          <div className="max-h-[70vh] overflow-y-auto px-5 py-5 sm:px-6">
            {error ? (
              <div className="mb-4 rounded-xl border border-[var(--error)]/40 bg-[var(--surface-error)] px-4 py-3 text-sm text-[var(--error)]">
                {error}
              </div>
            ) : null}

            <div className="grid gap-4">
              <div>
                <label
                  htmlFor="mc-review-note"
                  className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]"
                >
                  Review note
                </label>
                <textarea
                  id="mc-review-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={4}
                  className="mc-shell-input min-h-[120px] w-full resize-y px-3 py-3 text-sm leading-6"
                />
                {acceptDoneDisabled && !busy ? (
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Add a review note of at least 20 characters
                  </p>
                ) : null}
              </div>

              <p className="text-xs text-[var(--text-muted)]">
                Done is gated by review — accept with a substantive note to complete.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[var(--border-primary)] px-5 py-4 sm:px-6">
            <button type="button" onClick={onClose} className="mc-shell-btn px-4 py-2 text-sm">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSubmit('reject', note)}
              disabled={busy}
              className="mc-shell-btn px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => onSubmit('needs_fix', note)}
              disabled={busy}
              className="mc-shell-btn px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              Needs fix
            </button>
            <button
              type="button"
              onClick={() => onSubmit('accept', note)}
              disabled={busy}
              className="mc-shell-btn px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              Accept review
            </button>
            <button
              type="button"
              onClick={() => onSubmit('accept_done', note)}
              disabled={acceptDoneDisabled}
              className="mc-shell-btn mc-shell-btn-active px-4 py-2 text-sm font-medium text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Working...' : 'Accept + Done'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
