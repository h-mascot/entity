import express from 'express';
import http from 'http';
import { describe, expect, it } from 'vitest';
import type { OrgRecord, ProjectRecord, TaskRecord, TeamRecord, WorkspaceScopeRepository } from '../../../db/src';
import {
  parseTaskCreateScope,
  registerTaskRoutes,
  scopeTasksForCreateDedupe,
  validateTaskCreateScope,
} from './tasks';

function task(id: number, orgId: string, teamId: string, name = 'Define release guardrails'): TaskRecord {
  return {
    id,
    org_id: orgId,
    team_id: teamId,
    name,
  } as TaskRecord;
}

describe('task create scope', () => {
  it('preserves onboarding org, team, and primary project scope', () => {
    expect(parseTaskCreateScope({
      org_id: 'org-a',
      team_id: 'org-a-engineering-devops',
      project_id: 42,
    })).toEqual({
      org_id: 'org-a',
      team_id: 'org-a-engineering-devops',
      project_id: 42,
    });
  });

  it('rejects malformed scope instead of silently writing to defaults', () => {
    expect(parseTaskCreateScope({ org_id: '   ' })).toEqual({
      error: 'org_id must be a non-empty string',
    });
    expect(parseTaskCreateScope({ project_id: 0 })).toEqual({
      error: 'project_id must be a positive integer',
    });
  });

  it('limits duplicate candidates to the requested org and team', () => {
    const tasks = [
      task(1, 'org-a', 'org-a-product'),
      task(2, 'org-b', 'org-b-product'),
      task(3, 'org-a', 'org-a-finance'),
    ];

    expect(scopeTasksForCreateDedupe(tasks, {
      org_id: 'org-a',
      team_id: 'org-a-product',
    }).map((entry) => entry.id)).toEqual([1]);
    expect(scopeTasksForCreateDedupe(tasks, {})).toEqual(tasks);
  });

  it('rejects team and project scope outside the requested org hierarchy', () => {
    const org = { id: 'org-a' } as OrgRecord;
    const team = { id: 'org-a-product', org_id: 'org-a' } as TeamRecord;
    const project = {
      id: 42,
      org_id: 'org-a',
      team_id: 'org-a-product',
    } as ProjectRecord;
    const workspaceRepo = {
      getOrg: (orgId: string) => orgId === org.id ? org : undefined,
      getTeam: (context: { orgId: string }, teamId: string) =>
        context.orgId === org.id && teamId === team.id ? team : undefined,
      getProject: (context: { orgId: string; teamId?: string }, projectId: number) =>
        context.orgId === org.id
        && context.teamId === project.team_id
        && projectId === project.id
          ? project
          : undefined,
    } as Pick<WorkspaceScopeRepository, 'getOrg' | 'getTeam' | 'getProject'>;

    expect(validateTaskCreateScope({
      org_id: 'org-a',
      team_id: 'org-a-product',
      project_id: 42,
    }, workspaceRepo)).toEqual({ ok: true });
    expect(validateTaskCreateScope({
      org_id: 'org-a',
    }, workspaceRepo)).toEqual({
      ok: false,
      statusCode: 400,
      error: 'team_id is required when org_id is provided',
    });
    expect(validateTaskCreateScope({
      org_id: 'org-a',
      project_id: 42,
    }, workspaceRepo)).toEqual({
      ok: false,
      statusCode: 400,
      error: 'team_id is required when org_id is provided',
    });
    expect(validateTaskCreateScope({
      org_id: 'org-b',
      team_id: 'org-a-product',
      project_id: 42,
    }, workspaceRepo)).toEqual({
      ok: false,
      statusCode: 404,
      error: 'org org-b not found',
    });
    expect(validateTaskCreateScope({
      org_id: 'org-a',
      team_id: 'org-a-finance',
      project_id: 42,
    }, workspaceRepo)).toEqual({
      ok: false,
      statusCode: 404,
      error: 'team org-a-finance not found in org org-a',
    });
  });

  it('forwards validated scope through the HTTP create route used by the cloud adapter', async () => {
    const created: Array<Record<string, unknown>> = [];
    const app = express();
    app.use(express.json());
    registerTaskRoutes(app, '/api', {
      AGENT_CONFIG: { enabled: false },
      broadcast: () => undefined,
      buildTaskMutationActivityEvent: () => ({ eventType: 'task.created', payload: {} }),
      capitalizeColumn: (value: string) => value,
      findTaskDuplicateCandidates: () => [],
      getTaskActorFromRequest: () => 'test-actor',
      logActivity: () => undefined,
      normalizeBlockedInput: () => undefined,
      normalizeBlockerReasonInput: () => null,
      normalizeTaskOutputLinks: () => undefined,
      parseTaskAccountabilityForCreate: () => ({}),
      pluginHooks: { emit: async () => undefined },
      registerCrewRoutes: () => undefined,
      taskSyncLayer: {
        listTasks: async () => [],
        createTask: async (input: Record<string, unknown>) => {
          created.push(input);
          return {
            id: 1,
            name: input.name,
            column: input.column ?? 'todo',
            assignee: null,
            ...input,
          };
        },
      },
      validateTaskAccountability: () => ({ ok: true }),
      workspaceRepo: {
        getOrg: (orgId: string) => orgId === 'org-a' ? ({ id: orgId } as OrgRecord) : undefined,
        getTeam: (context: { orgId: string }, teamId: string) =>
          context.orgId === 'org-a' && teamId === 'org-a-product'
            ? ({ id: teamId, org_id: context.orgId } as TeamRecord)
            : undefined,
        getProject: (context: { orgId: string; teamId?: string }, projectId: number) =>
          context.orgId === 'org-a' && context.teamId === 'org-a-product' && projectId === 42
            ? ({ id: projectId, org_id: context.orgId, team_id: context.teamId } as ProjectRecord)
            : undefined,
      },
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('task scope test server failed to bind');

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/tasks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Scoped cloud seed',
          org_id: 'org-a',
          team_id: 'org-a-product',
          project_id: 42,
        }),
      });
      expect(response.status).toBe(201);
      expect(created).toEqual([
        expect.objectContaining({
          org_id: 'org-a',
          team_id: 'org-a-product',
          project_id: 42,
        }),
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
