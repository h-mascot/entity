/**
 * THE-872 / WP1-C-04 — Read-path adapters mapping existing agent/progress/
 * task/proof/status signals into THE-869 ActivityEvent spine envelopes.
 *
 * Additive + deterministic. Never mutates/imports Engineering data. Unknown
 * or malformed signals are skipped with explicit degraded warnings — never
 * coerced to healthy invented spine rows.
 */

import {
  classifyActivityEventToSpineType,
  type ActivityEventSpine,
  type ActivityEventSpineActor,
  type ActivityEventSpineActorType,
  type ActivityEventSpineType,
  type StoredActivityEventSpine,
  type TaskRecord,
} from '../../db/src';

/** Stable adapter provenance tags (read-path only). */
export type ActivitySpineAdapterSource =
  | 'activity_event'
  | 'task_snapshot'
  | 'swarm_job';

export interface AdaptedActivitySpineEvent extends ActivityEventSpine {
  /** Adapted rows are not stored spine rows — id stays null. */
  id: null;
  createdAt: string;
  adapted: true;
  source: ActivitySpineAdapterSource;
  sourceId: string;
}

export interface ActivitySpineAdapterWarning {
  code: string;
  message: string;
}

export interface ActivitySpineAdapterResult {
  events: AdaptedActivitySpineEvent[];
  degraded: boolean;
  warnings: ActivitySpineAdapterWarning[];
}

/** Minimal activity-event signal shape (legacy feed / ActivityEventEnvelope). */
export interface ActivityEventAdapterInput {
  id?: unknown;
  taskId?: unknown;
  task_id?: unknown;
  eventType?: unknown;
  activity_event_type?: unknown;
  type?: unknown;
  actorType?: unknown;
  actor_type?: unknown;
  actorPrincipalId?: unknown;
  actor_principal_id?: unknown;
  actor?: unknown;
  action?: unknown;
  description?: unknown;
  createdAt?: unknown;
  created_at?: unknown;
  payload?: unknown;
  payloadRef?: unknown;
  payload_ref?: unknown;
  file_path?: unknown;
  schemaStatus?: unknown;
  activity_event_schema_status?: unknown;
  degraded?: unknown;
  warnings?: unknown;
}

/** Minimal swarm/provider progress signal (SwarmJob-compatible). */
export interface SwarmJobAdapterInput {
  id?: unknown;
  task_id?: unknown;
  taskId?: unknown;
  title?: unknown;
  status?: unknown;
  provider?: unknown;
  feedback?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
  updated_at?: unknown;
  updatedAt?: unknown;
  completed_at?: unknown;
  completedAt?: unknown;
  run_handle?: unknown;
  runHandle?: unknown;
}

const ACTOR_TYPES = new Set<string>([
  'human',
  'agent',
  'system',
  'workflow',
  'unknown',
]);

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readPositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed) && parsed >= 1) {
      return parsed;
    }
  }
  return null;
}

function toPayloadRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function normalizeActorType(value: unknown): ActivityEventSpineActorType {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (ACTOR_TYPES.has(normalized)) {
      return normalized as ActivityEventSpineActorType;
    }
  }
  return 'unknown';
}

function readActor(
  record: Record<string, unknown>,
  fallbackPrincipal?: string | null,
): ActivityEventSpineActor {
  const actorRaw = record.actor;
  if (actorRaw && typeof actorRaw === 'object' && !Array.isArray(actorRaw)) {
    const actorRecord = actorRaw as Record<string, unknown>;
    const principalId =
      readNonEmptyString(actorRecord.principalId ?? actorRecord.principal_id) ??
      readNonEmptyString(fallbackPrincipal) ??
      undefined;
    return {
      type: normalizeActorType(actorRecord.type ?? actorRecord.actor_type),
      ...(principalId ? { principalId } : {}),
    };
  }

  const principalId =
    readNonEmptyString(
      record.actorPrincipalId ?? record.actor_principal_id ?? fallbackPrincipal,
    ) ?? undefined;
  return {
    type: normalizeActorType(record.actorType ?? record.actor_type),
    ...(principalId ? { principalId } : {}),
  };
}

function extractPayloadRef(record: Record<string, unknown>, payload: Record<string, unknown>): string | null {
  const direct =
    readNonEmptyString(
      record.payloadRef ?? record.payload_ref ?? record.file_path ?? record.ref,
    ) ?? null;
  if (direct) return direct;

  const objectRefs = payload.object_refs;
  if (Array.isArray(objectRefs)) {
    for (const ref of objectRefs) {
      if (!ref || typeof ref !== 'object' || Array.isArray(ref)) continue;
      const refRecord = ref as Record<string, unknown>;
      const objectType = readNonEmptyString(refRecord.object_type);
      const objectId = readNonEmptyString(refRecord.object_id);
      const linkRole = readNonEmptyString(refRecord.link_role);
      if (
        objectType &&
        objectId &&
        (linkRole === 'artifact' ||
          linkRole === 'receipt' ||
          linkRole === 'proof' ||
          objectType === 'artifact' ||
          objectType === 'receipt' ||
          objectType === 'file')
      ) {
        return `${objectType}:${objectId}`;
      }
    }
  }

  return (
    readNonEmptyString(payload.artifact_ref) ??
    readNonEmptyString(payload.receipt_id) ??
    readNonEmptyString(payload.payload_ref) ??
    null
  );
}

/**
 * Map one legacy/fine-grained activity event into a spine envelope.
 * Unmapped/malformed inputs return null with an optional warning (fail closed).
 */
export function adaptActivityEventToSpine(
  raw: unknown,
  expectedTaskId?: number,
):
  | { ok: true; event: AdaptedActivitySpineEvent }
  | { ok: false; reason: string; degraded: true; warning: ActivitySpineAdapterWarning } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      reason: 'payload_not_object',
      degraded: true,
      warning: {
        code: 'adapter_activity_event_malformed',
        message: 'Skipped activity event: payload was not an object',
      },
    };
  }

  const record = raw as Record<string, unknown>;
  const sourceEventType =
    record.eventType ?? record.activity_event_type ?? record.type;
  const spineType = classifyActivityEventToSpineType(sourceEventType);
  if (!spineType) {
    return {
      ok: false,
      reason: 'unmapped_or_unknown_event_type',
      degraded: true,
      warning: {
        code: 'adapter_activity_event_unmapped',
        message: `Skipped activity event: unmapped type ${String(sourceEventType ?? '<missing>')}`,
      },
    };
  }

  const taskId =
    readPositiveInteger(record.taskId ?? record.task_id) ??
    (typeof expectedTaskId === 'number' && expectedTaskId >= 1 ? expectedTaskId : null);
  if (taskId === null) {
    return {
      ok: false,
      reason: 'missing_or_invalid_task_id',
      degraded: true,
      warning: {
        code: 'adapter_activity_event_missing_task',
        message: 'Skipped activity event: missing or invalid task id',
      },
    };
  }

  if (
    typeof expectedTaskId === 'number' &&
    expectedTaskId >= 1 &&
    taskId !== expectedTaskId
  ) {
    return {
      ok: false,
      reason: 'task_id_mismatch',
      degraded: true,
      warning: {
        code: 'adapter_activity_event_task_mismatch',
        message: `Skipped activity event: task ${taskId} does not match requested task ${expectedTaskId}`,
      },
    };
  }

  const sourceNumericId = readPositiveInteger(record.id);
  const sourceId =
    sourceNumericId !== null
      ? `activity_event:${sourceNumericId}`
      : `activity_event:anon:${spineType}:${readNonEmptyString(record.createdAt ?? record.created_at) ?? 'unknown'}`;

  const payload = toPayloadRecord(record.payload);
  const action = readNonEmptyString(record.action);
  const description = readNonEmptyString(record.description);
  const schemaStatus = readNonEmptyString(
    record.schemaStatus ?? record.activity_event_schema_status,
  );
  const payloadRef = extractPayloadRef(record, payload);

  const adaptedPayload: Record<string, unknown> = {
    ...payload,
    adapterSource: 'activity_event',
    sourceEventType:
      typeof sourceEventType === 'string' ? sourceEventType.trim().toLowerCase() : sourceEventType,
    ...(action ? { action } : {}),
    ...(description ? { summary: description, description } : {}),
    ...(schemaStatus ? { schemaStatus } : {}),
  };

  const timestamp =
    readNonEmptyString(record.createdAt ?? record.created_at ?? record.timestamp) ?? '';

  // Sequence is assigned later by merge/order helpers (placeholder 0).
  const event: AdaptedActivitySpineEvent = {
    id: null,
    taskId,
    eventType: spineType,
    actor: readActor(record),
    timestamp,
    payloadRef,
    payload: adaptedPayload,
    sequence: 0,
    createdAt: timestamp,
    adapted: true,
    source: 'activity_event',
    sourceId,
  };

  return { ok: true, event };
}

function taskActor(task: TaskRecord): ActivityEventSpineActor {
  const principalId =
    readNonEmptyString(task.executor_principal_id) ??
    readNonEmptyString(task.owner_principal_id) ??
    readNonEmptyString(task.assignee) ??
    undefined;
  const type: ActivityEventSpineActorType = task.executor_principal_id
    ? 'agent'
    : task.owner_principal_id || task.assignee
      ? 'human'
      : 'system';
  return principalId ? { type, principalId } : { type };
}

function pushSnapshotEvent(
  events: AdaptedActivitySpineEvent[],
  input: {
    task: TaskRecord;
    eventType: ActivityEventSpineType;
    sourceKey: string;
    timestamp: string;
    payloadRef?: string | null;
    payload: Record<string, unknown>;
  },
): void {
  events.push({
    id: null,
    taskId: input.task.id,
    eventType: input.eventType,
    actor: taskActor(input.task),
    timestamp: input.timestamp,
    payloadRef: input.payloadRef ?? null,
    payload: {
      adapterSource: 'task_snapshot',
      ...input.payload,
    },
    sequence: 0,
    createdAt: input.timestamp,
    adapted: true,
    source: 'task_snapshot',
    sourceId: `task_snapshot:${input.sourceKey}:${input.task.id}`,
  });
}

/**
 * Project present task fields into spine events. Absent fields are skipped —
 * never invent status/progress/proof/blocker rows from empty data.
 */
export function adaptTaskSnapshotToSpine(task: TaskRecord | null | undefined): ActivitySpineAdapterResult {
  const warnings: ActivitySpineAdapterWarning[] = [];
  if (!task || !Number.isInteger(task.id) || task.id < 1) {
    return {
      events: [],
      degraded: true,
      warnings: [
        {
          code: 'adapter_task_snapshot_unavailable',
          message: 'Task snapshot unavailable — no snapshot spine events adapted',
        },
      ],
    };
  }

  const events: AdaptedActivitySpineEvent[] = [];
  const createdAt = readNonEmptyString(task.created_at) ?? '';
  const updatedAt = readNonEmptyString(task.updated_at) ?? createdAt;

  const column = readNonEmptyString(task.column);
  if (column) {
    pushSnapshotEvent(events, {
      task,
      eventType: 'status',
      sourceKey: 'status',
      timestamp: updatedAt || createdAt,
      payload: {
        summary: `Task status: ${column}`,
        status: column,
        previous_state: null,
        new_state: column,
      },
    });
  }

  const progressStatus = readNonEmptyString(task.progress_status);
  if (progressStatus) {
    pushSnapshotEvent(events, {
      task,
      eventType: 'progress',
      sourceKey: 'progress',
      timestamp: updatedAt || createdAt,
      payload: {
        summary: `Progress: ${progressStatus}`,
        progress_status: progressStatus,
      },
    });
  }

  const output = readNonEmptyString(task.output);
  if (output) {
    // Do not invent a structured proof artifact — surface the existing output text ref only.
    const payloadRef =
      output.length <= 240 && !output.includes('\n') ? output : `task:${task.id}:output`;
    pushSnapshotEvent(events, {
      task,
      eventType: 'proof',
      sourceKey: 'proof',
      timestamp: updatedAt || createdAt,
      payloadRef,
      payload: {
        summary: 'Task output present',
        has_output: true,
        output_length: output.length,
      },
    });
  }

  if (task.blocked === true) {
    const reason = readNonEmptyString(task.blocker_reason);
    pushSnapshotEvent(events, {
      task,
      eventType: 'blocker',
      sourceKey: 'blocker',
      timestamp: updatedAt || createdAt,
      payload: {
        summary: reason ? `Blocked: ${reason}` : 'Task is blocked',
        blocked: true,
        ...(reason ? { blocker_reason: reason } : {}),
      },
    });
  } else if (readNonEmptyString(task.blocker_reason)) {
    // Reason without blocked flag is degraded/partial — surface as log, not invented blocker.
    warnings.push({
      code: 'adapter_blocker_reason_without_blocked',
      message:
        'blocker_reason present while blocked=false — emitted as log, not coerced to blocker',
    });
    pushSnapshotEvent(events, {
      task,
      eventType: 'log',
      sourceKey: 'blocker_reason_log',
      timestamp: updatedAt || createdAt,
      payload: {
        summary: `Blocker reason noted: ${readNonEmptyString(task.blocker_reason)}`,
        blocker_reason: readNonEmptyString(task.blocker_reason),
        blocked: false,
      },
    });
  }

  return {
    events,
    degraded: warnings.length > 0,
    warnings,
  };
}

function swarmStatusToSpine(status: string): ActivityEventSpineType | null {
  switch (status) {
    case 'draft':
    case 'queued':
    case 'dispatched':
    case 'running':
      return 'progress';
    case 'proof':
      return 'proof';
    case 'review':
    case 'done':
      return 'status';
    case 'failed':
    case 'cancelled':
      return 'blocker';
    default:
      return null;
  }
}

/**
 * Map swarm/provider job progress into spine events. Unknown statuses skipped.
 */
export function adaptSwarmJobToSpine(
  raw: unknown,
  expectedTaskId?: number,
):
  | { ok: true; event: AdaptedActivitySpineEvent }
  | { ok: false; reason: string; degraded: true; warning: ActivitySpineAdapterWarning } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      reason: 'payload_not_object',
      degraded: true,
      warning: {
        code: 'adapter_swarm_job_malformed',
        message: 'Skipped swarm job: payload was not an object',
      },
    };
  }

  const record = raw as Record<string, unknown>;
  const jobId = readNonEmptyString(record.id);
  if (!jobId) {
    return {
      ok: false,
      reason: 'missing_job_id',
      degraded: true,
      warning: {
        code: 'adapter_swarm_job_missing_id',
        message: 'Skipped swarm job: missing id',
      },
    };
  }

  const taskId =
    readPositiveInteger(record.task_id ?? record.taskId) ??
    (typeof expectedTaskId === 'number' && expectedTaskId >= 1 ? expectedTaskId : null);
  if (taskId === null) {
    return {
      ok: false,
      reason: 'missing_or_invalid_task_id',
      degraded: true,
      warning: {
        code: 'adapter_swarm_job_missing_task',
        message: `Skipped swarm job ${jobId}: missing task id`,
      },
    };
  }

  if (
    typeof expectedTaskId === 'number' &&
    expectedTaskId >= 1 &&
    taskId !== expectedTaskId
  ) {
    return {
      ok: false,
      reason: 'task_id_mismatch',
      degraded: true,
      warning: {
        code: 'adapter_swarm_job_task_mismatch',
        message: `Skipped swarm job ${jobId}: task mismatch`,
      },
    };
  }

  const status = readNonEmptyString(record.status)?.toLowerCase();
  if (!status) {
    return {
      ok: false,
      reason: 'missing_status',
      degraded: true,
      warning: {
        code: 'adapter_swarm_job_missing_status',
        message: `Skipped swarm job ${jobId}: missing status`,
      },
    };
  }

  const spineType = swarmStatusToSpine(status);
  if (!spineType) {
    return {
      ok: false,
      reason: 'unknown_swarm_status',
      degraded: true,
      warning: {
        code: 'adapter_swarm_job_unknown_status',
        message: `Skipped swarm job ${jobId}: unknown status ${status}`,
      },
    };
  }

  const title = readNonEmptyString(record.title);
  const feedback = readNonEmptyString(record.feedback);
  const provider = readNonEmptyString(record.provider);
  const runHandle = readNonEmptyString(record.run_handle ?? record.runHandle);
  const timestamp =
    readNonEmptyString(
      record.updated_at ??
        record.updatedAt ??
        record.completed_at ??
        record.completedAt ??
        record.created_at ??
        record.createdAt,
    ) ?? '';

  const event: AdaptedActivitySpineEvent = {
    id: null,
    taskId,
    eventType: spineType,
    actor: {
      type: 'agent',
      ...(provider ? { principalId: provider } : {}),
    },
    timestamp,
    payloadRef: runHandle ? `swarm_run:${runHandle}` : `swarm_job:${jobId}`,
    payload: {
      adapterSource: 'swarm_job',
      summary: feedback ?? (title ? `Swarm ${status}: ${title}` : `Swarm job ${status}`),
      swarm_job_id: jobId,
      swarm_status: status,
      ...(title ? { title } : {}),
      ...(provider ? { provider } : {}),
      ...(feedback ? { feedback } : {}),
    },
    sequence: 0,
    createdAt: timestamp,
    adapted: true,
    source: 'swarm_job',
    sourceId: `swarm_job:${jobId}`,
  };

  return { ok: true, event };
}

export interface AdaptTaskSignalsToSpineInput {
  taskId: number;
  task?: TaskRecord | null;
  activityEvents?: readonly unknown[] | null;
  swarmJobs?: readonly unknown[] | null;
}

/**
 * Adapt all available read-path signals for a task into spine envelopes.
 * Deterministic: same inputs → same sourceIds + stable sort order.
 */
export function adaptTaskSignalsToSpine(
  input: AdaptTaskSignalsToSpineInput,
): ActivitySpineAdapterResult {
  const warnings: ActivitySpineAdapterWarning[] = [];
  const events: AdaptedActivitySpineEvent[] = [];

  if (!Number.isInteger(input.taskId) || input.taskId < 1) {
    return {
      events: [],
      degraded: true,
      warnings: [
        {
          code: 'adapter_invalid_task_id',
          message: 'Cannot adapt signals: task id must be a positive integer',
        },
      ],
    };
  }

  if (input.task) {
    const snapshot = adaptTaskSnapshotToSpine(input.task);
    events.push(...snapshot.events);
    warnings.push(...snapshot.warnings);
  } else if (input.task === null) {
    warnings.push({
      code: 'adapter_task_snapshot_absent',
      message: 'Task snapshot absent — snapshot signals not adapted',
    });
  }

  if (Array.isArray(input.activityEvents)) {
    for (const [index, entry] of input.activityEvents.entries()) {
      const adapted = adaptActivityEventToSpine(entry, input.taskId);
      if (!adapted.ok) {
        warnings.push(adapted.warning);
        continue;
      }
      events.push(adapted.event);
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const schemaStatus = readNonEmptyString(
          (entry as Record<string, unknown>).schemaStatus ??
            (entry as Record<string, unknown>).activity_event_schema_status,
        );
        if (schemaStatus === 'legacy_unknown' || (entry as { degraded?: unknown }).degraded === true) {
          warnings.push({
            code: 'adapter_activity_event_degraded_source',
            message: `Adapted activity event at index ${index} from degraded/legacy source`,
          });
        }
      }
    }
  } else if (input.activityEvents === null) {
    warnings.push({
      code: 'adapter_activity_events_unavailable',
      message: 'Activity event feed unavailable — activity signals not adapted',
    });
  }

  if (Array.isArray(input.swarmJobs)) {
    for (const entry of input.swarmJobs) {
      const adapted = adaptSwarmJobToSpine(entry, input.taskId);
      if (!adapted.ok) {
        warnings.push(adapted.warning);
        continue;
      }
      events.push(adapted.event);
    }
  } else if (input.swarmJobs === null) {
    warnings.push({
      code: 'adapter_swarm_jobs_unavailable',
      message: 'Swarm job feed unavailable — provider progress not adapted',
    });
  }

  // Idempotent dedupe by sourceId (first occurrence wins).
  const seen = new Set<string>();
  const deduped: AdaptedActivitySpineEvent[] = [];
  for (const event of events) {
    if (seen.has(event.sourceId)) continue;
    seen.add(event.sourceId);
    deduped.push(event);
  }

  deduped.sort((left, right) => compareAdaptedOrder(left, right));

  // Assign stable display sequences after sort (0..n-1).
  const sequenced = deduped.map((event, index) => ({
    ...event,
    sequence: index,
  }));

  return {
    events: sequenced,
    degraded: warnings.length > 0,
    warnings,
  };
}

function compareAdaptedOrder(
  left: Pick<ActivityEventSpine, 'timestamp' | 'eventType'> & { sourceId?: string; id?: number | null },
  right: Pick<ActivityEventSpine, 'timestamp' | 'eventType'> & { sourceId?: string; id?: number | null },
): number {
  // Ignore placeholder/stored sequence during merge — timestamp is source-of-truth for read path.
  if (left.timestamp !== right.timestamp) {
    if (!left.timestamp) return 1;
    if (!right.timestamp) return -1;
    return left.timestamp < right.timestamp ? -1 : 1;
  }
  if (left.eventType !== right.eventType) {
    return left.eventType < right.eventType ? -1 : 1;
  }
  const leftKey =
    typeof left.sourceId === 'string'
      ? left.sourceId
      : typeof left.id === 'number'
        ? `spine:${left.id}`
        : '';
  const rightKey =
    typeof right.sourceId === 'string'
      ? right.sourceId
      : typeof right.id === 'number'
        ? `spine:${right.id}`
        : '';
  if (leftKey === rightKey) return 0;
  return leftKey < rightKey ? -1 : 1;
}

export type MergedActivitySpineEvent = StoredActivityEventSpine | AdaptedActivitySpineEvent;

export interface MergeActivitySpineEventsResult {
  taskId: number;
  events: MergedActivitySpineEvent[];
  empty: boolean;
  degraded: boolean;
  warnings: ActivitySpineAdapterWarning[];
  adaptedCount: number;
  storedCount: number;
}

/**
 * Merge stored spine rows with adapted read-path events.
 * Stored rows win on sourceId collision (`spine:${id}`). Sequences are
 * reassigned 0..n-1 in stable timestamp/source order for panel consumption.
 */
export function mergeStoredAndAdaptedSpineEvents(input: {
  taskId: number;
  stored: readonly StoredActivityEventSpine[];
  adapted: ActivitySpineAdapterResult;
}): MergeActivitySpineEventsResult {
  const warnings = [...input.adapted.warnings];
  const merged: MergedActivitySpineEvent[] = [];
  const seen = new Set<string>();

  for (const event of input.stored) {
    const sourceId = `spine:${event.id}`;
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);
    merged.push(event);
  }

  for (const event of input.adapted.events) {
    if (seen.has(event.sourceId)) continue;
    // Also skip adapted activity_event rows that duplicate a stored spine row
    // with the same event type + timestamp + payloadRef (deterministic collapse).
    const duplicateStored = input.stored.some(
      (stored) =>
        stored.eventType === event.eventType &&
        stored.timestamp === event.timestamp &&
        stored.payloadRef === event.payloadRef,
    );
    if (duplicateStored) {
      warnings.push({
        code: 'adapter_duplicate_of_stored',
        message: `Skipped adapted ${event.sourceId}: duplicate of stored spine event`,
      });
      continue;
    }
    seen.add(event.sourceId);
    merged.push(event);
  }

  merged.sort((left, right) => {
    const leftKey =
      'sourceId' in left && typeof left.sourceId === 'string'
        ? left.sourceId
        : `spine:${left.id}`;
    const rightKey =
      'sourceId' in right && typeof right.sourceId === 'string'
        ? right.sourceId
        : `spine:${right.id}`;
    return compareAdaptedOrder(
      { timestamp: left.timestamp, eventType: left.eventType, sourceId: leftKey, id: left.id },
      { timestamp: right.timestamp, eventType: right.eventType, sourceId: rightKey, id: right.id },
    );
  });

  const sequenced = merged.map((event, index) => ({
    ...event,
    sequence: index,
  }));

  return {
    taskId: input.taskId,
    events: sequenced,
    empty: sequenced.length === 0,
    degraded: input.adapted.degraded || warnings.length > 0,
    warnings,
    adaptedCount: sequenced.filter((event) => 'adapted' in event && event.adapted === true).length,
    storedCount: sequenced.filter((event) => !('adapted' in event && event.adapted === true)).length,
  };
}
