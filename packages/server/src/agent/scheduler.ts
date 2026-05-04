import { AGENT_CONFIG } from './config';

export interface TaskAgentScanRunner {
  runStaleScan: (source?: 'scheduled' | 'manual') => Promise<unknown>;
  runReviewHygieneScan?: (source?: 'scheduled' | 'manual') => Promise<unknown>;
  runOwnershipCheck?: (source?: 'scheduled' | 'manual') => Promise<unknown>;
}

export interface TaskAgentScheduler {
  start: () => void;
  stop: () => void;
  isRunning: () => boolean;
}

export interface TaskAgentSchedulerOptions {
  enabled?: boolean;
  intervalMs?: number;
}

export function createTaskAgentScheduler(
  scanRunner: TaskAgentScanRunner,
  options: TaskAgentSchedulerOptions = {}
): TaskAgentScheduler {
  const enabled = typeof options.enabled === 'boolean' ? options.enabled : AGENT_CONFIG.enabled;
  const intervalMs =
    typeof options.intervalMs === 'number' && Number.isFinite(options.intervalMs) && options.intervalMs > 0
      ? options.intervalMs
      : AGENT_CONFIG.scanIntervalMs;

  let intervalHandle: NodeJS.Timeout | null = null;

  return {
    start: () => {
      if (!enabled || intervalHandle) {
        return;
      }

      intervalHandle = setInterval(() => {
        void scanRunner.runStaleScan('scheduled').catch((err) => {
          const message = err instanceof Error ? err.message : 'Unknown error';
          console.error('[TaskAgentScheduler] Stale scan failed:', message);
        });

        if (typeof scanRunner.runReviewHygieneScan === 'function') {
          void scanRunner.runReviewHygieneScan('scheduled').catch((err) => {
            const message = err instanceof Error ? err.message : 'Unknown error';
            console.error('[TaskAgentScheduler] Review hygiene scan failed:', message);
          });
        }

        if (typeof scanRunner.runOwnershipCheck === 'function') {
          void scanRunner.runOwnershipCheck('scheduled').catch((err) => {
            const message = err instanceof Error ? err.message : 'Unknown error';
            console.error('[TaskAgentScheduler] Ownership check failed:', message);
          });
        }
      }, intervalMs);
      intervalHandle.unref();
    },

    stop: () => {
      if (!intervalHandle) {
        return;
      }

      clearInterval(intervalHandle);
      intervalHandle = null;
    },

    isRunning: () => Boolean(intervalHandle),
  };
}
