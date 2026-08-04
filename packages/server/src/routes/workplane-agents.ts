/**
 * Workplane agent attach/detach/list (THE-884 / WP2-B-03).
 *
 * POST   /api/workplanes/:workplaneId/agents
 * GET    /api/workplanes/:workplaneId/agents
 * DELETE /api/workplanes/:workplaneId/agents/:agentId
 *
 * Register alongside presence routes (before /api/agents/:id*).
 */

import type { Express, Request, Response } from 'express';
import {
  createWorkplaneAttachService,
  type WorkplaneAttachService,
} from '../agent/workplane-attach';

export interface RegisterWorkplaneAgentRoutesDeps {
  attach?: WorkplaneAttachService;
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

function sendResult(
  res: Response,
  result: { ok: true; value: unknown } | {
    ok: false;
    statusCode: number;
    error: string;
    code: string;
  },
  successStatus = 200,
): void {
  if (!result.ok) {
    res.status(result.statusCode).json({
      error: result.error,
      code: result.code,
    });
    return;
  }
  res.status(successStatus).json(result.value);
}

export function registerWorkplaneAgentRoutes(
  app: Express,
  deps: RegisterWorkplaneAgentRoutesDeps = {},
): void {
  const attach = deps.attach ?? createWorkplaneAttachService();

  app.get('/api/workplanes/:workplaneId/agents', (req: Request, res: Response) => {
    sendResult(res, attach.list(String(req.params.workplaneId ?? '')));
  });

  app.post('/api/workplanes/:workplaneId/agents', (req: Request, res: Response) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body as Record<string, unknown>
      : {};
    const result = attach.attach({
      workplaneId: String(req.params.workplaneId ?? ''),
      agentId: readNullableString(body.agentId) ?? readNullableString(body.agent_id),
      inviteId: readNullableString(body.inviteId) ?? readNullableString(body.invite_id),
      taskId: readTaskId(body.taskId) ?? readTaskId(body.task_id),
      agentName: readNullableString(body.agentName) ?? readNullableString(body.agent_name),
      role: readString(body.role),
      attachedBy: readNullableString(body.attachedBy) ?? readNullableString(body.attached_by),
    });
    if (!result.ok) {
      res.status(result.statusCode).json({ error: result.error, code: result.code });
      return;
    }
    res.status(result.value.created ? 201 : 200).json(result.value);
  });

  app.delete('/api/workplanes/:workplaneId/agents/:agentId', (req: Request, res: Response) => {
    const agentId = decodeURIComponent(String(req.params.agentId ?? ''));
    sendResult(
      res,
      attach.detach(String(req.params.workplaneId ?? ''), agentId),
    );
  });
}
