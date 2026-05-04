/**
 * Geordi Swarm — Symphony Provider
 *
 * Architecture: Entity is the source of truth (tracker). Symphony is the executor.
 * Symphony is a PULL-based orchestrator — it polls the tracker for ready jobs.
 *
 * Flow:
 *   1. Entity creates a Swarm job with status "queued"
 *   2. This provider marks the job as "ready" (dispatchable)
 *   3. Symphony polls GET /api/swarm/jobs?status=ready
 *   4. Symphony claims the job via POST /api/swarm/jobs/:id/claim
 *   5. Symphony runs the agent and writes status/proof back via Swarm API
 *
 * Symphony does NOT accept work via HTTP POST. It pulls from the tracker.
 *
 * The SYMPHONY_API_URL is used only for health checks (is Symphony running?).
 * Actual dispatch happens by Symphony's polling loop.
 *
 * Env vars:
 *   SYMPHONY_API_URL  — Symphony's dashboard URL for health checks (e.g. http://100.86.150.96:8200)
 *   SYMPHONY_API_KEY  — Optional auth for health endpoint
 */

import type {
  SwarmProvider,
  BuildJobPayload,
  DispatchResult,
  RunStatus,
  ProofBundle,
  ProviderHealth,
} from './interface';

import { updateSwarmJob, getSwarmJob } from '../db';

const SYMPHONY_API_URL = process.env.SYMPHONY_API_URL?.trim();
const SYMPHONY_API_KEY = process.env.SYMPHONY_API_KEY?.trim();

export class SymphonyProvider implements SwarmProvider {
  readonly name = 'symphony';
  readonly label = 'Symphony (Entity-native)';

  async healthCheck(): Promise<ProviderHealth> {
    if (!SYMPHONY_API_URL) {
      return {
        available: false,
        message: 'Symphony URL not configured. Set SYMPHONY_API_URL to the Symphony dashboard (e.g. http://Mac:8200).',
      };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const start = Date.now();
      const response = await fetch(`${SYMPHONY_API_URL}/`, {
        signal: controller.signal,
        headers: SYMPHONY_API_KEY ? { 'Authorization': `Bearer ${SYMPHONY_API_KEY}` } : {},
      });
      clearTimeout(timeout);
      const latencyMs = Date.now() - start;

      if (response.ok) {
        return { available: true, message: `Symphony reachable at ${SYMPHONY_API_URL} (pull-based)`, latencyMs };
      }
      return { available: false, message: `Symphony returned ${response.status}` };
    } catch (error) {
      return {
        available: false,
        message: `Symphony unreachable at ${SYMPHONY_API_URL}: ${error instanceof Error ? error.message : 'unknown'}`,
      };
    }
  }

  async dispatch(job: BuildJobPayload): Promise<DispatchResult> {
    // Symphony is pull-based. "Dispatch" means marking the job as ready
    // so Symphony's Entity tracker adapter picks it up on next poll.
    const updated = updateSwarmJob(job.jobId, {
      status: 'queued',
      feedback: 'Waiting for Symphony to pick up (poll-based dispatch)',
    });

    if (!updated) {
      throw new Error(`Failed to mark job ${job.jobId} as ready for Symphony`);
    }

    return {
      runHandle: `symphony-pull:${job.jobId}`,
      estimatedMinutes: 15,
      jobStatus: 'queued',
    };
  }

  async status(runHandle: string): Promise<RunStatus> {
    // For pull-based dispatch, check the job status directly from our DB
    const jobId = runHandle.replace(/^symphony-pull:/, '').replace(/^symphony:/, '');
    const job = getSwarmJob(jobId);

    if (!job) {
      return { state: 'queued', progress: 'Job not found' };
    }

    const stateMap: Record<string, RunStatus['state']> = {
      draft: 'queued',
      queued: 'queued',
      dispatched: 'running',
      running: 'running',
      proof: 'running',
      review: 'running',
      done: 'completed',
      failed: 'failed',
      cancelled: 'cancelled',
    };

    return {
      state: stateMap[job.status] ?? 'running',
      progress: job.feedback || job.status,
      startedAt: job.dispatched_at || undefined,
      updatedAt: job.updated_at,
    };
  }

  async cancel(runHandle: string): Promise<void> {
    const jobId = runHandle.replace(/^symphony-pull:/, '').replace(/^symphony:/, '');
    updateSwarmJob(jobId, { status: 'cancelled', completed_at: new Date().toISOString() });
  }

  async collectProof(runHandle: string): Promise<ProofBundle> {
    // Proof is written back by Symphony via the Swarm API POST /api/swarm/jobs/:id/proof
    // We just read what's there.
    const jobId = runHandle.replace(/^symphony-pull:/, '').replace(/^symphony:/, '');
    const job = getSwarmJob(jobId);

    return {
      buildLog: job?.feedback || 'Proof pending — Symphony writes proof via Swarm API',
    };
  }
}
