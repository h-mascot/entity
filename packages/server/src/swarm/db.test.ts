import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDbPath: string | null = null;

function legacySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS swarm_jobs (
      id TEXT PRIMARY KEY,
      task_id INTEGER NOT NULL,
      provider TEXT NOT NULL DEFAULT 'acp',
      status TEXT NOT NULL DEFAULT 'queued',
      summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS swarm_proofs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      proof_type TEXT NOT NULL DEFAULT 'artifact',
      proof_ref TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO swarm_jobs (id, task_id, provider, status, summary)
    VALUES ('legacy-job', 42, 'acp', 'queued', 'Legacy queued job');

    INSERT INTO swarm_proofs (id, job_id, proof_type, proof_ref)
    VALUES ('legacy-proof', 'legacy-job', 'artifact', 'legacy-ref');
  `);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (tmpDbPath) fs.rmSync(tmpDbPath, { force: true });
  tmpDbPath = null;
});

describe('swarm db schema migration', () => {
  it('upgrades legacy plugin-created swarm tables before repository use', async () => {
    tmpDbPath = path.join(os.tmpdir(), `entity-swarm-legacy-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    const legacyDb = new Database(tmpDbPath);
    legacySchema(legacyDb);
    legacyDb.close();

    vi.stubEnv('ENTITY_TASK_DB_PATH', tmpDbPath);
    vi.resetModules();
    const { createSwarmJob, listSwarmJobs } = await import('./db');

    const existing = listSwarmJobs();
    expect(existing[0]).toMatchObject({
      id: 'legacy-job',
      title: 'Legacy queued job',
      spec: 'Legacy queued job',
      dispatched_at: null,
    });

    const created = createSwarmJob({
      title: 'Unlinked first-run job',
      spec: 'Created after legacy schema migration',
      repo: '',
    });
    expect(created.task_id).toBeNull();

    const verifiedDb = new Database(tmpDbPath);
    const jobColumns = verifiedDb.prepare('PRAGMA table_info(swarm_jobs)').all() as Array<{ name: string; notnull: 0 | 1 }>;
    const proofColumns = verifiedDb.prepare('PRAGMA table_info(swarm_proofs)').all() as Array<{ name: string }>;
    verifiedDb.close();

    expect(jobColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'title',
      'spec',
      'repo',
      'run_handle',
      'dispatched_at',
    ]));
    expect(jobColumns.find((column) => column.name === 'task_id')?.notnull).toBe(0);
    expect(proofColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'provider',
      'commit_sha',
      'duration_sec',
    ]));
  });
});
