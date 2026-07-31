/**
 * Workplane Chief-of-Staff routing policy routes (THE-885 / WP2-B-04).
 *
 * GET    /api/workplanes/:workplaneId/routing
 * PUT    /api/workplanes/:workplaneId/routing/chief
 * DELETE /api/workplanes/:workplaneId/routing/chief
 * POST   /api/workplanes/:workplaneId/routing/claim
 * POST   /api/workplanes/:workplaneId/routing/assign
 * POST   /api/workplanes/:workplaneId/routing/release
 * GET    /api/workplanes/:workplaneId/routing/decisions
 *
 * Register after attach routes; before /api/agents/:id*.
 */

import type { Express, Request, Response } from 'express';
import {
  createChiefRoutingService,
  type ChiefRoutingService,
} from '../agent/chief-routing';

export interface RegisterWorkplaneChiefRoutingRoutesDeps {
  routing?: ChiefRoutingService;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  return undefined;
}

function readTaskId(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  return undefined;
}

function readPositiveMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

function sendResult(
  res: Response,
  result: { ok: true; value: unknown } | {
    ok: false;
    statusCode: number;
    error: string;
    code: string;
    policy?: unknown;
  },
  successStatus = 200,
): void {
  if (!result.ok) {
    res.status(result.statusCode).json({
      error: result.error,
      code: result.code,
      ...(result.policy ? { policy: result.policy } : {}),
    });
    return;
  }
  res.status(successStatus).json(result.value);
}

export function registerWorkplaneChiefRoutingRoutes(
  app: Express,
  deps: RegisterWorkplaneChiefRoutingRoutesDeps = {},
): void {
  const routing = deps.routing ?? createChiefRoutingService();

  app.get('/api/workplanes/:workplaneId/routing', (req: Request, res: Response) => {
    const taskId = readTaskId(req.query.taskId) ?? readTaskId(req.query.task_id);
    sendResult(res, routing.getPanel(String(req.params.workplaneId ?? ''), taskId));
  });

  app.put('/api/workplanes/:workplaneId/routing/chief', (req: Request, res: Response) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body as Record<string, unknown>
      : {};
    const result = routing.assignChief({
      workplaneId: String(req.params.workplaneId ?? ''),
      agentId: readNullableString(body.agentId) ?? readNullableString(body.agent_id) ?? '',
      assignedBy: readNullableString(body.assignedBy) ?? readNullableString(body.assigned_by),
      priorityWindowMs: readPositiveMs(body.priorityWindowMs)
        ?? readPositiveMs(body.priority_window_ms),
    });
    if (!result.ok) {
      res.status(result.statusCode).json({ error: result.error, code: result.code });
      return;
    }
    res.status(result.value.created ? 201 : 200).json(result.value);
  });

  app.delete('/api/workplanes/:workplaneId/routing/chief', (req: Request, res: Response) => {
    sendResult(res, routing.clearChief(String(req.params.workplaneId ?? '')));
  });

  app.post('/api/workplanes/:workplaneId/routing/claim', (req: Request, res: Response) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body as Record<string, unknown>
      : {};
    const result = routing.claim({
      workplaneId: String(req.params.workplaneId ?? ''),
      agentId: readNullableString(body.agentId) ?? readNullableString(body.agent_id) ?? '',
      taskId: readTaskId(body.taskId) ?? readTaskId(body.task_id),
      requestId: readNullableString(body.requestId) ?? readNullableString(body.request_id),
    });
    if (!result.ok) {
      res.status(result.statusCode).json({
        error: result.error,
        code: result.code,
        ...(result.policy ? { policy: result.policy } : {}),
      });
      return;
    }
    res.status(result.value.created ? 201 : 200).json(result.value);
  });

  app.post('/api/workplanes/:workplaneId/routing/assign', (req: Request, res: Response) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body as Record<string, unknown>
      : {};
    const result = routing.assign({
      workplaneId: String(req.params.workplaneId ?? ''),
      agentId: readNullableString(body.agentId) ?? readNullableString(body.agent_id) ?? '',
      assignedBy: readString(body.assignedBy)
        ?? readString(body.assigned_by)
        ?? '',
      taskId: readTaskId(body.taskId) ?? readTaskId(body.task_id),
      requestId: readNullableString(body.requestId) ?? readNullableString(body.request_id),
      asOperator: readBoolean(body.asOperator) ?? readBoolean(body.as_operator) ?? false,
    });
    if (!result.ok) {
      res.status(result.statusCode).json({
        error: result.error,
        code: result.code,
        ...(result.policy ? { policy: result.policy } : {}),
      });
      return;
    }
    res.status(result.value.created ? 201 : 200).json(result.value);
  });

  app.post('/api/workplanes/:workplaneId/routing/release', (req: Request, res: Response) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body as Record<string, unknown>
      : {};
    const taskId = readTaskId(body.taskId)
      ?? readTaskId(body.task_id)
      ?? readTaskId(req.query.taskId)
      ?? readTaskId(req.query.task_id);
    sendResult(res, routing.release(String(req.params.workplaneId ?? ''), taskId));
  });

  app.get('/api/workplanes/:workplaneId/routing/decisions', (req: Request, res: Response) => {
    sendResult(res, routing.listDecisions(String(req.params.workplaneId ?? '')));
  });
}
