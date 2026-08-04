/**
 * Swarm Self-Healing Module
 *
 * Periodically checks for stuck jobs and auto-recovers them:
 * - Jobs stuck in 'running' for >60 minutes are marked failed
 * - Failed jobs with retry_count < max_retries are re-queued
 */

import { getEntityDatabase } from '../../../db/src/entity-db';
import { ensureAppSettingsTable, getSettingJson, setSettingJson } from '../config/settings-store';
import { updateSwarmJobOn, ensureSwarmSchema } from './db';
import type { SwarmJob } from './types';
import type Database from 'better-sqlite3';

const STUCK_THRESHOLD_MINUTES = 60;
const HEAL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const HEALER_STATUS_KEY = 'swarm.healerStatus';

interface HealResult {
  stuckJobs: number;
  retriedJobs: number;
  failedJobs: number;
  timestamp: string;
}

export interface HealOutcome {
  result: HealResult | null;
  timestamp: string;
  error: string | null;
}

export interface HealDependencies {
  /** Injectable for tests. Defaults to the shared Entity database. */
  getDatabase?: () => Database.Database;
}

let lastHealOutcome: HealOutcome | null = null;

function defaultGetDatabase(): Database.Database {
  return getEntityDatabase();
}

function persistHealOutcome(outcome: HealOutcome, getDatabase: () => Database.Database = defaultGetDatabase): void {
  try {
    const db = getDatabase();
    ensureAppSettingsTable(db);
    setSettingJson(db, HEALER_STATUS_KEY, outcome, 'healer');
  } catch {
    // Persistence is best-effort; the in-memory outcome is still authoritative.
  }
}

function loadPersistedHealOutcome(getDatabase: () => Database.Database = defaultGetDatabase): HealOutcome | null {
  try {
    const db = getDatabase();
    ensureAppSettingsTable(db);
    const stored = getSettingJson(db, HEALER_STATUS_KEY);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null;
    const record = stored as Partial<HealOutcome>;
    // THE-932 (blocker 3): a successful outcome is persisted with `error: null`.
    // Accept both string errors (failures) and null (success) so the normal
    // successful state is restored across process/module restart.
    if (typeof record.timestamp !== 'string') return null;
    if (record.error !== null && typeof record.error !== 'string') return null;
    return { result: (record.result as HealResult) ?? null, timestamp: record.timestamp, error: record.error };
  } catch {
    return null;
  }
}

// Restoration is deliberately deferred: importing the swarm module can happen
// before dotenv/runtime bootstrap has resolved ENTITY_TASK_DB_PATH.

/**
 * Find and heal stuck jobs
 */
export async function healStuckJobs(deps: HealDependencies = {}): Promise<HealResult> {
  const getDatabase = deps.getDatabase ?? defaultGetDatabase;
  try {
    const db = getDatabase();
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
        // Re-queue for retry. THE-932 (blocker 4): mutate the SAME injected
        // connection the stuck jobs were read from — never the module's
        // default/global database.
        updateSwarmJobOn(db, job.id, {
          status: 'queued',
          retry_count: job.retry_count + 1,
          feedback: `Auto-healed: stuck for >${STUCK_THRESHOLD_MINUTES}min. Retry ${job.retry_count + 1}/${job.max_retries}`,
          run_handle: undefined,
        });
        result.retriedJobs++;
        console.log(`[healer] Re-queued stuck job ${job.id} (retry ${job.retry_count + 1}/${job.max_retries})`);
      } else {
        // Max retries exhausted, mark as failed.
        updateSwarmJobOn(db, job.id, {
          status: 'failed',
          feedback: `Auto-failed: stuck for >${STUCK_THRESHOLD_MINUTES}min, max retries (${job.max_retries}) exhausted`,
        });
        result.failedJobs++;
        console.log(`[healer] Failed stuck job ${job.id} (max retries exhausted)`);
      }
    }

    if (result.stuckJobs > 0) {
      console.log(`[healer] Healed ${result.stuckJobs} stuck jobs: ${result.retriedJobs} retried, ${result.failedJobs} failed`);
    }

    recordHealSuccess(result, getDatabase);
    return result;
  } catch (error) {
    recordHealFailure(error, getDatabase);
    throw error;
  }
}

function recordHealSuccess(result: HealResult, getDatabase: () => Database.Database = defaultGetDatabase): void {
  const outcome: HealOutcome = { result, timestamp: result.timestamp, error: null };
  lastHealOutcome = outcome;
  healerStateInitialized = true;
  persistHealOutcome(outcome, getDatabase);
}

function recordHealFailure(error: unknown, getDatabase: () => Database.Database = defaultGetDatabase): void {
  const message = error instanceof Error ? error.message : 'Unknown heal error';
  const outcome: HealOutcome = { result: null, timestamp: new Date().toISOString(), error: message };
  lastHealOutcome = outcome;
  healerStateInitialized = true;
  persistHealOutcome(outcome, getDatabase);
}

let healerStateInitialized = false;
function ensureHealerStateInitialized(): void {
  if (healerStateInitialized) return;
  lastHealOutcome = loadPersistedHealOutcome();
  healerStateInitialized = true;
}

export function getLastHealOutcome(): HealOutcome | null {
  ensureHealerStateInitialized();
  return lastHealOutcome;
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

  ensureHealerStateInitialized();
  console.log(`[healer] Starting (interval: ${HEAL_INTERVAL_MS / 1000}s, threshold: ${STUCK_THRESHOLD_MINUTES}min)`);
  
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
export function getHealerStatus(): { running: boolean; intervalMs: number; thresholdMinutes: number; lastResult: HealOutcome | null } {
  return {
    running: healerInterval !== null,
    intervalMs: HEAL_INTERVAL_MS,
    thresholdMinutes: STUCK_THRESHOLD_MINUTES,
    lastResult: getLastHealOutcome(),
  };
}
