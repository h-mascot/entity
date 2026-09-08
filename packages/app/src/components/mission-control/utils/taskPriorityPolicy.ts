/** Canonical task priority values, structurally identical to `useTaskBoard.TaskPriority`. */
export type TaskPriorityValue = 'P0' | 'P1' | 'P2' | 'P3';

export interface TaskPriorityDefinition {
  value: TaskPriorityValue;
  label: string;
  shortExplanation: string;
  example: string;
  isDefault: boolean;
}

/**
 * Canonical P0-P3 task priority policy. The same definitions are published in
 * the Entity Wiki task-priorities section and are shared by task entry points.
 */
export const TASK_PRIORITY_DEFINITIONS: readonly TaskPriorityDefinition[] = [
  {
    value: 'P0',
    label: 'P0 — Incident / hard deadline',
    shortExplanation:
      'Production outage, security or data-loss risk, legal/compliance deadline, or customer-critical failure. Temporary override with named impact.',
    example: 'Restore task data after a failed migration',
    isDefault: false,
  },
  {
    value: 'P1',
    label: 'P1 — Project outcome',
    shortExplanation:
      "A user, customer, product, release, or decision outcome for the project's current goal.",
    example: 'Ship onboarding that a pilot customer can complete end to end',
    isDefault: false,
  },
  {
    value: 'P2',
    label: 'P2 — Direct unblocker (default)',
    shortExplanation:
      'The shortest task that unlocks a P1 outcome, or a high-consequence operating obligation.',
    example: 'Fix the build break blocking a release task',
    isDefault: true,
  },
  {
    value: 'P3',
    label: 'P3 — Engineering / maintenance / exploration',
    shortExplanation:
      'Implementation subtasks, refactors, tests, infrastructure, tooling, research, cleanup, and side-project work by default.',
    example: 'Add tests for the board task filter',
    isDefault: false,
  },
];

export const DEFAULT_TASK_PRIORITY: TaskPriorityValue = 'P2';

/** Entity Wiki page and anchor that publishes the full priority policy. */
export const TASK_PRIORITY_WIKI_PATH =
  '/docs/source/entity-wiki/features/mission-control-and-tasks.html';

/** Backward-compatible unscoped href for callers that intentionally have no org context. */
export const TASK_PRIORITY_WIKI_HREF = `${TASK_PRIORITY_WIKI_PATH}#task-priorities`;

function normalizePriorityOrgId(orgId?: string | null): string | null {
  const normalized = orgId?.trim();
  return normalized || null;
}

/**
 * Resolve the organization scope for task-priority help without guessing.
 * Explicit task/URL context wins; an organization list is usable only when
 * it contains one distinct non-empty organization.
 */
export function resolveTaskPriorityOrgId(
  explicitOrgId?: string | null,
  locationSearch?: string | null,
  availableOrgIds: readonly (string | null | undefined)[] = [],
): string | null {
  const explicit = normalizePriorityOrgId(explicitOrgId);
  if (explicit) return explicit;

  if (locationSearch) {
    const params = new URLSearchParams(locationSearch);
    const locationOrg = normalizePriorityOrgId(params.get('org') ?? params.get('orgId'));
    if (locationOrg) return locationOrg;
  }

  const distinctOrgIds = new Set(
    availableOrgIds
      .map((orgId) => normalizePriorityOrgId(orgId))
      .filter((orgId): orgId is string => Boolean(orgId)),
  );
  return distinctOrgIds.size === 1 ? [...distinctOrgIds][0] : null;
}

export function buildTaskPriorityWikiHref(orgId?: string | null): string | null {
  const normalizedOrgId = normalizePriorityOrgId(orgId);
  if (!normalizedOrgId) {
    return null;
  }

  return `${TASK_PRIORITY_WIKI_PATH}?org=${encodeURIComponent(normalizedOrgId)}#task-priorities`;
}

export function taskPriorityDefinition(value: TaskPriorityValue): TaskPriorityDefinition {
  return TASK_PRIORITY_DEFINITIONS.find((definition) => definition.value === value)
    ?? TASK_PRIORITY_DEFINITIONS.find((definition) => definition.isDefault)!;
}
