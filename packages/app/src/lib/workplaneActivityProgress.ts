/**
 * THE-871 / WP1-C-03 — Workplane activity/progress panel load helpers.
 *
 * Consumes THE-870 `GET /tasks/:id/activity-spine-events` (THE-869 spine:
 * plan|progress|log|proof|status|blocker). Fail-closed: unknown types skipped
 * with degraded warnings; empty streams are explicit; never claims review-ready.
 */

import { HttpRequestError, buildApiCandidates, requestJsonWithFallback, toErrorMessage } from './http.ts';

/** Mirror of THE-869 ACTIVITY_EVENT_SPINE_TYPES — display-stable order. */
export const ACTIVITY_PROGRESS_SPINE_TYPES = [
  'plan',
  'progress',
  'log',
  'proof',
  'status',
  'blocker',
] as const;

export type ActivityProgressSpineType = (typeof ACTIVITY_PROGRESS_SPINE_TYPES)[number];

export type ActivityProgressActorType =
  | 'human'
  | 'agent'
  | 'system'
  | 'workflow'
  | 'unknown';

export interface ActivityProgressActor {
  type: ActivityProgressActorType;
  principalId?: string;
}

export interface ActivityProgressEvent {
  id: number | null;
  taskId: number;
  eventType: ActivityProgressSpineType;
  actor: ActivityProgressActor;
  timestamp: string;
  payloadRef: string | null;
  payload: Record<string, unknown>;
  sequence: number;
  /** True when a proof-typed event lacks payload/ref (not review-ready signal). */
  proofIncomplete: boolean;
}

export interface ActivityProgressWarning {
  code: string;
  message: string;
}

export interface ActivityProgressBundle {
  taskId: number | null;
  events: ActivityProgressEvent[];
  /** Explicit empty stream (no events for task). */
  empty: boolean;
  /** True when API or projection reported degraded/unknown rows. */
  degraded: boolean;
  warnings: ActivityProgressWarning[];
  /** Always false — this panel never claims review readiness. */
  reviewReady: false;
}

export type WorkplaneActivityProgressLoadStatus = 'empty' | 'loading' | 'error' | 'ready';

export interface WorkplaneActivityProgressLoadState {
  status: WorkplaneActivityProgressLoadStatus;
  taskId: number | null;
  bundle: ActivityProgressBundle | null;
  errorMessage: string | null;
}

export const ACTIVITY_PROGRESS_TYPE_LABELS: Record<ActivityProgressSpineType, string> = {
  plan: 'Plan',
  progress: 'Progress',
  log: 'Log',
  proof: 'Proof',
  status: 'Status',
  blocker: 'Blocker',
};

const SPINE_TYPE_SET = new Set<string>(ACTIVITY_PROGRESS_SPINE_TYPES);
const ACTOR_TYPES = new Set<string>(['human', 'agent', 'system', 'workflow', 'unknown']);

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readPositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    return Number.isInteger(n) && n >= 1 ? n : null;
  }
  return null;
}

function readNonNegativeInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.trim());
    return Number.isInteger(n) && n >= 0 ? n : null;
  }
  return null;
}

function normalizeSpineType(value: unknown): ActivityProgressSpineType | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return SPINE_TYPE_SET.has(normalized) ? (normalized as ActivityProgressSpineType) : null;
}

function normalizeActor(raw: unknown, record: Record<string, unknown>): ActivityProgressActor {
  const actorRaw = toRecord(raw);
  if (actorRaw) {
    const typeRaw = readNonEmptyString(actorRaw.type)?.toLowerCase();
    const type =
      typeRaw && ACTOR_TYPES.has(typeRaw)
        ? (typeRaw as ActivityProgressActorType)
        : 'unknown';
    const principalId =
      readNonEmptyString(actorRaw.principalId ?? actorRaw.principal_id) ?? undefined;
    return principalId ? { type, principalId } : { type };
  }

  const typeRaw = readNonEmptyString(record.actorType ?? record.actor_type)?.toLowerCase();
  const type =
    typeRaw && ACTOR_TYPES.has(typeRaw) ? (typeRaw as ActivityProgressActorType) : 'unknown';
  const principalId =
    readNonEmptyString(record.actorPrincipalId ?? record.actor_principal_id) ?? undefined;
  return principalId ? { type, principalId } : { type };
}

function payloadSummary(payload: Record<string, unknown>): string | null {
  return (
    readNonEmptyString(payload.summary) ??
    readNonEmptyString(payload.message) ??
    readNonEmptyString(payload.text) ??
    readNonEmptyString(payload.title) ??
    readNonEmptyString(payload.status) ??
    null
  );
}

/** Project a single API/storage row; unknown spine types return null (fail closed). */
export function normalizeActivityProgressEvent(
  raw: unknown,
  fallbackTaskId?: number | null,
): { ok: true; event: ActivityProgressEvent } | { ok: false; reason: string; degraded: true } {
  const record = toRecord(raw);
  if (!record) {
    return { ok: false, reason: 'payload_not_object', degraded: true };
  }

  const eventType = normalizeSpineType(
    record.eventType ?? record.event_type ?? record.type,
  );
  if (!eventType) {
    return { ok: false, reason: 'unknown_or_missing_event_type', degraded: true };
  }

  const taskId =
    readPositiveInteger(record.taskId ?? record.task_id) ??
    (typeof fallbackTaskId === 'number' && fallbackTaskId >= 1 ? fallbackTaskId : null);
  if (taskId === null) {
    return { ok: false, reason: 'missing_or_invalid_task_id', degraded: true };
  }

  const sequence = readNonNegativeInteger(record.sequence ?? record.order ?? record.seq);
  if (sequence === null) {
    return { ok: false, reason: 'missing_or_invalid_sequence', degraded: true };
  }

  const payload = toRecord(record.payload ?? record.data) ?? {};
  const payloadRef =
    readNonEmptyString(
      record.payloadRef ?? record.payload_ref ?? record.ref ?? record.artifact_ref,
    ) ?? null;
  const proofIncomplete =
    eventType === 'proof' && !payloadRef && Object.keys(payload).length === 0;

  const id = readPositiveInteger(record.id);

  return {
    ok: true,
    event: {
      id,
      taskId,
      eventType,
      actor: normalizeActor(record.actor, record),
      timestamp:
        readNonEmptyString(record.timestamp ?? record.createdAt ?? record.created_at) ?? '',
      payloadRef,
      payload,
      sequence,
      proofIncomplete,
    },
  };
}

/** Normalize THE-870 list response into a panel bundle. */
export function normalizeActivityProgressBundle(raw: unknown): ActivityProgressBundle {
  const record = toRecord(raw);
  const taskId = record ? readPositiveInteger(record.taskId ?? record.task_id) : null;
  const eventsRaw = record && Array.isArray(record.events) ? record.events : [];
  const warnings: ActivityProgressWarning[] = [];

  if (record && Array.isArray(record.warnings)) {
    for (const warning of record.warnings) {
      const w = toRecord(warning);
      if (!w) continue;
      const code = readNonEmptyString(w.code) ?? 'warning';
      const message = readNonEmptyString(w.message) ?? code;
      warnings.push({ code, message });
    }
  }

  const events: ActivityProgressEvent[] = [];
  for (const [index, entry] of eventsRaw.entries()) {
    const normalized = normalizeActivityProgressEvent(entry, taskId);
    if (!normalized.ok) {
      warnings.push({
        code: normalized.reason,
        message: `Skipped activity event at index ${index}: ${normalized.reason}`,
      });
      continue;
    }
    events.push(normalized.event);
  }

  events.sort((left, right) => {
    if (left.sequence !== right.sequence) return left.sequence - right.sequence;
    if (left.timestamp !== right.timestamp) {
      return left.timestamp < right.timestamp ? -1 : left.timestamp > right.timestamp ? 1 : 0;
    }
    return left.eventType < right.eventType ? -1 : left.eventType > right.eventType ? 1 : 0;
  });

  const apiEmpty = record ? record.empty === true : true;
  const apiDegraded = Boolean(record?.degraded) || warnings.length > 0;
  const empty = events.length === 0;
  const hasIncompleteProof = events.some((event) => event.proofIncomplete);

  if (hasIncompleteProof) {
    warnings.push({
      code: 'proof_event_incomplete',
      message:
        'One or more proof events lack payload/ref — not treated as review-ready evidence.',
    });
  }

  return {
    taskId,
    events,
    empty: empty || apiEmpty,
    degraded: apiDegraded || hasIncompleteProof,
    warnings,
    reviewReady: false,
  };
}

export function countActivityProgressTypes(
  bundle: ActivityProgressBundle | null | undefined,
): Record<ActivityProgressSpineType, number> {
  const counts: Record<ActivityProgressSpineType, number> = {
    plan: 0,
    progress: 0,
    log: 0,
    proof: 0,
    status: 0,
    blocker: 0,
  };
  if (!bundle) return counts;
  for (const event of bundle.events) {
    counts[event.eventType] += 1;
  }
  return counts;
}

/** Human-readable line for an event row (never invents content). */
export function formatActivityProgressEventSummary(event: ActivityProgressEvent): string {
  // THE-897 / EEPC-B-02 — prefer nested execution-engine event_body.summary when present.
  const data = toRecord(event.payload.data);
  const eventBody = data ? toRecord(data.event_body) ?? toRecord(data.eventBody) : null;
  const fromJobBody = eventBody ? payloadSummary(eventBody) : null;
  if (fromJobBody) return fromJobBody;

  const fromPayload = payloadSummary(event.payload);
  if (fromPayload) return fromPayload;
  if (event.payloadRef) return event.payloadRef;
  if (event.proofIncomplete) return 'Proof event recorded without payload or ref';
  return `${ACTIVITY_PROGRESS_TYPE_LABELS[event.eventType]} event`;
}

/** Explicit empty/loading/error/ready load envelope for the activity/progress panel. */
export function createWorkplaneActivityProgressLoadState(
  input: {
    taskId?: number | null;
    status?: WorkplaneActivityProgressLoadStatus;
    bundle?: ActivityProgressBundle | null;
    errorMessage?: string | null;
  } = {},
): WorkplaneActivityProgressLoadState {
  const taskId =
    typeof input.taskId === 'number' && Number.isInteger(input.taskId) && input.taskId >= 1
      ? input.taskId
      : null;

  if (input.status === 'loading') {
    return {
      status: 'loading',
      taskId,
      bundle: null,
      errorMessage: null,
    };
  }

  if (input.status === 'error') {
    return {
      status: 'error',
      taskId,
      bundle: null,
      errorMessage:
        readNonEmptyString(input.errorMessage) ?? 'Unable to load activity/progress events.',
    };
  }

  if (input.status === 'ready' && input.bundle) {
    return {
      status: 'ready',
      taskId: input.bundle.taskId ?? taskId,
      bundle: {
        ...input.bundle,
        reviewReady: false,
      },
      errorMessage: null,
    };
  }

  return {
    status: 'empty',
    taskId,
    bundle: null,
    errorMessage: null,
  };
}

/**
 * Fetch task-scoped ActivityEvent spine list from THE-870 API.
 * Returns null for missing task (404) — caller maps to empty.
 * Throws for transport / server failures — caller maps to error.
 * Empty event stream on a valid task is still a ready bundle (bundle.empty === true).
 */
export async function fetchWorkplaneActivityProgress(
  taskId: number,
  apiBase = '',
): Promise<ActivityProgressBundle | null> {
  if (!Number.isInteger(taskId) || taskId < 1) {
    return null;
  }

  try {
    const payload = await requestJsonWithFallback({
      urls: buildApiCandidates(`/tasks/${taskId}/activity-spine-events`, apiBase),
      init: { method: 'GET' },
      continueOnStatuses: [],
      fallbackError: 'Unable to load activity/progress events.',
    });
    const bundle = normalizeActivityProgressBundle(payload);
    if (bundle.taskId === null) {
      // Permission-denied / fail-closed payloads may omit taskId — still surface degraded ready.
      const record = toRecord(payload);
      if (record?.permissionState === 'hidden' || record?.degraded === true) {
        return {
          ...bundle,
          taskId,
          degraded: true,
          reviewReady: false,
          warnings: [
            ...bundle.warnings,
            {
              code: 'activity_unavailable',
              message: 'Activity events are unavailable or restricted for this task.',
            },
          ],
        };
      }
      return null;
    }
    return bundle;
  } catch (error) {
    if (error instanceof HttpRequestError && error.status === 404) {
      return null;
    }
    if (error instanceof HttpRequestError && (error.status === 403 || error.status === 401)) {
      return {
        taskId,
        events: [],
        empty: true,
        degraded: true,
        warnings: [
          {
            code: 'permission_denied',
            message: 'Activity events are restricted for this org scope.',
          },
        ],
        reviewReady: false,
      };
    }
    throw error;
  }
}

export function workplaneActivityProgressErrorMessage(error: unknown): string {
  return toErrorMessage(error, 'Unable to load activity/progress events.');
}
