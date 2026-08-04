/**
 * Workplane ASK claim/resolve routes (THE-886 / WP2-B-05).
 *
 * GET    /api/workplanes/:workplaneId/asks
 * POST   /api/workplanes/:workplaneId/asks
 * GET    /api/workplanes/:workplaneId/asks/:askId
 * POST   /api/workplanes/:workplaneId/asks/:askId/claim
 * POST   /api/workplanes/:workplaneId/asks/:askId/resolve
 * POST   /api/workplanes/:workplaneId/asks/:askId/block
 * GET    /api/workplanes/:workplaneId/asks/:askId/events
 *
 * Register after chief routing; before /api/agents/:id*.
 */

import type { Express, Request, Response } from 'express';
import {
  createAskFlowService,
  type AskFlowService,
} from '../agent/ask-flow';
import type { AskStatus } from '../agent/ask-flow/types';

export interface RegisterWorkplaneAskRoutesDeps {
  asks?: AskFlowService;
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

function readExpectedVersion(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
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
    ask?: unknown;
    policy?: unknown;
  },
  successStatus = 200,
): void {
  if (!result.ok) {
    res.status(result.statusCode).json({
      error: result.error,
      code: result.code,
      ...(result.ask ? { ask: result.ask } : {}),
      ...(result.policy ? { policy: result.policy } : {}),
    });
    return;
  }
  res.status(successStatus).json(result.value);
}

export function registerWorkplaneAskRoutes(
  app: Express,
  deps: RegisterWorkplaneAskRoutesDeps = {},
): void {
  const asks = deps.asks ?? createAskFlowService();

  app.get('/api/workplanes/:workplaneId/asks', (req: Request, res: Response) => {
    const panel = req.query.panel === '1' || req.query.panel === 'true';
    if (panel) {
      sendResult(res, asks.getPanel(String(req.params.workplaneId ?? '')));
      return;
    }
    sendResult(res, asks.listAsks(String(req.params.workplaneId ?? '')));
  });

  app.post('/api/workplanes/:workplaneId/asks', (req: Request, res: Response) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body as Record<string, unknown>
      : {};
    const result = asks.createAsk({
      workplaneId: String(req.params.workplaneId ?? ''),
      title: readString(body.title) ?? '',
      body: readNullableString(body.body),
      taskId: readTaskId(body.taskId) ?? readTaskId(body.task_id),
      createdBy: readNullableString(body.createdBy) ?? readNullableString(body.created_by),
    });
    if (!result.ok) {
      res.status(result.statusCode).json({ error: result.error, code: result.code });
      return;
    }
    res.status(201).json(result.value);
  });

  app.get('/api/workplanes/:workplaneId/asks/:askId', (req: Request, res: Response) => {
    sendResult(
      res,
      asks.getAsk(String(req.params.workplaneId ?? ''), String(req.params.askId ?? '')),
    );
  });

  app.post('/api/workplanes/:workplaneId/asks/:askId/claim', (req: Request, res: Response) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body as Record<string, unknown>
      : {};
    const expectedVersion = readExpectedVersion(body.expectedVersion)
      ?? readExpectedVersion(body.expected_version);
    const result = asks.claimAsk({
      workplaneId: String(req.params.workplaneId ?? ''),
      askId: String(req.params.askId ?? ''),
      agentId: readNullableString(body.agentId) ?? readNullableString(body.agent_id) ?? '',
      expectedVersion: expectedVersion ?? Number.NaN,
      expectedStatus: (readNullableString(body.expectedStatus)
        ?? readNullableString(body.expected_status)) as AskStatus | null | undefined,
    });
    if (!result.ok) {
      res.status(result.statusCode).json({
        error: result.error,
        code: result.code,
        ...(result.ask ? { ask: result.ask } : {}),
        ...(result.policy ? { policy: result.policy } : {}),
      });
      return;
    }
    res.status(result.value.created ? 201 : 200).json(result.value);
  });

  app.post('/api/workplanes/:workplaneId/asks/:askId/resolve', (req: Request, res: Response) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body as Record<string, unknown>
      : {};
    const expectedVersion = readExpectedVersion(body.expectedVersion)
      ?? readExpectedVersion(body.expected_version);
    const result = asks.resolveAsk({
      workplaneId: String(req.params.workplaneId ?? ''),
      askId: String(req.params.askId ?? ''),
      resolvedBy: readString(body.resolvedBy)
        ?? readString(body.resolved_by)
        ?? readString(body.agentId)
        ?? readString(body.agent_id)
        ?? '',
      expectedVersion: expectedVersion ?? Number.NaN,
      note: readNullableString(body.note) ?? readNullableString(body.resolutionNote),
      asOperator: readBoolean(body.asOperator) ?? readBoolean(body.as_operator) ?? false,
    });
    sendResult(res, result);
  });

  app.post('/api/workplanes/:workplaneId/asks/:askId/block', (req: Request, res: Response) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body as Record<string, unknown>
      : {};
    const expectedVersion = readExpectedVersion(body.expectedVersion)
      ?? readExpectedVersion(body.expected_version);
    const result = asks.blockAsk({
      workplaneId: String(req.params.workplaneId ?? ''),
      askId: String(req.params.askId ?? ''),
      blockedBy: readString(body.blockedBy)
        ?? readString(body.blocked_by)
        ?? readString(body.agentId)
        ?? readString(body.agent_id)
        ?? '',
      expectedVersion: expectedVersion ?? Number.NaN,
      reason: readNullableString(body.reason),
      asOperator: readBoolean(body.asOperator) ?? readBoolean(body.as_operator) ?? false,
    });
    sendResult(res, result);
  });

  app.get('/api/workplanes/:workplaneId/asks/:askId/events', (req: Request, res: Response) => {
    sendResult(
      res,
      asks.listEvents(String(req.params.workplaneId ?? ''), String(req.params.askId ?? '')),
    );
  });
}
