/**
 * Geordi Swarm — ACP Provider
 *
 * Wraps the existing Geordi ACP adapter running on Mac.
 */

import type {
  SwarmProvider,
  BuildJobPayload,
  DispatchResult,
  RunStatus,
  ProofBundle,
  ProviderHealth,
} from './interface';

const ACP_BASE = process.env.ACP_BASE_URL || 'http://localhost:8100';

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

const ACP_BASE_URL = trimTrailingSlash(ACP_BASE);

export class AcpProvider implements SwarmProvider {
  readonly name = 'acp';
  readonly label = 'Geordi (ACP/Codex on Mac)';

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const start = Date.now();

      const response = await fetch(`${ACP_BASE_URL}/ping`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const latencyMs = Date.now() - start;

      if (response.ok) {
        return { available: true, message: `ACP reachable at ${ACP_BASE_URL}`, latencyMs };
      }

      return { available: false, message: `ACP returned ${response.status} from /ping` };
    } catch (error) {
      return {
        available: false,
        message: `ACP unreachable at ${ACP_BASE_URL}: ${readErrorMessage(error)}`,
      };
    }
  }

  async dispatch(job: BuildJobPayload): Promise<DispatchResult> {
    const response = await fetch(`${ACP_BASE_URL}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: job.spec,
        workdir: job.repo,
        context: job.context,
        branch: job.branch,
      }),
    });

    if (!response.ok) {
      throw new Error(`ACP dispatch failed with HTTP ${response.status}`);
    }

    const data = (await response.json()) as { runId?: string | null };
    const runHandle = typeof data.runId === 'string' ? data.runId.trim() : '';
    if (!runHandle) {
      throw new Error('ACP dispatch succeeded without a runId; runtime is registered but not ready');
    }

    return { runHandle, estimatedMinutes: 15 };
  }

  async status(runHandle: string): Promise<RunStatus> {
    try {
      const response = await fetch(`${ACP_BASE_URL}/runs/${encodeURIComponent(runHandle)}`);
      if (!response.ok) {
        return {
          state: 'failed',
          progress: `ACP status lookup failed with HTTP ${response.status}`,
          updatedAt: new Date().toISOString(),
        };
      }

      const data = (await response.json()) as {
        status?: string;
        progress?: string;
        startedAt?: string;
      };
      return {
        state: (data.status as RunStatus['state']) || 'queued',
        progress: data.progress || 'ACP run registered',
        startedAt: data.startedAt,
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        state: 'failed',
        progress: `ACP unreachable during status lookup: ${readErrorMessage(error)}`,
        updatedAt: new Date().toISOString(),
      };
    }
  }

  async cancel(runHandle: string): Promise<void> {
    const response = await fetch(`${ACP_BASE_URL}/runs/${encodeURIComponent(runHandle)}/cancel`, { method: 'POST' });
    if (!response.ok) {
      throw new Error(`ACP cancel failed with HTTP ${response.status}`);
    }
  }

  async collectProof(runHandle: string): Promise<ProofBundle> {
    try {
      const response = await fetch(`${ACP_BASE_URL}/runs/${encodeURIComponent(runHandle)}`);
      if (response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        return {
          commitSha: (data.commitSha as string) || undefined,
          branch: (data.branch as string) || undefined,
          buildLog: (data.buildLog as string) || undefined,
          testResult: (data.testResult as 'pass' | 'fail' | 'skip') || undefined,
          testOutput: (data.testOutput as string) || undefined,
          durationSec: (data.durationSec as number) || undefined,
        };
      }
    } catch {
      // Fall through to empty proof
    }

    return {
      buildLog: 'Proof collection pending — ACP connection required',
    };
  }
}
