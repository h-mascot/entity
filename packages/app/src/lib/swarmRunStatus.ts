/**
 * Swarm "Run with agents" status/proof view model (BRD-004). Pure helpers that
 * drive the task-detail polling decision, terminal-state display, and proof
 * affordance. Swarm is a task execution capability, never a board.
 */

export interface SwarmRunJobLite {
  id: string;
  status: string;
  feedback?: string | null;
  completed_at?: string | null;
}

export interface SwarmProofLite {
  id: string;
  commit_sha?: string | null;
  test_result?: string | null;
}

/** In-flight statuses that should be polled while a run is active. */
export const POLLING_SWARM_JOB_STATUSES = ['draft', 'queued', 'dispatched', 'running'] as const;

/** Statuses that represent a finished run (no further polling). */
export const TERMINAL_SWARM_JOB_STATUSES = ['done', 'failed', 'cancelled'] as const;

export function isAgentRunPolling(job: SwarmRunJobLite | null | undefined): boolean {
  return !!job && (POLLING_SWARM_JOB_STATUSES as readonly string[]).includes(job.status);
}

export function isAgentRunTerminal(job: SwarmRunJobLite | null | undefined): boolean {
  return !!job && (TERMINAL_SWARM_JOB_STATUSES as readonly string[]).includes(job.status);
}

/** Whether the UI should keep polling the run (only while in-flight). */
export function shouldPollAgentRun(job: SwarmRunJobLite | null | undefined): boolean {
  return isAgentRunPolling(job);
}

export type AgentRunOutcome = 'success' | 'failure' | 'unknown';

/** Minimal task-linked job shape used to retain the newest run (BRD-004). */
export interface SwarmTaskJobSummary {
  id: string;
  task_id: number | null;
  created_at?: string;
}

/**
 * Newest task-linked job, or null. Retains the run through active→terminal so the
 * task detail can surface a finished run's status, proof, and execution details
 * (BRD-004). Jobs not linked to a task are ignored. Selection is by created_at
 * descending with a stable id-descending tiebreak, so it is independent of the
 * API's return order and deterministic on ties.
 */
export function findNewestTaskSwarmJob<T extends SwarmTaskJobSummary>(
  jobs: ReadonlyArray<T>,
): T | null {
  let newest: T | null = null;
  for (const job of jobs) {
    if (typeof job.task_id !== 'number') continue;
    if (!newest) {
      newest = job;
      continue;
    }
    const jobTime = job.created_at ?? '';
    const newestTime = newest.created_at ?? '';
    if (jobTime > newestTime || (jobTime === newestTime && job.id > newest.id)) {
      newest = job;
    }
  }
  return newest;
}

export interface AgentRunViewState {
  phase: 'idle' | 'running' | 'terminal';
  /** True once the run reaches a terminal status (done/failed/cancelled). */
  terminal: boolean;
  /** True when at least one proof artifact has been posted for the job. */
  hasProof: boolean;
  outcome: AgentRunOutcome | null;
  /** Short human-readable status summary for the task-detail affordance. */
  summary: string;
}

/**
 * Derive the task-detail run view state from the latest job + its proofs. While
 * in-flight the phase is 'running' (poll); once terminal the outcome is derived
 * and any available proof is surfaced. Used to show current progress/error after
 * completion and to link into the execution-detail/proof view.
 */
export function deriveAgentRunViewState(
  job: SwarmRunJobLite | null | undefined,
  proofs: ReadonlyArray<SwarmProofLite> = [],
): AgentRunViewState {
  if (!job) {
    return { phase: 'idle', terminal: false, hasProof: false, outcome: null, summary: 'No agent run.' };
  }
  const hasProof = proofs.length > 0;
  if (isAgentRunPolling(job)) {
    return {
      phase: 'running',
      terminal: false,
      hasProof,
      outcome: null,
      summary: `Agent run ${job.status}…`,
    };
  }
  const terminal = isAgentRunTerminal(job);
  const outcome: AgentRunOutcome =
    job.status === 'done' ? 'success' : job.status === 'failed' || job.status === 'cancelled' ? 'failure' : 'unknown';
  const proofLine = hasProof ? ' Proof available.' : '';
  const summary =
    outcome === 'success'
      ? `Agent run completed.${proofLine}`
      : outcome === 'failure'
        ? `Agent run ${job.status}.${proofLine}`
        : `Agent run ${job.status}.${proofLine}`;
  return { phase: terminal ? 'terminal' : 'running', terminal, hasProof, outcome, summary };
}
