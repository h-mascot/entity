/**
 * Curacel pilot acceptance — server-layer contracts (targets #1, #3, #4, #6).
 *
 * This is the server-layer half of the deterministic Curacel pilot acceptance
 * suite. It proves, against real middleware/routers/services on current main:
 *
 *   #1  Auth: bearer-token default-deny on protected routes; public health/
 *       version probes; immediate revocation/disable of principals + grants.
 *   #3  Workflow: policy-gated review APPROVE / REQUEST-FIX and human-gate
 *       APPROVE / REJECT decisions via the real review-gate router, including
 *       ineligible-reviewer denial.
 *   #4  Failure controls: heartbeat/presence records live, then goes stale
 *       past the threshold (stalled detection).
 *   #6  Reproducible release: /api/version + readReleaseInfo shape.
 *
 * Data-layer halves (tenant isolation, lease/claim, durable history) live in
 * packages/db/src/curacel-pilot-acceptance.test.ts. Remaining pilot
 * capabilities not yet ported are documented in
 * docs/plans/2026-08-04-curacel-pilot-integration.md.
 */

import Database from 'better-sqlite3';
import express from 'express';
import http from 'http';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApiAuthMiddleware } from '../middleware/api-auth';
import { registerCoreProbeRoutes } from '../routes/core';
import { readReleaseInfo } from '../release-info';
import { createTaskReviewGateRouter } from '../routes/task-review-gates';
import {
  createPrincipalRepository,
  ensurePrincipalsSchema,
  type PrincipalRepository,
  type TaskRecord,
} from '../../../db/src/principals';
import type { ActivityRepository, UpdateTaskInput } from '../../../db/src';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let server: http.Server | null = null;

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

afterEach(() => {
  if (server) {
    server.close();
    server = null;
  }
});

// Minimal org-scoped task fixture with a routed reviewer + human approver,
// mirroring the canonical policy_inputs shape used by the review-gate router.
function makeReviewableTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 1,
    org_id: 'org-acme',
    team_id: 'team-claims',
    project_id: 7,
    created_by_principal_id: 'creator-1',
    initiator_principal_id: 'agent-1',
    initiator_type: 'agent',
    owner_principal_id: 'approver-1',
    owner_principal_type: 'human',
    executor_principal_id: 'agent-1',
    assignment_state: 'assigned',
    taskmaster_drivable: false,
    worktype: 'customer_success',
    risk_level: 'high',
    agent_trust_level: 'standard',
    policy_inputs_json: JSON.stringify({
      layers: {
        team: { reviewer_pool_principal_ids: ['reviewer-1'] },
        project: { approver_principal_id: 'approver-1' },
        task: {
          assignee_principal_id: 'agent-1',
          submitted_by_principal_id: 'agent-1',
        },
      },
    }),
    external_side_effects_json: '[]',
    external_side_effects: [],
    review_required: true,
    review_state: 'pending',
    human_gate_required: true,
    human_gate_state: 'pending',
    name: 'Review gated claim',
    description: null,
    brief: null,
    origin_channel: 'task',
    column: 'review',
    model: null,
    archived: false,
    assignee: 'agent-1',
    blocked: false,
    blocker_reason: null,
    due_date: null,
    priority: 'P1',
    estimate_hours: null,
    time_spent: null,
    output: 'output.md',
    progress_status: null,
    recurring: false,
    recurring_config: null,
    metadata: JSON.stringify({}),
    ...overrides,
  } as TaskRecord;
}

// ---------------------------------------------------------------------------
// #1 Auth: bearer-token default-deny + public probes
// ---------------------------------------------------------------------------

describe('Curacel pilot acceptance — auth default-deny (target #1)', () => {
  const originalToken = process.env.ENTITY_API_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.ENTITY_API_TOKEN;
    else process.env.ENTITY_API_TOKEN = originalToken;
  });

  async function bootAuthApp(): Promise<string> {
    process.env.ENTITY_API_TOKEN = 'pilot-secret-token';
    const app = express();
    app.use(createApiAuthMiddleware());
    registerCoreProbeRoutes(app, {});
    // A representative protected customer route.
    app.get('/api/tasks', (_req, res) => res.json({ ok: true }));
    server = http.createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as http.AddressInfo).port;
    return `http://127.0.0.1:${port}`;
  }

  it('keeps /api/health and /api/version public (release verifiers need no token)', async () => {
    const base = await bootAuthApp();
    const health = await fetch(`${base}/api/health`);
    const version = await fetch(`${base}/api/version`);
    expect(health.status).toBe(200);
    expect(version.status).toBe(200);
    expect((await readJson(health)).status).toBe('ok');
    expect((await readJson(version)).app).toBe('entity');
  });

  it('default-denies protected customer routes without a bearer token', async () => {
    const base = await bootAuthApp();
    const res = await fetch(`${base}/api/tasks`);
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_TOKEN_REQUIRED');
  });

  it('rejects an invalid bearer and admits a valid one', async () => {
    const base = await bootAuthApp();
    const wrong = await fetch(`${base}/api/tasks`, { headers: { authorization: 'Bearer wrong-token' } });
    expect(wrong.status).toBe(401);
    expect((await readJson(wrong)).code).toBe('AUTH_TOKEN_INVALID');

    const ok = await fetch(`${base}/api/tasks`, { headers: { authorization: 'Bearer pilot-secret-token' } });
    expect(ok.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// #1 Auth: immediate revocation / disable of principals + grants
// ---------------------------------------------------------------------------

describe('Curacel pilot acceptance — immediate revocation/disable (target #1)', () => {
  let db: Database.Database;
  let repo: PrincipalRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    ensurePrincipalsSchema(db);
    repo = createPrincipalRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  // Mirrors hasGlobalAdminGrant from principals/admin-identity: an active
  // principal with an org-less admin grant is authorized; anything else is not.
  function hasGlobalAdmin(principalId: string): boolean {
    const ctx = repo.getPrincipal(principalId);
    if (!ctx || ctx.status !== 'active') return false;
    return repo.listGrantsForPrincipal(principalId).some(
      (g) => g.role === 'admin' && !g.org_id && !g.team_id && !g.project_id,
    );
  }

  it('disabling a principal immediately removes authorization', () => {
    const principal = repo.createPrincipal({ principal_type: 'human', display_name: 'Operator' });
    repo.createGrant({ principal_id: principal.id, role: 'admin' });
    expect(hasGlobalAdmin(principal.id)).toBe(true);

    repo.disablePrincipal(principal.id);
    expect(hasGlobalAdmin(principal.id)).toBe(false);
  });

  it('revoking a grant immediately removes authorization', () => {
    const principal = repo.createPrincipal({ principal_type: 'human', display_name: 'Reviewer' });
    const grant = repo.createGrant({ principal_id: principal.id, role: 'admin' });
    expect(hasGlobalAdmin(principal.id)).toBe(true);

    expect(repo.revokeGrant(grant.id)).toBe(true);
    expect(hasGlobalAdmin(principal.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #3 Workflow: review-gate router (approve / request-fix / human-gate)
// ---------------------------------------------------------------------------

describe('Curacel pilot acceptance — review decisions (target #3)', () => {
  let baseUrl = '';

  beforeEach(() => {
    baseUrl = '';
  });

  async function bootReviewApp(task: TaskRecord, updates: UpdateTaskInput[] = []) {
    const applied: UpdateTaskInput[] = [];
    const deps = {
      getTask: async () => task,
      updateTask: async (_id: number, u: UpdateTaskInput) => {
        applied.push(u);
        return { ...task, ...u } as TaskRecord;
      },
      activityRepository: { createActivity: () => ({ id: 1 }) } as Pick<ActivityRepository, 'createActivity'>,
      defaultActor: 'system',
    };
    const app = express();
    app.use(express.json());
    app.use('/api/tasks', createTaskReviewGateRouter(deps));
    server = http.createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as http.AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}/api/tasks`;
    return { applied };
  }

  it('accepts a review from the assigned eligible reviewer', async () => {
    const { applied } = await bootReviewApp(makeReviewableTask());
    const res = await fetch(`${baseUrl}/1/review/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entity-actor': 'reviewer-1' },
      body: JSON.stringify({ reason: 'evidence checked' }),
    });
    expect(res.status).toBe(200);
    expect(applied.some((u) => u.review_state === 'accepted')).toBe(true);
  });

  it('rejects a review decision from a non-assigned principal (403)', async () => {
    await bootReviewApp(makeReviewableTask());
    const res = await fetch(`${baseUrl}/1/review/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entity-actor': 'intruder' },
      body: JSON.stringify({ reason: 'self review attempt' }),
    });
    expect(res.status).toBe(403);
  });

  it('records a request-fix (rejection) from the assigned reviewer', async () => {
    const { applied } = await bootReviewApp(makeReviewableTask());
    const res = await fetch(`${baseUrl}/1/review/request-fix`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entity-actor': 'reviewer-1' },
      body: JSON.stringify({ reason: 'missing evidence' }),
    });
    expect(res.status).toBe(200);
    expect(applied.some((u) => u.review_state === 'request_fix')).toBe(true);
  });

  it('approves the human gate from the bound human approver and rejects others', async () => {
    const { applied } = await bootReviewApp(makeReviewableTask());
    const intruder = await fetch(`${baseUrl}/1/human-gate/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entity-actor': 'someone-else', 'x-entity-actor-type': 'human' },
      body: JSON.stringify({ reason: 'wrong approver' }),
    });
    expect(intruder.status).toBe(403);

    const approved = await fetch(`${baseUrl}/1/human-gate/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entity-actor': 'approver-1', 'x-entity-actor-type': 'human' },
      body: JSON.stringify({ reason: 'approved for send' }),
    });
    expect(approved.status).toBe(200);
    expect(applied.some((u) => u.human_gate_state === 'approved')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #4 Failure controls: heartbeat / presence → stale (stalled detection)
// ---------------------------------------------------------------------------

describe('Curacel pilot acceptance — heartbeat & stalled detection (target #4)', () => {
  let activeDbPath: string | null = null;
  const cleanupDbPaths: string[] = [];

  function tempDbPath(prefix: string): string {
    return path.join(os.tmpdir(), `${prefix}-${process.pid}-${randomUUID()}.sqlite`);
  }
  function removeSqliteFiles(dbPath: string): void {
    for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(file, { force: true });
  }

  afterEach(async () => {
    try {
      const { resetPresenceServiceForTests } = await import('../agent/presence/service');
      resetPresenceServiceForTests();
    } catch {
      // ignore
    }
    try {
      const { resetInviteControlsForTests } = await import('../agent/invite-kit/controls');
      resetInviteControlsForTests();
    } catch {
      // ignore
    }
    if (activeDbPath) {
      const closePath = tempDbPath('curacel-presence-close');
      cleanupDbPaths.push(closePath);
      vi.stubEnv('ENTITY_TASK_DB_PATH', closePath);
      try {
        const { getEntityDatabase } = await import('../../../db/src/entity-db');
        getEntityDatabase().close();
      } catch {
        // best-effort
      }
    }
    vi.resetModules();
    vi.unstubAllEnvs();
    for (const dbPath of cleanupDbPaths) removeSqliteFiles(dbPath);
    cleanupDbPaths.length = 0;
    activeDbPath = null;
  });

  it('records a live heartbeat and flips to stale once past the threshold', async () => {
    activeDbPath = tempDbPath('curacel-presence');
    cleanupDbPaths.push(activeDbPath);
    vi.resetModules();
    vi.stubEnv('ENTITY_TASK_DB_PATH', activeDbPath);

    const { resetInviteControlsForTests, createInviteControls } = await import('../agent/invite-kit/controls');
    resetInviteControlsForTests();
    const { resetPresenceServiceForTests, createPresenceService } = await import('../agent/presence/service');
    resetPresenceServiceForTests();

    const nowMs = Date.parse('2026-08-04T12:00:00.000Z');
    const presence = createPresenceService({
      invites: createInviteControls(),
      now: () => new Date(nowMs),
      staleAfterMs: 60_000,
    });

    // Fresh heartbeat (30s ago) => live.
    const fresh = presence.recordHeartbeat({
      agentId: 'agent-claims',
      status: 'live',
      currentWorkplaneId: 'wp-claims',
      currentTaskId: 42,
      lastSeenAt: '2026-08-04T11:59:30.000Z',
    });
    expect(fresh.ok).toBe(true);
    if (fresh.ok) expect(fresh.value.evaluated.presenceStatus).toBe('live');

    // Same agent, stale heartbeat (>threshold) on read => stalled.
    presence.recordHeartbeat({
      agentId: 'agent-claims',
      status: 'live',
      currentWorkplaneId: 'wp-claims',
      lastSeenAt: '2026-08-04T11:50:00.000Z',
    });
    const read = presence.getAgentPresence('agent-claims');
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.presenceStatus).toBe('stale');
      expect(read.value.degradedReasons).toContain('presence_stale');
    }
  });
});

// ---------------------------------------------------------------------------
// #6 Reproducible release: /api/version + readReleaseInfo
// ---------------------------------------------------------------------------

describe('Curacel pilot acceptance — reproducible release (target #6)', () => {
  it('readReleaseInfo returns a stable, deploy-verifiable shape', () => {
    const info = readReleaseInfo(process.cwd());
    expect(info.app).toBe('entity');
    expect(info.schemaVersion).toBe(1);
    // gitSha is null in a bare dev worktree and a string on an immutable
    // release; the field is always present and is what deploy verifiers
    // compare against the release manifest.
    expect(info.gitSha === null || typeof info.gitSha === 'string').toBe(true);
    expect(['manifest', 'version-file', 'environment', 'runtime']).toContain(info.source);
  });

  it('/api/version serves the release identity on a public route', async () => {
    const app = express();
    registerCoreProbeRoutes(app, {});
    server = http.createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as http.AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/version`);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.app).toBe('entity');
  });
});
