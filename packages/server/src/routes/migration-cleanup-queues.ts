import { Router, type Request } from 'express';
import {
  applyMigrationCleanupCorrectionForPhase2,
  buildMigrationCleanupQueuesForPhase2,
  type ApplyMigrationCleanupCorrectionInput,
  type ApplyMigrationCleanupCorrectionResult,
  type MigrationCleanupQueueOptions,
  type MigrationCleanupQueueReport,
} from '../../../db/src';

export interface MigrationCleanupQueueRouterDependencies {
  buildQueues?: (options?: MigrationCleanupQueueOptions) => MigrationCleanupQueueReport;
  applyCorrection?: (input: ApplyMigrationCleanupCorrectionInput) => ApplyMigrationCleanupCorrectionResult;
}

function parsePositiveLimit(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('limit must be a positive integer');
  }
  return parsed;
}

function parseBooleanQuery(value: unknown): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

function readBody(req: Request): Record<string, unknown> {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : {};
}

function readBodyString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function createMigrationCleanupQueueRouter(
  dependencies: MigrationCleanupQueueRouterDependencies = {},
): Router {
  const router = Router();
  const buildQueues = dependencies.buildQueues ?? buildMigrationCleanupQueuesForPhase2;
  const applyCorrection = dependencies.applyCorrection ?? applyMigrationCleanupCorrectionForPhase2;

  router.get('/', (req, res) => {
    try {
      const report = buildQueues({
        limit: parsePositiveLimit(req.query.limit),
        includeCorrected: parseBooleanQuery(req.query.include_corrected ?? req.query.includeCorrected),
      });
      return res.json(report);
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to build cleanup queues' });
    }
  });

  router.post('/tasks/:taskId/corrections', (req, res) => {
    try {
      const taskId = Number(req.params.taskId);
      if (!Number.isInteger(taskId) || taskId <= 0) {
        return res.status(400).json({ error: 'task id must be a positive integer' });
      }
      const body = readBody(req);
      const code = readBodyString(body, 'code');
      const fieldName = readBodyString(body, 'field_name') ?? readBodyString(body, 'fieldName');
      const correctedBy = readBodyString(body, 'corrected_by_principal_id') ?? readBodyString(body, 'correctedByPrincipalId');
      if (!code || !fieldName || !correctedBy) {
        return res.status(400).json({ error: 'code, field_name, and corrected_by_principal_id are required' });
      }
      const result = applyCorrection({
        task_id: taskId,
        code: code as ApplyMigrationCleanupCorrectionInput['code'],
        field_name: fieldName as ApplyMigrationCleanupCorrectionInput['field_name'],
        corrected_value: body.corrected_value as ApplyMigrationCleanupCorrectionInput['corrected_value'],
        corrected_by_principal_id: correctedBy,
        note: readBodyString(body, 'note') ?? null,
      });
      return res.json(result);
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to apply cleanup correction' });
    }
  });

  return router;
}
