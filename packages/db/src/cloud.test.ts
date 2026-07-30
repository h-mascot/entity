import { describe, expect, it } from 'vitest';
import { createCloudTaskAdapter } from './cloud';
import { createTaskSyncLayer } from './task-sync';

describe('cloud task project normalization', () => {
  it('preserves lifecycle and nullable classification fields from cloud project payloads', async () => {
    const adapter = createCloudTaskAdapter({
      baseUrl: 'https://entity.example.test',
      fetchImpl: async () =>
        new Response(
          JSON.stringify([
            {
              id: 1,
              name: 'Cloud task',
              projects: [
                {
                  id: 10,
                  org_id: 'org-a',
                  team_id: 'team-a',
                  name: 'Cloud Engineering',
                  color: '#123456',
                  lifecycle_state: 'review',
                  project_key: 'cloud-engineering',
                  work_domain: 'engineering',
                  created_at: '2026-07-30T00:00:00.000Z',
                },
                {
                  id: 11,
                  name: 'Unclassified cloud project',
                  project_key: null,
                  work_domain: null,
                  created_at: '2026-07-30T00:00:00.000Z',
                },
              ],
              created_at: '2026-07-30T00:00:00.000Z',
              updated_at: '2026-07-30T00:00:00.000Z',
            },
          ]),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
    });

    const [task] = await adapter.listTasks();

    expect(task.projects).toEqual([
      expect.objectContaining({
        id: 10,
        lifecycle_state: 'review',
        project_key: 'cloud-engineering',
        work_domain: 'engineering',
      }),
      expect.objectContaining({
        id: 11,
        lifecycle_state: 'active',
        project_key: null,
        work_domain: null,
      }),
    ]);
  });

  it('forwards non-empty and empty projectIds to the cloud mutation backend', async () => {
    const requests: Array<{ method: string; body: Record<string, unknown> }> = [];
    const adapter = createCloudTaskAdapter({
      baseUrl: 'https://entity.example.test',
      fetchImpl: async (_input, init) => {
        requests.push({
          method: init?.method ?? 'GET',
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : {},
        });
        return new Response(
          JSON.stringify({
            id: 41,
            name: 'Cloud project mutation',
            column: 'todo',
            created_at: '2026-07-30T00:00:00.000Z',
            updated_at: '2026-07-30T00:00:00.000Z',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      },
    });

    await adapter.createTask({
      name: 'Cloud project mutation',
      projectIds: [10, 11],
    });
    await adapter.updateTask(41, { projectIds: [] });

    expect(requests).toEqual([
      {
        method: 'POST',
        body: expect.objectContaining({ projectIds: [10, 11] }),
      },
      {
        method: 'PUT',
        body: expect.objectContaining({ projectIds: [] }),
      },
    ]);
  });

  it('pins one backend adapter even when runtime mode changes mid-request', () => {
    const layer = createTaskSyncLayer({
      mode: 'CLOUD',
      cloudBaseUrl: 'https://entity.example.test',
      cloud: {
        fetchImpl: async () => new Response('{}', { status: 200 }),
      },
    });

    const pinnedBackend = layer.getActiveAdapter?.();
    expect(pinnedBackend?.mode).toBe('CLOUD');

    layer.setMode('LOCAL');
    expect(layer.getActiveAdapter?.().mode).toBe('LOCAL');
    expect(pinnedBackend?.mode).toBe('CLOUD');
  });
});
