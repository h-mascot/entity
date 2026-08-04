const INTERACTIVE_HTML_SANDBOX = 'allow-scripts allow-forms allow-popups allow-top-navigation-by-user-activation';
const STATIC_HTML_SANDBOX = 'allow-popups allow-top-navigation-by-user-activation';

export function isStaticHtmlPreviewSource(sourceId: string | null | undefined): boolean {
  return sourceId === 'entity-wiki';
}

export function htmlPreviewSandboxForSource(sourceId: string | null | undefined): string {
  return isStaticHtmlPreviewSource(sourceId) ? STATIC_HTML_SANDBOX : INTERACTIVE_HTML_SANDBOX;
}

type CreateObjectUrl = (blob: Blob) => string;

export function createStaticHtmlPreviewUrl(
  content: string,
  routeHash: string,
  createObjectUrl: CreateObjectUrl = (blob) => URL.createObjectURL(blob),
): { objectUrl: string; src: string } {
  const objectUrl = createObjectUrl(new Blob([content], { type: 'text/html' }));
  const fragment = routeHash.startsWith('#') ? routeHash : '';
  return {
    objectUrl,
    src: `${objectUrl}${fragment}`,
  };
}
