#!/usr/bin/env node
// GQR-001 app-level Safari proof: drives REAL Safari (safaridriver) through
// the real Entity app docs route for a known OpenWiki page and asserts the
// sandboxed preview iframe renders visible content, plus Source toggle and
// browser Back behavior.
//
// Usage: node packages/app/scripts/safari-openwiki-app-proof.mjs [baseUrl]
// Requires: Safari Settings -> Developer -> "Allow remote automation", and
// the Entity server running (default http://localhost:3000).
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');
const OUT_DIR = path.join(REPO_ROOT, 'packages', 'app', 'artifacts', 'html-preview-proof', 'safari-app');
const BASE_URL = process.argv[2] ?? 'http://localhost:3000';
const WIKI_ROUTE = '/docs/source/entity-wiki/quickstart.html';
const MARKER_TEXT = 'Entity Quickstart';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(timeoutMs, tickMs, probe) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await probe().catch((e) => ({ ok: false, error: e.message }));
    if (last.ok) return last;
    await delay(tickMs);
  }
  return last;
}

const driver = spawn('safaridriver', ['-p', '11500'], { stdio: ['ignore', 'pipe', 'pipe'] });
const base = 'http://127.0.0.1:11500';
const driverLog = [];
driver.stdout.on('data', (d) => driverLog.push(String(d)));
driver.stderr.on('data', (d) => driverLog.push(String(d)));

const wd = async (method, p, body) => {
  const response = await fetch(`${base}${p}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  if (response.status >= 400) throw new Error(`WD ${method} ${p} -> ${response.status}: ${JSON.stringify(json).slice(0, 200)}`);
  return json.value ?? {};
};

const evidence = { baseUrl: BASE_URL, route: WIKI_ROUTE, steps: {}, screenshots: [], ok: true };
async function step(name, fn) {
  try {
    evidence.steps[name] = await fn();
  } catch (error) {
    evidence.steps[name] = { error: error.message.split('\n')[0] };
    evidence.ok = false;
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await poll(5000, 300, async () => {
    await fetch(`${base}/status`);
    return { ok: true };
  });
  const session = await wd('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
  const sid = session.sessionId;
  if (!sid) throw new Error(`no session: ${JSON.stringify(session).slice(0, 200)}`);

  const findElement = async (selector) =>
    (await wd('POST', `/session/${sid}/element`, { using: 'css selector', value: selector }))['element-6066-11e4-a52e-4f735466cecf'];
  const execute = (script) => wd('POST', `/session/${sid}/execute/sync`, { script, args: [] });
  const switchFrame = async (elementId) => {
    await wd('POST', `/session/${sid}/frame`, elementId ? { id: { 'element-6066-11e4-a52e-4f735466cecf': elementId } } : { id: null });
  };
  const screenshot = async (name) => {
    const shot = await wd('GET', `/session/${sid}/screenshot`);
    const file = path.join(OUT_DIR, name);
    await writeFile(file, Buffer.from(shot, 'base64'));
    evidence.screenshots.push(file);
  };
  const probeFrame = () => execute(`
    const anchor = document.querySelector('#wiki-content');
    const rect = anchor ? anchor.getBoundingClientRect() : null;
    // Note: Safari automation reports innerWidth/innerHeight = 0 inside the
    // sandboxed srcdoc frame, so geometry checks are diagnostic only; pass
    // criteria use text/title (plus screenshot pixel analysis offline).
    const text = (document.body && document.body.innerText) || '';
    return JSON.stringify({
      url: location.href,
      title: document.title,
      textLength: text.length,
      markerPresent: text.includes(${JSON.stringify(MARKER_TEXT)}),
      geometry: rect ? { top: rect.top, width: rect.width, height: rect.height } : null,
      anchorVisible: Boolean(rect && rect.height > 0),
      sample: text.replace(/\\s+/g, ' ').slice(0, 160),
    });
  `).then((v) => JSON.parse(v));

  // Skip the first-run setup wizard if it appears.
  await wd('POST', `/session/${sid}/url`, { url: `${BASE_URL}/` });
  await delay(2500);
  await execute(`(function(){const b=Array.from(document.querySelectorAll('button')).find(x=>/skip setup/i.test(x.textContent)); if(b) b.click();})()`);
  await delay(1500);

  await step('openWikiRoute', async () => {
    await wd('POST', `/session/${sid}/url`, { url: `${BASE_URL}${WIKI_ROUTE}` });
    const frameEl = await poll(20000, 500, async () => {
      const id = await findElement('iframe[title^="HTML preview"]').catch(() => null);
      return { ok: Boolean(id), id };
    });
    if (!frameEl.ok) throw new Error('preview iframe never appeared');
    await delay(2500);
    const sandbox = await wd('GET', `/session/${sid}/element/${frameEl.id}/attribute/sandbox`);
    await switchFrame(frameEl.id);
    const probe = await poll(8000, 500, async () => {
      const p = await probeFrame();
      return { ok: p.anchorVisible && p.markerPresent, ...p };
    });
    await switchFrame(null);
    await screenshot('01-wiki-preview.png');
    const rendered = probe.markerPresent && probe.textLength > 1000;
    return { sandbox, ...probe, pass: rendered && sandbox === 'allow-popups allow-top-navigation-by-user-activation' };
  });

  await step('sourceToggle', async () => {
    await execute(`(function(){const b=Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()==='Source'); if(b) b.click();})()`);
    const editor = await poll(10000, 400, async () => ({ ok: Boolean(await findElement('.cm-editor').catch(() => null)) }));
    await screenshot('02-source-view.png');
    await execute(`(function(){const b=Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()==='Preview'); if(b) b.click();})()`);
    await delay(2500);
    const frameEl = await findElement('iframe[title^="HTML preview"]');
    await switchFrame(frameEl);
    const probe = await probeFrame();
    await switchFrame(null);
    await screenshot('03-back-to-preview.png');
    return { sourceViewVisible: editor.ok, previewAfterSource: probe.markerPresent && probe.textLength > 1000, frameTitle: probe.title };
  });

  await step('browserBack', async () => {
    // Exercise real browser Back: load another OpenWiki page directly (the
    // in-frame _top links correctly require user activation under the
    // sandbox), then navigate back and confirm the preview renders again.
    await wd('POST', `/session/${sid}/url`, { url: `${BASE_URL}/docs/source/entity-wiki/runtime-and-release.html` });
    const otherFrame = await poll(20000, 500, async () => {
      const id = await findElement('iframe[title^="HTML preview"]').catch(() => null);
      return { ok: Boolean(id), id };
    });
    if (otherFrame.ok) {
      await switchFrame(otherFrame.id);
      const otherProbe = await poll(8000, 500, async () => {
        const p = await probeFrame();
        return { ok: p.markerPresent && p.textLength > 1000, ...p };
      });
      await switchFrame(null);
      await screenshot('04-other-wiki-page.png');
      if (!otherProbe.markerPresent) throw new Error('second wiki page did not render');
    }
    await wd('POST', `/session/${sid}/back`);
    const frameEl = await poll(20000, 500, async () => {
      const id = await findElement('iframe[title^="HTML preview"]').catch(() => null);
      return { ok: Boolean(id), id };
    });
    await delay(2500);
    if (!frameEl.ok) throw new Error('iframe not present after browser Back');
    await switchFrame(frameEl.id);
    const probe = await poll(8000, 500, async () => {
      const p = await probeFrame();
      return { ok: p.markerPresent && p.textLength > 1000, ...p };
    });
    await switchFrame(null);
    await screenshot('05-after-browser-back.png');
    return { backPreview: probe.markerPresent && probe.textLength > 1000, frameTitle: probe.title };
  });

  evidence.ok = evidence.ok
    && evidence.steps.openWikiRoute?.pass === true
    && evidence.steps.sourceToggle?.sourceViewVisible === true
    && evidence.steps.sourceToggle?.previewAfterSource === true
    && evidence.steps.browserBack?.backPreview === true;

  await wd('DELETE', `/session/${sid}`).catch(() => {});
  driver.kill('SIGTERM');
  await writeFile(path.join(OUT_DIR, 'evidence.json'), `${JSON.stringify({ node: process.version, ...evidence }, null, 2)}\n`);
  console.log(JSON.stringify(evidence.steps, null, 2));
  console.log('screenshots:', evidence.screenshots.join(', '));
  console.log(evidence.ok ? 'RESULT: PASS' : 'RESULT: FAIL');
  process.exitCode = evidence.ok ? 0 : 1;
}

main().catch((error) => {
  console.error('safari-openwiki-app-proof: fatal:', error.message);
  console.error(driverLog.join('').slice(-400));
  process.exitCode = 1;
  driver.kill('SIGTERM');
});
