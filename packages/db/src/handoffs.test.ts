/**
 * THE-933 — handoff repository: local-only enforcement, rollback scope, and
 * legacy-schema fail-closed.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHandoffRepository, ensureHandoffSchema } from './handoffs';
import { createTaskRepository } from './index';

const tmpDbPath = path.join(os.tmpdir(), `entity-handoffs-db-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const originalDbPath = process.env.ENTITY_TASK_DB_PATH;

beforeAll(() => {
  process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
});

afterAll(() => {
  if (originalDbPath !== undefined) process.env.ENTITY_TASK_DB_PATH = originalDbPath;
  else delete process.env.ENTITY_TASK_DB_PATH;
  try { fs.rmSync(tmpDbPath, { force: true }); } catch {}
});

describe('handoff repository — local-only enforcement (THE-933)', () => {
  it('refuses cloud mode at the local repository (no local task mutation)', () => {
    const repo = createTaskRepository();
    const task = repo.createTask({ name: 'local-task', org_id: 'org-1', team_id: 'team-1', owner_principal_id: 'alice' });
    const handoffs = createHandoffRepository();
    expect(() =>
      handoffs.create({
        taskId: task.id,
        mode: 'cloud',
        cloudId: 'cloud-ctx',
        sourcePrincipalId: 'alice',
        targetPrincipalId: 'bob',
        orgId: 'org-1',
        teamId: 'team-1',
      }),
    ).toThrow(/cloud_handoffs_unavailable|cloud/i);
    // Local task owner is untouched.
    expect(repo.getTask(task.id)!.owner_principal_id).toBe('alice');
  });
});

describe('handoff repository — rollback scope (THE-933)', () => {
  it('rejects a rollback whose task id does not match the handoff record', () => {
    const repo = createTaskRepository();
    const taskA = repo.createTask({ name: 'A', org_id: 'org-1', team_id: 'team-1', owner_principal_id: 'alice' });
    const taskB = repo.createTask({ name: 'B', org_id: 'org-1', team_id: 'team-1', owner_principal_id: 'carol' });
    const handoffs = createHandoffRepository();
    const handoff = handoffs.create({
      taskId: taskA.id,
      mode: 'local',
      sourcePrincipalId: 'alice',
      targetPrincipalId: 'bob',
      orgId: 'org-1',
      teamId: 'team-1',
    });

    expect(() =>
      handoffs.rollback(handoff.id, { taskId: taskB.id, mode: 'local', orgId: 'org-1' }),
    ).toThrow(/task.*scope|mismatch/i);
  });

  it('rejects a rollback whose mode does not match the handoff record', () => {
    const repo = createTaskRepository();
    const task = repo.createTask({ name: 'C', org_id: 'org-1', team_id: 'team-1', owner_principal_id: 'alice' });
    const handoffs = createHandoffRepository();
    const handoff = handoffs.create({
      taskId: task.id,
      mode: 'local',
      sourcePrincipalId: 'alice',
      targetPrincipalId: 'bob',
      orgId: 'org-1',
      teamId: 'team-1',
    });

    expect(() =>
      handoffs.rollback(handoff.id, { taskId: task.id, mode: 'cloud' as const, orgId: 'org-1', cloudId: 'ctx' }),
    ).toThrow(/mode.*mismatch|scope/i);
  });
});

describe('handoff repository — legacy schema fail-closed (THE-933)', () => {
  it('fails closed when a legacy task_handoffs table is missing required columns', () => {
    const db = new Database(':memory:');
    // Legacy shape predating the mode/cloud_id/accountability columns.
    db.exec(`
      CREATE TABLE task_handoffs (
        id TEXT PRIMARY KEY,
        task_id INTEGER NOT NULL,
        note TEXT
      );
    `);
    expect(() => ensureHandoffSchema(db)).toThrow(/task_handoffs_schema_incompatible/i);
    db.close();
  });

  it('creates the schema cleanly on a fresh database', () => {
    const db = new Database(':memory:');
    expect(() => ensureHandoffSchema(db)).not.toThrow();
    const cols = db.prepare("PRAGMA table_info(task_handoffs)").all() as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    expect(names.has('mode')).toBe(true);
    expect(names.has('cloud_id')).toBe(true);
    db.close();
  });
});
