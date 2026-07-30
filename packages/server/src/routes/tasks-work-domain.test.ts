import express from 'express';
import http from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deriveTaskWorkDomain,
  taskHasProjectName,
} from '../task-projects';
import { registerTaskRoutes } from './tasks';

const tasks = [
  {
    id: 1,
    name: 'Primary engineering',
    column: 'todo',
    org_id: 'org-a',
    team_id: 'team-a',
    project_id: 11,
    projects: [
      {
        id: 11,
        name: 'Entity Engineering',
        org_id: 'org-a',
        team_id: 'team-a',
        work_domain: 'engineering',
      },
    ],
  },
  {
    id: 2,
    name: 'Secondary engineering tag',
    column: 'todo',
    org_id: 'org-a',
    team_id: 'team-a',
    project_id: 12,
    projects: [
      {
        id: 12,
        name: 'Business',
        org_id: 'org-a',
        team_id: 'team-a',
        work_domain: 'general',
      },
      {
        id: 11,
        name: 'Entity Engineering',
        org_id: 'org-a',
        team_id: 'team-a',
        work_domain: 'engineering',
      },
    ],
  },
  {
    id: 3,
    name: 'Unclassified',
    column: 'todo',
    org_id: 'org-a',
    team_id: 'team-a',
    project_id: 13,
    projects: [
      {
        id: 13,
        name: 'Legacy',
        org_id: 'org-a',
        team_id: 'team-a',
        work_domain: null,
      },
    ],
  },
  {
    id: 4,
    name: 'Missing primary',
    column: 'todo',
    org_id: 'org-a',
    team_id: 'team-a',
    project_id: null,
    projects: [],
  },
  {
    id: 5,
    name: 'Cloud-shaped platform task',
    column: 'todo',
    org_id: 'org-a',
    team_id: 'team-a',
    project_id: 15,
    projects: [
      {
        id: 15,
        name: 'Platform',
        work_domain: 'platform',
      },
    ],
  },
];

async function readJson(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>;
}

describe('task list work-domain API', () => {
  let baseUrl = '';
  let server: http.Server;

  beforeAll(async () => {
    const app = express();
    registerTaskRoutes(app, '/api', {
      taskSyncLayer: {
        listTasks: async () => tasks,
      },
      parseTaskPaginationQuery: () => ({ limit: null, offset: 0 }),
      taskHasProjectName,
      deriveTaskWorkDomain,
      enrichTasksWithSubtaskSummary: (entries: unknown[]) => entries,
      paginateTasks: (entries: unknown[]) => entries,
      buildTaskPaginationMeta: (total: number) => ({ total }),
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('test server failed to bind');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it('filters by the primary project work domain and returns derived state', async () => {
    const response = await fetch(`${baseUrl}/api/tasks?work_domain=engineering`);
    expect(response.status).toBe(200);
    const body = await readJson(response);

    expect(body.total).toBe(1);
    expect(body.tasks).toEqual([
      expect.objectContaining({
        id: 1,
        work_domain: 'engineering',
        work_domain_state: 'resolved',
      }),
    ]);
  });

  it('keeps unclassified and missing primary-project states visible without a filter', async () => {
    const response = await fetch(`${baseUrl}/api/tasks`);
    expect(response.status).toBe(200);
    const body = await readJson(response);

    expect(body.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 3,
          work_domain: null,
          work_domain_state: 'unclassified_project',
        }),
        expect.objectContaining({
          id: 4,
          work_domain: null,
          work_domain_state: 'missing_primary_project',
        }),
      ]),
    );
  });

  it('includes a cloud-shaped primary project when nested scope fields are omitted', async () => {
    const response = await fetch(`${baseUrl}/api/tasks?work_domain=platform`);
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({
      total: 1,
      tasks: [
        {
          id: 5,
          work_domain: 'platform',
          work_domain_state: 'resolved',
        },
      ],
    });
  });

  it('returns no tasks for an unknown normalized domain', async () => {
    const response = await fetch(`${baseUrl}/api/tasks?work_domain=does-not-exist`);
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({
      total: 0,
      tasks: [],
    });
  });

  it('rejects a malformed domain filter instead of silently broadening results', async () => {
    const response = await fetch(`${baseUrl}/api/tasks?work_domain=Engineering`);
    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({
      error: 'work_domain must be a normalized lowercase slug (1-64 characters)',
    });
  });
});
