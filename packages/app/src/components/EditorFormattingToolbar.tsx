import type { EditorView } from '@codemirror/view';

// Markdown formatting toolbar for CodeMirrorEditor. Receives a getter so the
// parent can render the toolbar before the editor view exists.

interface ToolbarProps {
  getView: () => EditorView | null;
}

/** Wrap the main selection with before/after markers. Empty selection puts the cursor between the markers. */
function wrapSelection(view: EditorView, before: string, after: string) {
  const range = view.state.selection.main;
  const from = Math.min(range.from, range.to);
  const to = Math.max(range.from, range.to);

  if (from === to) {
    view.dispatch({
      changes: { from, insert: before + after },
      selection: { anchor: from + before.length },
    });
  } else {
    const selected = view.state.doc.sliceString(from, to);
    view.dispatch({
      changes: { from, to, insert: before + selected + after },
      selection: { anchor: from + before.length, head: from + before.length + selected.length },
    });
  }
  view.focus();
}

const HEADING_PREFIX_RE = /^#{1,6}\s+/;
const LIST_PREFIX_RE = /^(-\s\[[ x]\]\s|[-*+]\s|\d+\.\s|>\s)/;

/** Replace any existing heading prefix on the cursor line(s) with the given one. */
function setHeading(view: EditorView, level: number) {
  const prefix = '#'.repeat(level) + ' ';
  applyLinePrefix(view, prefix, HEADING_PREFIX_RE);
}

/**
 * Toggle a line prefix across all lines intersecting the selection.
 * If every line already has the exact prefix, remove it; otherwise add it
 * (first stripping any prefix matched by stripRe, e.g. a different heading level).
 */
function applyLinePrefix(view: EditorView, prefix: string, stripRe: RegExp) {
  const range = view.state.selection.main;
  const startLine = view.state.doc.lineAt(Math.min(range.from, range.to));
  const endLine = view.state.doc.lineAt(Math.max(range.from, range.to));

  const lines: { from: number; text: string }[] = [];
  for (let n = startLine.number; n <= endLine.number; n++) {
    const line = view.state.doc.line(n);
    lines.push({ from: line.from, text: line.text });
  }

  const allHavePrefix = lines.every((line) => line.text.startsWith(prefix));
  const changes = lines.map((line) => {
    if (allHavePrefix) {
      return { from: line.from, to: line.from + prefix.length, insert: '' };
    }
    const existing = line.text.match(stripRe)?.[0] ?? '';
    return { from: line.from, to: line.from + existing.length, insert: prefix };
  });

  view.dispatch({ changes });
  view.focus();
}

/** Insert a snippet at the cursor (replacing the selection) and place the cursor at from + cursorOffset. */
function insertSnippet(view: EditorView, snippet: string, cursorOffset?: number) {
  const range = view.state.selection.main;
  const from = Math.min(range.from, range.to);
  const to = Math.max(range.from, range.to);
  view.dispatch({
    changes: { from, to, insert: snippet },
    selection: { anchor: from + (cursorOffset ?? snippet.length) },
  });
  view.focus();
}

function insertLink(view: EditorView) {
  const range = view.state.selection.main;
  const from = Math.min(range.from, range.to);
  const to = Math.max(range.from, range.to);
  const text = from === to ? 'text' : view.state.doc.sliceString(from, to);
  const insert = `[${text}](url)`;
  const urlStart = from + 1 + text.length + 2;
  view.dispatch({
    changes: { from, to, insert },
    // Select the placeholder url so the user can type over it.
    selection: { anchor: urlStart, head: urlStart + 3 },
  });
  view.focus();
}

function insertCodeBlock(view: EditorView) {
  const range = view.state.selection.main;
  const from = Math.min(range.from, range.to);
  const to = Math.max(range.from, range.to);
  const selected = view.state.doc.sliceString(from, to);
  const insert = '```\n' + selected + '\n```';
  view.dispatch({
    changes: { from, to, insert },
    selection:
      from === to
        ? { anchor: from + 4 }
        : { anchor: from + 4, head: from + 4 + selected.length },
  });
  view.focus();
}

const TABLE_SNIPPET =
  '\n| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |\n| Cell | Cell |\n';

interface ToolbarAction {
  label: string;
  title: string;
  run: (view: EditorView) => void;
}

const GROUPS: ToolbarAction[][] = [
  [
    { label: 'B', title: 'Bold', run: (v) => wrapSelection(v, '**', '**') },
    { label: 'I', title: 'Italic', run: (v) => wrapSelection(v, '*', '*') },
    { label: 'S̶', title: 'Strikethrough', run: (v) => wrapSelection(v, '~~', '~~') },
    { label: '</>', title: 'Inline code', run: (v) => wrapSelection(v, '`', '`') },
  ],
  [
    { label: 'H1', title: 'Heading 1', run: (v) => setHeading(v, 1) },
    { label: 'H2', title: 'Heading 2', run: (v) => setHeading(v, 2) },
    { label: 'H3', title: 'Heading 3', run: (v) => setHeading(v, 3) },
  ],
  [
    { label: '•', title: 'Bulleted list', run: (v) => applyLinePrefix(v, '- ', LIST_PREFIX_RE) },
    { label: '1.', title: 'Numbered list', run: (v) => applyLinePrefix(v, '1. ', LIST_PREFIX_RE) },
    { label: '☑', title: 'Checklist', run: (v) => applyLinePrefix(v, '- [ ] ', LIST_PREFIX_RE) },
    { label: '❝', title: 'Quote', run: (v) => applyLinePrefix(v, '> ', LIST_PREFIX_RE) },
  ],
  [
    { label: '🔗', title: 'Link', run: insertLink },
    { label: '🖼', title: 'Image', run: (v) => insertSnippet(v, '![alt](url)', 7) },
    { label: '▦', title: 'Table', run: (v) => insertSnippet(v, TABLE_SNIPPET) },
    { label: '```', title: 'Code block', run: insertCodeBlock },
    { label: '―', title: 'Horizontal rule', run: (v) => insertSnippet(v, '\n---\n') },
  ],
];

export default function EditorFormattingToolbar({ getView }: ToolbarProps) {
  const handle = (action: ToolbarAction) => {
    const view = getView();
    if (!view) return;
    action.run(view);
  };

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1">
      {GROUPS.map((group, groupIndex) => (
        <div key={groupIndex} className="flex items-center gap-1">
          {groupIndex > 0 && <span className="mx-1 h-4 w-px bg-[var(--border-secondary)]" />}
          {group.map((action) => (
            <button
              key={action.title}
              type="button"
              className="mc-shell-btn px-2 py-1 text-xs"
              title={action.title}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => handle(action)}
            >
              {action.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
