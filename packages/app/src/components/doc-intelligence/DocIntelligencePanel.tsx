import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type {
  DocumentCommentThread,
  DocumentReviewFinding,
  DocumentReviewMode,
  DocumentReviewRunRecord,
  DocumentSuggestionUiRecord,
} from '../../types/collaboration';
import type { EditorSelectionSnapshot } from '../SuggestionPanel';

const CommentThreadPanel = lazy(() => import('../CommentThread').then((module) => ({ default: module.CommentThreadPanel })));
const ReviewPanel = lazy(() => import('../ReviewPanel').then((module) => ({ default: module.ReviewPanel })));
const SuggestionPanel = lazy(() => import('../SuggestionPanel').then((module) => ({ default: module.SuggestionPanel })));

type RailPanel = 'intelligence' | 'ask' | 'notes' | 'versions';
type IntelligenceTab = 'summary' | 'related' | 'tasks' | 'metadata';

interface DocMetadata {
  filename: string | null;
  path: string | null;
  sourceName: string | null;
  contentType: string | null;
  size: number | null;
  updatedAt: string | null;
  readOnly: boolean;
  isBinary: boolean;
}

interface DocIntelligencePanelProps {
  collapsed: boolean;
  setCollapsed: (value: boolean | ((prev: boolean) => boolean)) => void;
  docText: string;
  metadata: DocMetadata;
  canOpenVersionHistory: boolean;
  versionHistoryOpen: boolean;
  onOpenVersionHistory?: () => void;
  documentsReady: boolean;
  currentDocId: string | null;
  currentFile: string | null;
  currentSourceId: string | null;
  currentFileReadOnly: boolean;
  editMode: boolean;
  setEditMode: (value: boolean | ((prev: boolean) => boolean)) => void;
  setFileContent: (content: string) => void;
  editorSelection: EditorSelectionSnapshot | null;
  commentThreads: readonly DocumentCommentThread[];
  setCommentThreads: (threads: DocumentCommentThread[]) => void;
  selectedCommentId: string | null;
  setSelectedCommentId: (threadId: string) => void;
  setCommentPopover: (value: {
    anchor: { left: number; top: number; bottom: number };
    selection: { from: number; to: number };
    selectedText: string;
  }) => void;
  suggestions: readonly DocumentSuggestionUiRecord[];
  setSuggestions: (suggestions: DocumentSuggestionUiRecord[]) => void;
  selectedSuggestionId: string | null;
  setSelectedSuggestionId: (suggestionId: string) => void;
  reviewFindings: readonly DocumentReviewFinding[];
  reviewMode: DocumentReviewMode;
  setReviewMode: (mode: DocumentReviewMode) => void;
  reviewRun: DocumentReviewRunRecord | null;
  setReviewRun: (run: DocumentReviewRunRecord | null) => void;
  setReviewFindings: (findings: DocumentReviewFinding[]) => void;
  selectedFindingId: string | null;
  setSelectedFindingId: (findingId: string) => void;
  setFocusRange: (range: { from: number; to: number }) => void;
  documentsClient: any;
  fetchSourceFile: (sourceId: string, path: string) => Promise<{ content?: string | null }>;
  pushToast: (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void;
  handleApplyReviewFindingFix: (findingId: string) => void;
  handleIgnoreReviewFinding: (findingId: string) => void;
  rightSidebarHasComments: boolean;
  rightSidebarHasSuggestions: boolean;
  focusedRail?: RailPanel | null;
  onFocusedRailApplied?: () => void;
}

interface LocalOutline {
  paragraph: string | null;
  headings: string[];
  copyText: string;
}

function computeDomSelectionAnchor(): { left: number; top: number; bottom: number } | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  try {
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect || (!Number.isFinite(rect.left) && !Number.isFinite(rect.top))) {
      return null;
    }

    return { left: rect.left, top: rect.top, bottom: rect.bottom };
  } catch {
    return null;
  }
}

function cleanupMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_>#-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractLocalOutline(docText: string, isBinary: boolean): LocalOutline | null {
  if (isBinary) return null;

  const normalized = docText.replace(/\r/g, '').trim();
  if (!normalized) return null;

  const lines = normalized.split('\n').map((line) => line.trim());
  const headings = lines
    .map((line) => line.match(/^#{1,4}\s+(.+)$/)?.[1])
    .filter((line): line is string => Boolean(line))
    .map(cleanupMarkdown)
    .filter(Boolean)
    .slice(0, 5);

  const paragraph =
    lines
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('```') && !line.startsWith('|'))
      .map(cleanupMarkdown)
      .find((line) => line.length >= 40) ?? null;

  if (!paragraph && headings.length === 0) {
    return null;
  }

  const copyText = [
    paragraph ? `At a glance: ${paragraph}` : null,
    headings.length > 0 ? `Outline: ${headings.join(' / ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return { paragraph, headings, copyText };
}

function formatBytes(size: number | null): string {
  if (typeof size !== 'number' || !Number.isFinite(size)) return 'Unknown';
  if (size < 1024) return `${size} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(value: string | null): string {
  if (!value) return 'Unknown';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border-secondary)] bg-[var(--bg-secondary)]/50 p-4">
      <div className="text-sm font-medium text-[var(--text-primary)]">{title}</div>
      <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{body}</p>
    </div>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 break-words text-xs text-[var(--text-primary)]">{value || 'Unknown'}</div>
    </div>
  );
}

export default function DocIntelligencePanel({
  collapsed,
  setCollapsed,
  docText,
  metadata,
  canOpenVersionHistory,
  versionHistoryOpen,
  onOpenVersionHistory,
  documentsReady,
  currentDocId,
  currentFile,
  currentSourceId,
  currentFileReadOnly,
  editMode,
  setEditMode,
  setFileContent,
  editorSelection,
  commentThreads,
  setCommentThreads,
  selectedCommentId,
  setSelectedCommentId,
  setCommentPopover,
  suggestions,
  setSuggestions,
  selectedSuggestionId,
  setSelectedSuggestionId,
  reviewFindings,
  reviewMode,
  setReviewMode,
  reviewRun,
  setReviewRun,
  setReviewFindings,
  selectedFindingId,
  setSelectedFindingId,
  setFocusRange,
  documentsClient,
  fetchSourceFile,
  pushToast,
  handleApplyReviewFindingFix,
  handleIgnoreReviewFinding,
  rightSidebarHasComments,
  rightSidebarHasSuggestions,
  focusedRail = null,
  onFocusedRailApplied,
}: DocIntelligencePanelProps) {
  const [activeRail, setActiveRail] = useState<RailPanel>('intelligence');
  const [activeTab, setActiveTab] = useState<IntelligenceTab>('summary');

  useEffect(() => {
    if (!focusedRail) {
      return;
    }

    setActiveRail(focusedRail);
    setCollapsed(false);
    onFocusedRailApplied?.();
  }, [focusedRail, onFocusedRailApplied, setCollapsed]);
  const outline = useMemo(() => extractLocalOutline(docText, metadata.isBinary), [docText, metadata.isBinary]);

  const railItems: Array<{ id: RailPanel; icon: string; label: string }> = [
    { id: 'intelligence', icon: '✦', label: 'Intelligence' },
    { id: 'ask', icon: 'Ask', label: 'Ask' },
    { id: 'notes', icon: '✎', label: 'Notes' },
    { id: 'versions', icon: '↻', label: 'Versions' },
  ];

  const handleRailClick = (panel: RailPanel) => {
    if (activeRail === panel) {
      setCollapsed((prev) => !prev);
      return;
    }

    setActiveRail(panel);
    setCollapsed(false);
  };

  const renderSummary = () => (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-[var(--text-primary)]">Summary</div>
          <div className="text-[11px] text-[var(--text-muted)]">Local outline preview, not an AI summary.</div>
        </div>
        <button
          type="button"
          disabled={!outline?.copyText}
          onClick={() => {
            if (!outline?.copyText || !navigator.clipboard) return;
            void navigator.clipboard.writeText(outline.copyText);
          }}
          className={`mc-shell-btn px-2.5 py-1 text-xs ${outline?.copyText ? '' : 'cursor-not-allowed opacity-40'}`}
        >
          Copy
        </button>
      </div>

      {outline ? (
        <div className="space-y-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3">
          {outline.paragraph ? (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">At a glance</div>
              <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{outline.paragraph}</p>
            </div>
          ) : null}
          {outline.headings.length > 0 ? (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Heading outline</div>
              <ol className="mt-2 space-y-1 text-xs text-[var(--text-secondary)]">
                {outline.headings.map((heading, index) => (
                  <li key={`${heading}-${index}`} className="truncate">
                    {index + 1}. {heading}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          <div className="rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
            AI summary coming soon.
          </div>
        </div>
      ) : (
        <EmptyState
          title="No intelligence for this file"
          body="No intelligence for binary files or very small docs. Intelligence works best with readable text content."
        />
      )}
    </div>
  );

  const renderMetadata = () => (
    <div className="space-y-2">
      <MetadataRow label="Filename" value={metadata.filename ?? 'Unknown'} />
      <MetadataRow label="Path" value={metadata.path ?? 'Unknown'} />
      <MetadataRow label="Source" value={metadata.sourceName ?? 'Local workspace'} />
      <MetadataRow label="File type" value={metadata.contentType ?? 'Unknown'} />
      <MetadataRow label="Size" value={formatBytes(metadata.size)} />
      <MetadataRow label="Last updated" value={formatDate(metadata.updatedAt)} />
      <MetadataRow label="Permissions" value={metadata.readOnly ? 'Read-only' : 'Editable'} />
    </div>
  );

  const renderComments = () => (
    <div className="overflow-hidden rounded-xl border border-[var(--border-primary)]">
      {rightSidebarHasComments ? (
        <Suspense fallback={null}>
          <CommentThreadPanel
            threads={commentThreads}
            onNewFromSelection={() => {
              if (!documentsReady || !currentDocId) {
                pushToast('Connect a Documents token to use comments.', 'warning');
                return;
              }
              if (!editorSelection || editorSelection.to <= editorSelection.from) {
                if (!editMode) {
                  setEditMode(true);
                }
                pushToast('Select text in the editor, then press + to comment.', 'info');
                return;
              }

              setEditMode(true);
              const anchor = computeDomSelectionAnchor() ?? { left: 24, top: 24, bottom: 24 };
              setCommentPopover({
                anchor,
                selection: { from: editorSelection.from, to: editorSelection.to },
                selectedText: editorSelection.text,
              });
            }}
            onSelectThread={(threadId: string) => {
              const thread = commentThreads.find((entry) => entry.id === threadId) ?? null;
              if (!thread) return;
              setEditMode(true);
              setSelectedCommentId(threadId);
              setFocusRange({ from: thread.range.from, to: thread.range.to });
              window.requestAnimationFrame(() => {
                document.getElementById(`comment-thread-${threadId}`)?.scrollIntoView({ block: 'nearest' });
              });
            }}
            onReply={(threadId: string, text: string) => {
              void (async () => {
                if (!documentsReady || !currentDocId) {
                  pushToast('Connect a Documents token to reply.', 'warning');
                  return;
                }
                try {
                  const response = await documentsClient.postCommentReply(currentDocId, threadId, { text });
                  setCommentThreads(response.threads);
                  pushToast('Reply posted.', 'success');
                } catch (error) {
                  pushToast(error instanceof Error ? error.message : 'Failed to post reply.', 'error');
                }
              })();
            }}
            onResolve={(threadId: string, resolved: boolean) => {
              void (async () => {
                if (!documentsReady || !currentDocId) {
                  pushToast('Connect a Documents token to resolve comments.', 'warning');
                  return;
                }
                try {
                  const response = await documentsClient.postCommentResolve(currentDocId, threadId, { resolved });
                  setCommentThreads(response.threads);
                } catch (error) {
                  pushToast(error instanceof Error ? error.message : 'Failed to update comment.', 'error');
                }
              })();
            }}
            selectedThreadId={selectedCommentId}
          />
        </Suspense>
      ) : null}

      {rightSidebarHasSuggestions ? (
        <Suspense fallback={null}>
          <SuggestionPanel
            suggestions={suggestions}
            selectedSuggestionId={selectedSuggestionId}
            onSelectSuggestion={(suggestionId: string) => {
              const suggestion = suggestions.find((entry) => entry.id === suggestionId) ?? null;
              if (!suggestion) return;
              setEditMode(true);
              setSelectedSuggestionId(suggestionId);
              setFocusRange({ from: suggestion.range.from, to: suggestion.range.to });
            }}
            onAccept={(suggestionId: string) => {
              void (async () => {
                if (currentFileReadOnly) {
                  pushToast('This source is read-only. Suggestions cannot be accepted.', 'warning');
                  return;
                }
                if (!documentsReady || !currentDocId) {
                  pushToast('Connect a Documents token to accept suggestions.', 'warning');
                  return;
                }
                try {
                  const response = await documentsClient.acceptSuggestion(currentDocId, suggestionId);
                  setSuggestions(response.suggestions);
                  pushToast('Suggestion accepted.', 'success');
                  if (currentSourceId && currentFile) {
                    const updated = await fetchSourceFile(currentSourceId, currentFile);
                    setFileContent(updated.content || '');
                  }
                } catch (error) {
                  pushToast(error instanceof Error ? error.message : 'Failed to accept suggestion.', 'error');
                }
              })();
            }}
            onReject={(suggestionId: string) => {
              void (async () => {
                if (!documentsReady || !currentDocId) {
                  pushToast('Connect a Documents token to reject suggestions.', 'warning');
                  return;
                }
                try {
                  const response = await documentsClient.rejectSuggestion(currentDocId, suggestionId);
                  setSuggestions(response.suggestions);
                  pushToast('Suggestion rejected.', 'info');
                } catch (error) {
                  pushToast(error instanceof Error ? error.message : 'Failed to reject suggestion.', 'error');
                }
              })();
            }}
            selection={editorSelection}
            onCreateSuggestion={(input) => {
              void (async () => {
                if (!documentsReady || !currentDocId) {
                  pushToast('Connect a Documents token to create suggestions.', 'warning');
                  return;
                }
                try {
                  const response = await documentsClient.postSuggestion(currentDocId, input);
                  setSuggestions(response.suggestions);
                  pushToast('Suggestion created.', 'success');
                } catch (error) {
                  pushToast(error instanceof Error ? error.message : 'Failed to create suggestion.', 'error');
                }
              })();
            }}
          />
        </Suspense>
      ) : null}

      {documentsReady ? (
        <Suspense fallback={null}>
          <ReviewPanel
            mode={reviewMode}
            onChangeMode={setReviewMode}
            onRunReview={(mode: DocumentReviewMode) => {
              void (async () => {
                if (!documentsReady || !currentDocId) {
                  pushToast('Connect a Documents token to run reviews.', 'warning');
                  return;
                }
                try {
                  const response = await documentsClient.postReview(currentDocId, { mode });
                  setReviewRun(response.run);
                  setReviewFindings(response.findings);
                  pushToast('Review started.', 'info');
                } catch (error) {
                  pushToast(error instanceof Error ? error.message : 'Failed to start review.', 'error');
                }
              })();
            }}
            run={reviewRun}
            findings={reviewFindings}
            selectedFindingId={selectedFindingId}
            onSelectFinding={(findingId: string) => {
              const finding = reviewFindings.find((entry) => entry.id === findingId) ?? null;
              if (!finding || !finding.range) return;
              setEditMode(true);
              setSelectedFindingId(findingId);
              setFocusRange({ from: finding.range.from, to: finding.range.to });
            }}
            onApplyFix={handleApplyReviewFindingFix}
            onIgnoreFinding={handleIgnoreReviewFinding}
            content={docText}
          />
        </Suspense>
      ) : null}
    </div>
  );

  const renderIntelligence = () => {
    const tabs: Array<{ id: IntelligenceTab; label: string }> = [
      { id: 'summary', label: 'Summary' },
      { id: 'related', label: 'Related' },
      { id: 'tasks', label: 'Tasks' },
      { id: 'metadata', label: 'Metadata' },
    ];

    return (
      <>
        <div className="border-b border-[var(--border-primary)] px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-[var(--text-primary)]">Comments</div>
            {commentThreads.length > 0 ? (
              <span className="mc-shell-pill px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
                {commentThreads.length} thread{commentThreads.length === 1 ? '' : 's'}
              </span>
            ) : null}
          </div>
          <div className="mt-3">{renderComments()}</div>
        </div>

        <div className="border-b border-[var(--border-primary)] px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-[var(--text-primary)]">✦ Intelligence</div>
            <span className="mc-shell-pill px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
              Doc context
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`mc-shell-btn px-2 py-1 text-[11px] ${
                  activeTab === tab.id ? 'mc-shell-btn-active text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {activeTab === 'summary' ? renderSummary() : null}
          {activeTab === 'related' ? <EmptyState title="No related documents yet." body="Related document discovery is not wired yet." /> : null}
          {activeTab === 'tasks' ? <EmptyState title="No linked tasks." body="A document-to-task lookup is not available yet." /> : null}
          {activeTab === 'metadata' ? renderMetadata() : null}
        </div>
      </>
    );
  };

  const renderPanelBody = () => {
    if (activeRail === 'intelligence') return renderIntelligence();
    if (activeRail === 'ask') {
      return (
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <div className="text-sm font-semibold text-[var(--text-primary)]">Ask about this document</div>
          <EmptyState title="Ask is coming soon." body="Document-aware Q&A is not connected to a backend yet." />
        </div>
      );
    }
    if (activeRail === 'notes') {
      return (
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <div className="text-sm font-semibold text-[var(--text-primary)]">Notes</div>
          <EmptyState title="No notes yet." body="Document notes are not persisted in Entity yet." />
        </div>
      );
    }

    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div>
          <div className="text-sm font-semibold text-[var(--text-primary)]">Versions</div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">Uses the existing local file history surface.</div>
        </div>
        <button
          type="button"
          disabled={!canOpenVersionHistory}
          onClick={onOpenVersionHistory}
          className={`mc-shell-btn w-full justify-center px-3 py-2 text-xs ${
            versionHistoryOpen ? 'mc-shell-btn-active text-[var(--text-primary)]' : ''
          } ${canOpenVersionHistory ? '' : 'cursor-not-allowed opacity-40'}`}
        >
          Open version history
        </button>
        {!canOpenVersionHistory ? (
          <EmptyState title="Version history unavailable." body="Version history is available for local files." />
        ) : null}
      </div>
    );
  };

  return (
    <aside className="flex shrink-0 border-l border-[var(--border-primary)] bg-[var(--bg-primary)]">
      {!collapsed ? (
        <div className="flex w-[300px] min-w-0 flex-col border-r border-[var(--border-primary)]">{renderPanelBody()}</div>
      ) : null}
      <div className="flex w-11 shrink-0 flex-col items-center border-l border-[var(--border-primary)] bg-[var(--bg-secondary)] py-2">
        <div className="flex flex-1 flex-col items-center gap-2">
          {railItems.map((item) => {
            const active = activeRail === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleRailClick(item.id)}
                className={`mc-shell-btn flex h-20 w-9 flex-col items-center justify-center gap-1 px-0 py-1 text-[10px] ${
                  active ? 'mc-shell-btn-active text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                }`}
                aria-pressed={active}
                title={`${collapsed && active ? 'Expand' : active ? 'Collapse' : 'Open'} ${item.label}`}
              >
                <span className="text-[12px] leading-none" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="text-[9px] leading-none [writing-mode:vertical-rl]">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
