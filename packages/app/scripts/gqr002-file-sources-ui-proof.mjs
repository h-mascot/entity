#!/usr/bin/env node
// GQR-002 UI proof: drives real Chromium through the real Entity app and
// asserts the truthful-unavailable File Sources behavior:
//   1. Files tree: unavailable (placeholder connector) sources stay listed,
//      visibly say "Not available in this build", cannot be expanded, and
//      never issue a tree request; available local sources still expand.
//   2. Admin > General > File Sources: unsupported source types are disabled
//      and labeled "(coming soon)" in Add Source; the configured unavailable
//      source carries the badge; Test still returns truthful fail-closed
//      diagnostics (Admin diagnostics preserved).
//
// Usage: node packages/app/scripts/gqr002-file-sources-ui-proof.mjs [baseUrl]
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
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const playwright = require(path.join(dir, 'playwright'));
      return playwright.chromium;
    } catch {
      // try next candidate
    }
  }
  throw new Error('playwright not found; set ENTITY_PLAYWRIGHT_NODE_MODULES');
}

const BASE_URL = process.argv[2] ?? 'http://127.0.0.1:3211';
const OUT_DIR = process.env.OUT_DIR ?? path.join(process.cwd(), 'gqr002-browser-evidence');
const UNAVAILABLE_NOTICE = 'Not available in this build';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const chromium = loadChromium();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const results = [];
  const treeRequests = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/fs/tree') || url.includes('/api/fs/sources') || url.includes('/api/sources')) {
      treeRequests.push(`${request.method()} ${url.replace(BASE_URL, '')}`);
    }
  });

  const note = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  // First-run setup wizard can be skipped without side effects for this proof.
  const skipButton = page.getByRole('button', { name: 'Skip setup', exact: true });
  if (await skipButton.count()) {
    await skipButton.first().click();
  }

  // 1) Files tree
  const filesTab = page.getByRole('button', { name: /^Files$/ });
  if (await filesTab.count()) {
    await filesTab.first().click();
  }
  await page.waitForSelector('[data-testid="source-tree-source-header"]', { timeout: 20000 });

  const githubHeader = page.locator('[data-testid="source-tree-source-header"]', {
    hasText: 'GitHub upstream',
  }).first();
  await githubHeader.waitFor({ state: 'visible', timeout: 10000 });
  const githubDisabled = await githubHeader.getAttribute('disabled');
  note('files: unavailable source header is disabled', githubDisabled !== null, `disabled=${githubDisabled}`);
  note(
    'files: unavailable source shows the visible notice',
    (await githubHeader.innerText()).includes(UNAVAILABLE_NOTICE)
  );
  note(
    'files: unavailable source never renders an expanded caret',
    !(await githubHeader.innerText()).includes('▾'),
    'header must not claim an expanded state it cannot honor'
  );

  const beforeClick = treeRequests.filter((entry) => entry.includes('/api/fs/tree')).length;
  await githubHeader.click({ force: true, timeout: 2000 }).catch(() => {});
  await delay(800);
  const treeCallsForGithub = treeRequests.filter((entry) => entry.includes('/api/fs/tree'));
  note(
    'files: clicking the unavailable header issues no tree request',
    treeCallsForGithub.length === beforeClick,
    `tree requests total=${treeCallsForGithub.length}`
  );

  const localHeader = page.locator('[data-testid="source-tree-source-header"]', {
    hasText: 'Workspace docs',
  }).first();
  await localHeader.waitFor({ state: 'visible', timeout: 10000 });
  note('files: available source header is not disabled', (await localHeader.getAttribute('disabled')) === null);
  note('files: available source has no unavailability notice', !((await localHeader.innerText()).includes(UNAVAILABLE_NOTICE)));
  await localHeader.click();
  await delay(1500);
  note(
    'files: available source expands and loads its tree',
    treeRequests.some((entry) => entry.includes('/api/fs/tree')),
    'tree request issued after expanding local source'
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'files-tree.png'), fullPage: false });

  // 2) Admin > General > File Sources
  const adminTab = page.getByRole('button', { name: /^Admin$/ });
  await adminTab.first().click();
  const generalItem = page.locator('nav[aria-label="Admin settings"] button', { hasText: 'General' }).first();
  await generalItem.click();
  await page.waitForSelector('select[aria-label="Source type"]', { timeout: 20000 });

  const optionState = await page.evaluate(() => {
    const select = document.querySelector('select[aria-label="Source type"]');
    return Array.from(select?.options ?? []).map((option) => ({
      value: option.value,
      disabled: option.disabled,
      label: option.textContent?.trim() ?? '',
    }));
  });
  for (const type of ['github', 's3', 'custom']) {
    const state = optionState.find((option) => option.value === type);
    note(
      `admin: ${type} option is disabled and labeled coming soon`,
      Boolean(state && state.disabled && /coming soon/i.test(state.label)),
      state ? `label="${state.label}" disabled=${state.disabled}` : 'option missing'
    );
  }
  for (const type of ['local', 'docsify', 'http-markdown']) {
    const state = optionState.find((option) => option.value === type);
    note(
      `admin: ${type} option stays selectable`,
      Boolean(state && !state.disabled),
      state ? `label="${state.label}"` : 'option missing'
    );
  }
  await page.screenshot({ path: path.join(OUT_DIR, 'admin-add-source.png'), fullPage: false });

  const badge = page.locator('[data-testid="source-unavailable-badge"]', { hasText: UNAVAILABLE_NOTICE }).first();
  note(
    'admin: configured unavailable source carries the visible badge',
    await badge.isVisible().catch(() => false)
  );

  const githubCard = badge.locator('xpath=ancestor::div[contains(@class,"rounded")][1]');
  const testButton = githubCard.getByRole('button', { name: 'Test', exact: true });
  if (await testButton.count()) {
    await testButton.first().click();
    await delay(1500);
    const feedback = await githubCard.innerText().catch(() => '');
    note(
      'admin: Test keeps fail-closed truthful diagnostics',
      /not implemented/i.test(feedback),
      feedback.split('\n').find((line) => /not implemented/i.test(line)) ?? 'no feedback text found'
    );
  } else {
    note('admin: Test button present on unavailable source card', false, 'Test button not found');
  }
  await page.screenshot({ path: path.join(OUT_DIR, 'admin-source-diagnostics.png'), fullPage: false });

  await browser.close();

  const failed = results.filter((result) => !result.ok);
  await writeFile(
    path.join(OUT_DIR, 'result.json'),
    JSON.stringify({ baseUrl: BASE_URL, results, failed: failed.length, treeRequests }, null, 2)
  );
  console.log(failed.length === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${failed.length} checks)`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('proof script error:', error);
  process.exit(1);
});
