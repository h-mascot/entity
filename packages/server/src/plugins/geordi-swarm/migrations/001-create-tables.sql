CREATE TABLE IF NOT EXISTS swarm_jobs (
  id TEXT PRIMARY KEY,
  task_id INTEGER NOT NULL,
  provider TEXT NOT NULL DEFAULT 'acp',
  status TEXT NOT NULL DEFAULT 'queued',
  summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_swarm_jobs_task_id ON swarm_jobs(task_id);
CREATE INDEX IF NOT EXISTS idx_swarm_jobs_status ON swarm_jobs(status);

CREATE TABLE IF NOT EXISTS swarm_proofs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  proof_type TEXT NOT NULL DEFAULT 'artifact',
  proof_ref TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_swarm_proofs_job_id ON swarm_proofs(job_id);
