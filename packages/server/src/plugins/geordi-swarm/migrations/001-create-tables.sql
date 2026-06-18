CREATE TABLE IF NOT EXISTS swarm_jobs (
  id TEXT PRIMARY KEY,
  task_id INTEGER,
  title TEXT NOT NULL,
  spec TEXT NOT NULL,
  repo TEXT NOT NULL,
  branch TEXT,
  provider TEXT NOT NULL DEFAULT 'acp',
  status TEXT NOT NULL DEFAULT 'draft',
  priority TEXT NOT NULL DEFAULT 'medium',
  context_file TEXT,
  run_handle TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  feedback TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  dispatched_at TEXT,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_swarm_jobs_task_id ON swarm_jobs(task_id);
CREATE INDEX IF NOT EXISTS idx_swarm_jobs_status ON swarm_jobs(status);

CREATE TABLE IF NOT EXISTS swarm_proofs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES swarm_jobs(id),
  provider TEXT NOT NULL,
  commit_sha TEXT,
  branch TEXT,
  build_log TEXT,
  test_result TEXT,
  test_output TEXT,
  screenshots TEXT,
  artifacts TEXT,
  duration_sec INTEGER,
  proof_type TEXT NOT NULL DEFAULT 'artifact',
  proof_ref TEXT NOT NULL DEFAULT 'proof',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_swarm_proofs_job_id ON swarm_proofs(job_id);
