function normalizeDetectedContentType(contentType: string | null | undefined): string {
  if (typeof contentType !== 'string') {
    return '';
  }

  return contentType
    .split(';')[0]
    ?.trim()
    .toLowerCase() ?? '';
}

export function isMarkdownContentType(contentType: string | null | undefined): boolean {
  const normalized = normalizeDetectedContentType(contentType);
  if (!normalized) {
    return false;
  }

  return normalized === 'text/markdown' || normalized === 'application/markdown' || normalized.includes('markdown');
}

export function isMarkdownFilePath(filePath: string | null): boolean {
  if (!filePath) return false;
  const normalized = filePath.trim().toLowerCase();
  return normalized.endsWith('.md') || normalized.endsWith('.markdown') || normalized.endsWith('.mdx');
}

export function resolveMarkdownDocsLinkCandidate(
  href: string,
  context: { hasDocumentBase: boolean } = { hasDocumentBase: true },
): string | null {
  const normalized = href.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith('#')) {
    return context.hasDocumentBase ? normalized : null;
  }
  if (normalized.startsWith('/docs/')) {
    return normalized;
  }
  if (normalized.startsWith('/') || normalized.startsWith('//')) {
    return null;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(normalized)) {
    return null;
  }
  return context.hasDocumentBase ? normalized : null;
}

export function shouldInterceptMarkdownDocsClick(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}): boolean {
  return (
    event.button === 0
    && !event.metaKey
    && !event.ctrlKey
    && !event.shiftKey
    && !event.altKey
    && !event.defaultPrevented
  );
}

export function createMarkdownHeadingIdFactory(): (
  headingText: string,
  existingId?: unknown,
) => string {
  const usedIds = new Set<string>();
  const nextSuffixByBase = new Map<string, number>();

  return (headingText: string, existingId?: unknown) => {
    if (typeof existingId === 'string' && existingId.trim()) {
      usedIds.add(existingId);
      return existingId;
    }

    const base = headingText
      .trim()
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}\s_-]/gu, '')
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-');
    if (!base) {
      return '';
    }

    let suffix = nextSuffixByBase.get(base) ?? 0;
    let candidate = suffix === 0 ? base : `${base}-${suffix}`;
    while (usedIds.has(candidate)) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }

    usedIds.add(candidate);
    nextSuffixByBase.set(base, suffix + 1);
    return candidate;
  };
}

function isHtmlFilePath(filePath: string | null): boolean {
  if (!filePath) return false;
  const normalized = filePath.trim().toLowerCase();
  return normalized.endsWith('.html') || normalized.endsWith('.htm') || normalized.endsWith('.xhtml');
}

export function shouldRenderMarkdownPreview(
  filePath: string | null,
  contentType: string | null | undefined,
): boolean {
  // Some remote text adapters report every readable file as text/markdown.
  // Preserve the path's stronger HTML signal so HTML reaches the sandboxed viewer.
  if (isHtmlFilePath(filePath)) {
    return false;
  }
  return isMarkdownFilePath(filePath) || isMarkdownContentType(contentType);
}
