import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { visit } from 'unist-util-visit';
import type { Root, Text } from 'mdast';
import {
  createMarkdownHeadingIdFactory,
  resolveMarkdownDocsLinkCandidate,
  shouldInterceptMarkdownDocsClick,
} from '../lib/markdownFile';
import 'highlight.js/styles/github-dark.css';

const htmlSchema = {
  ...defaultSchema,
  tagNames: Array.from(
    new Set([
      ...(defaultSchema.tagNames ?? []),
      'font',
      'u',
      'b',
      'i',
      'em',
      'strong',
      'div',
      'span',
      'br',
      'ul',
      'ol',
      'li',
      'table',
      'tr',
      'td',
      'th',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'a',
      'img',
      'p',
      'pre',
      'code',
    ])
  ),
  attributes: {
    ...defaultSchema.attributes,
    font: [...(defaultSchema.attributes?.font ?? []), 'color'],
    a: [...(defaultSchema.attributes?.a ?? []), 'href'],
    img: [...(defaultSchema.attributes?.img ?? []), 'src', 'alt'],
    h1: [...(defaultSchema.attributes?.h1 ?? []), 'dataAuthoredHeadingId'],
    h2: [...(defaultSchema.attributes?.h2 ?? []), 'dataAuthoredHeadingId'],
    h3: [...(defaultSchema.attributes?.h3 ?? []), 'dataAuthoredHeadingId'],
    h4: [...(defaultSchema.attributes?.h4 ?? []), 'dataAuthoredHeadingId'],
    h5: [...(defaultSchema.attributes?.h5 ?? []), 'dataAuthoredHeadingId'],
    h6: [...(defaultSchema.attributes?.h6 ?? []), 'dataAuthoredHeadingId'],
  },
};

interface MarkdownPreviewProps {
  content: string;
  loading?: boolean;
  onDocsLinkNavigate?: (href: string) => boolean;
  hasDocumentLinkBase?: boolean;
  /**
   * Compact variant for embedding the shared doc renderer inside dense surfaces
   * (e.g. the task Output section) rather than the full-width docs page.
   */
  compact?: boolean;
}

// Shared prose overrides (colors, code, tables, blockquotes) applied in both variants
// so embedded renders stay visually consistent with the full DocHub document view.
// break-words + [overflow-wrap:anywhere] keep long unbroken tokens (e.g. SOPS ENC[...]
// blobs, hashes, URLs) wrapping inside the content card instead of clipping past its
// right edge; prose-pre:whitespace-pre-wrap extends the same guarantee to code blocks.
const SHARED_PROSE_CLASSES = `break-words [overflow-wrap:anywhere]
      prose-headings:text-[var(--text-primary)]
      prose-p:text-[var(--text-secondary)]
      prose-a:text-[var(--accent)] prose-a:no-underline hover:prose-a:underline
      prose-strong:text-[var(--text-primary)]
      prose-code:text-[var(--text-secondary)] prose-code:bg-[var(--bg-secondary)] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:border prose-code:border-[var(--border-primary)]
      prose-pre:bg-[var(--bg-secondary)] prose-pre:border prose-pre:border-[var(--bg-tertiary)] prose-pre:rounded-lg prose-pre:whitespace-pre-wrap prose-pre:break-words prose-pre:[overflow-wrap:anywhere]
      prose-blockquote:border-[var(--border-secondary)] prose-blockquote:bg-[var(--bg-tertiary)] prose-blockquote:rounded-r-lg
      prose-li:text-[var(--text-secondary)]
      prose-table:border-collapse
      prose-th:bg-[var(--bg-secondary)] prose-th:text-[var(--text-primary)] prose-th:p-2 prose-th:border prose-th:border-[var(--border-primary)]
      prose-td:text-[var(--text-secondary)] prose-td:p-2 prose-td:border prose-td:border-[var(--border-primary)]
      prose-img:rounded-lg
      prose-hr:border-[var(--border-primary)]`;

const FULL_PROSE_CLASSES = `relative prose prose-invert max-w-none
      prose-headings:scroll-mt-24 prose-headings:font-semibold
      prose-h1:mt-0 prose-h1:mb-5 prose-h1:text-[2rem] prose-h1:leading-tight
      prose-h2:mt-9 prose-h2:mb-3 prose-h2:text-[1.45rem] prose-h2:leading-snug
      prose-h3:mt-7 prose-h3:mb-2 prose-h3:text-lg prose-h3:leading-snug
      prose-p:my-4 prose-p:text-base prose-p:leading-7
      prose-ul:my-4 prose-ol:my-4 prose-li:my-1
      ${SHARED_PROSE_CLASSES}`;

const COMPACT_PROSE_CLASSES = `relative prose prose-invert prose-sm max-w-none
      prose-headings:mt-3 prose-headings:mb-1.5
      prose-h1:text-lg prose-h2:text-base prose-h3:text-sm
      prose-p:my-2 prose-p:leading-relaxed prose-pre:text-xs
      ${SHARED_PROSE_CLASSES}`;

function isEntityHost(hostname: string): boolean {
  if (typeof window !== 'undefined' && hostname === window.location.hostname) {
    return true;
  }

  return /^(100\.(?:\d{1,3}\.){2}\d{1,3}|localhost|127\.0\.0\.1)$/i.test(hostname);
}

function toEntityDocsHref(rawHref: string): string | null {
  const href = rawHref.trim();
  if (!href) {
    return null;
  }

  if (href.startsWith('/docs/')) {
    const rawPath = href.slice('/docs/'.length);
    if (/^(?:docs|notes)\//i.test(rawPath)) {
      return `/docs/workspace/${rawPath}`;
    }
    return href;
  }

  if (/^(?:output|memory|workspace|projects|zora|spock)\//i.test(href)) {
    return `/docs/${href}`;
  }

  if (/^(?:docs|notes)\//i.test(href)) {
    return `/docs/workspace/${href}`;
  }

  if (/^https?:\/\//i.test(href)) {
    try {
      const url = new URL(href);
      if (isEntityHost(url.hostname) && url.pathname.startsWith('/docs/')) {
        return `${url.pathname}${url.search}${url.hash}`;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function isEntityDocsHref(href: string): boolean {
  return Boolean(toEntityDocsHref(href));
}

function remarkEntityAutolink() {
  const pattern =
    /(?:https?:\/\/[^\s<>()\[\]{}]+|\/docs\/[^\s<>()\[\]{}]+|(?:docs|notes|output|memory|workspace|projects|zora|spock)\/[^\s<>()\[\]{}]+)/g;

  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || typeof index !== 'number') {
        return;
      }

      if (parent.type === 'link' || parent.type === 'linkReference') {
        return;
      }

      const value = node.value;
      const matches = Array.from(value.matchAll(pattern));
      if (matches.length === 0) {
        return;
      }

      const children: Root['children'] = [];
      let cursor = 0;

      for (const match of matches) {
        const start = match.index ?? 0;
        const raw = match[0];
        const href = toEntityDocsHref(raw);
        if (!href) {
          continue;
        }

        if (start > cursor) {
          children.push({ type: 'text', value: value.slice(cursor, start) });
        }

        children.push({
          type: 'link',
          url: href,
          children: [{ type: 'text', value: raw }],
        });
        cursor = start + raw.length;
      }

      if (cursor === 0) {
        return;
      }

      if (cursor < value.length) {
        children.push({ type: 'text', value: value.slice(cursor) });
      }

      parent.children.splice(index, 1, ...children);
    });
  };
}

function rehypeCaptureAuthoredHeadingIds() {
  return (tree: any) => {
    visit(tree, 'element', (node: any) => {
      if (typeof node?.tagName !== 'string' || !/^h[1-6]$/.test(node.tagName)) {
        return;
      }
      const authoredId = node.properties?.id;
      if (typeof authoredId === 'string' && authoredId.trim()) {
        node.properties = {
          ...(node.properties ?? {}),
          dataAuthoredHeadingId: authoredId,
        };
      }
    });
  };
}

function rehypeHeadingIds() {
  const headingId = createMarkdownHeadingIdFactory();
  const textContent = (node: any): string => {
    if (node?.type === 'text') {
      return typeof node.value === 'string' ? node.value : '';
    }
    return Array.isArray(node?.children)
      ? node.children.map(textContent).join('')
      : '';
  };

  return (tree: any) => {
    visit(tree, 'element', (node: any) => {
      if (typeof node?.tagName !== 'string' || !/^h[1-6]$/.test(node.tagName)) {
        return;
      }
      const authoredId =
        typeof node.properties?.dataAuthoredHeadingId === 'string'
          ? node.properties.dataAuthoredHeadingId
          : undefined;
      if (node.properties) {
        delete node.properties.dataAuthoredHeadingId;
      }
      const existingId =
        authoredId ?? (typeof node.properties?.id === 'string' ? node.properties.id : undefined);
      const id = headingId(textContent(node), existingId);
      if (id) {
        node.properties = { ...(node.properties ?? {}), id };
      }
    });
  };
}

export default function MarkdownPreview({
  content,
  loading,
  onDocsLinkNavigate,
  hasDocumentLinkBase = false,
  compact,
}: MarkdownPreviewProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">
        <div className="animate-pulse flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center text-2xl">⚡</div>
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  if (!content) {
    return (
      <div className="text-[var(--text-muted)] text-center py-16">
        <div className="text-4xl mb-2">📝</div>
        <div>Empty file</div>
      </div>
    );
  }

  const hasSignificantHtml = /<\s*\/?\s*[a-z][a-z0-9-]*(?:\s[^>]*?)?\s*\/?>/i.test(content);

  return (
    <div className={compact ? COMPACT_PROSE_CLASSES : FULL_PROSE_CLASSES}>
      {hasSignificantHtml ? (
        <div
          className="not-prose absolute right-2 top-2 z-10 rounded-full border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)]"
          title="This file contains raw HTML tags"
          aria-label="Contains HTML"
        >
          HTML
        </div>
      ) : null}
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkEntityAutolink]}
        rehypePlugins={[
          rehypeRaw,
          rehypeCaptureAuthoredHeadingIds,
          [rehypeSanitize, htmlSchema],
          rehypeHeadingIds,
          rehypeHighlight,
        ]}
        components={{
          a: ({ href, children, ref: _ref, node: _node, ...props }) => {
            const originalHref = typeof href === 'string' ? href.trim() : '';
            const entityDocsHref = originalHref ? toEntityDocsHref(originalHref) : null;
            const docsLinkCandidate = entityDocsHref
              ?? resolveMarkdownDocsLinkCandidate(originalHref, {
                hasDocumentBase: hasDocumentLinkBase,
              });
            const resolvedHref = docsLinkCandidate ?? originalHref;
            const docsHref = Boolean(docsLinkCandidate);
            const hashHref = resolvedHref.startsWith('#');
            const externalHref = Boolean(resolvedHref) && !docsHref && !hashHref;
            const originalOnClick = props.onClick;

            return (
              <a
                {...props}
                href={resolvedHref || undefined}
                target={externalHref ? '_blank' : undefined}
                rel={externalHref ? 'noreferrer noopener' : undefined}
                onClick={(event) => {
                  if (typeof originalOnClick === 'function') {
                    originalOnClick(event);
                  }

                  if (
                    !shouldInterceptMarkdownDocsClick(event)
                    || !docsHref
                    || !resolvedHref
                    || !onDocsLinkNavigate
                  ) {
                    return;
                  }

                  if (onDocsLinkNavigate(resolvedHref)) {
                    event.preventDefault();
                  }
                }}
              >
                {children}
              </a>
            );
          },
          input: ({ type, checked, ref: _ref, node: _node, ...props }) => {
            if (type === 'checkbox') {
              return (
                <input
                  type="checkbox"
                  checked={checked}
                  readOnly
                  className="mr-2 accent-[var(--accent)]"
                  {...props}
                />
              );
            }
            return <input type={type} {...props} />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
