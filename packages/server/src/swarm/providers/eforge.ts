import type {
  SwarmProvider,
  BuildJobPayload,
  DispatchResult,
  RunStatus,
  ProofBundle,
  ProviderHealth,
} from "./interface";
import { updateSwarmJob, getSwarmJob, listSwarmJobs } from "../db";
import { writeEforgeQueueFile } from "./eforge-queue";

export interface EforgeProviderStatus extends ProviderHealth {
  mode: "api" | "queue" | "unconfigured";
  apiUrl?: string;
  webUrl?: string;
  monitorUrl?: string;
  queueDir?: string;
  jobId?: string;
  runHandle?: string;
  jobStatus?: string;
  feedback?: string;
  activeJobs?: {
    total: number;
    queued: number;
    running: number;
    review: number;
  };
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function extractJobId(runHandle?: string): string | undefined {
  if (!runHandle) return undefined;
  const value = runHandle.replace(/^eforge-pull:/, "").replace(/^eforge:/, "").trim();
  return value || undefined;
}

function countActiveJobs() {
  const jobs = listSwarmJobs().filter((job) => job.provider === "eforge");
  return {
    total: jobs.length,
    queued: jobs.filter((job) => job.status === "queued").length,
    running: jobs.filter((job) => ["dispatched", "running", "proof"].includes(job.status)).length,
    review: jobs.filter((job) => job.status === "review").length,
  };
}

export async function getEforgeProviderStatus(input?: {
  jobId?: string;
  runHandle?: string;
}): Promise<EforgeProviderStatus> {
  const apiUrl = readEnv("EFORGE_API_URL");
  const queueDir = readEnv("EFORGE_QUEUE_DIR");
  const webUrl = readEnv("EFORGE_WEB_URL");
  const resolvedJobId = input?.jobId ?? extractJobId(input?.runHandle);
  const job = resolvedJobId ? getSwarmJob(resolvedJobId) : undefined;
  const provider = new EforgeProvider();
  const health = await provider.healthCheck();

  return {
    available: health.available,
    message: health.message ?? "Unknown eforge status",
    latencyMs: health.latencyMs,
    mode: apiUrl ? "api" : queueDir ? "queue" : "unconfigured",
    apiUrl: apiUrl ? trimTrailingSlash(apiUrl) : undefined,
    webUrl: webUrl ? trimTrailingSlash(webUrl) : undefined,
    monitorUrl: webUrl ? trimTrailingSlash(webUrl) : undefined,
    queueDir,
    jobId: job?.id ?? resolvedJobId,
    runHandle: input?.runHandle ?? job?.run_handle ?? undefined,
    jobStatus: job?.status,
    feedback: job?.feedback ?? undefined,
    activeJobs: countActiveJobs(),
  };
}

export class EforgeProvider implements SwarmProvider {
  readonly name = "eforge";
  readonly label = "eforge (blind-review build system)";
  readonly meta = {
    category: "build-system" as const,
    executionMode: "hybrid" as const,
    acceptsDispatch: true,
    description: "Spec-to-code build engine using isolated worktrees and blind review.",
    capabilities: ["spec-to-code", "blind-review", "git-worktrees", "queue-write"],
  };

  async healthCheck(): Promise<ProviderHealth> {
    const apiUrl = readEnv("EFORGE_API_URL");
    const queueDir = readEnv("EFORGE_QUEUE_DIR");

    if (apiUrl) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const start = Date.now();
        const response = await fetch(apiUrl, { signal: controller.signal });
        clearTimeout(timeout);
        const latencyMs = Date.now() - start;
        if (response.ok) {
          return { available: true, message: `eforge reachable at ${apiUrl}`, latencyMs };
        }
        return { available: false, message: `eforge returned ${response.status}` };
      } catch (error) {
        return { available: false, message: `eforge unreachable: ${error instanceof Error ? error.message : "unknown error"}` };
      }
    }

    if (queueDir) {
      return { available: true, message: `eforge queue configured at ${queueDir}` };
    }

    return {
      available: false,
      message: "eforge not configured. Set EFORGE_API_URL or EFORGE_QUEUE_DIR.",
    };
  }

  async dispatch(job: BuildJobPayload): Promise<DispatchResult> {
    const queueDir = readEnv("EFORGE_QUEUE_DIR");
    const webUrl = readEnv("EFORGE_WEB_URL");

    if (!queueDir) {
      throw new Error("eforge dispatch requires EFORGE_QUEUE_DIR until API push mode is implemented");
    }

    const queueWrite = await writeEforgeQueueFile(queueDir, job, {
      provider: this.name,
      web_url: webUrl || null,
      run_handle_hint: `eforge:${job.jobId}`,
    });

    const updated = updateSwarmJob(job.jobId, {
      status: "queued",
      run_handle: `eforge:${job.jobId}`,
      feedback: `Queued for eforge at ${queueWrite.queueFile}`,
      dispatched_at: new Date().toISOString(),
    });

    if (!updated) {
      throw new Error(`Failed to mark job ${job.jobId} as queued for eforge`);
    }

    return {
      runHandle: `eforge:${job.jobId}`,
      estimatedMinutes: 20,
      jobStatus: "queued",
    };
  }

  async status(runHandle: string): Promise<RunStatus> {
    const jobId = runHandle.replace(/^eforge-pull:/, "").replace(/^eforge:/, "");
    const job = getSwarmJob(jobId);
    if (!job) {
      return { state: "queued", progress: "Job not found" };
    }

    const stateMap: Record<string, RunStatus["state"]> = {
      draft: "queued",
      queued: "queued",
      dispatched: "running",
      running: "running",
      proof: "running",
      review: "running",
      done: "completed",
      failed: "failed",
      cancelled: "cancelled",
    };

    return {
      state: stateMap[job.status] ?? "running",
      progress: job.feedback || job.status,
      startedAt: job.dispatched_at || undefined,
      updatedAt: job.updated_at,
    };
  }

  async cancel(runHandle: string): Promise<void> {
    const jobId = runHandle.replace(/^eforge-pull:/, "").replace(/^eforge:/, "");
    updateSwarmJob(jobId, {
      status: "cancelled",
      completed_at: new Date().toISOString(),
      feedback: "Cancelled from Entity before eforge completion",
    });
  }

  async collectProof(runHandle: string): Promise<ProofBundle> {
    const jobId = runHandle.replace(/^eforge-pull:/, "").replace(/^eforge:/, "");
    const job = getSwarmJob(jobId);
    return {
      buildLog: job?.feedback || "Proof pending - eforge writes proof back via Swarm API",
      artifacts: {
        engine: "eforge",
        reviewMode: "blind-review",
        webUrl: readEnv("EFORGE_WEB_URL") || null,
      },
    };
  }
}
