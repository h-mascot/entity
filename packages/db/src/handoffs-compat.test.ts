/**
 * THE-933 (R2) — deployed table collision.
 *
 * The repository already documents a DEPLOYED `task_handoffs` table with an
 * incompatible schema and sandbox rows. New code must NOT throw at startup,
 * alter destructively, or purge those rows. The new feature uses a distinct,
 * namespaced table (`entity_task_handoffs_v2`) and leaves the legacy table
 * untouched while preserving handoff atomicity/rollback in the new table.
 *
 * This mirrors production order: the tasks schema already exists, the deployed
 * legacy `task_handoffs` coexists, and the new feature repository initializes
 * afterward without touching the legacy table.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHandoffRepository } from './handoffs';
import { createTaskRepository } from './index';

const tmpDbPath = path.join(os.tmpdir(), `entity-handoffs-compat-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const originalDbPath = process.env.ENTITY_TASK_DB_PATH;

beforeAll(() => {
  process.env.ENTITY_TASK_DB_PATH = tmpDbPath;

  // 1) Production-like: stand up the full task schema first (tasks table exists).
  createTaskRepository();

  // 2) The DEPLOYED legacy `task_handoffs` table (different, incompatible
  //    columns) already coexists in production with two sandbox rows. FK
  //    enforcement is off for the seed insert (parent tasks need not match; the
  //    deployed shape — including the FK DDL — is preserved).
  const db = new Database(tmpDbPath);
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE task_handoffs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      source_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      target_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      target_agent_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'blocked', 'completed', 'cancelled')),
      reason TEXT,
      created_by_principal_id TEXT NOT NULL,
      accepted_by_principal_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const insertLegacy = db.prepare(
    `INSERT INTO task_handoffs (id, org_id, source_task_id, target_task_id, target_agent_id, status, reason, created_by_principal_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertLegacy.run('legacy-1', 'org-1', 1, 2, 'ada', 'pending', 'pre-existing', 'ops');
  insertLegacy.run('legacy-2', 'org-1', 3, 4, 'zora', 'accepted', 'pre-existing', 'ops');
  db.close();
});

afterAll(() => {
  if (originalDbPath !== undefined) process.env.ENTITY_TASK_DB_PATH = originalDbPath;
  else delete process.env.ENTITY_TASK_DB_PATH;
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(tmpDbPath + suffix, { force: true }); } catch {}
  }
});

function openDb() {
  return new Database(tmpDbPath);
}

function legacyIds(): string[] {
  const db = openDb();
  const rows = db.prepare('SELECT id FROM task_handoffs ORDER BY id').all() as Array<{ id: string }>;
  db.close();
  return rows.map((r) => r.id);
}

describe('THE-933 (R2) — namespaced table coexists with deployed legacy task_handoffs', () => {
  it('initializes the new repository without throwing over the legacy table', () => {
    expect(() => createHandoffRepository()).not.toThrow();
  });

  it('leaves the legacy task_handoffs schema + rows unchanged (no destructive alter / purge)', () => {
    // Initializing the new repo must not have touched the legacy table.
    expect(legacyIds()).toEqual(['legacy-1', 'legacy-2']);
    const db = openDb();
    const cols = db.prepare('PRAGMA table_info(task_handoffs)').all() as Array<{ name: string }>;
    db.close();
    const names = new Set(cols.map((c) => c.name));
    // Legacy deployed shape is preserved (incompatible with the new feature).
    expect(names.has('source_task_id')).toBe(true);
    expect(names.has('target_agent_id')).toBe(true);
    expect(names.has('status')).toBe(true);
    expect(names.has('mode')).toBe(false);
    expect(names.has('cloud_id')).toBe(false);
    // The new feature lives in its own namespaced table.
    const db2 = openDb();
    const v2Cols = db2.prepare('PRAGMA table_info(entity_task_handoffs_v2)').all() as Array<{ name: string }>;
    db2.close();
    const v2Names = new Set(v2Cols.map((c) => c.name));
    expect(v2Names.has('mode')).toBe(true);
    expect(v2Names.has('cloud_id')).toBe(true);
  });

  it('new handoff atomicity + rollback work in the namespaced table; legacy untouched', () => {
    const tasks = createTaskRepository();
    const task = tasks.createTask({ name: 'compat-task', org_id: 'org-1', team_id: 'team-1', owner_principal_id: 'alice' });
    const handoffs = createHandoffRepository();

    const legacyBefore = legacyIds();

    // Atomic create: task owner reassigned + handoff edge committed together.
    const handoff = handoffs.create({
      taskId: task.id,
      mode: 'local',
      sourcePrincipalId: 'alice',
      targetPrincipalId: 'bob',
      orgId: 'org-1',
      teamId: 'team-1',
    });
    expect(tasks.getTask(task.id)!.owner_principal_id).toBe('bob');

    // Rollback reverses the edge atomically in the new table.
    const rolled = handoffs.rollback(handoff.id, { taskId: task.id, mode: 'local', orgId: 'org-1' });
    expect(rolled.task_id).toBe(task.id);
    expect(tasks.getTask(task.id)!.owner_principal_id).toBe('alice');

    // The legacy table is completely untouched: same rows, same order.
    expect(legacyIds()).toEqual(legacyBefore);

    // The new edges live ONLY in the namespaced table.
    const db = openDb();
    const v2Count = (db.prepare('SELECT COUNT(*) AS c FROM entity_task_handoffs_v2 WHERE task_id = ?').get(task.id) as { c: number }).c;
    db.close();
    expect(v2Count).toBeGreaterThanOrEqual(2);
  });
});
