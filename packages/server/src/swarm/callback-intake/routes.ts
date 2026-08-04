/**
 * EEPC-A-03 — Thin Express scaffolding for plan/progress/proof/status/blocker intake.
 * EEPC-A-07 — Header auth extraction + public-safe error bodies.
 *
 * Mounted under /api/swarm. Does not replace legacy job mutation routes
 * (`POST /jobs/:id/status`, `POST /jobs/:id/proof`).
 */

import { Router, type Request, type Response } from 'express';
import { toPublicCallbackErrorBody } from './public-safe';
import type { ExecutionCallbackIntakeService } from './service';
import {
  INTAKE_CALLBACK_EVENTS,
  type CallbackAuthContext,
  type IntakeCallbackEvent,
} from './types';

function isIntakeEvent(value: string): value is IntakeCallbackEvent {
  return (INTAKE_CALLBACK_EVENTS as readonly string[]).includes(value);
}

function buildPayload(event: IntakeCallbackEvent, jobId: string, body: Record<string, unknown>) {
  return {
    ...body,
    event,
    jobId: typeof body.jobId === 'string' && body.jobId.trim() ? body.jobId : jobId,
    provider: body.provider,
  };
}

function readAuthContext(req: Request): CallbackAuthContext {
  const authorizationHeader =
    typeof req.get === 'function' ? req.get('authorization') : undefined;
  const callbackHeader =
    typeof req.get === 'function' ? req.get('x-entity-callback-token') : undefined;

  const authorization =
    (typeof authorizationHeader === 'string' && authorizationHeader.trim()
      ? authorizationHeader
      : undefined) ??
    (typeof req.headers?.authorization === 'string' ? req.headers.authorization : undefined);

  const callbackToken =
    (typeof callbackHeader === 'string' && callbackHeader.trim()
      ? callbackHeader.trim()
      : undefined) ??
    (typeof req.headers?.['x-entity-callback-token'] === 'string'
      ? req.headers['x-entity-callback-token'].trim()
      : undefined);

  return { authorization, callbackToken };
}

export function createExecutionCallbackIntakeRouter(
  service: ExecutionCallbackIntakeService,
): Router {
  const router = Router();

  const handle = (event: IntakeCallbackEvent) => async (req: Request, res: Response) => {
    const jobId = String(req.params.id ?? '').trim();
    if (!jobId) {
      return res.status(400).json(
        toPublicCallbackErrorBody({
          code: 'missing_job_id',
          message: 'job id is required',
          issues: [{ path: 'jobId', code: 'missing_job_id', message: 'job id is required' }],
        }),
      );
    }

    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body
      : {}) as Record<string, unknown>;

    const result = await service.intake(buildPayload(event, jobId, body), readAuthContext(req));
    if (!result.ok) {
      return res.status(result.status).json(
        toPublicCallbackErrorBody({
          code: result.code,
          message: result.message,
          issues: result.issues,
        }),
      );
    }

    return res.status(result.status).json({
      ok: true,
      persisted: result.record.persisted,
      degraded: result.record.degraded,
      record: result.record,
    });
  };

  // Canonical ActivityEvent intake surface for all five kinds (no clash with legacy mutation).
  router.post('/jobs/:id/callbacks/:event', async (req: Request, res: Response) => {
    const eventName = String(req.params.event ?? '').trim();
    if (!isIntakeEvent(eventName)) {
      return res.status(400).json(
        toPublicCallbackErrorBody({
          code: 'invalid_event',
          message: `event must be one of: ${INTAKE_CALLBACK_EVENTS.join(', ')}`,
          issues: [
            {
              path: 'event',
              code: 'invalid_event',
              message: `event must be one of: ${INTAKE_CALLBACK_EVENTS.join(', ')}`,
            },
          ],
        }),
      );
    }
    return handle(eventName)(req, res);
  });

  // Convenience aliases for kinds that do not collide with legacy Swarm mutation routes.
  router.post('/jobs/:id/plan', handle('plan'));
  router.post('/jobs/:id/progress', handle('progress'));
  router.post('/jobs/:id/blocker', handle('blocker'));

  return router;
}
