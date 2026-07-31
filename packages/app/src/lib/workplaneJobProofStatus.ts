/**
 * THE-897 / EEPC-B-02 — Wire execution-engine job proof/status into Workplane
 * activity + proof panels.
 *
 * Consumes EEPC-A-03 callback ActivityEvent payloads (and WP1-C-04 swarm_job
 * adapter rows) already present on the THE-870/THE-871 activity spine. Does not
 * invent job data, leak secrets, or claim review-ready.
 */

import type { ActivityProgressEvent } from './workplaneActivityProgress.ts';
import {
  classifyProofBundleItemKind,
  type ProofBundle,
  type ProofBundleItem,
  type ProofBundleItemSource,
} from './proofBundle.ts';

export const EXECUTION_JOB_CALLBACK_SOURCE = 'execution-engine-callback';
export const SWARM_JOB_ADAPTER_SOURCE = 'swarm_job';

export type JobProofStatusKind = 'plan' | 'progress' | 'log' | 'proof' | 'status' | 'blocker';

export interface JobProofStatusSignal {
  /** True when the event is tied to an execution/swarm job. */
  isJobSignal: true;
  kind: JobProofStatusKind | null;
  jobId: string | null;
  provider: string | null;
  jobStatus: string | null;
  runState: string | null;
  summary: string | null;
  commitSha: string | null;
  branch: string | null;
  artifactRefs: string[];
  /** Adapter / callback origin marker for DOM proof. */
  origin: 'execution_callback' | 'swarm_job' | 'unknown';
}

const SECRET_KEY_RE =
  /^(?:api[_-]?key|authorization|auth|token|secret|password|passwd|credential|private[_-]?key|access[_-]?key|refresh[_-]?token|bearer)$/i;
const SECRET_VALUE_RE =
  /(?:sk-[a-z0-9]{10,}|bearer\s+[a-z0-9._\-]+|api[_-]?key\s*[:=]\s*\S+)/i;

const JOB_KINDS = new Set<string>(['plan', 'progress', 'log', 'proof', 'status', 'blocker']);

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function looksSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key.trim());
}

function looksSecretValue(value: string): boolean {
  return SECRET_VALUE_RE.test(value);
}

function isPublicSafeRef(value: string): boolean {
  if (!value || looksSecretValue(value)) return false;
  if (/^(?:data:|javascript:)/i.test(value)) return false;
  return true;
}

function readPublicString(value: unknown): string | null {
  const text = readNonEmptyString(value);
  if (!text || looksSecretValue(text)) return null;
  return text;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const text = readPublicString(entry);
    if (text && isPublicSafeRef(text)) out.push(text);
  }
  return out;
}

function normalizeKind(value: unknown): JobProofStatusKind | null {
  const text = readNonEmptyString(value)?.toLowerCase() ?? null;
  if (!text || !JOB_KINDS.has(text)) return null;
  return text as JobProofStatusKind;
}

function nestedData(payload: Record<string, unknown>): Record<string, unknown> {
  return toRecord(payload.data) ?? {};
}

function nestedEventBody(payload: Record<string, unknown>, data: Record<string, unknown>): Record<string, unknown> {
  return (
    toRecord(data.event_body) ??
    toRecord(payload.event_body) ??
    toRecord(data.eventBody) ??
    {}
  );
}

/**
 * Extract a public-safe job proof/status signal from an activity event payload.
 * Returns null when the event is not job-linked (fail closed — never invent).
 */
export function extractJobProofStatusSignal(
  payload: Record<string, unknown> | null | undefined,
  eventType?: string | null,
): JobProofStatusSignal | null {
  const root = toRecord(payload);
  if (!root) return null;

  // Strip secret-looking top-level keys from consideration (defense in depth).
  for (const key of Object.keys(root)) {
    if (looksSecretKey(key)) {
      // continue extracting known public fields only
      break;
    }
  }

  const data = nestedData(root);
  const eventBody = nestedEventBody(root, data);
  const adapterSource = readNonEmptyString(root.adapterSource ?? root.adapter_source)?.toLowerCase();
  const callbackSource = readNonEmptyString(data.source ?? root.source)?.toLowerCase();

  const isExecutionCallback =
    callbackSource === EXECUTION_JOB_CALLBACK_SOURCE ||
    Boolean(readNonEmptyString(data.execution_callback_kind ?? root.execution_callback_kind)) ||
    Boolean(readNonEmptyString(data.job_id ?? root.job_id));

  const isSwarmJob =
    adapterSource === SWARM_JOB_ADAPTER_SOURCE ||
    Boolean(readNonEmptyString(root.swarm_job_id ?? data.swarm_job_id));

  if (!isExecutionCallback && !isSwarmJob) {
    return null;
  }

  const kind =
    normalizeKind(data.execution_callback_kind) ??
    normalizeKind(root.execution_callback_kind) ??
    normalizeKind(eventType) ??
    null;

  const jobId =
    readPublicString(data.job_id) ??
    readPublicString(root.job_id) ??
    readPublicString(root.swarm_job_id) ??
    readPublicString(data.swarm_job_id);

  const provider =
    readPublicString(data.provider) ??
    readPublicString(root.provider) ??
    readPublicString(data.provider_id) ??
    readPublicString(root.provider_id);

  const jobStatus =
    readPublicString(eventBody.status) ??
    readPublicString(data.job_status) ??
    readPublicString(root.job_status) ??
    readPublicString(root.swarm_status) ??
    readPublicString(data.swarm_status) ??
    readPublicString(root.status);

  const runState =
    readPublicString(eventBody.run_state) ??
    readPublicString(eventBody.runState) ??
    readPublicString(data.run_state) ??
    readPublicString(root.run_state);

  const summary =
    readPublicString(eventBody.summary) ??
    readPublicString(root.summary) ??
    readPublicString(root.description) ??
    readPublicString(root.message) ??
    readPublicString(data.summary);

  const commitSha =
    readPublicString(eventBody.commit_sha) ??
    readPublicString(eventBody.commitSha) ??
    readPublicString(root.commit_sha) ??
    readPublicString(root.commitSha);

  const branch =
    readPublicString(eventBody.branch) ??
    readPublicString(root.branch);

  const artifactRefs = [
    ...readStringArray(eventBody.artifact_refs),
    ...readStringArray(eventBody.artifactRefs),
    ...readStringArray(root.artifact_refs),
    ...readStringArray(data.artifact_refs),
  ];

  // Deduplicate refs while preserving order.
  const seen = new Set<string>();
  const uniqueRefs: string[] = [];
  for (const ref of artifactRefs) {
    const key = ref.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueRefs.push(ref);
  }

  if (!jobId && !provider && !jobStatus && uniqueRefs.length === 0 && !commitSha && !summary) {
    return null;
  }

  return {
    isJobSignal: true,
    kind,
    jobId,
    provider,
    jobStatus,
    runState,
    summary,
    commitSha,
    branch,
    artifactRefs: uniqueRefs,
    origin: isExecutionCallback
      ? 'execution_callback'
      : isSwarmJob
        ? 'swarm_job'
        : 'unknown',
  };
}

export function extractJobProofStatusFromEvent(
  event: Pick<ActivityProgressEvent, 'payload' | 'eventType' | 'payloadRef'>,
): JobProofStatusSignal | null {
  const signal = extractJobProofStatusSignal(event.payload, event.eventType);
  if (!signal) return null;

  // Promote payloadRef into artifact refs when it looks like a job proof ref.
  if (
    signal.kind === 'proof' &&
    event.payloadRef &&
    isPublicSafeRef(event.payloadRef) &&
    !signal.artifactRefs.some((ref) => ref.toLowerCase() === event.payloadRef!.toLowerCase())
  ) {
    return {
      ...signal,
      artifactRefs: [...signal.artifactRefs, event.payloadRef],
    };
  }
  return signal;
}

/** Compact operator-facing label for activity rows (never invents content). */
export function formatJobProofStatusLabel(signal: JobProofStatusSignal): string | null {
  const parts: string[] = [];
  if (signal.provider) parts.push(signal.provider);
  if (signal.jobId) parts.push(`job ${signal.jobId}`);
  if (signal.jobStatus) parts.push(signal.jobStatus);
  else if (signal.runState) parts.push(signal.runState);
  if (parts.length === 0) return null;
  return parts.join(' · ');
}

/** Prefer job-aware summary for activity rows when present. */
export function formatJobAwareActivitySummary(
  event: ActivityProgressEvent,
  fallback: string,
): string {
  const signal = extractJobProofStatusFromEvent(event);
  if (!signal) return fallback;
  if (signal.summary) return signal.summary;
  if (signal.kind === 'status' && signal.jobStatus) {
    return `Job status: ${signal.jobStatus}`;
  }
  if (signal.kind === 'proof' && signal.commitSha) {
    return `Job proof ${signal.commitSha.slice(0, 12)}`;
  }
  return fallback;
}

function isHttpHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

function proofItemFromArtifactRef(
  ref: string,
  signal: JobProofStatusSignal,
  index: number,
): ProofBundleItem {
  const href = isHttpHref(ref) ? ref : null;
  const path = href ? null : ref;
  const title =
    signal.summary ??
    (signal.commitSha ? `Job proof ${signal.commitSha.slice(0, 12)}` : ref);
  const source: ProofBundleItemSource = 'execution_job_proof';
  const kind = classifyProofBundleItemKind({
    href,
    artifactKind: 'raw_proof',
    external: Boolean(href),
  });

  return {
    id: stableJobProofId(signal, ref, index),
    kind: kind === 'unknown' && href ? 'external' : kind === 'unknown' ? 'raw' : kind,
    title,
    label: signal.jobId ? `Job ${signal.jobId}` : 'Execution job proof',
    href,
    path,
    status: signal.jobStatus,
    source,
    artifactKind: 'execution_job_proof',
    external: Boolean(href),
    meta: formatJobProofStatusLabel(signal),
  };
}

function stableJobProofId(signal: JobProofStatusSignal, ref: string, index: number): string {
  const job = signal.jobId ?? 'job';
  const safeRef = ref.replace(/[^A-Za-z0-9._:-]+/g, '_').slice(0, 96);
  return `execution-job-proof:${job}:${safeRef || index}`;
}

/**
 * Project proof-typed job signals into ProofBundle items.
 * Status-only job signals do not invent proof artifacts.
 */
export function projectJobProofItemsFromActivityEvents(
  events: readonly ActivityProgressEvent[] | null | undefined,
): ProofBundleItem[] {
  if (!events || events.length === 0) return [];

  const items: ProofBundleItem[] = [];
  const seen = new Set<string>();

  for (const event of events) {
    const signal = extractJobProofStatusFromEvent(event);
    if (!signal) continue;
    if (signal.kind !== 'proof' && event.eventType !== 'proof') continue;

    const refs =
      signal.artifactRefs.length > 0
        ? signal.artifactRefs
        : signal.commitSha
          ? [`commit:${signal.commitSha}`]
          : event.payloadRef
            ? [event.payloadRef]
            : [];

    if (refs.length === 0) {
      // Explicit incomplete job proof — surface a fail-closed placeholder item
      // only when we have a job id (never invent a free-floating proof).
      if (!signal.jobId) continue;
      const placeholder: ProofBundleItem = {
        id: `execution-job-proof:${signal.jobId}:incomplete`,
        kind: 'unknown',
        title: signal.summary ?? `Job ${signal.jobId} proof incomplete`,
        label: `Job ${signal.jobId}`,
        href: null,
        path: null,
        status: 'proof_incomplete',
        source: 'execution_job_proof',
        artifactKind: 'execution_job_proof',
        external: false,
        meta: formatJobProofStatusLabel(signal),
      };
      if (!seen.has(placeholder.id)) {
        seen.add(placeholder.id);
        items.push(placeholder);
      }
      continue;
    }

    refs.forEach((ref, index) => {
      const item = proofItemFromArtifactRef(ref, signal, index);
      const key = (item.href ?? item.path ?? item.id).toLowerCase();
      if (seen.has(key) || seen.has(item.id)) return;
      seen.add(key);
      seen.add(item.id);
      items.push(item);
    });
  }

  return items;
}

function dedupeKey(item: Pick<ProofBundleItem, 'id' | 'href' | 'path' | 'title' | 'source'>): string {
  const href = (item.href ?? '').trim().toLowerCase();
  if (href) return `href:${href}`;
  const path = (item.path ?? '').trim().toLowerCase();
  if (path) return `path:${path}`;
  const id = item.id.trim().toLowerCase();
  if (id) return `id:${id}`;
  return `title:${item.title.trim().toLowerCase()}|source:${item.source}`;
}

/**
 * Merge job proof artifacts into an existing ProofBundle without inventing
 * missing task/proof context. Status-only signals do not clear missingEvidence.
 */
export function mergeJobProofIntoProofBundle(
  bundle: ProofBundle,
  events: readonly ActivityProgressEvent[] | null | undefined,
): ProofBundle {
  const jobItems = projectJobProofItemsFromActivityEvents(events);
  if (jobItems.length === 0) {
    return bundle;
  }

  const seen = new Set(bundle.items.map(dedupeKey));
  const mergedItems = [...bundle.items];
  for (const item of jobItems) {
    const key = dedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    mergedItems.push(item);
  }

  const hasCompleteJobProof = jobItems.some(
    (item) => Boolean(item.href || item.path) && item.status !== 'proof_incomplete',
  );

  return {
    ...bundle,
    items: mergedItems,
    empty: mergedItems.length === 0,
    missingEvidence: hasCompleteJobProof ? false : bundle.missingEvidence,
    missingEvidenceReason: hasCompleteJobProof
      ? null
      : bundle.missingEvidenceReason,
    evidenceSummary:
      bundle.evidenceSummary ??
      (hasCompleteJobProof ? 'Execution-engine job proof available' : bundle.evidenceSummary),
  };
}

/** Count job proof / status rows for panel chips. */
export function countJobProofStatusSignals(
  events: readonly ActivityProgressEvent[] | null | undefined,
): { proof: number; status: number; total: number } {
  let proof = 0;
  let status = 0;
  let total = 0;
  if (!events) return { proof, status, total };
  for (const event of events) {
    const signal = extractJobProofStatusFromEvent(event);
    if (!signal) continue;
    total += 1;
    if (signal.kind === 'proof' || event.eventType === 'proof') proof += 1;
    if (signal.kind === 'status' || event.eventType === 'status') status += 1;
  }
  return { proof, status, total };
}
