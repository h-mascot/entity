/**
 * Geordi Swarm — Core Types
 *
 * Data model for the autonomous code factory plugin.
 * Swarm jobs are plugin-owned; they reference Entity tasks via optional FK
 * but never modify the tasks table schema.
 */

// ── Job Status Machine ──
// draft → queued → dispatched → running → proof → review → done
//                    │                              │
//                    └── failed ◄───────────────────┘
//                    └── cancelled
export const SWARM_JOB_STATUSES = [
  'draft',
  'queued',
  'dispatched',
  'running',
  'proof',
  'review',
  'done',
  'failed',
  'cancelled',
] as const;

export type SwarmJobStatus = (typeof SWARM_JOB_STATUSES)[number];

export const SWARM_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type SwarmPriority = (typeof SWARM_PRIORITIES)[number];

export interface SwarmJob {
  id: string;
  task_id: number | null;
  title: string;
  spec: string;
  repo: string;
  branch: string | null;
  provider: string;
  status: SwarmJobStatus;
  priority: SwarmPriority;
  context_file: string | null;
  run_handle: string | null;
  retry_count: number;
  max_retries: number;
  feedback: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  dispatched_at: string | null;
  completed_at: string | null;
}

export interface CreateSwarmJobInput {
  title: string;
  spec: string;
  repo: string;
  branch?: string;
  provider?: string;
  priority?: SwarmPriority;
  context_file?: string;
  task_id?: number;
  created_by?: string;
}

export interface UpdateSwarmJobInput {
  title?: string;
  spec?: string;
  repo?: string;
  branch?: string;
  provider?: string;
  status?: SwarmJobStatus;
  priority?: SwarmPriority;
  context_file?: string;
  run_handle?: string;
  feedback?: string;
  retry_count?: number;
  dispatched_at?: string;
  completed_at?: string;
}

export interface SwarmProof {
  id: string;
  job_id: string;
  provider: string;
  commit_sha: string | null;
  branch: string | null;
  build_log: string | null;
  test_result: 'pass' | 'fail' | 'skip' | null;
  test_output: string | null;
  screenshots: string | null; // JSON array
  artifacts: string | null;   // JSON object
  duration_sec: number | null;
  created_at: string;
}

export interface CreateSwarmProofInput {
  job_id: string;
  provider: string;
  commit_sha?: string;
  branch?: string;
  build_log?: string;
  test_result?: 'pass' | 'fail' | 'skip';
  test_output?: string;
  screenshots?: string[];
  artifacts?: Record<string, unknown>;
  duration_sec?: number;
}
