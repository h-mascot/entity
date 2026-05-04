import type { Router } from 'express';
import { resolvePluginModulePath, type PluginRouteContext } from '../registry';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFile, spawn } from 'child_process';

/* ── Types ── */

interface SwarmJobRow {
  id: string;
  task_id: number;
  title: string;
  spec: string;
  repo: string;
  branch: string | null;
  provider: string;
  status: string;
  priority: string;
  context_file: string | null;
  run_handle: string | null;
  retry_count: number;
  max_retries: number;
  feedback: string | null;
  summary: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  dispatched_at: string | null;
  completed_at: string | null;
}

interface SwarmProofRow {
  id: string;
  job_id: string;
  proof_type: string;
  proof_ref: string;
  created_at: string;
}

/* ── Helpers ── */

function readCount(db: PluginRouteContext['db'], tableName: 'swarm_jobs' | 'swarm_proofs'): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count?: unknown } | undefined;
  const count = row?.count;
  return typeof count === 'number' ? count : Number(count ?? 0);
}

function now(): string {
  return new Date().toISOString();
}

function genId(): string {
  return crypto.randomBytes(10).toString('hex');
}

function updateJob(db: PluginRouteContext['db'], id: string, fields: Record<string, unknown>): SwarmJobRow {
  const sets = Object.keys(fields).map(k => `${k} = ?`);
  sets.push("updated_at = ?");
  const vals = [...Object.values(fields), now(), id];
  db.prepare(`UPDATE swarm_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return db.prepare('SELECT * FROM swarm_jobs WHERE id = ?').get(id) as SwarmJobRow;
}

/* ── ACP Dispatch (acpx codex exec) ── */

const ACPX_BIN = '/usr/bin/acpx';
const MAC_HOST = '100.86.150.96';
const CODEX_BIN = '/Applications/Codex.app/Contents/Resources/codex';

// Track active dispatch processes
const activeDispatches = new Map<string, { pid: number; startedAt: number }>();

function buildPrompt(job: SwarmJobRow): string {
  const parts = [
    `# Build Job: ${job.title}`,
    '',
    job.spec,
    '',
    '## Constraints',
    `- Working directory: ${job.repo}`,
    job.branch ? `- Target branch: ${job.branch}` : '- Target branch: main',
    '- Run `npm run build` after changes and fix any errors',
    '- Commit your changes with a descriptive message',
    '- Do NOT push to remote',
  ];
  if (job.feedback) {
    parts.push('', '## Previous Review Feedback', job.feedback);
  }
  return parts.join('\n');
}

function dispatchToAcp(job: SwarmJobRow, db: PluginRouteContext['db']): string {
  const prompt = buildPrompt(job);
  const runHandle = `acp-${job.id}-${Date.now()}`;

  // Write prompt to temp file to avoid shell escaping issues
  const promptFile = `/tmp/swarm-prompt-${job.id}.md`;
  require('fs').writeFileSync(promptFile, prompt);

  // Dispatch via acpx on ada-gateway (global opts before subcommand)
  // Note: --cwd must be a local path (ada-gateway), not Mac path
  const localRepo = job.repo.replace('~', process.env.HOME || '/home/henrymascot');
  const child = spawn(ACPX_BIN, [
    '--cwd', localRepo,
    '--approve-all',
    '--timeout', '3600',
    'codex', 'exec',
    '-f', promptFile,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env: { ...process.env, HOME: process.env.HOME || '/home/henrymascot' },
  });

  child.unref();

  let stdout = '';
  let stderr = '';

  child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

  activeDispatches.set(job.id, { pid: child.pid!, startedAt: Date.now() });

  child.on('close', (code) => {
    activeDispatches.delete(job.id);

    const ts = now();
    if (code === 0) {
      // Success — move to proof/review
      let commitSha: string | null = null;
      try {
        const parsed = JSON.parse(stdout);
        commitSha = parsed?.commitSha || parsed?.commit_sha || null;
      } catch { /* ignore parse errors */ }

      db.prepare(
        "UPDATE swarm_jobs SET status = 'review', run_handle = ?, completed_at = ?, updated_at = ? WHERE id = ?"
      ).run(runHandle, ts, ts, job.id);

      // Add proof
      const proofId = genId();
      const proofRef = commitSha || `acpx completed (exit 0)`;
      db.prepare(
        "INSERT INTO swarm_proofs (id, job_id, proof_type, proof_ref, created_at) VALUES (?, ?, 'build_log', ?, ?)"
      ).run(proofId, job.id, `${proofRef}\n\nSTDOUT:\n${stdout.slice(0, 4000)}\n\nSTDERR:\n${stderr.slice(0, 2000)}`, ts);

      console.log(`[swarm] Job ${job.id} completed → review`);
    } else {
      // Failed
      const currentJob = db.prepare('SELECT * FROM swarm_jobs WHERE id = ?').get(job.id) as SwarmJobRow | undefined;
      const retryCount = (currentJob?.retry_count ?? 0) + 1;
      const maxRetries = currentJob?.max_retries ?? 3;

      if (retryCount < maxRetries) {
        db.prepare(
          "UPDATE swarm_jobs SET status = 'queued', retry_count = ?, feedback = ?, updated_at = ? WHERE id = ?"
        ).run(retryCount, `Auto-retry ${retryCount}/${maxRetries}: exit code ${code}\n${stderr.slice(0, 1000)}`, ts, job.id);
        console.log(`[swarm] Job ${job.id} failed (exit ${code}), retry ${retryCount}/${maxRetries}`);
      } else {
        db.prepare(
          "UPDATE swarm_jobs SET status = 'failed', retry_count = ?, completed_at = ?, updated_at = ? WHERE id = ?"
        ).run(retryCount, ts, ts, job.id);

        const proofId = genId();
        db.prepare(
          "INSERT INTO swarm_proofs (id, job_id, proof_type, proof_ref, created_at) VALUES (?, ?, 'error_log', ?, ?)"
        ).run(proofId, job.id, `Exit code: ${code}\n\nSTDERR:\n${stderr.slice(0, 4000)}\n\nSTDOUT:\n${stdout.slice(0, 2000)}`, ts);

        console.log(`[swarm] Job ${job.id} failed permanently after ${retryCount} retries`);
      }
    }
  });

  return runHandle;
}

function dispatchToSsh(job: SwarmJobRow, db: PluginRouteContext['db']): string {
  const prompt = buildPrompt(job);
  const runHandle = `ssh-${job.id}-${Date.now()}`;
  const repoPath = job.repo.replace('~', '/Users/henrymascot');

  // Dispatch Codex directly on Mac via SSH
  const child = spawn('ssh', [
    MAC_HOST,
    `cd ${repoPath} && ${CODEX_BIN} exec --approval-mode full-auto --quiet '${prompt.replace(/'/g, "'\\''")}'`,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  child.unref();

  let stdout = '';
  let stderr = '';

  child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

  activeDispatches.set(job.id, { pid: child.pid!, startedAt: Date.now() });

  child.on('close', (code) => {
    activeDispatches.delete(job.id);
    const ts = now();

    if (code === 0) {
      db.prepare(
        "UPDATE swarm_jobs SET status = 'review', run_handle = ?, completed_at = ?, updated_at = ? WHERE id = ?"
      ).run(runHandle, ts, ts, job.id);

      const proofId = genId();
      db.prepare(
        "INSERT INTO swarm_proofs (id, job_id, proof_type, proof_ref, created_at) VALUES (?, ?, 'build_log', ?, ?)"
      ).run(proofId, job.id, `Codex completed (exit 0)\n\n${stdout.slice(0, 4000)}`, ts);

      console.log(`[swarm] Job ${job.id} completed via SSH → review`);
    } else {
      const currentJob = db.prepare('SELECT * FROM swarm_jobs WHERE id = ?').get(job.id) as SwarmJobRow | undefined;
      const retryCount = (currentJob?.retry_count ?? 0) + 1;
      const maxRetries = currentJob?.max_retries ?? 3;

      if (retryCount < maxRetries) {
        db.prepare(
          "UPDATE swarm_jobs SET status = 'queued', retry_count = ?, feedback = ?, updated_at = ? WHERE id = ?"
        ).run(retryCount, `SSH retry ${retryCount}/${maxRetries}: exit ${code}\n${stderr.slice(0, 1000)}`, ts, job.id);
      } else {
        db.prepare(
          "UPDATE swarm_jobs SET status = 'failed', retry_count = ?, completed_at = ?, updated_at = ? WHERE id = ?"
        ).run(retryCount, ts, ts, job.id);

        const proofId = genId();
        db.prepare(
          "INSERT INTO swarm_proofs (id, job_id, proof_type, proof_ref, created_at) VALUES (?, ?, 'error_log', ?, ?)"
        ).run(proofId, job.id, `Exit: ${code}\n${stderr.slice(0, 4000)}`, ts);
      }
    }
  });

  return runHandle;
}

/* ── Route Registration ── */

function tryMountCoreSwarmRouter(router: Router, context: PluginRouteContext): boolean {
  const moduleEntry = path.resolve(context.plugin.directory, '../../swarm/routes.ts');

  try {
    const modulePath = resolvePluginModulePath(moduleEntry);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const loadedModule = require(modulePath) as { createSwarmRouter?: () => Router };
    if (typeof loadedModule.createSwarmRouter !== 'function') {
      context.logger.warn(`[swarm] Core swarm router module at ${modulePath} does not export createSwarmRouter; using plugin fallback routes`);
      return false;
    }
    router.use(loadedModule.createSwarmRouter());
    context.logger.info(`[swarm] Delegating plugin route mount to core swarm router (${modulePath})`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.logger.warn(`[swarm] Failed to mount core swarm router from ${moduleEntry}, falling back to plugin routes: ${message}`);
    return false;
  }
}

export function registerPluginRoutes(router: Router, context: PluginRouteContext): void {
  const { plugin, db } = context;

  if (tryMountCoreSwarmRouter(router, context)) {
    return;
  }

  /* ── Info ── */

  router.get('/', (_req, res) => {
    return res.json({
      plugin: plugin.id,
      name: plugin.name,
      enabled: plugin.enabled,
      hooks: plugin.hooks,
      jobs: readCount(db, 'swarm_jobs'),
      proofs: readCount(db, 'swarm_proofs'),
      settings: plugin.settings,
    });
  });

  router.get('/status', (_req, res) => {
    return res.json({
      plugin: plugin.id,
      status: plugin.status,
      settings: plugin.settings,
      hooks: plugin.hooks,
      tables: plugin.storage?.tables ?? [],
      jobs: readCount(db, 'swarm_jobs'),
      proofs: readCount(db, 'swarm_proofs'),
      activeDispatches: activeDispatches.size,
    });
  });

  router.get('/providers', (_req, res) => {
    return res.json({
      providers: [
        { name: 'symphony', label: 'Symphony (pull-based)' },
        { name: 'acp', label: 'Codex via ACP (acpx)' },
        { name: 'ssh', label: 'Codex via SSH (direct Mac)' },
      ],
    });
  });

  /* ── Jobs CRUD ── */

  router.get('/jobs', (req, res) => {
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : null;
    const taskIdFilter = req.query.task_id ? Number(req.query.task_id) : null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

    let rows: SwarmJobRow[];
    if (statusFilter && taskIdFilter) {
      rows = db.prepare('SELECT * FROM swarm_jobs WHERE status = ? AND task_id = ? ORDER BY updated_at DESC LIMIT ?')
        .all(statusFilter, taskIdFilter, limit) as SwarmJobRow[];
    } else if (statusFilter) {
      rows = db.prepare('SELECT * FROM swarm_jobs WHERE status = ? ORDER BY updated_at DESC LIMIT ?')
        .all(statusFilter, limit) as SwarmJobRow[];
    } else if (taskIdFilter) {
      rows = db.prepare('SELECT * FROM swarm_jobs WHERE task_id = ? ORDER BY updated_at DESC LIMIT ?')
        .all(taskIdFilter, limit) as SwarmJobRow[];
    } else {
      rows = db.prepare('SELECT * FROM swarm_jobs ORDER BY updated_at DESC LIMIT ?')
        .all(limit) as SwarmJobRow[];
    }

    return res.json({ jobs: rows, total: readCount(db, 'swarm_jobs') });
  });

  router.get('/jobs/:jobId', (req, res) => {
    const job = db.prepare('SELECT * FROM swarm_jobs WHERE id = ?').get(req.params.jobId) as SwarmJobRow | undefined;
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const proofs = db.prepare('SELECT * FROM swarm_proofs WHERE job_id = ? ORDER BY created_at DESC')
      .all(job.id) as SwarmProofRow[];

    return res.json({ job, proofs });
  });

  router.post('/jobs', (req, res) => {
    const { task_id, title, spec, repo, branch, provider, priority, context_file, created_by } = req.body ?? {};
    if (!title && !spec) return res.status(400).json({ error: 'title or spec is required' });

    const id = genId();
    const prov = provider || plugin.settings.defaultProvider || 'acp';
    const ts = now();

    db.prepare(`INSERT INTO swarm_jobs 
      (id, task_id, title, spec, repo, branch, provider, status, priority, context_file, 
       run_handle, retry_count, max_retries, feedback, created_by, created_at, updated_at, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, NULL, 0, 3, NULL, ?, ?, ?, NULL)`
    ).run(
      id, task_id || 0, title || 'Untitled Job', spec || '', 
      repo || '~/Code/entity', branch || 'main', prov, 
      priority || 'medium', context_file || null,
      created_by || null, ts, ts
    );

    const job = db.prepare('SELECT * FROM swarm_jobs WHERE id = ?').get(id) as SwarmJobRow;
    return res.status(201).json({ job });
  });

  router.patch('/jobs/:jobId', (req, res) => {
    const job = db.prepare('SELECT * FROM swarm_jobs WHERE id = ?').get(req.params.jobId) as SwarmJobRow | undefined;
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const allowed = ['status', 'summary', 'title', 'spec', 'repo', 'branch', 'provider', 'priority', 'context_file', 'feedback'] as const;
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    if (Object.keys(updates).length === 0) return res.json({ job });

    const updated = updateJob(db, job.id, updates);
    return res.json({ job: updated });
  });

  router.delete('/jobs/:jobId', (req, res) => {
    const result = db.prepare('DELETE FROM swarm_jobs WHERE id = ?').run(req.params.jobId);
    if (result.changes === 0) return res.status(404).json({ error: 'Job not found' });
    db.prepare('DELETE FROM swarm_proofs WHERE job_id = ?').run(req.params.jobId);
    return res.json({ deleted: true });
  });

  /* ── Lifecycle: Dispatch / Accept / Reject / Cancel ── */

  router.post('/jobs/:jobId/dispatch', (req, res) => {
    const job = db.prepare('SELECT * FROM swarm_jobs WHERE id = ?').get(req.params.jobId) as SwarmJobRow | undefined;
    if (!job) return res.status(404).json({ error: 'Job not found' });

    if (!['draft', 'queued'].includes(job.status)) {
      return res.status(400).json({ error: `Cannot dispatch job in ${job.status} state` });
    }

    const provider = (req.body?.provider as string) || job.provider || 'acp';
    let runHandle: string;

    try {
      if (provider === 'symphony') {
        // Symphony is pull-based — just mark as queued and Symphony polls for it
        runHandle = `symphony-pull:${job.id}`;
        const updated = updateJob(db, job.id, {
          status: 'queued',
          provider,
          run_handle: runHandle,
          feedback: 'Waiting for Symphony to pick up (poll-based dispatch)',
        });
        console.log(`[swarm] Job ${job.id} queued for Symphony (pull-based)`);
        return res.json({ job: updated });
      } else if (provider === 'ssh') {
        runHandle = dispatchToSsh(job, db);
      } else {
        runHandle = dispatchToAcp(job, db);
      }
    } catch (err) {
      console.error(`[swarm] Dispatch failed for job ${job.id}:`, err);
      return res.status(500).json({ error: 'Dispatch failed', detail: String(err) });
    }

    const updated = updateJob(db, job.id, {
      status: 'dispatched',
      provider,
      run_handle: runHandle,
      dispatched_at: now(),
    });

    console.log(`[swarm] Dispatched job ${job.id} via ${provider} → ${runHandle}`);
    return res.json({ job: updated });
  });

  router.post('/jobs/:jobId/accept', (req, res) => {
    const job = db.prepare('SELECT * FROM swarm_jobs WHERE id = ?').get(req.params.jobId) as SwarmJobRow | undefined;
    if (!job) return res.status(404).json({ error: 'Job not found' });

    if (job.status !== 'review') {
      return res.status(400).json({ error: `Cannot accept job in ${job.status} state` });
    }

    const updated = updateJob(db, job.id, { status: 'done', completed_at: now() });
    console.log(`[swarm] Job ${job.id} accepted → done`);
    return res.json({ job: updated });
  });

  router.post('/jobs/:jobId/reject', (req, res) => {
    const job = db.prepare('SELECT * FROM swarm_jobs WHERE id = ?').get(req.params.jobId) as SwarmJobRow | undefined;
    if (!job) return res.status(404).json({ error: 'Job not found' });

    if (job.status !== 'review') {
      return res.status(400).json({ error: `Cannot reject job in ${job.status} state` });
    }

    const feedback = req.body?.feedback || 'Rejected without feedback';
    const updated = updateJob(db, job.id, { status: 'queued', feedback });
    console.log(`[swarm] Job ${job.id} rejected → queued (feedback: ${feedback.slice(0, 80)})`);
    return res.json({ job: updated });
  });

  router.post('/jobs/:jobId/cancel', (req, res) => {
    const job = db.prepare('SELECT * FROM swarm_jobs WHERE id = ?').get(req.params.jobId) as SwarmJobRow | undefined;
    if (!job) return res.status(404).json({ error: 'Job not found' });

    if (['done', 'cancelled'].includes(job.status)) {
      return res.status(400).json({ error: `Cannot cancel job in ${job.status} state` });
    }

    // Kill active dispatch process if running
    const active = activeDispatches.get(job.id);
    if (active) {
      try { process.kill(active.pid, 'SIGTERM'); } catch { /* already dead */ }
      activeDispatches.delete(job.id);
    }

    const updated = updateJob(db, job.id, { status: 'cancelled', completed_at: now() });
    console.log(`[swarm] Job ${job.id} cancelled`);
    return res.json({ job: updated });
  });

  router.post('/jobs/:jobId/check', (req, res) => {
    const job = db.prepare('SELECT * FROM swarm_jobs WHERE id = ?').get(req.params.jobId) as SwarmJobRow | undefined;
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const active = activeDispatches.get(job.id);
    return res.json({
      job,
      runStatus: active ? 'running' : (job.status === 'dispatched' ? 'unknown' : job.status),
      activePid: active?.pid ?? null,
      runningSince: active ? new Date(active.startedAt).toISOString() : null,
    });
  });

  /* ── Tracker API (Symphony EntityTracker contract) ── */

  // POST /jobs/:jobId/claim — concurrency-safe claim for execution (Symphony pulls jobs)
  router.post('/jobs/:jobId/claim', (req, res) => {
    const job = db.prepare('SELECT * FROM swarm_jobs WHERE id = ?').get(req.params.jobId) as SwarmJobRow | undefined;
    if (!job) return res.status(404).json({ error: 'Job not found', code: 'JOB_NOT_FOUND', claimed: false });

    if (!['queued', 'draft'].includes(job.status)) {
      return res.status(409).json({
        error: `Job already in status: ${job.status}`,
        code: 'JOB_NOT_CLAIMABLE',
        claimed: false,
        job,
      });
    }

    const claimedBy = req.body?.claimed_by || req.body?.agent || 'symphony';
    const runHandle = req.body?.run_handle || `${claimedBy}-${job.id}-${Date.now()}`;
    const updated = updateJob(db, job.id, {
      status: 'dispatched',
      run_handle: runHandle,
      dispatched_at: now(),
      created_by: claimedBy,
    });

    console.log(`[swarm] Job ${job.id} claimed by ${claimedBy}`);
    return res.json({ claimed: true, job: updated });
  });

  // POST /jobs/:jobId/release — release a claimed job back to queue
  router.post('/jobs/:jobId/release', (req, res) => {
    const job = db.prepare('SELECT * FROM swarm_jobs WHERE id = ?').get(req.params.jobId) as SwarmJobRow | undefined;
    if (!job) return res.status(404).json({ error: 'Job not found', code: 'JOB_NOT_FOUND', released: false });

    if (!['dispatched', 'running'].includes(job.status)) {
      return res.status(409).json({
        error: `Cannot release job in status: ${job.status}`,
        code: 'JOB_NOT_RELEASABLE',
        released: false,
        job,
      });
    }

    const updated = updateJob(db, job.id, { status: 'queued', run_handle: null });
    console.log(`[swarm] Job ${job.id} released back to queue`);
    return res.json({ released: true, job: updated });
  });

  // POST /jobs/:jobId/status — update run progress/state (Symphony writes back)
  router.post('/jobs/:jobId/status', (req, res) => {
    const job = db.prepare('SELECT * FROM swarm_jobs WHERE id = ?').get(req.params.jobId) as SwarmJobRow | undefined;
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const updates: Record<string, unknown> = {};
    if (req.body?.status) updates.status = req.body.status;
    if (req.body?.progress || req.body?.feedback) updates.feedback = req.body.progress || req.body.feedback;
    if (req.body?.run_handle) updates.run_handle = req.body.run_handle;
    if (req.body?.status === 'done' || req.body?.status === 'failed') updates.completed_at = now();

    if (Object.keys(updates).length === 0) return res.json({ job });
    const updated = updateJob(db, job.id, updates);
    return res.json({ job: updated });
  });

  // POST /jobs/:jobId/complete — mark job as done
  router.post('/jobs/:jobId/complete', (req, res) => {
    const job = db.prepare('SELECT * FROM swarm_jobs WHERE id = ?').get(req.params.jobId) as SwarmJobRow | undefined;
    if (!job) return res.status(404).json({ error: 'Job not found' });

    if (!['running', 'dispatched', 'proof', 'review'].includes(job.status)) {
      return res.status(400).json({ error: `Cannot complete job in ${job.status} state` });
    }

    const updated = updateJob(db, job.id, { status: 'done', completed_at: now() });
    console.log(`[swarm] Job ${job.id} completed`);
    return res.json({ job: updated });
  });

  // POST /jobs/:jobId/fail — mark job as failed
  router.post('/jobs/:jobId/fail', (req, res) => {
    const job = db.prepare('SELECT * FROM swarm_jobs WHERE id = ?').get(req.params.jobId) as SwarmJobRow | undefined;
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const updated = updateJob(db, job.id, {
      status: 'failed',
      feedback: req.body?.reason || req.body?.feedback || 'Marked as failed',
      completed_at: now(),
    });
    console.log(`[swarm] Job ${job.id} failed: ${req.body?.reason || 'no reason'}`);
    return res.json({ job: updated });
  });

  // POST /jobs/:jobId/proof — append proof artifacts (Symphony writes proof back)
  router.post('/jobs/:jobId/proof', (req, res) => {
    const job = db.prepare('SELECT * FROM swarm_jobs WHERE id = ?').get(req.params.jobId) as SwarmJobRow | undefined;
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const id = genId();
    const proofRef = [
      req.body?.commit_sha ? `commit: ${req.body.commit_sha}` : null,
      req.body?.branch ? `branch: ${req.body.branch}` : null,
      req.body?.build_log ? `log: ${req.body.build_log.slice(0, 2000)}` : null,
      req.body?.test_result ? `tests: ${req.body.test_result}` : null,
    ].filter(Boolean).join('\n') || 'proof submitted';

    db.prepare(
      "INSERT INTO swarm_proofs (id, job_id, proof_type, proof_ref, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(id, job.id, req.body?.proof_type || 'build', proofRef, now());

    // Move to proof/review if still running
    if (['running', 'dispatched'].includes(job.status)) {
      updateJob(db, job.id, { status: 'proof' });
    }

    const proof = db.prepare('SELECT * FROM swarm_proofs WHERE id = ?').get(id) as SwarmProofRow;
    return res.status(201).json({ proof });
  });

  /* ── Proofs ── */

  router.get('/jobs/:jobId/proofs', (req, res) => {
    const job = db.prepare('SELECT * FROM swarm_jobs WHERE id = ?').get(req.params.jobId) as SwarmJobRow | undefined;
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const proofs = db.prepare('SELECT * FROM swarm_proofs WHERE job_id = ? ORDER BY created_at DESC')
      .all(job.id) as SwarmProofRow[];

    return res.json({ proofs });
  });

  router.post('/jobs/:jobId/proofs', (req, res) => {
    const job = db.prepare('SELECT * FROM swarm_jobs WHERE id = ?').get(req.params.jobId) as SwarmJobRow | undefined;
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { proof_type, proof_ref } = req.body ?? {};
    if (!proof_ref) return res.status(400).json({ error: 'proof_ref is required' });

    const id = genId();
    db.prepare(
      "INSERT INTO swarm_proofs (id, job_id, proof_type, proof_ref, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(id, job.id, proof_type || 'artifact', proof_ref, now());

    const proof = db.prepare('SELECT * FROM swarm_proofs WHERE id = ?').get(id) as SwarmProofRow;
    return res.status(201).json({ proof });
  });
}

export default registerPluginRoutes;
