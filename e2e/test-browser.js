#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const AGENT_BROWSER_BIN = process.env.AGENT_BROWSER_BIN || 'agent-browser';
const SESSION = process.env.AGENT_BROWSER_SESSION || `entity-e2e-${Date.now()}`;
const APP_URL = process.env.E2E_APP_URL || 'http://127.0.0.1:5173';
const API_HEALTH_URL = process.env.E2E_API_HEALTH_URL || 'http://127.0.0.1:3001/api/tasks';
const AUTO_START = process.env.E2E_USE_EXISTING_SERVERS !== '1';
const READINESS_TIMEOUT_MS = Number(process.env.E2E_READINESS_TIMEOUT_MS || 90000);
const CONDITION_TIMEOUT_MS = Number(process.env.E2E_CONDITION_TIMEOUT_MS || 35000);
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const managedProcesses = [];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatResult(result) {
  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();
  if (stdout && stderr) {
    return `${stdout}\n${stderr}`;
  }
  return stdout || stderr || '(no output)';
}

function runCommand(command, args, options = {}) {
  const {
    allowFailure = false,
    cwd = ROOT_DIR,
    env = process.env,
    timeoutMs = 60000,
  } = options;

  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error && result.error.code === 'ETIMEDOUT') {
    throw new Error(`Command timed out: ${command} ${args.join(' ')}`);
  }

  if (!allowFailure && result.status !== 0) {
    throw new Error(
      `Command failed (${result.status}): ${command} ${args.join(' ')}\n${formatResult(result)}`
    );
  }

  return result;
}

function runAgentBrowser(args, options = {}) {
  const finalArgs = options.skipSession ? args : [...args, '--session', SESSION];
  return runCommand(AGENT_BROWSER_BIN, finalArgs, options);
}

function startManagedProcess(name, args) {
  const logsDir = path.join(os.tmpdir(), 'entity-e2e-logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const logPath = path.join(logsDir, `${name}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });

  logStream.write(`[${new Date().toISOString()}] starting ${npmBin} ${args.join(' ')}\n`);

  const child = spawn(npmBin, args, {
    cwd: ROOT_DIR,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.pipe(logStream, { end: false });
  child.stderr.pipe(logStream, { end: false });
  child.on('exit', (code, signal) => {
    logStream.write(`\n[${new Date().toISOString()}] exited code=${code} signal=${signal || 'none'}\n`);
  });

  const managed = { name, child, logPath, logStream };
  managedProcesses.push(managed);
  return managed;
}

function checkManagedProcessHealth() {
  for (const managed of managedProcesses) {
    if (managed.child.exitCode !== null) {
      throw new Error(
        `${managed.name} exited early with code ${managed.child.exitCode}. Check log: ${managed.logPath}`
      );
    }
  }
}

async function stopManagedProcesses() {
  for (const managed of managedProcesses.reverse()) {
    try {
      if (managed.child.exitCode === null) {
        managed.child.kill('SIGTERM');
        const stopDeadline = Date.now() + 8000;
        while (managed.child.exitCode === null && Date.now() < stopDeadline) {
          await delay(100);
        }
        if (managed.child.exitCode === null) {
          managed.child.kill('SIGKILL');
        }
      }
    } catch {
      // Best-effort teardown.
    } finally {
      managed.logStream.end();
    }
  }
}

async function isUrlReachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function waitForUrl(url, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    checkManagedProcessHealth();
    if (await isUrlReachable(url)) {
      return;
    }
    await delay(500);
  }
  throw new Error(`${label} did not become reachable at ${url} within ${timeoutMs}ms`);
}

function jsStringLiteral(value) {
  return JSON.stringify(value);
}

async function waitForBrowserCondition(description, expression, timeoutMs = CONDITION_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '(no error output)';

  while (Date.now() < deadline) {
    checkManagedProcessHealth();
    const result = runAgentBrowser(['eval', expression], { allowFailure: true, timeoutMs: 20000 });
    if (result.status === 0) {
      return;
    }
    lastError = formatResult(result);
    await delay(1000);
  }

  throw new Error(`Timed out waiting for ${description}. Last error:\n${lastError}`);
}

function ensureAgentBrowser() {
  runCommand(AGENT_BROWSER_BIN, ['--version']);

  const probe = runAgentBrowser(['open', 'about:blank'], { allowFailure: true });
  if (probe.status === 0) {
    runAgentBrowser(['close'], { allowFailure: true });
    return;
  }

  const output = formatResult(probe).toLowerCase();
  if (output.includes('install') || output.includes('executable')) {
    console.log('Installing browser binaries for agent-browser...');
    runAgentBrowser(['install'], { skipSession: true, timeoutMs: 180000 });
    runAgentBrowser(['open', 'about:blank']);
    runAgentBrowser(['close'], { allowFailure: true });
    return;
  }

  throw new Error(`agent-browser is available but could not launch a browser.\n${formatResult(probe)}`);
}

async function startServersIfNeeded() {
  const appAlreadyRunning = await isUrlReachable(APP_URL);
  const apiAlreadyRunning = await isUrlReachable(API_HEALTH_URL);

  if (!AUTO_START) {
    if (!appAlreadyRunning || !apiAlreadyRunning) {
      throw new Error(
        `E2E_USE_EXISTING_SERVERS=1 is set, but app/API are not both reachable.\n` +
          `App: ${APP_URL} (${appAlreadyRunning ? 'up' : 'down'})\n` +
          `API: ${API_HEALTH_URL} (${apiAlreadyRunning ? 'up' : 'down'})`
      );
    }
    return;
  }

  if (!apiAlreadyRunning) {
    startManagedProcess('server', ['--prefix', 'packages/server', 'run', 'dev']);
  }

  if (!appAlreadyRunning) {
    startManagedProcess('app', [
      '--prefix',
      'packages/app',
      'run',
      'dev',
      '--',
      '--host',
      '127.0.0.1',
      '--port',
      '5173',
    ]);
  }

  await waitForUrl(API_HEALTH_URL, 'Task API', READINESS_TIMEOUT_MS);
  await waitForUrl(APP_URL, 'App UI', READINESS_TIMEOUT_MS);
}

async function runE2e() {
  const taskId = 400;
  const taskSelector = `[data-testid="mc-task-card-${taskId}"]`;
  const chatMessage = `E2E live verification ping ${Date.now()}`;
  const chatMessageLiteral = jsStringLiteral(chatMessage);

  runAgentBrowser(['set', 'viewport', '1440', '900']);
  runAgentBrowser(['open', APP_URL], { timeoutMs: 90000 });
  runAgentBrowser(['wait', '1500']);

  await waitForBrowserCondition(
    'login overlay or workspace shell',
    `
(() => {
  const text = document.body.innerText || '';
  if (text.includes('Login') || text.includes('Files') || text.includes('Tasks')) {
    return true;
  }
  throw new Error('Neither login overlay nor workspace shell is visible yet.');
})()
`.trim(),
    20000
  );

  runAgentBrowser([
    'eval',
    `
(() => {
  const text = document.body.innerText || '';
  if (!text.includes('Login')) {
    return 'login-not-required';
  }
  const username = document.querySelector('#loginUsername');
  const password = document.querySelector('#loginPassword');
  if (!username || !password) {
    throw new Error('Login inputs not found.');
  }
  username.focus();
  username.value = 'Henry';
  username.dispatchEvent(new Event('input', { bubbles: true }));
  username.dispatchEvent(new Event('change', { bubbles: true }));
  password.focus();
  password.value = 'mission';
  password.dispatchEvent(new Event('input', { bubbles: true }));
  password.dispatchEvent(new Event('change', { bubbles: true }));
  const form = document.querySelector('#loginOverlay form');
  if (!form) {
    throw new Error('Login form not found.');
  }
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return 'login-submitted';
})()
`.trim(),
  ]);

  await waitForBrowserCondition(
    'workspace shell after login',
    `
(() => {
  const loginOverlay = document.querySelector('#loginOverlay');
  const overlayVisible = Boolean(loginOverlay && getComputedStyle(loginOverlay).display !== 'none');
  const text = document.body.innerText || '';
  if (!overlayVisible && text.includes('Files') && text.includes('Tasks')) {
    return true;
  }
  throw new Error('Workspace shell not ready after login.');
})()
`.trim(),
    20000
  );

  runAgentBrowser([
    'eval',
    `
(() => {
  const isVisible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const buttons = Array.from(document.querySelectorAll('button'));
  const taskButton = buttons.find((button) => {
    const label = (button.textContent || '').toLowerCase();
    return label.includes('tasks') && isVisible(button);
  });
  if (!taskButton) {
    throw new Error('Unable to find visible Tasks button.');
  }
  taskButton.click();
  return true;
})()
`.trim(),
  ]);

  await waitForBrowserCondition(
    'task board to render',
    `
(() => {
  const text = document.body.innerText || '';
  const required = ['Kanban', 'Strategic', 'Insights', 'Swarm', 'Backlog', 'Todo', 'Doing', 'Review', 'Done'];
  for (const label of required) {
    if (!text.includes(label)) {
      throw new Error('Missing tasks UI label: ' + label);
    }
  }
  const card = document.querySelector(${jsStringLiteral(taskSelector)});
  if (!card) {
    throw new Error('Known task card not found: ' + ${jsStringLiteral(taskSelector)});
  }
  return true;
})()
`.trim()
  );

  runAgentBrowser([
    'eval',
    `
(() => {
  const card = document.querySelector(${jsStringLiteral(taskSelector)});
  if (!card) {
    throw new Error('Known task card not found for click.');
  }
  card.click();
  return true;
})()
`.trim(),
  ]);

  await waitForBrowserCondition(
    'task detail panel to render',
    `
(() => {
  const dialog = document.querySelector('[aria-label="Task detail"]');
  if (!dialog) {
    throw new Error('Task detail dialog not visible yet.');
  }
  const closeButton = dialog.querySelector('[aria-label="Close task detail"]');
  if (!closeButton) {
    throw new Error('Close task detail button missing.');
  }
  const text = dialog.textContent || '';
  if (!text.includes('Task #400')) {
    throw new Error('Task detail content missing task #400.');
  }
  return true;
})()
`.trim(),
    30000
  );

  runAgentBrowser([
    'eval',
    `
(() => {
  const isVisible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const buttons = Array.from(document.querySelectorAll('button'));
  const chatButton = buttons.find((button) => {
    const label = (button.textContent || '').toLowerCase();
    return label.includes('chat') && isVisible(button);
  });
  if (!chatButton) {
    throw new Error('Unable to find visible Chat button.');
  }
  chatButton.click();
  return true;
})()
`.trim(),
  ]);

  await waitForBrowserCondition(
    'chat view to render',
    `
(() => {
  const text = document.body.innerText || '';
  const required = ['CHAT', 'Mission Channels', '#ada', 'Send'];
  for (const label of required) {
    if (!text.includes(label)) {
      throw new Error('Missing chat UI label: ' + label);
    }
  }
  return true;
})()
`.trim(),
    30000
  );

  await waitForBrowserCondition(
    'chat composer to be available',
    `
(() => {
  const input = Array.from(document.querySelectorAll('textarea, input')).find((el) => {
    const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
    return placeholder.includes('message');
  });
  if (!input) {
    throw new Error('Chat composer input not found.');
  }
  return true;
})()
`.trim(),
    20000
  );

  runAgentBrowser(['type', 'textarea[placeholder*="Message"], textarea[placeholder*="message"], input[placeholder*="Message"], input[placeholder*="message"]', chatMessage]);
  runAgentBrowser([
    'eval',
    `
(() => {
  const isVisible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const sendButton = Array.from(document.querySelectorAll('button')).find((button) => {
    const label = (button.textContent || '').trim().toLowerCase();
    return label === 'send' && isVisible(button);
  });
  if (!sendButton) {
    throw new Error('Send button not found.');
  }
  sendButton.click();
  return true;
})()
`.trim(),
  ]);

  await waitForBrowserCondition(
    'chat message to appear',
    `
(() => {
  const text = document.body.innerText || '';
  if (!text.includes(${chatMessageLiteral})) {
    throw new Error('Chat message not visible yet.');
  }
  return true;
})()
`.trim(),
    45000
  );

  const artifactDir = path.join(ROOT_DIR, 'e2e', 'artifacts');
  fs.mkdirSync(artifactDir, { recursive: true });
  runAgentBrowser(['screenshot', path.join(artifactDir, 'test-browser.png')], { allowFailure: true });

  console.log(`E2E passed. Verified task board, task detail, and chat send flow using task #${taskId}.`);
}

async function main() {
  try {
    ensureAgentBrowser();
    await startServersIfNeeded();
    await runE2e();
  } finally {
    runAgentBrowser(['close'], { allowFailure: true });
    await stopManagedProcesses();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
