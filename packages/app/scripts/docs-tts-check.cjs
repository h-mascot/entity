#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = 'http://127.0.0.1:5173';
const OUT_DIR = path.join(__dirname, 'artifacts', 'docs-tts-check');

fs.mkdirSync(OUT_DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'dark',
  });
  const page = await context.newPage();

  // Set auth not required
  await page.addInitScript(() => {
    window.localStorage.setItem('entity.auth.login-required.v1', 'false');
    window.localStorage.setItem('entity.theme.v1', 'dark');
    window.localStorage.removeItem('entity.sidebar.tab');
  });

  // Mock API responses
  await page.route('**/api/docs/**', async (route) => {
    const body = {
      content: `# Entity MC Context

## Purpose

Entity is the standard bootstrap skill for deploying Entity Mission Control helper tooling to crew agents without manual script copying.

## Why it exists

Previous deployments relied on copying scripts by hand into agent homes.

## Architecture

Shared runtime services coordinate files, tasks, agents, services, chat, and admin operations.`,
      path: 'memory/entity-mc-context.md',
      filename: 'entity-mc-context.md',
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  await page.route('**/api/plugins', async (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plugins: [] }) })
  );
  await page.route('**/api/entity-services/registry', async (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ services: [] }) })
  );
  await page.route('**/api/agents', async (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  );
  await page.route('**/api/tasks', async (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  );
  await page.route('**/api/files/**', async (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  );
  await page.route('**/api/chat/setup', async (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ categories: [], channels: [] }) })
  );

  await page.goto(`${BASE_URL}/docs/memory/entity-mc-context.md`, { waitUntil: 'networkidle', timeout: 15000 });

  // Check if TTS controls exist and their position relative to h1
  const check = await page.evaluate(() => {
    // Look for the full-mode TTS container (mb-4 rounded-xl...)
    const controls = document.querySelector('.mb-4.rounded-xl');
    const h1 = document.querySelector('h1');

    // Check all children of the content container
    const container = document.querySelector('.mx-auto.max-w-4xl.p-8') || document.querySelector('main');

    let h1Position = null;
    let controlsPosition = null;
    let h1Index = null;
    let controlsIndex = null;

    if (container) {
      const allChildren = Array.from(container.querySelectorAll(':scope > *'));
      allChildren.forEach((child, idx) => {
        if (child === h1) {
          h1Position = child.getBoundingClientRect().top;
          h1Index = idx;
        }
        if (child === controls || child.contains(controls)) {
          controlsPosition = child.getBoundingClientRect().top;
          controlsIndex = idx;
        }
      });
    }

    // Direct h1 position
    const h1Rect = h1?.getBoundingClientRect();
    const controlsRect = controls?.getBoundingClientRect();

    return {
      controlsFound: !!controls,
      h1Found: !!h1,
      h1Top: h1Rect?.top,
      controlsTop: controlsRect?.top,
      controlsAboveH1: controlsRect && h1Rect ? controlsRect.top < h1Rect.top : null,
      h1Index,
      controlsIndex,
      containerClass: container?.className,
    };
  });

  console.log('Position check:', JSON.stringify(check, null, 2));

  await page.screenshot({ path: path.join(OUT_DIR, 'docs-tts-top.png'), fullPage: false, animations: 'disabled' });

  await browser.close();

  console.log('Full position check:', JSON.stringify(check, null, 2));

  if (check.controlsAboveH1) {
    console.log('✅ TTS controls appear ABOVE the h1 heading');
  } else if (check.controlsFound && check.h1Found && check.h1Top !== null && check.controlsTop !== null) {
    console.log(`❌ TTS controls appear BELOW the h1 heading (TTS top: ${check.controlsTop}, h1 top: ${check.h1Top})`);
  } else if (check.controlsFound && check.h1Found && check.controlsIndex !== null && check.h1Index !== null) {
    console.log(`❌ TTS controls (index ${check.controlsIndex}) appear AFTER h1 (index ${check.h1Index}) in DOM order`);
  } else {
    console.log('⚠️ Could not determine relative positions');
  }
})();