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

export interface SwarmProofSummary {
  id: string;
  commit_sha?: string | null;
  test_result?: string | null;
}

/** Fetch proof artifacts for a swarm job (BRD-004 execution-detail affordance). */
export async function fetchSwarmJobProofs(
  jobId: string,
  apiBase = '',
): Promise<SwarmProofSummary[]> {
  const payload = await requestJsonWithFallback<{ proofs?: SwarmProofSummary[] }>({
    urls: buildApiCandidates(`/swarm/jobs/${encodeURIComponent(jobId)}/proofs`, apiBase),
    continueOnStatuses: [],
    fallbackError: 'Unable to load agent run proof.',
  });
  return Array.isArray(payload.proofs) ? payload.proofs : [];
}
