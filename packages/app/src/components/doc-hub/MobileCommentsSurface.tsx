import { useEffect, useRef, useState } from 'react';
import { HttpRequestError } from '../../lib/http';
import {
  mobileCommentsPermissionMessage,
  settleMobileCommentSubmit,
  type MobileCommentComposerState,
} from '../../lib/mobileCommentsState';
import type { DocumentCommentThread } from '../../types/collaboration';

export type MobileCommentsStatus = 'unavailable' | 'loading' | 'loaded' | 'error';

interface MobileCommentsSurfaceProps {
  documentIdentity: string;
  documentPath: string;
  status: MobileCommentsStatus;
  loadMessage: string | null;
  threads: readonly DocumentCommentThread[];
  onBack: () => void;
  onRetry: () => void;
  onCreate: (text: string) => Promise<void>;
}

function formatCommentDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function MobileCommentsSurface({
  documentIdentity,
  documentPath,
  status,
  loadMessage,
  threads,
  onBack,
  onRetry,
  onCreate,
}: MobileCommentsSurfaceProps) {
  const [composer, setComposer] = useState<MobileCommentComposerState>({
    documentIdentity,
    draft: '',
    submitState: 'idle',
    submitMessage: null,
  });
  const submissionSequenceRef = useRef(0);
  const documentIdentityRef = useRef(documentIdentity);
  documentIdentityRef.current = documentIdentity;
  const activeSubmissionRef = useRef<{
    documentIdentity: string;
    sequence: number;
  } | null>(null);

  useEffect(() => {
    setComposer({
      documentIdentity,
      draft: '',
      submitState: 'idle',
      submitMessage: null,
    });
    activeSubmissionRef.current = null;
  }, [documentIdentity]);

  const submit = async () => {
    const text = composer.draft.trim();
    if (!text || activeSubmissionRef.current) return;
    const submission = {
      documentIdentity,
      sequence: ++submissionSequenceRef.current,
    };
    activeSubmissionRef.current = submission;
    setComposer((current) => current.documentIdentity === submission.documentIdentity
      ? { ...current, submitState: 'sending', submitMessage: null }
      : current);
    try {
      await onCreate(text);
      setComposer((current) => documentIdentityRef.current === submission.documentIdentity
        ? settleMobileCommentSubmit(current, {
            documentIdentity: submission.documentIdentity,
            outcome: 'success',
            message: 'Comment posted.',
          })
        : current);
    } catch (error) {
      const statusCode = error instanceof HttpRequestError ? error.status : undefined;
      setComposer((current) => documentIdentityRef.current === submission.documentIdentity
        ? settleMobileCommentSubmit(current, {
            documentIdentity: submission.documentIdentity,
            outcome: 'failure',
            message: statusCode
              ? mobileCommentsPermissionMessage(statusCode) ?? 'Comment could not be posted. Try again.'
              : 'Comment could not be posted. Try again.',
          })
        : current);
    } finally {
      if (
        activeSubmissionRef.current?.documentIdentity === submission.documentIdentity
        && activeSubmissionRef.current.sequence === submission.sequence
      ) {
        activeSubmissionRef.current = null;
      }
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header
        className="flex shrink-0 items-center gap-2 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-2"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to document tools"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-xl text-[var(--text-primary)]"
        >
          ‹
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold text-[var(--text-primary)]">Comments</h1>
          <div className="truncate text-xs text-[var(--text-muted)]">{documentPath}</div>
        </div>
        <span className="rounded-full border border-[var(--border-primary)] px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Read / write
        </span>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {status === 'unavailable' ? (
          <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
            Comments are unavailable for this document. Connect a Documents session with comment access.
          </div>
        ) : null}
        {status === 'loading' ? (
          <div className="flex items-center gap-2 py-8 text-sm text-[var(--text-muted)]" role="status">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" aria-hidden="true" />
            Loading comments…
          </div>
        ) : null}
        {status === 'error' ? (
          <div className="rounded-xl border border-red-400/30 bg-red-400/10 p-4">
            <p className="text-sm text-red-100">{loadMessage ?? 'Comments could not be loaded.'}</p>
            <button type="button" onClick={onRetry} className="mc-shell-btn mt-3 px-3 py-2 text-sm">
              Try again
            </button>
          </div>
        ) : null}
        {status === 'loaded' && threads.length === 0 ? (
          <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-5 text-center">
            <div className="text-sm font-medium text-[var(--text-primary)]">No comments yet</div>
            <div className="mt-1 text-xs text-[var(--text-muted)]">Start the conversation below.</div>
          </div>
        ) : null}
        {status === 'loaded' && threads.length > 0 ? (
          <div className="space-y-3" aria-label="Document comment threads">
            {threads.map((thread) => (
              <article
                key={thread.id}
                className={`rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3 ${
                  thread.resolved ? 'opacity-70' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-semibold text-[var(--text-primary)]">{thread.author}</span>
                  <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
                    {formatCommentDate(thread.createdAt)}
                  </span>
                </div>
                {thread.selectedText ? (
                  <blockquote className="mt-2 rounded-lg bg-[var(--bg-tertiary)] px-3 py-2 text-xs text-[var(--text-muted)]">
                    “{thread.selectedText}”
                  </blockquote>
                ) : null}
                <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--text-secondary)]">{thread.text}</p>
                {thread.replies.length > 0 ? (
                  <div className="mt-3 space-y-2 border-t border-[var(--border-primary)] pt-3">
                    {thread.replies.map((reply) => (
                      <div key={reply.id} className="rounded-lg bg-[var(--bg-primary)] px-3 py-2">
                        <div className="text-xs font-semibold text-[var(--text-primary)]">{reply.author}</div>
                        <div className="mt-1 text-sm text-[var(--text-secondary)]">{reply.text}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {thread.resolved ? (
                  <div className="mt-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                    Resolved
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
      </main>

      {status === 'loaded' ? (
        <form
          className="shrink-0 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="mobile-comment-draft" className="text-xs font-medium text-[var(--text-secondary)]">
            Add a comment
          </label>
          <textarea
            id="mobile-comment-draft"
            value={composer.draft}
            onChange={(event) => {
              const draft = event.target.value;
              setComposer((current) => ({
                ...current,
                draft,
                ...(current.submitState === 'sending'
                  ? {}
                  : { submitState: 'idle', submitMessage: null }),
              }));
            }}
            rows={3}
            placeholder="Write a comment…"
            className="mc-shell-input mt-2 w-full resize-none px-3 py-2 text-sm"
          />
          {composer.submitMessage ? (
            <div
              className={`mt-2 text-xs ${composer.submitState === 'failure' ? 'text-red-300' : 'text-[var(--accent)]'}`}
              role={composer.submitState === 'failure' ? 'alert' : 'status'}
            >
              {composer.submitMessage}
            </div>
          ) : null}
          <button
            type="submit"
            disabled={!composer.draft.trim() || composer.submitState === 'sending'}
            className="mc-shell-btn mc-shell-btn-active mt-3 min-h-[44px] w-full border-[var(--accent)] px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
          >
            {composer.submitState === 'sending'
              ? 'Sending…'
              : composer.submitState === 'failure'
                ? 'Try again'
                : 'Post comment'}
          </button>
        </form>
      ) : null}
    </div>
  );
}
