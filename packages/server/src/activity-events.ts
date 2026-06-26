import { Router, type Request } from 'express';
import {
  ACTIVITY_EVENT_PAYLOAD_VERSION,
  ACTIVITY_EVENT_TYPES,
  type ActivityEventActorType,
  type ActivityEventPayload,
  type ActivityEventSchemaStatus,
  type ActivityEventType,
  type ActivityRecord,
  type ActivityRepository,
  type ActivityType,
  type TaskRecord,
} from '../../db/src';

const ACTIVITY_EVENT_TYPE_SET = new Set<string>(ACTIVITY_EVENT_TYPES);

export interface ActivityEventEnvelope {
  id: number;
  taskId: number | null;
  eventType: ActivityEventType;
  payloadVersion: number;
  payload: Record<string, unknown>;
  schemaStatus: ActivityEventSchemaStatus;
  legacyType: string | null;
  actorType: ActivityEventActorType;
  actorPrincipalId: string | null;
  objectRefs: ActivityEventPayload['object_refs'];
  action: string;
  description: string;
  createdAt: string;
  permissionState: 'visible';
  degraded: boolean;
  warnings: Array<{ code: string; message: string }>;
}

export interface ActivityEventAppendInput {
  eventType?: ActivityEventType | string;
  action: string;
  description: string;
  actorPrincipalId?: string;
  actorType?: ActivityEventActorType;
  payload?: Record<string, unknown> | string | null;
  metadata?: Record<string, unknown>;
}

type ActivityObjectRef = NonNullable<ActivityEventPayload['object_refs']>[number];

export type ActivityEventConsumerKind = 'receipt' | 'review' | 'routing' | 'notification';

export interface ActivityEventConsumerSummaryEntry {
  id: number;
  eventType: ActivityEventType;
  action: string;
  description: string;
  actorPrincipalId: string | null;
  createdAt: string;
  degraded: boolean;
}

export interface ActivityEventReceiptConsumerSummary {
  taskId: number | null;
  sourceEventIds: number[];
  routingHistory: ActivityEventConsumerSummaryEntry[];
  reviewHistory: ActivityEventConsumerSummaryEntry[];
  humanGateHistory: ActivityEventConsumerSummaryEntry[];
  notificationHistory: ActivityEventConsumerSummaryEntry[];
  receiptArtifacts: ActivityEventConsumerSummaryEntry[];
  degradedEvents: ActivityEventConsumerSummaryEntry[];
  missingConsumers: ActivityEventConsumerKind[];
}

export interface ActivityEventQueryContext {
  orgId?: string;
}

export type ActivityEventServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; code: string; message: string; permissionState: 'hidden' };

interface ActivityEventServiceDependencies {
  activityRepository: ActivityRepository;
  getTask: (taskId: number) => Promise<TaskRecord | undefined> | TaskRecord | undefined;
}

export interface ActivityEventService {
  appendTaskEvent: (
    taskId: number,
    input: ActivityEventAppendInput,
    context?: ActivityEventQueryContext,
  ) => Promise<ActivityEventServiceResult<ActivityEventEnvelope>>;
  queryTaskEvents: (
    taskId: number,
    options?: { limit?: number; context?: ActivityEventQueryContext },
  ) => Promise<ActivityEventServiceResult<ActivityEventEnvelope[]>>;
}

function isKnownActivityEventType(value: unknown): value is ActivityEventType {
  return typeof value === 'string' && ACTIVITY_EVENT_TYPE_SET.has(value.trim().toLowerCase());
}

function normalizeActorType(value: unknown): ActivityEventActorType {
  return value === 'human' || value === 'agent' || value === 'system' || value === 'workflow'
    ? value
    : 'unknown';
}

function legacyTypeForEvent(eventType: ActivityEventType): ActivityType {
  switch (eventType) {
    case 'task_created':
      return 'task_created';
    case 'status_changed':
      return 'task_moved';
    case 'completion_accepted':
      return 'task_completed';
    case 'task_cancelled':
      return 'task_deleted';
    case 'task_updated':
    case 'assignment_changed':
    default:
      return 'task_updated';
  }
}

const ROUTING_EVENT_TYPES = new Set<ActivityEventType>([
  'assignment_changed',
  'taskmaster_claimed',
  'nudge_sent',
  'owner_escalated',
  'auto_reassigned',
  'status_changed',
  'completion_accepted',
]);

const REVIEW_EVENT_TYPES = new Set<ActivityEventType>([
  'submission_created',
  'review_requested',
  'review_decision',
]);

const HUMAN_GATE_EVENT_TYPES = new Set<ActivityEventType>([
  'human_gate_requested',
  'human_gate_decision',
]);

const RECEIPT_EVENT_TYPES = new Set<ActivityEventType>([
  'artifact_linked',
  'receipt_created',
  'receipt_failed',
]);

function isActivityObjectRef(value: unknown): value is ActivityObjectRef {
  return Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as { object_type?: unknown }).object_type === 'string' &&
    typeof (value as { object_id?: unknown }).object_id === 'string';
}

function mergeObjectRefs(taskId: number, objectRefs: unknown): ActivityObjectRef[] {
  const merged = new Map<string, ActivityObjectRef>();
  const add = (ref: ActivityObjectRef) => {
    const role = typeof ref.link_role === 'string' ? ref.link_role : '';
    merged.set(`${ref.object_type}:${ref.object_id}:${role}`, ref);
  };

  add({ object_type: 'task', object_id: String(taskId), link_role: 'origin' });
  if (Array.isArray(objectRefs)) {
    for (const ref of objectRefs) {
      if (isActivityObjectRef(ref)) {
        add(ref);
      }
    }
  }

  return [...merged.values()];
}

function toSummaryEntry(event: ActivityEventEnvelope): ActivityEventConsumerSummaryEntry {
  return {
    id: event.id,
    eventType: event.eventType,
    action: event.action,
    description: event.description,
    actorPrincipalId: event.actorPrincipalId,
    createdAt: event.createdAt,
    degraded: event.degraded,
  };
}

export function summarizeActivityEventsForReceipt(
  events: readonly ActivityEventEnvelope[],
): ActivityEventReceiptConsumerSummary {
  const summary: ActivityEventReceiptConsumerSummary = {
    taskId: events.find((event) => typeof event.taskId === 'number')?.taskId ?? null,
    sourceEventIds: events.map((event) => event.id),
    routingHistory: [],
    reviewHistory: [],
    humanGateHistory: [],
    notificationHistory: [],
    receiptArtifacts: [],
    degradedEvents: [],
    missingConsumers: [],
  };

  for (const event of events) {
    const entry = toSummaryEntry(event);
    if (ROUTING_EVENT_TYPES.has(event.eventType)) {
      summary.routingHistory.push(entry);
    }
    if (REVIEW_EVENT_TYPES.has(event.eventType)) {
      summary.reviewHistory.push(entry);
    }
    if (HUMAN_GATE_EVENT_TYPES.has(event.eventType)) {
      summary.humanGateHistory.push(entry);
    }
    if (event.eventType === 'notification_routed') {
      summary.notificationHistory.push(entry);
    }
    if (RECEIPT_EVENT_TYPES.has(event.eventType)) {
      summary.receiptArtifacts.push(entry);
    }
    if (event.degraded) {
      summary.degradedEvents.push(entry);
    }
  }

  if (summary.receiptArtifacts.length === 0) summary.missingConsumers.push('receipt');
  if (summary.reviewHistory.length === 0 && summary.humanGateHistory.length === 0) summary.missingConsumers.push('review');
  if (summary.routingHistory.length === 0) summary.missingConsumers.push('routing');
  if (summary.notificationHistory.length === 0) summary.missingConsumers.push('notification');

  return summary;
}

export function buildConsumerActivityEventInput(input: {
  consumer: ActivityEventConsumerKind;
  eventType: ActivityEventType;
  action: string;
  description: string;
  actorPrincipalId?: string;
  actorType?: ActivityEventActorType;
  objectRefs?: ActivityObjectRef[];
  data?: Record<string, unknown>;
  reason?: string;
  warnings?: Array<{ code: string; message: string }>;
}): ActivityEventAppendInput {
  return {
    eventType: input.eventType,
    action: input.action,
    description: input.description,
    actorPrincipalId: input.actorPrincipalId,
    actorType: input.actorType ?? 'system',
    payload: {
      version: ACTIVITY_EVENT_PAYLOAD_VERSION,
      actor_principal_id: input.actorPrincipalId,
      actor_type: input.actorType ?? 'system',
      consumer: input.consumer,
      object_refs: input.objectRefs,
      reason: input.reason,
      data: input.data,
      warnings: input.warnings,
    },
  };
}

export function buildTaskAgentActionActivityEventInput(action: {
  event: string;
  taskId?: number;
  action: string;
  result: string;
  tokensUsed?: number;
  details?: Record<string, unknown>;
}): ActivityEventAppendInput | null {
  if (!Number.isInteger(action.taskId)) {
    return null;
  }

  let consumer: ActivityEventConsumerKind = 'routing';
  let eventType: ActivityEventType | null = null;

  const notificationFailed = action.action === 'notify_assignee_failed' || action.action === 'notify_owner_failed';
  if (
    action.action === 'notify_assignee' ||
    action.action === 'notify_owner' ||
    action.action === 'request_output' ||
    action.action === 'request_owner_assignment' ||
    notificationFailed
  ) {
    consumer = 'notification';
    eventType = 'notification_routed';
  } else if (
    action.action === 'classify_review_output' ||
    action.action === 'reject_invalid_output' ||
    action.action === 'flag_weak_output'
  ) {
    consumer = 'review';
    eventType = 'review_decision';
  } else if (action.event === 'review_check' || action.event === 'review_hygiene' || action.event === 'output_missing') {
    consumer = 'review';
    eventType = 'review_requested';
  } else if (action.action === 'escalate_blocker' || action.action === 'escalate_owner') {
    consumer = 'routing';
    eventType = 'owner_escalated';
  } else if (action.action === 'auto_reassign_task') {
    consumer = 'routing';
    eventType = 'auto_reassigned';
  } else if (action.action === 'nudge_assignee') {
    consumer = 'routing';
    eventType = 'nudge_sent';
  } else if (action.event === 'ownership_check') {
    consumer = 'routing';
    eventType = 'assignment_changed';
  }

  if (!eventType) {
    return null;
  }

  return buildConsumerActivityEventInput({
    consumer,
    eventType,
    action: `Task Agent: ${action.action}`,
    description: action.result,
    actorPrincipalId: 'task-master',
    actorType: 'agent',
    data: {
      task_agent_event: action.event,
      task_agent_action: action.action,
      ...(action.details ?? {}),
      delivery_status: notificationFailed ? 'failed' : undefined,
      tokens_used: Number.isFinite(action.tokensUsed) ? action.tokensUsed : 0,
    },
    warnings: notificationFailed
      ? [{ code: 'notification_delivery_failed', message: action.result }]
      : undefined,
  });
}

function readOrgScope(req: Request): ActivityEventQueryContext {
  const headerOrg = req.header('x-entity-org-id');
  const queryOrg = typeof req.query.orgId === 'string' ? req.query.orgId : undefined;
  const orgId = (headerOrg ?? queryOrg)?.trim();
  return orgId ? { orgId } : {};
}

function isTaskVisible(task: TaskRecord, context?: ActivityEventQueryContext): boolean {
  if (!context?.orgId || !task.org_id) {
    return true;
  }
  return task.org_id === context.orgId;
}

async function resolveVisibleTask(
  getTask: ActivityEventServiceDependencies['getTask'],
  taskId: number,
  context?: ActivityEventQueryContext,
): Promise<ActivityEventServiceResult<TaskRecord>> {
  if (!Number.isInteger(taskId) || taskId < 1) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_task_id',
      message: 'task id must be a positive integer',
      permissionState: 'hidden',
    };
  }

  const task = await getTask(taskId);
  if (!task) {
    return {
      ok: false,
      status: 404,
      code: 'task_not_found',
      message: 'task not found',
      permissionState: 'hidden',
    };
  }

  if (!isTaskVisible(task, context)) {
    return {
      ok: false,
      status: 403,
      code: 'permission_denied',
      message: 'activity is restricted for this org scope',
      permissionState: 'hidden',
    };
  }

  return { ok: true, value: task };
}

function parseEnvelopePayload(record: ActivityRecord): {
  payload: Record<string, unknown>;
  warnings: Array<{ code: string; message: string }>;
} {
  const warnings: Array<{ code: string; message: string }> = [];
  let payload: Record<string, unknown> = {};

  try {
    const parsed = JSON.parse(record.activity_event_payload_json) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    } else {
      warnings.push({ code: 'malformed_payload', message: 'activity event payload was not an object' });
    }
  } catch {
    warnings.push({ code: 'malformed_payload', message: 'activity event payload could not be parsed' });
  }

  if (record.activity_event_schema_status === 'legacy_unknown') {
    warnings.push({ code: 'legacy_unknown', message: 'legacy or unknown event preserved without clean coercion' });
  }

  if (payload.version !== ACTIVITY_EVENT_PAYLOAD_VERSION) {
    warnings.push({ code: 'payload_version_mismatch', message: 'payload version is missing or unsupported' });
  }

  if (Array.isArray(payload.warnings)) {
    for (const warning of payload.warnings) {
      if (
        warning &&
        typeof warning === 'object' &&
        typeof (warning as { code?: unknown }).code === 'string' &&
        typeof (warning as { message?: unknown }).message === 'string'
      ) {
        warnings.push({
          code: (warning as { code: string }).code,
          message: (warning as { message: string }).message,
        });
      }
    }
  }

  return { payload, warnings };
}

function toEnvelope(record: ActivityRecord): ActivityEventEnvelope {
  const { payload, warnings } = parseEnvelopePayload(record);
  const actorType = normalizeActorType(payload.actor_type);
  const actorPrincipalId =
    typeof payload.actor_principal_id === 'string' && payload.actor_principal_id.trim()
      ? payload.actor_principal_id.trim()
      : null;
  const objectRefs = Array.isArray(payload.object_refs)
    ? payload.object_refs.filter(
        (ref): ref is NonNullable<ActivityEventPayload['object_refs']>[number] =>
          Boolean(ref) &&
          typeof ref === 'object' &&
          typeof (ref as { object_type?: unknown }).object_type === 'string' &&
          typeof (ref as { object_id?: unknown }).object_id === 'string',
      )
    : undefined;

  return {
    id: record.id,
    taskId: record.task_id,
    eventType: record.activity_event_type,
    payloadVersion: record.activity_event_payload_version,
    payload,
    schemaStatus: record.activity_event_schema_status,
    legacyType: record.activity_event_legacy_type,
    actorType,
    actorPrincipalId,
    objectRefs,
    action: record.action,
    description: record.description,
    createdAt: record.created_at,
    permissionState: 'visible',
    degraded: warnings.length > 0,
    warnings,
  };
}

function normalizeAppendPayload(
  taskId: number,
  input: ActivityEventAppendInput,
): { payload: Record<string, unknown>; warnings: Array<{ code: string; message: string }> } {
  const warnings: Array<{ code: string; message: string }> = [];
  const base = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
    ? input.payload
    : {};
  const payloadWarnings = Array.isArray((base as { warnings?: unknown }).warnings)
    ? (base as { warnings: unknown[] }).warnings.filter(
        (warning): warning is { code: string; message: string } =>
          Boolean(warning) &&
          typeof warning === 'object' &&
          typeof (warning as { code?: unknown }).code === 'string' &&
          typeof (warning as { message?: unknown }).message === 'string',
      )
    : [];

  if (input.payload !== undefined && input.payload !== null && base !== input.payload) {
    warnings.push({ code: 'malformed_payload', message: 'non-object payload stored as degraded ActivityEvent metadata' });
  }

  return {
    payload: {
      ...base,
      version: ACTIVITY_EVENT_PAYLOAD_VERSION,
      actor_principal_id: input.actorPrincipalId,
      actor_type: normalizeActorType(input.actorType),
      task_id: taskId,
      object_refs: mergeObjectRefs(taskId, (base as { object_refs?: unknown }).object_refs),
      warnings: payloadWarnings.length || warnings.length ? [...payloadWarnings, ...warnings] : undefined,
    },
    warnings,
  };
}

export function buildTaskMutationActivityEvent(input: {
  action: 'create' | 'update' | 'move' | 'delete';
  task: TaskRecord;
  previousTask?: TaskRecord | null;
  actorPrincipalId?: string;
}): { eventType: ActivityEventType; payload: ActivityEventPayload } {
  const previous = input.previousTask ?? null;
  const statusChanged = previous ? previous.column !== input.task.column : false;
  const assignmentChanged = previous
    ? previous.assignee !== input.task.assignee ||
      previous.executor_principal_id !== input.task.executor_principal_id ||
      previous.assignment_state !== input.task.assignment_state
    : false;

  const eventType: ActivityEventType =
    input.action === 'create'
      ? 'task_created'
      : input.action === 'delete'
        ? 'task_cancelled'
        : statusChanged && input.task.column === 'done'
          ? 'completion_accepted'
          : statusChanged
            ? 'status_changed'
            : assignmentChanged
              ? 'assignment_changed'
              : 'task_updated';

  return {
    eventType,
    payload: {
      version: ACTIVITY_EVENT_PAYLOAD_VERSION,
      actor_principal_id: input.actorPrincipalId,
      actor_type: input.actorPrincipalId ? 'human' : 'unknown',
      task_id: input.task.id,
      previous_state: previous?.column,
      new_state: input.task.column,
      object_refs: [{ object_type: 'task', object_id: String(input.task.id), link_role: 'origin' }],
      data: {
        task_name: input.task.name,
        previous_assignee: previous?.assignee ?? null,
        assignee: input.task.assignee,
        previous_executor_principal_id: previous?.executor_principal_id ?? null,
        executor_principal_id: input.task.executor_principal_id ?? null,
        previous_assignment_state: previous?.assignment_state ?? null,
        assignment_state: input.task.assignment_state ?? null,
      },
    },
  };
}

export function createActivityEventService(dependencies: ActivityEventServiceDependencies): ActivityEventService {
  const { activityRepository, getTask } = dependencies;

  return {
    async appendTaskEvent(taskId, input, context) {
      const taskResult = await resolveVisibleTask(getTask, taskId, context);
      if (!taskResult.ok) return taskResult;

      const action = input.action.trim();
      const description = input.description.trim();
      if (!action || !description) {
        return {
          ok: false,
          status: 400,
          code: 'invalid_activity_event',
          message: 'activity event action and description are required',
          permissionState: 'hidden',
        };
      }

      const knownEventType = isKnownActivityEventType(input.eventType)
        ? input.eventType.trim().toLowerCase() as ActivityEventType
        : 'legacy_event_observed';
      const { payload } = normalizeAppendPayload(taskId, input);
      const schemaStatus: ActivityEventSchemaStatus = knownEventType === 'legacy_event_observed'
        ? 'legacy_unknown'
        : 'structured';
      const record = activityRepository.createActivity({
        source: 'task',
        type: legacyTypeForEvent(knownEventType),
        activity_event_type: isKnownActivityEventType(input.eventType) ? input.eventType : String(input.eventType ?? ''),
        activity_event_schema_status: schemaStatus,
        activity_event_payload: payload,
        action,
        description,
        task_id: taskResult.value.id,
        task_column: taskResult.value.column,
        agent_name: input.actorPrincipalId,
        metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
      });

      return { ok: true, value: toEnvelope(record) };
    },

    async queryTaskEvents(taskId, options = {}) {
      const taskResult = await resolveVisibleTask(getTask, taskId, options.context);
      if (!taskResult.ok) return taskResult;

      const limit = Number.isInteger(options.limit) ? options.limit! : 50;
      const records = activityRepository.listActivitiesByTaskId(taskResult.value.id, limit);
      return { ok: true, value: records.map(toEnvelope) };
    },
  };
}

export function createActivityEventRouter(service: ActivityEventService): Router {
  const router = Router();

  router.get('/tasks/:id/activity-events', async (req, res) => {
    const taskId = Number(req.params.id);
    const limitRaw = Number(req.query.limit ?? 50);
    const result = await service.queryTaskEvents(taskId, {
      limit: Number.isFinite(limitRaw) ? limitRaw : 50,
      context: readOrgScope(req),
    });

    if (!result.ok) {
      return res.status(result.status).json({
        error: result.code,
        message: result.message,
        permissionState: result.permissionState,
      });
    }

    return res.json({ events: result.value });
  });

  router.post('/tasks/:id/activity-events', async (req, res) => {
    const taskId = Number(req.params.id);
    const body = req.body ?? {};
    const result = await service.appendTaskEvent(
      taskId,
      {
        eventType: body.event_type ?? body.activity_event_type,
        action: typeof body.action === 'string' ? body.action : '',
        description: typeof body.description === 'string' ? body.description : '',
        actorPrincipalId: typeof body.actor_principal_id === 'string' ? body.actor_principal_id : undefined,
        actorType: body.actor_type,
        payload: body.payload,
        metadata: body.metadata,
      },
      readOrgScope(req),
    );

    if (!result.ok) {
      return res.status(result.status).json({
        error: result.code,
        message: result.message,
        permissionState: result.permissionState,
      });
    }

    return res.status(201).json({ event: result.value });
  });

  return router;
}
