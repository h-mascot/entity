/**
 * Geordi Swarm — API Routes
 *
 * Mounted at /api/swarm/* in the main Express app.
 */

import { Router, type Request, type Response } from 'express';
import { healStuckJobs, getHealerStatus } from './healer';
import { getEforgeProviderStatus } from './providers/eforge';
import {
  listSwarmJobs,
  getSwarmJob,
  createSwarmJob,
  updateSwarmJob,
  deleteSwarmJob,
  listSwarmProofs,
  createSwarmProof,
  getSwarmStats,
  claimSwarmJob,
  releaseSwarmJob,
} from './db';
import {
  dispatchJob,
  checkJobStatus,
  acceptJob,
  rejectJob,
  cancelJob,
  listProviders,
  checkProviderHealth,
  kickAutoDispatch,
} from './dispatcher';
import { SWARM_JOB_STATUSES, SWARM_PRIORITIES, type CreateSwarmJobInput, type UpdateSwarmJobInput } from './types';

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeTaskId(value: unknown): number | undefined {
  const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isSwarmPriority(value: string): value is NonNullable<CreateSwarmJobInput['priority']> {
  return SWARM_PRIORITIES.includes(value as (typeof SWARM_PRIORITIES)[number]);
}

function isSwarmStatus(value: string): value is NonNullable<UpdateSwarmJobInput['status']> {
  return SWARM_JOB_STATUSES.includes(value as (typeof SWARM_JOB_STATUSES)[number]);
}

function buildCreateJobPayload(body: Record<string, unknown>): CreateSwarmJobInput & { shouldQueue: boolean } {
  const summary = readTrimmedString(body.summary);
  const title = readTrimmedString(body.title) ?? readTrimmedString(body.spec) ?? summary;
  const spec = readTrimmedString(body.spec) ?? summary ?? title;
  const priority = readTrimmedString(body.priority);

  return {
    title: title ?? `Swarm Job ${Date.now()}`,
    spec: spec ?? 'No spec provided',
    repo: readTrimmedString(body.repo) ?? 'https://github.com/example/entity',
    branch: readTrimmedString(body.branch) ?? 'main',
    provider: readTrimmedString(body.provider) ?? 'acp',
    priority: priority && isSwarmPriority(priority) ? priority : undefined,
    context_file: readTrimmedString(body.context_file),
    task_id: normalizeTaskId(body.task_id),
    created_by: readTrimmedString(body.created_by),
    shouldQueue: body.auto_dispatch === true || body.status === 'queued',
  };
}

function buildJobUpdates(body: Record<string, unknown>): UpdateSwarmJobInput {
  const updates: UpdateSwarmJobInput = {};
  const title = readTrimmedString(body.title);
  const spec = readTrimmedString(body.spec) ?? readTrimmedString(body.summary);
  const repo = readTrimmedString(body.repo);
  const branch = readTrimmedString(body.branch);
  const provider = readTrimmedString(body.provider);
  const priority = readTrimmedString(body.priority);
  const contextFile = readTrimmedString(body.context_file);
  const feedback = readTrimmedString(body.feedback);
  const runHandle = readTrimmedString(body.run_handle);
  const status = readTrimmedString(body.status);
  const retryCount = typeof body.retry_count === 'number' ? body.retry_count : undefined;
  const dispatchedAt = readTrimmedString(body.dispatched_at);
  const completedAt = readTrimmedString(body.completed_at);

  if (title !== undefined) updates.title = title;
  if (spec !== undefined) updates.spec = spec;
  if (repo !== undefined) updates.repo = repo;
  if (branch !== undefined) updates.branch = branch;
  if (provider !== undefined) updates.provider = provider;
  if (priority !== undefined && isSwarmPriority(priority)) updates.priority = priority;
  if (contextFile !== undefined) updates.context_file = contextFile;
  if (feedback !== undefined) updates.feedback = feedback;
  if (runHandle !== undefined) updates.run_handle = runHandle;
  if (status !== undefined && isSwarmStatus(status)) updates.status = status;
  if (retryCount !== undefined) updates.retry_count = retryCount;
  if (dispatchedAt !== undefined) updates.dispatched_at = dispatchedAt;
  if (completedAt !== undefined) updates.completed_at = completedAt;

  return updates;
}

export function createSwarmRouter(): Router {
  const router = Router();

  // ── Jobs CRUD ──

  // GET /api/swarm/jobs
  router.get('/jobs', (req: Request, res: Response) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : undefined;
      const task_id = typeof req.query.task_id === 'string' ? Number(req.query.task_id) : undefined;
      const jobs = listSwarmJobs({ status, task_id: Number.isFinite(task_id) ? task_id : undefined });
      res.json({ jobs });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list jobs' });
    }
  });

  // GET /api/swarm/jobs/:id
  router.get('/jobs/:id', (req: Request, res: Response) => {
    const job = getSwarmJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    const proofs = listSwarmProofs(job.id);
    res.json({ job, proofs });
  });

  // POST /api/swarm/jobs
  // Accepts either full spec (title, spec, repo) or simple mode (task_id, summary)
  router.post('/jobs', async (req: Request, res: Response) => {
    try {
      const payload = buildCreateJobPayload((req.body ?? {}) as Record<string, unknown>);
      const job = createSwarmJob({
        title: payload.title,
        spec: payload.spec,
        repo: payload.repo,
        branch: payload.branch,
        provider: payload.provider,
        priority: payload.priority,
        context_file: payload.context_file,
        task_id: payload.task_id,
        created_by: payload.created_by,
      });

      const shouldQueue = payload.shouldQueue;
      if (shouldQueue) {
        updateSwarmJob(job.id, { status: 'queued' });
        await kickAutoDispatch();
      }

      res.status(201).json({ job: getSwarmJob(job.id) });
    } catch (error) {
      res.status(500).json({ error: 'Failed to create job' });
    }
  });

  // PATCH /api/swarm/jobs/:id
  router.patch('/jobs/:id', (req: Request, res: Response) => {
    try {
      const updates = buildJobUpdates((req.body ?? {}) as Record<string, unknown>);
      if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: 'No supported fields provided' });
        return;
      }
      const job = updateSwarmJob(req.params.id, updates);
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
      res.json({ job });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update job' });
    }
  });

  // DELETE /api/swarm/jobs/:id
  router.delete('/jobs/:id', (req: Request, res: Response) => {
    const deleted = deleteSwarmJob(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.json({ ok: true });
  });

  // ── Dispatch & Status ──

  // POST /api/swarm/jobs/:id/dispatch
  router.post('/jobs/:id/dispatch', async (req: Request, res: Response) => {
    try {
      const result = await dispatchJob(req.params.id);
      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }
      const job = getSwarmJob(req.params.id);
      res.json({ job });
    } catch (error) {
      res.status(500).json({ error: 'Dispatch failed' });
    }
  });

  // POST /api/swarm/jobs/:id/check
  router.post('/jobs/:id/check', async (req: Request, res: Response) => {
    try {
      const result = await checkJobStatus(req.params.id);
      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }
      const job = getSwarmJob(req.params.id);
      res.json({ job, runStatus: result.status });
    } catch (error) {
      res.status(500).json({ error: 'Status check failed' });
    }
  });

  // POST /api/swarm/jobs/:id/accept
  router.post('/jobs/:id/accept', (req: Request, res: Response) => {
    const result = acceptJob(req.params.id);
    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }
    const job = getSwarmJob(req.params.id);
    res.json({ job });
  });

  // POST /api/swarm/jobs/:id/reject
  router.post('/jobs/:id/reject', (req: Request, res: Response) => {
    const { feedback } = req.body;
    if (!feedback?.trim()) {
      res.status(400).json({ error: 'feedback is required' });
      return;
    }
    const result = rejectJob(req.params.id, feedback.trim());
    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }
    const job = getSwarmJob(req.params.id);
    res.json({ job });
  });

  // POST /api/swarm/jobs/:id/cancel
  router.post('/jobs/:id/cancel', async (req: Request, res: Response) => {
    try {
      const result = await cancelJob(req.params.id);
      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }
      const job = getSwarmJob(req.params.id);
      res.json({ job });
    } catch (error) {
      res.status(500).json({ error: 'Cancel failed' });
    }
  });

  // ── Tracker API (Symphony EntityTracker contract) ──

  // POST /api/swarm/jobs/:id/claim — concurrency-safe claim for execution
  router.post('/jobs/:id/claim', (req: Request, res: Response) => {
    try {
      const job = getSwarmJob(req.params.id);
      if (!job) {
        res.status(404).json({ error: 'Job not found', code: 'JOB_NOT_FOUND', claimed: false });
        return;
      }

      const claimedBy = req.body?.claimed_by || req.body?.agent || 'symphony';
      const runHandle = req.body?.run_handle;
      const claimed = claimSwarmJob(req.params.id, {
        claimedBy,
        runHandle,
        fromStatuses: ['queued', 'draft'],
        targetStatus: 'dispatched',
      });

      if (!claimed) {
        const current = getSwarmJob(req.params.id);
        const alreadyClaimed = Boolean(current?.run_handle && current.run_handle === runHandle && current.status === 'dispatched');
        res.status(409).json({
          error: `Job already in status: ${current?.status ?? 'unknown'}`,
          code: 'JOB_NOT_CLAIMABLE',
          claimed: false,
          job: current,
          alreadyClaimed,
        });
        return;
      }

      res.json({ claimed: true, job: claimed });
    } catch (error) {
      res.status(500).json({ error: 'Failed to claim job', code: 'CLAIM_FAILED' });
    }
  });

  // POST /api/swarm/jobs/:id/release — release a claimed job back to queue
  router.post('/jobs/:id/release', (req: Request, res: Response) => {
    try {
      const job = getSwarmJob(req.params.id);
      if (!job) {
        res.status(404).json({ error: 'Job not found', code: 'JOB_NOT_FOUND', released: false });
        return;
      }

      const released = releaseSwarmJob(req.params.id, { fromStatuses: ['dispatched', 'running'], targetStatus: 'queued' });
      if (!released) {
        const current = getSwarmJob(req.params.id);
        res.status(409).json({
          error: `Cannot release job in status: ${current?.status ?? 'unknown'}`,
          code: 'JOB_NOT_RELEASABLE',
          released: false,
          job: current,
        });
        return;
      }

      res.json({ released: true, job: released });
    } catch (error) {
      res.status(500).json({ error: 'Failed to release job', code: 'RELEASE_FAILED' });
    }
  });

  // POST /api/swarm/jobs/:id/status — update run progress/state
  router.post('/jobs/:id/status', async (req: Request, res: Response) => {
    try {
      const job = getSwarmJob(req.params.id);
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
      const updates: Record<string, unknown> = {};
      if (req.body?.status && SWARM_JOB_STATUSES.includes(req.body.status)) {
        updates.status = req.body.status;
      }
      if (req.body?.progress || req.body?.feedback) {
        updates.feedback = req.body.progress || req.body.feedback;
      }
      if (req.body?.run_handle) {
        updates.run_handle = req.body.run_handle;
      }
      if (req.body?.status === 'done' || req.body?.status === 'failed') {
        updates.completed_at = new Date().toISOString();
      }
      const updated = updateSwarmJob(req.params.id, updates);
      if (req.body?.status === 'queued') {
        await kickAutoDispatch();
      }
      res.json({ job: getSwarmJob(req.params.id) ?? updated });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update status' });
    }
  });

  // POST /api/swarm/jobs/:id/proof — append proof artifacts
  router.post('/jobs/:id/proof', (req: Request, res: Response) => {
    try {
      const job = getSwarmJob(req.params.id);
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
      const proof = createSwarmProof({
        job_id: req.params.id,
        provider: req.body?.provider || job.provider,
        commit_sha: req.body?.commit_sha,
        branch: req.body?.branch,
        build_log: req.body?.build_log,
        test_result: req.body?.test_result,
        test_output: req.body?.test_output,
        screenshots: req.body?.screenshots,
        artifacts: req.body?.artifacts,
        duration_sec: req.body?.duration_sec,
      });
      // Move to proof/review if still running
      if (['running', 'dispatched'].includes(job.status)) {
        updateSwarmJob(req.params.id, { status: 'proof' });
      }
      res.status(201).json({ proof });
    } catch (error) {
      res.status(500).json({ error: 'Failed to create proof' });
    }
  });

  // POST /api/swarm/jobs/:id/complete — mark job as done
  router.post('/jobs/:id/complete', (req: Request, res: Response) => {
    const result = acceptJob(req.params.id);
    if (!result.success) {
      // Allow completing from more statuses than just review
      const job = getSwarmJob(req.params.id);
      if (job && ['running', 'dispatched', 'proof'].includes(job.status)) {
        updateSwarmJob(req.params.id, { status: 'done', completed_at: new Date().toISOString() });
        const updated = getSwarmJob(req.params.id);
        res.json({ job: updated });
        return;
      }
      res.status(400).json({ error: result.error });
      return;
    }
    const job = getSwarmJob(req.params.id);
    res.json({ job });
  });

  // POST /api/swarm/jobs/:id/fail — mark job as failed
  router.post('/jobs/:id/fail', (req: Request, res: Response) => {
    try {
      const job = getSwarmJob(req.params.id);
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
      updateSwarmJob(req.params.id, {
        status: 'failed',
        feedback: req.body?.reason || req.body?.feedback || 'Marked as failed',
        completed_at: new Date().toISOString(),
      });
      const updated = getSwarmJob(req.params.id);
      res.json({ job: updated });
    } catch (error) {
      res.status(500).json({ error: 'Failed to mark job as failed' });
    }
  });

  // ── Proofs ──

  // GET /api/swarm/jobs/:id/proofs
  router.get('/jobs/:id/proofs', (req: Request, res: Response) => {
    const proofs = listSwarmProofs(req.params.id);
    res.json({ proofs });
  });

  // ── Providers ──

  // GET /api/swarm/providers
  router.get('/providers', (_req: Request, res: Response) => {
    res.json({ providers: listProviders() });
  });

  // GET /api/swarm/providers/:name/health
  router.get('/providers/:name/health', async (req: Request, res: Response) => {
    try {
      const health = await checkProviderHealth(req.params.name);
      res.json(health);
    } catch (error) {
      res.status(500).json({ error: 'Health check failed' });
    }
  });

  // GET /api/swarm/providers/eforge/status
  router.get('/providers/eforge/status', async (req: Request, res: Response) => {
    try {
      const jobId = typeof req.query.job_id === 'string' ? req.query.job_id.trim() : undefined;
      const runHandle = typeof req.query.run_handle === 'string' ? req.query.run_handle.trim() : undefined;
      const status = await getEforgeProviderStatus({ jobId, runHandle });
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get eforge status' });
    }
  });

  // POST /api/swarm/providers/eforge/control
  router.post('/providers/eforge/control', async (req: Request, res: Response) => {
    try {
      const { action } = req.body as { action: string };
      if (!action || !['start', 'stop', 'restart', 'status'].includes(action)) {
        res.status(400).json({ error: 'Invalid action. Must be one of: start, stop, restart, status' });
        return;
      }

      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const { stdout, stderr } = await execAsync(`/opt/homebrew/bin/eforge daemon ${action}`);
      res.json({ success: true, action, output: stdout || stderr });
    } catch (error) {
      res.status(500).json({ error: 'Failed to control eforge daemon', details: String(error) });
    }
  });

  // GET /api/swarm/providers/codex/status
  router.get('/providers/codex/status', async (_req: Request, res: Response) => {
    try {
      const { CodexProvider } = await import('./providers/codex');
      const provider = new CodexProvider();
      const status = await provider.healthCheck();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get codex status' });
    }
  });

  // POST /api/swarm/providers/codex/control
  router.post('/providers/codex/control', async (_req: Request, res: Response) => {
    try {
      const { CodexProvider } = await import('./providers/codex');
      const provider = new CodexProvider();
      // For now, control just triggers a health check and returns the status
      // The CodexProvider manages its own WebSocket connection lifecycle
      const status = await provider.healthCheck();
      res.json({ success: true, status });
    } catch (error) {
      res.status(500).json({ error: 'Failed to control codex provider' });
    }
  });

  // ── Stats ──

  // GET /api/swarm/stats
  router.get('/stats', (_req: Request, res: Response) => {
    try {
      const stats = getSwarmStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get stats' });
    }
  });

  // ── Self-Healing ──

  // POST /api/swarm/heal - Manual heal trigger
  router.post("/heal", async (_req: Request, res: Response) => {
    try {
      const result = await healStuckJobs();
      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ error: "Heal operation failed" });
    }
  });

  // GET /api/swarm/healer/status
  router.get("/healer/status", (_req: Request, res: Response) => {
    res.json(getHealerStatus());
  });

  return router;
}
