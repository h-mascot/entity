/**
 * THE-870 / WP1-C-02 — Task-scoped ActivityEvent spine append/query API.
 * THE-872 / WP1-C-04 — Read-path adapters merge existing agent/progress/
 * task/proof/status signals into the query response for Workplane consumption.
 *
 * Append remains write-to-spine-store only. Query is additive: stored rows +
 * adapted signals. No import mutations. No review-gate enforcement.
 */

import { Router, type Request, type Response } from 'express';
import type {
  ActivityEventSpineRepository,
  AppendActivityEventSpineInput,
  StoredActivityEventSpine,
  TaskRecord,
} from '../../db/src';
import {
  adaptTaskSignalsToSpine,
  mergeStoredAndAdaptedSpineEvents,
  type MergedActivitySpineEvent,
} from './activity-event-spine-adapters';
import { asyncHandler } from './middleware/async-handler';
import { isTrustedServiceContext } from './principals/request-context';
import { requireRequestOrg } from './request-permissions';

export interface ActivitySpineEventQueryContext {
  orgId?: string;
}

export type ActivitySpineEventServiceResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      permissionState: 'hidden';
      degraded: true;
    };

export interface ActivitySpineEventQueryResult {
  taskId: number;
  events: MergedActivitySpineEvent[];
  empty: boolean;
  degraded: boolean;
  warnings: Array<{ code: string; message: string }>;
  adaptedCount: number;
  storedCount: number;
  /** True when adapted read-path signals were included in this response. */
  includeAdapted: boolean;
}

interface ActivitySpineEventServiceDependencies {
  spineRepository: ActivityEventSpineRepository;
  getTask: (taskId: number) => Promise<TaskRecord | undefined> | TaskRecord | undefined;
  /** Optional THE-872 read-path sources. Absent feeds are omitted (not invented). */
  listActivityEventsForTask?: (
    taskId: number,
    limit?: number,
  ) => Promise<readonly unknown[]> | readonly unknown[];
  listSwarmJobsForTask?: (
    taskId: number,
  ) => Promise<readonly unknown[]> | readonly unknown[];
}

export interface ActivitySpineEventService {
  appendTaskSpineEvent: (
    taskId: number,
    input: AppendActivityEventSpineInput,
    context?: ActivitySpineEventQueryContext,
  ) => Promise<ActivitySpineEventServiceResult<StoredActivityEventSpine>>;
  queryTaskSpineEvents: (
    taskId: number,
    options?: {
      limit?: number;
      context?: ActivitySpineEventQueryContext;
      /** Default true — set false for stored-only read. */
      includeAdapted?: boolean;
    },
  ) => Promise<ActivitySpineEventServiceResult<ActivitySpineEventQueryResult>>;
}

function readOrgScope(req: Request): ActivitySpineEventQueryContext {
  const headerOrg = req.header('x-entity-org-id');
  const queryOrg = typeof req.query.orgId === 'string' ? req.query.orgId : undefined;
  const orgId = (headerOrg ?? queryOrg)?.trim();
  return orgId ? { orgId } : {};
}

/**
 * R4: resolve the principal-derived activity spine scope (see activity-events).
 * Customer scope is membership-derived and fails closed; trusted path preserves
 * the header/query convention. Returns `{ context }` or `null` (response sent).
 */
function resolveActivitySpineScope(req: Request, res: Response): { context: ActivitySpineEventQueryContext } | null {
  if (isTrustedServiceContext(req)) return { context: readOrgScope(req) };
  const binding = requireRequestOrg(req, res);
  if (!binding) return null;
  return { context: { orgId: binding.orgId } };
}

function readIncludeAdapted(req: Request): boolean {
  const raw = req.query.includeAdapted ?? req.query.include_adapted;
  if (typeof raw !== 'string') return true;
  const normalized = raw.trim().toLowerCase();
  if (normalized === '0' || normalized === 'false' || normalized === 'no') {
    return false;
  }
  return true;
}

function isTaskVisible(task: TaskRecord, context?: ActivitySpineEventQueryContext): boolean {
  if (!context?.orgId || !task.org_id) {
    return true;
  }
  return task.org_id === context.orgId;
}

async function resolveVisibleTask(
  getTask: ActivitySpineEventServiceDependencies['getTask'],
  taskId: number,
  context?: ActivitySpineEventQueryContext,
): Promise<ActivitySpineEventServiceResult<TaskRecord>> {
  if (!Number.isInteger(taskId) || taskId < 1) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_task_id',
      message: 'task id must be a positive integer',
      permissionState: 'hidden',
      degraded: true,
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
      degraded: true,
    };
  }

  if (!isTaskVisible(task, context)) {
    return {
      ok: false,
      status: 403,
      code: 'permission_denied',
      message: 'activity spine is restricted for this org scope',
      permissionState: 'hidden',
      degraded: true,
    };
  }

  return { ok: true, value: task };
}

function parseAppendBody(body: unknown): AppendActivityEventSpineInput {
  const record =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const actorRaw = record.actor;
  const actor =
    actorRaw && typeof actorRaw === 'object' && !Array.isArray(actorRaw)
      ? {
          type: (actorRaw as Record<string, unknown>).type,
          principalId:
            (actorRaw as Record<string, unknown>).principalId ??
            (actorRaw as Record<string, unknown>).principal_id,
        }
      : undefined;

  return {
    eventType: record.eventType ?? record.event_type ?? record.type,
    actor,
    actorType: record.actorType ?? record.actor_type,
    actorPrincipalId: record.actorPrincipalId ?? record.actor_principal_id,
    timestamp: record.timestamp ?? record.createdAt ?? record.created_at,
    payloadRef: record.payloadRef ?? record.payload_ref ?? record.ref,
    payload: record.payload ?? record.data,
    sequence: record.sequence ?? record.order ?? record.seq,
  };
}

function toAdapterActivityEvent(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return raw;
  }
  const record = raw as Record<string, unknown>;
  // Support both ActivityRecord rows and ActivityEventEnvelope shapes.
  return {
    id: record.id,
    taskId: record.taskId ?? record.task_id,
    eventType: record.eventType ?? record.activity_event_type ?? record.type,
    actorType: record.actorType ?? record.actor_type,
    actorPrincipalId: record.actorPrincipalId ?? record.actor_principal_id,
    actor: record.actor,
    action: record.action,
    description: record.description,
    createdAt: record.createdAt ?? record.created_at,
    payload: record.payload,
    payloadRef: record.payloadRef ?? record.payload_ref ?? record.file_path,
    schemaStatus: record.schemaStatus ?? record.activity_event_schema_status,
    degraded: record.degraded,
    warnings: record.warnings,
  };
}

export function createActivitySpineEventService(
  dependencies: ActivitySpineEventServiceDependencies,
): ActivitySpineEventService {
  const { spineRepository, getTask, listActivityEventsForTask, listSwarmJobsForTask } =
    dependencies;

  return {
    async appendTaskSpineEvent(taskId, input, context) {
      const taskResult = await resolveVisibleTask(getTask, taskId, context);
      if (!taskResult.ok) return taskResult;

      const appended = spineRepository.appendForTask(taskResult.value.id, input);
      if (!appended.ok) {
        return {
          ok: false,
          status: 400,
          code: appended.reason,
          message: `unable to append activity spine event: ${appended.reason}`,
          permissionState: 'hidden',
          degraded: true,
        };
      }

      return { ok: true, value: appended.event };
    },

    async queryTaskSpineEvents(taskId, options = {}) {
      const taskResult = await resolveVisibleTask(getTask, taskId, options.context);
      if (!taskResult.ok) return taskResult;

      const listed = spineRepository.listForTask(taskResult.value.id, {
        limit: options.limit,
      });

      const includeAdapted = options.includeAdapted !== false;
      if (!includeAdapted) {
        return {
          ok: true,
          value: {
            ...listed,
            adaptedCount: 0,
            storedCount: listed.events.length,
            includeAdapted: false,
          },
        };
      }

      let activityEvents: readonly unknown[] | null | undefined = undefined;
      if (listActivityEventsForTask) {
        try {
          const rows = await listActivityEventsForTask(
            taskResult.value.id,
            typeof options.limit === 'number' ? options.limit : 200,
          );
          activityEvents = Array.isArray(rows)
            ? rows.map(toAdapterActivityEvent)
            : null;
        } catch {
          activityEvents = null;
        }
      }

      let swarmJobs: readonly unknown[] | null | undefined = undefined;
      if (listSwarmJobsForTask) {
        try {
          const rows = await listSwarmJobsForTask(taskResult.value.id);
          swarmJobs = Array.isArray(rows) ? rows : null;
        } catch {
          swarmJobs = null;
        }
      }

      const adapted = adaptTaskSignalsToSpine({
        taskId: taskResult.value.id,
        task: taskResult.value,
        activityEvents,
        swarmJobs,
      });

      const merged = mergeStoredAndAdaptedSpineEvents({
        taskId: taskResult.value.id,
        stored: listed.events,
        adapted,
      });

      const limited =
        typeof options.limit === 'number' && Number.isInteger(options.limit) && options.limit > 0
          ? merged.events.slice(0, options.limit)
          : merged.events;

      return {
        ok: true,
        value: {
          taskId: merged.taskId,
          events: limited,
          empty: limited.length === 0,
          degraded: listed.degraded || merged.degraded,
          warnings: [...listed.warnings, ...merged.warnings],
          adaptedCount: limited.filter(
            (event) => 'adapted' in event && event.adapted === true,
          ).length,
          storedCount: limited.filter(
            (event) => !('adapted' in event && event.adapted === true),
          ).length,
          includeAdapted: true,
        },
      };
    },
  };
}

export function createActivitySpineEventRouter(service: ActivitySpineEventService): Router {
  const router = Router();

  router.get(
    '/tasks/:id/activity-spine-events',
    asyncHandler(async (req, res) => {
      const taskId = Number(req.params.id);
      const limitRaw = Number(req.query.limit ?? 200);
      const scope = resolveActivitySpineScope(req, res);
      if (!scope) return undefined;
      const result = await service.queryTaskSpineEvents(taskId, {
        limit: Number.isFinite(limitRaw) ? limitRaw : 200,
        context: scope.context,
        includeAdapted: readIncludeAdapted(req),
      });

      if (!result.ok) {
        return res.status(result.status).json({
          error: result.code,
          message: result.message,
          permissionState: result.permissionState,
          degraded: true,
          empty: false,
          events: [],
          adaptedCount: 0,
          storedCount: 0,
          includeAdapted: false,
        });
      }

      return res.json({
        taskId: result.value.taskId,
        events: result.value.events,
        empty: result.value.empty,
        degraded: result.value.degraded,
        warnings: result.value.warnings,
        adaptedCount: result.value.adaptedCount,
        storedCount: result.value.storedCount,
        includeAdapted: result.value.includeAdapted,
        permissionState: 'visible',
      });
    }),
  );

  router.post(
    '/tasks/:id/activity-spine-events',
    asyncHandler(async (req, res) => {
      const taskId = Number(req.params.id);
      const scope = resolveActivitySpineScope(req, res);
      if (!scope) return undefined;
      const result = await service.appendTaskSpineEvent(
        taskId,
        parseAppendBody(req.body),
        scope.context,
      );

      if (!result.ok) {
        return res.status(result.status).json({
          error: result.code,
          message: result.message,
          permissionState: result.permissionState,
          degraded: true,
        });
      }

      return res.status(201).json({
        event: result.value,
        permissionState: 'visible',
        degraded: false,
      });
    }),
  );

  return router;
}
