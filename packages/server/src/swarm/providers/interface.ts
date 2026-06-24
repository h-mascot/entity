/**
 * Geordi Swarm — Provider Interface
 *
 * All execution backends (ACP, Symphony, future) implement this contract.
 * The dispatcher talks only through this interface.
 */

import type { SwarmJobStatus } from '../types';

export interface ProviderHealth {
  available: boolean;
  message?: string;
  latencyMs?: number;
}

export interface BuildJobPayload {
  jobId: string;
  title: string;
  spec: string;
  repo: string;
  branch?: string;
  context?: string;
  feedback?: string;
  env?: Record<string, string>;
}

export interface DispatchResult {
  runHandle: string;
  jobStatus?: SwarmJobStatus;
  estimatedMinutes?: number;
}

export type RunState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface RunStatus {
  state: RunState;
  progress?: string;
  startedAt?: string;
  updatedAt?: string;
}

export interface ProofBundle {
  commitSha?: string;
  branch?: string;
  buildLog?: string;
  testResult?: 'pass' | 'fail' | 'skip';
  testOutput?: string;
  screenshots?: string[];
  artifacts?: Record<string, unknown>;
  durationSec?: number;
}

export interface SwarmProviderMetadata {
  category?: 'orchestration' | 'build-system' | 'delivery-control-plane' | 'environment';
  executionMode?: 'pull' | 'push' | 'hybrid';
  description?: string;
  acceptsDispatch?: boolean;
  capabilities?: string[];
}

export interface SwarmProvider {
  /** Unique provider identifier */
  readonly name: string;

  /** Human-readable label for UI */
  readonly label: string;

  /** Platform metadata for routing/UI */
  readonly meta?: SwarmProviderMetadata;

  /** Check if this provider is currently available */
  healthCheck(): Promise<ProviderHealth>;

  /** Dispatch a build job to this provider */
  dispatch(job: BuildJobPayload): Promise<DispatchResult>;

  /** Poll the status of a dispatched run */
  status(runHandle: string): Promise<RunStatus>;

  /** Cancel a running job (best-effort) */
  cancel(runHandle: string): Promise<void>;

  /** Collect proof artifacts after completion */
  collectProof(runHandle: string): Promise<ProofBundle>;
}
