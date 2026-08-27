#!/usr/bin/env node
// GQR-001: WebKit/Safari-capable regression + proof for the static Entity Wiki
// HTML preview.
//
// Loads the REAL CodeMirrorFileViewer (entity-wiki source, real committed
// openwiki-html/quickstart.html content) in a real browser engine and asserts
// that the sandboxed iframe renders visible wiki content. Also probes four
// iframe strategies (blob, blob+fragment, srcdoc, same-origin http+fragment)
// as diagnostics so engine evidence can select a fix.
//
// Usage:
//   node packages/app/scripts/static-html-preview-webkit-proof.mjs \
//     [--engine=webkit|chromium|both] [--out-dir=<dir>]
//
// Playwright resolution order:
//   1. require('playwright') from this repo (if installed)
//   2. $ENTITY_PLAYWRIGHT_NODE_MODULES (a node_modules dir containing playwright)
// Browsers must be present in the shared Playwright cache
// (`npx playwright install webkit chromium`).
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');
const WIKI_PAGE_REL = path.join('openwiki-html', 'quickstart.html');
const MARKER_TEXT = 'Entity Quickstart';
const CONTENT_ANCHOR = '#wiki-content';
const STATIC_SANDBOX = 'allow-popups allow-top-navigation-by-user-activation';
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'packages', 'app', 'artifacts', 'html-preview-proof');
// Mirror of the production response headers from
// packages/server/src/security.ts. The real Safari blank-preview defect only
// reproduces under this CSP (WebKit frame-src matching rejects blob: URLs),
// so the harness page is served with the same policy as the app by default.
const APP_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self' http: https: ws: wss:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'self' blob:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
].join('; ');
const APP_HEADERS = {
  'Content-Security-Policy': APP_CSP,
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
};

const args = process.argv.slice(2);
const engineArg = args.find((a) => a.startsWith('--engine='))?.slice('--engine='.length) ?? 'safari';
const outDirArg = args.find((a) => a.startsWith('--out-dir='))?.slice('--out-dir='.length);
const engines =
  engineArg === 'both' ? ['webkit', 'chromium']
  : engineArg === 'all' ? ['safari', 'webkit', 'chromium']
  : [engineArg];
const outDir = outDirArg ?? DEFAULT_OUT_DIR;
const noAppCsp = args.includes('--no-app-csp');

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require('playwright');
  } catch {
    // fall through to explicit locations
  }
  const envDir = process.env.ENTITY_PLAYWRIGHT_NODE_MODULES;
  if (envDir) {
    const require2 = createRequire(path.join(envDir, 'noop.js'));
    try {
      return require2('playwright');
    } catch (error) {
      throw new Error(`playwright not loadable from $ENTITY_PLAYWRIGHT_NODE_MODULES (${envDir}): ${error.message}`);
    }
  }
  throw new Error(
    'playwright is not available. Install it in a node_modules dir and set '
    + 'ENTITY_PLAYWRIGHT_NODE_MODULES, or add playwright to the repo devDependencies. '
    + 'Browsers live in the shared Playwright cache (npx playwright install webkit chromium).'
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function poll(timeoutMs, tickMs, probe) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await probe();
    if (last.ok) return last;
    await delay(tickMs);
  }
  return last;
}

async function assessFrame(frame, { expectVisibleSelector }) {
  if (!frame) {
    return { rendered: false, reason: 'frame not attached', frameUrl: null, textLength: 0 };
  }
  let frameUrl = null;
  try {
    frameUrl = frame.url();
  } catch {
    frameUrl = '<unavailable>';
  }
  let textLength = 0;
  let sample = '';
  let markerPresent = false;
  try {
    const text = await frame.evaluate(() => document.body?.innerText ?? '');
    textLength = text.length;
    sample = text.replace(/\s+/g, ' ').slice(0, 120);
    markerPresent = text.includes(MARKER_TEXT);
  } catch (error) {
    sample = `evaluate failed: ${error.message.split('\n')[0]}`;
  }
  const visible = await poll(4000, 250, async () => {
    try {
      const locator = frame.locator(expectVisibleSelector).first();
      return { ok: await locator.isVisible(), box: await locator.boundingBox() };
    } catch (error) {
      return { ok: false, error: error.message.split('\n')[0] };
    }
  });
  return {
    rendered: Boolean(visible.ok),
    frameUrl,
    textLength,
    sample,
    markerPresent,
    visibleBox: visible.box ?? null,
  };
}

async function runEngine({ playwright, engineType, wikiPage, serverUrl, outDirEngine }) {
  if (engineType === 'safari') {
    return runSafariEngine({ wikiPage, serverUrl, outDirEngine });
  }
  const browser = await playwright[engineType].launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const evidence = { engine: engineType, cases: {}, variants: {}, screenshots: [], ok: true };

  const assessComponentCase = async (caseName, url) => {
    const result = { sandbox: null, rendered: false, frameUrl: null, textLength: 0 };
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      const frameEl = page.locator('iframe[title^="HTML preview"]').first();
      await frameEl.waitFor({ state: 'attached', timeout: 10000 });
      result.sandbox = await frameEl.getAttribute('sandbox');
      await delay(500);
      const frame = await (await page.$('iframe[title^="HTML preview"]'))?.contentFrame();
      const assessment = await assessFrame(frame, { expectVisibleSelector: '#wiki-content' });
      Object.assign(result, assessment);
      const shot = path.join(outDirEngine, `case-${caseName}.png`);
      await page.screenshot({ path: shot });
      evidence.screenshots.push(shot);
    } catch (error) {
      result.error = error.message.split('\n')[0];
    }
    result.markerPresent = Boolean(result.markerPresent ?? false);
    result.pass = Boolean(
      result.rendered && result.markerPresent && result.sandbox === STATIC_SANDBOX
    );
    if (!result.pass) evidence.ok = false;
    evidence.cases[caseName] = result;
    return result;
  };

  await assessComponentCase('no-hash', `${serverUrl}/?case=no-hash`);
  await assessComponentCase('deep-link', `${serverUrl}/?case=deep-link&routeHash=${encodeURIComponent(CONTENT_ANCHOR)}`);

  // Source/Preview toggle proof on the component seam.
  try {
    await page.goto(`${serverUrl}/?case=no-hash`, { waitUntil: 'domcontentloaded' });
    await page.locator('iframe[title^="HTML preview"]').first().waitFor({ state: 'attached', timeout: 10000 });
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    await page.locator('.cm-editor').first().waitFor({ state: 'visible', timeout: 10000 });
    const sourceShot = path.join(outDirEngine, 'case-source-view.png');
    await page.screenshot({ path: sourceShot });
    evidence.screenshots.push(sourceShot);
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const frameBack = await (await page.$('iframe[title^="HTML preview"]'))?.contentFrame();
    const backAssessment = await assessFrame(frameBack, { expectVisibleSelector: '#wiki-content' });
    evidence.cases.sourceToggle = {
      sourceViewVisible: true,
      previewAfterSource: backAssessment.rendered && backAssessment.markerPresent,
    };
    if (!evidence.cases.sourceToggle.previewAfterSource) evidence.ok = false;
  } catch (error) {
    evidence.cases.sourceToggle = { error: error.message.split('\n')[0] };
    evidence.ok = false;
  }

  // Strategy diagnostics: same sandbox, four iframe strategies.
  try {
    await page.evaluate((html) => {
      const host = document.getElementById('variants');
      host.innerHTML = '';
      const make = (variant) => {
        const f = document.createElement('iframe');
        f.setAttribute('sandbox', STATIC_SANDBOX_VALUE);
        f.dataset.variant = variant;
        f.style.cssText = 'width:360px;height:240px;border:0;display:block;';
        host.appendChild(f);
        return f;
      };
      const blob = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      make('blob-plain').src = blob;
      make('blob-fragment').src = `${blob}#wiki-content`;
      make('srcdoc').setAttribute('srcdoc', html);
      make('http-fragment').src = '/raw/quickstart.html#wiki-content';
    }, wikiPage);
    await delay(1000);
    for (const variant of ['blob-plain', 'blob-fragment', 'srcdoc', 'http-fragment']) {
      const handle = await page.$(`iframe[data-variant="${variant}"]`);
      const frame = handle ? await handle.contentFrame() : null;
      evidence.variants[variant] = await assessFrame(frame, { expectVisibleSelector: '#wiki-content' });
    }
  } catch (error) {
    evidence.variants.error = error.message.split('\n')[0];
  }

  await browser.close();
  return evidence;
}

async function runSafariEngine({ wikiPage, serverUrl, outDirEngine }) {
  // Real Safari via safaridriver (W3C WebDriver). Requires Safari Settings ->
  // Developer -> "Allow remote automation". WebDriver can switch into
  // cross-origin/sandboxed frames, which is how we assert visible content
  // inside the opaque preview frame.
  const { spawn } = await import('node:child_process');
  const port = 11000 + Math.floor(Math.random() * 500);
  const driver = spawn('safaridriver', ['-p', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${port}`;
  const driverOutput = [];
  driver.stdout.on('data', (d) => driverOutput.push(String(d)));
  driver.stderr.on('data', (d) => driverOutput.push(String(d)));
  const evidence = { engine: 'safari', cases: {}, variants: {}, screenshots: [], ok: true };

  const wd = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json().catch(() => ({}));
    if (response.status >= 400) {
      throw new Error(`WD ${method} ${path} -> ${response.status}: ${JSON.stringify(json).slice(0, 200)}`);
    }
    return json.value ?? {};
  };
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    await poll(5000, 300, async () => {
      try {
        await fetch(`${base}/status`);
        return { ok: true };
      } catch {
        return { ok: false };
      }
    });
    const session = await wd('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
    const sid = session.sessionId;
    if (!sid) throw new Error(`no session id: ${JSON.stringify(session).slice(0, 200)}`);

    const findElement = async (selector) =>
      (await wd('POST', `/session/${sid}/element`, { using: 'css selector', value: selector }))['element-6066-11e4-a52e-4f735466cecf'];
    const execute = (script) => wd('POST', `/session/${sid}/execute/sync`, { script, args: [] });
    const switchFrame = async (elementId) => {
      await wd('POST', `/session/${sid}/frame`, elementId ? { id: { 'element-6066-11e4-a52e-4f735466cecf': elementId } } : { id: null });
    };

    const probeFrame = async () => execute(`
      const anchor = document.querySelector('#wiki-content');
      const rect = anchor ? anchor.getBoundingClientRect() : null;
      const visible = !!(rect && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight);
      const text = (document.body && document.body.innerText) || '';
      return JSON.stringify({
        url: location.href,
        textLength: text.length,
        markerPresent: text.includes(${JSON.stringify(MARKER_TEXT)}),
        sample: text.replace(/\\s+/g, ' ').slice(0, 120),
        anchorVisible: visible,
      });
    `).then((v) => JSON.parse(v));

    const assessComponentCase = async (caseName, url) => {
      const result = { sandbox: null, rendered: false, frameUrl: null, textLength: 0 };
      try {
        await wd('POST', `/session/${sid}/url`, { url });
        await poll(10000, 300, async () => ({ ok: Boolean(await findElement('iframe[title^="HTML preview"]').catch(() => null)) }));
        const frameEl = await findElement('iframe[title^="HTML preview"]');
        if (!frameEl) throw new Error('preview iframe not found');
        result.sandbox = await wd('GET', `/session/${sid}/element/${frameEl}/attribute/sandbox`);
        await delay(2500);
        await switchFrame(frameEl);
        const probe = await poll(6000, 500, async () => {
          const p = await probeFrame().catch(() => ({ anchorVisible: false, textLength: 0 }));
          return { ok: p.anchorVisible && p.textLength > 500, ...p };
        });
        Object.assign(result, probe.ok ? probe : probe);
        await switchFrame(null);
        const shot = await wd('GET', `/session/${sid}/screenshot`);
        await writeFile(path.join(outDirEngine, `case-${caseName}.png`), Buffer.from(shot, 'base64'));
        evidence.screenshots.push(path.join(outDirEngine, `case-${caseName}.png`));
      } catch (error) {
        result.error = error.message.split('\n')[0];
        await switchFrame(null).catch(() => {});
      }
      result.markerPresent = Boolean(result.markerPresent ?? result.sample?.includes(MARKER_TEXT));
      result.pass = Boolean(result.anchorVisible && result.markerPresent && result.sandbox === STATIC_SANDBOX);
      if (!result.pass) evidence.ok = false;
      evidence.cases[caseName] = result;
    };

    await assessComponentCase('no-hash', `${serverUrl}/?case=no-hash`);
    await assessComponentCase('deep-link', `${serverUrl}/?case=deep-link&routeHash=${encodeURIComponent(CONTENT_ANCHOR)}`);

    // Source/Preview toggle proof.
    try {
      await wd('POST', `/session/${sid}/url`, { url: `${serverUrl}/?case=no-hash` });
      await poll(10000, 300, async () => ({ ok: Boolean(await findElement('iframe[title^="HTML preview"]').catch(() => null)) }));
      const sourceBtn = await findElement('button[class*=mc-shell-btn]');
      // Buttons are Preview/Source pair; pick the one labelled Source via JS click.
      await execute(`
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Source');
        if (btn) btn.click();
      `);
      await poll(10000, 400, async () => ({ ok: Boolean(await findElement('.cm-editor').catch(() => null)) }));
      const editorVisible = Boolean(await findElement('.cm-editor').catch(() => null));
      const sourceShot = await wd('GET', `/session/${sid}/screenshot`);
      await writeFile(path.join(outDirEngine, 'case-source-view.png'), Buffer.from(sourceShot, 'base64'));
      evidence.screenshots.push(path.join(outDirEngine, 'case-source-view.png'));
      await execute(`
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Preview');
        if (btn) btn.click();
      `);
      await delay(2500);
      const frameEl2 = await findElement('iframe[title^="HTML preview"]');
      await switchFrame(frameEl2);
      const probe = await probeFrame().catch(() => ({ anchorVisible: false, sample: '', markerPresent: false }));
      await switchFrame(null);
      evidence.cases.sourceToggle = {
        sourceViewVisible: editorVisible,
        previewAfterSource: probe.anchorVisible && (probe.markerPresent || String(probe.sample).includes(MARKER_TEXT)),
      };
      if (!evidence.cases.sourceToggle.previewAfterSource) evidence.ok = false;
      void sourceBtn;
    } catch (error) {
      evidence.cases.sourceToggle = { error: error.message.split('\n')[0] };
      evidence.ok = false;
    }

    // Strategy diagnostics in real Safari.
    try {
      await wd('POST', `/session/${sid}/url`, { url: `${serverUrl}/?case=variants` });
      await poll(10000, 300, async () => ({ ok: true }));
      await execute(`
        (function () {
          const host = document.getElementById('variants');
          host.innerHTML = '';
          const make = (variant) => {
            const f = document.createElement('iframe');
            f.setAttribute('sandbox', ${JSON.stringify(STATIC_SANDBOX)});
            f.dataset.variant = variant;
            f.style.cssText = 'width:360px;height:240px;border:0;display:block;';
            host.appendChild(f);
            return f;
          };
          const blob = URL.createObjectURL(new Blob([window.__ENTITY_HARNESS_INPUT__.content], { type: 'text/html' }));
          make('blob-plain').src = blob;
          make('blob-fragment').src = blob + '#wiki-content';
          make('srcdoc').setAttribute('srcdoc', window.__ENTITY_HARNESS_INPUT__.content);
          make('http-fragment').src = '/raw/quickstart.html#wiki-content';
        })();
      `);
      await delay(2500);
      for (const variant of ['blob-plain', 'blob-fragment', 'srcdoc', 'http-fragment']) {
        const el = await findElement(`iframe[data-variant="${variant}"]`).catch(() => null);
        if (!el) {
          evidence.variants[variant] = { rendered: false, reason: 'iframe not found' };
          continue;
        }
        await switchFrame(el);
        const probe = await poll(4000, 400, async () => {
          const p = await probeFrame().catch(() => ({ anchorVisible: false, textLength: 0 }));
          return { ok: p.anchorVisible && p.textLength > 500, ...p };
        });
        await switchFrame(null);
        evidence.variants[variant] = { rendered: probe.anchorVisible === true, frameUrl: probe.url, textLength: probe.textLength, sample: probe.sample };
      }
      const shot = await wd('GET', `/session/${sid}/screenshot`);
      await writeFile(path.join(outDirEngine, 'variants.png'), Buffer.from(shot, 'base64'));
      evidence.screenshots.push(path.join(outDirEngine, 'variants.png'));
    } catch (error) {
      evidence.variants.error = error.message.split('\n')[0];
    }

    await wd('DELETE', `/session/${sid}`).catch(() => {});
  } catch (error) {
    evidence.fatal = error.message.split('\n')[0];
    evidence.driverLog = driverOutput.join('').slice(-500);
    evidence.ok = false;
  } finally {
    driver.kill('SIGTERM');
  }
  return evidence;
}

async function main() {
  const playwright = engines.some((e) => e !== 'safari') ? loadPlaywright() : null;
  const wikiPage = await readFile(path.join(REPO_ROOT, WIKI_PAGE_REL), 'utf8');

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'entity-html-preview-harness-'));
  await mkdir(path.join(tmpDir), { recursive: true });
  await mkdir(outDir, { recursive: true });

  const harnessInput = `window.__ENTITY_HARNESS_INPUT__ = ${JSON.stringify({
    content: wikiPage,
    filePath: 'quickstart.html',
    rawFileUrl: '/raw/quickstart.html',
  })};\n`;
  await writeFile(path.join(tmpDir, 'harness-input.js'), harnessInput);
  await writeFile(
    path.join(tmpDir, 'index.html'),
    `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%}
#viewer-root{height:720px;width:100%;overflow:hidden;display:flex;flex-direction:column}
#viewer-root iframe{height:100%;width:100%;border:0}
#variants iframe{display:block}
</style></head><body>
<div id="viewer-root"></div>
<div id="variants"></div>
<script>window.STATIC_SANDBOX_VALUE = ${JSON.stringify(STATIC_SANDBOX)};</script>
<script src="/harness-input.js"></script>
<script src="/harness-bundle.js"></script>
</body></html>`
  );

  const esbuild = createRequire(path.join(REPO_ROOT, 'noop.js'))('esbuild');
  await esbuild.build({
    entryPoints: [path.join(SCRIPT_DIR, 'harnesses', 'StaticHtmlPreviewHarness.tsx')],
    bundle: true,
    format: 'iife',
    outfile: path.join(tmpDir, 'harness-bundle.js'),
    loader: { '.tsx': 'tsx' },
    jsx: 'automatic',
    platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...(!noAppCsp ? APP_HEADERS : {}) });
      res.end(readFileSync(path.join(tmpDir, 'index.html')));
      return;
    }
    if (url.pathname === '/harness-input.js' || url.pathname === '/harness-bundle.js') {
      const file = readFileSync(path.join(tmpDir, url.pathname.slice(1)));
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(file);
      return;
    }
    if (url.pathname === '/raw/quickstart.html') {
      // Mirrors /api/file/raw inline behavior for text/html candidates.
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': 'inline; filename="quickstart.html"',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(wikiPage);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const serverUrl = `http://127.0.0.1:${server.address().port}`;

  const results = [];
  for (const engineType of engines) {
    const outDirEngine = path.join(outDir, engineType);
    await mkdir(outDirEngine, { recursive: true });
    const evidence = await runEngine({ playwright, engineType, wikiPage, serverUrl, outDirEngine });
    await writeFile(
      path.join(outDirEngine, 'evidence.json'),
      `${JSON.stringify({ node: process.version, serverUrl, ...evidence }, null, 2)}\n`
    );
    results.push(evidence);
    console.log(`[${engineType}] component cases:`, JSON.stringify(
      Object.fromEntries(Object.entries(evidence.cases).map(([k, v]) => [k, v.pass ?? v.previewAfterSource ?? false]))
    ));
    console.log(`[${engineType}] strategy variants:`, JSON.stringify(
      Object.fromEntries(Object.entries(evidence.variants).map(([k, v]) => [k, v.rendered ?? false]))
    ));
    console.log(`[${engineType}] evidence: ${path.join(outDirEngine, 'evidence.json')}`);
  }

  server.close();
  const allOk = results.every((r) => r.ok);
  console.log(allOk ? 'RESULT: PASS' : 'RESULT: FAIL');
  process.exitCode = allOk ? 0 : 1;
}

main().catch((error) => {
  console.error('static-html-preview-webkit-proof: fatal:', error);
  process.exitCode = 1;
});
