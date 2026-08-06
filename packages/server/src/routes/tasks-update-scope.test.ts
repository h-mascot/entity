import express from 'express';
import http from 'http';
import { describe, expect, it } from 'vitest';
import {
  buildCustomerPrincipalContext,
  type CustomerPrincipalContext,
} from '../principals/request-context';
import {
  isValidTaskColumn,
  normalizeBlockedInput,
  normalizeBlockerReasonInput,
  parsePositiveIdList,
  parseTaskId,
  readParentTaskId,
} from './task-helpers';
import { parseTaskAccountabilityUpdates } from '../task-accountability';
import {
  hasAssignedOwner,
  isActiveTaskColumn,
  shouldValidateReviewEntryOnTransition,
} from '../agent/review-policy';
import { registerTaskRoutes } from './tasks';

/**
 * D-R2 route proof: a PUT/PATCH task update must authorize the PROPOSED durable
 * scope, not only the existing task scope. A caller scoped to project A must
 * not relink or expand the task into project B by supplying `projectIds`.
 *
 * The existing-scope check (authorizeTaskOrg at the top of the handler) is kept;
 * this guards the additional surface opened by `projectIds`.
 */

function projectScopedContributor(
  principalId: string,
  projectId: number,
): CustomerPrincipalContext {
  return buildCustomerPrincipalContext({
    principalId,
    principalType: 'human',
    permission: {
      principal_id: principalId,
      grants: [{ role: 'contributor', org_id: 'org-acme', project_id: projectId }],
    },
  });
}

function multiProjectContributor(
  principalId: string,
  projectIds: number[],
): CustomerPrincipalContext {
  return buildCustomerPrincipalContext({
    principalId,
    principalType: 'human',
    permission: {
      principal_id: principalId,
      grants: projectIds.map((projectId) => ({
        role: 'contributor',
        org_id: 'org-acme',
        project_id: projectId,
      })),
    },
  });
}

interface UpdateRecorder {
  updates: Array<{ id: number; updates: Record<string, unknown> }>;
}

function buildApp(recorder: UpdateRecorder, existingTask: Record<string, unknown>) {
  const app = express();
  app.use(express.json());

  const principals: Record<string, CustomerPrincipalContext> = {
    'p-proj-a': projectScopedContributor('p-proj-a', 1),
    'p-both': multiProjectContributor('p-both', [1, 2]),
  };
  // Attach a customer principal context from a test header so the request is
  // treated as a scoped customer (not a trusted service context).
  app.use((req, _res, next) => {
    const principalId = req.header('x-test-principal');
    if (typeof principalId === 'string' && principals[principalId]) {
      (req as unknown as { entityCustomerPrincipal?: CustomerPrincipalContext }).entityCustomerPrincipal =
        principals[principalId];
    }
    next();
  });

  registerTaskRoutes(app, '/api', {
    AGENT_CONFIG: { enabled: false },
    broadcast: () => undefined,
    buildTaskMutationActivityEvent: () => ({ eventType: 'task.updated', payload: {} }),
    capitalizeColumn: (value: string) => value,
    findTaskDuplicateCandidates: () => [],
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
      getTask: async (_id: number) => existingTask,
      listTasks: async () => [],
      updateTask: async (id: number, updates: Record<string, unknown>) => {
        recorder.updates.push({ id, updates });
        return { ...existingTask, ...updates } as Record<string, unknown>;
      },
    },
    validateTaskAccountability: () => ({ ok: true }),
    withReceiptArtifactRef: (payload: unknown) => payload,
  });

  return app;
}

function projectAExistingTask(): Record<string, unknown> {
  return {
    id: 7,
    org_id: 'org-acme',
    team_id: 'org-acme-eng',
    project_id: 1,
    projects: [{ id: 1 }],
    name: 'Ship release guardrails',
    column: 'todo',
    assignee: null,
    executor_principal_id: null,
    taskmaster_drivable: false,
    owner_principal_type: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

async function startServer(app: express.Express): Promise<http.Server> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return server;
}

function portOf(server: http.Server): number {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('task update scope test server failed to bind');
  }
  return address.port;
}

async function putTask(
  port: number,
  principal: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}/api/tasks/7`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-test-principal': principal,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => undefined) };
}

describe('PUT /api/tasks/:id authorizes the proposed project scope (D-R2)', () => {
  it('denies a project-A caller from relinking a task into project B', async () => {
    const recorder: UpdateRecorder = { updates: [] };
    const app = buildApp(recorder, projectAExistingTask());
    const server = await startServer(app);
    try {
      const { status, json } = await putTask(server ? portOf(server) : 0, 'p-proj-a', {
        projectIds: [2],
      });
      // Effective role for project 2 is 'none' -> denied (no leak of existence).
      expect(status).toBe(404);
      expect((json as { error?: string })?.error).toBe('task not found');
      // The durable writer was never invoked: no relink/expand happened.
      expect(recorder.updates).toEqual([]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it('allows relinking within the granted project scope', async () => {
    const recorder: UpdateRecorder = { updates: [] };
    const app = buildApp(recorder, projectAExistingTask());
    const server = await startServer(app);
    try {
      const { status } = await putTask(portOf(server), 'p-proj-a', {
        projectIds: [1],
      });
      expect(status).toBe(200);
      expect(recorder.updates).toEqual([
        expect.objectContaining({ id: 7, updates: expect.objectContaining({ projectIds: [1] }) }),
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it('preserves existing scope authorization when projectIds is omitted', async () => {
    const recorder: UpdateRecorder = { updates: [] };
    const app = buildApp(recorder, projectAExistingTask());
    const server = await startServer(app);
    try {
      const { status } = await putTask(portOf(server), 'p-proj-a', {
        name: 'Ship release guardrails (revised)',
      });
      expect(status).toBe(200);
      expect(recorder.updates).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it('allows multi-project relink only when every requested project is granted', async () => {
    const recorder: UpdateRecorder = { updates: [] };
    const app = buildApp(recorder, projectAExistingTask());
    const server = await startServer(app);
    try {
      // p-proj-a has no grant for project 2 -> denied.
      const denied = await putTask(portOf(server), 'p-proj-a', { projectIds: [1, 2] });
      expect(denied.status).toBe(404);
      expect(recorder.updates).toEqual([]);

      // p-both holds a contributor grant for both projects -> allowed.
      const allowed = await putTask(portOf(server), 'p-both', { projectIds: [1, 2] });
      expect(allowed.status).toBe(200);
      expect(recorder.updates).toEqual([
        expect.objectContaining({ id: 7, updates: expect.objectContaining({ projectIds: [1, 2] }) }),
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
