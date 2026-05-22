import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const pinFilePath = path.join(repoRoot, 'docs', 'specs', 'clickclack-sidecar-pin.json');

const DEFAULT_ENTITY_PORT = 3000;
const DEFAULT_TIMEOUT_MS = 1_500;

export function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '');
}

export function loadSidecarPin(env = process.env) {
  const raw = JSON.parse(fs.readFileSync(pinFilePath, 'utf8'));
  const addr = env.CLICKCLACK_ADDR || env.ENTITY_CLICKCLACK_ADDR || raw.sidecar?.bind || '127.0.0.1:3091';
  const dataDir = env.ENTITY_CLICKCLACK_DATA_DIR
    ? path.resolve(env.ENTITY_CLICKCLACK_DATA_DIR)
    : path.resolve(repoRoot, raw.sidecar?.dataDir || 'var/clickclack-sidecar');
  const entityPort = Number(env.PORT || DEFAULT_ENTITY_PORT);
  return {
    name: raw.name || 'clickclack',
    remote: raw.remote,
    checkoutPath: path.resolve(env.ENTITY_CLICKCLACK_CHECKOUT || raw.checkoutPath || '/tmp/clickclack'),
    commit: raw.commit,
    addr,
    baseUrl: normalizeBaseUrl(env.ENTITY_CLICKCLACK_BASE_URL || `http://${addr}`),
    dataDir,
    entityUrl: normalizeBaseUrl(env.ENTITY_URL || `http://127.0.0.1:${entityPort}`),
  };
}

export function splitHostPort(addr) {
  const index = String(addr).lastIndexOf(':');
  if (index < 0) {
    return { host: '127.0.0.1', port: Number(addr) };
  }
  return {
    host: addr.slice(0, index) || '127.0.0.1',
    port: Number(addr.slice(index + 1)),
  };
}

export function execText(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 1024 * 1024 * 4, ...options }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || error.message).trim();
        reject(new Error(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`));
        return;
      }
      resolve(String(stdout ?? '').trim());
    });
  });
}

async function commandVersion(command, args) {
  try {
    const output = await execText(command, args, { timeout: 5_000 });
    return { ok: true, detail: output.split('\n')[0] || `${command} found` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export async function checkSidecarPrerequisites() {
  const checks = [];
  checks.push({ name: 'Node.js available', required: true, ...(await commandVersion('node', ['--version'])) });
  checks.push({ name: 'npm available', required: true, ...(await commandVersion('npm', ['--version'])) });
  checks.push({ name: 'git available', required: true, ...(await commandVersion('git', ['--version'])) });
  checks.push({ name: 'Go available for ClickClack sidecar', required: true, ...(await commandVersion('go', ['version'])) });
  checks.push({
    name: 'ClickClack sidecar pin file exists',
    required: true,
    ok: fs.existsSync(pinFilePath),
    detail: pinFilePath,
  });
  return checks;
}

export function failedRequiredChecks(checks) {
  return checks.filter((check) => check.required && !check.ok);
}

export function ensureSidecarDataDir(pin = loadSidecarPin()) {
  fs.mkdirSync(pin.dataDir, { recursive: true });
  return pin.dataDir;
}

export async function verifyClickClackCheckout(options = {}) {
  const pin = options.pin || loadSidecarPin();
  const install = options.install !== false;

  if (!fs.existsSync(pin.checkoutPath)) {
    if (!install) {
      throw new Error(`ClickClack checkout missing at ${pin.checkoutPath}`);
    }
    fs.mkdirSync(path.dirname(pin.checkoutPath), { recursive: true });
    await execText('git', ['clone', pin.remote, pin.checkoutPath]);
  }

  if (!fs.existsSync(path.join(pin.checkoutPath, '.git'))) {
    throw new Error(`ClickClack checkout is not a git repository: ${pin.checkoutPath}`);
  }

  let head = await execText('git', ['-C', pin.checkoutPath, 'rev-parse', 'HEAD']);
  if (head !== pin.commit) {
    if (!install) {
      throw new Error(`ClickClack checkout is ${head}, expected ${pin.commit}`);
    }
    await execText('git', ['-C', pin.checkoutPath, 'fetch', 'origin', pin.commit]);
    await execText('git', ['-C', pin.checkoutPath, 'checkout', '--detach', pin.commit]);
    head = await execText('git', ['-C', pin.checkoutPath, 'rev-parse', 'HEAD']);
  }

  if (head !== pin.commit) {
    throw new Error(`ClickClack checkout is ${head}, expected ${pin.commit}`);
  }

  const status = await execText('git', ['-C', pin.checkoutPath, 'status', '--short']);
  return { head, clean: status.trim().length === 0, status };
}

export function isTcpPortOpen(host, port, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    if (!Number.isFinite(port) || port <= 0) {
      resolve(false);
      return;
    }
    const socket = net.createConnection({ host, port });
    const done = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

export function isTcpPortAvailable(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ host, port }, () => {
      server.close(() => resolve(true));
    });
  });
}

export async function apiJson(url, init = {}, timeoutMs = 5_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    if (!response.ok) {
      throw new Error(`${url} failed with ${response.status}: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkClickClackHealth(pin = loadSidecarPin()) {
  try {
    const me = await apiJson(`${pin.baseUrl}/api/me`, {}, 2_000);
    const workspaces = await apiJson(`${pin.baseUrl}/api/workspaces`, {}, 2_000);
    return {
      ok: Boolean(me?.user?.id),
      user: me?.user,
      workspaces: Array.isArray(workspaces?.workspaces) ? workspaces.workspaces : [],
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function prefixStream(stream, prefix) {
  let pending = '';
  stream.on('data', (chunk) => {
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) {
        console.log(`${prefix} ${line}`);
      }
    }
  });
  stream.on('end', () => {
    if (pending.trim()) {
      console.log(`${prefix} ${pending}`);
    }
  });
}

export function startClickClackSidecar(pin = loadSidecarPin(), options = {}) {
  ensureSidecarDataDir(pin);
  const stdio = options.stdio || 'pipe';
  const child = spawn('go', [
    'run',
    './apps/api/cmd/clickclack',
    'serve',
    '--addr',
    pin.addr,
    '--data',
    pin.dataDir,
    '--dev-bootstrap=true',
  ], {
    cwd: pin.checkoutPath,
    stdio: stdio === 'inherit' ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...(options.env || {}),
      CLICKCLACK_ADDR: pin.addr,
      CLICKCLACK_DATA: pin.dataDir,
    },
  });

  if (stdio !== 'inherit') {
    const prefix = options.prefix || '[clickclack]';
    if (child.stdout) prefixStream(child.stdout, prefix);
    if (child.stderr) prefixStream(child.stderr, prefix);
  }

  return child;
}

export async function waitForClickClackHealth(pin = loadSidecarPin(), options = {}) {
  const timeoutMs = options.timeoutMs || 20_000;
  const intervalMs = options.intervalMs || 500;
  const startedAt = Date.now();
  let lastHealth = await checkClickClackHealth(pin);
  while (Date.now() - startedAt < timeoutMs) {
    if (lastHealth.ok) {
      return lastHealth;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    lastHealth = await checkClickClackHealth(pin);
  }
  throw new Error(lastHealth.error || `ClickClack did not become healthy at ${pin.baseUrl}`);
}

export async function ensureClickClackSidecar(options = {}) {
  const pin = options.pin || loadSidecarPin();
  const health = await checkClickClackHealth(pin);
  if (health.ok) {
    return { status: 'already-running', child: null, health };
  }

  const { host, port } = splitHostPort(pin.addr);
  const open = await isTcpPortOpen(host, port);
  if (open) {
    throw new Error(`Port ${pin.addr} is in use, but ${pin.baseUrl}/api/me is not healthy`);
  }

  if (options.start === false) {
    return { status: 'stopped', child: null, health };
  }

  await verifyClickClackCheckout({ pin, install: options.install !== false });
  const child = startClickClackSidecar(pin, {
    stdio: options.stdio,
    prefix: options.prefix,
    env: options.env,
  });
  try {
    const exited = new Promise((_, reject) => {
      child.once('exit', (code, signal) => {
        reject(new Error(`ClickClack sidecar exited before health check passed${signal ? ` via ${signal}` : ` with ${code ?? 0}`}`));
      });
    });
    const ready = await Promise.race([
      waitForClickClackHealth(pin, { timeoutMs: options.timeoutMs || 30_000 }),
      exited,
    ]);
    return { status: 'started', child, health: ready };
  } catch (error) {
    child.kill('SIGTERM');
    throw error;
  }
}

export function defaultEntityDevEnv(pin = loadSidecarPin(), env = process.env) {
  const port = String(env.PORT || DEFAULT_ENTITY_PORT);
  const origin = `http://localhost:${port}`;
  return {
    ...env,
    PORT: port,
    ENTITY_DB_MODE: env.ENTITY_DB_MODE || 'LOCAL',
    ENTITY_CLOUD_API_BASE: env.ENTITY_CLOUD_API_BASE || origin,
    VITE_MC_ORIGIN: env.VITE_MC_ORIGIN || origin,
    VITE_ENTITY_API_BASE: env.VITE_ENTITY_API_BASE || origin,
    VITE_ENTITY_WS_PORT: env.VITE_ENTITY_WS_PORT || port,
    ENTITY_CHAT_CLICKCLACK_BRIDGE: env.ENTITY_CHAT_CLICKCLACK_BRIDGE || '0',
    ENTITY_CLICKCLACK_ALLOW_HUMAN_AGENT_FALLBACK: env.ENTITY_CLICKCLACK_ALLOW_HUMAN_AGENT_FALLBACK || '1',
    ENTITY_CLICKCLACK_BASE_URL: env.ENTITY_CLICKCLACK_BASE_URL || pin.baseUrl,
    ENTITY_CLICKCLACK_CHECKOUT: env.ENTITY_CLICKCLACK_CHECKOUT || pin.checkoutPath,
    ENTITY_CLICKCLACK_DATA_DIR: env.ENTITY_CLICKCLACK_DATA_DIR || pin.dataDir,
  };
}
