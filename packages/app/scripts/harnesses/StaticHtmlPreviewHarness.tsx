// Browser harness for the static Entity Wiki HTML preview (GQR-001).
//
// Mounts the REAL production component (`CodeMirrorFileViewer`) with the
// entity-wiki source so a real WebKit/Chromium engine can prove whether the
// scriptless sandboxed preview actually renders visible content. Bundled by
// `packages/app/scripts/static-html-preview-webkit-proof.mjs` with esbuild;
// not part of the tsc/vite build (tsconfig only includes src/).
import { createRoot } from 'react-dom/client';
import CodeMirrorFileViewer from '../../src/components/CodeMirrorFileViewer';

interface HarnessInput {
  content: string;
  filePath: string;
  rawFileUrl: string;
}

declare global {
  interface Window {
    __ENTITY_HARNESS_INPUT__?: HarnessInput;
  }
}

const fallback: HarnessInput = {
  content: '<!doctype html><html><body><main id="wiki-content"><h1>fallback</h1></main></body></html>',
  filePath: 'quickstart.html',
  rawFileUrl: '',
};

const input = window.__ENTITY_HARNESS_INPUT__ ?? fallback;

// Reproduce the production page state before the viewer mounts. The docs app
// is path-routed; the top-level location hash only carries a deep-link
// fragment (e.g. /docs/source/entity-wiki/quickstart.html#wiki-content).
const requestedHash = new URLSearchParams(window.location.search).get('routeHash') ?? '';
if (requestedHash && requestedHash.startsWith('#')) {
  window.location.hash = requestedHash;
}

const container = document.getElementById('viewer-root');
if (!container) {
  throw new Error('static html preview harness: #viewer-root missing');
}

createRoot(container).render(
  <CodeMirrorFileViewer
    content={input.content}
    filePath={input.filePath}
    sourceId="entity-wiki"
    contentType="text/html"
    fileSize={input.content.length}
    isBinary={false}
    rawFileUrl={input.rawFileUrl || null}
  />
);
