import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ensureSwarmSchema } from './db';

const ACTIVE_STATUSES = ['draft', 'queued', 'dispatched', 'running'];

/**
 * Create the CURRENT swarm_jobs schema but WITHOUT the partial unique active-task
 * index, simulating a database that pre-dates the duplicate-active guard (or one
 * where duplicates were inserted out-of-band). ensureSwarmSchema must reconcile
 * before (re)creating that index, otherwise CREATE UNIQUE INDEX aborts.
 */
function newSchemaWithoutUniqueIndex(db: Database.Database): void {
  db.exec(`
    CREATE TABLE swarm_jobs (
      id            TEXT PRIMARY KEY,
      task_id       INTEGER,
      title         TEXT NOT NULL,
      spec          TEXT NOT NULL,
      repo          TEXT NOT NULL,
      branch        TEXT,
      provider      TEXT NOT NULL DEFAULT 'acp',
      status        TEXT NOT NULL DEFAULT 'draft',
      priority      TEXT NOT NULL DEFAULT 'medium',
      context_file  TEXT,
      run_handle    TEXT,
      retry_count   INTEGER NOT NULL DEFAULT 0,
      max_retries   INTEGER NOT NULL DEFAULT 3,
      feedback      TEXT,
      created_by    TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      dispatched_at TEXT,
      completed_at  TEXT
    );
  `);
}

function insertJob(
  db: Database.Database,
  fields: { id: string; task_id: number | null; status: string; created_at: string },
): void {
  db.prepare(
    `INSERT INTO swarm_jobs (id, task_id, title, spec, repo, status, created_at)
     VALUES (@id, @task_id, @title, @spec, 'repo', @status, @created_at)`,
  ).run({
    id: fields.id,
    task_id: fields.task_id,
    title: `Job ${fields.id}`,
    spec: `spec ${fields.id}`,
    status: fields.status,
    created_at: fields.created_at,
  });
}

function activeIds(db: Database.Database, taskId: number): string[] {
  const placeholders = ACTIVE_STATUSES.map(() => '?').join(', ');
  return (
    db
      .prepare(
        `SELECT id FROM swarm_jobs WHERE task_id = ? AND status IN (${placeholders})`,
      )
      .all(taskId, ...ACTIVE_STATUSES) as Array<{ id: string }>
  ).map((row) => row.id);
}

describe('ensureSwarmSchema — duplicate active task job reconciliation (D3)', () => {
  it('preserves the newest winner and terminalizes duplicate active jobs before the unique index', () => {
    const dbPath = path.join(os.tmpdir(), `entity-swarm-dup-${process.pid}-${Date.now()}.db`);
    const setup = new Database(dbPath);
    newSchemaWithoutUniqueIndex(setup);
    // Three active jobs for task 500, plus an already-terminal job and an
    // unlinked active job that must remain exempt.
    insertJob(setup, { id: 'a', task_id: 500, status: 'draft', created_at: '2026-08-05T09:00:00Z' });
    insertJob(setup, { id: 'b', task_id: 500, status: 'queued', created_at: '2026-08-05T10:00:00Z' }); // newest -> winner
    insertJob(setup, { id: 'c', task_id: 500, status: 'running', created_at: '2026-08-05T08:00:00Z' });
    insertJob(setup, { id: 'done-job', task_id: 500, status: 'done', created_at: '2026-08-05T07:00:00Z' });
    insertJob(setup, { id: 'unlinked', task_id: null, status: 'running', created_at: '2026-08-05T11:00:00Z' });
    setup.close();

    const db = new Database(dbPath);
    // Without reconciliation this throws on CREATE UNIQUE INDEX.
    expect(() => ensureSwarmSchema(db)).not.toThrow();

    // Exactly one active job remains, and it is the newest (the winner).
    expect(activeIds(db, 500)).toEqual(['b']);

    // The losers were safely terminalized as superseded (cancelled) with proof metadata.
    const losers = db
      .prepare(`SELECT id, status, feedback, completed_at FROM swarm_jobs WHERE id IN ('a', 'c') ORDER BY id`)
      .all() as Array<{ id: string; status: string; feedback: string; completed_at: string }>;
    expect(losers.map((row) => row.id)).toEqual(['a', 'c']);
    for (const loser of losers) {
      expect(loser.status).toBe('cancelled');
      expect(loser.completed_at).toBeTruthy();
      expect(loser.feedback).toMatch(/superseded/i);
    }

    // Pre-existing terminal + unlinked jobs are untouched.
    expect(
      (db.prepare(`SELECT status FROM swarm_jobs WHERE id = 'done-job'`).get() as { status: string }).status,
    ).toBe('done');
    expect(
      (db.prepare(`SELECT status, task_id FROM swarm_jobs WHERE id = 'unlinked'`).get() as {
        status: string;
        task_id: number | null;
      }).status,
    ).toBe('running');

    // The partial unique index now exists and is enforced: a second active insert fails.
    expect(() =>
      insertJob(db, { id: 'second-active', task_id: 500, status: 'queued', created_at: '2026-08-05T12:00:00Z' }),
    ).toThrow(/UNIQUE/i);

    db.close();
    for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(file, { force: true });
  });

  it('breaks ties deterministically (created_at equal -> id DESC) so the winner is reproducible', () => {
    const dbPath = path.join(os.tmpdir(), `entity-swarm-dup-tie-${process.pid}-${Date.now()}.db`);
    const setup = new Database(dbPath);
    newSchemaWithoutUniqueIndex(setup);
    const sameTime = '2026-08-05T10:00:00Z';
    insertJob(setup, { id: 'alpha', task_id: 600, status: 'queued', created_at: sameTime });
    insertJob(setup, { id: 'zeta', task_id: 600, status: 'running', created_at: sameTime });
    setup.close();

    const db = new Database(dbPath);
    expect(() => ensureSwarmSchema(db)).not.toThrow();
    // id DESC tiebreak -> 'zeta' wins; 'alpha' terminalized.
    expect(activeIds(db, 600)).toEqual(['zeta']);
    expect(
      (db.prepare(`SELECT status FROM swarm_jobs WHERE id = 'alpha'`).get() as { status: string }).status,
    ).toBe('cancelled');

    db.close();
    for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(file, { force: true });
  });

  it('is idempotent and a no-op when there are no duplicates', () => {
    const dbPath = path.join(os.tmpdir(), `entity-swarm-dup-idem-${process.pid}-${Date.now()}.db`);
    const setup = new Database(dbPath);
    newSchemaWithoutUniqueIndex(setup);
    // Single active job per task (clean) + one terminal — nothing to reconcile.
    insertJob(setup, { id: 'only', task_id: 700, status: 'queued', created_at: '2026-08-05T10:00:00Z' });
    insertJob(setup, { id: 'finished', task_id: 700, status: 'done', created_at: '2026-08-05T09:00:00Z' });
    setup.close();

    const db = new Database(dbPath);
    expect(() => ensureSwarmSchema(db)).not.toThrow();
    const snapshot = (db.prepare(`SELECT id, status FROM swarm_jobs ORDER BY id`).all() as Array<{
      id: string;
      status: string;
    }>).map((row) => `${row.id}:${row.status}`);

    // Re-running must be a no-op (additive/idempotent).
    expect(() => ensureSwarmSchema(db)).not.toThrow();
    expect(() => ensureSwarmSchema(db)).not.toThrow();
    const rerun = (db.prepare(`SELECT id, status FROM swarm_jobs ORDER BY id`).all() as Array<{
      id: string;
      status: string;
    }>).map((row) => `${row.id}:${row.status}`);
    expect(rerun).toEqual(snapshot);
    expect(activeIds(db, 700)).toEqual(['only']);

    db.close();
    for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(file, { force: true });
  });
});
