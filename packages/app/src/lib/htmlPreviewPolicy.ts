const INTERACTIVE_HTML_SANDBOX = 'allow-scripts allow-forms allow-popups allow-top-navigation-by-user-activation';
const STATIC_HTML_SANDBOX = 'allow-popups allow-top-navigation-by-user-activation';

export function isStaticHtmlPreviewSource(sourceId: string | null | undefined): boolean {
  return sourceId === 'entity-wiki';
}

export function htmlPreviewSandboxForSource(sourceId: string | null | undefined): string {
  return isStaticHtmlPreviewSource(sourceId) ? STATIC_HTML_SANDBOX : INTERACTIVE_HTML_SANDBOX;
}

// Static Entity Wiki previews render through `srcdoc`, not blob URLs: WebKit's
// CSP source-expression matching rejects `blob:` URLs for `frame-src`, so a
// blob-URL frame is blocked (blank) in Safari/WebKit under the app CSP while
// Chromium renders it. `srcdoc` frames are not frame-src-gated, stay scriptless
// and opaque via the sandbox attribute, and inherit the app CSP.
