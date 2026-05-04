import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, showTooltip, type DecorationSet, type Tooltip } from '@codemirror/view';
import type { DocumentReviewFinding } from '../types/collaboration';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildFindingDecorationSet(documentLength: number, findings: readonly DocumentReviewFinding[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  for (const finding of findings) {
    if (finding.status === 'ignored') {
      continue;
    }
    if (!finding.range) {
      continue;
    }

    const start = clamp(Math.floor(finding.range.from), 0, documentLength);
    const end = clamp(Math.floor(finding.range.to), 0, documentLength);
    let from = Math.min(start, end);
    let to = Math.max(start, end);
    if (to <= from) {
      if (documentLength === 0) {
        continue;
      }
      // Some findings can be point-based (empty ranges). Expand them to a single character span when possible.
      if (from >= documentLength) {
        from = Math.max(0, documentLength - 1);
        to = documentLength;
      } else {
        to = Math.min(documentLength, from + 1);
      }
      if (to <= from) {
        continue;
      }
    }

    const severityClass = finding.severity === 'info' ? '' : ` cm-finding-${finding.severity}`;

    builder.add(
      from,
      to,
      Decoration.mark({
        class: `cm-finding${severityClass}`,
        attributes: {
          'data-finding-id': finding.id,
          title: finding.message,
        },
      })
    );
  }

  return builder.finish();
}

export interface InlineFindingHighlightOptions {
  findings: readonly DocumentReviewFinding[];
  onSelectFinding?: (findingId: string) => void;
  onApplyFix?: (findingId: string) => void;
  onIgnoreFinding?: (findingId: string) => void;
}

export function buildInlineFindingHighlightExtension(options: InlineFindingHighlightOptions): Extension {
  const findings = options.findings ?? [];
  const setTooltipEffect = StateEffect.define<{ findingId: string; pos: number } | null>();

  const tooltipField = StateField.define<Tooltip | null>({
    create() {
      return null;
    },
    update(value, transaction) {
      for (const effect of transaction.effects) {
        if (!effect.is(setTooltipEffect)) {
          continue;
        }

        const next = effect.value;
        if (!next) {
          return null;
        }

        const finding = findings.find((entry) => entry.id === next.findingId) ?? null;
        if (!finding) {
          return null;
        }

        return {
          pos: clamp(next.pos, 0, transaction.state.doc.length),
          above: true,
          strictSide: true,
          create(view) {
            const root = document.createElement('div');
            root.className = 'mc-shell-card';
            root.dataset.findingTooltip = next.findingId;
            root.style.padding = '10px 12px';
            root.style.maxWidth = '360px';
            root.style.boxShadow = '0 18px 50px rgb(0 0 0 / 0.55)';

            // Keep the tooltip interactive without also triggering editor click handlers.
            root.addEventListener('mousedown', (event) => {
              event.stopPropagation();
            });

            const header = document.createElement('div');
            header.style.display = 'flex';
            header.style.alignItems = 'center';
            header.style.justifyContent = 'space-between';
            header.style.gap = '10px';

            const label = document.createElement('div');
            label.style.fontSize = '10px';
            label.style.fontWeight = '600';
            label.style.letterSpacing = '0.08em';
            label.style.textTransform = 'uppercase';
            label.style.color = 'var(--text-muted)';
            label.textContent = finding.severity.toUpperCase();

            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.className = 'mc-shell-btn';
            closeBtn.style.padding = '4px 8px';
            closeBtn.style.fontSize = '11px';
            closeBtn.textContent = 'Close';
            closeBtn.title = 'Dismiss tooltip';
            closeBtn.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              view.dispatch({ effects: setTooltipEffect.of(null) });
              view.focus();
            });

            header.append(label, closeBtn);

            const message = document.createElement('div');
            message.style.marginTop = '8px';
            message.style.fontSize = '13px';
            message.style.color = 'var(--text-secondary)';
            message.textContent = finding.message;

            const actions = document.createElement('div');
            actions.style.marginTop = '12px';
            actions.style.display = 'flex';
            actions.style.alignItems = 'center';
            actions.style.justifyContent = 'flex-end';
            actions.style.gap = '8px';
            actions.style.borderTop = '1px solid var(--border-primary)';
            actions.style.paddingTop = '12px';

            const ignoreBtn = document.createElement('button');
            ignoreBtn.type = 'button';
            ignoreBtn.className = 'mc-shell-btn';
            ignoreBtn.style.padding = '4px 10px';
            ignoreBtn.style.fontSize = '12px';
            ignoreBtn.textContent = 'Ignore';

            const canIgnore = Boolean(options.onIgnoreFinding) && finding.status !== 'ignored';
            if (!canIgnore) {
              ignoreBtn.disabled = true;
              ignoreBtn.style.opacity = '0.4';
              ignoreBtn.style.cursor = 'not-allowed';
            }

            ignoreBtn.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!canIgnore) {
                return;
              }
              options.onIgnoreFinding?.(finding.id);
              view.dispatch({ effects: setTooltipEffect.of(null) });
              view.focus();
            });

            const fixBtn = document.createElement('button');
            fixBtn.type = 'button';
            fixBtn.className = 'mc-shell-btn mc-shell-btn-active';
            fixBtn.style.padding = '4px 10px';
            fixBtn.style.fontSize = '12px';
            fixBtn.style.fontWeight = '600';
            fixBtn.textContent = 'Fix';

            const canFix = Boolean(options.onApplyFix) && Boolean(finding.suggestedFix?.replacement) && finding.status !== 'applied';
            if (!canFix) {
              fixBtn.disabled = true;
              fixBtn.style.opacity = '0.4';
              fixBtn.style.cursor = 'not-allowed';
            }

            fixBtn.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!canFix) {
                return;
              }

              options.onApplyFix?.(finding.id);
              view.dispatch({ effects: setTooltipEffect.of(null) });
              view.focus();
            });

            actions.append(ignoreBtn, fixBtn);

            root.append(header, message, actions);
            return { dom: root };
          },
        };
      }

      if (transaction.docChanged) {
        return null;
      }

      return value;
    },
    provide(field) {
      return showTooltip.from(field);
    },
  });

  const field = StateField.define<DecorationSet>({
    create(state) {
      return buildFindingDecorationSet(state.doc.length, findings);
    },
    update(decorations, transaction) {
      if (!transaction.docChanged) {
        return decorations;
      }
      return buildFindingDecorationSet(transaction.state.doc.length, findings);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });

  const clickHandler = EditorView.domEventHandlers({
    mousedown: (event, view) => {
      const target = event.target as HTMLElement | null;
      const tooltipEl = target?.closest?.('[data-finding-tooltip]') as HTMLElement | null;
      if (tooltipEl) {
        return false;
      }

      const el = target?.closest?.('[data-finding-id]') as HTMLElement | null;
      const findingId = el?.dataset?.findingId;
      if (!findingId) {
        view.dispatch({ effects: setTooltipEffect.of(null) });
        return false;
      }

      event.preventDefault();
      options.onSelectFinding?.(findingId);
      const finding = findings.find((entry) => entry.id === findingId) ?? null;
      const pos = finding?.range ? clamp(Math.floor(finding.range.from), 0, view.state.doc.length) : null;
      if (typeof pos === 'number') {
        view.dispatch({ effects: setTooltipEffect.of({ findingId, pos }) });
      }
      view.focus();
      return true;
    },
  });

  return [field, tooltipField, clickHandler];
}
