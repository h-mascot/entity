import { hasAssignedOwner, isActiveTaskColumn } from './agent';
import type { TaskRecord } from '../../db/src';

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

export type OwnerAccountabilityGroup =
  | 'stalled'
  | 'escalated'
  | 'review_blocked'
  | 'gate_pending'
  | 'receipt_failed'
  | 'migration_warning';

export interface OwnerAccountabilityInboxItem {
  task: TaskRecord;
  groups: OwnerAccountabilityGroup[];
  deepLink: string;
  reasons: string[];
}

export interface OwnerAccountabilityInbox {
  owner_principal_id: string;
  generated_at: string;
  total: number;
  groups: Record<OwnerAccountabilityGroup, OwnerAccountabilityInboxItem[]>;
  items: OwnerAccountabilityInboxItem[];
}

const OWNER_GROUPS: OwnerAccountabilityGroup[] = [
  'stalled',
  'escalated',
  'review_blocked',
  'gate_pending',
  'receipt_failed',
  'migration_warning',
];

function parseTaskMetadata(task: Pick<TaskRecord, 'metadata'>): Record<string, unknown> {
  if (!task.metadata) {
    return {};
  }
  try {
    const parsed = JSON.parse(task.metadata);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function textIncludes(value: unknown, needle: string): boolean {
  return typeof value === 'string' && value.toLowerCase().includes(needle);
}

function hasNonEmptyValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(value);
}

function addGroup(
  groups: OwnerAccountabilityGroup[],
  reasons: string[],
  group: OwnerAccountabilityGroup,
  reason: string,
) {
  if (!groups.includes(group)) {
    groups.push(group);
  }
  reasons.push(reason);
}

export function buildOwnerAccountabilityInbox(input: {
  ownerPrincipalId: string;
  tasks: TaskRecord[];
  now?: Date;
  stalledHours?: number;
}): OwnerAccountabilityInbox {
  const ownerPrincipalId = input.ownerPrincipalId.trim();
  const now = input.now ?? new Date();
  const stalledHours = input.stalledHours ?? 24;
  const grouped = Object.fromEntries(OWNER_GROUPS.map((group) => [group, []])) as unknown as Record<OwnerAccountabilityGroup, OwnerAccountabilityInboxItem[]>;
  const items: OwnerAccountabilityInboxItem[] = [];

  for (const task of input.tasks) {
    if (!ownerPrincipalId || task.owner_principal_id !== ownerPrincipalId || task.archived || task.column === 'done') {
      continue;
    }

    const metadata = parseTaskMetadata(task);
    const groups: OwnerAccountabilityGroup[] = [];
    const reasons: string[] = [];
    const updatedAt = Date.parse(task.updated_at || task.created_at);
    const ageHours = Number.isNaN(updatedAt) ? null : (now.getTime() - updatedAt) / (1000 * 60 * 60);

    if (isActiveTaskColumn(task.column) && ageHours !== null && ageHours >= stalledHours) {
      addGroup(groups, reasons, 'stalled', `No update for ${Math.floor(ageHours)}h`);
    }
    if (
      metadata.escalated === true ||
      hasNonEmptyValue(metadata.owner_escalations) ||
      (typeof metadata.escalation_marker === 'string' && metadata.escalation_marker !== 'none') ||
      textIncludes(metadata.review_decision, 'escalated') ||
      textIncludes(task.blocker_reason, 'escalat')
    ) {
      addGroup(groups, reasons, 'escalated', 'Escalation marker present');
    }
    if (task.column === 'review' || (task.review_required && task.review_state !== 'accepted')) {
      addGroup(groups, reasons, 'review_blocked', 'Review is required or in progress');
    }
    if (task.human_gate_required && task.human_gate_state !== 'approved') {
      addGroup(groups, reasons, 'gate_pending', 'Human gate is pending');
    }
    if (
      textIncludes(metadata.receipt_status, 'failed') ||
      textIncludes(metadata.receipt_status, 'missing_receipt') ||
      metadata.receipt_failed === true ||
      metadata.missing_receipt === true ||
      textIncludes(task.blocker_reason, 'receipt')
    ) {
      addGroup(groups, reasons, 'receipt_failed', 'Receipt failure needs owner attention');
    }
    if (
      metadata.migration_warning === true ||
      textIncludes(metadata.migration_state, 'warning') ||
      textIncludes(task.blocker_reason, 'migration')
    ) {
      addGroup(groups, reasons, 'migration_warning', 'Migration warning is attached');
    }

    if (groups.length === 0) {
      continue;
    }

    const item: OwnerAccountabilityInboxItem = {
      task,
      groups,
      deepLink: `/tasks/${task.id}`,
      reasons,
    };
    items.push(item);
    for (const group of groups) {
      grouped[group].push(item);
    }
  }

  return {
    owner_principal_id: ownerPrincipalId,
    generated_at: now.toISOString(),
    total: items.length,
    groups: grouped,
    items,
  };
}
