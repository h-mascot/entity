import { hasAssignedOwner, isActiveTaskColumn } from './agent';

export interface TaskAccountabilityInput {
  created_by_principal_id?: string;
  initiator_principal_id?: string;
  initiator_type?: string;
  owner_principal_id?: string;
  owner_principal_type?: string;
  executor_principal_id?: string;
  assignment_state?: string;
  taskmaster_drivable?: boolean;
}

export interface TaskAccountabilityError {
  error: string;
  message: string;
}

export function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readTaskPrincipalField(body: Record<string, unknown>, snakeKey: string, camelKey: string): string | null {
  return readNonEmptyString(body[snakeKey]) ?? readNonEmptyString(body[camelKey]);
}

function readOptionalTaskPrincipalField(
  body: Record<string, unknown>,
  snakeKey: keyof TaskAccountabilityInput,
  camelKey: string,
): string | undefined {
  if (!(snakeKey in body) && !(camelKey in body)) {
    return undefined;
  }
  return readTaskPrincipalField(body, snakeKey, camelKey) ?? '';
}

function readBooleanField(body: Record<string, unknown>, snakeKey: string, camelKey: string): boolean | undefined {
  const value = snakeKey in body ? body[snakeKey] : camelKey in body ? body[camelKey] : undefined;
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return undefined;
}

function normalizePrincipalType(value: string | null | undefined): string {
  return value?.trim().toLowerCase() || 'human';
}

function isTeamPrincipalType(value: string | null | undefined): boolean {
  const normalized = normalizePrincipalType(value);
  return normalized === 'team' || normalized === 'team_queue' || normalized === 'queue';
}

function isIndividualPrincipalType(value: string | null | undefined): boolean {
  return !isTeamPrincipalType(value);
}

function isAssignedPrincipal(value: string | null | undefined): boolean {
  return hasAssignedOwner(value ?? null);
}

export function parseTaskAccountabilityForCreate(
  body: Record<string, unknown>,
  actor: string,
): TaskAccountabilityInput | TaskAccountabilityError {
  const initiator = readTaskPrincipalField(body, 'initiator_principal_id', 'initiatorPrincipalId');
  if (!initiator) {
    return {
      error: 'Task initiator required',
      message: 'New tasks require initiator_principal_id.',
    };
  }

  const owner = readTaskPrincipalField(body, 'owner_principal_id', 'ownerPrincipalId');
  if (!owner) {
    return {
      error: 'Task owner required',
      message: 'New tasks require an individual owner_principal_id.',
    };
  }

  const ownerType = normalizePrincipalType(readTaskPrincipalField(body, 'owner_principal_type', 'ownerPrincipalType'));
  if (!isIndividualPrincipalType(ownerType)) {
    return {
      error: 'Task owner must be an individual principal',
      message: 'Team ownership is not allowed as final task ownership.',
    };
  }

  return {
    created_by_principal_id: readTaskPrincipalField(body, 'created_by_principal_id', 'createdByPrincipalId') ?? actor,
    initiator_principal_id: initiator,
    initiator_type: normalizePrincipalType(readTaskPrincipalField(body, 'initiator_type', 'initiatorType')),
    owner_principal_id: owner,
    owner_principal_type: ownerType,
    executor_principal_id: readTaskPrincipalField(body, 'executor_principal_id', 'executorPrincipalId') ?? undefined,
    taskmaster_drivable: readBooleanField(body, 'taskmaster_drivable', 'taskmasterDrivable') ?? false,
    assignment_state: readTaskPrincipalField(body, 'assignment_state', 'assignmentState') ?? undefined,
  };
}

export function parseTaskAccountabilityUpdates(body: Record<string, unknown>): TaskAccountabilityInput {
  const updates: TaskAccountabilityInput = {};
  const fields = [
    ['created_by_principal_id', 'createdByPrincipalId'],
    ['initiator_principal_id', 'initiatorPrincipalId'],
    ['initiator_type', 'initiatorType'],
    ['owner_principal_id', 'ownerPrincipalId'],
    ['owner_principal_type', 'ownerPrincipalType'],
    ['executor_principal_id', 'executorPrincipalId'],
    ['assignment_state', 'assignmentState'],
  ] as const;

  for (const [snakeKey, camelKey] of fields) {
    const value = readOptionalTaskPrincipalField(body, snakeKey, camelKey);
    if (typeof value !== 'undefined') {
      updates[snakeKey] = value;
    }
  }

  const taskmasterDrivable = readBooleanField(body, 'taskmaster_drivable', 'taskmasterDrivable');
  if (typeof taskmasterDrivable !== 'undefined') {
    updates.taskmaster_drivable = taskmasterDrivable;
  }

  return updates;
}

export function validateTaskAccountability(input: {
  column: string;
  assignee?: string | null;
  executor_principal_id?: string | null;
  taskmaster_drivable?: boolean;
  owner_principal_type?: string | null;
}): { ok: true } | ({ ok: false } & TaskAccountabilityError) {
  if (!isIndividualPrincipalType(input.owner_principal_type)) {
    return {
      ok: false,
      error: 'Task owner must be an individual principal',
      message: 'Team ownership is not allowed as final task ownership.',
    };
  }

  if (
    isActiveTaskColumn(input.column) &&
    !isAssignedPrincipal(input.assignee) &&
    !isAssignedPrincipal(input.executor_principal_id) &&
    !input.taskmaster_drivable
  ) {
    return {
      ok: false,
      error: 'Executable task requires assignee or executor',
      message:
        'Todo, Doing, and Review tasks require an individual assignee/executor or explicit Task-Master-drivable unassigned state.',
    };
  }

  return { ok: true };
}
