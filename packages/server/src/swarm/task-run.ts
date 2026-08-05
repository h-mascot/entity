import type { CreateSwarmJobInput } from './types';
import { DEFAULT_WORKSPACE_ORG_ID, DEFAULT_WORKSPACE_TEAM_ID } from '../../../db/src';

/**
 * Swarm-as-task-execution helpers (BRD-004). Swarm is NOT a board; it is invoked
 * from an eligible task via a "Run with agents" action that creates a task-linked
 * swarm job and surfaces its status/proof.
 *
 * Dispatch targets must come from governed configuration, explicit request input,
 * or task metadata — never an example placeholder. Resolution fails closed.
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

// ---------------------------------------------------------------------------
// Dispatch target resolution (BRD-004 — fail closed, no example placeholders).
// ---------------------------------------------------------------------------

/** Governed env keys that may supply a default Run-with-agents execution target. */
export const RUN_WITH_AGENTS_TARGET_ENV = {
  repo: 'ENTITY_SWARM_RUN_REPO',
  branch: 'ENTITY_SWARM_RUN_BRANCH',
  provider: 'ENTITY_SWARM_RUN_PROVIDER',
} as const;

export interface RunWithAgentsTarget {
  repo: string;
  branch: string;
  provider: string;
}

/**
 * Thrown when a Run-with-agents job is attempted without a resolvable execution
 * target. Routes turn this into a fail-closed 400 (never a placeholder repo).
 */
export class NoExecutionTargetError extends Error {
  readonly code = 'NO_EXECUTION_TARGET' as const;
  constructor(message = 'no execution target configured for Run with agents') {
    super(message);
    this.name = 'NoExecutionTargetError';
  }
}

function readStringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Parse a task metadata JSON blob looking for an execution target. */
function targetFromTaskMetadata(metadata: string | null | undefined): Partial<RunWithAgentsTarget> {
  if (!metadata) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadata);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object') return {};
  const obj = parsed as Record<string, unknown>;
  // Accept canonical and snake_case keys (governed task metadata contracts vary).
  const repo = readStringField(obj.repo ?? obj.swarm_repo);
  const branch = readStringField(obj.branch ?? obj.swarm_branch);
  const provider = readStringField(obj.provider ?? obj.swarm_provider);
  const result: Partial<RunWithAgentsTarget> = {};
  if (repo) result.repo = repo;
  if (branch) result.branch = branch;
  if (provider) result.provider = provider;
  return result;
}

/**
 * Resolve a Run-with-agents execution target. Resolution order: explicit request
 * body → governed env config → task metadata. The repo is mandatory; branch and
 * provider default sensibly only when a repo exists. Returns null (fail closed)
 * when no real repo can be resolved — never an example/placeholder URL.
 */
export function resolveRunWithAgentsTarget(input: {
  body?: Record<string, unknown> | null;
  task: { metadata?: string | null };
  env?: Record<string, string | undefined> | NodeJS.ProcessEnv;
}): RunWithAgentsTarget | null {
  const body = input.body ?? {};
  const env = input.env ?? process.env;
  const fromBody: Partial<RunWithAgentsTarget> = {
    repo: readStringField(body.repo),
    branch: readStringField(body.branch),
    provider: readStringField(body.provider),
  };
  const fromEnv: Partial<RunWithAgentsTarget> = {
    repo: readStringField(env[RUN_WITH_AGENTS_TARGET_ENV.repo]),
    branch: readStringField(env[RUN_WITH_AGENTS_TARGET_ENV.branch]),
    provider: readStringField(env[RUN_WITH_AGENTS_TARGET_ENV.provider]),
  };
  const fromMetadata = targetFromTaskMetadata(input.task.metadata);

  const repo = fromBody.repo ?? fromEnv.repo ?? fromMetadata.repo;
  if (!repo) {
    return null;
  }
  const branch = fromBody.branch ?? fromEnv.branch ?? fromMetadata.branch ?? 'main';
  const provider = fromBody.provider ?? fromEnv.provider ?? fromMetadata.provider ?? 'acp';
  return { repo, branch, provider };
}

/**
 * Build the swarm-job input for a "Run with agents" action on a task: titled from
 * the task name, spec from the task description (falling back to the name), and
 * linked to the task id so the job is traceable back to it. The execution target
 * MUST be supplied (resolved via {@link resolveRunWithAgentsTarget}); the builder
 * fails closed instead of inventing a placeholder repo.
 */
export function buildRunWithAgentsJobInput(
  task: { id: number; name: string; description?: string | null },
  options: { target: RunWithAgentsTarget },
): CreateSwarmJobInput {
  if (!options?.target?.repo) {
    throw new NoExecutionTargetError();
  }
  const name = task.name?.trim() || `Task ${task.id}`;
  const description = typeof task.description === 'string' ? task.description.trim() : '';
  return {
    title: `Run: ${name}`,
    spec: description || name,
    repo: options.target.repo,
    branch: options.target.branch,
    provider: options.target.provider,
    task_id: task.id,
  };
}

// ---------------------------------------------------------------------------
// Eligibility + tenant scope (BRD-004 server-side authorization).
// ---------------------------------------------------------------------------

export interface AgentRunEligibilityTask {
  name?: string;
  archived?: boolean;
  column?: string;
}

/**
 * Eligibility predicate for "Run with agents". A task is eligible when it is
 * actionable: it has a usable name, is not archived, and is not in a terminal
 * column. Routes enforce this and return a structured ineligible error so the
 * UI's "not eligible" branch is reachable for real task states.
 */
export function isTaskEligibleForAgentRun(task: AgentRunEligibilityTask): boolean {
  const name = typeof task.name === 'string' ? task.name.trim() : '';
  if (!name) return false;
  if (task.archived === true) return false;
  const column = typeof task.column === 'string' ? task.column : '';
  if (column === 'done' || column === 'complete' || column === 'completed') return false;
  return true;
}

export interface ScopedTask {
  org_id?: string;
  team_id?: string;
}

/**
 * Whether a task belongs to the request-derived org/team scope. Tasks with no
 * explicit scope default to the configured default workspace (single-tenant
 * local default). Cross-org/cross-team tasks are rejected (fail closed).
 */
export function isTaskInScope(
  task: ScopedTask,
  scope: { orgId: string; teamId: string },
): boolean {
  const taskOrg = task.org_id ?? DEFAULT_WORKSPACE_ORG_ID;
  const taskTeam = task.team_id ?? DEFAULT_WORKSPACE_TEAM_ID;
  return taskOrg === scope.orgId && taskTeam === scope.teamId;
}
