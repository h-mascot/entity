import { useEffect, useRef, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import Typography from '@tiptap/extension-typography';

// Re-export all the same types from CodeMirrorEditor for interface compat
export type {
  EditorSelectionRange,
  EditorAuthorshipRange,
  EditorSelectionSnapshot,
  EditorCursorActivity,
  EditorNewCommentRequest,
  EditorSuggestingEditRequest,
} from './CodeMirrorEditor';

import type {
  EditorAuthorshipRange,
  EditorCursorActivity,
  EditorNewCommentRequest,
  EditorSelectionRange,
  EditorSelectionSnapshot,
  EditorSuggestingEditRequest,
} from './CodeMirrorEditor';

import type { DocumentCommentThread, DocumentPresenceRecord, DocumentReviewFinding, DocumentSuggestionUiRecord } from '../types/collaboration';

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

/* ── Markdown ↔ HTML helpers (lightweight, no heavy deps) ── */

function markdownToHtml(md: string): string {
  if (!md) return '';
  let html = md;

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) =>
    `<pre><code>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headings
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  // Bold & italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');

  // Blockquotes
  html = html.replace(/^>\s+(.+)$/gm, '<blockquote><p>$1</p></blockquote>');

  // Unordered lists
  html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

  // Ordered lists
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr>');

  // Paragraphs: wrap remaining plain lines
  html = html.replace(/^(?!<[a-z/])(.*\S.*)$/gm, '<p>$1</p>');

  // Clean up empty paragraphs
  html = html.replace(/<p><\/p>/g, '');

  return html;
}

function htmlToMarkdown(html: string): string {
  if (!html) return '';
  let md = html;

  // Remove wrapper divs
  md = md.replace(/<div>/g, '').replace(/<\/div>/g, '\n');

  // Headings
  for (let i = 6; i >= 1; i--) {
    const re = new RegExp(`<h${i}[^>]*>(.*?)<\\/h${i}>`, 'gi');
    md = md.replace(re, `${'#'.repeat(i)} $1`);
  }

  // Bold, italic, underline, strikethrough
  md = md.replace(/<strong>(.*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b>(.*?)<\/b>/gi, '**$1**');
  md = md.replace(/<em>(.*?)<\/em>/gi, '*$1*');
  md = md.replace(/<i>(.*?)<\/i>/gi, '*$1*');
  md = md.replace(/<u>(.*?)<\/u>/gi, '$1');
  md = md.replace(/<s>(.*?)<\/s>/gi, '~~$1~~');
  md = md.replace(/<del>(.*?)<\/del>/gi, '~~$1~~');

  // Code blocks
  md = md.replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_m, code) =>
    '```\n' + code.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') + '```'
  );

  // Inline code
  md = md.replace(/<code>(.*?)<\/code>/gi, '`$1`');

  // Links
  md = md.replace(/<a[^>]+href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');

  // Blockquotes
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner) => {
    const text = inner.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1').trim();
    return text.split('\n').map((l: string) => `> ${l}`).join('\n');
  });

  // Lists
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_m, inner) => {
    return inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1').trim() + '\n';
  });
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m, inner) => {
    let idx = 0;
    return inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, () => {
      idx++;
      return `${idx}. `;
    }).trim() + '\n';
  });

  // Paragraphs
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n');

  // Horizontal rules
  md = md.replace(/<hr\s*\/?>/gi, '---');

  // Line breaks
  md = md.replace(/<br\s*\/?>/gi, '\n');

  // Strip remaining tags
  md = md.replace(/<[^>]+>/g, '');

  // Decode entities
  md = md.replace(/&amp;/g, '&');
  md = md.replace(/&lt;/g, '<');
  md = md.replace(/&gt;/g, '>');
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");
  md = md.replace(/&nbsp;/g, ' ');

  // Clean up excessive newlines
  md = md.replace(/\n{3,}/g, '\n\n');
  md = md.trim();

  return md;
}

/* ── Toolbar button ── */

function ToolbarButton({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      className={`rte-toolbar-btn ${active ? 'rte-toolbar-btn-active' : ''}`}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <span className="rte-toolbar-divider" />;
}

/* ── Main component ── */

export default function RichTextEditor({
  content,
  onChange,
  onSave,
  readOnly = false,
  // Collab props accepted but not wired to Tiptap internals
  shortcutsEnabled: _shortcutsEnabled,
  authorshipRanges: _authorshipRanges,
  onManualAttribution: _onManualAttribution,
  onSelectionChange: _onSelectionChange,
  onCursorActivity: _onCursorActivity,
  onNewComment: _onNewComment,
  commentThreads: _commentThreads,
  onSelectComment: _onSelectComment,
  suggestions: _suggestions,
  onSelectSuggestion: _onSelectSuggestion,
  onAcceptSuggestion: _onAcceptSuggestion,
  onRejectSuggestion: _onRejectSuggestion,
  reviewFindings: _reviewFindings,
  onSelectFinding: _onSelectFinding,
  onApplyFindingFix: _onApplyFindingFix,
  onIgnoreFinding: _onIgnoreFinding,
  remotePresence: _remotePresence,
  focusRange: _focusRange,
  followEnabled: _followEnabled,
  followCursor: _followCursor,
  onDetachFollow: _onDetachFollow,
  collabMode: _collabMode,
  onToggleSuggestingMode: _onToggleSuggestingMode,
  onExitSuggestingMode: _onExitSuggestingMode,
  onSuggestingEdit: _onSuggestingEdit,
}: EditorProps) {
  const contentRef = useRef(content);
  const isInternalUpdate = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: {
          HTMLAttributes: { class: 'rte-code-block' },
        },
      }),
      Placeholder.configure({
        placeholder: 'Start writing…',
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'rte-link' },
      }),
      Underline,
      Typography,
    ],
    content: markdownToHtml(content),
    editable: !readOnly,
    onUpdate: ({ editor: ed }: { editor: any }) => {
      isInternalUpdate.current = true;
      const md = htmlToMarkdown(ed.getHTML());
      contentRef.current = md;
      onChange(md);
    },
    editorProps: {
      attributes: {
        class: 'rte-content',
      },
      handleKeyDown: (_view: any, event: KeyboardEvent) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 's') {
          event.preventDefault();
          onSave?.();
          return true;
        }
        return false;
      },
    },
  });

  // Sync readOnly
  useEffect(() => {
    if (editor) editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  // Sync external content changes
  useEffect(() => {
    if (!editor) return;
    if (isInternalUpdate.current) {
      isInternalUpdate.current = false;
      return;
    }
    if (content !== contentRef.current) {
      contentRef.current = content;
      const html = markdownToHtml(content);
      editor.commands.setContent(html, { emitUpdate: false });
    }
  }, [editor, content]);

  const addLink = useCallback(() => {
    if (!editor) return;
    const prev = editor.getAttributes('link').href ?? '';
    const url = window.prompt('Link URL:', prev);
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="rte-wrapper">
      <BubbleMenu editor={editor} className="rte-bubble-menu">
        <ToolbarButton active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
          <strong>B</strong>
        </ToolbarButton>
        <ToolbarButton active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
          <em>I</em>
        </ToolbarButton>
        <ToolbarButton active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline">
          <span style={{ textDecoration: 'underline' }}>U</span>
        </ToolbarButton>
        <ToolbarButton active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">
          <s>S</s>
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1">
          H1
        </ToolbarButton>
        <ToolbarButton active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">
          H2
        </ToolbarButton>
        <ToolbarButton active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3">
          H3
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet List">
          •
        </ToolbarButton>
        <ToolbarButton active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Ordered List">
          1.
        </ToolbarButton>
        <ToolbarButton active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Blockquote">
          ❝
        </ToolbarButton>
        <ToolbarButton active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="Code Block">
          {'</>'}
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton active={editor.isActive('link')} onClick={addLink} title="Link">
          🔗
        </ToolbarButton>
      </BubbleMenu>
      <EditorContent editor={editor} className="rte-editor-content" />

      <style>{`
        .rte-wrapper {
          height: 100%;
          width: 100%;
          display: flex;
          flex-direction: column;
          background: var(--bg-primary);
          color: var(--text-secondary);
          font-family: var(--font-sans);
        }

        .rte-editor-content {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
        }

        .rte-editor-content .tiptap {
          padding: 2rem 2.5rem;
          min-height: 100%;
          outline: none;
          font-size: 15px;
          line-height: 1.7;
          word-wrap: break-word;
          overflow-wrap: break-word;
          white-space: pre-wrap;
        }

        .rte-editor-content .tiptap p {
          margin: 0.4em 0;
        }

        .rte-editor-content .tiptap h1 {
          font-size: 1.8em;
          font-weight: 600;
          margin: 1em 0 0.4em;
          color: var(--text-secondary);
        }

        .rte-editor-content .tiptap h2 {
          font-size: 1.4em;
          font-weight: 600;
          margin: 0.9em 0 0.3em;
          color: var(--text-secondary);
        }

        .rte-editor-content .tiptap h3 {
          font-size: 1.15em;
          font-weight: 600;
          margin: 0.8em 0 0.3em;
          color: var(--text-secondary);
        }

        .rte-editor-content .tiptap strong {
          font-weight: 700;
        }

        .rte-editor-content .tiptap a,
        .rte-editor-content .tiptap .rte-link {
          color: var(--accent);
          text-decoration: underline;
          text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent);
          cursor: pointer;
        }

        .rte-editor-content .tiptap blockquote {
          border-left: 3px solid var(--border-primary);
          margin: 0.8em 0;
          padding: 0.2em 0 0.2em 1em;
          color: var(--text-muted);
        }

        .rte-editor-content .tiptap code {
          background: var(--bg-tertiary);
          border-radius: 3px;
          padding: 0.15em 0.35em;
          font-size: 0.88em;
          font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
        }

        .rte-editor-content .tiptap pre {
          background: var(--bg-tertiary);
          border-radius: 6px;
          padding: 1em;
          margin: 0.8em 0;
          overflow-x: auto;
        }

        .rte-editor-content .tiptap pre code {
          background: none;
          padding: 0;
          border-radius: 0;
          font-size: 0.88em;
          color: var(--text-secondary);
        }

        .rte-editor-content .tiptap ul,
        .rte-editor-content .tiptap ol {
          padding-left: 1.5em;
          margin: 0.4em 0;
        }

        .rte-editor-content .tiptap li {
          margin: 0.15em 0;
        }

        .rte-editor-content .tiptap hr {
          border: none;
          border-top: 1px solid var(--border-primary);
          margin: 1.5em 0;
        }

        .rte-editor-content .tiptap p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: var(--text-muted);
          pointer-events: none;
          height: 0;
        }

        /* Bubble menu */
        .rte-bubble-menu {
          display: flex;
          align-items: center;
          gap: 2px;
          background: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          padding: 4px;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
        }

        .rte-toolbar-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border: none;
          border-radius: 4px;
          background: transparent;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 13px;
          font-family: var(--font-sans);
          transition: background 0.15s, color 0.15s;
        }

        .rte-toolbar-btn:hover {
          background: var(--bg-tertiary);
          color: var(--text-secondary);
        }

        .rte-toolbar-btn-active {
          background: var(--accent);
          color: #fff;
        }

        .rte-toolbar-btn-active:hover {
          background: var(--accent);
          color: #fff;
          opacity: 0.9;
        }

        .rte-toolbar-divider {
          width: 1px;
          height: 18px;
          background: var(--border-primary);
          margin: 0 3px;
        }

        /* Scrollbar */
        .rte-editor-content::-webkit-scrollbar {
          width: 6px;
        }
        .rte-editor-content::-webkit-scrollbar-track {
          background: transparent;
        }
        .rte-editor-content::-webkit-scrollbar-thumb {
          background: var(--border-primary);
          border-radius: 3px;
        }
      `}</style>
    </div>
  );
}
