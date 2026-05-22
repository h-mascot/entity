#!/usr/bin/env node
/**
 * entity-dev.js
 * Local-only development startup script.
 * Reads entity.config.yaml, starts ClickClack by default, then starts Entity.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const repoRoot = path.join(__dirname, '..');
const configPath = path.resolve(repoRoot, process.env.ENTITY_CONFIG || 'entity.config.yaml');

function expandHome(value) {
  if (!value || typeof value !== 'string') return value;
  if (value === '~') return process.env.HOME || value;
  if (value.startsWith('~/')) return path.join(process.env.HOME || '~', value.slice(2));
  return value;
}

function resolveRepoPath(value, fallback) {
  const input = expandHome(value || fallback);
  return path.isAbsolute(input) ? input : path.resolve(repoRoot, input);
}

function loadConfig() {
  if (!fs.existsSync(configPath)) {
    console.error('ERROR: entity.config.yaml not found.');
    console.error('Run npm run setup first, or npm run setup -- --defaults for non-interactive setup.');
    process.exit(1);
  }
  const text = fs.readFileSync(configPath, 'utf8');
  return YAML.parse(text) || {};
}

function flagDisabled(value) {
  return ['0', 'false', 'off', 'no'].includes(String(value || '').trim().toLowerCase());
}

function prefixStream(stream, prefix) {
  let pending = '';
  stream.on('data', (chunk) => {
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) console.log(`${prefix} ${line}`);
    }
  });
  stream.on('end', () => {
    if (pending.trim()) console.log(`${prefix} ${pending}`);
  });
}

function spawnPrefixed(command, args, options, prefix) {
  const child = spawn(command, args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (child.stdout) prefixStream(child.stdout, prefix);
  if (child.stderr) prefixStream(child.stderr, prefix);
  return child;
}

async function main() {
  const {
    defaultEntityDevEnv,
    ensureClickClackSidecar,
    isTcpPortOpen,
    loadSidecarPin,
  } = await import('./clickclack-sidecar-lib.mjs');

  console.log('Starting Entity local development...');
  console.log('==================================');

  const config = loadConfig();
  const serverConfig = config.server || {};
  const port = String(process.env.PORT || serverConfig.port || '3000');
  const databasePath = resolveRepoPath(process.env.ENTITY_TASK_DB_PATH || serverConfig.databasePath, './data/entity.sqlite');
  const workspaceRoot = resolveRepoPath(process.env.WORKSPACE || serverConfig.workspaceRoot, './workspace');
  const portOverridden = Boolean(process.env.PORT);
  const defaultHttpBaseUrl = `http://localhost:${port}`;
  const defaultWsBaseUrl = `ws://localhost:${port}`;
  const publicBaseUrl = process.env.ENTITY_PUBLIC_BASE_URL || (portOverridden ? defaultHttpBaseUrl : serverConfig.publicBaseUrl) || defaultHttpBaseUrl;
  const apiBaseUrl = process.env.ENTITY_CLOUD_API_BASE || (portOverridden ? defaultHttpBaseUrl : serverConfig.apiBaseUrl) || publicBaseUrl;
  const wsBaseUrl = process.env.VITE_ENTITY_WS_URL || (portOverridden ? defaultWsBaseUrl : serverConfig.wsBaseUrl) || defaultWsBaseUrl;

  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });

  const env = { ...process.env };
  env.ENTITY_CONFIG = configPath;
  env.ENTITY_DB_MODE = env.ENTITY_DB_MODE || 'LOCAL';
  env.ENTITY_TASK_DB_PATH = databasePath;
  env.WORKSPACE = workspaceRoot;
  env.ENTITY_CLOUD_API_BASE = env.ENTITY_CLOUD_API_BASE || apiBaseUrl;
  env.VITE_MC_ORIGIN = env.VITE_MC_ORIGIN || apiBaseUrl;
  env.VITE_ENTITY_API_BASE = env.VITE_ENTITY_API_BASE || apiBaseUrl;
  env.VITE_ENTITY_WS_URL = env.VITE_ENTITY_WS_URL || wsBaseUrl;
  env.PORT = port;
  if (typeof process.env.ENTITY_API_TOKEN !== 'string') {
    env.ENTITY_API_TOKEN = '';
  }

  const pin = loadSidecarPin(env);
  Object.assign(env, defaultEntityDevEnv(pin, env));

  const entityPortOpen = await isTcpPortOpen('127.0.0.1', Number(env.PORT));
  if (entityPortOpen) {
    console.error(`ERROR: Entity port ${env.PORT} is already in use. Set PORT to an open port and retry.`);
    process.exit(1);
  }

  let sidecarChild = null;
  const sidecarEnabled = !flagDisabled(env.ENTITY_CLICKCLACK_SIDECAR);
  if (sidecarEnabled) {
    console.log(`[dev] ClickClack sidecar target: ${pin.baseUrl}`);
    const sidecar = await ensureClickClackSidecar({
      pin,
      start: true,
      prefix: '[clickclack]',
      env,
    });
    sidecarChild = sidecar.child;
    console.log(`[dev] ClickClack sidecar ${sidecar.status} at ${pin.baseUrl}`);
  } else {
    env.ENTITY_CHAT_CLICKCLACK_BRIDGE = '0';
    console.log('[dev] ClickClack sidecar disabled by env.');
  }

  console.log(`Config: ${configPath}`);
  console.log(`Workspace: ${workspaceRoot}`);
  console.log(`Database: ${databasePath}`);
  console.log(`URL: ${apiBaseUrl}`);
  console.log('');

  const server = spawnPrefixed('npm', ['run', 'dev'], {
    cwd: path.join(repoRoot, 'packages', 'server'),
    env,
  }, '[entity]');

  let shuttingDown = false;
  function shutdown(reason, code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    process.exitCode = code;
    console.log(`[dev] Shutting down (${reason})`);
    server.kill('SIGTERM');
    if (sidecarChild) sidecarChild.kill('SIGTERM');
    setTimeout(() => process.exit(code), 5_000).unref();
  }

  server.on('error', (error) => {
    console.error(`[dev] Failed to start Entity server: ${error.message}`);
    shutdown('server spawn error', 1);
  });
  server.on('exit', (code, signal) => {
    if (!shuttingDown) {
      shutdown(`Entity server exited${signal ? ` via ${signal}` : ` with ${code ?? 0}`}`, code ?? (signal ? 1 : 0));
    }
  });
  if (sidecarChild) {
    sidecarChild.on('exit', (code, signal) => {
      if (!shuttingDown) {
        shutdown(`ClickClack sidecar exited${signal ? ` via ${signal}` : ` with ${code ?? 0}`}`, code ?? (signal ? 1 : 0));
      }
    });
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
