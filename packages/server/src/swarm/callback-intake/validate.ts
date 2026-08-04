/**
 * EEPC-A-03 — Validate execution-engine callback payloads against EEPC-A-02 manifests.
 * EEPC-A-07 — Unauthorized/malformed negative path + authRequired enforcement.
 */

import { SWARM_JOB_STATUSES, type SwarmJobStatus } from '../types';
import type { ActivityEventKind, ExecutionEnginePluginManifest } from '../manifest/types';
import { authorizeExecutionCallback } from './auth';
import { collectPrivatePathLeaks } from './public-safe';
import {
  INTAKE_CALLBACK_EVENTS,
  type CallbackAuthContext,
  type CallbackIntakeDependencies,
  type CallbackValidationIssue,
  type CallbackValidationResult,
  type ExecutionCallbackPayload,
  type IntakeCallbackEvent,
} from './types';

/** THE-932: bound externally supplied event detail and timestamps. */
const MAX_CALLBACK_DETAIL_CHARS = 2000;
const OCCURRED_AT_FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;
const OCCURRED_AT_AGE_TOLERANCE_MS = 365 * 24 * 60 * 60 * 1000;

function boundDetail(
  value: unknown,
  path: string,
  issues: CallbackValidationIssue[],
): string | undefined {
  const trimmed = readTrimmed(value);
  if (trimmed && trimmed.length > MAX_CALLBACK_DETAIL_CHARS) {
    issues.push(
      issue(path, 'detail_too_long', `detail fields must be at most ${MAX_CALLBACK_DETAIL_CHARS} characters`),
    );
    return undefined;
  }
  return trimmed;
}

function validateOccurredAt(
  value: unknown,
  issues: CallbackValidationIssue[],
): string | undefined {
  const trimmed = readTrimmed(value);
  if (!trimmed) return undefined;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    issues.push(issue('occurredAt', 'invalid_occurred_at', 'occurredAt must be an ISO-8601 timestamp'));
    return undefined;
  }
  const now = Date.now();
  if (parsed.getTime() - now > OCCURRED_AT_FUTURE_TOLERANCE_MS) {
    issues.push(issue('occurredAt', 'invalid_occurred_at', 'occurredAt cannot be more than 24h in the future'));
    return undefined;
  }
  if (now - parsed.getTime() > OCCURRED_AT_AGE_TOLERANCE_MS) {
    issues.push(issue('occurredAt', 'invalid_occurred_at', 'occurredAt cannot be more than 365 days in the past'));
    return undefined;
  }
  return parsed.toISOString();
}

/** Same posture as EEPC-A-02 manifest secret classification. */
const SECRET_KEY_HINT_RE =
  /(api[_-]?key|token|secret|password|authorization|bearer|credential)/i;

const SECRET_VALUE_RE =
  /^(Bearer\s+)?[A-Za-z0-9_\-]{32,}$|api[_-]?key\s*=|token\s*=|sk-[A-Za-z0-9]{10,}/i;

function issue(path: string, code: string, message: string): CallbackValidationIssue {
  return { path, code, message };
}

function fail(
  status: number,
  code: string,
  message: string,
  issues: CallbackValidationIssue[],
): CallbackValidationResult {
  return { ok: false, status, code, message, issues };
}

function isIntakeEvent(value: unknown): value is IntakeCallbackEvent {
  return typeof value === 'string' && (INTAKE_CALLBACK_EVENTS as readonly string[]).includes(value);
}

function readTrimmed(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function collectSecretLeaks(
  value: unknown,
  trail: string,
  out: CallbackValidationIssue[],
): void {
  if (typeof value === 'string') {
    if (SECRET_VALUE_RE.test(value.trim())) {
      out.push(issue(trail, 'secret_value_leak', 'Callback payload must not embed secret-like values'));
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectSecretLeaks(entry, `${trail}[${index}]`, out));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_HINT_RE.test(key) && child != null && child !== '') {
        out.push(
          issue(
            `${trail}.${key}`,
            'secret_key_forbidden',
            `Key "${key}" is secret-bearing and not allowed on public callback intake`,
          ),
        );
      }
      collectSecretLeaks(child, `${trail}.${key}`, out);
    }
  }
}

function resolveActivityEventKind(
  event: IntakeCallbackEvent,
  manifest: ExecutionEnginePluginManifest,
): ActivityEventKind | null {
  const intake = manifest.callbacks.intake.find((entry) => entry.event === event);
  if (intake?.activityEventKind) {
    return intake.activityEventKind;
  }
  if (manifest.activityEvents.emits.includes(event)) {
    return event;
  }
  // status/proof may be declared under complete/fail/claim aliases in older fixtures
  if (event === 'status' && manifest.activityEvents.emits.includes('status')) return 'status';
  if (event === 'proof' && manifest.activityEvents.emits.includes('proof')) return 'proof';
  if (event === 'blocker' && manifest.activityEvents.emits.includes('blocker')) return 'blocker';
  return null;
}

function eventAllowedByManifest(
  event: IntakeCallbackEvent,
  manifest: ExecutionEnginePluginManifest,
): boolean {
  if (manifest.callbacks.intake.some((entry) => entry.event === event)) return true;
  if (manifest.activityEvents.emits.includes(event)) return true;
  return false;
}

function requireSummary(
  event: IntakeCallbackEvent,
  value: unknown,
  path: string,
  issues: CallbackValidationIssue[],
): string | undefined {
  const summary = readTrimmed(value);
  if (!summary) {
    issues.push(issue(path, 'missing_summary', `${event} callback requires a non-empty summary`));
    return undefined;
  }
  if (summary.length > MAX_CALLBACK_DETAIL_CHARS) {
    issues.push(
      issue(path, 'detail_too_long', `summary must be at most ${MAX_CALLBACK_DETAIL_CHARS} characters`),
    );
    return undefined;
  }
  return summary;
}

export function parseCallbackPayloadShape(
  input: unknown,
): { ok: true; payload: ExecutionCallbackPayload } | { ok: false; issues: CallbackValidationIssue[] } {
  const issues: CallbackValidationIssue[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      issues: [issue('(root)', 'malformed_payload', 'Callback payload must be a JSON object')],
    };
  }

  const raw = input as Record<string, unknown>;
  collectSecretLeaks(raw, 'payload', issues);
  collectPrivatePathLeaks(raw, 'payload', issues);
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  if (!isIntakeEvent(raw.event)) {
    issues.push(
      issue(
        'event',
        'invalid_event',
        `event must be one of: ${INTAKE_CALLBACK_EVENTS.join(', ')}`,
      ),
    );
  }

  const provider = readTrimmed(raw.provider);
  if (!provider) {
    issues.push(issue('provider', 'missing_provider', 'provider is required'));
  }

  const jobId = readTrimmed(raw.jobId) ?? readTrimmed(raw.job_id);
  if (!jobId) {
    issues.push(issue('jobId', 'missing_job_id', 'jobId is required'));
  }

  if (issues.length > 0 || !isIntakeEvent(raw.event) || !provider || !jobId) {
    return { ok: false, issues };
  }

  const event = raw.event;
  const payload: ExecutionCallbackPayload = {
    event,
    provider,
    jobId,
    idempotencyKey: readTrimmed(raw.idempotencyKey) ?? readTrimmed(raw.idempotency_key),
    occurredAt: validateOccurredAt(raw.occurredAt ?? raw.occurred_at, issues),
    actorPrincipalId: readTrimmed(raw.actorPrincipalId) ?? readTrimmed(raw.actor_principal_id),
  };

  if (raw.data !== undefined) {
    if (!raw.data || typeof raw.data !== 'object' || Array.isArray(raw.data)) {
      issues.push(issue('data', 'malformed_data', 'data must be a plain object when provided'));
    } else {
      payload.data = raw.data as Record<string, unknown>;
    }
  }

  if (event === 'plan') {
    const planRaw = (raw.plan && typeof raw.plan === 'object' && !Array.isArray(raw.plan)
      ? raw.plan
      : raw) as Record<string, unknown>;
    const summary = requireSummary(event, planRaw.summary ?? raw.summary, 'plan.summary', issues);
    if (summary) {
      const steps = Array.isArray(planRaw.steps)
        ? planRaw.steps.filter((step): step is string => typeof step === 'string' && step.trim().length > 0)
        : undefined;
      payload.plan = { summary, steps };
    }
  }

  if (event === 'progress') {
    const progressRaw = (raw.progress && typeof raw.progress === 'object' && !Array.isArray(raw.progress)
      ? raw.progress
      : raw) as Record<string, unknown>;
    const summary = requireSummary(
      event,
      progressRaw.summary ?? raw.summary ?? progressRaw.feedback ?? raw.feedback,
      'progress.summary',
      issues,
    );
    if (summary) {
      const percentRaw = progressRaw.percent ?? raw.percent;
      let percent: number | undefined;
      if (percentRaw !== undefined) {
        const n = Number(percentRaw);
        if (!Number.isFinite(n) || n < 0 || n > 100) {
          issues.push(issue('progress.percent', 'invalid_percent', 'percent must be between 0 and 100'));
        } else {
          percent = n;
        }
      }
      payload.progress = {
        summary,
        percent,
        feedback: boundDetail(progressRaw.feedback ?? raw.feedback, 'progress.feedback', issues),
      };
    }
  }

  if (event === 'proof') {
    const proofRaw = (raw.proof && typeof raw.proof === 'object' && !Array.isArray(raw.proof)
      ? raw.proof
      : raw) as Record<string, unknown>;
    const summary = requireSummary(event, proofRaw.summary ?? raw.summary, 'proof.summary', issues);
    if (summary) {
      const testResult = readTrimmed(proofRaw.test_result ?? raw.test_result);
      if (testResult && !['pass', 'fail', 'skip'].includes(testResult)) {
        issues.push(issue('proof.test_result', 'invalid_test_result', 'test_result must be pass|fail|skip'));
      }
      const artifactRefs = Array.isArray(proofRaw.artifact_refs)
        ? proofRaw.artifact_refs.filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0)
        : undefined;
      payload.proof = {
        summary,
        commit_sha: readTrimmed(proofRaw.commit_sha ?? raw.commit_sha),
        branch: readTrimmed(proofRaw.branch ?? raw.branch),
        test_result: testResult as 'pass' | 'fail' | 'skip' | undefined,
        artifact_refs: artifactRefs,
      };
    }
  }

  if (event === 'status') {
    const statusRaw = (raw.status && typeof raw.status === 'object' && !Array.isArray(raw.status)
      ? raw.status
      : { status: raw.status, summary: raw.summary, run_state: raw.run_state }) as Record<string, unknown>;
    const summary = requireSummary(event, statusRaw.summary ?? raw.summary, 'status.summary', issues);
    const statusValue = readTrimmed(statusRaw.status);
    if (statusValue && !(SWARM_JOB_STATUSES as readonly string[]).includes(statusValue)) {
      issues.push(
        issue(
          'status.status',
          'invalid_status',
          `status must be one of: ${SWARM_JOB_STATUSES.join(', ')}`,
        ),
      );
    }
    if (summary) {
      payload.status = {
        summary,
        status: statusValue as SwarmJobStatus | undefined,
        run_state: readTrimmed(statusRaw.run_state ?? raw.run_state),
      };
    }
  }

  if (event === 'blocker') {
    const blockerRaw = (raw.blocker && typeof raw.blocker === 'object' && !Array.isArray(raw.blocker)
      ? raw.blocker
      : raw) as Record<string, unknown>;
    const summary = requireSummary(
      event,
      blockerRaw.summary ?? raw.summary ?? blockerRaw.reason,
      'blocker.summary',
      issues,
    );
    const reason = boundDetail(blockerRaw.reason ?? raw.reason ?? summary, 'blocker.reason', issues);
    if (!reason) {
      issues.push(issue('blocker.reason', 'missing_reason', 'blocker.reason is required'));
    }
    if (summary && reason) {
      payload.blocker = {
        summary,
        reason,
        code: readTrimmed(blockerRaw.code ?? raw.code),
      };
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, payload };
}

export function validateExecutionCallback(
  input: unknown,
  deps: Pick<CallbackIntakeDependencies, 'getManifest' | 'getJob' | 'getCallbackAuthSecret'>,
  auth?: CallbackAuthContext,
): CallbackValidationResult {
  const shape = parseCallbackPayloadShape(input);
  if (!shape.ok) {
    const primary = shape.issues[0];
    const code = primary?.code ?? 'malformed_payload';
    return fail(400, code, primary?.message ?? 'Malformed callback payload', shape.issues);
  }

  const { payload } = shape;
  const manifest = deps.getManifest(payload.provider);
  if (!manifest) {
    return fail(404, 'unknown_provider', 'Unknown execution-engine provider', [
      issue('provider', 'unknown_provider', 'No validated manifest for provider'),
    ]);
  }

  if (manifest.identity.name !== payload.provider) {
    return fail(400, 'provider_mismatch', 'provider does not match manifest identity.name', [
      issue('provider', 'provider_mismatch', 'provider must equal manifest.identity.name'),
    ]);
  }

  if (!eventAllowedByManifest(payload.event, manifest)) {
    return fail(400, 'event_not_allowed', 'Provider does not allow callback event', [
      issue(
        'event',
        'event_not_allowed',
        'event is not declared in callbacks.intake or activityEvents.emits',
      ),
    ]);
  }

  const activityEventKind = resolveActivityEventKind(payload.event, manifest);
  if (!activityEventKind) {
    return fail(400, 'missing_activity_mapping', 'No ActivityEvent kind mapping for event', [
      issue('event', 'missing_activity_mapping', 'Manifest must map callback event to an ActivityEvent kind'),
    ]);
  }

  // EEPC-A-07 — authorize before job lookup side effects / ActivityEvent mapping.
  const authDecision = authorizeExecutionCallback({
    event: payload.event,
    provider: payload.provider,
    manifest,
    auth,
    getCallbackAuthSecret: deps.getCallbackAuthSecret,
  });
  if (!authDecision.ok) {
    return fail(authDecision.status, authDecision.code, authDecision.message, authDecision.issues);
  }

  const job = deps.getJob(payload.jobId);
  if (!job) {
    return fail(404, 'unknown_job', 'Unknown swarm job', [
      issue('jobId', 'unknown_job', 'No job found for id'),
    ]);
  }

  if (job.provider !== payload.provider) {
    return fail(409, 'job_provider_mismatch', 'job.provider does not match callback provider', [
      issue(
        'provider',
        'job_provider_mismatch',
        'Job belongs to a different provider than the callback',
      ),
    ]);
  }

  return {
    ok: true,
    payload,
    manifest,
    job,
    activityEventKind,
    issues: [],
  };
}
