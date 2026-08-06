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
  createActiveTaskSwarmJob,
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
  kickAutoDispatch,
} from './dispatcher';
import { requireDeploymentControlAuthority } from '../principals/request-context';
import {
  getRegisteredExecutionEngineHealth,
  listRegisteredExecutionEngines,
  toLegacyProviderListEntry,
} from './execution-engines';
import { SWARM_JOB_STATUSES, SWARM_PRIORITIES, type CreateSwarmJobInput, type UpdateSwarmJobInput, type SwarmJob } from './types';
import {
  createExecutionCallbackIntakeRouter,
  createExecutionCallbackIntakeService,
  getValidatedManifestByProvider,
  resolveCallbackAuthSecretFromEnv,
} from './callback-intake';
import {
  buildRunWithAgentsJobInput,
  resolveRunWithAgentsTarget,
  isTaskEligibleForAgentRun,
  isTaskInScope,
} from './task-run';
import { createTaskSyncLayer } from '../../../db/src/task-sync';
import type { TaskRecord } from '../../../db/src';
import { resolveTrustedTenantScope } from '../tenant-scope';

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

/** Trusted org/team scope for Run-with-agents authorization (D4: fail closed). */
function resolveRequestScope(req: Request): { orgId: string; teamId: string } {
  return resolveTrustedTenantScope(req);
}

/**
 * D5: whether a task-linked swarm job is visible to the request scope. Ownership
 * is resolved through the AUTHORITATIVE linked task (its org/team). Unlinked
 * jobs (general/operational swarm without a task) are not task-scoped and stay
 * visible to the operational surface. Swarm APIs are retained.
 */
async function isJobVisibleInRequestScope(
  job: { task_id?: number | null } | undefined,
  scope: { orgId: string; teamId: string },
  resolveTask: (id: number) => Promise<TaskRecord | undefined>,
): Promise<boolean> {
  if (!job) return false;
  const taskId = typeof job.task_id === 'number' ? job.task_id : null;
  if (taskId === null) return true;
  const task = await resolveTask(taskId);
  if (!task) return false;
  return isTaskInScope({ org_id: task.org_id, team_id: task.team_id }, scope);
}

/**
 * D5: load a swarm job for a mutating/control/proof path only when it is visible
 * to the request scope. Task-linked jobs require their authoritative task to be
 * in scope (fail closed to 404); unlinked operational jobs remain accessible.
 * Returns undefined for missing or out-of-scope jobs so callers respond 404
 * without leaking existence cross-tenant.
 */
async function getJobIfVisible(
  req: Request,
  id: string,
  resolveTask: (id: number) => Promise<TaskRecord | undefined>,
): Promise<SwarmJob | undefined> {
  const job = getSwarmJob(id);
  if (!job) return undefined;
  if (!(await isJobVisibleInRequestScope(job, resolveRequestScope(req), resolveTask))) return undefined;
  return job;
}

export interface SwarmRouterDeps {
  /** Active task source (configured taskSyncLayer). Defaults to a local task-sync layer. */
  getTask?: (id: number) => Promise<TaskRecord | undefined>;
}

// Lazy default task source so test/runtime env is read at first use, never an
// ad-hoc local repository that bypasses the configured adapter / tenant scope.
let _defaultGetTask: ((id: number) => Promise<TaskRecord | undefined>) | null = null;
function defaultGetTask(id: number): Promise<TaskRecord | undefined> {
  if (!_defaultGetTask) {
    _defaultGetTask = createTaskSyncLayer().getTask;
  }
  return _defaultGetTask(id);
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

export function createSwarmRouter(deps: SwarmRouterDeps = {}): Router {
  const router = Router();
  const resolveTask = deps.getTask ?? defaultGetTask;

  // EEPC-A-03 — callback intake → ActivityEvents (does not replace legacy mutation routes).
  // EEPC-A-07 — authRequired callbacks resolve secrets from env (never logged / never in errors).
  const callbackIntake = createExecutionCallbackIntakeService({
    getManifest: getValidatedManifestByProvider,
    getJob: (jobId) => {
      const job = getSwarmJob(jobId);
      if (!job) return undefined;
      return {
        id: job.id,
        provider: job.provider,
        task_id: job.task_id,
        status: job.status,
      };
    },
    getCallbackAuthSecret: (provider) =>
      resolveCallbackAuthSecretFromEnv(provider, getValidatedManifestByProvider(provider)),
  });
  router.use(
    // D8: authoritative task visibility for task-linked callback intake. Reuses
    // the same resolveTrustedTenantScope + isJobVisibleInRequestScope contract as
    // the D5 reads/mutations: unlinked operational jobs remain visible to the
    // callback surface; a missing or cross-tenant task-linked job fails closed
    // to 404 (no ActivityEvent intake). Provider callback auth is still enforced
    // by the intake service afterwards; no identity is invented and fail-closed
    // behavior is preserved.
    createExecutionCallbackIntakeRouter(callbackIntake, {
      authorizeJob: async (req, jobId) => {
        const job = getSwarmJob(jobId);
        if (!job) return false;
        return isJobVisibleInRequestScope(job, resolveRequestScope(req), resolveTask);
      },
    }),
  );

  /**
   * D-R6-MUTATION-GATES: router-level operations mutation gate. Every
   * non-GET/HEAD/OPTIONS route after the external callback intake requires
   * deployment-control authority (global admin / trusted service). Tenant
   * viewer/contributor/manager credentials are denied so job, provider, and
   * heal mutations are never open to tenant authority. The callback intake
   * router above is mounted FIRST and handles its own signed auth, so external
   * intake stays reachable without admin authority.
   */
  router.use((req, res, next) => {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next();
    }
    if (!requireDeploymentControlAuthority(req, res)) return;
    next();
  });

  // ── Jobs CRUD ──

  // GET /api/swarm/jobs
  router.get('/jobs', async (req: Request, res: Response) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : undefined;
      const taskIdQuery = typeof req.query.task_id === 'string' ? Number(req.query.task_id) : undefined;
      if (typeof taskIdQuery === 'number' && Number.isFinite(taskIdQuery)) {
        // D5: scope the task-linked list read through the authoritative task.
        // Fail closed (404) when the task is missing or outside the request scope
        // so existence/contents are not leaked cross-tenant.
        const task = await resolveTask(taskIdQuery);
        if (!task || !isTaskInScope({ org_id: task.org_id, team_id: task.team_id }, resolveRequestScope(req))) {
          res.status(404).json({ error: 'task not found' });
          return;
        }
        res.json({ jobs: listSwarmJobs({ status, task_id: taskIdQuery }) });
        return;
      }
      // D5: the unfiltered list must not leak cross-tenant task-linked jobs.
      // Filter through the authoritative linked task; unlinked operational jobs
      // remain visible to the operational surface.
      const allJobs = listSwarmJobs({ status });
      const scope = resolveRequestScope(req);
      const visible: SwarmJob[] = [];
      for (const job of allJobs) {
        if (await isJobVisibleInRequestScope(job, scope, resolveTask)) {
          visible.push(job);
        }
      }
      res.json({ jobs: visible });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list jobs' });
    }
  });

  // GET /api/swarm/jobs/:id
  router.get('/jobs/:id', async (req: Request, res: Response) => {
    const job = getSwarmJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    // D5: enforce authoritative task ownership on the task-linked detail read.
    if (!(await isJobVisibleInRequestScope(job, resolveRequestScope(req), resolveTask))) {
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
      // D5: task-linked jobs must be created through the governed
      // POST /api/swarm/tasks/:taskId/run lifecycle (authoritative scope,
      // eligibility, fail-closed target, atomic active-job guard). The generic
      // operational create path refuses task_id so arbitrary task linkage cannot
      // bypass that lifecycle. Unlinked operational creation is preserved.
      if (typeof payload.task_id === 'number' && Number.isFinite(payload.task_id)) {
        res.status(400).json({
          error: 'task-linked jobs must be created via POST /api/swarm/tasks/:taskId/run (Run with agents)',
          code: 'TASK_LINK_REQUIRES_GOVERNED_PATH',
        });
        return;
      }
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
  router.patch('/jobs/:id', async (req: Request, res: Response) => {
    try {
      const updates = buildJobUpdates((req.body ?? {}) as Record<string, unknown>);
      if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: 'No supported fields provided' });
        return;
      }
      // D5: enforce authoritative task ownership on the task-linked mutation.
      if (!(await getJobIfVisible(req, req.params.id, resolveTask))) {
        res.status(404).json({ error: 'Job not found' });
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
  router.delete('/jobs/:id', async (req: Request, res: Response) => {
    // D5: enforce authoritative task ownership on the task-linked deletion.
    if (!(await getJobIfVisible(req, req.params.id, resolveTask))) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    const deleted = deleteSwarmJob(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.json({ ok: true });
  });

  // ── Run with agents (task-linked) ──
  // BRD-004: Swarm is invoked from an eligible task, not presented as a board.
  // Reads the task through the configured task source (taskSyncLayer), enforces
  // request-derived tenant scope and eligibility, resolves a real dispatch
  // target (fail closed — never an example placeholder), and creates at most one
  // active job per task via an atomic DB invariant.
  router.post('/tasks/:taskId/run', async (req: Request, res: Response) => {
    try {
      const taskId = Number(req.params.taskId);
      if (!Number.isInteger(taskId) || taskId <= 0) {
        res.status(400).json({ error: 'taskId must be a positive integer' });
        return;
      }
      const task = await resolveTask(taskId);
      if (!task || !isTaskInScope({ org_id: task.org_id, team_id: task.team_id }, resolveRequestScope(req))) {
        // Fail closed: do not leak existence of out-of-scope tasks.
        res.status(404).json({ error: 'task not found' });
        return;
      }
      if (
        !isTaskEligibleForAgentRun({
          name: task.name,
          archived: task.archived,
          column: task.column,
        })
      ) {
        res.status(409).json({
          error: 'task is not eligible for an agent run',
          code: 'TASK_NOT_ELIGIBLE',
        });
        return;
      }
      const target = resolveRunWithAgentsTarget({
        body: (req.body ?? {}) as Record<string, unknown>,
        task: { metadata: task.metadata },
        env: process.env,
      });
      if (!target) {
        res.status(400).json({
          error: 'no execution target configured for Run with agents',
          code: 'NO_EXECUTION_TARGET',
        });
        return;
      }
      const result = createActiveTaskSwarmJob(buildRunWithAgentsJobInput(task, { target }));
      if (!result.created) {
        res.status(200).json({ job: result.job, alreadyActive: true });
        return;
      }
      updateSwarmJob(result.job.id, { status: 'queued' });
      await kickAutoDispatch();
      res.status(201).json({ job: getSwarmJob(result.job.id) ?? result.job });
    } catch (error) {
      res.status(500).json({ error: 'Failed to start run' });
    }
  });

  // ── Dispatch & Status ──

  // POST /api/swarm/jobs/:id/dispatch
  router.post('/jobs/:id/dispatch', async (req: Request, res: Response) => {
    try {
      // D5: enforce authoritative task ownership on the task-linked dispatch.
      if (!(await getJobIfVisible(req, req.params.id, resolveTask))) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
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
      // D5: enforce authoritative task ownership on the task-linked status check.
      if (!(await getJobIfVisible(req, req.params.id, resolveTask))) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
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
  router.post('/jobs/:id/accept', async (req: Request, res: Response) => {
    // D5: enforce authoritative task ownership on the task-linked accept.
    if (!(await getJobIfVisible(req, req.params.id, resolveTask))) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    const result = acceptJob(req.params.id);
    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }
    const job = getSwarmJob(req.params.id);
    res.json({ job });
  });

  // POST /api/swarm/jobs/:id/reject
  router.post('/jobs/:id/reject', async (req: Request, res: Response) => {
    const { feedback } = req.body;
    if (!feedback?.trim()) {
      res.status(400).json({ error: 'feedback is required' });
      return;
    }
    // D5: enforce authoritative task ownership on the task-linked reject.
    if (!(await getJobIfVisible(req, req.params.id, resolveTask))) {
      res.status(404).json({ error: 'Job not found' });
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
      // D5: enforce authoritative task ownership on the task-linked cancel.
      if (!(await getJobIfVisible(req, req.params.id, resolveTask))) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
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
  router.post('/jobs/:id/claim', async (req: Request, res: Response) => {
    try {
      // D5: enforce authoritative task ownership on the task-linked claim.
      const job = await getJobIfVisible(req, req.params.id, resolveTask);
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
  router.post('/jobs/:id/release', async (req: Request, res: Response) => {
    try {
      // D5: enforce authoritative task ownership on the task-linked release.
      const job = await getJobIfVisible(req, req.params.id, resolveTask);
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
      // D5: enforce authoritative task ownership on the task-linked status mutation.
      const job = await getJobIfVisible(req, req.params.id, resolveTask);
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
  router.post('/jobs/:id/proof', async (req: Request, res: Response) => {
    try {
      // D5: enforce authoritative task ownership on the task-linked proof append.
      const job = await getJobIfVisible(req, req.params.id, resolveTask);
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
  router.post('/jobs/:id/complete', async (req: Request, res: Response) => {
    // D5: enforce authoritative task ownership on the task-linked complete.
    if (!(await getJobIfVisible(req, req.params.id, resolveTask))) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
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
  router.post('/jobs/:id/fail', async (req: Request, res: Response) => {
    try {
      // D5: enforce authoritative task ownership on the task-linked fail.
      const job = await getJobIfVisible(req, req.params.id, resolveTask);
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
  router.get('/jobs/:id/proofs', async (req: Request, res: Response) => {
    const job = getSwarmJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    // D5: enforce authoritative task ownership on the task-linked proofs read.
    if (!(await isJobVisibleInRequestScope(job, resolveRequestScope(req), resolveTask))) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    const proofs = listSwarmProofs(req.params.id);
    res.json({ proofs });
  });

  // ── Providers / execution engines (EEPC-B-01 public, secret-safe) ──

  // GET /api/swarm/execution-engines — registered engines + public health
  router.get('/execution-engines', async (_req: Request, res: Response) => {
    try {
      const engines = await listRegisteredExecutionEngines();
      res.json({ engines });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list execution engines' });
    }
  });

  // GET /api/swarm/providers — back-compat list with public health attached
  router.get('/providers', async (_req: Request, res: Response) => {
    try {
      const engines = await listRegisteredExecutionEngines();
      res.json({
        providers: engines.map(toLegacyProviderListEntry),
        engines,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list providers' });
    }
  });

  // GET /api/swarm/providers/:name/health — public projection only
  router.get('/providers/:name/health', async (req: Request, res: Response) => {
    try {
      const { health } = await getRegisteredExecutionEngineHealth(req.params.name);
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
  // R6 (operations): daemon start/stop/restart is deployment-wide process
  // control, gated by the router-level deployment-control authority gate above.
  router.post('/providers/eforge/control', async (req: Request, res: Response) => {
    try {
      const { action } = req.body as { action: string };
      if (!action || !['start', 'stop', 'restart', 'status'].includes(action)) {
        res.status(400).json({ error: 'Invalid action. Must be one of: start, stop, restart, status' });
        return;
      }

      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);

      // Configurable so deployments and tests can point control at the right
      // binary; defaults to the bundled eforge CLI. Bounded so a blocking daemon
      // command can never hang this admin-only endpoint or its request socket.
      //
      // No shell: the executable path is passed as a single value (never
      // interpolated into shell text), so a misconfigured
      // ENTITY_EFORGE_CONTROL_COMMAND cannot inject commands. `action` is the
      // fixed allowlist value validated above. execFile resolves the binary
      // directly; ENOENT/non-zero exit surfaces as a 500 via the catch below.
      const eforgeBin = process.env.ENTITY_EFORGE_CONTROL_COMMAND ?? '/opt/homebrew/bin/eforge';
      const { stdout, stderr } = await execFileAsync(eforgeBin, ['daemon', action], {
        timeout: 5000,
        maxBuffer: 1024 * 1024 * 4,
      });
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
  // R6 (operations): manual recovery of stuck jobs is a deployment-wide
  // mutation, gated by the router-level deployment-control authority gate above.
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
