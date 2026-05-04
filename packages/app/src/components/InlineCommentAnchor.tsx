import { EditorState, RangeSetBuilder, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { DocumentCommentThread } from '../types/collaboration';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

class CommentMarkerWidget extends WidgetType {
  private readonly commentId: string;
  private readonly title: string;
  private readonly resolved: boolean;

  constructor(commentId: string, title: string, resolved: boolean) {
    super();
    this.commentId = commentId;
    this.title = title;
    this.resolved = resolved;
  }

  toDOM(): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `cm-comment-marker${this.resolved ? ' cm-comment-marker-resolved' : ''}`;
    button.dataset.commentId = this.commentId;
    button.title = this.title;
    button.textContent = '●';
    button.setAttribute('aria-label', 'Open comment thread');
    return button;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function normalizePreview(value: string, max = 120): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`;
}

export interface InlineCommentAnchorOptions {
  threads: readonly DocumentCommentThread[];
  onSelectComment?: (commentId: string) => void;
}

function buildCommentMarkerDecorationSet(state: EditorState, threads: readonly DocumentCommentThread[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const usedLines = new Set<number>();

  for (const thread of threads) {
    const from = clamp(Math.floor(thread.range.from), 0, state.doc.length);
    const line = state.doc.lineAt(from);
    if (usedLines.has(line.from)) {
      continue;
    }
    usedLines.add(line.from);

    const title = `${thread.author} · ${normalizePreview(thread.text)}`;
    builder.add(
      line.to,
      line.to,
      Decoration.widget({
        widget: new CommentMarkerWidget(thread.id, title, thread.resolved),
        side: 1,
      })
    );
  }

  return builder.finish();
}

export function buildInlineCommentAnchorExtension(options: InlineCommentAnchorOptions): Extension {
  const threads = options.threads ?? [];
  if (threads.length === 0) {
    return [];
  }

  const field = StateField.define<DecorationSet>({
    create(state) {
      return buildCommentMarkerDecorationSet(state, threads);
    },
    update(decorations, transaction) {
      if (!transaction.docChanged) {
        return decorations;
      }
      return buildCommentMarkerDecorationSet(transaction.state, threads);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });

  const clickHandler = EditorView.domEventHandlers({
    mousedown: (event, view) => {
      const target = event.target as HTMLElement | null;
      const el = target?.closest?.('.cm-comment-marker') as HTMLElement | null;
      const commentId = el?.dataset?.commentId;
      if (!commentId) {
        return false;
      }

      event.preventDefault();
      event.stopPropagation();
      options.onSelectComment?.(commentId);
      view.focus();
      return true;
    },
  });

  return [field, clickHandler];
}
