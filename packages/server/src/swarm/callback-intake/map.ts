/**
 * EEPC-A-03 — Map validated callbacks to durable ActivityEvent-compatible records.
 */

import { ACTIVITY_EVENT_PAYLOAD_VERSION, type ActivityEventType } from '../../../../db/src';
import type { ActivityEventAppendInput } from '../../activity-events';
import type { ActivityEventKind } from '../manifest/types';
import type {
  CallbackValidationResult,
  ExecutionCallbackPayload,
  IntakeCallbackEvent,
  MappedCallbackActivityRecord,
} from './types';

const KIND_TO_EVENT_TYPE: Record<IntakeCallbackEvent, ActivityEventType> = {
  plan: 'task_updated',
  progress: 'task_updated',
  proof: 'artifact_linked',
  status: 'status_changed',
  blocker: 'task_blocked',
};

function descriptionFor(payload: ExecutionCallbackPayload): string {
  switch (payload.event) {
    case 'plan':
      return payload.plan!.summary;
    case 'progress':
      return payload.progress!.summary;
    case 'proof':
      return payload.proof!.summary;
    case 'status':
      return payload.status!.summary;
    case 'blocker':
      return payload.blocker!.summary;
  }
}

function publicEventBody(payload: ExecutionCallbackPayload): Record<string, unknown> {
  switch (payload.event) {
    case 'plan':
      return {
        summary: payload.plan!.summary,
        steps: payload.plan!.steps ?? [],
      };
    case 'progress':
      return {
        summary: payload.progress!.summary,
        percent: payload.progress!.percent ?? null,
        feedback: payload.progress!.feedback ?? null,
      };
    case 'proof':
      return {
        summary: payload.proof!.summary,
        commit_sha: payload.proof!.commit_sha ?? null,
        branch: payload.proof!.branch ?? null,
        test_result: payload.proof!.test_result ?? null,
        artifact_refs: payload.proof!.artifact_refs ?? [],
      };
    case 'status':
      return {
        summary: payload.status!.summary,
        status: payload.status!.status ?? null,
        run_state: payload.status!.run_state ?? null,
      };
    case 'blocker':
      return {
        summary: payload.blocker!.summary,
        reason: payload.blocker!.reason,
        code: payload.blocker!.code ?? null,
      };
  }
}

export function mapValidatedCallbackToActivityRecord(
  validated: Extract<CallbackValidationResult, { ok: true }>,
): MappedCallbackActivityRecord {
  const { payload, job, activityEventKind, manifest } = validated;
  const eventType = KIND_TO_EVENT_TYPE[payload.event];
  const description = descriptionFor(payload);
  const actorPrincipalId =
    payload.actorPrincipalId?.trim() ||
    `execution-engine:${manifest.identity.name}`;
  const occurredAt = payload.occurredAt ?? new Date().toISOString();
  const warnings: Array<{ code: string; message: string }> = [];

  if (job.task_id == null) {
    warnings.push({
      code: 'missing_task_link',
      message: 'Job has no task_id; ActivityEvent mapped but not task-persisted',
    });
  }

  const eventBody = publicEventBody(payload);
  const activityPayload: Record<string, unknown> = {
    version: ACTIVITY_EVENT_PAYLOAD_VERSION,
    actor_principal_id: actorPrincipalId,
    actor_type: 'agent',
    task_id: job.task_id ?? undefined,
    reason: payload.event === 'blocker' ? payload.blocker!.reason : undefined,
    previous_state: payload.event === 'status' ? String(job.status) : undefined,
    new_state: payload.event === 'status' ? payload.status?.status ?? undefined : undefined,
    object_refs: [
      { object_type: 'task', object_id: String(job.task_id ?? 'unlinked'), link_role: 'origin' },
      { object_type: 'swarm_job', object_id: job.id, link_role: 'execution' },
      { object_type: 'execution_engine', object_id: manifest.identity.id, link_role: 'provider' },
    ],
    data: {
      source: 'execution-engine-callback',
      execution_callback_kind: payload.event,
      activity_event_kind: activityEventKind as ActivityEventKind,
      provider: payload.provider,
      provider_id: manifest.identity.id,
      job_id: job.id,
      job_status: job.status,
      idempotency_key: payload.idempotencyKey ?? null,
      occurred_at: occurredAt,
      event_body: eventBody,
      ...(payload.data ?? {}),
    },
    warnings: warnings.length ? warnings : undefined,
  };

  const appendInput: ActivityEventAppendInput = {
    eventType,
    action: `execution-engine:${payload.event}`,
    description,
    actorPrincipalId,
    actorType: 'agent',
    payload: activityPayload,
    metadata: {
      source: 'eepc-a-03-callback-intake',
      provider: payload.provider,
      job_id: job.id,
      kind: payload.event,
    },
  };

  return {
    kind: payload.event,
    activityEventKind,
    eventType,
    action: appendInput.action,
    description,
    actorType: 'agent',
    actorPrincipalId,
    taskId: job.task_id,
    jobId: job.id,
    provider: payload.provider,
    idempotencyKey: payload.idempotencyKey ?? null,
    occurredAt,
    payload: activityPayload,
    appendInput,
    persisted: false,
    degraded: warnings.length > 0,
    warnings,
  };
}
