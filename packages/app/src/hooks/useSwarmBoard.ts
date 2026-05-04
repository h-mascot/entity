/**
 * Geordi Swarm — React Hook
 *
 * Fetches and manages swarm jobs for the board UI.
 * Includes proof fetching and auto-polling for active jobs.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { buildApiCandidates, requestJsonWithFallback } from '../lib/http';
import { runtime } from '../config/runtime';

export interface SwarmJob {
  id: string;
  task_id: number | null;
  title: string;
  spec: string;
  repo: string;
  branch: string | null;
  provider: string;
  status: string;
  priority: string;
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

export interface SwarmProof {
  id: string;
  job_id: string;
  provider: string;
  commit_sha: string | null;
  branch: string | null;
  build_log: string | null;
  test_result: string | null;
  test_output: string | null;
  screenshots: string | null;
  artifacts: string | null;
  duration_sec: number | null;
  created_at: string;
}

export interface SwarmProvider {
  name: string;
  label: string;
  meta?: {
    category?: string;
    executionMode?: string;
    description?: string;
    acceptsDispatch?: boolean;
    capabilities?: string[];
  };
}

function swarmUrl(path: string): string[] {
  return buildApiCandidates(`/swarm${path}`, runtime.apiBase);
}

/** Auto-poll interval when there are active (dispatched/running) jobs */
const ACTIVE_POLL_MS = 15_000;

export function useSwarmBoard() {
  const [jobs, setJobs] = useState<SwarmJob[]>([]);
  const [providers, setProviders] = useState<SwarmProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [proofsCache, setProofsCache] = useState<Record<string, SwarmProof[]>>({});
  const [polling, setPolling] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const data = await requestJsonWithFallback<{ jobs: SwarmJob[] }>({
        urls: swarmUrl('/jobs'),
        fallbackError: 'Failed to fetch swarm jobs',
      });
      setJobs(data.jobs || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch jobs');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchProviders = useCallback(async () => {
    try {
      const data = await requestJsonWithFallback<{ providers: SwarmProvider[] }>({
        urls: swarmUrl('/providers'),
        fallbackError: 'Failed to fetch providers',
      });
      setProviders(data.providers || []);
    } catch {
      // Non-critical
    }
  }, []);

  const fetchProofs = useCallback(async (jobId: string): Promise<SwarmProof[]> => {
    try {
      const data = await requestJsonWithFallback<{ proofs: SwarmProof[] }>({
        urls: swarmUrl(`/jobs/${jobId}/proofs`),
        fallbackError: 'Failed to fetch proofs',
      });
      const proofs = data.proofs || [];
      setProofsCache((prev) => ({ ...prev, [jobId]: proofs }));
      return proofs;
    } catch {
      return [];
    }
  }, []);

  const checkJobStatus = useCallback(async (jobId: string): Promise<void> => {
    try {
      await requestJsonWithFallback<{ job: SwarmJob; runStatus?: string }>({
        urls: swarmUrl(`/jobs/${jobId}/check`),
        fallbackError: 'Failed to check job status',
        init: { method: 'POST' },
      });
      await fetchJobs();
    } catch (err) {
      console.error('Status check failed:', err);
    }
  }, [fetchJobs]);

  useEffect(() => {
    void fetchJobs();
    void fetchProviders();
  }, [fetchJobs, fetchProviders]);

  // Track latest jobs in a ref to avoid stale closure in setInterval
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  // Auto-poll when there are active jobs
  useEffect(() => {
    const hasActiveJobs = jobs.some((j) =>
      j.status === 'dispatched' || j.status === 'running'
    );

    if (hasActiveJobs && !pollTimerRef.current) {
      setPolling(true);
      pollTimerRef.current = setInterval(() => {
        // Just refresh the full job list — single request instead of N
        void fetchJobs();
      }, ACTIVE_POLL_MS);
    } else if (!hasActiveJobs && pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
      setPolling(false);
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [jobs, fetchJobs]);

  const createJob = useCallback(async (input: {
    title: string;
    spec: string;
    repo: string;
    branch?: string;
    provider?: string;
    priority?: string;
    context_file?: string;
    task_id?: number;
    created_by?: string;
  }): Promise<SwarmJob> => {
    const data = await requestJsonWithFallback<{ job: SwarmJob }>({
      urls: swarmUrl('/jobs'),
      fallbackError: 'Failed to create job',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    });
    await fetchJobs();
    return data.job;
  }, [fetchJobs]);

  const dispatchJob = useCallback(async (jobId: string): Promise<void> => {
    await requestJsonWithFallback<{ job: SwarmJob }>({
      urls: swarmUrl(`/jobs/${jobId}/dispatch`),
      fallbackError: 'Failed to dispatch job',
      init: { method: 'POST' },
    });
    await fetchJobs();
  }, [fetchJobs]);

  const acceptJob = useCallback(async (jobId: string): Promise<void> => {
    await requestJsonWithFallback<{ job: SwarmJob }>({
      urls: swarmUrl(`/jobs/${jobId}/accept`),
      fallbackError: 'Failed to accept job',
      init: { method: 'POST' },
    });
    await fetchJobs();
  }, [fetchJobs]);

  const rejectJob = useCallback(async (jobId: string, feedback: string): Promise<void> => {
    await requestJsonWithFallback<{ job: SwarmJob }>({
      urls: swarmUrl(`/jobs/${jobId}/reject`),
      fallbackError: 'Failed to reject job',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback }),
      },
    });
    await fetchJobs();
  }, [fetchJobs]);

  const cancelJob = useCallback(async (jobId: string): Promise<void> => {
    await requestJsonWithFallback<{ job: SwarmJob }>({
      urls: swarmUrl(`/jobs/${jobId}/cancel`),
      fallbackError: 'Failed to cancel job',
      init: { method: 'POST' },
    });
    await fetchJobs();
  }, [fetchJobs]);

  const deleteJob = useCallback(async (jobId: string): Promise<void> => {
    await requestJsonWithFallback<{ ok: boolean }>({
      urls: swarmUrl(`/jobs/${jobId}`),
      fallbackError: 'Failed to delete job',
      init: { method: 'DELETE' },
    });
    await fetchJobs();
  }, [fetchJobs]);

  return {
    jobs,
    providers,
    loading,
    error,
    polling,
    proofsCache,
    fetchJobs,
    fetchProofs,
    checkJobStatus,
    createJob,
    dispatchJob,
    acceptJob,
    rejectJob,
    cancelJob,
    deleteJob,
  };
}

/**
 * Lightweight hook for fetching swarm jobs linked to a specific Entity task.
 * Used by TaskDetailPanel integration.
 */
export function useSwarmJobsForTask(taskId: number | null) {
  const [jobs, setJobs] = useState<SwarmJob[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLinkedJobs = useCallback(async () => {
    if (taskId == null) return;
    setLoading(true);
    try {
      const data = await requestJsonWithFallback<{ jobs: SwarmJob[] }>({
        urls: swarmUrl(`/jobs?task_id=${taskId}`),
        fallbackError: 'Failed to fetch linked swarm jobs',
      });
      setJobs(data.jobs || []);
    } catch {
      // Swarm not available — silently degrade
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void fetchLinkedJobs();
  }, [fetchLinkedJobs]);

  return { jobs, loading, refresh: fetchLinkedJobs };
}
