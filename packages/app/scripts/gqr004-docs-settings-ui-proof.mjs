#!/usr/bin/env node
// GQR-004 UI proof: drives real Chromium through the real Entity app (Admin → Docs) and
// asserts the API-backed provider administration surface:
//   1. All three provider cards render from the redacted admin status API:
//      Google Workspace, Microsoft 365 (new card), and Local Office.
//   2. API-backed detail is visible: the approved sandbox destination, the runtime
//      posture line (sandbox · bootstrap active), and capability-honest mutation lanes
//      (Supported / Not supported / Unavailable with no adapter).
//   3. Fail-closed honesty: fixture-less providers show locked write lanes.
//
// Usage: node packages/app/scripts/gqr004-docs-settings-ui-proof.mjs [baseUrl]
// Requires: a running server (sandbox mode, seeded fixtures) serving the built app, and
// Playwright chromium resolvable via ENTITY_PLAYWRIGHT_NODE_MODULES or repo node_modules.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);

function loadChromium() {
  const candidates = [
    process.env.ENTITY_PLAYWRIGHT_NODE_MODULES,
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', 'node_modules'),
  ].filter(Boolean);
  for (const dir of candidates) {
    try {
      const playwright = require(path.join(dir, 'playwright'));
      return playwright.chromium;
    } catch {
      // try next candidate
    }
  }
  throw new Error('playwright not found; set ENTITY_PLAYWRIGHT_NODE_MODULES');
}

const BASE_URL = process.argv[2] ?? 'http://localhost:3121';
const OUT_DIR = process.env.OUT_DIR ?? path.join(process.cwd(), 'gqr004-browser-evidence');

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const chromium = loadChromium();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const results = [];
  const statusRequests = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/document-integrations/admin/status')) {
      statusRequests.push(`${request.method()} ${url.replace(BASE_URL, '')}`);
    }
  });

  const note = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  // First-run setup wizard may appear a beat after load; skip it when present.
  const skipButton = page.getByRole('button', { name: 'Skip setup', exact: true });
  try {
    await skipButton.first().waitFor({ state: 'visible', timeout: 15000 });
    await skipButton.first().click();
  } catch {
    // No wizard on this database; continue.
  }
  // Let the main shell finish mounting (the top tab bar re-renders once after boot).
  await page.waitForTimeout(2000);

  // Admin → Docs (retry: the tab bar can re-render once more after first paint).
  const adminTab = page.getByRole('button', { name: /^Admin$/ });
  let clicked = false;
  for (let attempt = 0; attempt < 10 && !clicked; attempt += 1) {
    try {
      await adminTab.first().click({ timeout: 5000 });
      clicked = true;
    } catch {
      await page.waitForTimeout(1000);
    }
  }
  if (!clicked) {
    await page.screenshot({ path: path.join(OUT_DIR, 'admin-tab-failure.png'), fullPage: true });
    const text = await page.locator('body').innerText().catch(() => '<body unreadable>');
    console.error('Admin tab never became clickable. Body text head:\n' + text.slice(0, 1500));
    throw new Error('Admin tab never became clickable');
  }
  const docsItem = page.locator('nav[aria-label="Admin settings"] button', { hasText: 'Docs' }).first();
  await docsItem.click();
  await page.waitForSelector('h3:has-text("Google Workspace connection")', { timeout: 30000 });

  const bodyText = await page.locator('body').innerText();

  note('docs: Google Workspace card rendered', bodyText.includes('Google Workspace connection'));
  note('docs: Microsoft 365 card rendered (GQR-004)', bodyText.includes('Microsoft 365 connection'));
  note('docs: Local Office card rendered', bodyText.includes('Local Office connection'));
  note(
    'docs: approved destination rendered from the API',
    bodyText.includes('Q3 Plans folder'),
    'sandbox fixture destination visible in the Google card',
  );
  note(
    'docs: runtime posture line is truthful (sandbox · bootstrap active)',
    /sandbox\s*·\s*bootstrap active/i.test(bodyText),
  );
  note(
    'docs: capability-honest unsupported mutation lane visible',
    bodyText.includes('Not supported'),
  );
  note(
    'docs: unknown lane explains missing capability evidence',
    bodyText.includes('Unavailable (no capability evidence)'),
  );
  note(
    'docs: fixture-less providers keep write lanes locked',
    bodyText.includes('Write lane locked (fail closed)'),
  );
  note(
    'docs: credentials-never-displayed honesty note present',
    bodyText.includes('Credentials are never displayed'),
  );
  note(
    'docs: DocsSettings fetched the redacted admin status API',
    statusRequests.some((entry) => entry.includes('/api/document-integrations/admin/status')),
    statusRequests.join(' | ') || 'no status request observed',
  );

  await page.screenshot({ path: path.join(OUT_DIR, 'docs-provider-cards.png'), fullPage: true });
  await browser.close();

  const failed = results.filter((result) => !result.ok);
  await writeFile(
    path.join(OUT_DIR, 'result.json'),
    JSON.stringify({ baseUrl: BASE_URL, results, failed: failed.length, statusRequests }, null, 2),
  );
  console.log(failed.length === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${failed.length} checks)`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('proof script error:', error);
  process.exit(1);
});
