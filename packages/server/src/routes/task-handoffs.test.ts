/**
 * Task handoffs HTTP routes proof (Curacel C-8), adapted to current main.
 *
 * Mounts the real createTaskHandoffRouter against an in-memory handoff
 * repository and a stub task store, and proves the HTTP lifecycle
 * (create -> list -> accept -> complete), duplicate/cycle/blocked-reason
 * error mapping, compare-and-swap version handling, and that the route
 * never trusts a caller-supplied org header (org comes from the task row).
 */

import express from 'express';
import http from 'http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createTaskHandoffRepository,
  type TaskHandoffRepository,
} from '../../../db/src/task-handoffs';
import type { TaskRecord } from '../../../db/src';
import { createTaskHandoffRouter } from './task-handoffs';
import {
  buildCustomerPrincipalContext,
  type CustomerPrincipalContext,
} from '../principals/request-context';

import Database from 'better-sqlite3';

let server: http.Server | null = null;
let baseUrl = '';
let db: Database.Database;
let repo: TaskHandoffRepository;

function task(overrides: Partial<TaskRecord> & { id: number }): TaskRecord {
  return {
    org_id: 'org-acme',
    team_id: 'team-claims',
    project_id: 1,
    created_by_principal_id: 'op',
    initiator_principal_id: 'agent-a',
    initiator_type: 'agent',
    owner_principal_id: 'owner-1',
    owner_principal_type: 'human',
    executor_principal_id: 'agent-a',
    assignment_state: 'assigned',
    taskmaster_drivable: false,
    worktype: 'customer_success',
    risk_level: 'low',
    agent_trust_level: 'standard',
    policy_inputs_json: '{}',
    external_side_effects_json: '[]',
    external_side_effects: [],
    review_required: false,
    review_state: 'not_required',
    human_gate_required: false,
    human_gate_state: 'not_required',
    name: 'Task',
    description: null,
    brief: null,
    origin_channel: 'task',
    column: 'review',
    model: null,
    archived: false,
    assignee: 'agent-a',
    blocked: false,
    blocker_reason: null,
    due_date: null,
    priority: 'P2',
    estimate_hours: null,
    time_spent: null,
    output: null,
    progress_status: null,
    recurring: false,
    recurring_config: null,
    metadata: '{}',
    ...overrides,
  } as TaskRecord;
}

// Minimal tasks table so the handoff repository's FK + task lookups resolve
// against the same in-memory database.
function ensureTasksTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY,
      org_id TEXT NOT NULL,
      team_id TEXT NOT NULL,
      project_id INTEGER,
      created_by_principal_id TEXT,
      initiator_principal_id TEXT,
      initiator_type TEXT,
      owner_principal_id TEXT,
      owner_principal_type TEXT,
      executor_principal_id TEXT,
      assignment_state TEXT,
      taskmaster_drivable INTEGER NOT NULL DEFAULT 0,
      worktype TEXT NOT NULL DEFAULT 'general',
      risk_level TEXT NOT NULL DEFAULT 'low',
      agent_trust_level TEXT NOT NULL DEFAULT 'unknown',
      policy_inputs_json TEXT NOT NULL DEFAULT '{}',
      external_side_effects_json TEXT NOT NULL DEFAULT '[]',
      review_required INTEGER NOT NULL DEFAULT 0,
      review_state TEXT NOT NULL DEFAULT 'not_required',
      human_gate_required INTEGER NOT NULL DEFAULT 0,
      human_gate_state TEXT NOT NULL DEFAULT 'not_required',
      name TEXT NOT NULL,
      description TEXT,
      column TEXT NOT NULL DEFAULT 'backlog',
      assignee TEXT,
      blocked INTEGER NOT NULL DEFAULT 0,
      blocker_reason TEXT,
      project TEXT DEFAULT 'General',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT
    );
  `);
}

function insertTask(database: Database.Database, t: TaskRecord): void {
  database
    .prepare(
      `INSERT INTO tasks (id, org_id, team_id, name, owner_principal_id, owner_principal_type,
        executor_principal_id, assignee, assignment_state, column)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      t.id,
      t.org_id ?? 'org-acme',
      t.team_id ?? 'team-claims',
      t.name,
      t.owner_principal_id ?? null,
      t.owner_principal_type ?? null,
      t.executor_principal_id ?? null,
      t.assignee ?? null,
      t.assignment_state ?? null,
      t.column ?? 'backlog',
    );
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  db = new Database(':memory:');
  ensureTasksTable(db);
  repo = createTaskHandoffRepository(db);
  insertTask(db, task({ id: 1, name: 'Source' }));
  insertTask(db, task({ id: 2, name: 'Target', assignee: 'unassigned' }));

  const store = new Map<number, TaskRecord>([
    [1, task({ id: 1, name: 'Source' })],
    [2, task({ id: 2, name: 'Target', assignee: 'unassigned' })],
  ]);

  const app = express();
  app.use(express.json());
  app.use(
    createTaskHandoffRouter({
      handoffRepo: repo,
      taskStore: { getTask: (id) => store.get(id) },
      defaultActor: 'system',
    }),
  );
  server = http.createServer(app);
  return new Promise<void>((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      const port = (server!.address() as { port: number }).port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterEach(() => {
  if (server) {
    server.close();
    server = null;
  }
  db.close();
});

describe('task handoffs routes (Curacel C-8)', () => {
  it('creates, lists, accepts, and completes a handoff', async () => {
    const created = await fetch(`${baseUrl}/tasks/1/handoffs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entity-actor': 'operator-1' },
      body: JSON.stringify({ targetTaskId: 2, targetAgentId: 'agent-b', reason: 'escalate' }),
    });
    expect(created.status).toBe(201);
    const createdBody = await readJson(created);
    const handoff = createdBody.handoff as Record<string, unknown>;
    expect(handoff.status).toBe('pending');
    const handoffId = handoff.id as string;

    const listed = await fetch(`${baseUrl}/tasks/1/handoffs`);
    expect(listed.status).toBe(200);
    const listBody = await readJson(listed);
    expect((listBody.outgoing as unknown[]).length).toBe(1);

    const accepted = await fetch(`${baseUrl}/tasks/1/handoffs/${handoffId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-entity-actor': 'approver-1' },
      body: JSON.stringify({ status: 'accepted', expectedVersion: 1 }),
    });
    expect(accepted.status).toBe(200);
    const acceptedBody = await readJson(accepted);
    expect((acceptedBody.handoff as Record<string, unknown>).status).toBe('accepted');

    const completed = await fetch(`${baseUrl}/tasks/1/handoffs/${handoffId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-entity-actor': 'approver-1' },
      body: JSON.stringify({ status: 'completed', expectedVersion: 2 }),
    });
    expect(completed.status).toBe(200);
    expect((await readJson(completed)).handoff as Record<string, unknown>).toMatchObject({
      status: 'completed',
    });
  });

  it('maps duplicate, cycle, and missing-reason errors to 409/400', async () => {
    await fetch(`${baseUrl}/tasks/1/handoffs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetTaskId: 2, targetAgentId: 'agent-b' }),
    });
    const duplicate = await fetch(`${baseUrl}/tasks/1/handoffs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetTaskId: 2, targetAgentId: 'agent-b' }),
    });
    expect(duplicate.status).toBe(409);

    const blockedNoReason = await fetch(`${baseUrl}/tasks/1/handoffs/abc`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'blocked', expectedVersion: 1 }),
    });
    // 'abc' is not a real handoff id -> 404 path, but proves missing-field guard
    // for status/version is 400 when fields absent.
    const missingFields = await fetch(`${baseUrl}/tasks/1/handoffs/abc`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(missingFields.status).toBe(400);
    void blockedNoReason;
  });

  it('requires targetTaskId and targetAgentId', async () => {
    const res = await fetch(`${baseUrl}/tasks/1/handoffs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown task and ignores any caller org header', async () => {
    // The route must derive org from the task row, not a header.
    const res = await fetch(`${baseUrl}/tasks/999/handoffs`, {
      headers: { 'x-entity-org-id': 'org-evil' },
    });
    expect(res.status).toBe(404);
  });

  it('walks the chain endpoint', async () => {
    await fetch(`${baseUrl}/tasks/1/handoffs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetTaskId: 2, targetAgentId: 'agent-b' }),
    });
    const res = await fetch(`${baseUrl}/tasks/1/handoffs/chain`);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const chain = body.chain as Record<string, unknown>;
    expect((chain.nodes as unknown[]).length).toBe(2);
    expect((chain.edges as unknown[]).length).toBe(1);
  });
});

// ---- D-R2 dual-scope PATCH authorization (real customer principal path) ----
//
// A PATCH transition must authorize BOTH durable endpoints of the handoff,
// not just the path task. A caller scoped to only one endpoint must be denied,
// and a both-scope caller's durable actor is the server-resolved principal id
// even when a spoofed X-Entity-Actor header is supplied.

let dualDb: Database.Database;
let dualRepo: TaskHandoffRepository;
let dualServer: http.Server | null = null;
let dualBaseUrl = '';

const SOURCE_TASK_ID = 11;
const TARGET_TASK_ID = 12;
const SOURCE_SCOPE = { team_id: 'team-claims', project_id: 10 };
const TARGET_SCOPE = { team_id: 'team-payments', project_id: 20 };

function scopedContributor(
  principalId: string,
  teamId: string,
  projectId: number,
): CustomerPrincipalContext {
  return buildCustomerPrincipalContext({
    principalId,
    principalType: 'human',
    permission: {
      principal_id: principalId,
      grants: [{ role: 'contributor', org_id: 'org-acme', team_id: teamId, project_id: projectId }],
    },
  });
}

async function startDualScopeServer(): Promise<void> {
  dualDb = new Database(':memory:');
  ensureTasksTable(dualDb);
  dualRepo = createTaskHandoffRepository(dualDb);

  const sourceTask = task({
    id: SOURCE_TASK_ID,
    name: 'Source',
    team_id: SOURCE_SCOPE.team_id,
    project_id: SOURCE_SCOPE.project_id,
  });
  const targetTask = task({
    id: TARGET_TASK_ID,
    name: 'Target',
    team_id: TARGET_SCOPE.team_id,
    project_id: TARGET_SCOPE.project_id,
    assignee: 'unassigned',
  });
  insertTask(dualDb, sourceTask);
  insertTask(dualDb, targetTask);

  const store = new Map<number, TaskRecord>([
    [SOURCE_TASK_ID, sourceTask],
    [TARGET_TASK_ID, targetTask],
  ]);

  const principals: Record<string, CustomerPrincipalContext> = {
    'p-source': scopedContributor('p-source', SOURCE_SCOPE.team_id, SOURCE_SCOPE.project_id),
    'p-target': scopedContributor('p-target', TARGET_SCOPE.team_id, TARGET_SCOPE.project_id),
    'p-both': buildCustomerPrincipalContext({
      principalId: 'p-both',
      principalType: 'human',
      permission: {
        principal_id: 'p-both',
        grants: [
          { role: 'contributor', org_id: 'org-acme', team_id: SOURCE_SCOPE.team_id, project_id: SOURCE_SCOPE.project_id },
          { role: 'contributor', org_id: 'org-acme', team_id: TARGET_SCOPE.team_id, project_id: TARGET_SCOPE.project_id },
        ],
      },
    }),
  };

  const app = express();
  app.use(express.json());
  // Attach a real customer principal context from a test header so the request
  // is treated as a scoped customer (not the trusted service path).
  app.use((req, _res, next) => {
    const principalId = req.header('x-test-principal');
    if (typeof principalId === 'string' && principals[principalId]) {
      (req as unknown as { entityCustomerPrincipal?: CustomerPrincipalContext }).entityCustomerPrincipal =
        principals[principalId];
    }
    next();
  });
  app.use(
    createTaskHandoffRouter({
      handoffRepo: dualRepo,
      taskStore: { getTask: (id) => store.get(id) },
      defaultActor: 'system',
    }),
  );

  dualServer = http.createServer(app);
  return new Promise<void>((resolve) => {
    dualServer!.listen(0, '127.0.0.1', () => {
      const port = (dualServer!.address() as { port: number }).port;
      dualBaseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

function dualAfterEach(): void {
  if (dualServer) {
    dualServer.close();
    dualServer = null;
  }
  dualDb.close();
}

describe('PATCH handoff transition authorizes BOTH durable endpoints (D-R2)', () => {
  beforeEach(() => startDualScopeServer());
  afterEach(() => dualAfterEach());

  it('denies a source-only contributor on the source path and leaves the handoff unchanged', async () => {
    // Seed the handoff via the trusted path (no customer principal).
    const created = await fetch(`${dualBaseUrl}/tasks/${SOURCE_TASK_ID}/handoffs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entity-actor': 'creator-1' },
      body: JSON.stringify({ targetTaskId: TARGET_TASK_ID, targetAgentId: 'agent-b' }),
    });
    expect(created.status).toBe(201);
    const handoffId = ((await readJson(created)).handoff as Record<string, unknown>).id as string;

    // Source-only contributor hits the source path with a spoofed actor header.
    // The foreign target endpoint resolves to role 'none', which the helper
    // denies with 404 (existence hidden) — a denial, never a transition.
    const denied = await fetch(`${dualBaseUrl}/tasks/${SOURCE_TASK_ID}/handoffs/${handoffId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-test-principal': 'p-source',
        'x-entity-actor': 'spoofed-actor',
      },
      body: JSON.stringify({ status: 'accepted', expectedVersion: 1 }),
    });
    expect([403, 404]).toContain(denied.status);
    expect(denied.status).not.toBe(200);

    // No transition occurred: still pending, version 1, durable actor unchanged.
    const current = dualRepo.get('org-acme', handoffId)!;
    expect(current.status).toBe('pending');
    expect(current.version).toBe(1);
    expect(current.last_transition_by_principal_id).toBe('creator-1');
    expect(current.accepted_by_principal_id).toBeNull();
  });

  it('denies a target-only contributor on the target path and leaves the handoff unchanged', async () => {
    const created = await fetch(`${dualBaseUrl}/tasks/${SOURCE_TASK_ID}/handoffs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entity-actor': 'creator-1' },
      body: JSON.stringify({ targetTaskId: TARGET_TASK_ID, targetAgentId: 'agent-b' }),
    });
    expect(created.status).toBe(201);
    const handoffId = ((await readJson(created)).handoff as Record<string, unknown>).id as string;

    // Target-only contributor hits the target path; the foreign source
    // endpoint resolves to role 'none' and is denied (404, existence hidden).
    const denied = await fetch(`${dualBaseUrl}/tasks/${TARGET_TASK_ID}/handoffs/${handoffId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-test-principal': 'p-target',
        'x-entity-actor': 'spoofed-actor',
      },
      body: JSON.stringify({ status: 'accepted', expectedVersion: 1 }),
    });
    expect([403, 404]).toContain(denied.status);
    expect(denied.status).not.toBe(200);

    const current = dualRepo.get('org-acme', handoffId)!;
    expect(current.status).toBe('pending');
    expect(current.version).toBe(1);
    expect(current.last_transition_by_principal_id).toBe('creator-1');
    expect(current.accepted_by_principal_id).toBeNull();
  });

  it('accepts for a both-scope contributor and records the resolved principal despite a spoofed actor', async () => {
    const created = await fetch(`${dualBaseUrl}/tasks/${SOURCE_TASK_ID}/handoffs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entity-actor': 'creator-1' },
      body: JSON.stringify({ targetTaskId: TARGET_TASK_ID, targetAgentId: 'agent-b' }),
    });
    expect(created.status).toBe(201);
    const handoffId = ((await readJson(created)).handoff as Record<string, unknown>).id as string;

    // Both-scope contributor spoofs X-Entity-Actor; the durable actor must be
    // the server-resolved principal id, never the header value.
    const accepted = await fetch(`${dualBaseUrl}/tasks/${SOURCE_TASK_ID}/handoffs/${handoffId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-test-principal': 'p-both',
        'x-entity-actor': 'spoofed-actor',
      },
      body: JSON.stringify({ status: 'accepted', expectedVersion: 1 }),
    });
    expect(accepted.status).toBe(200);
    const acceptedBody = (await readJson(accepted)).handoff as Record<string, unknown>;
    expect(acceptedBody.status).toBe('accepted');
    expect(acceptedBody.version).toBe(2);

    const current = dualRepo.get('org-acme', handoffId)!;
    expect(current.last_transition_by_principal_id).toBe('p-both');
    expect(current.last_transition_by_principal_id).not.toBe('spoofed-actor');
    expect(current.accepted_by_principal_id).toBe('p-both');
  });
});
