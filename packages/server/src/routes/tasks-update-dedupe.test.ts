import express from 'express';
import http from 'http';
import { describe, expect, it, vi } from 'vitest';
import {
  hasAssignedOwner,
  isActiveTaskColumn,
  shouldValidateReviewEntryOnTransition,
} from '../agent/review-policy';
import { parseTaskAccountabilityUpdates } from '../task-accountability';
import {
  isValidTaskColumn,
  normalizeBlockedInput,
  normalizeBlockerReasonInput,
  parsePositiveIdList,
  parseTaskId,
  readParentTaskId,
} from './task-helpers';
import { registerTaskRoutes } from './tasks';

const existingTask = {
  id: 1456,
  name: 'Publish Entity data readiness report',
  description: null,
  column: 'todo',
  assignee: 'geordi',
  executor_principal_id: null,
  taskmaster_drivable: false,
  owner_principal_type: null,
  metadata: null,
  progress_status: 'Queued',
  blocked: false,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};

const fuzzyMatch = {
  task: {
    ...existingTask,
    id: 1451,
    name: 'Publish Entity book readiness report',
  },
  score: 0.775,
  exact: false,
  normalizedTitle: 'publish entity book readiness report',
};

function buildApp() {
  const updates: Array<Record<string, unknown>> = [];
  const findTaskDuplicateCandidates = vi.fn(() => [fuzzyMatch]);
  const app = express();
  app.use(express.json());
  registerTaskRoutes(app, '/api', {
    AGENT_CONFIG: { enabled: false },
    broadcast: () => undefined,
    buildTaskMutationActivityEvent: () => ({ eventType: 'task.updated', payload: {} }),
    capitalizeColumn: (value: string) => value,
    findTaskDuplicateCandidates,
    getTaskActorFromRequest: () => 'test-actor',
    hasAssignedOwner,
    isActiveTaskColumn,
    isValidTaskColumn,
    logActivity: () => undefined,
    normalizeBlockedInput,
    normalizeBlockerReasonInput,
    normalizeTaskOutputLinks: () => undefined,
    parsePositiveIdList,
    parseTaskAccountabilityForCreate: () => ({}),
    parseTaskAccountabilityUpdates,
    parseTaskId,
    phase2FlagEnabled: () => false,
    phase2Flags: {},
    pluginHooks: { emit: async () => undefined },
    readParentTaskId,
    shouldValidateReviewEntryOnTransition,
    taskAgent: {},
    taskSyncLayer: {
      getTask: async () => existingTask,
      listTasks: async () => [existingTask, fuzzyMatch.task],
      updateTask: async (_id: number, taskUpdates: Record<string, unknown>) => {
        updates.push(taskUpdates);
        return { ...existingTask, ...taskUpdates };
      },
    },
    validateTaskAccountability: () => ({ ok: true }),
    withReceiptArtifactRef: (payload: unknown) => payload,
  });
  return { app, updates, findTaskDuplicateCandidates };
}

async function requestTask(
  app: express.Express,
  method: 'PUT' | 'PATCH',
  body: Record<string, unknown>,
) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server failed to bind');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/tasks/1456`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, json: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe.each(['PUT', 'PATCH'] as const)('%s /api/tasks/:id title dedupe', (method) => {
  it('allows a state-only update despite an existing fuzzy title match', async () => {
    const fixture = buildApp();
    const body = method === 'PATCH'
      ? { progress_status: 'Report assembled' }
      : { column: 'todo', metadata: '{"receipt":"ready"}' };

    const response = await requestTask(fixture.app, method, body);

    expect(response.status).toBe(200);
    expect(fixture.updates).toEqual([expect.objectContaining(body)]);
    expect(fixture.findTaskDuplicateCandidates).not.toHaveBeenCalled();
  });

  it('still rejects a changed title with a fuzzy duplicate candidate', async () => {
    const fixture = buildApp();

    const response = await requestTask(fixture.app, method, {
      name: 'Publish the Entity readiness report',
    });

    expect(response.status).toBe(409);
    expect(response.json).toEqual(expect.objectContaining({
      error: 'Potential duplicate tasks found',
      duplicateType: 'fuzzy',
    }));
    expect(fixture.updates).toEqual([]);
    expect(fixture.findTaskDuplicateCandidates).toHaveBeenCalledOnce();
  });

  it('allows an explicitly submitted normalized-equivalent title', async () => {
    const fixture = buildApp();

    const response = await requestTask(fixture.app, method, {
      name: '  PUBLISH ENTITY DATA READINESS REPORT!  ',
      progress_status: 'Still in progress',
    });

    expect(response.status).toBe(200);
    expect(fixture.updates).toHaveLength(1);
    expect(fixture.findTaskDuplicateCandidates).not.toHaveBeenCalled();
  });
});
