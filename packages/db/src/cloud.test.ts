import { describe, expect, it } from 'vitest';
import { createCloudTaskAdapter } from './cloud';

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
});
