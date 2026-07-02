#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, renameSync, readFileSync, rmSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

const args = parseArgs(process.argv.slice(2));
const envPath = args.env || process.env.ENTITY_DEPLOY_ENV || '';
if (envPath) loadEnvFile(envPath);

const config = {
  repo: requiredEnv('ENTITY_DEPLOY_REPO'),
  branch: process.env.ENTITY_DEPLOY_BRANCH || 'main',
  workflow: process.env.ENTITY_DEPLOY_REQUIRED_WORKFLOW || 'CI/CD Pipeline',
  sourceDir: requiredEnv('ENTITY_DEPLOY_SOURCE_DIR'),
  prodHost: requiredEnv('ENTITY_PROD_HOST'),
  prodHttpHost: requiredEnv('ENTITY_PROD_HTTP_HOST'),
  prodPort: process.env.ENTITY_PROD_PORT || '3000',
  prodDir: requiredEnv('ENTITY_PROD_DIR'),
  prodDb: requiredEnv('ENTITY_PROD_DB'),
  prodLogPath: process.env.ENTITY_PROD_LOG_PATH || '',
  prodLaunchdService: process.env.ENTITY_PROD_LAUNCHD_SERVICE || '',
  prodNodeEntry: process.env.ENTITY_PROD_NODE_ENTRY || '',
  releaseBaseDir: process.env.ENTITY_RELEASE_BASE_DIR || '',
  currentLink: process.env.ENTITY_RELEASE_CURRENT_LINK || '',
  previousLink: process.env.ENTITY_RELEASE_PREVIOUS_LINK || '',
  releaseEnvironment: process.env.ENTITY_RELEASE_ENVIRONMENT || 'sandbox',
  runtimeWorkspace: process.env.ENTITY_RUNTIME_WORKSPACE || '',
  nodeBinDir: process.env.ENTITY_DEPLOY_NODE_BIN_DIR || dirname(process.execPath),
};

const stateDir = process.env.ENTITY_DEPLOY_STATE_DIR || join(config.sourceDir, '.gateway-pull-deploy');
const statePath = join(stateDir, 'last-deployed.json');
const lockPath = join(stateDir, 'lock');
const logPath = process.env.ENTITY_DEPLOY_LOG || join(stateDir, 'gateway-pull-deploy.log');

mkdirSync(stateDir, { recursive: true });
mkdirSync(dirname(logPath), { recursive: true });

if (args.printConfig) {
  printConfig();
  process.exit(0);
}

await withLock(async () => {
  const targetSha = args.sha || await getRemoteHead();
  const state = readState();

  log(`CHECK repo=${config.repo} branch=${config.branch} sha=${targetSha}`);

  if (!args.force && state?.repo === config.repo && state?.branch === config.branch && state?.sha === targetSha) {
    log(`UP_TO_DATE sha=${targetSha} deployedAt=${state.deployedAt || 'unknown'}`);
    return;
  }

  const ci = await getCiStatus(targetSha);
  if (ci.status !== 'success') {
    const message = `CI_NOT_READY sha=${targetSha} status=${ci.status} conclusion=${ci.conclusion || 'none'} run=${ci.url || 'none'}`;
    if (ci.status === 'failed') {
      log(message);
      process.exitCode = 1;
      return;
    }
    log(message);
    return;
  }

  log(`CI_OK sha=${targetSha} run=${ci.url}`);

  if (args.checkOnly || args.dryRun) {
    log(`${args.dryRun ? 'DRY_RUN' : 'CHECK_ONLY'} update_available sha=${targetSha}`);
    return;
  }

  await deploySha(targetSha);
  const deployedAt = new Date().toISOString();
  writeFileSync(statePath, `${JSON.stringify({
    repo: config.repo,
    branch: config.branch,
    sha: targetSha,
    deployedAt,
    workflow: ci.workflow,
    runId: ci.id,
    runUrl: ci.url,
  }, null, 2)}\n`);
  log(`DEPLOY_COMPLETE sha=${targetSha} deployedAt=${deployedAt}`);
});

function parseArgs(argv) {
  const parsed = {
    checkOnly: false,
    dryRun: false,
    force: false,
    printConfig: false,
    sha: '',
    env: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--once':
        break;
      case '--check-only':
        parsed.checkOnly = true;
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--force':
        parsed.force = true;
        break;
      case '--print-config':
        parsed.printConfig = true;
        break;
      case '--sha':
        parsed.sha = argv[++i] || '';
        break;
      case '--env':
        parsed.env = argv[++i] || '';
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (parsed.sha && !/^[0-9a-f]{40}$/i.test(parsed.sha)) {
    throw new Error(`--sha must be a 40-character git SHA, got ${parsed.sha}`);
  }
  return parsed;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function printConfig() {
  const safe = {
    repo: config.repo,
    branch: config.branch,
    workflow: config.workflow,
    sourceDir: config.sourceDir,
    prodHost: config.prodHost,
    prodHttpHost: config.prodHttpHost,
    prodPort: config.prodPort,
    prodDir: config.prodDir,
    prodDb: config.prodDb,
    prodLogPath: config.prodLogPath || '<unset>',
    prodLaunchdService: config.prodLaunchdService || '<unset>',
    prodNodeEntry: config.prodNodeEntry || '<unset>',
    releaseBaseDir: config.releaseBaseDir || '<unset>',
    currentLink: config.currentLink || '<unset>',
    previousLink: config.previousLink || '<unset>',
    releaseEnvironment: config.releaseEnvironment,
    runtimeWorkspace: config.runtimeWorkspace || '<unset>',
    nodeBinDir: config.nodeBinDir,
    stateDir,
    logPath,
    envPath: envPath || '<unset>',
    githubToken: process.env.GITHUB_TOKEN ? '<set>' : '<unset>',
  };
  console.log(JSON.stringify(safe, null, 2));
}

async function withLock(fn) {
  try {
    mkdirSync(lockPath);
  } catch {
    log('LOCKED another deploy check is already running');
    return;
  }

  try {
    await fn();
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

async function getRemoteHead() {
  const remote = `https://github.com/${config.repo}.git`;
  const ref = `refs/heads/${config.branch}`;
  const result = await run('git', ['ls-remote', remote, ref], { quietCommand: true });
  const line = result.stdout.trim().split(/\r?\n/).find(Boolean);
  const sha = line?.split(/\s+/)[0] || '';
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error(`Could not resolve ${config.repo} ${config.branch}`);
  }
  return sha;
}

async function getCiStatus(sha) {
  const url = new URL(`https://api.github.com/repos/${config.repo}/actions/runs`);
  url.searchParams.set('branch', config.branch);
  url.searchParams.set('head_sha', sha);
  url.searchParams.set('event', 'push');
  url.searchParams.set('per_page', '20');

  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'entity-gateway-pull-deploy',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub Actions lookup failed: HTTP ${response.status} ${await response.text()}`);
  }

  const body = await response.json();
  const runs = (body.workflow_runs || [])
    .filter((run) => run.head_sha === sha)
    .filter((run) => !config.workflow || run.name === config.workflow)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  if (runs.length === 0) {
    return { status: 'missing', conclusion: '', workflow: config.workflow };
  }

  const run = runs[0];
  if (run.status !== 'completed') {
    return { status: run.status || 'pending', conclusion: run.conclusion || '', workflow: run.name, id: run.id, url: run.html_url };
  }
  if (run.conclusion !== 'success') {
    return { status: 'failed', conclusion: run.conclusion || '', workflow: run.name, id: run.id, url: run.html_url };
  }
  return { status: 'success', conclusion: run.conclusion, workflow: run.name, id: run.id, url: run.html_url };
}

async function deploySha(sha) {
  mkdirSync(dirname(config.sourceDir), { recursive: true });
  if (!existsSync(join(config.sourceDir, '.git'))) {
    log(`CLONE sourceDir=${config.sourceDir}`);
    await run('git', ['clone', `https://github.com/${config.repo}.git`, config.sourceDir]);
  }

  await run('git', ['fetch', '--prune', 'origin', config.branch], { cwd: config.sourceDir });
  await run('git', ['checkout', '--detach', sha], { cwd: config.sourceDir });
  await run('git', ['clean', '-fdx'], { cwd: config.sourceDir });
  await run('npm', ['ci'], { cwd: config.sourceDir });

  const releaseMode = Boolean(config.releaseBaseDir && config.currentLink);
  const releaseDir = releaseMode ? join(config.releaseBaseDir, sha) : config.prodDir;
  if (releaseMode) mkdirSync(releaseDir, { recursive: true });

  const deployEnv = {
    ...process.env,
    ENTITY_PROD_HOST: config.prodHost,
    ENTITY_PROD_HTTP_HOST: config.prodHttpHost,
    ENTITY_PROD_PORT: config.prodPort,
    ENTITY_PROD_DIR: releaseDir,
    ENTITY_PROD_DB: config.prodDb,
    ENTITY_SOURCE_DIR: config.sourceDir,
    ENTITY_RELEASE_SHA: sha,
    ENTITY_RELEASE_BRANCH: config.branch,
    ENTITY_RELEASE_ENVIRONMENT: config.releaseEnvironment,
  };
  if (releaseMode) deployEnv.ENTITY_DEPLOY_SKIP_RESTART = '1';
  if (config.prodLogPath) deployEnv.ENTITY_PROD_LOG_PATH = config.prodLogPath;
  if (config.prodLaunchdService) deployEnv.ENTITY_PROD_LAUNCHD_SERVICE = config.prodLaunchdService;
  if (config.prodNodeEntry) deployEnv.ENTITY_PROD_NODE_ENTRY = config.prodNodeEntry;
  if (config.runtimeWorkspace) deployEnv.ENTITY_RUNTIME_WORKSPACE = config.runtimeWorkspace;

  await run('./deploy.sh', ['--all'], { cwd: config.sourceDir, env: deployEnv });

  if (releaseMode) {
    switchSymlink(config.currentLink, releaseDir, config.previousLink);
    if (config.prodLaunchdService) {
      await run('launchctl', ['kickstart', '-k', `gui/${process.getuid()}/${config.prodLaunchdService}`]);
    }
    if (!args.skipVerify) {
      try {
        await verifyLive(sha);
      } catch (err) {
        await rollbackRelease(sha, err);
        throw err;
      }
    }
  }
}

async function verifyLive(targetSha) {
  const port = parseInt(config.prodPort, 10) || 3000;
  const host = '127.0.0.1';
  const budgetMs = 60_000;
  const startedAt = Date.now();
  let lastErr = null;
  while (Date.now() - startedAt < budgetMs) {
    try {
      const versionUrl = `http://${host}:${port}/api/version`;
      const healthUrl = `http://${host}:${port}/api/health`;
      const versionRes = await fetch(versionUrl, { signal: AbortSignal.timeout(3000) });
      const healthRes = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) });
      if (versionRes.ok && healthRes.ok) {
        const body = await versionRes.json();
        const healthBody = await healthRes.json();
        if (body?.gitSha === targetSha && healthBody?.status === 'ok') {
          log(`VERIFY_OK sha=${targetSha} port=${port} elapsedMs=${Date.now() - startedAt}`);
          return;
        }
        lastErr = `sha_mismatch expected=${targetSha} got=${body?.gitSha || '<missing>'} health=${healthBody?.status || '<missing>'}`;
      } else {
        lastErr = `http version=${versionRes.status} health=${healthRes.status}`;
      }
    } catch (err) {
      lastErr = err?.message || String(err);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`VERIFY_TIMEOUT sha=${targetSha} port=${port} budgetMs=${budgetMs} lastErr=${lastErr}`);
}

async function rollbackRelease(failedSha, originalError) {
  if (!config.previousLink) {
    log(`ROLLBACK_SKIP no previousLink configured (sha=${failedSha} err=${originalError.message})`);
    return;
  }
  let previousTarget = '';
  try {
    previousTarget = readlinkSync(config.previousLink);
  } catch {}
  if (!previousTarget || previousTarget === config.currentLink) {
    log(`ROLLBACK_SKIP previousTarget empty or already current (sha=${failedSha} err=${originalError.message})`);
    return;
  }
  switchSymlink(config.currentLink, previousTarget, config.previousLink);
  if (config.prodLaunchdService) {
    try {
      await run('launchctl', ['kickstart', '-k', `gui/${process.getuid()}/${config.prodLaunchdService}`]);
    } catch (kickErr) {
      log(`ROLLBACK_KICK_FAIL ${kickErr.message}`);
    }
  }
  const failurePath = join(stateDir, 'deploy-failures');
  mkdirSync(failurePath, { recursive: true });
  const failureFile = join(failurePath, `${Date.now()}-${failedSha.slice(0, 12)}.json`);
  writeFileSync(failureFile, JSON.stringify({
    failedSha,
    error: originalError.message,
    rolledBackTo: previousTarget,
    timestamp: new Date().toISOString(),
  }, null, 2));
  log(`ROLLBACK_COMPLETE failed=${failedSha} restored=${previousTarget} log=${failureFile}`);
}

function switchSymlink(currentLink, nextTarget, previousLink) {
  let previousTarget = '';
  try { previousTarget = readFileSync(currentLink, 'utf8'); } catch {}
  try {
    const resolved = readlinkSync(currentLink);
    previousTarget = resolved || previousTarget;
  } catch {}
  const tmpLink = `${currentLink}.next-${process.pid}`;
  try { unlinkSync(tmpLink); } catch {}
  symlinkSync(nextTarget, tmpLink);
  renameSync(tmpLink, currentLink);
  if (previousLink && previousTarget) {
    try { unlinkSync(previousLink); } catch {}
    symlinkSync(previousTarget, previousLink);
  }
  log(`RELEASE_SWITCH current=${currentLink} target=${nextTarget} previous=${previousTarget || '<none>'}`);
}


function readState() {
  if (!existsSync(statePath)) return null;
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

function run(command, commandArgs, options = {}) {
  const cwd = options.cwd || process.cwd();
  if (!options.quietCommand) {
    log(`RUN cwd=${cwd} command=${[command, ...commandArgs].join(' ')}`);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd,
      env: { ...process.env, PATH: `${config.nodeBinDir}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`, ...(options.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const write = (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (!options.quietCommand) {
        appendFileSync(logPath, text);
        process.stdout.write(text);
      }
    };
    const writeErr = (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (!options.quietCommand) {
        appendFileSync(logPath, text);
        process.stderr.write(text);
      }
    };
    child.stdout.on('data', write);
    child.stderr.on('data', writeErr);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`${command} ${commandArgs.join(' ')} failed with exit code ${code}`));
    });
  });
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  appendFileSync(logPath, line);
  process.stdout.write(line);
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
}
