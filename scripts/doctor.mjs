#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import YAML from 'yaml';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const configPath = path.resolve(process.env.ENTITY_CONFIG || path.join(repoRoot, 'entity.config.yaml'));
const examplePath = path.join(repoRoot, 'docs', 'config', 'entity.config.example.yaml');
const envPath = path.join(repoRoot, '.env');
const requiredFiles = [
  'package.json',
  'packages/server/package.json',
  'packages/app/package.json',
  'docs/config/entity.config.example.yaml',
  '.env.example',
];

let failures = 0;
let warnings = 0;

function ok(message) { console.log(`✓ ${message}`); }
function warn(message) { warnings += 1; console.log(`! ${message}`); }
function fail(message) { failures += 1; console.log(`✗ ${message}`); }

function readConfig() {
  const target = fs.existsSync(configPath) ? configPath : examplePath;
  try {
    return { target, config: YAML.parse(fs.readFileSync(target, 'utf8')) };
  } catch (error) {
    fail(`failed to parse ${path.relative(repoRoot, target)}: ${error instanceof Error ? error.message : String(error)}`);
    return { target, config: null };
  }
}

async function canBind(host, port) {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

for (const file of requiredFiles) {
  if (fs.existsSync(path.join(repoRoot, file))) ok(`${file} present`);
  else fail(`${file} missing`);
}

if (fs.existsSync(configPath)) ok(`entity config present: ${path.relative(repoRoot, configPath)}`);
else warn(`entity.config.yaml not found; using example defaults. Run npm run setup to create one.`);

if (fs.existsSync(envPath)) ok('.env present');
else warn('.env not found; run npm run setup if local env file is desired.');

const { config } = readConfig();
if (config) {
  const serialized = JSON.stringify(config);
  const privatePatterns = [
    ['tailnet IP', /100\.(?:\d{1,3}\.){2}\d{1,3}/],
    ['Enterprise home path', /\/Users\/enterprise\b/],
    ['Henry home path', /\/home\/henrymascot\b/],
    ['Enterprise SSH target', /enterprise@[\w.-]+/i],
  ];
  for (const [label, pattern] of privatePatterns) {
    if (pattern.test(serialized)) fail(`config contains private-looking ${label}`);
  }

  const port = Number(process.env.PORT || config?.server?.port || 3000);
  const host = String(process.env.HOST || config?.server?.host || '127.0.0.1');
  if (Number.isInteger(port) && port > 0 && port <= 65535) ok(`server port valid: ${port}`);
  else fail(`server port invalid: ${port}`);

  const bindable = await canBind(host, port);
  if (bindable) ok(`port available: ${host}:${port}`);
  else warn(`port already in use or unavailable: ${host}:${port}`);

  for (const [key, value] of Object.entries({
    workspaceRoot: config?.server?.workspaceRoot,
    databasePath: config?.server?.databasePath,
    logPath: config?.server?.logPath,
  })) {
    if (typeof value === 'string' && value.trim()) ok(`${key} configured: ${value}`);
    else fail(`${key} missing from config`);
  }
}

console.log(`[doctor] failures=${failures} warnings=${warnings}`);
process.exit(failures > 0 ? 1 : 0);
