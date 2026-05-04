/**
 * Geordi Swarm - Dispatcher
 *
 * Selects a provider for a job, dispatches it, and manages the
 * state machine transitions. V1 is synchronous dispatch, no
 * background poll loop yet.
 *
 * TODO: Add background poll loop for running jobs
 * TODO: Add retry logic on failure
 * TODO: Add WebSocket notifications for status changes
 */

import type { SwarmProvider } from './providers/interface';
import { swarmProviderRegistry } from './provider-registry';
import { getSwarmJob, updateSwarmJob, createSwarmProof, listSwarmJobs } from './db';
import { getEntityDatabase } from '../../../db/src/entity-db';
import { AcpProvider } from './providers/acp';
import { SymphonyProvider } from './providers/symphony';
import { EforgeProvider } from './providers/eforge';
import { CodexProvider } from './providers/codex';
import { CcpProvider } from './providers/ccp';
import { FlywheelProvider } from './providers/flywheel';
import { PaperclipProvider } from './providers/paperclip';

// Bootstrap: register built-in providers (once)
let _registered = false;
function ensureProvidersRegistered(): void {
  if (_registered) return;
  _registered = true;
  swarmProviderRegistry.register(new AcpProvider());
  swarmProviderRegistry.register(new SymphonyProvider());
  swarmProviderRegistry.register(new EforgeProvider());
  swarmProviderRegistry.register(new CodexProvider());
  swarmProviderRegistry.register(new CcpProvider());
  swarmProviderRegistry.register(new FlywheelProvider());
  swarmProviderRegistry.register(new PaperclipProvider());
}

/**
 * Get a provider by name from the registry.
 */
export function getProvider(name: string): SwarmProvider | undefined {
  ensureProvidersRegistered();
  return swarmProviderRegistry.get(name);
}

/**
 * List all registered providers with their metadata.
 */
export function listProviders(): Array<{ name: string; label: string; meta?: SwarmProvider['meta'] }> {
  ensureProvidersRegistered();
  return swarmProviderRegistry.list().map((p) => ({
    name: p.name,
    label: p.label,
    meta: p.meta,
  }));
}

/**
 * Check if a provider is healthy and available.
 */
export async function checkProviderHealth(name: string) {
  ensureProvidersRegistered();
  const provider = swarmProviderRegistry.get(name);
  if (!provider) {
    return { available: false, message: `Unknown provider: ${name}` };
  }
  return provider.healthCheck();
}

function readSwarmPluginSettings(): { autoDispatch: boolean; maxConcurrentJobs: number } {
  try {
    const db = getEntityDatabase();
    const row = db.prepare('SELECT settings_json FROM plugin_settings WHERE plugin_id = ? LIMIT 1').get('geordi-swarm') as
      | { settings_json?: unknown }
      | undefined;
    const parsed = typeof row?.settings_json === 'string' ? (JSON.parse(row.settings_json) as Record<string, unknown>) : {};
    return {
      autoDispatch: parsed.autoDispatch === true,
      maxConcurrentJobs:
        typeof parsed.maxConcurrentJobs === 'number' && Number.isFinite(parsed.maxConcurrentJobs)
          ? Math.max(1, parsed.maxConcurrentJobs)
          : 2,
    };
  } catch {
    return { autoDispatch: false, maxConcurrentJobs: 2 };
  }
}

let autoDispatchInFlight = false;

export async function kickAutoDispatch(): Promise<{ dispatched: number; attempted: number }> {
  const { autoDispatch, maxConcurrentJobs } = readSwarmPluginSettings();
  if (!autoDispatch || autoDispatchInFlight) {
    return { dispatched: 0, attempted: 0 };
  }

  autoDispatchInFlight = true;
  try {
    const active = listSwarmJobs().filter((job) => ['dispatched', 'running'].includes(job.status)).length;
    const capacity = Math.max(0, maxConcurrentJobs - active);
    if (capacity === 0) {
      return { dispatched: 0, attempted: 0 };
    }

    const queuedJobs = listSwarmJobs({ status: 'queued' })
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(0, capacity);

    let dispatched = 0;
    for (const job of queuedJobs) {
      const result = await dispatchJob(job.id);
      if (result.success) dispatched += 1;
    }

    return { dispatched, attempted: queuedJobs.length };
  } finally {
    autoDispatchInFlight = false;
  }
}

export async function dispatchJob(jobId: string): Promise<{ success: boolean; error?: string }> {
  ensureProvidersRegistered();
  const job = getSwarmJob(jobId);
  if (!job) {
    return { success: false, error: 'Job not found' };
  }

  if (!['draft', 'queued'].includes(job.status)) {
    return { success: false, error: `Cannot dispatch job in status: ${job.status}` };
  }

  const provider = swarmProviderRegistry.get(job.provider);
  if (!provider) {
    return { success: false, error: `Unknown provider: ${job.provider}` };
  }

  const health = await provider.healthCheck();
  if (!health.available) {
    return { success: false, error: `Provider ${job.provider} unavailable: ${health.message}` };
  }

  updateSwarmJob(jobId, {
    status: 'dispatched',
    dispatched_at: new Date().toISOString(),
  });

  try {
    const result = await provider.dispatch({
      jobId: job.id,
      title: job.title,
      spec: job.spec,
      repo: job.repo,
      branch: job.branch ?? undefined,
      context: job.context_file ?? undefined,
      feedback: job.feedback ?? undefined,
    });

    updateSwarmJob(jobId, {
      status: result.jobStatus ?? 'running',
      run_handle: result.runHandle,
    });

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Dispatch failed';
    updateSwarmJob(jobId, {
      status: 'failed',
      feedback: `Dispatch error: ${message}`,
    });
    return { success: false, error: message };
  }
}

export async function checkJobStatus(jobId: string): Promise<{ success: boolean; status?: string; error?: string }> {
  ensureProvidersRegistered();
  const job = getSwarmJob(jobId);
  if (!job || !job.run_handle) {
    return { success: false, error: 'Job not found or no run handle' };
  }

  const provider = swarmProviderRegistry.get(job.provider);
  if (!provider) {
    return { success: false, error: `Unknown provider: ${job.provider}` };
  }

  try {
    const runStatus = await provider.status(job.run_handle);

    if (runStatus.state === 'completed') {
      updateSwarmJob(jobId, { status: 'proof' });

      try {
        const proof = await provider.collectProof(job.run_handle);
        createSwarmProof({
          job_id: jobId,
          provider: job.provider,
          commit_sha: proof.commitSha,
          branch: proof.branch,
          build_log: proof.buildLog,
          test_result: proof.testResult,
          test_output: proof.testOutput,
          screenshots: proof.screenshots,
          artifacts: proof.artifacts,
          duration_sec: proof.durationSec,
        });
        updateSwarmJob(jobId, { status: 'review' });
      } catch {
        updateSwarmJob(jobId, { status: 'review' });
      }

      return { success: true, status: 'review' };
    }

    if (runStatus.state === 'failed') {
      const newRetryCount = job.retry_count + 1;
      if (newRetryCount >= job.max_retries) {
        updateSwarmJob(jobId, { status: 'failed', retry_count: newRetryCount });
        return { success: true, status: 'failed' };
      }

      updateSwarmJob(jobId, {
        status: 'queued',
        retry_count: newRetryCount,
        run_handle: undefined,
      });
      return { success: true, status: 'queued' };
    }

    return { success: true, status: runStatus.state };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Status check failed' };
  }
}

export async function cancelJob(jobId: string): Promise<{ success: boolean; error?: string }> {
  ensureProvidersRegistered();
  const job = getSwarmJob(jobId);
  if (!job) return { success: false, error: 'Job not found' };

  if (!['dispatched', 'running', 'queued'].includes(job.status)) {
    return { success: false, error: `Cannot cancel job in status: ${job.status}` };
  }

  const provider = swarmProviderRegistry.get(job.provider);
  if (!provider || !job.run_handle) {
    updateSwarmJob(jobId, {
      status: 'cancelled',
      feedback: 'Cancelled by user before provider run handle was assigned.',
      completed_at: new Date().toISOString(),
    });
    return { success: true };
  }

  try {
    await provider.cancel(job.run_handle);
    updateSwarmJob(jobId, {
      status: 'cancelled',
      feedback: 'Cancelled by user.',
      completed_at: new Date().toISOString(),
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Cancel failed' };
  }
}

export function acceptJob(jobId: string): { success: boolean; error?: string } {
  const job = getSwarmJob(jobId);
  if (!job) return { success: false, error: 'Job not found' };
  if (job.status !== 'review') return { success: false, error: `Cannot accept job in status: ${job.status}` };
  updateSwarmJob(jobId, { status: 'done', completed_at: new Date().toISOString() });
  return { success: true };
}

export function rejectJob(jobId: string, feedback: string): { success: boolean; error?: string } {
  const job = getSwarmJob(jobId);
  if (!job) return { success: false, error: 'Job not found' };
  if (!['review', 'proof'].includes(job.status)) {
    return { success: false, error: `Cannot reject job in status: ${job.status}` };
  }
  updateSwarmJob(jobId, {
    status: 'queued',
    feedback,
    retry_count: job.retry_count + 1,
    run_handle: undefined,
  });
  return { success: true };
}
