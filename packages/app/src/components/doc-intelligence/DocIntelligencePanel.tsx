import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type {
  DocumentCommentThread,
  DocumentReviewFinding,
  DocumentReviewMode,
  DocumentReviewRunRecord,
  DocumentSuggestionUiRecord,
} from '../../types/collaboration';
import type { EditorSelectionSnapshot } from '../SuggestionPanel';
import { buildApiCandidates, HttpRequestError, requestJsonWithFallback } from '../../lib/http';
import {
  docFilenameStem,
  filterRelatedDocResults,
  findTasksReferencingDoc,
  type RelatedDocResult,
} from '../../lib/docIntelligenceData';

const CommentThreadPanel = lazy(() => import('../CommentThread').then((module) => ({ default: module.CommentThreadPanel })));
const ReviewPanel = lazy(() => import('../ReviewPanel').then((module) => ({ default: module.ReviewPanel })));
const SuggestionPanel = lazy(() => import('../SuggestionPanel').then((module) => ({ default: module.SuggestionPanel })));

type RailPanel = 'intelligence' | 'comments' | 'tasks' | 'metadata' | 'notes' | 'versions';
type FocusRailTarget = RailPanel | 'ask';
type IntelligenceTab = 'summary' | 'ask' | 'grammar' | 'related';

interface DocIntelligenceSettingsView {
  enabled: boolean;
  provider: string;
  model: string;
  apiKeyConfigured: boolean;
  ready: boolean;
}

interface PanelTask {
  id: number;
  name: string;
  description?: string | null;
  output?: string | null;
  column?: string;
  assignee?: string;
}

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
  focusedRail?: FocusRailTarget | null;
  onFocusedRailApplied?: () => void;
  apiBase?: string;
  tasks?: readonly PanelTask[];
  onOpenTask?: (taskId: number) => void;
  onOpenRelatedDoc?: (sourceId: string, path: string) => void;
  /** When true (split view), the panel header shows which file it describes. */
  splitMode?: boolean;
}

interface DocNoteRecord {
  id: string;
  text: string;
  createdAt: string;
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
  apiBase = '',
  tasks = [],
  onOpenTask,
  onOpenRelatedDoc,
  splitMode = false,
}: DocIntelligencePanelProps) {
  const [activeRail, setActiveRail] = useState<RailPanel>('intelligence');
  const [activeTab, setActiveTab] = useState<IntelligenceTab>('summary');
  const [intelligenceSettings, setIntelligenceSettings] = useState<DocIntelligenceSettingsView | null>(null);
  const [askQuestion, setAskQuestion] = useState('');
  const [askAnswer, setAskAnswer] = useState<string | null>(null);
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [relatedDocs, setRelatedDocs] = useState<RelatedDocResult[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedError, setRelatedError] = useState<string | null>(null);
  const [notes, setNotes] = useState<DocNoteRecord[]>([]);
  const [noteDraft, setNoteDraft] = useState('');
  const [notesBusy, setNotesBusy] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);

  useEffect(() => {
    if (!focusedRail) {
      return;
    }

    if (focusedRail === 'ask') {
      setActiveRail('intelligence');
      setActiveTab('ask');
    } else {
      setActiveRail(focusedRail);
    }
    setCollapsed(false);
    onFocusedRailApplied?.();
  }, [focusedRail, onFocusedRailApplied, setCollapsed]);

  // Load Doc Intelligence settings once so the Ask tab can reflect enable/provider state.
  useEffect(() => {
    let cancelled = false;
    requestJsonWithFallback<{ settings?: DocIntelligenceSettingsView }>({
      urls: buildApiCandidates('/doc-intelligence/settings', apiBase),
      fallbackError: 'Failed to load Doc Intelligence settings.',
    })
      .then((data) => {
        if (!cancelled && data?.settings) {
          setIntelligenceSettings(data.settings);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIntelligenceSettings(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  // Reset per-document ask/related state when the file changes.
  useEffect(() => {
    setAskAnswer(null);
    setAskError(null);
    setAskQuestion('');
    setRelatedDocs([]);
    setRelatedError(null);
    setNotes([]);
    setNoteDraft('');
    setNotesError(null);
  }, [currentFile, currentSourceId]);

  const notesQuery = useCallback(() => {
    const params = new URLSearchParams({ path: currentFile ?? '' });
    if (currentSourceId) {
      params.set('sourceId', currentSourceId);
    }
    return params.toString();
  }, [currentFile, currentSourceId]);

  // Load notes when the Notes rail is opened for the current doc.
  useEffect(() => {
    if (activeRail !== 'notes' || !currentFile) {
      return;
    }

    let cancelled = false;
    requestJsonWithFallback<{ notes?: DocNoteRecord[] }>({
      urls: buildApiCandidates(`/doc-intelligence/notes?${notesQuery()}`, apiBase),
      fallbackError: 'Failed to load notes.',
    })
      .then((data) => {
        if (!cancelled) {
          setNotes(Array.isArray(data?.notes) ? data.notes : []);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setNotesError(error instanceof Error ? error.message : 'Failed to load notes.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeRail, apiBase, currentFile, notesQuery]);

  const handleAddNote = useCallback(() => {
    const text = noteDraft.trim();
    if (!text || notesBusy || !currentFile) {
      return;
    }

    setNotesBusy(true);
    setNotesError(null);
    requestJsonWithFallback<{ notes?: DocNoteRecord[] }>({
      urls: buildApiCandidates('/doc-intelligence/notes', apiBase),
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: currentFile, sourceId: currentSourceId ?? undefined, text }),
      },
      fallbackError: 'Failed to save note.',
    })
      .then((data) => {
        setNotes(Array.isArray(data?.notes) ? data.notes : []);
        setNoteDraft('');
      })
      .catch((error) => {
        setNotesError(error instanceof Error ? error.message : 'Failed to save note.');
      })
      .finally(() => {
        setNotesBusy(false);
      });
  }, [apiBase, currentFile, currentSourceId, noteDraft, notesBusy]);

  const handleDeleteNote = useCallback(
    (noteId: string) => {
      if (notesBusy || !currentFile) {
        return;
      }

      setNotesBusy(true);
      setNotesError(null);
      requestJsonWithFallback<{ notes?: DocNoteRecord[] }>({
        urls: buildApiCandidates(`/doc-intelligence/notes/${encodeURIComponent(noteId)}?${notesQuery()}`, apiBase),
        init: { method: 'DELETE' },
        fallbackError: 'Failed to delete note.',
      })
        .then((data) => {
          setNotes(Array.isArray(data?.notes) ? data.notes : []);
        })
        .catch((error) => {
          setNotesError(error instanceof Error ? error.message : 'Failed to delete note.');
        })
        .finally(() => {
          setNotesBusy(false);
        });
    },
    [apiBase, currentFile, notesBusy, notesQuery],
  );

  const loadRelatedDocs = useCallback(() => {
    if (!currentFile) {
      return;
    }

    const stem = docFilenameStem(currentFile);
    setRelatedLoading(true);
    setRelatedError(null);
    requestJsonWithFallback<{ results?: Array<{ sourceId?: string; path?: string; sourceName?: string }> }>({
      urls: buildApiCandidates(`/fs/search?q=${encodeURIComponent(stem)}&limit=20`, apiBase),
      fallbackError: 'Related document search failed.',
    })
      .then((data) => {
        const raw = (data?.results ?? [])
          .filter((entry): entry is { sourceId: string; path: string; sourceName?: string } =>
            Boolean(entry && typeof entry.sourceId === 'string' && typeof entry.path === 'string'),
          );
        setRelatedDocs(filterRelatedDocResults(raw, currentFile));
      })
      .catch((error) => {
        setRelatedError(error instanceof Error ? error.message : 'Related document search failed.');
        setRelatedDocs([]);
      })
      .finally(() => {
        setRelatedLoading(false);
      });
  }, [apiBase, currentFile]);

  useEffect(() => {
    if (activeTab === 'related' && activeRail === 'intelligence' && currentFile) {
      loadRelatedDocs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, activeRail, currentFile]);

  const handleAskSubmit = useCallback(() => {
    const question = askQuestion.trim();
    if (!question || askLoading) {
      return;
    }

    setAskLoading(true);
    setAskError(null);
    setAskAnswer(null);
    requestJsonWithFallback<{ answer?: string }>({
      urls: buildApiCandidates('/doc-intelligence/ask', apiBase),
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          content: docText,
          path: metadata.path ?? undefined,
          filename: metadata.filename ?? undefined,
        }),
      },
      fallbackError: 'Ask request failed.',
    })
      .then((data) => {
        if (typeof data?.answer === 'string' && data.answer.trim()) {
          setAskAnswer(data.answer.trim());
        } else {
          setAskError('The model did not return an answer.');
        }
      })
      .catch((error) => {
        // THE-934: surface server validation as generic copy without leaking
        // model internals. Schema errors carry caller-supplied field names only.
        if (error instanceof HttpRequestError) {
          const payload = (error.payload ?? null) as { code?: string; missingFields?: string[]; error?: string } | null;
          if (payload?.code === 'schema_invalid') {
            setAskError('The document schema is malformed. Correct the requested fields and try again.');
          } else if (payload?.code === 'schema_incomplete') {
            const missing = Array.isArray(payload.missingFields) && payload.missingFields.length > 0
              ? payload.missingFields.join(', ')
              : 'some fields';
            setAskError(`The answer did not cover every requested field (${missing}). Refine the document or fields.`);
          } else if (payload?.code === 'no-model') {
            setAskError('No model is configured for Doc Intelligence.');
          } else if (payload?.error) {
            setAskError(payload.error);
          } else {
            setAskError(error instanceof Error ? error.message : 'Ask request failed.');
          }
        } else {
          setAskError(error instanceof Error ? error.message : 'Ask request failed.');
        }
      })
      .finally(() => {
        setAskLoading(false);
      });
  }, [apiBase, askLoading, askQuestion, docText, metadata.filename, metadata.path]);

  const linkedTasks = useMemo(
    () => findTasksReferencingDoc(tasks, metadata.path ?? currentFile),
    [tasks, metadata.path, currentFile],
  );

  const outline = useMemo(() => extractLocalOutline(docText, metadata.isBinary), [docText, metadata.isBinary]);

  const railItems: Array<{ id: RailPanel; icon: string; label: string }> = [
    { id: 'intelligence', icon: '✦', label: 'Intelligence' },
    { id: 'comments', icon: '💬', label: 'Comments' },
    { id: 'tasks', icon: '☑', label: 'Tasks' },
    { id: 'metadata', icon: 'ⓘ', label: 'Metadata' },
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
      ) : (
        <EmptyState
          title="Comments unavailable"
          body="Document comments are unavailable while collaboration is disconnected or still initializing."
        />
      )}

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

    </div>
  );

  const renderGrammar = () => {
    if (!documentsReady) {
      return (
        <EmptyState
          title="Grammar review unavailable."
          body="Connect a Documents token to run grammar and style reviews on this document."
        />
      );
    }

    return (
      <div className="overflow-hidden rounded-xl border border-[var(--border-primary)]">
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
      </div>
    );
  };

  const renderAsk = () => {
    if (intelligenceSettings && !intelligenceSettings.enabled) {
      return (
        <EmptyState
          title="Doc Intelligence is disabled."
          body="Enable it in Admin → Docs to ask questions about this document using your configured model provider."
        />
      );
    }

    if (intelligenceSettings && !intelligenceSettings.apiKeyConfigured) {
      return (
        <EmptyState
          title="No model configured."
          body="Doc Intelligence reuses the Task Master model provider. Add an API key in Admin → Task Master."
        />
      );
    }

    return (
      <div className="space-y-3">
        <div>
          <div className="text-sm font-semibold text-[var(--text-primary)]">Ask about this document</div>
          {intelligenceSettings ? (
            <div className="mt-1 text-[11px] text-[var(--text-muted)]">
              Using {intelligenceSettings.provider} · {intelligenceSettings.model}
            </div>
          ) : null}
        </div>
        <textarea
          value={askQuestion}
          onChange={(event) => setAskQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              handleAskSubmit();
            }
          }}
          placeholder="e.g. What are the key points of this document?"
          rows={3}
          className="mc-shell-input w-full resize-y px-3 py-2 text-xs"
          aria-label="Question about this document"
        />
        <button
          type="button"
          onClick={handleAskSubmit}
          disabled={askLoading || !askQuestion.trim()}
          className={`mc-shell-btn w-full justify-center px-3 py-2 text-xs font-medium ${
            askLoading || !askQuestion.trim() ? 'cursor-not-allowed opacity-50' : 'mc-shell-btn-active text-[var(--text-primary)]'
          }`}
        >
          {askLoading ? 'Asking…' : 'Ask'}
        </button>
        {askError ? (
          <div className="rounded-lg border border-[var(--error)]/40 bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--error)]">
            {askError}
          </div>
        ) : null}
        {askAnswer ? (
          <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3">
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Answer</div>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[var(--text-secondary)]">{askAnswer}</p>
          </div>
        ) : null}
      </div>
    );
  };

  const renderRelated = () => {
    if (relatedLoading) {
      return <div className="text-xs text-[var(--text-muted)]">Searching for related documents…</div>;
    }

    if (relatedError) {
      return <EmptyState title="Related search failed." body={relatedError} />;
    }

    if (relatedDocs.length === 0) {
      return (
        <EmptyState
          title="No related documents found."
          body="Related documents are matched by filename across your sources."
        />
      );
    }

    return (
      <div className="space-y-2">
        {relatedDocs.map((doc) => (
          <button
            key={`${doc.sourceId}::${doc.path}`}
            type="button"
            onClick={() => onOpenRelatedDoc?.(doc.sourceId, doc.path)}
            className="block w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-left transition hover:border-[var(--border-secondary)] hover:bg-[var(--bg-tertiary)]"
          >
            <div className="truncate text-xs font-medium text-[var(--text-primary)]">📄 {doc.path}</div>
            {doc.sourceName ? (
              <div className="mt-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{doc.sourceName}</div>
            ) : null}
          </button>
        ))}
      </div>
    );
  };

  const renderTasks = () => {
    if (linkedTasks.length === 0) {
      return (
        <EmptyState
          title="No linked tasks."
          body="Tasks are linked when their name, description, or output references this document."
        />
      );
    }

    return (
      <div className="space-y-2">
        {linkedTasks.map((task) => (
          <button
            key={task.id}
            type="button"
            onClick={() => onOpenTask?.(task.id)}
            className="block w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-left transition hover:border-[var(--border-secondary)] hover:bg-[var(--bg-tertiary)]"
          >
            <div className="truncate text-xs font-medium text-[var(--text-primary)]">#{task.id} · {task.name}</div>
            <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
              {[task.column, task.assignee].filter(Boolean).join(' · ')}
            </div>
          </button>
        ))}
      </div>
    );
  };

  const renderIntelligence = () => {
    const tabs: Array<{ id: IntelligenceTab; label: string }> = [
      { id: 'summary', label: 'Summary' },
      { id: 'ask', label: 'Ask' },
      { id: 'grammar', label: 'Grammar' },
      { id: 'related', label: 'Related' },
    ];

    return (
      <>
        <div className="border-b border-[var(--border-primary)] px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-[var(--text-primary)]">✦ Intelligence</div>
            <span
              className="mc-shell-pill max-w-[9.5rem] truncate px-2 py-0.5 text-[10px] tracking-wide text-[var(--text-secondary)]"
              title={splitMode && metadata.filename ? metadata.filename : undefined}
            >
              {splitMode && metadata.filename ? metadata.filename : 'DOC CONTEXT'}
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
          {activeTab === 'ask' ? renderAsk() : null}
          {activeTab === 'grammar' ? renderGrammar() : null}
          {activeTab === 'related' ? renderRelated() : null}
        </div>
      </>
    );
  };

  const renderCommentsPanel = () => (
    <>
      <div className="border-b border-[var(--border-primary)] px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-[var(--text-primary)]">💬 Comments</div>
          {commentThreads.length > 0 ? (
            <span className="mc-shell-pill px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
              {commentThreads.length} thread{commentThreads.length === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">{renderComments()}</div>
    </>
  );

  const renderTasksPanel = () => (
    <>
      <div className="border-b border-[var(--border-primary)] px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-[var(--text-primary)]">☑ Tasks</div>
          {linkedTasks.length > 0 ? (
            <span className="mc-shell-pill px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
              {linkedTasks.length} linked
            </span>
          ) : null}
        </div>
        <div className="mt-1 text-[11px] text-[var(--text-muted)]">Tasks that reference this document.</div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">{renderTasks()}</div>
    </>
  );

  const renderMetadataPanel = () => (
    <>
      <div className="border-b border-[var(--border-primary)] px-4 py-3">
        <div className="text-sm font-semibold text-[var(--text-primary)]">ⓘ Metadata</div>
        <div className="mt-1 text-[11px] text-[var(--text-muted)]">File details and provenance.</div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">{renderMetadata()}</div>
    </>
  );

  const renderPanelBody = () => {
    if (activeRail === 'intelligence') return renderIntelligence();
    if (activeRail === 'comments') return renderCommentsPanel();
    if (activeRail === 'tasks') return renderTasksPanel();
    if (activeRail === 'metadata') return renderMetadataPanel();
    if (activeRail === 'notes') {
      return (
        <>
          <div className="border-b border-[var(--border-primary)] px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-[var(--text-primary)]">✎ Notes</div>
              {notes.length > 0 ? (
                <span className="mc-shell-pill px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
                  {notes.length}
                </span>
              ) : null}
            </div>
            <div className="mt-1 text-[11px] text-[var(--text-muted)]">Private notes attached to this document.</div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
            <div className="space-y-2">
              <textarea
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    handleAddNote();
                  }
                }}
                placeholder="Write a note about this document…"
                rows={3}
                className="mc-shell-input w-full resize-y px-3 py-2 text-xs"
                aria-label="New note"
              />
              <button
                type="button"
                onClick={handleAddNote}
                disabled={notesBusy || !noteDraft.trim()}
                className={`mc-shell-btn w-full justify-center px-3 py-2 text-xs font-medium ${
                  notesBusy || !noteDraft.trim()
                    ? 'cursor-not-allowed opacity-50'
                    : 'mc-shell-btn-active text-[var(--text-primary)]'
                }`}
              >
                {notesBusy ? 'Saving…' : '+ Add note'}
              </button>
              {notesError ? <div className="text-xs text-[var(--error)]">{notesError}</div> : null}
            </div>

            {notes.length === 0 ? (
              <EmptyState title="No notes yet." body="Notes are saved per document and persist across sessions." />
            ) : (
              <div className="space-y-2">
                {[...notes].reverse().map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 whitespace-pre-wrap text-xs leading-5 text-[var(--text-secondary)]">
                        {note.text}
                      </p>
                      <button
                        type="button"
                        onClick={() => handleDeleteNote(note.id)}
                        disabled={notesBusy}
                        className="mc-shell-btn shrink-0 px-1.5 py-0.5 text-[10px]"
                        aria-label="Delete note"
                        title="Delete note"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="mt-1 text-[10px] text-[var(--text-muted)]">{formatDate(note.createdAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
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
