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

export function shouldRenderMarkdownPreview(
  filePath: string | null,
  contentType: string | null | undefined,
): boolean {
  return isMarkdownFilePath(filePath) || isMarkdownContentType(contentType);
}
