const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.ENTITY_CAPTURE_BASE_URL || 'http://127.0.0.1:5173';
const OUT_DIR = path.resolve(__dirname);
const ACTUAL_DIR = path.join(OUT_DIR, 'actual');
const METADATA_DIR = path.join(OUT_DIR, 'metadata');
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

fs.mkdirSync(ACTUAL_DIR, { recursive: true });
fs.mkdirSync(METADATA_DIR, { recursive: true });

const viewSpecs = [
  { id: '01-files', label: 'Files', tab: 'files', url: '/' },
  { id: '02-agents', label: 'Agents', tab: 'agents', url: '/' },
  { id: '03-tasks', label: 'Tasks', tab: 'tasks', url: '/', setup: async (page) => setTasksTab(page, 'kanban') },
  { id: '04-services', label: 'Services', tab: 'services', url: '/' },
  { id: '05-chat', label: 'Chat', tab: 'chat', url: '/' },
  { id: '06-admin', label: 'Admin', tab: 'admin', url: '/', setup: async (page) => setAdminSection(page, 'general') },
  { id: '07-docs-view', label: 'Docs View', url: '/docs/memory/entity-mc-context.md' },
  { id: '08-agent-detail', label: 'Agent Detail View', tab: 'agents', url: '/', setup: openAgentDetail },
  { id: '09-task-detail', label: 'Task Detail View', tab: 'tasks', url: '/', setup: openTaskDetail },
];

async function withStableLocalStorage(page, tab) {
  await page.addInitScript((selectedTab) => {
    window.localStorage.setItem('entity.auth.login-required.v1', 'false');
    window.localStorage.removeItem('entity.auth.session.v1');
    window.localStorage.setItem('entity.sidebar.collapsed.v1', 'false');
    window.localStorage.setItem('entity.theme.v1', 'dark');
    window.localStorage.setItem('entity.tasks.tab', 'kanban');
    if (selectedTab) {
      window.localStorage.setItem('entity.sidebar.tab', selectedTab);
    } else {
      window.localStorage.removeItem('entity.sidebar.tab');
    }
    window.localStorage.removeItem('entity.last.file');
    window.localStorage.removeItem('entity.last.source');
  }, tab || null);
}

async function waitForApp(page) {
  await page.waitForSelector('.entity-shell', { timeout: 20_000 });
  await page.waitForTimeout(1_500);
}

async function setTasksTab(page, tab) {
  await page.evaluate((nextTab) => window.localStorage.setItem('entity.tasks.tab', nextTab), tab);
}

async function setAdminSection(page, section) {
  const button = page.getByRole('button', { name: new RegExp(`^${section === 'missionControl' ? 'Mission Control' : section}$`, 'i') });
  if (await button.count()) {
    await button.first().click();
    await page.waitForTimeout(600);
  }
}

async function openAgentDetail(page) {
  await waitForApp(page);
  const cardSelectors = [
    'button:has-text("Ada")',
    'button:has-text("Book")',
    'button:has-text("Spock")',
    '[role="button"]:has-text("Ada")',
  ];
  for (const selector of cardSelectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      await locator.click({ timeout: 5_000 }).catch(() => undefined);
      await page.waitForTimeout(1_200);
      return;
    }
  }
}

async function openTaskDetail(page) {
  await waitForApp(page);
  const taskCard = page.locator('[data-testid="mc-react-kanban-board"] button, [data-testid="mc-react-kanban-board"] [role="button"], .board button').filter({ hasText: /MB-|task|implement|fix|review|audit/i }).first();
  if (await taskCard.count()) {
    await taskCard.click({ timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(1_500);
    return;
  }

  const fallbackTask = page.locator('.board button, .board [role="button"]').first();
  if (await fallbackTask.count()) {
    await fallbackTask.click({ timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(1_500);
  }
}

async function collectMetadata(page, spec) {
  const serializableSpec = {
    id: spec.id,
    label: spec.label,
    tab: spec.tab || null,
    url: spec.url,
  };
  return page.evaluate((currentSpec) => {
    const text = document.body.innerText.replace(/\s+/g, ' ').slice(0, 5000);
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,[role="heading"]'))
      .map((node) => node.textContent?.trim())
      .filter(Boolean)
      .slice(0, 30);
    const buttons = Array.from(document.querySelectorAll('button,a,select'))
      .map((node) => node.textContent?.trim() || node.getAttribute('aria-label') || node.getAttribute('title') || '')
      .filter(Boolean)
      .slice(0, 80);
    return {
      spec: currentSpec,
      url: window.location.href,
      title: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      headings,
      controls: buttons,
      text,
    };
  }, serializableSpec);
}

async function captureSpec(browser, spec) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  await withStableLocalStorage(page, spec.tab);
  await page.goto(new URL(spec.url, BASE_URL).toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await waitForApp(page);
  if (spec.setup) {
    await spec.setup(page);
  }
  await page.screenshot({
    path: path.join(ACTUAL_DIR, `${spec.id}.png`),
    fullPage: false,
    animations: 'disabled',
  });
  const metadata = await collectMetadata(page, spec);
  fs.writeFileSync(path.join(METADATA_DIR, `${spec.id}.json`), JSON.stringify(metadata, null, 2));
  await context.close();
  return metadata;
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(CHROME_PATH) ? CHROME_PATH : undefined,
  });
  const results = [];
  try {
    for (const spec of viewSpecs) {
      console.log(`Capturing ${spec.id} ${spec.label}`);
      results.push(await captureSpec(browser, spec));
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(METADATA_DIR, 'actual-capture-summary.json'), JSON.stringify(results, null, 2));
})();
