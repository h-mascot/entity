/**
 * Swarm Self-Healing Module
 *
 * Periodically checks for stuck jobs and auto-recovers them:
 * - Jobs stuck in 'running' for >60 minutes are marked failed
 * - Failed jobs with retry_count < max_retries are re-queued
 */

import { getEntityDatabase } from '../../../db/src/entity-db';
import { updateSwarmJob, getSwarmJob, listSwarmJobs, ensureSwarmSchema } from './db';
import type { SwarmJob } from './types';

const STUCK_THRESHOLD_MINUTES = 60;
const HEAL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

interface HealResult {
  stuckJobs: number;
  retriedJobs: number;
  failedJobs: number;
  timestamp: string;
}

/**
 * Find and heal stuck jobs
 */
export async function healStuckJobs(): Promise<HealResult> {
  const db = getEntityDatabase();
  // The healer can run before any swarm route has triggered schema setup, so
  // ensure the swarm tables/columns exist before querying dispatched_at.
  ensureSwarmSchema(db);
  const now = new Date();
  const threshold = new Date(now.getTime() - STUCK_THRESHOLD_MINUTES * 60 * 1000);
  const thresholdIso = threshold.toISOString();

  const result: HealResult = {
    stuckJobs: 0,
    retriedJobs: 0,
    failedJobs: 0,
    timestamp: now.toISOString(),
  };

  // Find jobs stuck in 'running' past the threshold
  const stuckJobs = db.prepare(`
    SELECT * FROM swarm_jobs 
    WHERE status = 'running' 
    AND dispatched_at < ?
  `).all(thresholdIso) as SwarmJob[];

  result.stuckJobs = stuckJobs.length;

  for (const job of stuckJobs) {
    const canRetry = job.retry_count < job.max_retries;

    if (canRetry) {
      // Re-queue for retry
      updateSwarmJob(job.id, {
        status: 'queued',
        retry_count: job.retry_count + 1,
        feedback: `Auto-healed: stuck for >\${STUCK_THRESHOLD_MINUTES}min. Retry \${job.retry_count + 1}/\${job.max_retries}`,
        run_handle: undefined,
      });
      result.retriedJobs++;
      console.log(`[healer] Re-queued stuck job \${job.id} (retry \${job.retry_count + 1}/\${job.max_retries})`);
    } else {
      // Max retries exhausted, mark as failed
      updateSwarmJob(job.id, {
        status: 'failed',
        feedback: `Auto-failed: stuck for >\${STUCK_THRESHOLD_MINUTES}min, max retries (\${job.max_retries}) exhausted`,
      });
      result.failedJobs++;
      console.log(`[healer] Failed stuck job \${job.id} (max retries exhausted)`);
    }
  }

  if (result.stuckJobs > 0) {
    console.log(`[healer] Healed \${result.stuckJobs} stuck jobs: \${result.retriedJobs} retried, \${result.failedJobs} failed`);
  }

  return result;
}

let healerInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the background healing interval
 */
export function startHealer(): void {
  if (healerInterval) {
    console.log('[healer] Already running');
    return;
  }

  console.log(`[healer] Starting (interval: \${HEAL_INTERVAL_MS / 1000}s, threshold: \${STUCK_THRESHOLD_MINUTES}min)`);
  
  // Run immediately on start
  healStuckJobs().catch(err => console.error('[healer] Initial heal failed:', err));
  
  // Then run periodically
  healerInterval = setInterval(() => {
    healStuckJobs().catch(err => console.error('[healer] Heal failed:', err));
  }, HEAL_INTERVAL_MS);
}

/**
 * Stop the background healing interval
 */
export function stopHealer(): void {
  if (healerInterval) {
    clearInterval(healerInterval);
    healerInterval = null;
    console.log('[healer] Stopped');
  }
}

/**
 * Get healer status
 */
export function getHealerStatus(): { running: boolean; intervalMs: number; thresholdMinutes: number } {
  return {
    running: healerInterval !== null,
    intervalMs: HEAL_INTERVAL_MS,
    thresholdMinutes: STUCK_THRESHOLD_MINUTES,
  };
}
