#!/usr/bin/env node
/**
 * entity-dev.js
 * Local-only development startup script.
 * Reads entity.config.yaml and starts the server with safe local settings.
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

console.log(`Config: ${configPath}`);
console.log(`Workspace: ${workspaceRoot}`);
console.log(`Database: ${databasePath}`);
console.log(`URL: ${apiBaseUrl}`);
console.log('');

const server = spawn('npm', ['run', 'dev'], {
  cwd: path.join(repoRoot, 'packages', 'server'),
  env,
  stdio: 'inherit'
});

server.on('error', e => { console.error(e); process.exit(1); });
server.on('exit', code => process.exit(code ?? 0));
