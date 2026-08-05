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
    // D9: the route parameter is authoritative for the job identity. A body
    // jobId that disagrees with the URL :id is rejected before intake (see
    // handle()), so it can never retarget ActivityEvent mapping to another job.
    jobId,
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

export interface ExecutionCallbackIntakeRouterOptions {
  /**
   * D8: optional pre-intake authorization of the target job's visibility to the
   * request scope. Return false to fail closed (404 unknown_job, no ActivityEvent
   * intake) for a missing or out-of-scope task-linked job; return true for
   * unlinked operational jobs and in-scope task-linked jobs. Provider callback
   * authentication is still enforced by the intake service after this gate, and
   * the pure intake contract (used in unit tests) is unchanged when omitted.
   */
  authorizeJob?: (req: Request, jobId: string) => Promise<boolean>;
}

export function createExecutionCallbackIntakeRouter(
  service: ExecutionCallbackIntakeService,
  options?: ExecutionCallbackIntakeRouterOptions,
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

    // D8: fail-closed tenant visibility for task-linked callback intake. Runs
    // before payload validation / ActivityEvent mapping so a denied request
    // appends no task activity of any kind; provider callback auth still applies
    // afterwards for admitted requests. Unlinked operational jobs are visible.
    if (options?.authorizeJob && !(await options.authorizeJob(req, jobId))) {
      return res.status(404).json(
        toPublicCallbackErrorBody({
          code: 'unknown_job',
          message: 'Unknown swarm job',
          issues: [{ path: 'jobId', code: 'unknown_job', message: 'No job found for id' }],
        }),
      );
    }

    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body
      : {}) as Record<string, unknown>;

    // D9: the URL :id is authoritative. A non-empty body jobId that targets a
    // different job than the authorized URL :id is rejected (400) before intake
    // so no ActivityEvent of any kind is mapped or appended. This runs after the
    // D8 tenant-visibility gate, so an unknown/out-of-scope URL :id still fails
    // closed to 404 without inspecting the body. Every surface (canonical
    // callbacks/:event + plan/progress/blocker aliases) routes through handle().
    const bodyJobId = typeof body.jobId === 'string' ? body.jobId.trim() : '';
    if (bodyJobId && bodyJobId !== jobId) {
      return res.status(400).json(
        toPublicCallbackErrorBody({
          code: 'job_id_mismatch',
          message: 'body jobId must match the URL job id',
          issues: [
            { path: 'jobId', code: 'job_id_mismatch', message: 'body jobId must match the URL job id' },
          ],
        }),
      );
    }

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
