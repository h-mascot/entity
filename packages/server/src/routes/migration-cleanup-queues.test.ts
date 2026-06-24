import express from 'express';
import http from 'http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMigrationCleanupQueueRouter } from './migration-cleanup-queues';
import type {
  ApplyMigrationCleanupCorrectionInput,
  ApplyMigrationCleanupCorrectionResult,
  MigrationCleanupQueueReport,
} from '../../../db/src';

let server: http.Server | null = null;
let baseUrl = '';

async function readJson(response: Response): Promise<any> {
  return response.json();
}

async function startServer(deps: Parameters<typeof createMigrationCleanupQueueRouter>[0]) {
  const app = express();
  app.use(express.json());
  app.use('/api/migration-cleanup-queues', createMigrationCleanupQueueRouter(deps));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('test server failed to bind');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
}

describe('migration cleanup queue route', () => {
  beforeEach(async () => {
    const report: MigrationCleanupQueueReport = {
      generatedAt: '2026-06-24T16:13:30.000Z',
      totalItems: 1,
      openItems: 1,
      correctedItems: 0,
      queues: [{ code: 'missing_owner', count: 1, open: 1, corrected: 0, severity: 'blocking_for_execution' }],
      items: [{
        id: 'task:42:missing_owner:owner_principal_id',
        code: 'missing_owner',
        severity: 'blocking_for_execution',
        object_type: 'task',
        object_id: '42',
        task_id: 42,
        activity_id: null,
        title: 'Legacy task',
        message: 'Task owner is missing, unknown, or still marked as a legacy placeholder.',
        source: 'tasks.owner_principal_id',
        field_name: 'owner_principal_id',
        current_value: 'legacy-owner',
        status: 'open',
        correction: null,
        old_task_visible: true,
      }],
      rollbackNotes: ['fake route report'],
      markdown: '# fake',
    };
    await startServer({
      buildQueues: () => report,
      applyCorrection: (input: ApplyMigrationCleanupCorrectionInput): ApplyMigrationCleanupCorrectionResult => ({
        task_id: input.task_id,
        correction: {
          version: 'THE-89',
          code: input.code,
          field_name: input.field_name,
          previous_value: 'legacy-owner',
          corrected_value: input.corrected_value,
          corrected_by_principal_id: input.corrected_by_principal_id,
          corrected_at: '2026-06-24T16:20:00.000Z',
          note: input.note ?? null,
          authoritative: true,
        },
        task: {
          id: input.task_id,
          name: 'Legacy task',
          description: null,
          brief: null,
          origin_channel: null,
          column: 'todo',
          model: null,
          archived: false,
          assignee: 'Unassigned',
          blocked: false,
          blocker_reason: null,
          due_date: null,
          priority: 'P2',
          estimate_hours: null,
          time_spent: 0,
          output: null,
          progress_status: 'backlog',
          recurring: false,
          recurring_config: null,
          created_at: '2026-06-24T16:13:30.000Z',
          updated_at: '2026-06-24T16:20:00.000Z',
          metadata: '{}',
          owner_principal_id: String(input.corrected_value),
          owner_principal_type: 'human',
        },
      }),
    });
  });

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => error ? reject(error) : resolve());
    });
    server = null;
  });

  it('lists cleanup queue items without hiding old task visibility state', async () => {
    const response = await fetch(`${baseUrl}/api/migration-cleanup-queues`);
    expect(response.status).toBe(200);

    const body = await readJson(response);
    expect(body.phase2_flags).toMatchObject({
      migration_enforcement: {
        key: 'migration_enforcement',
        enabled: false,
        stage: 'observation_only',
      },
      old_tasks_remain_visible: true,
    });
    expect(body.items).toEqual([
      expect.objectContaining({
        code: 'missing_owner',
        status: 'open',
        old_task_visible: true,
      }),
    ]);
  });

  it('accepts human cleanup corrections through the API', async () => {
    const response = await fetch(`${baseUrl}/api/migration-cleanup-queues/tasks/42/corrections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: 'missing_owner',
        field_name: 'owner_principal_id',
        corrected_value: 'human-owner',
        corrected_by_principal_id: 'reviewer-1',
        note: 'Owner confirmed.',
      }),
    });
    expect(response.status).toBe(200);

    const body = await readJson(response);
    expect(body.correction).toMatchObject({
      version: 'THE-89',
      code: 'missing_owner',
      field_name: 'owner_principal_id',
      corrected_value: 'human-owner',
      corrected_by_principal_id: 'reviewer-1',
      authoritative: true,
    });
    expect(body.task).toMatchObject({
      id: 42,
      owner_principal_id: 'human-owner',
    });
  });
});
