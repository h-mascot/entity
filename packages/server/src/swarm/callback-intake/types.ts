/**
 * EEPC-A-03 — Execution-engine callback intake → ActivityEvent mapping types.
 *
 * Pure contract for plan/progress/proof/status/blocker callbacks.
 * Does not register providers or mutate Swarm dispatch.
 */

import type { ActivityEventAppendInput } from '../../activity-events';
import type { ActivityEventType } from '../../../../db/src';
import type {
  ActivityEventKind,
  ExecutionEnginePluginManifest,
} from '../manifest/types';
import type { SwarmJobStatus } from '../types';

/** Callback events owned by EEPC-A-03 ActivityEvent spine (Q46). */
export const INTAKE_CALLBACK_EVENTS = [
  'plan',
  'progress',
  'proof',
  'status',
  'blocker',
] as const;
export type IntakeCallbackEvent = (typeof INTAKE_CALLBACK_EVENTS)[number];

export interface ExecutionCallbackJobRef {
  id: string;
  provider: string;
  task_id: number | null;
  status: SwarmJobStatus | string;
}

export interface ExecutionCallbackPlanBody {
  summary: string;
  steps?: string[];
}

export interface ExecutionCallbackProgressBody {
  summary: string;
  percent?: number;
  feedback?: string;
}

export interface ExecutionCallbackProofBody {
  summary: string;
  commit_sha?: string;
  branch?: string;
  test_result?: 'pass' | 'fail' | 'skip';
  artifact_refs?: string[];
}

export interface ExecutionCallbackStatusBody {
  summary: string;
  status?: SwarmJobStatus;
  run_state?: string;
}

export interface ExecutionCallbackBlockerBody {
  summary: string;
  reason: string;
  code?: string;
}

export interface ExecutionCallbackPayload {
  event: IntakeCallbackEvent;
  provider: string;
  jobId: string;
  idempotencyKey?: string;
  occurredAt?: string;
  actorPrincipalId?: string;
  plan?: ExecutionCallbackPlanBody;
  progress?: ExecutionCallbackProgressBody;
  proof?: ExecutionCallbackProofBody;
  status?: ExecutionCallbackStatusBody;
  blocker?: ExecutionCallbackBlockerBody;
  /** Public-safe structured extras only — secret-bearing keys are rejected. */
  data?: Record<string, unknown>;
}

export interface CallbackValidationIssue {
  path: string;
  code: string;
  message: string;
}

export type CallbackValidationResult =
  | {
      ok: true;
      payload: ExecutionCallbackPayload;
      manifest: ExecutionEnginePluginManifest;
      job: ExecutionCallbackJobRef;
      activityEventKind: ActivityEventKind;
      issues: [];
    }
  | {
      ok: false;
      payload?: undefined;
      manifest?: undefined;
      job?: undefined;
      activityEventKind?: undefined;
      issues: CallbackValidationIssue[];
      status: number;
      code: string;
      message: string;
    };

export interface MappedCallbackActivityRecord {
  kind: IntakeCallbackEvent;
  activityEventKind: ActivityEventKind;
  eventType: ActivityEventType;
  action: string;
  description: string;
  actorType: 'agent' | 'system';
  actorPrincipalId: string;
  taskId: number | null;
  jobId: string;
  provider: string;
  idempotencyKey: string | null;
  occurredAt: string;
  /** Public-safe payload suitable for ActivityEvent persistence / Workplane panels. */
  payload: Record<string, unknown>;
  appendInput: ActivityEventAppendInput;
  persisted: boolean;
  degraded: boolean;
  warnings: Array<{ code: string; message: string }>;
}

export type CallbackIntakeResult =
  | {
      ok: true;
      record: MappedCallbackActivityRecord;
      status: number;
    }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      issues: CallbackValidationIssue[];
    };

export interface CallbackIntakeDependencies {
  getManifest: (provider: string) => ExecutionEnginePluginManifest | undefined;
  getJob: (jobId: string) => ExecutionCallbackJobRef | undefined;
  /** Optional durable append — when omitted, mapping still succeeds without persistence. */
  appendTaskEvent?: (
    taskId: number,
    input: ActivityEventAppendInput,
  ) => Promise<{ ok: true; value: unknown } | { ok: false; status: number; code: string; message: string }>;
}
