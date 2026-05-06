#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');

const configPath = path.join(repoRoot, 'entity.config.yaml');
const configExamplePath = path.join(repoRoot, 'docs', 'config', 'entity.config.example.yaml');
const envPath = path.join(repoRoot, '.env');
const envExamplePath = path.join(repoRoot, '.env.example');

function log(message) {
  console.log(`[setup] ${message}`);
}

function fail(message) {
  console.error(`[setup] ${message}`);
  process.exitCode = 1;
}

function loadConfig(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  return YAML.parse(raw);
}

function ensureCopied(example, target, label) {
  if (fs.existsSync(target)) {
    log(`${label} exists: ${path.relative(repoRoot, target)}`);
    return false;
  }
  if (checkOnly) {
    fail(`${label} missing: ${path.relative(repoRoot, target)} (run npm run setup)`);
    return false;
  }
  fs.copyFileSync(example, target);
  log(`created ${path.relative(repoRoot, target)} from ${path.relative(repoRoot, example)}`);
  return true;
}

function ensureDir(dir, label) {
  if (fs.existsSync(dir)) {
    log(`${label} exists: ${path.relative(repoRoot, dir)}`);
    return;
  }
  if (checkOnly) {
    fail(`${label} missing: ${path.relative(repoRoot, dir)} (run npm run setup)`);
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  log(`created ${label}: ${path.relative(repoRoot, dir)}`);
}

if (!fs.existsSync(configExamplePath)) {
  fail(`missing config example: ${path.relative(repoRoot, configExamplePath)}`);
} else {
  ensureCopied(configExamplePath, configPath, 'entity config');
}

if (fs.existsSync(envExamplePath)) {
  ensureCopied(envExamplePath, envPath, '.env');
}

const config = loadConfig(configPath) ?? loadConfig(configExamplePath);
if (!config) {
  fail('could not load entity configuration');
} else {
  const workspaceRoot = config?.server?.workspaceRoot || './workspace';
  const databasePath = config?.server?.databasePath || './data/entity.sqlite';
  const logPath = config?.server?.logPath || './logs/entity.log';
  for (const [target, label] of [
    [workspaceRoot, 'workspace root'],
    [path.dirname(databasePath), 'database directory'],
    [path.dirname(logPath), 'log directory'],
  ]) {
    const absolute = path.resolve(repoRoot, String(target));
    ensureDir(absolute, label);
  }

  const serialized = JSON.stringify(config);
  const privateDefaultPatterns = [
    /100\.(?:\d{1,3}\.){2}\d{1,3}/,
    /\/Users\/enterprise\b/,
    /\/home\/henrymascot\b/,
    /enterprise@[\w.-]+/i,
  ];
  const hit = privateDefaultPatterns.find((pattern) => pattern.test(serialized));
  if (hit) {
    fail(`entity.config.yaml contains private-looking defaults matching ${hit}`);
  }
}

if (!process.exitCode) {
  log(checkOnly ? 'check passed' : 'first-run setup complete');
  log('next: npm run dev');
}
