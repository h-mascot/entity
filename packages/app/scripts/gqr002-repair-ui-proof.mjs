#!/usr/bin/env node
// GQR-002 repair UI proof: extends the truthful-unavailable File Sources
// proof with the two Luna CHANGES_REQUESTED repair behaviors, driven through
// real Chromium against the real Entity app:
//   1. Admin > General > File Sources: "Sync now" is disabled for an enabled
//      unavailable (placeholder connector) source and cannot dispatch a sync
//      request; a supported local source stays actionable.
//   2. Files tree search: typing a query never expands or dispatches search
//      for unavailable sources, while supported sources still search and
//      return results.
//
// Usage: node packages/app/scripts/gqr002-repair-ui-proof.mjs [baseUrl]
// Requires: a running server serving the built app, and Playwright chromium
// resolvable via ENTITY_PLAYWRIGHT_NODE_MODULES or the repo node_modules.
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

const BASE_URL = process.argv[2] ?? 'http://localhost:3211';
const OUT_DIR = process.env.OUT_DIR ?? path.join(process.cwd(), 'gqr002-repair-browser-evidence');
const UNAVAILABLE_NOTICE = 'Not available in this build';
const SEARCH_QUERY = 'gqr002repair';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const chromium = loadChromium();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const results = [];
  const apiRequests = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/fs/search') || url.includes('/sync') || url.includes('/api/sources') || url.includes('/api/fs/sources')) {
      apiRequests.push(`${request.method()} ${url.replace(BASE_URL, '')}`);
    }
  });

  const note = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  // Resolve the seeded source ids from the live API before driving the UI.
  const sourcesPayload = await (await fetch(`${BASE_URL}/api/sources?includeDisabled=true`)).json();
  const githubSource = sourcesPayload.sources.find((source) => source.type === 'github' && source.enabled);
  const localSource = sourcesPayload.sources.find((source) => source.type === 'local' && source.displayName === 'Workspace docs');
  if (!githubSource || !localSource) {
    throw new Error('expected one enabled github source and the seeded Workspace docs local source');
  }

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const skipButton = page.getByRole('button', { name: 'Skip setup', exact: true });
  if (await skipButton.count()) {
    await skipButton.first().click();
  }

  // 1) Files tree: search must never expand or dispatch unavailable sources.
  const headerLocator = page.locator('[data-testid="source-tree-source-header"]');
  if (!(await headerLocator.count())) {
    const filesTab = page.getByRole('button', { name: /^Files$/ });
    if (await filesTab.count()) {
      await filesTab.first().click();
    }
  }
  await page.waitForSelector('[data-testid="source-tree-source-header"]', { timeout: 20000 });

  const githubHeader = page.locator('[data-testid="source-tree-source-header"]', {
    hasText: githubSource.displayName,
  }).first();
  await githubHeader.waitFor({ state: 'visible', timeout: 10000 });

  const searchInput = page.locator('input[aria-label="Search all sources"]');
  await searchInput.waitFor({ state: 'visible', timeout: 10000 });
  const beforeSearch = apiRequests.length;
  await searchInput.fill(SEARCH_QUERY);
  await delay(1500);

  const searchRequests = apiRequests.slice(beforeSearch).filter((entry) => entry.includes('/api/fs/search'));
  note(
    'files: search never dispatches to the unavailable source',
    !searchRequests.some((entry) => entry.includes(`sourceId=${githubSource.id}`)),
    searchRequests.join(' | ') || 'no search requests observed'
  );
  note(
    'files: search still dispatches to the supported source',
    searchRequests.some((entry) => entry.includes(`sourceId=${localSource.id}`)),
    searchRequests.filter((entry) => entry.includes(`sourceId=${localSource.id}`)).join(' | ') || 'missing local search request'
  );
  const treeText = await page.locator('[data-testid="source-tree-source-header"]').allInnerTexts();
  const githubText = treeText.find((text) => text.includes(githubSource.displayName)) ?? '';
  note(
    'files: unavailable source is not auto-expanded by search',
    !githubText.includes('▾'),
    `github header text: ${githubText.replace(/\n/g, ' / ')}`
  );
  const localBody = page.locator('button', { hasText: /needle-repair\.md|Deep doc/ }).first();
  note(
    'files: supported source search returns real results',
    await localBody.isVisible().catch(() => false),
    'expected a matching search result node under the local source'
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'files-search.png'), fullPage: false });

  // 2) Admin > General > File Sources: Sync now must be unavailable-truthful.
  const adminTab = page.getByRole('button', { name: /^Admin$/ });
  await adminTab.first().click();
  const generalItem = page.locator('nav[aria-label="Admin settings"] button', { hasText: 'General' }).first();
  await generalItem.click();
  await page.waitForSelector('[data-testid="source-unavailable-badge"]', { timeout: 20000 });

  const badge = page.locator('[data-testid="source-unavailable-badge"]', { hasText: UNAVAILABLE_NOTICE }).first();
  note(
    'admin: configured unavailable source carries the visible badge',
    await badge.isVisible().catch(() => false)
  );

  const githubCard = badge.locator('xpath=ancestor::div[contains(@class,"rounded")][1]');
  const githubSync = githubCard.getByRole('button', { name: 'Sync now', exact: true });
  note(
    'admin: Sync now is disabled for the unavailable source',
    (await githubSync.isDisabled()),
    'Sync now must not dispatch an index run that cannot succeed'
  );
  const beforeSync = apiRequests.length;
  await githubSync.click({ force: true, timeout: 2000 }).catch(() => {});
  await delay(1000);
  note(
    'admin: forced click on disabled Sync dispatches no sync request',
    !apiRequests.slice(beforeSync).some((entry) => entry.includes(`/${githubSource.id}/sync`)),
    apiRequests.slice(beforeSync).filter((entry) => entry.includes('/sync')).join(' | ') || 'no sync requests'
  );

  const localCard = page.locator('div.rounded', { hasText: 'Workspace docs' }).filter({
    has: page.getByRole('button', { name: 'Sync now', exact: true }),
  }).first();
  const localSync = localCard.getByRole('button', { name: 'Sync now', exact: true });
  note(
    'admin: Sync now stays enabled for the supported source',
    !(await localSync.isDisabled()),
    'supported connectors must keep their sync action'
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'admin-sync.png'), fullPage: false });

  await browser.close();

  const failed = results.filter((result) => !result.ok);
  await writeFile(
    path.join(OUT_DIR, 'result.json'),
    JSON.stringify({ baseUrl: BASE_URL, results, failed: failed.length, apiRequests }, null, 2)
  );
  console.log(failed.length === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${failed.length} checks)`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('proof script error:', error);
  process.exit(1);
});
