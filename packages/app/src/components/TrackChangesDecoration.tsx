import { EditorState, RangeSetBuilder, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { DocumentSuggestionUiRecord } from '../types/collaboration';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

class SuggestionWidget extends WidgetType {
  private readonly suggestion: DocumentSuggestionUiRecord;
  private readonly showControls: boolean;

  constructor(suggestion: DocumentSuggestionUiRecord, showControls: boolean) {
    super();
    this.suggestion = suggestion;
    this.showControls = showControls;
  }

  toDOM(): HTMLElement {
    const container = document.createElement('span');
    container.className = `cm-suggestion-widget cm-suggestion-${this.suggestion.type}`;
    if (this.suggestion.status !== 'pending') {
      container.classList.add('cm-suggestion-resolved');
    }
    container.dataset.suggestionId = this.suggestion.id;
    container.title = `${this.suggestion.author} · ${this.suggestion.status}`;

    const text = document.createElement('span');
    text.className = 'cm-suggestion-text';
    const displayText = this.suggestion.type === 'delete' && !this.suggestion.suggestedText ? 'delete' : this.suggestion.suggestedText;
    text.textContent = displayText;
    container.appendChild(text);

    if (this.showControls && this.suggestion.status === 'pending') {
      const controls = document.createElement('span');
      controls.className = 'cm-suggestion-controls';

      const rejectBtn = document.createElement('button');
      rejectBtn.type = 'button';
      rejectBtn.className = 'cm-suggestion-btn cm-suggestion-btn-reject';
      rejectBtn.dataset.suggestionAction = 'reject';
      rejectBtn.setAttribute('aria-label', 'Reject suggestion');
      rejectBtn.textContent = 'Reject';

      const acceptBtn = document.createElement('button');
      acceptBtn.type = 'button';
      acceptBtn.className = 'cm-suggestion-btn cm-suggestion-btn-accept';
      acceptBtn.dataset.suggestionAction = 'accept';
      acceptBtn.setAttribute('aria-label', 'Accept suggestion');
      acceptBtn.textContent = 'Accept';

      controls.appendChild(rejectBtn);
      controls.appendChild(acceptBtn);
      container.appendChild(controls);
    }

    return container;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function buildSuggestionDecorationSet(
  documentLength: number,
  suggestions: readonly DocumentSuggestionUiRecord[],
  showControls: boolean
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  for (const suggestion of suggestions) {
    const start = clamp(Math.floor(suggestion.range.from), 0, documentLength);
    const end = clamp(Math.floor(suggestion.range.to), 0, documentLength);
    const from = Math.min(start, end);
    const to = Math.max(start, end);
    const resolved = suggestion.status !== 'pending';

    if (suggestion.type === 'insert') {
      builder.add(
        from,
        from,
        Decoration.widget({
          widget: new SuggestionWidget(suggestion, showControls),
          side: 1,
        })
      );
      continue;
    }

    if (suggestion.type === 'delete') {
      if (to > from) {
        builder.add(
          from,
          to,
          Decoration.mark({
            class: `cm-suggestion-mark cm-suggestion-delete ${resolved ? 'cm-suggestion-resolved' : ''}`,
            attributes: { 'data-suggestion-id': suggestion.id },
          })
        );
      }
      builder.add(
        to,
        to,
        Decoration.widget({
          widget: new SuggestionWidget(suggestion, showControls),
          side: 1,
        })
      );
      continue;
    }

    // replace
    if (to > from) {
      builder.add(
        from,
        to,
        Decoration.mark({
          class: `cm-suggestion-mark cm-suggestion-replace ${resolved ? 'cm-suggestion-resolved' : ''}`,
          attributes: { 'data-suggestion-id': suggestion.id },
        })
      );
    }
    builder.add(
      from,
      from,
      Decoration.widget({
        widget: new SuggestionWidget(suggestion, showControls),
        side: 1,
      })
    );
  }

  return builder.finish();
}

export interface TrackChangesDecorationOptions {
  suggestions: readonly DocumentSuggestionUiRecord[];
  onSelectSuggestion?: (suggestionId: string) => void;
  onAcceptSuggestion?: (suggestionId: string) => void;
  onRejectSuggestion?: (suggestionId: string) => void;
}

export function buildTrackChangesDecorationExtension(options: TrackChangesDecorationOptions): Extension {
  const suggestions = options.suggestions ?? [];
  const showControls = Boolean(options.onAcceptSuggestion || options.onRejectSuggestion);

  const field = StateField.define<DecorationSet>({
    create(state) {
      return buildSuggestionDecorationSet(state.doc.length, suggestions, showControls);
    },
    update(decorations, transaction) {
      if (!transaction.docChanged) {
        return decorations;
      }
      return buildSuggestionDecorationSet(transaction.state.doc.length, suggestions, showControls);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });

  const clickHandler = EditorView.domEventHandlers({
    mousedown: (event, view) => {
      const target = event.target as HTMLElement | null;

      const actionEl = target?.closest?.('[data-suggestion-action]') as HTMLElement | null;
      if (actionEl) {
        const action = actionEl.dataset.suggestionAction;
        const suggestionEl = actionEl.closest('.cm-suggestion-widget') as HTMLElement | null;
        const suggestionId = suggestionEl?.dataset?.suggestionId;
        if (!suggestionId) {
          return false;
        }

        event.preventDefault();
        event.stopPropagation();
        options.onSelectSuggestion?.(suggestionId);
        if (action === 'accept') {
          options.onAcceptSuggestion?.(suggestionId);
        } else if (action === 'reject') {
          options.onRejectSuggestion?.(suggestionId);
        }
        view.focus();
        return true;
      }

      const el =
        (target?.closest?.('[data-suggestion-id]') as HTMLElement | null) ??
        (target?.closest?.('.cm-suggestion-widget') as HTMLElement | null);
      const suggestionId = el?.dataset?.suggestionId;
      if (!suggestionId) {
        return false;
      }

      event.preventDefault();
      options.onSelectSuggestion?.(suggestionId);
      view.focus();
      return true;
    },
  });

  return [field, clickHandler];
}
