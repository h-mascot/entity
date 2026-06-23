import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import {
  ACTIVITY_EVENT_PAYLOAD_VERSION,
  DEFAULT_WORKSPACE_ORG_ID,
  type ActivityRecord,
  type ActivityRepository,
  type EvidenceArtifactRecord,
  type EvidenceArtifactRepository,
  type TaskRecord,
  type UpdateTaskInput,
} from '../../db/src';

type JsonRecord = Record<string, unknown>;

export interface CompletionReceiptResult {
  task: TaskRecord;
  artifact: EvidenceArtifactRecord;
  receiptBody: string;
}

export interface CompletionReceiptDependencies {
  storageRoot: string;
  artifactRepository: Pick<EvidenceArtifactRepository, 'createArtifact'>;
  activityRepository: Pick<ActivityRepository, 'listActivitiesByTaskId' | 'createActivity'>;
  updateTask: (taskId: number, updates: UpdateTaskInput) => Promise<TaskRecord | undefined> | TaskRecord | undefined;
  writeFile?: (filePath: string, body: string) => Promise<unknown>;
  mkdir?: (dirPath: string, options?: { recursive?: boolean }) => Promise<unknown>;
  idFactory?: () => string;
  now?: () => Date;
}

export interface CompleteTaskWithReceiptInput {
  previousTask: TaskRecord;
  nextTask: TaskRecord;
  actorPrincipalId?: string | null;
  updates?: UpdateTaskInput;
}

function parseMetadata(metadata: string | null | undefined): JsonRecord {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as JsonRecord
      : {};
  } catch {
    return {};
  }
}

function stringifyMetadata(metadata: JsonRecord): string {
  return JSON.stringify(metadata);
}

function readString(value: unknown, fallback = 'not recorded'): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function readBooleanLabel(value: unknown): string {
  return value === true ? 'yes' : value === false ? 'no' : 'not recorded';
}

function readArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => typeof entry === 'string' ? entry.trim() : JSON.stringify(entry))
    .filter((entry) => Boolean(entry));
}

function markdownList(values: string[], empty = '- not recorded'): string {
  return values.length ? values.map((value) => `- ${value}`).join('\n') : empty;
}

function sourceActivityIds(events: readonly ActivityRecord[]): number[] {
  return events
    .map((event) => event.id)
    .filter((id) => Number.isInteger(id) && id > 0);
}

function resolveStablePath(artifactId: string): string {
  return `/artifacts/evidence/${artifactId}.md`;
}

function resolveStoragePath(storageRoot: string, stablePath: string): string {
  return path.resolve(storageRoot, `.${stablePath}`);
}

function sha256(body: string): string {
  return `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`;
}

export function hashCanonicalReceiptMarkdown(body: string): string {
  return sha256(body.replace(/^- Content Hash: .+$/m, '- Content Hash: <computed>'));
}

function buildMetadataWithReceipt(
  task: TaskRecord,
  existingMetadata: JsonRecord,
  artifact: EvidenceArtifactRecord,
): string {
  return stringifyMetadata({
    ...existingMetadata,
    phase2_receipt: {
      artifact_id: artifact.id,
      artifact_kind: artifact.artifact_kind,
      stable_path: artifact.stable_path,
      human_path_alias: artifact.human_path_alias,
      content_hash: artifact.content_hash,
      integrity_state: artifact.integrity_state,
      availability_state: artifact.availability_state,
      created_at: artifact.created_at,
      origin_task_id: task.id,
    },
  });
}

export function buildCanonicalReceiptMarkdown(input: {
  task: TaskRecord;
  previousTask: TaskRecord;
  metadata?: JsonRecord;
  artifactId: string;
  stablePath: string;
  contentHash: string;
  completedAt: string;
  actorPrincipalId?: string | null;
  sourceEventIds?: number[];
}): string {
  const { task, previousTask } = input;
  const metadata = input.metadata ?? parseMetadata(task.metadata);
  const reviewPacket = metadata.review_packet && typeof metadata.review_packet === 'object'
    ? metadata.review_packet as JsonRecord
    : {};
  const doneCriteria = [
    ...readArray(metadata.done_criteria),
    ...readArray(metadata.doneCriteria),
    ...readArray(reviewPacket.done_criteria),
    ...readArray(reviewPacket.doneCriteria),
  ];
  const evidenceLinks = [
    ...readArray(metadata.evidence_links),
    ...readArray(metadata.evidenceLinks),
    ...readArray(reviewPacket.evidence_links),
    ...readArray(reviewPacket.evidenceLinks),
  ];
  const outputArtifacts = [
    ...readArray(metadata.output_artifact_ids),
    ...readArray(metadata.outputArtifacts),
    ...(task.output ? [task.output] : []),
  ];
  const missingEvidence = readString(metadata.missing_evidence_reason, '').length > 0 ||
    evidenceLinks.length === 0 && !task.output;

  return [
    `# Task Receipt: ${task.name}`,
    '',
    '## Identity',
    `- Task ID: ${task.id}`,
    `- Org: ${readString(task.org_id ?? metadata.org_id, DEFAULT_WORKSPACE_ORG_ID)}`,
    `- Team: ${readString(task.team_id ?? metadata.team_id)}`,
    `- Project: ${readString(task.project ?? task.project_id ?? metadata.project_id)}`,
    `- Worktype: ${readString(metadata.worktype ?? metadata.review_type ?? metadata.review_class, 'general')}`,
    `- Origin: ${readString(task.origin_channel ?? metadata.source ?? metadata.origin)}`,
    `- Created By: ${readString(task.created_by_principal_id ?? metadata.created_by ?? metadata.createdBy)}`,
    `- Initiator: ${readString(task.initiator_principal_id ?? metadata.initiator ?? metadata.initiator_principal_id)}`,
    `- Owner: ${readString(task.owner_principal_id ?? metadata.owner ?? metadata.owner_principal_id)}`,
    `- Assignee: ${readString(task.assignee)}`,
    `- Executor: ${readString(task.executor_principal_id ?? metadata.executor ?? metadata.executor_principal_id)}`,
    `- Submitted By: ${readString(metadata.submitted_by ?? metadata.producer)}`,
    '',
    '## Status Transition',
    `- Previous State: ${previousTask.column}`,
    `- New State: ${task.column}`,
    `- Completed At: ${input.completedAt}`,
    `- Completion Actor: ${readString(input.actorPrincipalId)}`,
    '',
    '## Done Criteria',
    markdownList(doneCriteria),
    '',
    '## Evidence Summary',
    `- Summary: ${readString(metadata.evidence_summary ?? reviewPacket.evidence ?? task.output, 'missing evidence')}`,
    `- Missing Evidence: ${missingEvidence ? 'yes' : 'no'}`,
    `- Missing Evidence Reason: ${readString(metadata.missing_evidence_reason, missingEvidence ? 'no evidence links or output were recorded' : 'not applicable')}`,
    '- Evidence Links:',
    markdownList(evidenceLinks),
    '',
    '## Output Artifacts',
    markdownList(outputArtifacts),
    '',
    '## Review',
    `- Review Required: ${readBooleanLabel(metadata.review_required ?? Boolean(metadata.review_type ?? metadata.review_class))}`,
    `- Reviewer: ${readString(metadata.reviewer ?? metadata.review_owner)}`,
    `- Decision: ${readString(metadata.review_decision)}`,
    `- Decision Reason: ${readString(metadata.review_note ?? metadata.review_decision_reason)}`,
    '',
    '## Human Gate',
    `- Human Gate Required: ${readBooleanLabel(metadata.human_gate_required ?? metadata.henry_required ?? metadata.requires_henry)}`,
    `- Approver: ${readString(metadata.approver ?? metadata.approver_principal_id)}`,
    `- Decision: ${readString(metadata.human_gate_decision ?? metadata.gate_decision)}`,
    `- Gate Reason: ${readString(metadata.human_gate_reason ?? metadata.gate_reason)}`,
    '',
    '## Routing / Execution History',
    `- Original Assignment: ${readString(previousTask.assignee)}`,
    `- Task Master Claim: ${readString(metadata.taskmaster_claim ?? metadata.task_master_claim)}`,
    `- Nudges: ${readString(metadata.nudges)}`,
    `- Owner Escalations: ${readString(metadata.owner_escalations)}`,
    `- Reassignments: ${readString(metadata.reassignments)}`,
    `- Final Executor: ${readString(task.executor_principal_id ?? task.assignee)}`,
    '',
    '## Provenance',
    `- Source Activity Event Range: ${input.sourceEventIds?.length ? input.sourceEventIds.join(', ') : 'not recorded'}`,
    `- Runtime/Provider: ${readString(task.model ?? metadata.runtime_provider ?? metadata.provider)}`,
    `- Receipt Artifact ID: ${input.artifactId}`,
    `- Stable Path: ${input.stablePath}`,
    `- Content Hash: ${input.contentHash}`,
    '',
  ].join('\n');
}

export async function completeTaskWithReceipt(
  input: CompleteTaskWithReceiptInput,
  dependencies: CompletionReceiptDependencies,
): Promise<CompletionReceiptResult> {
  const actorPrincipalId = input.actorPrincipalId?.trim() || 'unknown';
  const artifactId = dependencies.idFactory?.() ?? randomUUID();
  const stablePath = resolveStablePath(artifactId);
  const completedAt = (dependencies.now?.() ?? new Date()).toISOString();
  const sourceEvents = dependencies.activityRepository.listActivitiesByTaskId(input.previousTask.id, 200);
  const metadata = parseMetadata(input.nextTask.metadata);
  const draftBody = buildCanonicalReceiptMarkdown({
    task: input.nextTask,
    previousTask: input.previousTask,
    metadata,
    artifactId,
    stablePath,
    contentHash: 'pending',
    completedAt,
    actorPrincipalId,
    sourceEventIds: sourceActivityIds(sourceEvents),
  });
  const contentHash = hashCanonicalReceiptMarkdown(draftBody);
  const receiptBody = buildCanonicalReceiptMarkdown({
    task: input.nextTask,
    previousTask: input.previousTask,
    metadata,
    artifactId,
    stablePath,
    contentHash,
    completedAt,
    actorPrincipalId,
    sourceEventIds: sourceActivityIds(sourceEvents),
  });
  const storagePath = resolveStoragePath(dependencies.storageRoot, stablePath);

  await (dependencies.mkdir ?? fs.promises.mkdir)(path.dirname(storagePath), { recursive: true });
  await (dependencies.writeFile ?? fs.promises.writeFile)(storagePath, receiptBody);

  const artifact = dependencies.artifactRepository.createArtifact({
    id: artifactId,
    org_id: input.nextTask.org_id,
    team_id: input.nextTask.team_id,
    project_id: input.nextTask.project_id,
    artifact_kind: 'raw_task_receipt',
    title: `${input.nextTask.name} receipt`,
    stable_path: stablePath,
    human_path_alias: `/tasks/${input.nextTask.id}/receipt`,
    content_hash: contentHash,
    mutability_policy: 'immutable_append_only',
    origin_task_id: input.nextTask.id,
    source_activity_event_ids: sourceActivityIds(sourceEvents),
    provenance_json: JSON.stringify({
      source: 'entity_completion',
      completed_at: completedAt,
      actor_principal_id: actorPrincipalId,
    }),
    integrity_state: 'valid',
    availability_state: 'available',
    created_by_principal_id: actorPrincipalId,
    metadata_json: JSON.stringify({
      storage_path: storagePath,
      previous_state: input.previousTask.column,
      new_state: input.nextTask.column,
    }),
  });

  dependencies.activityRepository.createActivity({
    source: 'task',
    type: 'task_completed',
    activity_event_type: 'receipt_created',
    activity_event_payload: {
      version: ACTIVITY_EVENT_PAYLOAD_VERSION,
      actor_principal_id: actorPrincipalId,
      actor_type: actorPrincipalId === 'unknown' ? 'unknown' : 'human',
      task_id: input.nextTask.id,
      object_refs: [
        { object_type: 'task', object_id: String(input.nextTask.id), link_role: 'origin' },
        { object_type: 'evidence_artifact', object_id: artifact.id, link_role: 'receipt' },
      ],
      data: {
        content_hash: artifact.content_hash,
        stable_path: artifact.stable_path,
      },
    },
    action: 'Receipt created',
    description: 'Canonical task receipt was written before completion.',
    agent_name: actorPrincipalId,
    task_id: input.nextTask.id,
    task_column: input.previousTask.column,
    metadata: JSON.stringify({ artifact_id: artifact.id, content_hash: artifact.content_hash }),
  });

  const completedTask = await dependencies.updateTask(input.nextTask.id, {
    ...input.updates,
    column: 'done',
    metadata: buildMetadataWithReceipt(input.nextTask, metadata, artifact),
  });
  if (!completedTask) {
    throw new Error('task completion failed after receipt creation');
  }

  return { task: completedTask, artifact, receiptBody };
}
