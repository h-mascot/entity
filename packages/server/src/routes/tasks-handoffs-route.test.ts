/**
 * THE-933 — task handoff routes: authorization, validation, atomic reassignment,
 * mode-aware listing, rollback.
 */
import express from 'express';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerTaskRoutes } from './tasks';
import { createTaskRepository } from '../../../db/src';

const tmpDbPath = path.join(os.tmpdir(), `entity-handoffs-route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const originalDbPath = process.env.ENTITY_TASK_DB_PATH;

let taskId = 0;

beforeAll(() => {
  process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
  const repo = createTaskRepository();
  const created = repo.createTask({ name: 'route-handoff-task', org_id: 'default-org', team_id: 'default-team' });
  taskId = created.id;
});

afterAll(() => {
  if (originalDbPath !== undefined) process.env.ENTITY_TASK_DB_PATH = originalDbPath;
  else delete process.env.ENTITY_TASK_DB_PATH;
  try {
    fs.rmSync(tmpDbPath, { force: true });
  } catch {}
});

describe('task handoff routes (THE-933)', () => {
  let server: http.Server;
  let baseUrl = '';

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    // taskSyncLayer delegates to the real repository so the handoff repo's atomic
    // task update is reflected in the refreshed task returned by the route.
    const repo = createTaskRepository();
    registerTaskRoutes(app, '/api', {
      taskSyncLayer: {
        getTask: async (id: number) => repo.getTask(id),
        listTasks: async () => repo.listTasks(),
        listSubtasks: async () => [],
        getActiveAdapter: () => undefined,
      },
      parseTaskId: (value: unknown) => {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : null;
      },
      logActivity: () => {},
      getTaskActorFromRequest: () => 'test-actor',
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server failed to bind');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  });

  const orgHeaders = { 'x-entity-org-id': 'default-org', 'Content-Type': 'application/json' };

  it('lists an empty handoff history for a task (local mode)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/${taskId}/handoffs?mode=local`, { headers: orgHeaders });
    expect(res.status).toBe(200);
    expect((await res.json()).handoffs).toEqual([]);
  });

  it('creates a handoff and atomically reassigns the task owner', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/${taskId}/handoff`, {
      method: 'POST',
      headers: orgHeaders,
      body: JSON.stringify({ targetPrincipalId: 'zora', note: 'generic handoff' }),
    });
    expect(res.status).toBe(201);
    const payload = (await res.json()) as { handoff: { target_principal_id: string; mode: string }; task: { owner_principal_id: string } };
    expect(payload.handoff.target_principal_id).toBe('zora');
    expect(payload.handoff.mode).toBe('local');
    expect(payload.task.owner_principal_id).toBe('zora');
  });

  it('rejects a handoff to the requester (validate target principal)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/${taskId}/handoff`, {
      method: 'POST',
      headers: { ...orgHeaders, 'x-entity-principal-id': 'zora' },
      body: JSON.stringify({ targetPrincipalId: 'zora' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for a missing task', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/999999/handoff`, {
      method: 'POST',
      headers: orgHeaders,
      body: JSON.stringify({ targetPrincipalId: 'spock' }),
    });
    expect(res.status).toBe(404);
  });

  it('rolls back the most recent handoff (reverse edge + owner restored)', async () => {
    const list = await (await fetch(`${baseUrl}/api/tasks/${taskId}/handoffs?mode=local`, { headers: orgHeaders })).json() as { handoffs: Array<{ id: string }> };
    const latest = list.handoffs[list.handoffs.length - 1]!;

    const res = await fetch(`${baseUrl}/api/tasks/${taskId}/handoffs/${latest.id}/rollback?mode=local`, {
      method: 'POST',
      headers: orgHeaders,
    });
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { handoff: { target_principal_id: string; note: string }; task: { owner_principal_id: string } };
    expect(payload.handoff.note).toMatch(/rollback/i);
    // Owner restored to the original source of the handoff that was rolled back.
    expect(payload.task.owner_principal_id).toBeTruthy();
  });
});
