import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { Compartment, EditorSelection, EditorState, RangeSetBuilder, StateField, Transaction } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { Decoration, type DecorationSet, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { searchKeymap } from '@codemirror/search';
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { lintKeymap } from '@codemirror/lint';
import { buildInlineCommentAnchorExtension } from './InlineCommentAnchor';
import { buildTrackChangesDecorationExtension } from './TrackChangesDecoration';
import { buildCursorAvatarsExtension } from './CursorAvatars';
import { buildInlineFindingHighlightExtension } from './InlineFindingHighlight';
import type { DocumentCommentThread, DocumentPresenceRecord, DocumentReviewFinding, DocumentSuggestionUiRecord } from '../types/collaboration';

type AuthorshipActor = 'human' | 'ada' | 'spock' | 'scotty';

const AUTHORSHIP_ACTORS = new Set<AuthorshipActor>(['human', 'ada', 'spock', 'scotty']);

export interface EditorSelectionRange {
  from: number;
  to: number;
}

export interface EditorAuthorshipRange {
  startOffset: number;
  endOffset: number;
  author: string;
  reviewed?: boolean;
}

export interface EditorSelectionSnapshot extends EditorSelectionRange {
  text: string;
}

export interface EditorCursorActivity {
  pos: number;
  selection: EditorSelectionRange;
  action: 'cursor' | 'typing';
}

export interface EditorNewCommentRequest {
  selection: EditorSelectionRange;
  selectedText: string;
  anchor: { left: number; top: number; bottom: number };
}

export interface EditorSuggestingEditRequest {
  from: number;
  to: number;
  originalText: string;
  suggestedText: string;
  type: 'insert' | 'replace' | 'delete';
}

interface EditorProps {
  content: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
  shortcutsEnabled?: boolean;
  authorshipRanges?: readonly EditorAuthorshipRange[];
  onManualAttribution?: (selection: EditorSelectionRange) => void;
  onSelectionChange?: (selection: EditorSelectionSnapshot | null) => void;
  onCursorActivity?: (activity: EditorCursorActivity) => void;
  onNewComment?: (request: EditorNewCommentRequest) => void;
  commentThreads?: readonly DocumentCommentThread[];
  onSelectComment?: (commentId: string) => void;
  suggestions?: readonly DocumentSuggestionUiRecord[];
  onSelectSuggestion?: (suggestionId: string) => void;
  onAcceptSuggestion?: (suggestionId: string) => void;
  onRejectSuggestion?: (suggestionId: string) => void;
  reviewFindings?: readonly DocumentReviewFinding[];
  onSelectFinding?: (findingId: string) => void;
  onApplyFindingFix?: (findingId: string) => void;
  onIgnoreFinding?: (findingId: string) => void;
  remotePresence?: readonly DocumentPresenceRecord[];
  focusRange?: EditorSelectionRange | null;
  followEnabled?: boolean;
  followCursor?: unknown;
  onDetachFollow?: () => void;
  collabMode?: 'editing' | 'suggesting' | 'viewing';
  onToggleSuggestingMode?: () => void;
  onExitSuggestingMode?: () => void;
  onSuggestingEdit?: (request: EditorSuggestingEditRequest) => void;
}

const agents = ['Assistant', 'Human'] as const;

function normalizeAuthorshipActor(value: string): AuthorshipActor {
  const normalized = value.trim().toLowerCase();
  if (AUTHORSHIP_ACTORS.has(normalized as AuthorshipActor)) {
    return normalized as AuthorshipActor;
  }

  return 'human';
}

function buildAuthorshipDecorationSet(
  documentLength: number,
  ranges: readonly EditorAuthorshipRange[]
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  for (const range of ranges) {
    const start = Math.max(0, Math.min(documentLength, Math.floor(range.startOffset)));
    const end = Math.max(start, Math.min(documentLength, Math.floor(range.endOffset)));
    if (end <= start) {
      continue;
    }

    const author = normalizeAuthorshipActor(range.author);
    const classNames = ['cm-authorship-range', `cm-authorship-${author}`];
    if (range.reviewed) {
      classNames.push('cm-authorship-reviewed');
    }

    builder.add(
      start,
      end,
      Decoration.mark({
        class: classNames.join(' '),
      })
    );
  }

  return builder.finish();
}

function buildAuthorshipDecorationsField(ranges: readonly EditorAuthorshipRange[]) {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildAuthorshipDecorationSet(state.doc.length, ranges);
    },
    update(decorations, transaction) {
      if (!transaction.docChanged) {
        return decorations;
      }

      return buildAuthorshipDecorationSet(transaction.state.doc.length, ranges);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });
}

function buildManualAttributionKeymap(
  onManualAttribution: ((selection: EditorSelectionRange) => void) | undefined
) {
  if (!onManualAttribution) {
    return [];
  }

  return keymap.of([
    {
      key: 'Mod-Shift-m',
      preventDefault: true,
      run: (view) => {
        const selection = view.state.selection.main;
        if (selection.empty) {
          return false;
        }

        onManualAttribution({
          from: Math.min(selection.from, selection.to),
          to: Math.max(selection.from, selection.to),
        });
        return true;
      },
    },
  ]);
}

function buildSuggestingModeKeymap(
  shortcutsEnabled: boolean,
  onToggleSuggestingMode: (() => void) | undefined
) {
  if (!shortcutsEnabled || !onToggleSuggestingMode) {
    return [];
  }

  return keymap.of([
    {
      key: 'Mod-Shift-a',
      preventDefault: true,
      run: () => {
        onToggleSuggestingMode();
        return true;
      },
    },
  ]);
}

function buildEscapeKeymap(
  shortcutsEnabled: boolean,
  collabMode: 'editing' | 'suggesting' | 'viewing',
  onExitSuggestingMode: (() => void) | undefined,
  followEnabled: boolean,
  onDetachFollow: (() => void) | undefined
) {
  if (!shortcutsEnabled || (!onExitSuggestingMode && !onDetachFollow)) {
    return [];
  }

  return keymap.of([
    {
      key: 'Escape',
      preventDefault: true,
      run: () => {
        if (collabMode === 'suggesting' && onExitSuggestingMode) {
          onExitSuggestingMode();
          return true;
        }

        if (followEnabled && onDetachFollow) {
          onDetachFollow();
          return true;
        }

        return false;
      },
    },
  ]);
}

function buildNewCommentKeymap(
  shortcutsEnabled: boolean,
  onNewComment: ((request: EditorNewCommentRequest) => void) | undefined
) {
  if (!shortcutsEnabled || !onNewComment) {
    return [];
  }

  return keymap.of([
    {
      key: 'Mod-Shift-c',
      preventDefault: true,
      run: (view) => {
        const selection = view.state.selection.main;
        if (selection.empty) {
          return false;
        }

        const from = Math.min(selection.from, selection.to);
        const to = Math.max(selection.from, selection.to);
        const selectedText = view.state.doc.sliceString(from, to);
        const coords = view.coordsAtPos(from);
        const anchor = coords
          ? { left: coords.left, top: coords.top, bottom: coords.bottom }
          : { left: 24, top: 24, bottom: 24 };

        onNewComment({
          selection: { from, to },
          selectedText,
          anchor,
        });
        return true;
      },
    },
  ]);
}

function mentionCompleter(context: CompletionContext) {
  const word = context.matchBefore(/\w*/);
  if (!word) return null;
  if (word.from === word.to && !context.explicit) return null;
  return {
    from: word.from,
    options: agents.map(a => ({ label: `@${a}`, type: 'text' }))
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampSelection(selection: EditorSelection, docLength: number): EditorSelection {
  if (selection.ranges.length === 0) {
    return EditorSelection.single(0);
  }

  const ranges = selection.ranges.map((range) =>
    EditorSelection.range(clamp(range.anchor, 0, docLength), clamp(range.head, 0, docLength))
  );

  return EditorSelection.create(ranges, selection.mainIndex);
}

function buildSuggestingModeExtension(
  collabMode: 'editing' | 'suggesting' | 'viewing',
  onSuggestingEdit: ((request: EditorSuggestingEditRequest) => void) | undefined
) {
  if (collabMode !== 'suggesting' || !onSuggestingEdit) {
    return [];
  }

  return EditorState.transactionFilter.of((transaction) => {
    if (!transaction.docChanged) {
      return transaction;
    }

    // Only intercept user-driven edits. Programmatic content updates (file load/remote edits) should apply.
    const userEvent = transaction.annotation(Transaction.userEvent);
    if (typeof userEvent !== 'string' || userEvent.length === 0) {
      return transaction;
    }

    transaction.changes.iterChanges((from, to, _fromB, _toB, insert) => {
      const safeFrom = clamp(from, 0, transaction.startState.doc.length);
      const safeTo = clamp(to, 0, transaction.startState.doc.length);
      const originalText = transaction.startState.doc.sliceString(safeFrom, safeTo);
      const suggestedText = insert.toString();

      const type: EditorSuggestingEditRequest['type'] =
        safeFrom === safeTo ? 'insert' : suggestedText.length === 0 ? 'delete' : 'replace';

      if (type === 'insert' && suggestedText.length === 0) {
        return;
      }

      onSuggestingEdit({
        from: safeFrom,
        to: safeTo,
        originalText,
        suggestedText,
        type,
      });
    });

    const selection = clampSelection(transaction.newSelection, transaction.startState.doc.length);

    // Drop the document change, but keep cursor movement so suggesting mode feels like typing.
    return {
      selection,
      scrollIntoView: transaction.scrollIntoView,
      annotations: Transaction.addToHistory.of(false),
    };
  });
}

function resolveFollowPos(view: EditorView, cursor: unknown): number | null {
  if (typeof cursor === 'number' && Number.isFinite(cursor)) {
    return clamp(Math.floor(cursor), 0, view.state.doc.length);
  }

  if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
    return null;
  }

  const record = cursor as Record<string, unknown>;
  const posCandidate =
    record.pos ??
    (record.cursor && typeof record.cursor === 'object' ? (record.cursor as Record<string, unknown>).pos : undefined) ??
    (record.position && typeof record.position === 'object' ? (record.position as Record<string, unknown>).pos : undefined);

  if (typeof posCandidate === 'number' && Number.isFinite(posCandidate)) {
    return clamp(Math.floor(posCandidate), 0, view.state.doc.length);
  }

  const lineCandidate =
    record.line ??
    (record.position && typeof record.position === 'object' ? (record.position as Record<string, unknown>).line : undefined);
  const chCandidate =
    record.ch ??
    record.column ??
    (record.position && typeof record.position === 'object' ? (record.position as Record<string, unknown>).ch : undefined);

  if (typeof lineCandidate === 'number' && typeof chCandidate === 'number') {
    const safeLine = clamp(Math.floor(lineCandidate) + 1, 1, view.state.doc.lines);
    const line = view.state.doc.line(safeLine);
    const safeCh = clamp(Math.floor(chCandidate), 0, line.length);
    return clamp(line.from + safeCh, 0, view.state.doc.length);
  }

  return null;
}

function smoothScrollToPos(view: EditorView, pos: number) {
  const coords = view.coordsAtPos(pos);
  if (!coords) {
    view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    return;
  }

  const scrollDom = view.scrollDOM;
  const scrollRect = scrollDom.getBoundingClientRect();
  const deltaY = coords.top - scrollRect.top - scrollRect.height / 2;
  const nextTop = scrollDom.scrollTop + deltaY;

  scrollDom.scrollTo({
    top: nextTop,
    behavior: 'smooth',
  });
}

const ACTIVE_PRESENCE_WINDOW_MS = 60_000;
const DISCONNECT_PRESENCE_WINDOW_MS = 5 * 60_000;

function msUntilPresenceToneChange(lastActivityAt: string | null, nowMs: number): number | null {
  if (!lastActivityAt) {
    return null;
  }

  const lastActivity = Date.parse(lastActivityAt);
  if (!Number.isFinite(lastActivity)) {
    return null;
  }

  const boundaries = [lastActivity + ACTIVE_PRESENCE_WINDOW_MS, lastActivity + DISCONNECT_PRESENCE_WINDOW_MS].filter(
    (t) => t > nowMs
  );
  if (boundaries.length === 0) {
    return null;
  }

  boundaries.sort((a, b) => a - b);
  return Math.max(0, boundaries[0] + 1 - nowMs);
}

export default function CodeMirrorEditor({
  content,
  onChange,
  onSave,
  readOnly = false,
  shortcutsEnabled = false,
  authorshipRanges = [],
  onManualAttribution,
  onSelectionChange,
  onCursorActivity,
  onNewComment,
  commentThreads = [],
  onSelectComment,
  suggestions = [],
  onSelectSuggestion,
  onAcceptSuggestion,
  onRejectSuggestion,
  reviewFindings = [],
  onSelectFinding,
  onApplyFindingFix,
  onIgnoreFinding,
  remotePresence = [],
  focusRange = null,
  followEnabled = false,
  followCursor = null,
  onDetachFollow,
  collabMode = 'editing',
  onToggleSuggestingMode,
  onExitSuggestingMode,
  onSuggestingEdit,
}: EditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | undefined>(undefined);
  const editableCompartmentRef = useRef(new Compartment());
  const readOnlyCompartmentRef = useRef(new Compartment());
  const collabModeCompartmentRef = useRef(new Compartment());
  const authorshipCompartmentRef = useRef(new Compartment());
  const manualAttributionCompartmentRef = useRef(new Compartment());
  const suggestingKeymapCompartmentRef = useRef(new Compartment());
  const selectionCompartmentRef = useRef(new Compartment());
  const commentAnchorCompartmentRef = useRef(new Compartment());
  const suggestionsCompartmentRef = useRef(new Compartment());
  const findingsCompartmentRef = useRef(new Compartment());
  const cursorsCompartmentRef = useRef(new Compartment());
  const escapeKeymapCompartmentRef = useRef(new Compartment());
  const followScrollTimeoutRef = useRef<number | null>(null);
  const [presenceAgeTick, setPresenceAgeTick] = useState(0);
  const activeReviewFindings = useMemo(
    () => reviewFindings.filter((finding) => finding.status !== 'ignored'),
    [reviewFindings]
  );

  useEffect(() => {
    if (!editorRef.current) return;

    const state = EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        markdown(),
        editableCompartmentRef.current.of(EditorView.editable.of(!readOnly)),
        readOnlyCompartmentRef.current.of(EditorState.readOnly.of(readOnly)),
        collabModeCompartmentRef.current.of(buildSuggestingModeExtension(collabMode, onSuggestingEdit)),
        authorshipCompartmentRef.current.of(buildAuthorshipDecorationsField(authorshipRanges)),
        manualAttributionCompartmentRef.current.of(buildManualAttributionKeymap(onManualAttribution)),
        suggestingKeymapCompartmentRef.current.of(buildSuggestingModeKeymap(shortcutsEnabled, onToggleSuggestingMode)),
        selectionCompartmentRef.current.of(buildNewCommentKeymap(shortcutsEnabled, onNewComment)),
        commentAnchorCompartmentRef.current.of(
          buildInlineCommentAnchorExtension({
            threads: commentThreads,
            onSelectComment,
          })
        ),
        suggestionsCompartmentRef.current.of(
          buildTrackChangesDecorationExtension({
            suggestions,
            onSelectSuggestion,
            onAcceptSuggestion,
            onRejectSuggestion,
          })
        ),
        findingsCompartmentRef.current.of(
          buildInlineFindingHighlightExtension({
            findings: activeReviewFindings,
            onSelectFinding,
            onApplyFix: onApplyFindingFix,
            onIgnoreFinding,
          })
        ),
        cursorsCompartmentRef.current.of(buildCursorAvatarsExtension({ presence: remotePresence })),
        escapeKeymapCompartmentRef.current.of(
          buildEscapeKeymap(shortcutsEnabled, collabMode, onExitSuggestingMode, followEnabled, onDetachFollow)
        ),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...lintKeymap]),
        history(),
        autocompletion({ override: [mentionCompleter] }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }

          if (update.selectionSet) {
            const selection = update.state.selection.main;
            const from = Math.min(selection.from, selection.to);
            const to = Math.max(selection.from, selection.to);
            const pos = clamp(selection.head, 0, update.state.doc.length);

            onCursorActivity?.({
              pos,
              selection: { from, to },
              action: update.docChanged ? 'typing' : 'cursor',
            });

            if (selection.empty) {
              onSelectionChange?.(null);
            } else {
              onSelectionChange?.({
                from,
                to,
                text: update.state.doc.sliceString(from, to),
              });
            }
          }
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '14px', backgroundColor: 'var(--bg-primary)' },
          '.cm-editor': { backgroundColor: 'var(--bg-primary)', color: 'var(--text-secondary)' },
          '.cm-scroller': { overflow: 'auto' },
          // Match markdown preview typography: use the app sans stack instead of mono.
          '.cm-content': { padding: '16px', fontFamily: 'var(--font-sans)', lineHeight: '1.6' },
          '.cm-line': { position: 'relative', paddingRight: '28px' },
          '.cm-gutters': { backgroundColor: 'var(--bg-secondary)', borderRight: '1px solid var(--border-primary)', color: 'var(--text-muted)' },
          '.cm-activeLine': { backgroundColor: 'rgb(26 26 26 / 0.7)' },
          '.cm-activeLineGutter': { backgroundColor: 'var(--bg-tertiary)' },
          '.cm-cursor': { borderLeftColor: 'var(--accent)' },
          '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
              backgroundColor: 'rgb(0 170 255 / 0.2)',
            },
            '.cm-authorship-range.cm-authorship-human': {
              backgroundColor: 'transparent',
            },
            '.cm-authorship-range.cm-authorship-ada': {
              backgroundColor: 'rgb(168 85 247 / 0.24)',
            },
            '.cm-authorship-range.cm-authorship-spock': {
              backgroundColor: 'rgb(59 130 246 / 0.22)',
            },
            '.cm-authorship-range.cm-authorship-scotty': {
              backgroundColor: 'rgb(34 197 94 / 0.22)',
            },
            '.cm-authorship-range.cm-authorship-reviewed': {
              boxShadow: 'inset 0 -1px 0 rgb(255 255 255 / 0.45)',
            },
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
    };
  }, []);

  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: [
        editableCompartmentRef.current.reconfigure(EditorView.editable.of(!readOnly)),
        readOnlyCompartmentRef.current.reconfigure(EditorState.readOnly.of(readOnly)),
      ],
    });
  }, [readOnly]);

  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: collabModeCompartmentRef.current.reconfigure(buildSuggestingModeExtension(collabMode, onSuggestingEdit)),
    });
  }, [collabMode, onSuggestingEdit]);

  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: authorshipCompartmentRef.current.reconfigure(buildAuthorshipDecorationsField(authorshipRanges)),
    });
  }, [authorshipRanges]);

  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: manualAttributionCompartmentRef.current.reconfigure(buildManualAttributionKeymap(onManualAttribution)),
    });
  }, [onManualAttribution]);

  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: suggestingKeymapCompartmentRef.current.reconfigure(
        buildSuggestingModeKeymap(shortcutsEnabled, onToggleSuggestingMode)
      ),
    });
  }, [onToggleSuggestingMode, shortcutsEnabled]);

  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: selectionCompartmentRef.current.reconfigure(buildNewCommentKeymap(shortcutsEnabled, onNewComment)),
    });
  }, [onNewComment, shortcutsEnabled]);

  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: escapeKeymapCompartmentRef.current.reconfigure(
        buildEscapeKeymap(shortcutsEnabled, collabMode, onExitSuggestingMode, followEnabled, onDetachFollow)
      ),
    });
  }, [collabMode, followEnabled, onDetachFollow, onExitSuggestingMode, shortcutsEnabled]);

  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: commentAnchorCompartmentRef.current.reconfigure(
        buildInlineCommentAnchorExtension({
          threads: commentThreads,
          onSelectComment,
        })
      ),
    });
  }, [commentThreads, onSelectComment]);

  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: suggestionsCompartmentRef.current.reconfigure(
        buildTrackChangesDecorationExtension({
          suggestions,
          onSelectSuggestion,
          onAcceptSuggestion,
          onRejectSuggestion,
        })
      ),
    });
  }, [onAcceptSuggestion, onRejectSuggestion, onSelectSuggestion, suggestions]);

  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: findingsCompartmentRef.current.reconfigure(
        buildInlineFindingHighlightExtension({
          findings: activeReviewFindings,
          onSelectFinding,
          onApplyFix: onApplyFindingFix,
          onIgnoreFinding,
        })
      ),
    });
  }, [activeReviewFindings, onApplyFindingFix, onIgnoreFinding, onSelectFinding]);

  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: cursorsCompartmentRef.current.reconfigure(buildCursorAvatarsExtension({ presence: remotePresence })),
    });
  }, [presenceAgeTick, remotePresence]);

  useEffect(() => {
    if (!remotePresence || remotePresence.length === 0) {
      return;
    }

    const nowMs = Date.now();
    let soonest: number | null = null;

    for (const entry of remotePresence) {
      const nextMs = msUntilPresenceToneChange(entry.last_activity_at ?? null, nowMs);
      if (nextMs === null) {
        continue;
      }
      soonest = soonest === null ? nextMs : Math.min(soonest, nextMs);
    }

    if (soonest === null) {
      return;
    }

    const timeoutId = window.setTimeout(() => setPresenceAgeTick((value) => value + 1), Math.max(250, soonest));
    return () => window.clearTimeout(timeoutId);
  }, [presenceAgeTick, remotePresence]);

  useEffect(() => {
    if (!viewRef.current) {
      return;
    }

    if (followScrollTimeoutRef.current !== null) {
      window.clearTimeout(followScrollTimeoutRef.current);
      followScrollTimeoutRef.current = null;
    }

    if (!followEnabled) {
      return;
    }

    const view = viewRef.current;
    const pos = resolveFollowPos(view, followCursor);
    if (pos === null) {
      return;
    }

    followScrollTimeoutRef.current = window.setTimeout(() => {
      if (!viewRef.current) {
        return;
      }

      const resolved = resolveFollowPos(viewRef.current, followCursor);
      if (resolved === null) {
        return;
      }

      smoothScrollToPos(viewRef.current, resolved);
    }, 0);

    return () => {
      if (followScrollTimeoutRef.current !== null) {
        window.clearTimeout(followScrollTimeoutRef.current);
        followScrollTimeoutRef.current = null;
      }
    };
  }, [followCursor, followEnabled]);

  // Update content when file changes
  useEffect(() => {
    if (viewRef.current && content !== viewRef.current.state.doc.toString()) {
      viewRef.current.dispatch({
        changes: { from: 0, to: viewRef.current.state.doc.length, insert: content }
      });
    }
  }, [content]);

  useEffect(() => {
    if (!viewRef.current) return;
    if (!focusRange) return;

    const from = Math.max(0, Math.min(viewRef.current.state.doc.length, Math.floor(focusRange.from)));
    const to = Math.max(0, Math.min(viewRef.current.state.doc.length, Math.floor(focusRange.to)));
    viewRef.current.dispatch({
      selection: EditorSelection.range(from, to),
      effects: EditorView.scrollIntoView(from, { y: 'center' }),
    });
    viewRef.current.focus();
  }, [focusRange]);

  return (
    <div
      ref={editorRef}
      className="h-full w-full"
      onMouseDown={() => {
        if (followEnabled) {
          onDetachFollow?.();
        }
      }}
    />
  );
}
