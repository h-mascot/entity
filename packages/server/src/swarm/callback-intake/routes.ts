/**
 * EEPC-A-03 — Thin Express scaffolding for plan/progress/proof/status/blocker intake.
 *
 * Mounted under /api/swarm. Does not replace legacy job mutation routes
 * (`POST /jobs/:id/status`, `POST /jobs/:id/proof`).
 */

import { Router, type Request, type Response } from 'express';
import type { ExecutionCallbackIntakeService } from './service';
import { INTAKE_CALLBACK_EVENTS, type IntakeCallbackEvent } from './types';

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

export function createExecutionCallbackIntakeRouter(
  service: ExecutionCallbackIntakeService,
): Router {
  const router = Router();

  const handle = (event: IntakeCallbackEvent) => async (req: Request, res: Response) => {
    const jobId = String(req.params.id ?? '').trim();
    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body
      : {}) as Record<string, unknown>;

    const result = await service.intake(buildPayload(event, jobId, body));
    if (!result.ok) {
      return res.status(result.status).json({
        error: result.code,
        message: result.message,
        issues: result.issues,
      });
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
      return res.status(400).json({
        error: 'invalid_event',
        message: `event must be one of: ${INTAKE_CALLBACK_EVENTS.join(', ')}`,
        issues: [
          {
            path: 'event',
            code: 'invalid_event',
            message: `event must be one of: ${INTAKE_CALLBACK_EVENTS.join(', ')}`,
          },
        ],
      });
    }
    return handle(eventName)(req, res);
  });

  // Convenience aliases for kinds that do not collide with legacy Swarm mutation routes.
  router.post('/jobs/:id/plan', handle('plan'));
  router.post('/jobs/:id/progress', handle('progress'));
  router.post('/jobs/:id/blocker', handle('blocker'));

  return router;
}
