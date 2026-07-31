/**
 * THE-870 / WP1-C-02 — Task-scoped ActivityEvent spine append/query API.
 *
 * Surfaces THE-869 spine storage for later Workplane activity/progress panel
 * work (THE-871). Does not implement adapters or review gates.
 */

import { Router, type Request } from 'express';
import type {
  ActivityEventSpineRepository,
  AppendActivityEventSpineInput,
  ListActivityEventSpineResult,
  StoredActivityEventSpine,
  TaskRecord,
} from '../../db/src';
import { asyncHandler } from './middleware/async-handler';

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

interface ActivitySpineEventServiceDependencies {
  spineRepository: ActivityEventSpineRepository;
  getTask: (taskId: number) => Promise<TaskRecord | undefined> | TaskRecord | undefined;
}

export interface ActivitySpineEventService {
  appendTaskSpineEvent: (
    taskId: number,
    input: AppendActivityEventSpineInput,
    context?: ActivitySpineEventQueryContext,
  ) => Promise<ActivitySpineEventServiceResult<StoredActivityEventSpine>>;
  queryTaskSpineEvents: (
    taskId: number,
    options?: { limit?: number; context?: ActivitySpineEventQueryContext },
  ) => Promise<ActivitySpineEventServiceResult<ListActivityEventSpineResult>>;
}

function readOrgScope(req: Request): ActivitySpineEventQueryContext {
  const headerOrg = req.header('x-entity-org-id');
  const queryOrg = typeof req.query.orgId === 'string' ? req.query.orgId : undefined;
  const orgId = (headerOrg ?? queryOrg)?.trim();
  return orgId ? { orgId } : {};
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

export function createActivitySpineEventService(
  dependencies: ActivitySpineEventServiceDependencies,
): ActivitySpineEventService {
  const { spineRepository, getTask } = dependencies;

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
      return { ok: true, value: listed };
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
      const result = await service.queryTaskSpineEvents(taskId, {
        limit: Number.isFinite(limitRaw) ? limitRaw : 200,
        context: readOrgScope(req),
      });

      if (!result.ok) {
        return res.status(result.status).json({
          error: result.code,
          message: result.message,
          permissionState: result.permissionState,
          degraded: true,
          empty: false,
          events: [],
        });
      }

      return res.json({
        taskId: result.value.taskId,
        events: result.value.events,
        empty: result.value.empty,
        degraded: result.value.degraded,
        warnings: result.value.warnings,
        permissionState: 'visible',
      });
    }),
  );

  router.post(
    '/tasks/:id/activity-spine-events',
    asyncHandler(async (req, res) => {
      const taskId = Number(req.params.id);
      const result = await service.appendTaskSpineEvent(
        taskId,
        parseAppendBody(req.body),
        readOrgScope(req),
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
