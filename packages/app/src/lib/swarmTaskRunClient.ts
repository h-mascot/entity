/**
 * Swarm "Run with agents" client for tasks (BRD-004). Swarm is invoked from an
 * eligible task — never presented as a board. Thin transport over
 * `/api/swarm/tasks/:taskId/run` and `/api/swarm/jobs?task_id=`.
 */

import { buildApiCandidates, requestJsonWithFallback } from './http';

export interface SwarmJobSummary {
  id: string;
  task_id: number | null;
  title: string;
  status: string;
  created_at?: string;
  updated_at?: string;
}

const ACTIVE_SWARM_JOB_STATUSES = ['draft', 'queued', 'dispatched', 'running'];

export function isSwarmJobActive(job: { status: string } | null | undefined): boolean {
  return !!job && ACTIVE_SWARM_JOB_STATUSES.includes(job.status);
}

export interface RunTaskWithAgentsResult {
  job: SwarmJobSummary;
  alreadyActive?: boolean;
}

export async function runTaskWithAgents(
  taskId: number,
  apiBase = '',
): Promise<RunTaskWithAgentsResult> {
  return requestJsonWithFallback<RunTaskWithAgentsResult>({
    urls: buildApiCandidates(`/swarm/tasks/${encodeURIComponent(taskId)}/run`, apiBase),
    init: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    continueOnStatuses: [],
    fallbackError: 'Unable to start agent run.',
  });
}

export async function fetchTaskSwarmJobs(
  taskId: number,
  apiBase = '',
): Promise<SwarmJobSummary[]> {
  const payload = await requestJsonWithFallback<{ jobs?: SwarmJobSummary[] }>({
    urls: buildApiCandidates(
      `/swarm/jobs?task_id=${encodeURIComponent(taskId)}`,
      apiBase,
    ),
    continueOnStatuses: [],
    fallbackError: 'Unable to load agent runs.',
  });
  return Array.isArray(payload.jobs) ? payload.jobs : [];
}

/** Newest active job for a task, or null. */
export function findActiveTaskSwarmJob(
  jobs: ReadonlyArray<SwarmJobSummary>,
): SwarmJobSummary | null {
  return jobs.find((job) => isSwarmJobActive(job)) ?? null;
}
