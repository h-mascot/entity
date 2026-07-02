import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { visit } from 'unist-util-visit';
import type { Root, Text } from 'mdast';
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
  },
};

interface MarkdownPreviewProps {
  content: string;
  loading?: boolean;
  onDocsLinkNavigate?: (href: string) => boolean;
  /**
   * Compact variant for embedding the shared doc renderer inside dense surfaces
   * (e.g. the task Output section) rather than the full-width docs page.
   */
  compact?: boolean;
}

// Shared prose overrides (colors, code, tables, blockquotes) applied in both variants
// so embedded renders stay visually consistent with the full DocHub document view.
const SHARED_PROSE_CLASSES = `prose-headings:text-[var(--text-primary)]
      prose-p:text-[var(--text-secondary)]
      prose-a:text-[var(--accent)] prose-a:no-underline hover:prose-a:underline
      prose-strong:text-[var(--text-primary)]
      prose-code:text-[var(--text-secondary)] prose-code:bg-[var(--bg-secondary)] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:border prose-code:border-[var(--border-primary)]
      prose-pre:bg-[var(--bg-secondary)] prose-pre:border prose-pre:border-[var(--bg-tertiary)] prose-pre:rounded-lg
      prose-blockquote:border-[var(--border-secondary)] prose-blockquote:bg-[var(--bg-tertiary)] prose-blockquote:rounded-r-lg
      prose-li:text-[var(--text-secondary)]
      prose-table:border-collapse
      prose-th:bg-[var(--bg-secondary)] prose-th:text-[var(--text-primary)] prose-th:p-2 prose-th:border prose-th:border-[var(--border-primary)]
      prose-td:text-[var(--text-secondary)] prose-td:p-2 prose-td:border prose-td:border-[var(--border-primary)]
      prose-img:rounded-lg
      prose-hr:border-[var(--border-primary)]`;

const FULL_PROSE_CLASSES = `relative prose prose-invert max-w-none
      prose-headings:border-b prose-headings:border-[var(--border-primary)] prose-headings:pb-2
      prose-headings:scroll-mt-24 prose-h1:text-3xl prose-h1:leading-tight prose-h2:text-xl prose-h3:text-lg
      prose-p:leading-relaxed
      ${SHARED_PROSE_CLASSES}`;

const COMPACT_PROSE_CLASSES = `relative prose prose-invert prose-sm max-w-none
      prose-headings:mt-3 prose-headings:mb-1.5 prose-headings:pb-1 prose-headings:border-b prose-headings:border-[var(--border-primary)]
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

export default function MarkdownPreview({ content, loading, onDocsLinkNavigate, compact }: MarkdownPreviewProps) {
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
        rehypePlugins={[rehypeRaw, [rehypeSanitize, htmlSchema], rehypeHighlight]}
        components={{
          a: ({ href, children, ref: _ref, node: _node, ...props }) => {
            const originalHref = typeof href === 'string' ? href.trim() : '';
            const entityDocsHref = originalHref ? toEntityDocsHref(originalHref) : null;
            const resolvedHref = entityDocsHref ?? originalHref;
            const docsHref = Boolean(entityDocsHref);
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

                  if (event.defaultPrevented || !docsHref || !resolvedHref || !onDocsLinkNavigate) {
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
