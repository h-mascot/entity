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
