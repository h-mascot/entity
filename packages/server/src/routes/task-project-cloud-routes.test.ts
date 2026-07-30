import express from 'express';
import http from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerStrategicRoutes } from './tasks';

interface Project {
  id: number;
  name: string;
}

describe('task project routes in CLOUD mode', () => {
  let baseUrl = '';
  let server: http.Server;
  let projectIds = [9, 3];
  const updates: number[][] = [];
  const projectsById = new Map<number, Project>([
    [3, { id: 3, name: 'Alpha secondary' }],
    [5, { id: 5, name: 'Bravo secondary' }],
    [9, { id: 9, name: 'Zulu primary' }],
  ]);

  const readTask = () => ({
    id: 42,
    name: 'Cloud task',
    project_id: projectIds[0] ?? null,
    projects: projectIds.map((projectId) => projectsById.get(projectId)),
  });

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    const cloudBackend = {
      getTask: async () => readTask(),
      updateTask: async (_taskId: number, input: { projectIds?: number[] }) => {
        projectIds = [...(input.projectIds ?? projectIds)];
        updates.push([...projectIds]);
        return readTask();
      },
    };
    registerStrategicRoutes(app, '/api', {
      registerCrewRoutes: () => undefined,
      parseTaskId: (value: unknown) => {
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
      },
      parsePositiveId: (value: unknown) => {
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
      },
      parsePositiveIdList: (value: unknown) =>
        Array.isArray(value) &&
        value.every((entry) => Number.isInteger(entry) && entry > 0)
          ? value
          : null,
      statusForStrategicError: () => 400,
      taskSyncLayer: {
        getMode: () => 'CLOUD',
        getActiveAdapter: () => cloudBackend,
        getTask: async () => {
          throw new Error('route must use its pinned backend');
        },
        updateTask: async () => {
          throw new Error('route must use its pinned backend');
        },
      },
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

  it('routes add and removal through CLOUD while preserving the primary project', async () => {
    const addResponse = await fetch(`${baseUrl}/api/tasks/42/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project_id: 5 }),
    });
    expect(addResponse.status).toBe(201);
    expect(updates[updates.length - 1]).toEqual([9, 3, 5]);

    const removeResponse = await fetch(`${baseUrl}/api/tasks/42/projects`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project_id: 3 }),
    });
    expect(removeResponse.status).toBe(200);
    expect(updates[updates.length - 1]).toEqual([9, 5]);
  });

  it('routes explicit empty replacement through CLOUD', async () => {
    const response = await fetch(`${baseUrl}/api/tasks/42/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectIds: [] }),
    });
    expect(response.status).toBe(200);
    expect(updates[updates.length - 1]).toEqual([]);
    expect(await response.json()).toEqual([]);
  });
});
