/**
 * Heartbeat / presence endpoints (THE-883 / WP2-B-02).
 *
 * POST /api/agents/presence/heartbeat
 * GET  /api/agents/presence/:agentId
 * GET  /api/workplanes/:workplaneId/presence
 *
 * Register before /api/agents/:id* registry routes.
 */

import type { Express, Request, Response } from 'express';
import {
  createPresenceService,
  type PresenceService,
} from '../agent/presence';
import type { HeartbeatInput } from '../agent/presence/types';

export interface RegisterAgentPresenceRoutesDeps {
  presence?: PresenceService;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  return undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
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

function parseHeartbeatBody(body: unknown): HeartbeatInput {
  const input = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  return {
    agentId: readString(input.agentId) ?? readString(input.agent_id) ?? '',
    inviteId: readNullableString(input.inviteId) ?? readNullableString(input.invite_id),
    status: readString(input.status),
    currentTaskId: readTaskId(input.currentTaskId) ?? readTaskId(input.current_task_id),
    currentWorkplaneId:
      readNullableString(input.currentWorkplaneId)
      ?? readNullableString(input.current_workplane_id)
      ?? readNullableString(input.workplaneId)
      ?? readNullableString(input.workplane_id),
    runtime: readNullableString(input.runtime),
    sessionId: readNullableString(input.sessionId) ?? readNullableString(input.session_id),
    capabilities: readStringArray(input.capabilities),
  };
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

export function registerAgentPresenceRoutes(
  app: Express,
  deps: RegisterAgentPresenceRoutesDeps = {},
): void {
  const presence = deps.presence ?? createPresenceService();

  app.post('/api/agents/presence/heartbeat', (req: Request, res: Response) => {
    const result = presence.recordHeartbeat(parseHeartbeatBody(req.body));
    if (!result.ok) {
      res.status(result.statusCode).json({ error: result.error, code: result.code });
      return;
    }
    res.status(200).json({
      record: result.value.record,
      presence: result.value.evaluated,
    });
  });

  app.get('/api/agents/presence/:agentId', (req: Request, res: Response) => {
    sendResult(res, presence.getAgentPresence(String(req.params.agentId ?? '')));
  });

  app.get('/api/workplanes/:workplaneId/presence', (req: Request, res: Response) => {
    sendResult(res, presence.getWorkplanePresence(String(req.params.workplaneId ?? '')));
  });
}
