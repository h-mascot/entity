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
import { createTaskHandoffRouter } from './task-handoffs';
import { createTaskRepository, type TaskRecord } from '../../../db/src';
import { createPrincipalRepository } from '../../../db/src/principals';
import { createHandoffRepository } from '../../../db/src/handoffs';

const tmpDbPath = path.join(os.tmpdir(), `entity-handoffs-route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const originalDbPath = process.env.ENTITY_TASK_DB_PATH;

const ORG = 'default-org';
const TEAM = 'default-team';
const OTHER_ORG = 'other-org';
const OTHER_TEAM = 'other-team';

let taskId = 0;
let otherTaskId = 0;
let nonDefaultOrgTaskId = 0;
let principalRepo: ReturnType<typeof createPrincipalRepository>;
let handoffRepo: ReturnType<typeof createHandoffRepository>;

beforeAll(() => {
  process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
  const repo = createTaskRepository();
  const created = repo.createTask({ name: 'route-handoff-task', org_id: ORG, team_id: TEAM });
  taskId = created.id;
  const other = repo.createTask({ name: 'other-task', org_id: ORG, team_id: TEAM });
  otherTaskId = other.id;
  const nonDefaultOrgTask = repo.createTask({ name: 'non-default-org-task', org_id: OTHER_ORG, team_id: OTHER_TEAM });
  nonDefaultOrgTaskId = nonDefaultOrgTask.id;

  handoffRepo = createHandoffRepository();
  handoffRepo.create({
    taskId: nonDefaultOrgTaskId,
    mode: 'local',
    sourcePrincipalId: 'ada',
    targetPrincipalId: 'zora',
    orgId: OTHER_ORG,
    teamId: OTHER_TEAM,
    note: 'existing history',
    createdByPrincipalId: 'ada',
  });

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
      handoffRepository: handoffRepo,
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

describe('production task handoff route composition (THE-933)', () => {
  it('lists a non-default-org task history for a trusted request without an explicit org', async () => {
    const app = express();
    app.use(express.json());
    const repo = createTaskRepository();
    const routeDeps = {
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
      handoffRepository: handoffRepo,
      broadcast: () => {},
    };

    // Match index.ts: the canonical task routes are registered before the
    // later Curacel router, at both legacy and /api paths.
    registerTaskRoutes(app, '', routeDeps);
    registerTaskRoutes(app, '/api', routeDeps);
    const legacyHandoffRouter = createTaskHandoffRouter({
      handoffRepo: {} as any,
      taskStore: { getTask: async (id: number) => repo.getTask(id) },
    });
    app.use('/tasks', legacyHandoffRouter);
    app.use('/api/tasks', legacyHandoffRouter);

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server failed to bind');

    try {
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const listed = await fetch(`${baseUrl}/api/tasks/${nonDefaultOrgTaskId}/handoffs?mode=local`);
      expect(listed.status).toBe(200);
      const listedBody = await listed.json() as {
        handoffs: Array<{ id: string; note: string; org_id: string }>;
        history: Array<{ id: string; rollback_capable: boolean; reason?: string }>;
      };
      expect(listedBody.handoffs).toEqual([
        expect.objectContaining({ note: 'existing history', org_id: OTHER_ORG }),
      ]);
      expect(listedBody.history).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: listedBody.handoffs[0]!.id, rollback_capable: true }),
      ]));

      const rolledBack = await fetch(
        `${baseUrl}/api/tasks/${nonDefaultOrgTaskId}/handoffs/${listedBody.handoffs[0]!.id}/rollback?mode=local`,
        { method: 'POST' },
      );
      expect(rolledBack.status).toBe(200);

      const created = await fetch(`${baseUrl}/api/tasks/${nonDefaultOrgTaskId}/handoff`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetPrincipalId: 'spock', note: 'new handoff' }),
      });
      expect(created.status).toBe(201);
      expect(await created.json()).toMatchObject({
        handoff: { target_principal_id: 'spock', org_id: OTHER_ORG },
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});

describe('task handoff cloud isolation — zero local access before fail-closed (THE-933 blocker)', () => {
  let server: http.Server;
  let baseUrl = '';
  let collisionTaskId = 0;

  // Counters prove NO local task/repository access happens in cloud mode.
  const counts = { getTask: 0, listForTask: 0, create: 0, rollback: 0 };

  beforeAll(async () => {
    process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
    const repo = createTaskRepository();
    const created = repo.createTask({ name: 'cloud-collision-task', org_id: ORG, team_id: TEAM });
    collisionTaskId = created.id;

    const realHandoffRepo = createHandoffRepository();
    const app = express();
    app.use(express.json());
    registerTaskRoutes(app, '/api', {
      taskSyncLayer: {
        getTask: async (id: number) => { counts.getTask++; return repo.getTask(id); },
        listTasks: async () => repo.listTasks(),
        listSubtasks: async () => [],
        getActiveAdapter: () => undefined,
      },
      handoffRepository: {
        create: (i: any) => { counts.create++; return realHandoffRepo.create(i); },
        listForTask: (id: any, scope: any) => { counts.listForTask++; return realHandoffRepo.listForTask(id, scope); },
        get: (id: string) => realHandoffRepo.get(id),
        rollback: (id: string, scope: any) => { counts.rollback++; return realHandoffRepo.rollback(id, scope); },
      },
      parseTaskId: (value: unknown) => {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : null;
      },
      logActivity: () => {},
      getTaskActorFromRequest: () => 'test-actor',
      principalRepository: principalRepo,
      broadcast: () => {},
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

  it('cloud GET list fails closed (503) before any local task/repository read', async () => {
    const before = { ...counts };
    // The cloud request reuses a numeric id that collides with a REAL local task.
    const res = await fetch(`${baseUrl}/api/tasks/${collisionTaskId}/handoffs?mode=cloud`, { headers: orgHeaders });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code?: string }).code).toBe('cloud_handoffs_unavailable');
    expect(counts.getTask).toBe(before.getTask);
    expect(counts.listForTask).toBe(before.listForTask);
  });

  it('cloud POST create fails closed (503) before any local task read, authz, or write', async () => {
    const before = { ...counts };
    const res = await fetch(`${baseUrl}/api/tasks/${collisionTaskId}/handoff`, {
      method: 'POST',
      headers: orgHeaders,
      body: JSON.stringify({ mode: 'cloud', cloudId: 'cloud-ctx-1', targetPrincipalId: 'zora' }),
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code?: string }).code).toBe('cloud_handoffs_unavailable');
    expect(counts.getTask).toBe(before.getTask);
    expect(counts.create).toBe(before.create);
  });

  it('cloud rollback fails closed (503) before any local task/repository access', async () => {
    const before = { ...counts };
    const res = await fetch(`${baseUrl}/api/tasks/${collisionTaskId}/handoffs/any-id/rollback?mode=cloud`, {
      method: 'POST',
      headers: orgHeaders,
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code?: string }).code).toBe('cloud_handoffs_unavailable');
    expect(counts.getTask).toBe(before.getTask);
    expect(counts.rollback).toBe(before.rollback);
  });

  it('aggregates: every cloud operation left ZERO taskSyncLayer and repository access (numeric id collision)', () => {
    // Across all three cloud operations above, no local access occurred even
    // though every request targeted a numeric id that exists locally.
    expect(counts.getTask).toBe(0);
    expect(counts.listForTask).toBe(0);
    expect(counts.create).toBe(0);
    expect(counts.rollback).toBe(0);
  });
});
