import type { CreateSwarmJobInput } from './types';

/**
 * Swarm-as-task-execution helpers (BRD-004). Swarm is NOT a board; it is invoked
 * from an eligible task via a "Run with agents" action that creates a task-linked
 * swarm job and surfaces its status/proof.
 */

/** In-flight statuses that count as an active run for duplicate-job guards. */
export const ACTIVE_SWARM_JOB_STATUSES = ['draft', 'queued', 'dispatched', 'running'] as const;

export function isSwarmJobActive(job: { status: string }): boolean {
  return (ACTIVE_SWARM_JOB_STATUSES as readonly string[]).includes(job.status);
}

/** First active (in-flight) job in the given list, or undefined. */
export function findActiveSwarmJob<T extends { id: string; status: string }>(
  jobs: ReadonlyArray<T>,
): T | undefined {
  return jobs.find((job) => isSwarmJobActive(job));
}

/**
 * Build the swarm-job input for a "Run with agents" action on a task: titled from
 * the task name, spec from the task description (falling back to the name), and
 * linked to the task id so the job is traceable back to it.
 */
export function buildRunWithAgentsJobInput(
  task: { id: number; name: string; description?: string | null },
  options: { repo?: string; branch?: string; provider?: string } = {},
): CreateSwarmJobInput {
  const name = task.name?.trim() || `Task ${task.id}`;
  const description = typeof task.description === 'string' ? task.description.trim() : '';
  return {
    title: `Run: ${name}`,
    spec: description || name,
    repo: options.repo ?? 'https://github.com/example/entity',
    branch: options.branch ?? 'main',
    provider: options.provider ?? 'acp',
    task_id: task.id,
  };
}
