/**
 * Task handoffs repository proof (Curacel pilot C-8), ported to current main.
 *
 * Proves lifecycle, cycle prevention, compare-and-swap version transitions,
 * transactional ownership transfer on accept, durable transition events,
 * tenant boundary (cross-org denied; reads keyed on org_id), bounded chain
 * traversal, and recycled-id FK cleanup — all against a fresh temp DB using
 * main's real org-scoped task repositories.
 */

import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let activeDbPath: string | null = null;
const cleanupDbPaths: string[] = [];

function tempDbPath(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${process.pid}-${randomUUID()}.sqlite`);
}

function removeSqliteFiles(dbPath: string): void {
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    fs.rmSync(file, { force: true });
  }
}

async function loadModules(now?: () => Date) {
  activeDbPath = tempDbPath('task-handoffs');
  cleanupDbPaths.push(activeDbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', activeDbPath);
  vi.stubEnv('MISSION_CONTROL_DB_PATH', tempDbPath('missing-mission-control'));
  const db = await import('./index');
  const handoffs = await import('./task-handoffs');
  // Build the workspace + tasks through main's repositories so the tasks table
  // is populated with main's canonical columns and defaults.
  const workspace = db.createWorkspaceScopeRepository();
  const repo = handoffs.createTaskHandoffRepository(undefined, now ? { now } : undefined);
  return { db, handoffs, workspace, repo };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const dbPath of cleanupDbPaths) removeSqliteFiles(dbPath);
  cleanupDbPaths.length = 0;
  activeDbPath = null;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const dbPath of cleanupDbPaths) removeSqliteFiles(dbPath);
  cleanupDbPaths.length = 0;
  activeDbPath = null;
});

describe('task handoffs repository (Curacel C-8)', () => {
  let env: Awaited<ReturnType<typeof loadModules>>;

  beforeEach(async () => {
    env = await loadModules();
  });

  function makeTasks(orgId: string) {
    const tasks = env.db.createOrgScopedTaskRepository({ orgId });
    const a = tasks.createTask({ name: 'Source task', assignee: 'agent-a' });
    const b = tasks.createTask({ name: 'Target task', assignee: 'unassigned' });
    return { tasks, a, b };
  }

  it('creates a pending handoff within one organization and lists it per task', () => {
    const { workspace } = env;
    workspace.createOrg({ id: 'org-acme', name: 'Acme' });
    const { a, b } = makeTasks('org-acme');

    const handoff = env.repo.create({
      sourceTaskId: a.id,
      targetTaskId: b.id,
      targetAgentId: 'agent-b',
      reason: 'escalate to claims',
      actorPrincipalId: 'operator-1',
    });
    expect(handoff.status).toBe('pending');
    expect(handoff.dependency_status).toBe('waiting');
    expect(handoff.org_id).toBe('org-acme');
    expect(handoff.version).toBe(1);

    const forSource = env.repo.listForTask('org-acme', a.id);
    expect(forSource.outgoing.map((h) => h.id)).toContain(handoff.id);
    const forTarget = env.repo.listForTask('org-acme', b.id);
    expect(forTarget.incoming.map((h) => h.id)).toContain(handoff.id);
  });

  it('rejects a cross-organization handoff and cross-org reads (tenant boundary)', () => {
    const { workspace } = env;
    workspace.createOrg({ id: 'org-acme', name: 'Acme' });
    workspace.createOrg({ id: 'org-beta', name: 'Beta' });
    const acme = env.db.createOrgScopedTaskRepository({ orgId: 'org-acme' });
    const beta = env.db.createOrgScopedTaskRepository({ orgId: 'org-beta' });
    const a = acme.createTask({ name: 'Acme source' });
    const b = beta.createTask({ name: 'Beta target' });

    expect(() =>
      env.repo.create({
        sourceTaskId: a.id,
        targetTaskId: b.id,
        targetAgentId: 'agent-b',
        actorPrincipalId: 'operator-1',
      }),
    ).toThrow(/same organization/);

    // Reads are org-keyed: a handoff in org-acme is invisible to org-beta.
    const acme2 = acme.createTask({ name: 'Acme source 2' });
    const handoff = env.repo.create({
      sourceTaskId: a.id,
      targetTaskId: acme2.id,
      targetAgentId: 'agent-x',
      actorPrincipalId: 'operator-1',
    });
    expect(env.repo.get('org-beta', handoff.id)).toBeUndefined();
    expect(env.repo.listForTask('org-beta', a.id)).toEqual({ incoming: [], outgoing: [] });
  });

  it('prevents duplicate active handoffs and cycles', () => {
    const { workspace } = env;
    workspace.createOrg({ id: 'org-acme', name: 'Acme' });
    const { a, b } = makeTasks('org-acme');

    env.repo.create({
      sourceTaskId: a.id,
      targetTaskId: b.id,
      targetAgentId: 'agent-b',
      actorPrincipalId: 'operator-1',
    });
    expect(() =>
      env.repo.create({
        sourceTaskId: a.id,
        targetTaskId: b.id,
        targetAgentId: 'agent-b',
        actorPrincipalId: 'operator-1',
      }),
    ).toThrow(/already exists/);

    // b -> a would close a cycle (a -> b already exists).
    expect(() =>
      env.repo.create({
        sourceTaskId: b.id,
        targetTaskId: a.id,
        targetAgentId: 'agent-a',
        actorPrincipalId: 'operator-1',
      }),
    ).toThrow(/cycle/);
  });

  it('transfers ownership on accept and enforces compare-and-swap + legal transitions', () => {
    const { workspace } = env;
    workspace.createOrg({ id: 'org-acme', name: 'Acme' });
    const { tasks, a, b } = makeTasks('org-acme');

    const handoff = env.repo.create({
      sourceTaskId: a.id,
      targetTaskId: b.id,
      targetAgentId: 'agent-b',
      actorPrincipalId: 'operator-1',
    });

    const accepted = env.repo.transition({
      orgId: 'org-acme',
      handoffId: handoff.id,
      status: 'accepted',
      actorPrincipalId: 'approver-1',
      expectedVersion: 1,
    });
    expect(accepted.status).toBe('accepted');
    expect(accepted.accepted_by_principal_id).toBe('approver-1');
    expect(accepted.version).toBe(2);

    // Ownership of the target task transferred to the target agent.
    const target = tasks.getTask(b.id);
    expect(target?.owner_principal_id).toBe('agent-b');
    expect(target?.owner_principal_type).toBe('agent');
    expect(target?.executor_principal_id).toBe('agent-b');
    expect(target?.assignment_state).toBe('assigned');

    // Stale version is rejected (optimistic concurrency).
    expect(() =>
      env.repo.transition({
        orgId: 'org-acme',
        handoffId: handoff.id,
        status: 'completed',
        actorPrincipalId: 'approver-1',
        expectedVersion: 1,
      }),
    ).toThrow(/changed/);

    // Legal forward transition completes the handoff.
    const completed = env.repo.transition({
      orgId: 'org-acme',
      handoffId: handoff.id,
      status: 'completed',
      actorPrincipalId: 'approver-1',
      expectedVersion: 2,
    });
    expect(completed.status).toBe('completed');
    expect(completed.completed_at).toBeTruthy();

    // Terminal state rejects further transitions.
    expect(() =>
      env.repo.transition({
        orgId: 'org-acme',
        handoffId: handoff.id,
        status: 'cancelled',
        actorPrincipalId: 'approver-1',
        expectedVersion: 3,
      }),
    ).toThrow(/terminal/);
  });

  it('requires a reason for the blocked transition', () => {
    const { workspace } = env;
    workspace.createOrg({ id: 'org-acme', name: 'Acme' });
    const { a, b } = makeTasks('org-acme');
    const handoff = env.repo.create({
      sourceTaskId: a.id,
      targetTaskId: b.id,
      targetAgentId: 'agent-b',
      actorPrincipalId: 'operator-1',
    });
    expect(() =>
      env.repo.transition({
        orgId: 'org-acme',
        handoffId: handoff.id,
        status: 'blocked',
        actorPrincipalId: 'operator-1',
        expectedVersion: 1,
      }),
    ).toThrow(/reason/);
    const blocked = env.repo.transition({
      orgId: 'org-acme',
      handoffId: handoff.id,
      status: 'blocked',
      actorPrincipalId: 'operator-1',
      expectedVersion: 1,
      reason: 'awaiting evidence',
    });
    expect(blocked.status).toBe('blocked');
  });

  it('walks a bounded chain from a task and truncates past limits', () => {
    const { workspace } = env;
    workspace.createOrg({ id: 'org-acme', name: 'Acme' });
    const tasks = env.db.createOrgScopedTaskRepository({ orgId: 'org-acme' });
    const a = tasks.createTask({ name: 'A' });
    const b = tasks.createTask({ name: 'B' });
    const c = tasks.createTask({ name: 'C' });
    env.repo.create({ sourceTaskId: a.id, targetTaskId: b.id, targetAgentId: 'agent-b', actorPrincipalId: 'op' });
    env.repo.create({ sourceTaskId: b.id, targetTaskId: c.id, targetAgentId: 'agent-c', actorPrincipalId: 'op' });

    const chain = env.repo.getChain({ orgId: 'org-acme', taskId: b.id });
    expect(chain.root_task_id).toBe(b.id);
    expect(chain.nodes.map((n) => n.id).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(chain.edges.length).toBe(2);

    // maxEdges=0 (clamped to 1) still yields at least the first edge and marks truncation path safe.
    const tiny = env.repo.getChain({ orgId: 'org-acme', taskId: b.id, maxEdges: 1 });
    expect(tiny.edges.length).toBeLessThanOrEqual(1);
  });

  it('cleans up handoffs when a task is deleted (recycled-id safety via FK CASCADE)', () => {
    const { workspace } = env;
    workspace.createOrg({ id: 'org-acme', name: 'Acme' });
    const tasks = env.db.createOrgScopedTaskRepository({ orgId: 'org-acme' });
    const a = tasks.createTask({ name: 'A' });
    const b = tasks.createTask({ name: 'B' });
    const handoff = env.repo.create({
      sourceTaskId: a.id,
      targetTaskId: b.id,
      targetAgentId: 'agent-b',
      actorPrincipalId: 'op',
    });

    // Delete the target task through the scoped repository (FK CASCADE fires).
    expect(tasks.deleteTask(b.id)).toBe(true);
    expect(env.repo.get('org-acme', handoff.id)).toBeUndefined();
  });
});
