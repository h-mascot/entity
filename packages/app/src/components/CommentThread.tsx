import { useMemo, useState } from 'react';
import type { DocumentCommentThread } from '../types/collaboration';

function normalizeActorId(value: string): string {
  return value.trim().toLowerCase();
}

function actorBadgeClass(actorId: string): string {
  switch (normalizeActorId(actorId)) {
    case 'ada':
      return 'bg-purple-500/20 text-purple-200 ring-1 ring-purple-500/30';
    case 'spock':
      return 'bg-blue-500/20 text-blue-200 ring-1 ring-blue-500/30';
    case 'scotty':
      return 'bg-green-500/20 text-green-200 ring-1 ring-green-500/30';
    case 'human':
      return 'bg-gray-400/15 text-gray-200 ring-1 ring-gray-500/25';
    default:
      return 'bg-gray-500/15 text-gray-200 ring-1 ring-gray-500/25';
  }
}

function actorInitial(actorId: string): string {
  const normalized = normalizeActorId(actorId);
  if (normalized === 'ada') return 'A';
  if (normalized === 'spock') return 'S';
  if (normalized === 'scotty') return 'C';
  if (normalized === 'human') return 'H';
  return normalized.slice(0, 1).toUpperCase();
}

function formatRelativeTime(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function preview(value: string, max = 160): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`;
}

export function CommentThreadPanel({
  threads,
  onNewFromSelection,
  onSelectThread,
  onReply,
  onResolve,
  selectedThreadId,
}: {
  threads: readonly DocumentCommentThread[];
  onNewFromSelection: () => void;
  onSelectThread: (threadId: string) => void;
  onReply: (threadId: string, text: string) => void;
  onResolve: (threadId: string, resolved: boolean) => void;
  selectedThreadId: string | null;
}) {
  const openCount = useMemo(() => threads.filter((thread) => !thread.resolved).length, [threads]);
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  const badgeCount = openCount > 0 ? openCount : threads.length;
  const badgeTitle = openCount > 0 ? `${openCount} open · ${threads.length} total` : `${threads.length} resolved`;

  return (
    <div className="border-b border-[var(--border-primary)]">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="truncate text-sm font-medium text-[var(--text-primary)]">Comments</div>
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
          onClick={onNewFromSelection}
          className="mc-shell-btn mc-shell-btn-active border-[var(--accent)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)]"
          aria-label="Add comment"
          title="Add comment"
        >
          +
        </button>
      </div>

      {threads.length > 0 && (
        <div className="px-3 pb-3">
          <div className="flex flex-col gap-3">
            {threads.map((thread) => {
              const selected = selectedThreadId === thread.id;
              const resolved = thread.resolved;
              return (
                <div
                  key={thread.id}
                  id={`comment-thread-${thread.id}`}
                  className={`rounded-xl border bg-[var(--bg-secondary)] p-3 transition-colors ${
                    selected ? 'border-[var(--accent)]' : 'border-[var(--border-primary)]'
                  } ${resolved ? 'opacity-70' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectThread(thread.id)}
                    className="block w-full text-left"
                    aria-label="Open comment thread"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <div
                          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${actorBadgeClass(
                            thread.author
                          )}`}
                          aria-hidden="true"
                        >
                          <span className="text-xs font-semibold">{actorInitial(thread.author)}</span>
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-[var(--text-primary)]">
                            {thread.author}
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)]">{formatRelativeTime(thread.createdAt)}</div>
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                        <input
                          type="checkbox"
                          checked={resolved}
                          onChange={(event) => onResolve(thread.id, event.target.checked)}
                          className="h-4 w-4 accent-[var(--accent)]"
                          aria-label={resolved ? 'Resolved' : 'Open'}
                        />
                        <span>Resolved</span>
                      </label>
                    </div>
                    {thread.selectedText ? (
                      <div className="mt-2 rounded-md border border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-2 py-1 text-xs text-[var(--text-muted)]">
                        “{preview(thread.selectedText, 120)}”
                      </div>
                    ) : null}
                    <div className="mt-2 text-sm text-[var(--text-secondary)]">{preview(thread.text)}</div>
                  </button>

                  {thread.replies.length > 0 && (
                    <div className="mt-3 space-y-2 border-t border-[var(--border-primary)] pt-3">
                      {thread.replies.map((reply) => (
                        <div key={reply.id} className="flex items-start gap-2">
                          <div
                            className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${actorBadgeClass(
                              reply.author
                            )}`}
                            aria-hidden="true"
                          >
                            <span className="text-[11px] font-semibold">{actorInitial(reply.author)}</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="truncate text-xs font-medium text-[var(--text-primary)]">{reply.author}</div>
                              <div className="text-[11px] text-[var(--text-muted)]">{formatRelativeTime(reply.createdAt)}</div>
                            </div>
                            <div className="mt-0.5 text-sm text-[var(--text-secondary)]">{reply.text}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--border-primary)] pt-3">
                    {replyFor === thread.id ? (
                      <div className="flex w-full flex-col gap-2">
                        <textarea
                          value={replyText}
                          onChange={(event) => setReplyText(event.target.value)}
                          placeholder="Write a reply…"
                          className="mc-shell-input h-20 w-full resize-none px-3 py-2 text-sm"
                        />
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setReplyFor(null);
                              setReplyText('');
                            }}
                            className="mc-shell-btn px-2.5 py-1 text-xs"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const value = replyText.trim();
                              if (!value) return;
                              onReply(thread.id, value);
                              setReplyFor(null);
                              setReplyText('');
                            }}
                            disabled={!replyText.trim()}
                            className={`mc-shell-btn mc-shell-btn-active border-[var(--accent)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] ${
                              replyText.trim() ? '' : 'cursor-not-allowed opacity-40'
                            }`}
                          >
                            Reply
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setReplyFor(thread.id);
                          setReplyText('');
                        }}
                        className="mc-shell-btn px-3 py-1 text-xs"
                      >
                        Reply
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
