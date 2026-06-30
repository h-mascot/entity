#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root || process.cwd());
const sha = args.sha || git(['rev-parse', 'HEAD'], root) || process.env.ENTITY_RELEASE_SHA || '';
const branch = args.branch || git(['rev-parse', '--abbrev-ref', 'HEAD'], root) || process.env.ENTITY_RELEASE_BRANCH || '';
const builtAt = new Date().toISOString();
const packageLock = join(root, 'package-lock.json');
const manifest = {
  schemaVersion: 1,
  app: 'entity',
  environmentBuiltFor: args.environment || 'sandbox-or-prod-agnostic',
  repo: args.repo || 'h-mascot/entity',
  branch,
  gitSha: sha,
  githubRunId: process.env.GITHUB_RUN_ID || null,
  githubRunUrl: process.env.GITHUB_RUN_ID ? `https://github.com/${args.repo || 'h-mascot/entity'}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
  builtAt,
  nodeVersion: process.version,
  packageLockHash: existsSync(packageLock) ? `sha256:${sha256File(packageLock)}` : null,
  artifactHash: `sha256:${treeHash(root, ['.git', 'node_modules', 'output'])}`,
  distHashes: {
    'packages/app/dist': maybeTreeHash(join(root, 'packages/app/dist')),
    'packages/server/dist': maybeTreeHash(join(root, 'packages/server/dist')),
    'packages/db/dist': maybeTreeHash(join(root, 'packages/db/dist')),
  },
};

if (args.check) {
  const existing = readJson(join(root, 'RELEASE.json'));
  const version = existsSync(join(root, 'VERSION')) ? readFileSync(join(root, 'VERSION'), 'utf8').trim() : '';
  const errors = [];
  if (!existing) errors.push('missing RELEASE.json');
  if (!version) errors.push('missing VERSION');
  if (existing?.gitSha && version && existing.gitSha !== version) errors.push(`VERSION ${version} does not match RELEASE.json.gitSha ${existing.gitSha}`);
  if (existing?.gitSha && basename(root).match(/^[0-9a-f]{40}$/i) && basename(root) !== existing.gitSha) errors.push(`release dir basename ${basename(root)} does not match RELEASE.json.gitSha ${existing.gitSha}`);
  if (errors.length) {
    console.error(JSON.stringify({ ok: false, root, errors }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, root, gitSha: existing?.gitSha || version, manifestPresent: Boolean(existing), versionPresent: Boolean(version) }, null, 2));
  process.exit(0);
}

if (args.write) {
  writeFileSync(join(root, 'RELEASE.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (sha) writeFileSync(join(root, 'VERSION'), `${sha}\n`);
}

console.log(JSON.stringify({ ok: true, root, write: args.write, manifest }, null, 2));

function parseArgs(argv) {
  const parsed = { root: '', sha: '', branch: '', repo: '', environment: '', write: false, check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') parsed.root = argv[++i] || '';
    else if (arg === '--sha') parsed.sha = argv[++i] || '';
    else if (arg === '--branch') parsed.branch = argv[++i] || '';
    else if (arg === '--repo') parsed.repo = argv[++i] || '';
    else if (arg === '--environment') parsed.environment = argv[++i] || '';
    else if (arg === '--write') parsed.write = true;
    else if (arg === '--check') parsed.check = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function git(gitArgs, cwd) {
  const result = spawnSync('git', gitArgs, { cwd, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function maybeTreeHash(dir) {
  return existsSync(dir) ? `sha256:${treeHash(dir, [])}` : null;
}

function treeHash(dir, excludeNames) {
  const hash = createHash('sha256');
  const excludes = new Set(excludeNames);
  for (const file of walk(dir, excludes)) {
    hash.update(relative(dir, file));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function walk(dir, excludes) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (excludes.has(name)) continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (st.isDirectory()) out.push(...walk(p, excludes));
    else if (st.isFile()) out.push(p);
  }
  return out;
}
