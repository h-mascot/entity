/**
 * THE-869 / WP1-C-01 — Minimal Workplane ActivityEvent spine types.
 *
 * Defines the shared plan/progress/log/proof/status/blocker vocabulary for
 * Workplane activity/progress (grill Q38/Q46). Additive domain/schema only —
 * storage/API append+query lands in THE-870 / WP1-C-02.
 *
 * Do not invent runner-specific event models; OpenClaw/agent signals map into
 * this spine over time via classifyActivityEventToSpineType.
 */

/** Minimal Workplane ActivityEvent spine (WP1-C-01). Order is display-stable. */
export const ACTIVITY_EVENT_SPINE_TYPES = [
  'plan',
  'progress',
  'log',
  'proof',
  'status',
  'blocker',
] as const;

export type ActivityEventSpineType = (typeof ACTIVITY_EVENT_SPINE_TYPES)[number];

export type ActivityEventSpineActorType =
  | 'human'
  | 'agent'
  | 'system'
  | 'workflow'
  | 'unknown';

/** Actor identity for a spine event. Missing principal stays undefined — never invented. */
export interface ActivityEventSpineActor {
  type: ActivityEventSpineActorType;
  principalId?: string;
}

/**
 * Canonical spine event shape for Workplane activity/progress.
 * Fields mirror the Slice 1 data-model note: task_id, event_type, actor,
 * timestamp, payload/ref, sequence/order.
 */
export interface ActivityEventSpine {
  taskId: number;
  eventType: ActivityEventSpineType;
  actor: ActivityEventSpineActor;
  /** ISO-8601 timestamp; empty/invalid inputs normalize to empty string (visible, not invented). */
  timestamp: string;
  /** Opaque payload or artifact reference; null when absent. */
  payloadRef: string | null;
  /** Structured payload bag; always an object (may be empty). */
  payload: Record<string, unknown>;
  /** Stable ordering key within a task stream (ascending). */
  sequence: number;
}

export type ActivityEventSpineNormalizeResult =
  | { ok: true; event: ActivityEventSpine }
  | { ok: false; reason: string; degraded: true };

const SPINE_TYPE_SET = new Set<string>(ACTIVITY_EVENT_SPINE_TYPES);

const ACTOR_TYPES = new Set<string>([
  'human',
  'agent',
  'system',
  'workflow',
  'unknown',
]);

/**
 * Map existing fine-grained ActivityEventType strings onto the Workplane spine.
 * Unknown / unmapped types return null (explicit — Workplane must not coerce).
 * Spine types map to themselves.
 */
const FINE_GRAINED_TO_SPINE: Readonly<Record<string, ActivityEventSpineType>> = {
  plan: 'plan',
  progress: 'progress',
  log: 'log',
  proof: 'proof',
  status: 'status',
  blocker: 'blocker',

  task_updated: 'progress',
  taskmaster_claimed: 'progress',
  nudge_sent: 'progress',
  owner_escalated: 'progress',
  auto_reassigned: 'progress',
  assignment_changed: 'progress',

  notification_routed: 'log',
  connector_state_changed: 'log',
  migration_warning: 'log',
  legacy_event_observed: 'log',

  artifact_linked: 'proof',
  receipt_created: 'proof',
  receipt_failed: 'proof',

  task_created: 'status',
  status_changed: 'status',
  submission_created: 'status',
  review_requested: 'status',
  review_decision: 'status',
  human_gate_requested: 'status',
  human_gate_decision: 'status',
  completion_accepted: 'status',
  task_cancelled: 'status',
  task_paused: 'status',

  task_blocked: 'blocker',
  completion_blocked: 'blocker',
  permission_denied: 'blocker',
  integration_degraded: 'blocker',
};

export function isActivityEventSpineType(value: unknown): value is ActivityEventSpineType {
  return typeof value === 'string' && SPINE_TYPE_SET.has(value.trim().toLowerCase());
}

/** Normalize a raw type string to a spine type, or null when unknown/empty. */
export function normalizeActivityEventSpineType(value: unknown): ActivityEventSpineType | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return isActivityEventSpineType(normalized) ? normalized : null;
}

/**
 * Classify a fine-grained or spine event type into the Workplane spine.
 * Returns null for unknown/unmapped values (fail closed for UI projection).
 */
export function classifyActivityEventToSpineType(value: unknown): ActivityEventSpineType | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return FINE_GRAINED_TO_SPINE[normalized] ?? null;
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

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toPayloadRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function readTaskId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function readSequence(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return null;
}

/**
 * Normalize a raw candidate into an ActivityEventSpine value.
 * Missing/invalid required fields return an explicit degraded result — never
 * silently invent taskId, eventType, or sequence.
 */
export function normalizeActivityEventSpine(raw: unknown): ActivityEventSpineNormalizeResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'payload_not_object', degraded: true };
  }

  const record = raw as Record<string, unknown>;
  const eventType = normalizeActivityEventSpineType(
    record.eventType ?? record.event_type ?? record.type,
  );
  if (!eventType) {
    return { ok: false, reason: 'unknown_or_missing_event_type', degraded: true };
  }

  const taskId = readTaskId(record.taskId ?? record.task_id);
  if (taskId === null) {
    return { ok: false, reason: 'missing_or_invalid_task_id', degraded: true };
  }

  const sequence = readSequence(record.sequence ?? record.order ?? record.seq);
  if (sequence === null) {
    return { ok: false, reason: 'missing_or_invalid_sequence', degraded: true };
  }

  const actorRaw = record.actor;
  let actor: ActivityEventSpineActor;
  if (actorRaw && typeof actorRaw === 'object' && !Array.isArray(actorRaw)) {
    const actorRecord = actorRaw as Record<string, unknown>;
    const principalId =
      readNonEmptyString(actorRecord.principalId ?? actorRecord.principal_id) ?? undefined;
    actor = {
      type: normalizeActorType(actorRecord.type ?? actorRecord.actor_type),
      ...(principalId ? { principalId } : {}),
    };
  } else {
    actor = {
      type: normalizeActorType(record.actorType ?? record.actor_type),
      ...(readNonEmptyString(record.actorPrincipalId ?? record.actor_principal_id)
        ? {
            principalId: readNonEmptyString(
              record.actorPrincipalId ?? record.actor_principal_id,
            ) as string,
          }
        : {}),
    };
  }

  const timestamp =
    readNonEmptyString(record.timestamp ?? record.createdAt ?? record.created_at) ?? '';

  const payloadRef =
    readNonEmptyString(
      record.payloadRef ?? record.payload_ref ?? record.ref ?? record.artifact_ref,
    ) ?? null;

  const payload = toPayloadRecord(record.payload ?? record.data);

  return {
    ok: true,
    event: {
      taskId,
      eventType,
      actor,
      timestamp,
      payloadRef,
      payload,
      sequence,
    },
  };
}

/** Sort spine events by sequence ascending, then timestamp, then eventType. */
export function compareActivityEventSpineOrder(
  left: Pick<ActivityEventSpine, 'sequence' | 'timestamp' | 'eventType'>,
  right: Pick<ActivityEventSpine, 'sequence' | 'timestamp' | 'eventType'>,
): number {
  if (left.sequence !== right.sequence) {
    return left.sequence - right.sequence;
  }
  if (left.timestamp !== right.timestamp) {
    return left.timestamp < right.timestamp ? -1 : left.timestamp > right.timestamp ? 1 : 0;
  }
  if (left.eventType === right.eventType) {
    return 0;
  }
  return left.eventType < right.eventType ? -1 : 1;
}
