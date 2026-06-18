/**
 * Geordi Swarm — Database Layer
 *
 * Plugin-owned tables: swarm_jobs, swarm_proofs.
 * Uses the same SQLite instance as Entity (via getEntityDatabase).
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getEntityDatabase } from '../../../db/src/entity-db';
import type {
  SwarmJob,
  CreateSwarmJobInput,
  UpdateSwarmJobInput,
  SwarmProof,
  CreateSwarmProofInput,
  SwarmJobStatus,
} from './types';

// ── Schema ──

type SqliteColumnInfo = {
  name: string;
  notnull: 0 | 1;
};

function tableColumns(db: Database.Database, table: string): Map<string, SqliteColumnInfo> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as SqliteColumnInfo[];
  return new Map(rows.map((row) => [row.name, row]));
}

function createSwarmTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS swarm_jobs (
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

    CREATE TABLE IF NOT EXISTS swarm_proofs (
      id            TEXT PRIMARY KEY,
      job_id        TEXT NOT NULL REFERENCES swarm_jobs(id),
      provider      TEXT NOT NULL,
      commit_sha    TEXT,
      branch        TEXT,
      build_log     TEXT,
      test_result   TEXT,
      test_output   TEXT,
      screenshots   TEXT,
      artifacts     TEXT,
      duration_sec  INTEGER,
      proof_type    TEXT NOT NULL DEFAULT 'artifact',
      proof_ref     TEXT NOT NULL DEFAULT 'proof',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function ensureSwarmIndexes(db: Database.Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_swarm_jobs_status ON swarm_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_swarm_jobs_task   ON swarm_jobs(task_id);
    CREATE INDEX IF NOT EXISTS idx_swarm_proofs_job ON swarm_proofs(job_id);
  `);
}

function migrateLegacySwarmJobs(db: Database.Database): void {
  const columns = tableColumns(db, 'swarm_jobs');
  const requiredColumns = [
    'title',
    'spec',
    'repo',
    'branch',
    'priority',
    'context_file',
    'run_handle',
    'retry_count',
    'max_retries',
    'feedback',
    'created_by',
    'dispatched_at',
    'completed_at',
  ];
  const taskIdIsLegacyRequired = columns.get('task_id')?.notnull === 1;
  if (!taskIdIsLegacyRequired && requiredColumns.every((column) => columns.has(column))) {
    return;
  }

  db.exec(`
    DROP TABLE IF EXISTS swarm_jobs_legacy_migration;
    ALTER TABLE swarm_jobs RENAME TO swarm_jobs_legacy_migration;

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

    INSERT INTO swarm_jobs (
      id, task_id, title, spec, repo, branch, provider, status, priority,
      context_file, run_handle, retry_count, max_retries, feedback, created_by,
      created_at, updated_at, dispatched_at, completed_at
    )
    SELECT
      id,
      task_id,
      COALESCE(NULLIF(summary, ''), 'Untitled swarm job') AS title,
      COALESCE(NULLIF(summary, ''), 'Migrated legacy swarm job') AS spec,
      '' AS repo,
      NULL AS branch,
      COALESCE(NULLIF(provider, ''), 'acp') AS provider,
      COALESCE(NULLIF(status, ''), 'queued') AS status,
      'medium' AS priority,
      NULL AS context_file,
      NULL AS run_handle,
      0 AS retry_count,
      3 AS max_retries,
      NULL AS feedback,
      NULL AS created_by,
      COALESCE(created_at, datetime('now')) AS created_at,
      COALESCE(updated_at, datetime('now')) AS updated_at,
      NULL AS dispatched_at,
      NULL AS completed_at
    FROM swarm_jobs_legacy_migration;

    DROP TABLE swarm_jobs_legacy_migration;
  `);
}

function migrateLegacySwarmProofs(db: Database.Database): void {
  const columns = tableColumns(db, 'swarm_proofs');
  const requiredColumns = [
    'provider',
    'commit_sha',
    'branch',
    'build_log',
    'test_result',
    'test_output',
    'screenshots',
    'artifacts',
    'duration_sec',
  ];
  if (requiredColumns.every((column) => columns.has(column))) {
    return;
  }

  db.exec(`
    DROP TABLE IF EXISTS swarm_proofs_legacy_migration;
    ALTER TABLE swarm_proofs RENAME TO swarm_proofs_legacy_migration;

    CREATE TABLE swarm_proofs (
      id            TEXT PRIMARY KEY,
      job_id        TEXT NOT NULL REFERENCES swarm_jobs(id),
      provider      TEXT NOT NULL,
      commit_sha    TEXT,
      branch        TEXT,
      build_log     TEXT,
      test_result   TEXT,
      test_output   TEXT,
      screenshots   TEXT,
      artifacts     TEXT,
      duration_sec  INTEGER,
      proof_type    TEXT NOT NULL DEFAULT 'artifact',
      proof_ref     TEXT NOT NULL DEFAULT 'proof',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO swarm_proofs (
      id, job_id, provider, commit_sha, branch, build_log, test_result,
      test_output, screenshots, artifacts, duration_sec, proof_type, proof_ref, created_at
    )
    SELECT
      id,
      job_id,
      'acp' AS provider,
      NULL AS commit_sha,
      NULL AS branch,
      NULL AS build_log,
      NULL AS test_result,
      NULL AS test_output,
      NULL AS screenshots,
      NULL AS artifacts,
      NULL AS duration_sec,
      COALESCE(NULLIF(proof_type, ''), 'artifact') AS proof_type,
      COALESCE(NULLIF(proof_ref, ''), 'proof') AS proof_ref,
      COALESCE(created_at, datetime('now')) AS created_at
    FROM swarm_proofs_legacy_migration;

    DROP TABLE swarm_proofs_legacy_migration;
  `);
}

export function ensureSwarmSchema(db: Database.Database): void {
  const migrate = db.transaction(() => {
    createSwarmTables(db);
    migrateLegacySwarmJobs(db);
    migrateLegacySwarmProofs(db);
    ensureSwarmIndexes(db);
  });
  migrate();
}

// ── Repository ──

let _db: Database.Database | null = null;

const SWARM_JOB_UPDATE_FIELDS = [
  'title',
  'spec',
  'repo',
  'branch',
  'provider',
  'status',
  'priority',
  'context_file',
  'run_handle',
  'feedback',
  'retry_count',
  'dispatched_at',
  'completed_at',
] as const;

type SwarmJobUpdateField = (typeof SWARM_JOB_UPDATE_FIELDS)[number];

function db(): Database.Database {
  if (!_db) {
    _db = getEntityDatabase(ensureSwarmSchema);
  }
  return _db;
}

function generateId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 20);
}

// ── Jobs ──

export function listSwarmJobs(filters?: { status?: string; task_id?: number }): SwarmJob[] {
  let sql = 'SELECT * FROM swarm_jobs';
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters?.status === 'ready') {
    conditions.push("status = 'queued'");
  } else if (filters?.status) {
    conditions.push('status = @status');
    params.status = filters.status;
  }
  if (filters?.task_id !== undefined) {
    conditions.push('task_id = @task_id');
    params.task_id = filters.task_id;
  }

  if (conditions.length) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY created_at DESC LIMIT 200';

  return db().prepare(sql).all(params) as SwarmJob[];
}

export function getSwarmJob(id: string): SwarmJob | undefined {
  return db().prepare('SELECT * FROM swarm_jobs WHERE id = ?').get(id) as SwarmJob | undefined;
}

export function createSwarmJob(input: CreateSwarmJobInput): SwarmJob {
  const id = generateId();
  const now = new Date().toISOString();

  db().prepare(`
    INSERT INTO swarm_jobs (id, task_id, title, spec, repo, branch, provider, status, priority, context_file, created_by, created_at, updated_at)
    VALUES (@id, @task_id, @title, @spec, @repo, @branch, @provider, 'draft', @priority, @context_file, @created_by, @now, @now)
  `).run({
    id,
    task_id: input.task_id ?? null,
    title: input.title,
    spec: input.spec,
    repo: input.repo,
    branch: input.branch ?? null,
    provider: input.provider ?? 'acp',
    priority: input.priority ?? 'medium',
    context_file: input.context_file ?? null,
    created_by: input.created_by ?? null,
    now,
  });

  return getSwarmJob(id)!;
}

export function updateSwarmJob(id: string, updates: UpdateSwarmJobInput): SwarmJob | undefined {
  const sets: string[] = ['updated_at = @now'];
  const params: Record<string, unknown> = { id, now: new Date().toISOString() };

  for (const key of SWARM_JOB_UPDATE_FIELDS) {
    const value = updates[key as SwarmJobUpdateField];
    if (value !== undefined) {
      sets.push(`${key} = @${key}`);
      params[key] = value;
    }
  }

  db().prepare(`UPDATE swarm_jobs SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return getSwarmJob(id);
}



export function claimSwarmJob(id: string, options?: {
  claimedBy?: string;
  runHandle?: string;
  fromStatuses?: SwarmJobStatus[];
  targetStatus?: SwarmJobStatus;
}): SwarmJob | null {
  const claimedBy = options?.claimedBy?.trim() || 'symphony';
  const targetStatus = options?.targetStatus ?? 'dispatched';
  const runHandle = options?.runHandle?.trim() || `claimed:${claimedBy}:${Date.now()}`;
  const fromStatuses = options?.fromStatuses ?? ['queued'];
  const now = new Date().toISOString();

  const placeholders = fromStatuses.map((_, index) => `@status${index}`).join(', ');
  const params: Record<string, unknown> = { id, now, runHandle };
  fromStatuses.forEach((status, index) => {
    params[`status${index}`] = status;
  });

  const result = db().prepare(`
    UPDATE swarm_jobs
    SET status = @targetStatus,
        dispatched_at = COALESCE(dispatched_at, @now),
        run_handle = COALESCE(NULLIF(@runHandle, ''), run_handle),
        updated_at = @now
    WHERE id = @id
      AND status IN (${placeholders})
  `).run({ ...params, targetStatus });

  if (result.changes === 0) return null;
  return getSwarmJob(id) ?? null;
}

export function releaseSwarmJob(id: string, options?: {
  fromStatuses?: SwarmJobStatus[];
  targetStatus?: SwarmJobStatus;
  clearRunHandle?: boolean;
}): SwarmJob | null {
  const fromStatuses = options?.fromStatuses ?? ['dispatched', 'running'];
  const targetStatus = options?.targetStatus ?? 'queued';
  const clearRunHandle = options?.clearRunHandle ?? true;
  const now = new Date().toISOString();
  const placeholders = fromStatuses.map((_, index) => `@status${index}`).join(', ');
  const params: Record<string, unknown> = { id, now, targetStatus };
  fromStatuses.forEach((status, index) => {
    params[`status${index}`] = status;
  });

  const result = db().prepare(`
    UPDATE swarm_jobs
    SET status = @targetStatus,
        run_handle = CASE WHEN @clearRunHandle = 1 THEN NULL ELSE run_handle END,
        updated_at = @now
    WHERE id = @id
      AND status IN (${placeholders})
  `).run({ ...params, clearRunHandle: clearRunHandle ? 1 : 0 });

  if (result.changes === 0) return null;
  return getSwarmJob(id) ?? null;
}

export function deleteSwarmJob(id: string): boolean {
  const result = db().prepare('DELETE FROM swarm_jobs WHERE id = ?').run(id);
  return result.changes > 0;
}

// ── Proofs ──

export function listSwarmProofs(jobId: string): SwarmProof[] {
  return db().prepare('SELECT * FROM swarm_proofs WHERE job_id = ? ORDER BY created_at DESC').all(jobId) as SwarmProof[];
}

export function createSwarmProof(input: CreateSwarmProofInput): SwarmProof {
  const id = generateId();
  const now = new Date().toISOString();

  db().prepare(`
    INSERT INTO swarm_proofs (id, job_id, provider, commit_sha, branch, build_log, test_result, test_output, screenshots, artifacts, duration_sec, created_at, proof_type, proof_ref)
    VALUES (@id, @job_id, @provider, @commit_sha, @branch, @build_log, @test_result, @test_output, @screenshots, @artifacts, @duration_sec, @now, @proof_type, @proof_ref)
  `).run({
    id,
    job_id: input.job_id,
    provider: input.provider,
    commit_sha: input.commit_sha ?? null,
    branch: input.branch ?? null,
    build_log: input.build_log ?? null,
    test_result: input.test_result ?? null,
    test_output: input.test_output ?? null,
    screenshots: input.screenshots ? JSON.stringify(input.screenshots) : null,
    artifacts: input.artifacts ? JSON.stringify(input.artifacts) : null,
    duration_sec: input.duration_sec ?? null,
    proof_type: 'artifact',
    proof_ref: input.commit_sha || input.build_log || 'proof',
    now,
  });

  return db().prepare('SELECT * FROM swarm_proofs WHERE id = ?').get(id) as SwarmProof;
}

// ── Stats ──

export function getSwarmStats(): { total: number; by_status: Record<string, number> } {
  const rows = db().prepare('SELECT status, COUNT(*) as count FROM swarm_jobs GROUP BY status').all() as Array<{ status: string; count: number }>;
  const by_status: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    by_status[row.status] = row.count;
    total += row.count;
  }
  return { total, by_status };
}
