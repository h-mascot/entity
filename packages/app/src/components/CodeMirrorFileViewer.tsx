import { useEffect, useMemo, useRef, useState } from 'react';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { EditorView, highlightActiveLineGutter, lineNumbers } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { markdown } from '@codemirror/lang-markdown';
import { tags as t } from '@lezer/highlight';
import {
  createStaticHtmlPreviewUrl,
  htmlPreviewSandboxForSource,
  isStaticHtmlPreviewSource,
} from '../lib/htmlPreviewPolicy';

interface CodeMirrorFileViewerProps {
  content: string;
  filePath: string;
  sourceId?: string | null;
  contentType?: string | null;
  fileSize?: number | null;
  isBinary?: boolean;
  rawFileUrl?: string | null;
}

type PreviewKind = 'text' | 'html' | 'image' | 'audio' | 'video' | 'pdf' | 'table' | 'binary';

type LanguageKey =
  | 'markdown'
  | 'typescript'
  | 'tsx'
  | 'javascript'
  | 'jsx'
  | 'json'
  | 'python'
  | 'shell'
  | 'css'
  | 'scss'
  | 'html'
  | 'xml'
  | 'yaml'
  | 'toml'
  | 'sql'
  | 'go'
  | 'rust'
  | 'env'
  | 'conf'
  | 'plaintext';

interface SimpleWordState {
  inBlockComment: boolean;
  inString: '"' | "'" | '`' | null;
}

interface SimpleWordLanguageConfig {
  name: string;
  keywords?: readonly string[];
  atoms?: readonly string[];
  lineComment?: string;
  blockCommentStart?: string;
  blockCommentEnd?: string;
  allowDollarVariables?: boolean;
}

const viewerTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      color: 'var(--text-primary)',
      backgroundColor: 'var(--card-bg)',
    },
    '.cm-scroller': {
      height: '100%',
      overflow: 'auto',
      fontFamily: '"JetBrains Mono", "Fira Code", var(--font-mono), monospace',
      lineHeight: '1.6',
    },
    '.cm-content': {
      minHeight: '100%',
      padding: '14px 0',
    },
    '.cm-line': {
      padding: '0 16px',
    },
    '.cm-gutters': {
      minHeight: '100%',
      borderRight: '1px solid var(--border-primary)',
      backgroundColor: 'var(--bg-tertiary)',
      color: 'var(--text-muted)',
      fontFamily: '"JetBrains Mono", "Fira Code", var(--font-mono), monospace',
    },
    '.cm-gutterElement': {
      padding: '0 10px 0 12px',
    },
    '.cm-activeLine': {
      backgroundColor: 'var(--surface-muted)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--bg-secondary)',
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'var(--surface-accent-strong)',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--accent)',
    },
    '.cm-focused': {
      outline: 'none',
    },
  },
  { dark: false }
);

const viewerHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.modifier], color: 'var(--accent)' },
  { tag: [t.atom, t.bool], color: 'var(--success)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--text-primary)' },
  { tag: [t.number, t.integer, t.float], color: 'var(--accent-dim)' },
  { tag: [t.comment], color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: [t.variableName, t.propertyName], color: 'var(--text-secondary)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--text-primary)' },
  { tag: [t.operator, t.punctuation, t.separator], color: 'var(--text-secondary)' },
  { tag: [t.definition(t.variableName), t.definitionKeyword], color: 'var(--accent)' },
  { tag: [t.typeName, t.className], color: 'var(--accent)' },
  { tag: [t.invalid], color: 'var(--error)' },
]);

function createSimpleWordLanguage(config: SimpleWordLanguageConfig): Extension {
  const keywords = new Set((config.keywords ?? []).map((value) => value.toLowerCase()));
  const atoms = new Set((config.atoms ?? []).map((value) => value.toLowerCase()));

  return StreamLanguage.define<SimpleWordState>({
    name: config.name,
    startState() {
      return { inBlockComment: false, inString: null };
    },
    token(stream, state) {
      if (state.inBlockComment) {
        if (config.blockCommentEnd && stream.skipTo(config.blockCommentEnd)) {
          stream.match(config.blockCommentEnd);
          state.inBlockComment = false;
        } else {
          stream.skipToEnd();
        }
        return 'comment';
      }

      if (state.inString) {
        let escaped = false;
        while (!stream.eol()) {
          const ch = stream.next();
          if (!ch) {
            break;
          }
          if (ch === state.inString && !escaped) {
            state.inString = null;
            break;
          }
          escaped = ch === '\\' ? !escaped : false;
        }

        if (stream.eol() && state.inString !== '`') {
          state.inString = null;
        }
        return 'string';
      }

      if (stream.eatSpace()) {
        return null;
      }

      if (config.lineComment && stream.match(config.lineComment)) {
        stream.skipToEnd();
        return 'comment';
      }

      if (config.blockCommentStart && stream.match(config.blockCommentStart)) {
        state.inBlockComment = true;
        return 'comment';
      }

      if (config.allowDollarVariables && stream.match(/\$[A-Za-z_][\w]*/)) {
        return 'variableName';
      }

      const quote = stream.peek();
      if (quote === '"' || quote === "'" || quote === '`') {
        stream.next();
        state.inString = quote;
        return 'string';
      }

      if (stream.match(/[+-]?(?:0x[0-9A-Fa-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/)) {
        return 'number';
      }

      if (stream.match(/[A-Za-z_][\w-]*/)) {
        const word = stream.current().toLowerCase();
        if (keywords.has(word)) {
          return 'keyword';
        }
        if (atoms.has(word)) {
          return 'atom';
        }
        return 'variableName';
      }

      if (stream.match(/[()[\]{}.,;:]/)) {
        return 'punctuation';
      }

      if (stream.match(/[+\-*/%=<>!&|^~]+/)) {
        return 'operator';
      }

      stream.next();
      return null;
    },
  });
}

const shellLanguage = createSimpleWordLanguage({
  name: 'entity-shell',
  keywords: ['if', 'then', 'else', 'fi', 'for', 'in', 'do', 'done', 'case', 'esac', 'while', 'until', 'function', 'select'],
  atoms: ['true', 'false', 'null'],
  lineComment: '#',
  allowDollarVariables: true,
});

const pythonLanguage = createSimpleWordLanguage({
  name: 'entity-python',
  keywords: [
    'def', 'class', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally', 'with', 'as', 'import', 'from', 'return',
    'yield', 'pass', 'break', 'continue', 'lambda', 'global', 'nonlocal', 'assert', 'raise', 'async', 'await',
  ],
  atoms: ['true', 'false', 'none'],
  lineComment: '#',
});

const yamlLanguage = createSimpleWordLanguage({
  name: 'entity-yaml',
  keywords: ['-', '?'],
  atoms: ['true', 'false', 'null', 'yes', 'no', 'on', 'off'],
  lineComment: '#',
});

const tomlLanguage = createSimpleWordLanguage({
  name: 'entity-toml',
  atoms: ['true', 'false'],
  lineComment: '#',
});

const sqlLanguage = createSimpleWordLanguage({
  name: 'entity-sql',
  keywords: [
    'select', 'from', 'where', 'join', 'left', 'right', 'inner', 'outer', 'group', 'by', 'order', 'limit', 'offset', 'insert',
    'into', 'values', 'update', 'set', 'delete', 'create', 'alter', 'drop', 'table', 'view', 'index', 'on', 'as', 'and', 'or', 'not',
    'having', 'distinct', 'union', 'all', 'case', 'when', 'then', 'else', 'end',
  ],
  atoms: ['null', 'true', 'false'],
  lineComment: '--',
  blockCommentStart: '/*',
  blockCommentEnd: '*/',
});

const goLanguage = createSimpleWordLanguage({
  name: 'entity-go',
  keywords: [
    'package', 'import', 'func', 'type', 'struct', 'interface', 'if', 'else', 'switch', 'case', 'default', 'for', 'range',
    'go', 'defer', 'return', 'break', 'continue', 'fallthrough', 'const', 'var', 'map', 'chan', 'select',
  ],
  atoms: ['true', 'false', 'nil'],
  lineComment: '//',
  blockCommentStart: '/*',
  blockCommentEnd: '*/',
});

const rustLanguage = createSimpleWordLanguage({
  name: 'entity-rust',
  keywords: [
    'fn', 'let', 'mut', 'pub', 'impl', 'trait', 'struct', 'enum', 'match', 'if', 'else', 'loop', 'while', 'for', 'in',
    'use', 'mod', 'crate', 'super', 'self', 'where', 'return', 'break', 'continue', 'async', 'await',
  ],
  atoms: ['true', 'false', 'none'],
  lineComment: '//',
  blockCommentStart: '/*',
  blockCommentEnd: '*/',
});

const envLanguage = StreamLanguage.define<{ inString: '"' | "'" | null }>({
  name: 'entity-env',
  startState() {
    return { inString: null };
  },
  token(stream, state) {
    if (state.inString) {
      let escaped = false;
      while (!stream.eol()) {
        const ch = stream.next();
        if (!ch) break;
        if (ch === state.inString && !escaped) {
          state.inString = null;
          break;
        }
        escaped = ch === '\\' ? !escaped : false;
      }
      if (stream.eol()) {
        state.inString = null;
      }
      return 'string';
    }

    if (stream.eatSpace()) {
      return null;
    }

    if (stream.match('#')) {
      stream.skipToEnd();
      return 'comment';
    }

    if (stream.match(/export\b/)) {
      return 'keyword';
    }

    if (stream.match(/[A-Za-z_][A-Za-z0-9_.-]*/)) {
      if (stream.match(/\s*=/, false)) {
        return 'definitionKeyword';
      }
      return 'variableName';
    }

    if (stream.match('=')) {
      return 'operator';
    }

    if (stream.match(/\$[A-Za-z_][A-Za-z0-9_]*/)) {
      return 'variableName';
    }

    const quote = stream.peek();
    if (quote === '"' || quote === "'") {
      stream.next();
      state.inString = quote;
      return 'string';
    }

    if (stream.match(/[+-]?(?:\d+(?:\.\d+)?)/)) {
      return 'number';
    }

    stream.next();
    return null;
  },
});

const HTML_EXTENSIONS = new Set(['html', 'htm', 'xhtml']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif', 'tiff', 'tif']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'weba']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv']);
const TABLE_EXTENSIONS = new Set(['csv', 'tsv']);
const TABLE_CONTENT_TYPES = new Set(['text/csv', 'text/tab-separated-values', 'text/tsv']);
const MAX_TABLE_ROWS = 1000;

interface ParsedTable {
  rows: string[][];
  truncated: boolean;
}

function delimiterFor(filePath: string, contentType: string): string {
  if (contentType === 'text/tab-separated-values' || contentType === 'text/tsv') {
    return '\t';
  }
  return extensionFromPath(filePath) === 'tsv' ? '\t' : ',';
}

function parseDelimitedTable(content: string, delimiter: string): ParsedTable | null {
  const rows: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let truncated = false;

  const pushField = () => {
    record.push(field);
    field = '';
  };

  const pushRecord = () => {
    pushField();
    rows.push(record);
    record = [];
  };

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];

    if (inQuotes) {
      if (char === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.length === 0) {
      inQuotes = true;
      continue;
    }

    if (char === delimiter) {
      pushField();
      continue;
    }

    if (char === '\n' || char === '\r') {
      if (char === '\r' && content[index + 1] === '\n') {
        index += 1;
      }
      pushRecord();
      if (rows.length >= MAX_TABLE_ROWS) {
        truncated = index < content.length - 1;
        break;
      }
      continue;
    }

    field += char;
  }

  if (inQuotes) {
    return null;
  }

  if (field.length > 0 || record.length > 0) {
    pushRecord();
  }

  const dataRows = rows.filter((row) => !(row.length === 1 && row[0] === ''));
  if (dataRows.length === 0) {
    return null;
  }

  return { rows: dataRows, truncated };
}

function normalizeDetectedContentType(contentType: string | null | undefined): string {
  if (typeof contentType !== 'string') {
    return '';
  }

  return contentType
    .split(';')[0]
    ?.trim()
    .toLowerCase() ?? '';
}

function extensionFromPath(filePath: string): string {
  const filename = filePath.split('/').pop() ?? filePath;
  const parts = filename.toLowerCase().split('.');
  if (parts.length < 2) {
    return '';
  }
  return parts[parts.length - 1] ?? '';
}

function isTextualContentType(contentType: string): boolean {
  if (!contentType) {
    return false;
  }

  if (contentType.startsWith('text/')) {
    return true;
  }

  if (contentType.endsWith('+json') || contentType.endsWith('+xml')) {
    return true;
  }

  return (
    contentType === 'application/json' ||
    contentType === 'application/xml' ||
    contentType === 'application/javascript' ||
    contentType === 'application/typescript' ||
    contentType === 'application/sql' ||
    contentType === 'application/yaml' ||
    contentType === 'application/toml' ||
    contentType === 'application/x-sh' ||
    contentType === 'image/svg+xml'
  );
}

function resolvePreviewKind(filePath: string, contentType: string | null | undefined, isBinary: boolean | undefined): PreviewKind {
  const normalizedType = normalizeDetectedContentType(contentType);
  const extension = extensionFromPath(filePath);

  if (normalizedType === 'text/html' || normalizedType === 'application/xhtml+xml' || HTML_EXTENSIONS.has(extension)) {
    return 'html';
  }

  if (normalizedType.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) {
    return 'image';
  }

  if (normalizedType === 'application/pdf' || extension === 'pdf') {
    return 'pdf';
  }

  if (TABLE_CONTENT_TYPES.has(normalizedType) || TABLE_EXTENSIONS.has(extension)) {
    return 'table';
  }

  if (normalizedType.startsWith('audio/') || AUDIO_EXTENSIONS.has(extension)) {
    return 'audio';
  }

  if (normalizedType.startsWith('video/') || VIDEO_EXTENSIONS.has(extension)) {
    return 'video';
  }

  const binaryFlag = typeof isBinary === 'boolean'
    ? isBinary
    : normalizedType
      ? !isTextualContentType(normalizedType)
      : false;
  if (binaryFlag) {
    return 'binary';
  }

  if (normalizedType && !isTextualContentType(normalizedType)) {
    return 'binary';
  }

  return 'text';
}

function formatFileSize(bytes: number | null | undefined): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
    return null;
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function resolveLanguageKey(filePath: string): LanguageKey {
  const normalizedPath = filePath.toLowerCase();
  const filename = normalizedPath.split('/').pop() ?? normalizedPath;
  const parts = filename.split('.');
  const extension = parts.length > 1 ? parts[parts.length - 1] ?? '' : '';

  if (filename === '.env' || filename.startsWith('.env.')) return 'env';
  if (filename === '.bashrc' || filename === '.bash_profile' || filename === '.profile') return 'shell';

  switch (extension) {
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'ts':
      return 'typescript';
    case 'tsx':
      return 'tsx';
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'jsx':
      return 'jsx';
    case 'json':
      return 'json';
    case 'py':
      return 'python';
    case 'sh':
    case 'bash':
      return 'shell';
    case 'css':
      return 'css';
    case 'scss':
      return 'scss';
    case 'html':
    case 'htm':
      return 'html';
    case 'xml':
      return 'xml';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'toml':
      return 'toml';
    case 'sql':
      return 'sql';
    case 'go':
      return 'go';
    case 'rs':
      return 'rust';
    case 'env':
      return 'env';
    case 'conf':
      return 'conf';
    default:
      return 'plaintext';
  }
}

function languageExtensionFor(key: LanguageKey): Extension {
  switch (key) {
    case 'typescript':
      return javascript({ typescript: true });
    case 'tsx':
      return javascript({ typescript: true, jsx: true });
    case 'javascript':
      return javascript();
    case 'jsx':
      return javascript({ jsx: true });
    case 'json':
      return javascript();
    case 'python':
      return pythonLanguage;
    case 'shell':
      return shellLanguage;
    case 'css':
    case 'scss':
      return css();
    case 'html':
    case 'xml':
      return html();
    case 'yaml':
      return yamlLanguage;
    case 'toml':
      return tomlLanguage;
    case 'sql':
      return sqlLanguage;
    case 'go':
      return goLanguage;
    case 'rust':
      return rustLanguage;
    case 'env':
    case 'conf':
      return envLanguage;
    case 'markdown':
      return markdown();
    default:
      return [];
  }
}

export default function CodeMirrorFileViewer({
  content,
  filePath,
  sourceId,
  contentType,
  fileSize,
  isBinary,
  rawFileUrl,
}: CodeMirrorFileViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageCompartmentRef = useRef(new Compartment());
  const previewKind = useMemo(() => resolvePreviewKind(filePath, contentType, isBinary), [contentType, filePath, isBinary]);
  const [htmlView, setHtmlView] = useState<'preview' | 'source'>('preview');
  const staticHtmlPreview = isStaticHtmlPreviewSource(sourceId);
  const [routeHash, setRouteHash] = useState(() => (typeof window === 'undefined' ? '' : window.location.hash));
  const [staticPreviewUrl, setStaticPreviewUrl] = useState<string | null>(null);
  const wantsTextEditor = previewKind === 'text' || (previewKind === 'html' && htmlView === 'source');
  const languageKey = useMemo(() => resolveLanguageKey(filePath), [filePath]);
  const languageExtension = useMemo(() => languageExtensionFor(languageKey), [languageKey]);
  const normalizedContentType = useMemo(() => normalizeDetectedContentType(contentType), [contentType]);
  const formattedSize = useMemo(() => formatFileSize(fileSize), [fileSize]);
  const fileName = useMemo(() => filePath.split('/').pop() || 'file', [filePath]);
  const fileTypeLabel = useMemo(() => {
    if (normalizedContentType) {
      return normalizedContentType;
    }

    const extension = extensionFromPath(filePath);
    return extension ? extension.toUpperCase() : 'unknown';
  }, [filePath, normalizedContentType]);
  const parsedTable = useMemo(() => {
    if (previewKind !== 'table') {
      return null;
    }
    return parseDelimitedTable(content, delimiterFor(filePath, normalizedContentType));
  }, [content, filePath, normalizedContentType, previewKind]);

  // Reset the HTML sub-view when switching files.
  useEffect(() => {
    setHtmlView('preview');
  }, [filePath]);

  useEffect(() => {
    if (!staticHtmlPreview || typeof window === 'undefined') return;
    const syncRouteHash = () => setRouteHash(window.location.hash);
    syncRouteHash();
    window.addEventListener('hashchange', syncRouteHash);
    window.addEventListener('popstate', syncRouteHash);
    return () => {
      window.removeEventListener('hashchange', syncRouteHash);
      window.removeEventListener('popstate', syncRouteHash);
    };
  }, [staticHtmlPreview]);

  useEffect(() => {
    if (!staticHtmlPreview || previewKind !== 'html') {
      setStaticPreviewUrl(null);
      return;
    }
    const preview = createStaticHtmlPreviewUrl(content, routeHash);
    setStaticPreviewUrl(preview.src);
    return () => URL.revokeObjectURL(preview.objectUrl);
  }, [content, previewKind, routeHash, staticHtmlPreview]);

  useEffect(() => {
    if (!wantsTextEditor || !containerRef.current) {
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
      return;
    }

    if (viewRef.current) {
      return;
    }

    const state = EditorState.create({
      doc: content,
      extensions: [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        lineNumbers(),
        highlightActiveLineGutter(),
        EditorView.lineWrapping,
        syntaxHighlighting(viewerHighlightStyle),
        viewerTheme,
        languageCompartmentRef.current.of(languageExtension),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [wantsTextEditor]);

  useEffect(() => {
    if (!wantsTextEditor || !viewRef.current) return;
    const current = viewRef.current.state.doc.toString();
    if (current === content) return;

    viewRef.current.dispatch({
      changes: { from: 0, to: viewRef.current.state.doc.length, insert: content },
    });
  }, [content, wantsTextEditor]);

  useEffect(() => {
    if (!wantsTextEditor || !viewRef.current) return;
    viewRef.current.dispatch({
      effects: languageCompartmentRef.current.reconfigure(languageExtension),
    });
  }, [languageExtension, wantsTextEditor]);

  const binaryUnavailablePreview = (
    <div className="flex h-full w-full items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-5">
        <div className="text-sm font-semibold text-[var(--text-primary)]">Binary file preview unavailable</div>
        <div className="mt-2 text-xs text-[var(--text-muted)]">
          This file cannot be rendered as plain text.
        </div>
        <div className="mt-4 space-y-1 text-xs text-[var(--text-secondary)]">
          <div>File: {fileName}</div>
          <div>Type: {fileTypeLabel}</div>
          {formattedSize ? <div>Size: {formattedSize}</div> : null}
        </div>
      </div>
    </div>
  );

  if (previewKind === 'html') {
    return (
      <div className="flex h-full w-full flex-col">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-1.5">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setHtmlView('preview')}
              className={`mc-shell-btn px-2.5 py-1 text-xs ${
                htmlView === 'preview' ? 'mc-shell-btn-active text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
              }`}
            >
              Preview
            </button>
            <button
              type="button"
              onClick={() => setHtmlView('source')}
              className={`mc-shell-btn px-2.5 py-1 text-xs ${
                htmlView === 'source' ? 'mc-shell-btn-active text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
              }`}
            >
              Source
            </button>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
            {htmlView === 'preview' ? (
              staticHtmlPreview
                ? <span title="Rendered in a scriptless sandbox on an opaque origin.">Sandboxed · scripts off</span>
                : <span title="Rendered in a sandboxed frame with scripts enabled by default and isolated from the app session.">Sandboxed · scripts on</span>
            ) : null}
            {formattedSize ? <span>{formattedSize}</span> : null}
            {rawFileUrl ? (
              <a href={rawFileUrl} download={fileName} className="mc-shell-btn px-2 py-0.5 text-[11px]">
                Download
              </a>
            ) : null}
          </div>
        </div>
        {htmlView === 'preview' ? (
          <div className="min-h-0 flex-1 overflow-hidden bg-white">
            {staticHtmlPreview && !staticPreviewUrl ? null : (
              <iframe
                src={staticHtmlPreview ? staticPreviewUrl ?? undefined : undefined}
                srcDoc={staticHtmlPreview ? undefined : content}
                sandbox={htmlPreviewSandboxForSource(sourceId)}
                title={`HTML preview for ${fileName}`}
                className="h-full w-full border-0"
              />
            )}
          </div>
        ) : (
          <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden" />
        )}
      </div>
    );
  }

  if (previewKind === 'image') {
    return (
      <div className="flex h-full w-full flex-col items-center gap-4 overflow-auto p-4">
        <div className="w-full max-w-5xl overflow-hidden rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]">
          {rawFileUrl ? (
            <img src={rawFileUrl} alt={fileName} className="max-h-[70vh] w-full object-contain" />
          ) : (
            <div className="p-6 text-sm text-[var(--text-muted)]">Image preview unavailable.</div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-[var(--text-muted)]">
          <span>Type: {fileTypeLabel}</span>
          {formattedSize ? <span>Size: {formattedSize}</span> : null}
          {rawFileUrl ? (
            <a href={rawFileUrl} download={fileName} className="mc-shell-btn px-3 py-1 text-xs">
              Download
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  if (previewKind === 'audio') {
    if (!rawFileUrl) {
      return binaryUnavailablePreview;
    }

    return (
      <div className="flex h-full w-full items-center justify-center overflow-auto p-6">
        <div className="w-full max-w-2xl rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-5">
          <div className="text-sm font-semibold text-[var(--text-primary)]">{fileName}</div>
          <audio
            aria-label={`Audio preview for ${fileName}`}
            controls
            preload="metadata"
            src={rawFileUrl}
            className="mt-4 w-full"
          />
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)]">
            <span>Type: {fileTypeLabel}</span>
            {formattedSize ? <span>Size: {formattedSize}</span> : null}
            <a href={rawFileUrl} download={fileName} className="mc-shell-btn px-3 py-1 text-xs">
              Download
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (previewKind === 'video') {
    if (!rawFileUrl) {
      return binaryUnavailablePreview;
    }

    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 overflow-auto p-6">
        <div className="text-sm font-semibold text-[var(--text-primary)]">{fileName}</div>
        <video
          aria-label={`Video preview for ${fileName}`}
          controls
          preload="metadata"
          src={rawFileUrl}
          className="max-h-[70vh] w-full max-w-5xl rounded-xl bg-[var(--bg-secondary)]"
        />
        <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-[var(--text-muted)]">
          <span>Type: {fileTypeLabel}</span>
          {formattedSize ? <span>Size: {formattedSize}</span> : null}
          <a href={rawFileUrl} download={fileName} className="mc-shell-btn px-3 py-1 text-xs">
            Download
          </a>
        </div>
      </div>
    );
  }

  if (previewKind === 'table' && parsedTable) {
    const [headerRow, ...bodyRows] = parsedTable.rows;
    return (
      <div className="flex h-full w-full flex-col gap-3 overflow-auto p-4">
        <div className="overflow-auto rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr>
                {headerRow.map((cell, columnIndex) => (
                  <th
                    key={columnIndex}
                    className="sticky top-0 border-b border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-3 py-2 font-semibold text-[var(--text-primary)]"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, rowIndex) => (
                <tr key={rowIndex} className="odd:bg-[var(--surface-muted)]">
                  {headerRow.map((_, columnIndex) => (
                    <td
                      key={columnIndex}
                      className="border-b border-[var(--border-primary)] px-3 py-1.5 align-top text-[var(--text-secondary)]"
                    >
                      {row[columnIndex] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)]">
          <span>Rows: {bodyRows.length}</span>
          <span>Columns: {headerRow.length}</span>
          {parsedTable.truncated ? <span>Showing first {MAX_TABLE_ROWS} rows</span> : null}
          {formattedSize ? <span>Size: {formattedSize}</span> : null}
          {rawFileUrl ? (
            <a href={rawFileUrl} download={fileName} className="mc-shell-btn px-3 py-1 text-xs">
              Download
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  if (previewKind === 'table') {
    return (
      <div className="h-full w-full overflow-auto p-4">
        <div className="mb-2 text-xs text-[var(--text-muted)]">
          Could not parse {fileTypeLabel} as a table. Showing raw text.
        </div>
        <pre className="whitespace-pre-wrap break-words rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3 font-mono text-xs text-[var(--text-secondary)]">
          {content}
        </pre>
      </div>
    );
  }

  if (previewKind === 'pdf') {
    // TODO: render PDFs inline with pdf.js once the dependency is approved; this iframe is an interim fallback.
    return (
      <div className="flex h-full w-full flex-col items-center gap-4 overflow-auto p-4">
        <div className="h-[70vh] w-full max-w-5xl overflow-hidden rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]">
          {rawFileUrl ? (
            <iframe src={rawFileUrl} title={`PDF preview for ${fileName}`} className="h-full w-full" />
          ) : (
            <div className="p-6 text-sm text-[var(--text-muted)]">PDF preview unavailable.</div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-[var(--text-muted)]">
          <span>Type: {fileTypeLabel}</span>
          {formattedSize ? <span>Size: {formattedSize}</span> : null}
          {rawFileUrl ? (
            <a href={rawFileUrl} download={fileName} className="mc-shell-btn px-3 py-1 text-xs">
              Download PDF
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  if (previewKind === 'binary') {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-5">
          <div className="text-sm font-semibold text-[var(--text-primary)]">Binary file preview unavailable</div>
          <div className="mt-2 text-xs text-[var(--text-muted)]">
            This file cannot be rendered as plain text.
          </div>
          <div className="mt-4 space-y-1 text-xs text-[var(--text-secondary)]">
            <div>File: {fileName}</div>
            <div>Type: {fileTypeLabel}</div>
            {formattedSize ? <div>Size: {formattedSize}</div> : null}
          </div>
          {rawFileUrl ? (
            <div className="mt-4">
              <a href={rawFileUrl} download={fileName} className="mc-shell-btn px-3 py-1 text-xs">
                Download file
              </a>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full" />;
}
