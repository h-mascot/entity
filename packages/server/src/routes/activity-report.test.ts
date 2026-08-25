import express from 'express';
import http from 'http';
import { describe, expect, it, vi } from 'vitest';
import { registerActivityRoutes } from './runtime';

function createFakeActivityRepository() {
  const listActivities = vi.fn().mockReturnValue([{ id: 1, action: 'task.created' }]);
  const listActivitiesFiltered = vi.fn().mockReturnValue({
    activities: [{ id: 2, action: 'file.edited' }],
    total: 42,
  });
  const getActivityReport = vi.fn().mockReturnValue({
    totals: { count: 42 },
    byAction: [{ action: 'task.created', count: 20 }],
    byActor: [{ actor: 'Ada', count: 22 }],
    byDay: [{ day: '2026-08-25', count: 42 }],
    bySource: [{ source: 'task', count: 30 }],
    byType: [{ type: 'task_created', count: 20 }],
  });
  return { listActivities, listActivitiesFiltered, getActivityReport };
}

async function withActivityServer(
  activityRepository: ReturnType<typeof createFakeActivityRepository>,
  run: (baseUrl: string) => Promise<void>
): Promise<void> {
  const app = express();
  registerActivityRoutes(app, '/api', { activityRepository });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server failed to bind');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

describe('activity routes (MC #1369)', () => {
  it('keeps the legacy shape for bare limit-only requests', async () => {
    const repo = createFakeActivityRepository();
    await withActivityServer(repo, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/activities?limit=5`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toEqual({ activities: [{ id: 1, action: 'task.created' }] });
      expect(repo.listActivities).toHaveBeenCalledWith(5);
      expect(repo.listActivitiesFiltered).not.toHaveBeenCalled();
    });
  });

  it('uses the filtered listing when any filter param is present', async () => {
    const repo = createFakeActivityRepository();
    await withActivityServer(repo, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/activities?orgId=org-a&teamId=team-1&actor=Ada&source=task&type=task_created&taskId=1362&from=2026-08-01&to=2026-08-25&limit=10&offset=20`
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        activities: [{ id: 2, action: 'file.edited' }],
        total: 42,
      });
      expect(repo.listActivitiesFiltered).toHaveBeenCalledWith({
        orgId: 'org-a',
        teamId: 'team-1',
        actor: 'Ada',
        source: 'task',
        type: 'task_created',
        taskId: 1362,
        from: '2026-08-01',
        to: '2026-08-25',
        limit: 10,
        offset: 20,
      });
      expect(repo.listActivities).not.toHaveBeenCalled();
    });
  });

  it('uses the filtered listing for pagination even without a scope filter', async () => {
    const repo = createFakeActivityRepository();
    await withActivityServer(repo, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/activities?limit=5&offset=0`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        activities: [{ id: 2, action: 'file.edited' }],
        total: 42,
      });
      expect(repo.listActivitiesFiltered).toHaveBeenCalledWith({ limit: 5, offset: 0 });
      expect(repo.listActivities).not.toHaveBeenCalled();
    });
  });

  it('treats empty-string filter params as absent for back-compat', async () => {
    const repo = createFakeActivityRepository();
    await withActivityServer(repo, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/activities?orgId=&limit=7`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toEqual({ activities: [{ id: 1, action: 'task.created' }] });
      expect(repo.listActivities).toHaveBeenCalledWith(7);
    });
  });

  it('returns 500 when the repository throws during a filtered listing', async () => {
    const repo = createFakeActivityRepository();
    repo.listActivitiesFiltered.mockImplementation(() => {
      throw new Error('database unavailable');
    });
    await withActivityServer(repo, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/activities?actor=Ada`);
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ error: 'database unavailable' });
    });
  });

  it('exposes the aggregated report with the same filters', async () => {
    const repo = createFakeActivityRepository();
    await withActivityServer(repo, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/activity-report?orgId=org-a&actor=Ada&from=2026-08-01&to=2026-08-25&limit=10&offset=0`
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        totals: { count: 42 },
        byAction: [{ action: 'task.created', count: 20 }],
        byActor: [{ actor: 'Ada', count: 22 }],
        byDay: [{ day: '2026-08-25', count: 42 }],
        bySource: [{ source: 'task', count: 30 }],
        byType: [{ type: 'task_created', count: 20 }],
      });
      expect(repo.getActivityReport).toHaveBeenCalledWith({
        orgId: 'org-a',
        actor: 'Ada',
        from: '2026-08-01',
        to: '2026-08-25',
        limit: 10,
        offset: 0,
      });
    });
  });

  it('returns 500 when the report repository throws', async () => {
    const repo = createFakeActivityRepository();
    repo.getActivityReport.mockImplementation(() => {
      throw new Error('report failure');
    });
    await withActivityServer(repo, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/activity-report`);
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ error: 'report failure' });
    });
  });
});
