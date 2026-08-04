/**
 * THE-933 — task handoff routes: target-principal authorization, cloud fail-closed,
 * rollback scope, and source/target broadcasts.
 */
import express from 'express';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerTaskRoutes } from './tasks';
import { createTaskRepository, type TaskRecord } from '../../../db/src';
import { createPrincipalRepository } from '../../../db/src/principals';

const tmpDbPath = path.join(os.tmpdir(), `entity-handoffs-route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const originalDbPath = process.env.ENTITY_TASK_DB_PATH;

const ORG = 'default-org';
const TEAM = 'default-team';
const OTHER_ORG = 'other-org';
const OTHER_TEAM = 'other-team';

let taskId = 0;
let otherTaskId = 0;
let principalRepo: ReturnType<typeof createPrincipalRepository>;

beforeAll(() => {
  process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
  const repo = createTaskRepository();
  const created = repo.createTask({ name: 'route-handoff-task', org_id: ORG, team_id: TEAM });
  taskId = created.id;
  const other = repo.createTask({ name: 'other-task', org_id: ORG, team_id: TEAM });
  otherTaskId = other.id;

  principalRepo = createPrincipalRepository();
  // Active target, correctly scoped (contributor on default-org/default-team).
  principalRepo.createPrincipal({ id: 'zora', principal_type: 'agent', display_name: 'Zora' });
  principalRepo.createGrant({ principal_id: 'zora', role: 'contributor', org_id: ORG, team_id: TEAM });
  // Active target, different org (cross-org negative).
  principalRepo.createPrincipal({ id: 'spock', principal_type: 'agent', display_name: 'Spock' });
  principalRepo.createGrant({ principal_id: 'spock', role: 'contributor', org_id: OTHER_ORG, team_id: OTHER_TEAM });
  // Active target, same org but different team (cross-team negative).
  principalRepo.createPrincipal({ id: 'scotty', principal_type: 'agent', display_name: 'Scotty' });
  principalRepo.createGrant({ principal_id: 'scotty', role: 'contributor', org_id: ORG, team_id: OTHER_TEAM });
  // Disabled target (inactive negative).
  principalRepo.createPrincipal({ id: 'geordi', principal_type: 'agent', display_name: 'Geordi' });
  principalRepo.createGrant({ principal_id: 'geordi', role: 'contributor', org_id: ORG, team_id: TEAM });
  principalRepo.disablePrincipal('geordi');
});

afterAll(() => {
  if (originalDbPath !== undefined) process.env.ENTITY_TASK_DB_PATH = originalDbPath;
  else delete process.env.ENTITY_TASK_DB_PATH;
  try { fs.rmSync(tmpDbPath, { force: true }); } catch {}
});

describe('task handoff routes (THE-933)', () => {
  let server: http.Server;
  let baseUrl = '';
  const broadcasts: Array<{ type: string; taskId?: number; task?: TaskRecord }> = [];

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
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
      principalRepository: principalRepo,
      broadcast: (message: { type: string; taskId?: number; task?: TaskRecord }) => {
        broadcasts.push(message);
      },
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

  const orgHeaders = { 'x-entity-org-id': ORG, 'Content-Type': 'application/json' };

  it('lists an empty handoff history for a task (local mode)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/${taskId}/handoffs?mode=local`, { headers: orgHeaders });
    expect(res.status).toBe(200);
    expect((await res.json()).handoffs).toEqual([]);
  });

  it('creates a handoff to an authorized target and atomically reassigns + broadcasts', async () => {
    broadcasts.length = 0;
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
    // THE-933: a refresh broadcast is emitted so both endpoint panels update.
    expect(broadcasts.some((b) => b.type === 'task:updated' && b.taskId === taskId)).toBe(true);
  });

  it('rejects a handoff to the requester (no self-handoff)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/${taskId}/handoff`, {
      method: 'POST',
      headers: { ...orgHeaders, 'x-entity-principal-id': 'zora' },
      body: JSON.stringify({ targetPrincipalId: 'zora' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a nonexistent target principal', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/${taskId}/handoff`, {
      method: 'POST',
      headers: orgHeaders,
      body: JSON.stringify({ targetPrincipalId: 'ghost' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe('target_principal_not_found');
  });

  it('rejects an inactive (disabled) target principal', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/${taskId}/handoff`, {
      method: 'POST',
      headers: orgHeaders,
      body: JSON.stringify({ targetPrincipalId: 'geordi' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe('target_principal_inactive');
  });

  it('rejects a cross-org target principal', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/${taskId}/handoff`, {
      method: 'POST',
      headers: orgHeaders,
      body: JSON.stringify({ targetPrincipalId: 'spock' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe('target_principal_out_of_scope');
  });

  it('rejects a cross-team target principal', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/${taskId}/handoff`, {
      method: 'POST',
      headers: orgHeaders,
      body: JSON.stringify({ targetPrincipalId: 'scotty' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe('target_principal_out_of_scope');
  });

  it('returns 404 for a missing task', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/999999/handoff`, {
      method: 'POST',
      headers: orgHeaders,
      body: JSON.stringify({ targetPrincipalId: 'zora' }),
    });
    expect(res.status).toBe(404);
  });

  it('fails closed for cloud mode (503) and never mutates the local task (collision safety)', async () => {
    const before = await (await fetch(`${baseUrl}/api/tasks/${taskId}`, { headers: orgHeaders })).json() as { owner_principal_id: string };
    const res = await fetch(`${baseUrl}/api/tasks/${taskId}/handoff`, {
      method: 'POST',
      headers: orgHeaders,
      body: JSON.stringify({ mode: 'cloud', cloudId: 'cloud-ctx-1', targetPrincipalId: 'zora' }),
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code?: string }).code).toBe('cloud_handoffs_unavailable');
    // The local task owner is unchanged — a cloud id colliding with this numeric
    // id could not mutate the local row.
    const after = await (await fetch(`${baseUrl}/api/tasks/${taskId}`, { headers: orgHeaders })).json() as { owner_principal_id: string };
    expect(after.owner_principal_id).toBe(before.owner_principal_id);
  });

  it('rejects a rollback scoped to a different task id (handoff id replay)', async () => {
    // Create a handoff on `otherTaskId`, then attempt to roll it back via `taskId`.
    const created = await (await fetch(`${baseUrl}/api/tasks/${otherTaskId}/handoff`, {
      method: 'POST',
      headers: orgHeaders,
      body: JSON.stringify({ targetPrincipalId: 'zora' }),
    })).json() as { handoff: { id: string } };

    const res = await fetch(`${baseUrl}/api/tasks/${taskId}/handoffs/${created.handoff.id}/rollback?mode=local`, {
      method: 'POST',
      headers: orgHeaders,
    });
    expect(res.status).toBe(400);
  });

  it('rolls back the most recent handoff (reverse edge + owner restored + broadcast)', async () => {
    broadcasts.length = 0;
    const list = await (await fetch(`${baseUrl}/api/tasks/${taskId}/handoffs?mode=local`, { headers: orgHeaders })).json() as { handoffs: Array<{ id: string }> };
    const latest = list.handoffs[list.handoffs.length - 1]!;

    const res = await fetch(`${baseUrl}/api/tasks/${taskId}/handoffs/${latest.id}/rollback?mode=local`, {
      method: 'POST',
      headers: orgHeaders,
    });
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { handoff: { target_principal_id: string; note: string }; task: { owner_principal_id: string } };
    expect(payload.handoff.note).toMatch(/rollback/i);
    expect(payload.task.owner_principal_id).toBeTruthy();
    expect(broadcasts.some((b) => b.type === 'task:updated' && b.taskId === taskId)).toBe(true);
  });
});
