import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { HttpRequestError, buildApiCandidates, requestJsonWithFallback, toErrorMessage } from '../../lib/http';
import { useUserProfile } from '../../lib/userProfile';
import PluginDetailSlot from '../plugins/PluginDetailSlot';
import {
  TASK_COLUMNS,
  type TaskBoardTask,
  type TaskColumn,
  type TaskPriority,
  useTaskBoard,
} from '../../hooks/useTaskBoard';
import { useEntityWebSocket } from '../../hooks/useEntityWebSocket';
import {
  fetchProjectOptions as fetchAllowedProjectOptions,
  normalizeProjectOption,
  type ProjectOption,
} from './projectOptions';
import { composeAssigneeOptions, fetchActiveAgentNames } from './agentOptions';
import { buildRoutingStateView, routingToneClass } from './utils/routingState';
import {
  FALLBACK_WORKTYPE_REGISTRY,
  formatOverlayValue,
  getEditableWorktypeFields,
  getWorktypeLabel,
  readWorktype,
  readWorktypeLayer,
} from './utils/worktypeRegistry';
import {
  buildExternalDocumentPreviewView,
  type ExternalDocumentPreviewView,
} from './utils/externalDocumentPreview';

const TaskChatContextPanel = lazy(() => import('./TaskChatContextPanel'));

const PRIORITY_OPTIONS: TaskPriority[] = ['P0', 'P1', 'P2', 'P3'];
type DetailTab = 'activity' | 'logs' | 'comments' | 'subtasks' | 'links';

const COLUMN_LABELS: Record<TaskColumn, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  doing: 'Doing',
  review: 'Review',
  done: 'Done',
};

const TECHNICAL_ACTIVITY_TYPES = new Set([
  'technical',
  'tool_call',
  'command_run',
  'file_edit',
  'research',
  'thinking',
]);

interface TaskDetailPanelProps {
  taskId: number;
  apiBase?: string;
  onClose: () => void;
  onDocsLinkNavigate?: (href: string) => boolean;
}

interface TaskDependency {
  id: number;
  name: string | null;
}

interface TaskAttachment {
  name: string;
  path: string;
}

interface ActivityObjectRef {
  objectType: string;
  objectId: string;
  linkRole: string | null;
}

interface ActivityWarning {
  code: string;
  message: string;
}

interface TaskActivity {
  id: number;
  source: 'agent' | 'task';
  type: string;
  activityEventType: string;
  payloadVersion: number | null;
  schemaStatus: string;
  legacyType: string | null;
  action: string;
  description: string;
  agentName: string;
  agentEmoji: string | null;
  actorType: string;
  actorPrincipalId: string | null;
  objectRefs: ActivityObjectRef[];
  reason: string | null;
  provenance: string | null;
  permissionState: string;
  degraded: boolean;
  warnings: ActivityWarning[];
  taskColumn: string | null;
  filePath: string | null;
  metadataText: string | null;
  metadataRecord: Record<string, unknown> | null;
  activityEventPayload: Record<string, unknown> | null;
  createdAt: string;
}

interface TaskCommentRecord {
  id: number;
  taskId: number;
  body: string;
  author: string;
  parentId: number | null;
  createdAt: string;
}

interface TaskCommentNode extends TaskCommentRecord {
  children: TaskCommentNode[];
}

interface TaskDetailData {
  id: number;
  name: string;
  description: string;
  column: TaskColumn;
  assignee: string;
  priority: TaskPriority;
  blocked: boolean;
  blockerReason: string;
  dueDate: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  createdByPrincipalId: string | null;
  initiatorPrincipalId: string | null;
  initiatorType: string | null;
  ownerPrincipalId: string | null;
  ownerPrincipalType: string | null;
  executorPrincipalId: string | null;
  assignmentState: string | null;
  taskmasterDrivable: boolean;
  submittedBy: string | null;
  reviewer: string | null;
  reviewerPrincipalId: string | null;
  reviewRequired: boolean;
  reviewState: string;
  approver: string | null;
  approverPrincipalId: string | null;
  humanGateRequired: boolean;
  humanGateState: string;
  policyReasonChain: Array<Record<string, unknown>>;
  overrideAudit: Array<Record<string, unknown>>;
  worktype: string;
  policyInputsJson: string | null;
  model: string | null;
  estimateHours: number | null;
  timeSpent: number | null;
  output: string;
  activity: TaskActivity[];
  metadataRecord: Record<string, unknown>;
  attachments: TaskAttachment[];
  dependencies: TaskDependency[];
  models: string[];
}

interface ReceiptDisplayLink {
  label: string;
  href: string | null;
  external: boolean;
  meta: string | null;
}

interface ReceiptProofView {
  status: string;
  statusTone: 'ok' | 'warning' | 'error' | 'muted';
  artifactId: string | null;
  artifactKind: string;
  artifactMode: 'raw' | 'curated' | 'unknown';
  mutability: string;
  stablePath: string | null;
  receiptHref: string | null;
  contentHash: string | null;
  integrityState: string;
  availabilityState: string;
  createdAt: string | null;
  evidenceSummary: string;
  missingEvidence: boolean;
  missingEvidenceReason: string | null;
  evidenceLinks: ReceiptDisplayLink[];
  outputLinks: ReceiptDisplayLink[];
  reviewDecision: string;
  approvalDecision: string;
  provenance: string;
  degradedMessages: string[];
}

interface DocumentObjectView {
  id: string;
  objectType: 'native_document' | 'external_document_ref' | 'evidence_artifact';
  displayKind: 'native' | 'external' | 'raw_proof' | 'curated' | 'unknown';
  label: string;
  title: string;
  href: string | null;
  externalHref: boolean;
  sourceLabel: string;
  canonicality: string;
  mutability: string;
  status: string;
  statusTone: ReceiptProofView['statusTone'];
  objectRefs: ActivityObjectRef[];
  restricted: boolean;
  degradedMessages: string[];
  externalPreview: ExternalDocumentPreviewView | null;
}

interface TaskFormState {
  name: string;
  description: string;
  column: TaskColumn;
  assignee: string;
  priority: TaskPriority;
  blocked: boolean;
  blockerReason: string;
  dueDate: string;
  model: string;
  estimateHours: string;
  timeSpent: string;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    try {
      return toRecord(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }

  return toRecord(value);
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readFirstString(...values: unknown[]): string | null {
  for (const value of values) {
    const next = readNonEmptyString(value);
    if (next) {
      return next;
    }
  }

  return null;
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  return false;
}

function normalizeColumn(value: unknown): TaskColumn {
  if (typeof value !== 'string') {
    return 'backlog';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'complete') {
    return 'done';
  }

  return (TASK_COLUMNS as readonly string[]).includes(normalized) ? (normalized as TaskColumn) : 'backlog';
}

function normalizePriority(value: unknown): TaskPriority {
  if (typeof value !== 'string') {
    return 'P2';
  }

  const normalized = value.trim().toUpperCase();
  return normalized === 'P0' || normalized === 'P1' || normalized === 'P2' || normalized === 'P3'
    ? normalized
    : 'P2';
}

function normalizeAssignee(value: unknown): string {
  if (typeof value !== 'string') {
    return 'Unassigned';
  }

  const normalized = value.trim();
  return normalized || 'Unassigned';
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date().toISOString();
}

function normalizeDateInputValue(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  return parsed.toISOString().slice(0, 10);
}

function normalizeNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizePositiveInteger(value: unknown): number | null {
  const numeric = normalizeNullableNumber(value);
  if (numeric === null) {
    return null;
  }

  const parsed = Math.floor(numeric);
  return parsed > 0 ? parsed : null;
}

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = readNonEmptyString(value);
    if (!normalized) {
      continue;
    }

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function normalizeActivityObjectRefs(value: unknown): ActivityObjectRef[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const refs: ActivityObjectRef[] = [];
  for (const item of value) {
    const record = toRecord(item);
    if (!record) {
      continue;
    }

    const objectType = readFirstString(record.object_type, record.objectType);
    const objectId = readFirstString(record.object_id, record.objectId);
    if (!objectType || !objectId) {
      continue;
    }

    refs.push({
      objectType,
      objectId,
      linkRole: readFirstString(record.link_role, record.linkRole),
    });
  }

  return refs;
}

function normalizeActivityWarnings(value: unknown): ActivityWarning[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const warnings: ActivityWarning[] = [];
  for (const item of value) {
    const record = toRecord(item);
    if (!record) {
      continue;
    }

    const code = readFirstString(record.code, record.warning_code, record.type);
    const message = readFirstString(record.message, record.description, record.reason);
    if (!code && !message) {
      continue;
    }

    warnings.push({
      code: code ?? 'warning',
      message: message ?? 'Activity payload needs review.',
    });
  }

  return warnings;
}

function formatActivityToken(value: string): string {
  return value.replace(/[_-]+/g, ' ');
}

function formatObjectRef(ref: ActivityObjectRef): string {
  return `${ref.objectType}:${ref.objectId}${ref.linkRole ? ` (${ref.linkRole})` : ''}`;
}

function normalizeAttachment(raw: unknown): TaskAttachment | null {
  if (typeof raw === 'string') {
    const path = raw.trim();
    if (!path) {
      return null;
    }

    return {
      name: path,
      path,
    };
  }

  const record = toRecord(raw);
  if (!record) {
    return null;
  }

  const path = readFirstString(record.path, record.url, record.href);
  if (!path) {
    return null;
  }

  return {
    name: readFirstString(record.name, record.label, record.title) ?? path,
    path,
  };
}

function normalizeDependency(raw: unknown): TaskDependency | null {
  const numericId = normalizePositiveInteger(raw);
  if (numericId) {
    return { id: numericId, name: null };
  }

  const record = toRecord(raw);
  if (!record) {
    return null;
  }

  const id = normalizePositiveInteger(record.id ?? record.task_id ?? record.taskId);
  if (!id) {
    return null;
  }

  return {
    id,
    name: readFirstString(record.name, record.title, record.label),
  };
}

function normalizeAttachments(raw: unknown): TaskAttachment[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const attachments: TaskAttachment[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    const attachment = normalizeAttachment(entry);
    if (!attachment) {
      continue;
    }

    const key = `${attachment.name}::${attachment.path}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    attachments.push(attachment);
  }

  return attachments;
}

function normalizeDependencies(raw: unknown): TaskDependency[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const dependencies: TaskDependency[] = [];
  const seen = new Set<number>();

  for (const entry of raw) {
    const dependency = normalizeDependency(entry);
    if (!dependency || seen.has(dependency.id)) {
      continue;
    }

    seen.add(dependency.id);
    dependencies.push(dependency);
  }

  return dependencies;
}

function collectModelOptions(record: Record<string, unknown>, metadataRecord: Record<string, unknown>): string[] {
  const rawModels = [
    record.model,
    metadataRecord.model,
    ...(Array.isArray(record.models) ? record.models : []),
    ...(Array.isArray(metadataRecord.models) ? metadataRecord.models : []),
  ];

  const flattened: unknown[] = [];
  for (const entry of rawModels) {
    const asRecord = toRecord(entry);
    if (asRecord) {
      flattened.push(asRecord.id, asRecord.name, asRecord.model);
      continue;
    }

    flattened.push(entry);
  }

  return uniqueStrings(flattened);
}

function normalizeActivity(raw: unknown): TaskActivity | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }

  const id = normalizePositiveInteger(record.id);
  if (!id) {
    return null;
  }

  const metadataText = readNonEmptyString(record.metadata);
  const metadataRecord = parseJsonRecord(metadataText);
  const activityEventPayload = parseJsonRecord(
    record.activity_event_payload_json ??
      record.activity_event_payload ??
      metadataRecord?.activity_event_payload
  ) ?? {};
  const payloadData = toRecord(activityEventPayload.data);
  const permissionState = readFirstString(
    record.permission_state,
    record.permissionState,
    metadataRecord?.permission_state,
    metadataRecord?.permissionState
  ) ?? 'visible';
  const restricted = permissionState !== 'visible';
  const schemaStatus = readFirstString(
    record.activity_event_schema_status,
    record.activityEventSchemaStatus,
    metadataRecord?.activity_event_schema_status,
    metadataRecord?.activityEventSchemaStatus
  ) ?? 'legacy_mapped';
  const activityEventType = readFirstString(
    record.activity_event_type,
    record.activityEventType,
    activityEventPayload.event_type,
    metadataRecord?.activity_event_type,
    metadataRecord?.activityEventType,
    record.type
  ) ?? 'legacy_event_observed';
  const warnings = restricted
    ? []
    : normalizeActivityWarnings(activityEventPayload.warnings ?? metadataRecord?.warnings);
  if (!restricted && schemaStatus === 'legacy_unknown') {
    warnings.push({
      code: 'legacy_unknown',
      message: 'Legacy activity was preserved without enough structure to infer full provenance.',
    });
  }
  const payloadVersion = normalizePositiveInteger(
    record.activity_event_payload_version ??
      record.activityEventPayloadVersion ??
      activityEventPayload.version
  );
  const actorType = readFirstString(
    activityEventPayload.actor_type,
    record.actor_type,
    record.actorType,
    metadataRecord?.actor_type,
    metadataRecord?.actorType
  ) ?? 'unknown';
  const actorPrincipalId = restricted
    ? null
    : readFirstString(
        activityEventPayload.actor_principal_id,
        record.actor_principal_id,
        record.actorPrincipalId,
        metadataRecord?.actor_principal_id,
        metadataRecord?.actorPrincipalId
      );
  const eventPayloadForDisplay = restricted ? null : activityEventPayload;
  const displayMetadataText = restricted
    ? null
    : eventPayloadForDisplay
      ? JSON.stringify({
          activity_event_payload: eventPayloadForDisplay,
          legacy_metadata: metadataRecord ?? undefined,
        }, null, 2)
      : metadataRecord
        ? JSON.stringify(metadataRecord, null, 2)
        : metadataText;

  return {
    id,
    source: record.source === 'task' ? 'task' : 'agent',
    type: readNonEmptyString(record.type) ?? 'task_updated',
    activityEventType,
    payloadVersion,
    schemaStatus,
    legacyType: readFirstString(record.activity_event_legacy_type, record.activityEventLegacyType, metadataRecord?.activity_event_legacy_type),
    action: restricted ? 'Hidden by permissions' : readNonEmptyString(record.action) ?? 'Updated task',
    description: restricted
      ? 'Restricted activity hidden by Entity permissions.'
      : readNonEmptyString(record.description) ?? 'No details recorded.',
    agentName: restricted ? 'Restricted activity' : readFirstString(record.agent_name, metadataRecord?.user) ?? 'Entity',
    agentEmoji: restricted ? null : readNonEmptyString(record.agent_emoji),
    actorType,
    actorPrincipalId,
    objectRefs: restricted ? [] : normalizeActivityObjectRefs(activityEventPayload.object_refs ?? metadataRecord?.object_refs),
    reason: restricted
      ? null
      : readFirstString(activityEventPayload.reason, payloadData?.reason, metadataRecord?.reason),
    provenance: restricted
      ? null
      : readFirstString(activityEventPayload.provenance, payloadData?.provenance, metadataRecord?.provenance, metadataRecord?.source),
    permissionState,
    degraded: restricted || schemaStatus !== 'structured' || warnings.length > 0,
    warnings,
    taskColumn: readNonEmptyString(record.task_column),
    filePath: readNonEmptyString(record.file_path),
    metadataText: displayMetadataText,
    metadataRecord,
    activityEventPayload: eventPayloadForDisplay,
    createdAt: normalizeTimestamp(record.created_at),
  };
}

function normalizeTaskComment(raw: unknown): TaskCommentRecord | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }

  const id = normalizePositiveInteger(record.id);
  if (!id) {
    return null;
  }

  return {
    id,
    taskId: normalizePositiveInteger(record.task_id) ?? 0,
    body: readNonEmptyString(record.body) ?? '',
    author: readFirstString(record.author, record.user) ?? 'Human',
    parentId: normalizePositiveInteger(record.parent_id),
    createdAt: normalizeTimestamp(record.created_at),
  };
}

function normalizeTaskDetail(raw: unknown): TaskDetailData | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }

  const id = normalizePositiveInteger(record.id);
  const name = readNonEmptyString(record.name);
  if (!id || !name) {
    return null;
  }

  const metadataRecord = parseJsonRecord(record.metadata) ?? {};
  const rawAttachments = record.attachments ?? metadataRecord.attachments;
  const rawDependencies = record.dependencies ?? metadataRecord.dependencies;
  const metadataReviewRequired = normalizeBoolean(metadataRecord.review_required ?? metadataRecord.reviewRequired);
  const metadataHumanGateRequired = normalizeBoolean(metadataRecord.human_gate_required ?? metadataRecord.humanGateRequired);
  const reviewRequired = normalizeBoolean(record.review_required ?? record.reviewRequired) || metadataReviewRequired;
  const humanGateRequired = normalizeBoolean(record.human_gate_required ?? record.humanGateRequired) || metadataHumanGateRequired;
  const rawReviewState = readFirstString(record.review_state, record.reviewState);
  const metadataReviewState = readFirstString(metadataRecord.review_state, metadataRecord.reviewState, metadataRecord.review_decision);
  const rawHumanGateState = readFirstString(record.human_gate_state, record.humanGateState);
  const metadataHumanGateState = readFirstString(metadataRecord.human_gate_state, metadataRecord.humanGateState, metadataRecord.human_gate_decision);
  const policyReasonChain = recordArrayFrom(
    record.policy_reason_chain ??
      record.policyReasonChain ??
      metadataRecord.policy_reason_chain ??
      metadataRecord.reason_chain ??
      metadataRecord.policy_reasons
  );
  const overrideAudit = recordArrayFrom(
    record.override_audit ??
      record.overrideAudit ??
      metadataRecord.override_audit ??
      metadataRecord.review_override_audit ??
      metadataRecord.human_gate_override_audit
  );
  const activity = Array.isArray(record.activity)
    ? record.activity.map(normalizeActivity).filter((entry): entry is TaskActivity => entry !== null)
    : [];

  return {
    id,
    name,
    description: typeof record.description === 'string' ? record.description : '',
    column: normalizeColumn(record.column),
    assignee: normalizeAssignee(record.assignee),
    priority: normalizePriority(record.priority),
    blocked: normalizeBoolean(record.blocked),
    blockerReason: readFirstString(record.blocker_reason, metadataRecord.blocker_reason) ?? '',
    dueDate: normalizeDateInputValue(record.due_date ?? record.due_at ?? metadataRecord.due_date),
    createdAt: normalizeTimestamp(record.created_at),
    updatedAt: normalizeTimestamp(record.updated_at ?? record.created_at),
    createdBy: readFirstString(record.created_by, metadataRecord.created_by, metadataRecord.createdBy),
    createdByPrincipalId: readFirstString(record.created_by_principal_id, record.createdByPrincipalId, metadataRecord.created_by_principal_id, metadataRecord.createdByPrincipalId),
    initiatorPrincipalId: readFirstString(record.initiator_principal_id, record.initiatorPrincipalId, metadataRecord.initiator_principal_id, metadataRecord.initiatorPrincipalId),
    initiatorType: readFirstString(record.initiator_type, record.initiatorType, metadataRecord.initiator_type, metadataRecord.initiatorType),
    ownerPrincipalId: readFirstString(record.owner_principal_id, record.ownerPrincipalId, metadataRecord.owner_principal_id, metadataRecord.ownerPrincipalId),
    ownerPrincipalType: readFirstString(record.owner_principal_type, record.ownerPrincipalType, metadataRecord.owner_principal_type, metadataRecord.ownerPrincipalType),
    executorPrincipalId: readFirstString(record.executor_principal_id, record.executorPrincipalId, metadataRecord.executor_principal_id, metadataRecord.executorPrincipalId),
    assignmentState: readFirstString(record.assignment_state, record.assignmentState, metadataRecord.assignment_state, metadataRecord.assignmentState),
    taskmasterDrivable: normalizeBoolean(record.taskmaster_drivable ?? record.taskmasterDrivable ?? metadataRecord.taskmaster_drivable ?? metadataRecord.taskmasterDrivable),
    submittedBy: readFirstString(record.submitted_by, record.submittedBy, metadataRecord.submitted_by, metadataRecord.submittedBy, metadataRecord.producer),
    reviewer: readFirstString(record.reviewer, metadataRecord.reviewer, metadataRecord.review_owner),
    reviewerPrincipalId: readFirstString(record.reviewer_principal_id, record.reviewerPrincipalId, metadataRecord.reviewer_principal_id, metadataRecord.reviewerPrincipalId, metadataRecord.reviewer, metadataRecord.review_owner),
    reviewRequired,
    reviewState: reviewRequired
      ? (rawReviewState && rawReviewState !== 'not_required' ? rawReviewState : metadataReviewState ?? 'pending')
      : 'not_required',
    approver: readFirstString(record.approver, record.approver_principal_id, metadataRecord.approver, metadataRecord.approver_principal_id, metadataRecord.human_gate_approver, metadataRecord.gate_approver),
    approverPrincipalId: readFirstString(record.approver_principal_id, record.approverPrincipalId, metadataRecord.approver_principal_id, metadataRecord.approverPrincipalId, metadataRecord.human_gate_approver, metadataRecord.gate_approver),
    humanGateRequired,
    humanGateState: humanGateRequired
      ? (rawHumanGateState && rawHumanGateState !== 'not_required' ? rawHumanGateState : metadataHumanGateState ?? 'pending')
      : 'not_required',
    policyReasonChain,
    overrideAudit,
    worktype: readWorktype(metadataRecord, record.worktype),
    policyInputsJson: readFirstString(record.policy_inputs_json, record.policyInputsJson, metadataRecord.policy_inputs_json),
    model: readFirstString(record.model, metadataRecord.model),
    estimateHours: normalizeNullableNumber(record.estimate_hours ?? metadataRecord.estimate_hours),
    timeSpent: normalizeNullableNumber(record.time_spent ?? metadataRecord.time_spent),
    output: typeof record.output === 'string' ? record.output : readFirstString(metadataRecord.output) ?? '',
    activity,
    metadataRecord,
    attachments: normalizeAttachments(rawAttachments),
    dependencies: normalizeDependencies(rawDependencies),
    models: collectModelOptions(record, metadataRecord),
  };
}

function buildForm(task: TaskDetailData): TaskFormState {
  return {
    name: task.name,
    description: task.description,
    column: task.column,
    assignee: task.assignee,
    priority: task.priority,
    blocked: task.blocked,
    blockerReason: task.blockerReason,
    dueDate: task.dueDate,
    model: task.model ?? '',
    estimateHours: task.estimateHours === null ? '' : String(task.estimateHours),
    timeSpent: task.timeSpent === null ? '' : String(task.timeSpent),
  };
}

function buildCommentTree(comments: TaskCommentRecord[]): TaskCommentNode[] {
  const nodes = comments.map((comment) => ({
    ...comment,
    children: [],
  }));
  const byId = new Map<number, TaskCommentNode>(nodes.map((node) => [node.id, node]));
  const roots: TaskCommentNode[] = [];

  for (const node of nodes) {
    if (node.parentId) {
      const parent = byId.get(node.parentId);
      if (parent) {
        parent.children.push(node);
        continue;
      }
    }

    roots.push(node);
  }

  return roots;
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown';
  }

  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const TASK_OUTPUT_DOCUMENT_EXT = String.raw`(?:md|markdown|txt|log|json|jsonl|ya?ml|csv|tsv)`;
const TASK_OUTPUT_LINK_PATTERN = new RegExp(
  String.raw`(?:https?:\/\/[^\s<>()]+|\/(?:docs|task|tasks)\/[^\s<>()]+|(?:docs|notes|output|memory|workspace|projects|zora|spock)\/[^\s<>()]+\.${TASK_OUTPUT_DOCUMENT_EXT}(?:[?#][^\s<>()]+)?|(?:~|\/(?:Users|home)\/[^\s<>()]+)\/clawd(?:-[^\/\s<>()]+)?\/(?:output|memory|projects|docs|notes|[^\s<>()]*\.md[^\s<>()]*))`,
  'g'
);

function splitTaskOutputLinkToken(rawHref: string): { href: string; suffix: string } {
  const match = rawHref.match(/^(.*?)([,.;!]+)$/);
  if (!match) {
    return { href: rawHref, suffix: '' };
  }

  return { href: match[1] ?? rawHref, suffix: match[2] ?? '' };
}

function normalizeTaskOutputHref(rawHref: string): string | null {
  const href = rawHref.trim();
  if (!href) {
    return null;
  }

  const normalized = href.replace(/\\/g, '/');

  const entityDocsUrlMatch = normalized.match(/^https?:\/\/[^/\s<>()]+\/docs\/(output|memory|workspace|projects|zora|spock)\/(.+)$/i);
  if (entityDocsUrlMatch) {
    const [, root, rest] = entityDocsUrlMatch;
    return `/docs/${root.toLowerCase()}/${rest}`;
  }

  const legacyDocsUrlMatch = normalized.match(/^https?:\/\/[^\s<>()]+(?::(?:3000|8788))?\/(output|memory|workspace|projects|zora|spock)\/(.+)$/i);
  if (legacyDocsUrlMatch) {
    const [, root, rest] = legacyDocsUrlMatch;
    return `/docs/${root.toLowerCase()}/${rest}`;
  }

  const legacyWorkspaceUrlMatch = normalized.match(/^https?:\/\/[^\s<>()]+(?::(?:3000|8788))?\/(docs|notes)\/(.+)$/i);
  if (legacyWorkspaceUrlMatch) {
    const [, root, rest] = legacyWorkspaceUrlMatch;
    return `/docs/workspace/${root.toLowerCase()}/${rest}`;
  }

  if (/^https?:\/\//i.test(href)) {
    return href;
  }

  const taskMatch = normalized.match(/^\/(?:task|tasks)\/(\d+)(?:\/)?$/i);
  if (taskMatch) {
    return `/task/${taskMatch[1]}`;
  }

  if (normalized.startsWith('/docs/')) {
    const docsPath = normalized.slice('/docs/'.length);
    if (/^(?:docs|notes)\//i.test(docsPath)) {
      return `/docs/workspace/${docsPath}`;
    }
    return normalized;
  }

  if (/^(?:output|memory|workspace|projects|zora|spock)\//i.test(normalized)) {
    return `/docs/${normalized.replace(/^\/+/, '')}`;
  }

  if (/^(?:docs|notes)\//i.test(normalized)) {
    return `/docs/workspace/${normalized.replace(/^\/+/, '')}`;
  }

  const absoluteMatchers: Array<{ root: string; pattern: RegExp }> = [
    { root: 'output', pattern: /^(?:~|\/(?:Users|home)\/[^/]+)\/clawd\/output\/(.+)$/i },
    { root: 'memory', pattern: /^(?:~|\/(?:Users|home)\/[^/]+)\/clawd\/memory\/(.+)$/i },
    { root: 'projects', pattern: /^(?:~|\/(?:Users|home)\/[^/]+)\/clawd\/projects\/(.+)$/i },
    { root: 'zora', pattern: /^(?:~|\/(?:Users|home)\/[^/]+)\/clawd-zora\/output\/(.+)$/i },
    { root: 'spock', pattern: /^(?:~|\/(?:Users|home)\/[^/]+)\/clawd-spock\/output\/(.+)$/i },
    { root: 'workspace', pattern: /^(?:~|\/(?:Users|home)\/[^/]+)\/clawd\/(.+)$/i },
  ];

  for (const matcher of absoluteMatchers) {
    const match = normalized.match(matcher.pattern);
    if (match?.[1]) {
      return `/docs/${matcher.root}/${match[1].replace(/^\/+/, '')}`;
    }
  }

  return null;
}

function renderLinkedText(text: string, onDocsLinkNavigate?: (href: string) => boolean): ReactNode {
  if (!text) {
    return null;
  }

  const matches = Array.from(text.matchAll(TASK_OUTPUT_LINK_PATTERN));
  if (matches.length === 0) {
    return text;
  }

  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (const match of matches) {
    const rawHref = match[0];
    const index = match.index ?? 0;
    const { href: linkText, suffix } = splitTaskOutputLinkToken(rawHref);
    const href = normalizeTaskOutputHref(linkText);
    if (!href) {
      continue;
    }

    if (index > cursor) {
      nodes.push(text.slice(cursor, index));
    }

    const external = /^https?:\/\//i.test(href);
    nodes.push(
      <a
        key={`${rawHref}-${index}`}
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noreferrer' : undefined}
        className="text-sky-400 hover:text-sky-300"
        onClick={(event) => {
          if (event.defaultPrevented || external || !onDocsLinkNavigate) {
            return;
          }

          if (onDocsLinkNavigate(href)) {
            event.preventDefault();
          }
        }}
      >
        {linkText}
      </a>
    );
    if (suffix) {
      nodes.push(suffix);
    }
    cursor = index + rawHref.length;
  }

  if (cursor === 0) {
    return text;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}

function extractTaskOutputLinks(text: string): Array<{ label: string; href: string; external: boolean }> {
  if (!text) {
    return [];
  }

  const links: Array<{ label: string; href: string; external: boolean }> = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(TASK_OUTPUT_LINK_PATTERN)) {
    const rawHref = match[0];
    const { href: linkText } = splitTaskOutputLinkToken(rawHref);
    const href = normalizeTaskOutputHref(linkText);
    if (!href || seen.has(href)) {
      continue;
    }

    seen.add(href);
    links.push({
      label: linkText,
      href,
      external: /^https?:\/\//i.test(href),
    });
  }

  return links;
}

function parseHoursInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function isTechnicalActivity(activity: TaskActivity): boolean {
  const activityType = readFirstString(activity.metadataRecord?.activityType, activity.type)?.toLowerCase() ?? '';
  if (TECHNICAL_ACTIVITY_TYPES.has(activityType)) {
    return true;
  }

  return TECHNICAL_ACTIVITY_TYPES.has(activity.type.toLowerCase());
}

function buildMetadataPatch(
  task: TaskDetailData,
  updates: {
    attachments?: TaskAttachment[];
    dependencies?: TaskDependency[];
    model?: string | null;
  }
): string {
  const nextRecord: Record<string, unknown> = { ...task.metadataRecord };

  if (typeof updates.model !== 'undefined') {
    nextRecord.model = updates.model ?? null;
  }

  if (typeof updates.attachments !== 'undefined') {
    nextRecord.attachments = updates.attachments.map((attachment) => ({
      name: attachment.name,
      path: attachment.path,
    }));
  }

  if (typeof updates.dependencies !== 'undefined') {
    nextRecord.dependencies = updates.dependencies.map((dependency) => dependency.id);
  }

  return JSON.stringify(nextRecord);
}

function hasReviewMetadata(metadata: Record<string, unknown>): boolean {
  return Boolean(
    readFirstString(metadata.review_type, metadata.review_class) ||
      readFirstString(metadata.reviewer, metadata.review_owner) ||
      readFirstString(metadata.review_decision) ||
      normalizeBoolean(metadata.henry_required ?? metadata.requires_henry) ||
      parseJsonRecord(metadata.review_packet) ||
      parseJsonRecord(metadata.review_brief)
  );
}

function reviewField(value: unknown, fallback = 'Not set'): string {
  return readNonEmptyString(value) ?? fallback;
}

function formatReviewGateToken(value: unknown, fallback = 'Not required'): string {
  const raw = readNonEmptyString(value);
  if (!raw) {
    return fallback;
  }
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildWorktypeOverlayView(task: TaskDetailData): {
  label: string;
  schema: string;
  sensitivity: string;
  rows: Array<{ label: string; value: string; indexable: boolean }>;
} | null {
  const metadata = {
    ...task.metadataRecord,
    worktype: task.worktype,
    policy_inputs_json: task.policyInputsJson ?? task.metadataRecord.policy_inputs_json,
  };
  const worktype = readWorktype(metadata, task.worktype);
  if (worktype === 'general') {
    return null;
  }
  const entry = FALLBACK_WORKTYPE_REGISTRY.find((candidate) => candidate.worktype === worktype);
  if (!entry) {
    return null;
  }
  const layer = readWorktypeLayer(metadata);
  const rows = getEditableWorktypeFields(entry)
    .map((field) => ({
      label: field.plan_label,
      value: formatOverlayValue(layer[field.name]),
      indexable: field.indexable,
    }))
    .filter((row): row is { label: string; value: string; indexable: boolean } => Boolean(row.value));

  return {
    label: getWorktypeLabel(entry),
    schema: `${entry.schema_name}@v${entry.schema_version}`,
    sensitivity: entry.sensitivity.replace(/_/g, ' '),
    rows,
  };
}

function reviewGateToneClass(state: string, required: boolean): string {
  const normalized = state.toLowerCase();
  if (!required || normalized === 'not_required') {
    return 'border-[var(--border-secondary)] bg-[var(--bg-primary)] text-[var(--text-muted)]';
  }
  if (normalized === 'accepted' || normalized === 'approved') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
  }
  if (normalized === 'request_fix' || normalized === 'rejected') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-100';
  }
  return 'border-[var(--accent)]/25 bg-[var(--surface-accent)] text-[var(--accent)]';
}

function normalizePrincipalAlias(value: unknown): string | null {
  const normalized = readNonEmptyString(value)?.toLowerCase();
  return normalized ?? null;
}

function principalMatches(actorAliases: string[], principal: string | null): boolean {
  const normalizedPrincipal = normalizePrincipalAlias(principal);
  return Boolean(normalizedPrincipal && actorAliases.includes(normalizedPrincipal));
}

function formatReasonChainEntry(entry: Record<string, unknown>, index: number): string {
  const decision = formatReviewGateToken(entry.decision ?? entry.type ?? entry.reason, `Reason ${index + 1}`);
  const value = readFirstString(entry.value, entry.target, entry.result);
  const source = readFirstString(entry.source, entry.layer, entry.policy_source);
  const reason = readFirstString(entry.reason, entry.message, entry.description);
  return [source ? `${source}: ${decision}` : decision, value ? `=${value}` : null, reason ? `— ${reason}` : null]
    .filter(Boolean)
    .join(' ');
}

function formatAccountabilityField(value: string | null, fallback = 'Unknown'): { label: string; degraded: boolean } {
  const normalized = readNonEmptyString(value);
  if (!normalized || normalized.toLowerCase() === 'unknown') {
    return { label: `${fallback} (degraded)`, degraded: true };
  }

  if (normalized.toLowerCase().startsWith('legacy-')) {
    return { label: `${normalized} (legacy)`, degraded: true };
  }

  return { label: normalized, degraded: false };
}

function accountabilityCardClass(degraded: boolean): string {
  return degraded
    ? 'rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1.5 text-amber-100'
    : 'rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5';
}

function reviewPacketSummary(metadata: Record<string, unknown>): string {
  const packet = parseJsonRecord(metadata.review_packet) ?? parseJsonRecord(metadata.review_brief);
  if (!packet) {
    return 'Missing';
  }

  const outcome = readFirstString(packet.requested_outcome, packet.outcome) ?? 'Outcome not set';
  const criteria = Array.isArray(packet.done_criteria)
    ? packet.done_criteria.map((entry) => readNonEmptyString(entry)).filter(Boolean).length
    : readNonEmptyString(packet.done_criteria)
      ? 1
      : 0;
  return `${outcome}${criteria > 0 ? ` / ${criteria} ${criteria === 1 ? 'criterion' : 'criteria'}` : ''}`;
}

function firstRecord(...values: unknown[]): Record<string, unknown> | null {
  for (const value of values) {
    const record = parseJsonRecord(value);
    if (record) {
      return record;
    }
  }

  return null;
}

function recordArrayFrom(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.map((entry) => parseJsonRecord(entry)).filter((entry): entry is Record<string, unknown> => entry !== null);
  }

  const record = parseJsonRecord(value);
  if (!record) {
    return [];
  }

  if (Array.isArray(record.nodes)) {
    return record.nodes.map((entry) => parseJsonRecord(entry)).filter((entry): entry is Record<string, unknown> => entry !== null);
  }

  return [record];
}

function collectDocumentRecords(
  hint: DocumentObjectView['displayKind'] | 'evidence',
  ...values: unknown[]
): Array<{ hint: DocumentObjectView['displayKind'] | 'evidence'; record: Record<string, unknown> }> {
  return values.flatMap((value) => recordArrayFrom(value).map((record) => ({ hint, record })));
}

function parseMetadataJson(record: Record<string, unknown>): Record<string, unknown> {
  return parseJsonRecord(record.metadata_json ?? record.metadata) ?? {};
}

function normalizeObjectRefsFromRecord(record: Record<string, unknown>): ActivityObjectRef[] {
  const refs = normalizeActivityObjectRefs(
    record.linked_object_refs ??
      record.linkedObjectRefs ??
      record.object_refs ??
      record.objectRefs ??
      (record.object_ref || record.objectRef ? [record.object_ref ?? record.objectRef] : undefined)
  );
  const linkRole = readFirstString(record.link_role, record.linkRole);
  const objectType = readFirstString(record.object_type, record.objectType);
  const objectId = readFirstString(record.object_id, record.objectId);
  if (refs.length === 0 && linkRole && objectType && objectId) {
    return [{ objectType, objectId, linkRole }];
  }
  return refs;
}

function inferDocumentObjectKind(
  record: Record<string, unknown>,
  hint: DocumentObjectView['displayKind'] | 'evidence'
): DocumentObjectView['displayKind'] {
  if (hint !== 'evidence') {
    return hint;
  }

  const objectType = readFirstString(record.object_type, record.objectType, record.kind, record.type)?.toLowerCase();
  const artifactKind = readFirstString(record.artifact_kind, record.artifactKind)?.toLowerCase();
  if (objectType === 'native_document') return 'native';
  if (objectType === 'external_document_ref') return 'external';
  if (artifactKind === 'curated_report' || artifactKind === 'rollup' || artifactKind === 'generated_summary') return 'curated';
  if (artifactKind === 'raw_task_receipt' || artifactKind === 'review_packet' || artifactKind === 'output_receipt' || artifactKind === 'audit_trail') return 'raw_proof';
  return 'unknown';
}

function displayKindLabel(kind: DocumentObjectView['displayKind']): string {
  if (kind === 'native') return 'Entity-native markdown';
  if (kind === 'external') return 'External document ref';
  if (kind === 'raw_proof') return 'Raw proof artifact';
  if (kind === 'curated') return 'Curated interpretation';
  return 'Document/artifact object';
}

function documentObjectToneClass(tone: ReceiptProofView['statusTone']): string {
  return receiptToneClass(tone);
}

function isRestrictedDocumentObject(record: Record<string, unknown>, metadata: Record<string, unknown>): boolean {
  const permissionState = readFirstString(
    record.permission_state,
    record.permissionState,
    record.entity_permission_state,
    record.entityPermissionState,
    metadata.permission_state,
    metadata.permissionState,
    metadata.entity_permission_state,
    metadata.entityPermissionState,
    metadata.visibility_state
  )?.toLowerCase();
  const policy = {
    ...(parseJsonRecord(record.entity_visibility_policy_json) ?? {}),
    ...(parseJsonRecord(record.entityVisibilityPolicyJson) ?? {}),
    ...(parseJsonRecord(record.entity_visibility_policy) ?? {}),
    ...(parseJsonRecord(record.entityVisibilityPolicy) ?? {}),
    ...(parseJsonRecord(metadata.entity_visibility_policy_json) ?? {}),
    ...(parseJsonRecord(metadata.entityVisibilityPolicyJson) ?? {}),
    ...(parseJsonRecord(metadata.entity_visibility_policy) ?? {}),
    ...(parseJsonRecord(metadata.entityVisibilityPolicy) ?? {}),
  };
  return record.restricted === true ||
    record.placeholder === true ||
    metadata.restricted === true ||
    metadata.placeholder === true ||
    Boolean(permissionState && permissionState !== 'visible' && permissionState !== 'allowed') ||
    policy.restricted === true ||
    policy.allow_preview === false;
}

function buildDocumentObjectView(
  taskId: number,
  hint: DocumentObjectView['displayKind'] | 'evidence',
  record: Record<string, unknown>
): DocumentObjectView | null {
  const metadata = parseMetadataJson(record);
  const displayKind = inferDocumentObjectKind(record, hint);
  const objectType: DocumentObjectView['objectType'] =
    displayKind === 'native'
      ? 'native_document'
      : displayKind === 'external'
        ? 'external_document_ref'
        : 'evidence_artifact';
  const restricted = isRestrictedDocumentObject(record, metadata);
  const id = readFirstString(record.id, record.object_id, record.objectId, record.artifact_id, record.artifactId);
  const rawTitle = readFirstString(record.title, record.name, record.label, metadata.title, id);
  if (!id) {
    return null;
  }
  const title = restricted ? 'Restricted object' : rawTitle ?? id;
  const rawHref = readFirstString(
    record.external_url,
    record.externalUrl,
    record.external_canonical_url,
    record.externalCanonicalUrl,
    record.human_path_alias,
    record.humanPathAlias,
    record.stable_path,
    record.stablePath,
    record.storage_path,
    record.storagePath,
    record.href,
    record.url
  );
  const href = restricted || !rawHref ? null : normalizeTaskOutputHref(rawHref) ?? rawHref;
  const authState = readFirstString(record.auth_state, record.authState, metadata.auth_state);
  const readinessState = readFirstString(record.readiness_state, record.readinessState, metadata.readiness_state);
  const integrityState = readFirstString(record.integrity_state, record.integrityState, metadata.integrity_state);
  const availabilityState = readFirstString(record.availability_state, record.availabilityState, metadata.availability_state);
  const canonicality = readFirstString(record.canonicality, metadata.canonicality) ??
    (displayKind === 'external' ? 'linked_context_only' : displayKind === 'native' ? 'entity_native' : 'entity_proof');
  const mutability = readFirstString(record.mutability_policy, record.mutabilityPolicy, metadata.mutability_policy) ??
    (displayKind === 'raw_proof' ? 'immutable_append_only' : displayKind === 'curated' || displayKind === 'native' ? 'editable_versioned' : 'reference_only');
  const objectRefs = normalizeObjectRefsFromRecord(record);
  const hasTaskRef = objectRefs.some((ref) => ref.objectType === 'task' && ref.objectId === String(taskId));
  const refs = objectRefs.length > 0
    ? objectRefs
    : [{ objectType: 'task', objectId: String(taskId), linkRole: readFirstString(record.link_role, record.linkRole) ?? 'linked_context' }];
  const degradedMessages = [
    restricted ? 'Restricted by Entity permissions. Snippets and previews are hidden.' : null,
    displayKind === 'external' && authState && !['authorized', 'ready'].includes(authState.toLowerCase())
      ? `Connector auth is ${formatReceiptToken(authState)}.`
      : null,
    displayKind === 'external' && readinessState && !['ready', 'live'].includes(readinessState.toLowerCase())
      ? `Connector readiness is ${formatReceiptToken(readinessState)}.`
      : null,
    integrityState && integrityState.toLowerCase() !== 'valid' ? `Integrity state is ${formatReceiptToken(integrityState)}.` : null,
    availabilityState && !['available', 'unknown'].includes(availabilityState.toLowerCase())
      ? `Availability is ${formatReceiptToken(availabilityState)}.`
      : null,
    !hasTaskRef && objectRefs.length > 0 ? 'Linked through a non-task ObjectRef.' : null,
  ].filter((entry): entry is string => Boolean(entry));
  const statusTone: ReceiptProofView['statusTone'] = restricted || degradedMessages.length > 0
    ? 'warning'
    : displayKind === 'raw_proof' || displayKind === 'native' || displayKind === 'curated'
      ? 'ok'
      : 'muted';

  return {
    id,
    objectType,
    displayKind,
    label: displayKindLabel(displayKind),
    title,
    href,
    externalHref: href ? /^https?:\/\//i.test(href) : false,
    sourceLabel: displayKind === 'external'
      ? formatReceiptToken(readFirstString(record.connector_type, record.connectorType, 'external connector'))
      : displayKind === 'native'
        ? 'Entity-owned markdown'
        : displayKind === 'raw_proof'
          ? 'Entity proof trail'
          : displayKind === 'curated'
            ? 'Entity curated report'
            : 'Entity object',
    canonicality: formatReceiptToken(canonicality),
    mutability: formatReceiptToken(mutability),
    status: restricted
      ? 'Restricted'
      : formatReceiptToken(readFirstString(authState, readinessState, integrityState, availabilityState, 'available')),
    statusTone,
    objectRefs: refs,
    restricted,
    degradedMessages,
    externalPreview: displayKind === 'external' && !restricted
      ? buildExternalDocumentPreviewView(record)
      : null,
  };
}

function buildTaskDocumentObjectViews(task: TaskDetailData, receiptProof: ReceiptProofView | null): DocumentObjectView[] {
  const metadata = task.metadataRecord;
  const grouped = firstRecord(
    metadata.phase2_document_objects,
    metadata.document_objects,
    metadata.docs_files_artifacts,
    metadata.docsArtifacts
  ) ?? {};
  const reviewPacket = firstRecord(metadata.review_packet, metadata.review_brief);
  const entries = [
    ...collectDocumentRecords('native', metadata.native_documents, metadata.nativeDocuments, grouped.native_documents, grouped.nativeDocuments),
    ...collectDocumentRecords('external', metadata.external_document_refs, metadata.externalDocumentRefs, grouped.external_document_refs, grouped.externalDocumentRefs),
    ...collectDocumentRecords('evidence', metadata.evidence_artifacts, metadata.evidenceArtifacts, grouped.evidence_artifacts, grouped.evidenceArtifacts, reviewPacket?.evidence_artifacts),
    ...collectDocumentRecords('evidence', metadata.curated_artifacts, metadata.curatedArtifacts, grouped.curated_artifacts, grouped.curatedArtifacts),
    ...collectDocumentRecords('evidence', metadata.document_artifacts, metadata.documentArtifacts, grouped.artifacts),
    ...collectDocumentRecords('evidence', grouped.objects, grouped.nodes),
  ];

  if (receiptProof?.artifactId) {
    entries.push({
      hint: 'evidence',
      record: {
        id: receiptProof.artifactId,
        title: 'Canonical receipt',
        artifact_kind: 'raw_task_receipt',
        stable_path: receiptProof.receiptHref ?? receiptProof.stablePath,
        content_hash: receiptProof.contentHash,
        mutability_policy: 'immutable_append_only',
        integrity_state: receiptProof.integrityState,
        availability_state: receiptProof.availabilityState,
        linked_object_refs: [{ object_type: 'task', object_id: String(task.id), link_role: 'receipt' }],
      },
    });
  }

  const views: DocumentObjectView[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const view = buildDocumentObjectView(task.id, entry.hint, entry.record);
    if (!view) {
      continue;
    }
    const key = `${view.objectType}:${view.id}:${view.objectRefs.map((ref) => ref.linkRole ?? '').join(',')}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    views.push(view);
  }

  return views;
}

function formatReceiptToken(value: unknown, fallback = 'Unknown'): string {
  const text = readNonEmptyString(value);
  if (!text) {
    return fallback;
  }

  return text.replace(/[_-]+/g, ' ');
}

function receiptStatusTone(status: string, integrityState: string, availabilityState: string): ReceiptProofView['statusTone'] {
  const normalizedStatus = status.toLowerCase();
  const normalizedIntegrity = integrityState.toLowerCase();
  const normalizedAvailability = availabilityState.toLowerCase();
  if (
    normalizedStatus.includes('failed') ||
    normalizedStatus.includes('missing') ||
    normalizedStatus.includes('integrity') ||
    normalizedIntegrity !== 'valid' ||
    (normalizedAvailability !== 'available' && normalizedAvailability !== 'unknown')
  ) {
    return 'error';
  }

  if (normalizedStatus.includes('pending') || normalizedStatus.includes('unknown') || normalizedAvailability === 'unknown') {
    return 'warning';
  }

  if (normalizedStatus.includes('not required')) {
    return 'muted';
  }

  return 'ok';
}

function receiptToneClass(tone: ReceiptProofView['statusTone']): string {
  if (tone === 'ok') {
    return 'border-[var(--accent)]/25 bg-[var(--surface-accent)] text-[var(--accent)]';
  }

  if (tone === 'error') {
    return 'border-[var(--error)]/35 bg-[var(--surface-error)] text-[var(--error)]';
  }

  if (tone === 'warning') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  }

  return 'border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-muted)]';
}

function normalizeReceiptDisplayLink(value: unknown, meta: string | null = null): ReceiptDisplayLink | null {
  const record = toRecord(value);
  if (record) {
    const rawHref = readFirstString(
      record.href,
      record.url,
      record.path,
      record.stable_path,
      record.stablePath,
      record.id
    );
    const label = readFirstString(record.label, record.title, record.name, rawHref);
    if (!label) {
      return null;
    }

    const href = rawHref ? normalizeTaskOutputHref(rawHref) ?? rawHref : null;
    return {
      label,
      href,
      external: href ? /^https?:\/\//i.test(href) : false,
      meta: meta ?? readFirstString(record.kind, record.type, record.artifact_kind, record.artifactKind),
    };
  }

  const text = readNonEmptyString(value);
  if (!text) {
    return null;
  }

  const href = normalizeTaskOutputHref(text) ?? text;
  return {
    label: text,
    href,
    external: /^https?:\/\//i.test(href),
    meta,
  };
}

function collectReceiptDisplayLinks(...values: unknown[]): ReceiptDisplayLink[] {
  const links: ReceiptDisplayLink[] = [];
  const seen = new Set<string>();

  const add = (value: unknown, meta: string | null = null) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => add(entry, meta));
      return;
    }

    const link = normalizeReceiptDisplayLink(value, meta);
    if (!link) {
      return;
    }

    const key = `${link.label}::${link.href ?? ''}::${link.meta ?? ''}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    links.push(link);
  };

  values.forEach((value) => add(value));
  return links;
}

function buildReceiptProofView(
  task: TaskDetailData,
  outputLinks: Array<{ label: string; href: string; external: boolean }>
): ReceiptProofView | null {
  const metadata = task.metadataRecord;
  const receipt = firstRecord(metadata.phase2_receipt, metadata.receipt, metadata.receipt_artifact);
  const reviewPacket = firstRecord(metadata.review_packet, metadata.review_brief);
  const hasReceiptMetadata = Boolean(receipt || readNonEmptyString(metadata.receipt_status));
  const doneWithoutReceipt = task.column === 'done' && !hasReceiptMetadata;
  const receiptActivity = task.activity.find((entry) => entry.activityEventType === 'receipt_created' || entry.activityEventType === 'receipt_failed');

  if (!hasReceiptMetadata && !doneWithoutReceipt && !receiptActivity) {
    return null;
  }

  const artifactId = readFirstString(receipt?.artifact_id, receipt?.artifactId, metadata.receipt_artifact_id);
  const artifactKind = readFirstString(receipt?.artifact_kind, receipt?.artifactKind) ?? 'raw_task_receipt';
  const mutability = readFirstString(receipt?.mutability_policy, receipt?.mutabilityPolicy) ?? (artifactKind === 'raw_task_receipt' ? 'immutable_append_only' : 'unknown');
  const stablePath = readFirstString(receipt?.stable_path, receipt?.stablePath);
  const receiptHref = readFirstString(receipt?.human_path_alias, receipt?.humanPathAlias, stablePath);
  const contentHash = readFirstString(receipt?.content_hash, receipt?.contentHash, metadata.receipt_content_hash);
  const integrityState = readFirstString(receipt?.integrity_state, receipt?.integrityState) ?? (artifactId ? 'valid' : 'missing_body');
  const availabilityState = readFirstString(receipt?.availability_state, receipt?.availabilityState) ?? (artifactId ? 'available' : 'unknown');
  const rawStatus = readFirstString(
    metadata.receipt_status,
    receipt?.receipt_status,
    receipt?.status,
    artifactId ? 'created' : null,
    doneWithoutReceipt ? 'missing_receipt' : null
  ) ?? 'not_required_yet';
  const status = formatReceiptToken(rawStatus, 'Unknown');
  const evidenceLinks = collectReceiptDisplayLinks(
    metadata.evidence_links,
    metadata.evidence_artifacts,
    metadata.output_artifact_ids,
    metadata.output_artifacts,
    reviewPacket?.evidence_links,
    reviewPacket?.evidence_artifacts,
    reviewPacket?.output_artifact_ids,
    reviewPacket?.output_artifacts
  );
  const normalizedOutputLinks = outputLinks.map((link) => ({
    ...link,
    meta: link.external ? 'external output' : 'Entity output',
  }));
  const evidenceSummary = readFirstString(
    metadata.evidence_summary,
    receipt?.evidence_summary,
    reviewPacket?.evidence_summary,
    reviewPacket?.evidence,
    reviewPacket?.requested_outcome,
    outputLinks.length > 0 ? 'Output links are attached.' : null
  ) ?? 'No evidence summary recorded.';
  const missingEvidenceReason = readFirstString(
    metadata.missing_evidence_reason,
    receipt?.missing_evidence_reason,
    reviewPacket?.missing_evidence_reason
  );
  const missingEvidence = normalizeBoolean(metadata.missing_evidence ?? receipt?.missing_evidence) ||
    Boolean(missingEvidenceReason) ||
    (task.column === 'done' && evidenceLinks.length === 0 && outputLinks.length === 0 && evidenceSummary === 'No evidence summary recorded.');
  const degradedMessages = [
    doneWithoutReceipt ? 'Completed task has no canonical receipt metadata.' : null,
    missingEvidence ? missingEvidenceReason ?? 'No evidence links or output artifacts were recorded.' : null,
    integrityState !== 'valid' ? `Integrity state is ${formatReceiptToken(integrityState)}.` : null,
    availabilityState !== 'available' && availabilityState !== 'unknown' ? `Availability is ${formatReceiptToken(availabilityState)}.` : null,
    readFirstString(metadata.receipt_error, receipt?.error) ? `Receipt error: ${readFirstString(metadata.receipt_error, receipt?.error)}` : null,
  ].filter((entry): entry is string => Boolean(entry));

  return {
    status,
    statusTone: receiptStatusTone(status, integrityState, availabilityState),
    artifactId,
    artifactKind: formatReceiptToken(artifactKind),
    artifactMode: artifactKind === 'raw_task_receipt'
      ? 'raw'
      : artifactKind.includes('curated')
        ? 'curated'
        : 'unknown',
    mutability: formatReceiptToken(mutability),
    stablePath,
    receiptHref,
    contentHash,
    integrityState: formatReceiptToken(integrityState),
    availabilityState: formatReceiptToken(availabilityState),
    createdAt: readFirstString(receipt?.created_at, receipt?.createdAt),
    evidenceSummary,
    missingEvidence,
    missingEvidenceReason,
    evidenceLinks,
    outputLinks: normalizedOutputLinks,
    reviewDecision: readFirstString(metadata.review_decision, receipt?.review_decision, receipt?.reviewDecision) ?? 'Pending',
    approvalDecision: readFirstString(metadata.human_gate_decision, receipt?.human_gate_decision, receipt?.humanGateDecision) ?? 'Not recorded',
    provenance: readFirstString(receipt?.provenance, metadata.provenance, metadata.source, receiptActivity?.provenance) ?? 'Entity task metadata',
    degradedMessages,
  };
}

type ReviewDecision = 'pending' | 'accepted' | 'needs_fix' | 'rejected';

const REVIEW_DECISION_LABELS: Record<ReviewDecision, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  needs_fix: 'Needs fix',
  rejected: 'Rejected',
};

function normalizeReviewDecision(value: unknown): ReviewDecision {
  const normalized = readNonEmptyString(value)?.toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'request_fix') {
    return 'needs_fix';
  }
  if (normalized === 'accepted' || normalized === 'needs_fix' || normalized === 'rejected') {
    return normalized;
  }
  return 'pending';
}

function buildReviewMetadataPatch(
  task: TaskDetailData,
  decision: ReviewDecision,
  reviewer: string
): string {
  return JSON.stringify({
    ...task.metadataRecord,
    review_decision: decision,
    reviewed_by: reviewer,
    reviewed_at: new Date().toISOString(),
  });
}

async function requestOptionalJson<T = unknown>(
  path: string,
  apiBase: string,
  init?: RequestInit,
  fallbackError = 'Unable to reach endpoint.'
): Promise<T | null> {
  try {
    return await requestJsonWithFallback<T>({
      urls: buildApiCandidates(path, apiBase),
      init,
      continueOnStatuses: [],
      fallbackError,
    });
  } catch (error) {
    if (error instanceof HttpRequestError && error.status === 404) {
      return null;
    }

    throw error;
  }
}

async function fetchTaskDetail(taskId: number, apiBase: string): Promise<TaskDetailData> {
  const payload = await requestJsonWithFallback({
    urls: buildApiCandidates(`/tasks/${taskId}`, apiBase),
    init: { method: 'GET' },
    continueOnStatuses: [],
    fallbackError: 'Unable to load task detail.',
  });

  const normalized = normalizeTaskDetail(payload);
  if (!normalized) {
    throw new Error('Task detail response was invalid.');
  }

  return normalized;
}

async function fetchProjectOptions(apiBase: string): Promise<ProjectOption[]> {
  return fetchAllowedProjectOptions(apiBase);
}

async function fetchTaskProjects(taskId: number, apiBase: string): Promise<ProjectOption[]> {
  const payload = await requestOptionalJson(
    `/tasks/${taskId}/projects`,
    apiBase,
    { method: 'GET' },
    'Unable to load task projects.'
  );
  if (!payload || !Array.isArray(payload)) {
    return [];
  }

  return payload.map(normalizeProjectOption).filter((entry): entry is ProjectOption => entry !== null);
}

async function fetchTaskComments(taskId: number, apiBase: string): Promise<{ comments: TaskCommentRecord[]; available: boolean }> {
  const payload = await requestOptionalJson(
    `/tasks/${taskId}/comments`,
    apiBase,
    { method: 'GET' },
    'Unable to load task comments.'
  );
  if (!payload) {
    return { comments: [], available: false };
  }

  if (!Array.isArray(payload)) {
    return { comments: [], available: true };
  }

  return {
    comments: payload.map(normalizeTaskComment).filter((entry): entry is TaskCommentRecord => entry !== null),
    available: true,
  };
}

function findDependencyName(dependency: TaskDependency, boardTasks: TaskBoardTask[]): string {
  if (dependency.name) {
    return dependency.name;
  }

  const match = boardTasks.find((task) => task.id === dependency.id);
  return match?.name ?? `Task #${dependency.id}`;
}

export default function TaskDetailPanel({ taskId, apiBase = '', onClose, onDocsLinkNavigate }: TaskDetailPanelProps) {
  const [userProfile] = useUserProfile();
  const [activeAgentNames, setActiveAgentNames] = useState<string[]>([]);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const detailSectionRef = useRef<HTMLElement | null>(null);
  const projectDropdownRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [task, setTask] = useState<TaskDetailData | null>(null);
  const [form, setForm] = useState<TaskFormState | null>(null);
  const [allProjects, setAllProjects] = useState<ProjectOption[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<ProjectOption[]>([]);
  const [projectSearch, setProjectSearch] = useState('');
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const [comments, setComments] = useState<TaskCommentRecord[]>([]);
  const [commentsAvailable, setCommentsAvailable] = useState(true);
  const [detailTab, setDetailTab] = useState<DetailTab>('activity');
  const [advancedFieldsOpen, setAdvancedFieldsOpen] = useState(false);
  const [outputSectionOpen, setOutputSectionOpen] = useState(false);
  const [activityView, setActivityView] = useState<'human' | 'technical'>('human');
  const [outputInput, setOutputInput] = useState('');
  const [dependencyInput, setDependencyInput] = useState('');
  const [attachmentName, setAttachmentName] = useState('');
  const [attachmentPath, setAttachmentPath] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [commentInput, setCommentInput] = useState('');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [replyTargetId, setReplyTargetId] = useState<number | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});
  const { tasks: boardTasks, reloadTasks } = useTaskBoard({ apiBase, autoLoad: false });
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);

  // Fetch effective config for workspaceRoot
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/api/config/effective`);
        if (res.ok && !cancelled) {
          const data = (await res.json()) as { settings?: { server?: { workspaceRoot?: string } } };
          if (data.settings?.server?.workspaceRoot) {
            setWorkspaceRoot(data.settings.server.workspaceRoot);
          }
        }
      } catch {
        // ignore fetch errors
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  useEffect(() => {
    const animationId = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(animationId);
  }, []);

  useEffect(() => {
    if (!saveMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => setSaveMessage(null), 2400);
    return () => window.clearTimeout(timeoutId);
  }, [saveMessage]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(() => onClose(), 200);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (!projectDropdownRef.current) {
        return;
      }

      if (!projectDropdownRef.current.contains(event.target as Node)) {
        setProjectDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  useEffect(() => {
    if (!task || loading) {
      return;
    }

    const focusId = window.requestAnimationFrame(() => {
      (closeButtonRef.current ?? panelRef.current)?.focus();
    });

    return () => window.cancelAnimationFrame(focusId);
  }, [loading, task]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSaveMessage(null);
    setDetailTab('activity');
    setActivityView('human');
    setReplyTargetId(null);
    setReplyDrafts({});

    const load = async () => {
      try {
        const [detailResult, projectsResult, taskProjectsResult, commentsResult] = await Promise.allSettled([
          fetchTaskDetail(taskId, apiBase),
          fetchProjectOptions(apiBase),
          fetchTaskProjects(taskId, apiBase),
          fetchTaskComments(taskId, apiBase),
        ]);

        if (cancelled) {
          return;
        }

        if (detailResult.status !== 'fulfilled') {
          throw detailResult.reason;
        }

        const detail = detailResult.value;
        setTask(detail);
        setForm(buildForm(detail));
        setOutputInput(detail.output);
        setOutputSectionOpen(detail.output.trim().length > 0);
        setDependencyInput(detail.dependencies.map((dependency) => String(dependency.id)).join(', '));
        setAllProjects(projectsResult.status === 'fulfilled' ? projectsResult.value : []);
        setSelectedProjects(taskProjectsResult.status === 'fulfilled' ? taskProjectsResult.value : []);

        if (commentsResult.status === 'fulfilled') {
          setComments(commentsResult.value.comments);
          setCommentsAvailable(commentsResult.value.available);
        } else {
          setComments([]);
          setCommentsAvailable(false);
        }
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setError(toErrorMessage(loadError, 'Unable to load task detail.'));
        setTask(null);
        setForm(null);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [apiBase, taskId]);

  const assigneeOptions = useMemo(
    () => composeAssigneeOptions(activeAgentNames, userProfile.displayName, form?.assignee),
    [activeAgentNames, form?.assignee, userProfile.displayName],
  );
  const actorAliases = useMemo(
    () => uniqueStrings([userProfile.displayName, userProfile.handle, userProfile.email])
      .map((entry) => entry.toLowerCase()),
    [userProfile.displayName, userProfile.email, userProfile.handle],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchActiveAgentNames(apiBase)
      .then((names) => {
        if (!cancelled) {
          setActiveAgentNames(names);
        }
      })
      .catch((error) => {
        console.error('Failed to load active agents for assignee options:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const modelOptions = useMemo(() => {
    const dynamicModels = uniqueStrings([form?.model, task?.model, ...(task?.models ?? [])]);
    return ['', ...dynamicModels.filter((entry) => entry)];
  }, [form?.model, task?.model, task?.models]);

  const selectedProjectIds = useMemo(() => new Set(selectedProjects.map((project) => project.id)), [selectedProjects]);

  const filteredProjectOptions = useMemo(() => {
    const query = projectSearch.trim().toLowerCase();
    return allProjects.filter((project) => {
      if (selectedProjectIds.has(project.id)) {
        return false;
      }

      if (!query) {
        return true;
      }

      return project.name.toLowerCase().includes(query);
    });
  }, [allProjects, projectSearch, selectedProjectIds]);

  const visibleActivity = useMemo(() => {
    if (!task) {
      return [];
    }

    return task.activity.filter((entry) => (activityView === 'technical' ? isTechnicalActivity(entry) : !isTechnicalActivity(entry)));
  }, [activityView, task]);

  const commentTree = useMemo(() => buildCommentTree(comments), [comments]);
  const outputLinks = useMemo(() => extractTaskOutputLinks(task?.output ?? ''), [task?.output]);
  const receiptProof = useMemo(() => (task ? buildReceiptProofView(task, outputLinks) : null), [outputLinks, task]);
  const documentObjectViews = useMemo(() => (task ? buildTaskDocumentObjectViews(task, receiptProof) : []), [receiptProof, task]);
  const worktypeOverlay = useMemo(() => (task ? buildWorktypeOverlayView(task) : null), [task]);
  const reviewActorEligible = task
    ? principalMatches(actorAliases, task.reviewerPrincipalId ?? task.reviewer)
    : false;
  const humanGateActorEligible = task
    ? principalMatches(actorAliases, task.approverPrincipalId ?? task.approver)
    : false;
  const humanGateRequestEligible = task
    ? humanGateActorEligible || principalMatches(actorAliases, task.ownerPrincipalId)
    : false;
  const outputIsEmpty = task ? task.output.trim().length === 0 && outputLinks.length === 0 : true;
  const outputExpanded = !outputIsEmpty || outputSectionOpen;
  const subtasks = useMemo(() => {
    if (!task) {
      return [];
    }

    return boardTasks
      .filter((candidate) => candidate.parent_task_id === task.id)
      .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime());
  }, [boardTasks, task]);

  const setStatus = (message: string | null) => {
    setSaveMessage(message);
    if (message) {
      setError(null);
    }
  };

  const loadSupplementalData = async (
    currentTaskId: number,
    options: { preserveOutput?: boolean; preserveDependencyInput?: boolean } = {}
  ) => {
    const [detailResult, taskProjectsResult, commentsResult] = await Promise.allSettled([
      fetchTaskDetail(currentTaskId, apiBase),
      fetchTaskProjects(currentTaskId, apiBase),
      fetchTaskComments(currentTaskId, apiBase),
    ]);

    if (detailResult.status === 'fulfilled') {
      const detail = detailResult.value;
      setTask(detail);
      setForm(buildForm(detail));
      if (!options.preserveOutput) {
        setOutputInput(detail.output);
        setOutputSectionOpen(detail.output.trim().length > 0);
      } else if (detail.output.trim()) {
        setOutputSectionOpen(true);
      }
      if (!options.preserveDependencyInput) {
        setDependencyInput(detail.dependencies.map((dependency) => String(dependency.id)).join(', '));
      }
    } else {
      throw detailResult.reason;
    }

    if (taskProjectsResult.status === 'fulfilled') {
      setSelectedProjects(taskProjectsResult.value);
    }

    if (commentsResult.status === 'fulfilled') {
      setComments(commentsResult.value.comments);
      setCommentsAvailable(commentsResult.value.available);
    }
  };

  // Keep the latest loadSupplementalData for the websocket listener without
  // re-subscribing on every render.
  const supplementalRef = useRef(loadSupplementalData);
  supplementalRef.current = loadSupplementalData;

  // Live-refresh this task's detail + comments when the server broadcasts
  // changes for it (e.g. an @mentioned agent's reply or task pickup).
  useEntityWebSocket((message) => {
    if (Number(message.taskId) !== taskId) {
      return;
    }
    if (
      message.type === 'task:comment' ||
      message.type === 'task:updated' ||
      message.type === 'task:moved'
    ) {
      void supplementalRef.current(taskId, {
        preserveOutput: true,
        preserveDependencyInput: true,
      });
    }
  });

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) {
      return [];
    }
    const query = mentionQuery.toLowerCase();
    return activeAgentNames.filter((name) => name.toLowerCase().includes(query)).slice(0, 6);
  }, [activeAgentNames, mentionQuery]);

  const handleCommentInputChange = (value: string) => {
    setCommentInput(value);
    const match = value.match(/@([\w.-]*)$/);
    setMentionQuery(match ? match[1] : null);
  };

  const applyMention = (name: string) => {
    setCommentInput((prev) => prev.replace(/@([\w.-]*)$/, `@${name} `));
    setMentionQuery(null);
  };

  const clearStaleBlockerReason = (detail: TaskDetailData) => {
    const stalePatterns = [
      /agent.*connection.*failed/i,
      /connection.*failed/i,
      /connection.*lost/i,
      /agent.*unreachable/i,
      /connection.*refused/i,
    ];
    const reason = detail.blockerReason?.trim() ?? '';
    if (!reason) {
      return;
    }
    const shouldClear = stalePatterns.some((pattern) => pattern.test(reason));
    if (!shouldClear) {
      return;
    }

    requestJsonWithFallback({
      urls: buildApiCandidates(`/tasks/${detail.id}`, apiBase),
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blocked: false,
          blocker_reason: '',
          user: userProfile.displayName,
        }),
      },
      continueOnStatuses: [],
      fallbackError: '',
    }).catch(() => undefined);
  };

  const patchTask = async (
    updates: Record<string, unknown>,
    options: { successMessage: string; preserveOutput?: boolean; preserveDependencyInput?: boolean; action?: string }
  ) => {
    if (!task) {
      return;
    }

    setBusyAction(options.action ?? 'save');
    setError(null);
    setSaveMessage(null);

    try {
      await requestJsonWithFallback({
        urls: buildApiCandidates(`/tasks/${task.id}`, apiBase),
        init: {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...updates,
            user: userProfile.displayName,
            blocked: false,
            blocker_reason: null,
          }),
        },
        continueOnStatuses: [],
        fallbackError: 'Unable to save task.',
      });

      await loadSupplementalData(task.id, {
        preserveOutput: options.preserveOutput ?? true,
        preserveDependencyInput: options.preserveDependencyInput ?? true,
      });
      clearStaleBlockerReason(task);
      setStatus(options.successMessage);
      void reloadTasks().catch(() => undefined);
    } catch (saveError) {
      setError(toErrorMessage(saveError, 'Unable to save task.'));
      await loadSupplementalData(task.id, {
        preserveOutput: true,
        preserveDependencyInput: true,
      }).catch(() => undefined);
    } finally {
      setBusyAction(null);
    }
  };

  const updateFormField = <Key extends keyof TaskFormState>(key: Key, value: TaskFormState[Key]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setError(null);
    setSaveMessage(null);
  };

  const saveTitle = async () => {
    if (!task || !form) {
      return;
    }

    const trimmedName = form.name.trim();
    if (!trimmedName) {
      setError('Task name is required.');
      setForm((current) => (current ? { ...current, name: task.name } : current));
      return;
    }

    if (trimmedName === task.name) {
      if (trimmedName !== form.name) {
        updateFormField('name', trimmedName);
      }
      return;
    }

    await patchTask({ name: trimmedName }, { successMessage: 'Task name saved.' });
  };

  const saveDescription = async () => {
    if (!task || !form || form.description === task.description) {
      return;
    }

    await patchTask({ description: form.description }, { successMessage: 'Description saved.' });
  };

  const saveBlockerReason = async () => {
    if (!task || !form || !form.blocked) {
      return;
    }

    if (form.blockerReason === task.blockerReason) {
      return;
    }

    await patchTask(
      { blocker_reason: form.blockerReason },
      { successMessage: 'Blocker reason saved.' }
    );
  };

  const saveEstimateHours = async () => {
    if (!task || !form) {
      return;
    }

    const nextValue = parseHoursInput(form.estimateHours);
    const currentValue = task.estimateHours;
    if (nextValue === currentValue || (nextValue === null && currentValue === null)) {
      return;
    }

    await patchTask(
      { estimate_hours: nextValue },
      { successMessage: 'Estimate saved.' }
    );
  };

  const saveTimeSpent = async () => {
    if (!task || !form) {
      return;
    }

    const nextValue = parseHoursInput(form.timeSpent);
    const currentValue = task.timeSpent;
    if (nextValue === currentValue || (nextValue === null && currentValue === null)) {
      return;
    }

    await patchTask(
      { time_spent: nextValue },
      { successMessage: 'Time spent saved.' }
    );
  };

  const saveModel = async (nextModel: string) => {
    if (!task || !form) {
      return;
    }

    updateFormField('model', nextModel);
    const metadata = buildMetadataPatch(task, { model: nextModel || null });
    await patchTask(
      { model: nextModel || null, metadata },
      { successMessage: 'Model saved.' }
    );
  };

  const saveOutput = async () => {
    if (!task) {
      return;
    }

    await patchTask(
      { output: outputInput },
      {
        successMessage: 'Output saved.',
        preserveOutput: false,
      }
    );
  };

  const autoGenerateSubtasks = async () => {
    if (!task) {
      return;
    }

    setBusyAction('subtasks');
    setError(null);
    setSaveMessage(null);

    try {
      await requestJsonWithFallback({
        urls: buildApiCandidates(`/tasks/${task.id}/subtasks/auto`, apiBase),
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
        continueOnStatuses: [],
        fallbackError: 'Unable to auto-generate subtasks.',
      });

      await loadSupplementalData(task.id, { preserveOutput: true, preserveDependencyInput: true });
      void reloadTasks().catch(() => undefined);
      setStatus('Subtasks generated.');
    } catch (subtaskError) {
      setError(toErrorMessage(subtaskError, 'Unable to auto-generate subtasks.'));
    } finally {
      setBusyAction(null);
    }
  };

  const saveDependencies = async () => {
    if (!task) {
      return;
    }

    const ids = Array.from(
      new Set(
        dependencyInput
          .split(/[,\s]+/)
          .map((entry) => normalizePositiveInteger(entry))
          .filter((entry): entry is number => entry !== null && entry !== task.id)
      )
    );
    const dependencies = ids.map((id) => ({
      id,
      name: boardTasks.find((candidate) => candidate.id === id)?.name ?? null,
    }));

    const metadata = buildMetadataPatch(task, { dependencies });
    await patchTask(
      { dependencies: ids, metadata },
      {
        successMessage: 'Dependencies saved.',
        preserveDependencyInput: false,
      }
    );
  };

  const addAttachment = async () => {
    if (!task) {
      return;
    }

    const name = attachmentName.trim();
    const path = attachmentPath.trim();
    if (!path) {
      setError('Attachment path is required.');
      return;
    }

    const attachments = [
      ...task.attachments,
      {
        name: name || path,
        path,
      },
    ];
    const metadata = buildMetadataPatch(task, { attachments });
    await patchTask(
      { attachments, metadata },
      { successMessage: 'Attachment added.' }
    );
    setAttachmentName('');
    setAttachmentPath('');
  };

  const saveTaskProjects = async (projectIds: number[]) => {
    if (!task) {
      return;
    }

    setBusyAction('projects');
    setError(null);
    setSaveMessage(null);

    try {
      const payload = await requestJsonWithFallback({
        urls: buildApiCandidates(`/tasks/${task.id}/projects`, apiBase),
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectIds }),
        },
        continueOnStatuses: [],
        fallbackError: 'Unable to update projects.',
      });

      const normalized = Array.isArray(payload)
        ? payload.map(normalizeProjectOption).filter((entry): entry is ProjectOption => entry !== null)
        : [];

      setSelectedProjects(normalized);
      setStatus('Projects updated.');
      void reloadTasks().catch(() => undefined);
    } catch (saveError) {
      setError(toErrorMessage(saveError, 'Unable to update projects.'));
    } finally {
      setBusyAction(null);
    }
  };

  const addProject = async (projectId: number) => {
    const nextIds = [...selectedProjectIds, projectId];
    await saveTaskProjects(nextIds);
    setProjectSearch('');
    setProjectDropdownOpen(false);
  };

  const removeProject = async (projectId: number) => {
    const nextIds = selectedProjects.filter((project) => project.id !== projectId).map((project) => project.id);
    await saveTaskProjects(nextIds);
  };

  const saveReviewDecision = async (decision: ReviewDecision, options: { complete?: boolean } = {}) => {
    if (!task) {
      return;
    }

    if (task.reviewRequired && (decision === 'accepted' || decision === 'needs_fix')) {
      const endpoint = decision === 'accepted' ? 'accept' : 'request-fix';
      setBusyAction('review');
      setError(null);
      setSaveMessage(null);
      try {
        await requestJsonWithFallback({
          urls: buildApiCandidates(`/tasks/${task.id}/review/${endpoint}`, apiBase),
          init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              actor_principal_id: userProfile.displayName,
              actor_type: 'human',
              reason: decision === 'accepted'
                ? 'Accepted from task detail review panel.'
                : 'Fix requested from task detail review panel.',
            }),
          },
          continueOnStatuses: [],
          fallbackError: 'Unable to update review state.',
        });
        await loadSupplementalData(task.id, { preserveOutput: true, preserveDependencyInput: true });
        if (options.complete && decision === 'accepted') {
          await patchTask(
            { column: 'done' },
            {
              successMessage: 'Review accepted and task moved to Done.',
              action: 'review',
            }
          );
        } else {
          setStatus(`Review marked ${REVIEW_DECISION_LABELS[decision].toLowerCase()}.`);
        }
        void reloadTasks().catch(() => undefined);
      } catch (saveError) {
        setError(toErrorMessage(saveError, 'Unable to update review state.'));
        await loadSupplementalData(task.id, { preserveOutput: true, preserveDependencyInput: true }).catch(() => undefined);
      } finally {
        setBusyAction(null);
      }
      return;
    }

    const reviewer = userProfile.displayName || 'Reviewer';
    const metadata = buildReviewMetadataPatch(task, decision, reviewer);
    await patchTask(
      {
        metadata,
        ...(options.complete ? { column: 'done' } : {}),
      },
      {
        successMessage: options.complete
          ? 'Review accepted and task moved to Done.'
          : `Review marked ${REVIEW_DECISION_LABELS[decision].toLowerCase()}.`,
        action: 'review',
      }
    );
  };

  const saveHumanGateAction = async (action: 'request' | 'approve' | 'reject') => {
    if (!task) {
      return;
    }

    setBusyAction(`human-gate-${action}`);
    setError(null);
    setSaveMessage(null);
    try {
      await requestJsonWithFallback({
        urls: buildApiCandidates(`/tasks/${task.id}/human-gate/${action}`, apiBase),
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actor_principal_id: userProfile.displayName,
            actor_type: 'human',
            reason: `Human gate ${action} from task detail panel.`,
          }),
        },
        continueOnStatuses: [],
        fallbackError: 'Unable to update human gate.',
      });
      await loadSupplementalData(task.id, { preserveOutput: true, preserveDependencyInput: true });
      setStatus(
        action === 'request'
          ? 'Human gate requested.'
          : action === 'approve'
            ? 'Human gate approved.'
            : 'Human gate rejected.'
      );
      void reloadTasks().catch(() => undefined);
    } catch (saveError) {
      setError(toErrorMessage(saveError, 'Unable to update human gate.'));
      await loadSupplementalData(task.id, { preserveOutput: true, preserveDependencyInput: true }).catch(() => undefined);
    } finally {
      setBusyAction(null);
    }
  };

  const addNote = async () => {
    if (!task) {
      return;
    }

    const note = noteInput.trim();
    if (!note) {
      return;
    }

    setBusyAction('note');
    setError(null);
    setSaveMessage(null);

    try {
      await requestJsonWithFallback({
        urls: buildApiCandidates(`/tasks/${task.id}/activity`, apiBase),
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'Added note',
            user: userProfile.displayName,
            details: note,
            type: 'note',
          }),
        },
        continueOnStatuses: [],
        fallbackError: 'Unable to add note.',
      });

      setNoteInput('');
      await loadSupplementalData(task.id, {
        preserveOutput: true,
        preserveDependencyInput: true,
      });
      setStatus('Note added.');
    } catch (saveError) {
      setError(toErrorMessage(saveError, 'Unable to add note.'));
    } finally {
      setBusyAction(null);
    }
  };

  const postComment = async (parentId: number | null = null) => {
    if (!task) {
      return;
    }

    const body = (parentId ? replyDrafts[parentId] : commentInput).trim();
    if (!body) {
      return;
    }

    setBusyAction('comment');
    setError(null);
    setSaveMessage(null);

    try {
      const payload = await requestOptionalJson(
        `/tasks/${task.id}/comments`,
        apiBase,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            body,
            author: userProfile.displayName,
            parent_id: parentId,
          }),
        },
        'Unable to add comment.'
      );

      if (payload === null) {
        await requestJsonWithFallback({
          urls: buildApiCandidates(`/tasks/${task.id}/activity`, apiBase),
          init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'Added comment',
              user: userProfile.displayName,
              details: body,
              type: 'comment',
            }),
          },
          continueOnStatuses: [],
          fallbackError: 'Unable to add comment.',
        });
        setCommentsAvailable(false);
        setStatus('Comment endpoint unavailable. Logged comment to activity instead.');
      } else {
        setStatus('Comment added.');
      }

      if (parentId) {
        setReplyDrafts((current) => ({ ...current, [parentId]: '' }));
        setReplyTargetId(null);
      } else {
        setCommentInput('');
      }

      await loadSupplementalData(task.id, {
        preserveOutput: true,
        preserveDependencyInput: true,
      });
    } catch (saveError) {
      setError(toErrorMessage(saveError, 'Unable to add comment.'));
    } finally {
      setBusyAction(null);
    }
  };

  const syncSessionLogs = async () => {
    if (!task) {
      return;
    }

    setBusyAction('sync');
    setError(null);
    setSaveMessage(null);

    try {
      const payload = await requestOptionalJson(
        `/tasks/${task.id}/sync-sessions`,
        apiBase,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
        'Unable to sync session logs.'
      );

      if (payload === null) {
        console.info('[TaskDetailPanel] Sync session logs endpoint is not available.', { taskId: task.id });
        setStatus('Sync is not available on this server.');
        return;
      }

      await loadSupplementalData(task.id, {
        preserveOutput: true,
        preserveDependencyInput: true,
      });
      setActivityView('technical');
      setStatus('Session logs synced.');
    } catch (saveError) {
      setError(toErrorMessage(saveError, 'Unable to sync session logs.'));
    } finally {
      setBusyAction(null);
    }
  };

  const handleContinueWork = async () => {
    if (!task) {
      return;
    }

    setBusyAction('continue');
    setError(null);
    setSaveMessage(null);

    try {
      await requestJsonWithFallback({
        urls: buildApiCandidates(`/tasks/${task.id}/activity`, apiBase),
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'Continue work requested',
            user: userProfile.displayName,
            details: `Continue work requested for ${task.assignee || 'Unassigned'} using ${form?.model || task.model || 'the default model'}.`,
            type: 'handoff',
          }),
        },
        continueOnStatuses: [],
        fallbackError: 'Unable to request continued work.',
      });

      await loadSupplementalData(task.id, {
        preserveOutput: true,
        preserveDependencyInput: true,
      });
      setDetailTab('activity');
      setStatus('Continue work request logged.');
    } catch (saveError) {
      setError(toErrorMessage(saveError, 'Unable to request continued work.'));
    } finally {
      setBusyAction(null);
    }
  };

  const handleFollowUp = async () => {
    if (!task) {
      return;
    }

    setBusyAction('follow-up');
    setError(null);
    setSaveMessage(null);

    try {
      const followUpTask = await requestJsonWithFallback<{ id?: number }>({
        urls: buildApiCandidates('/tasks', apiBase),
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `Follow-up: ${task.name}`,
            description: `Follow-up task created from #${task.id}.\n\nOriginal task: ${task.name}`,
            assignee: task.assignee,
            column: 'backlog',
            priority: task.priority,
            model: form?.model || task.model || undefined,
            metadata: JSON.stringify({ parent_task_id: task.id, source: 'task-detail-follow-up' }),
            create_anyway: true,
          }),
        },
        continueOnStatuses: [],
        fallbackError: 'Unable to create follow-up task.',
      });

      await requestJsonWithFallback({
        urls: buildApiCandidates(`/tasks/${task.id}/activity`, apiBase),
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'Created follow-up',
            user: userProfile.displayName,
            details: `Created follow-up task${followUpTask?.id ? ` #${followUpTask.id}` : ''}.`,
            type: 'task_created',
          }),
        },
        continueOnStatuses: [],
        fallbackError: 'Unable to log follow-up task.',
      });

      await loadSupplementalData(task.id, {
        preserveOutput: true,
        preserveDependencyInput: true,
      });
      void reloadTasks().catch(() => undefined);
      setDetailTab('subtasks');
      setStatus(followUpTask?.id ? `Follow-up task #${followUpTask.id} created.` : 'Follow-up task created.');
    } catch (saveError) {
      setError(toErrorMessage(saveError, 'Unable to create follow-up task.'));
    } finally {
      setBusyAction(null);
    }
  };

  const renderCommentNodes = (nodes: TaskCommentNode[], depth = 0): ReactNode =>
    nodes.map((comment) => {
      const replyValue = replyDrafts[comment.id] ?? '';

      return (
        <div
          key={comment.id}
          className="min-w-0 overflow-hidden rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-3"
          style={{ marginLeft: depth * 16 }}
        >
	          <div className="flex min-w-0 items-start justify-between gap-3">
	            <div className="min-w-0 flex-1 overflow-hidden">
	              <div className="text-sm font-medium text-[var(--text-primary)]">
	                {comment.author} <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">- Added comment</span>
	              </div>
	              <div className="mt-1 min-w-0 max-w-full overflow-hidden whitespace-pre-wrap break-words text-sm leading-5 text-[var(--text-secondary)] [overflow-wrap:anywhere]">{comment.body}</div>
	            </div>
            <time className="shrink-0 whitespace-nowrap text-[11px] text-[var(--text-muted)]" dateTime={comment.createdAt}>
              {formatDateTime(comment.createdAt)}
            </time>
          </div>

	          <div className="mt-2 flex justify-end">
	            <button
	              type="button"
	              className={`mc-shell-btn px-2 py-1 text-[11px] ${replyTargetId === comment.id ? 'mc-shell-btn-active text-[var(--text-primary)]' : ''}`}
	              onClick={() => setReplyTargetId((current) => (current === comment.id ? null : comment.id))}
	            >
	              Reply
	            </button>
	          </div>

          {replyTargetId === comment.id ? (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
              <input
                type="text"
                value={replyValue}
                onChange={(event) =>
                  setReplyDrafts((current) => ({
                    ...current,
                    [comment.id]: event.target.value,
                  }))
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void postComment(comment.id);
                  }
                }}
                placeholder="Write a reply..."
                className="mc-shell-input min-w-0 flex-1 px-3 py-2 text-sm"
              />
	              <button
	                type="button"
                className="mc-shell-btn mc-shell-btn-active px-3 py-2 text-xs font-medium text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => void postComment(comment.id)}
                disabled={busyAction === 'comment' || !replyValue.trim()}
              >
                Send
              </button>
            </div>
          ) : null}

          {comment.children.length > 0 ? <div className="mt-3 space-y-3">{renderCommentNodes(comment.children, depth + 1)}</div> : null}
        </div>
      );
    });

  const accountabilityRows = task
    ? [
        {
          label: 'Initiator',
          value: formatAccountabilityField(task.initiatorPrincipalId),
          meta: task.initiatorType ?? 'type unknown',
        },
        {
          label: 'Owner',
          value: formatAccountabilityField(task.ownerPrincipalId),
          meta: task.ownerPrincipalType ?? 'principal type unknown',
        },
        {
          label: 'Assignee',
          value: formatAccountabilityField(task.assignee === 'Unassigned' ? null : task.assignee),
          meta: task.assignmentState ?? 'assignment state unknown',
        },
        {
          label: 'Executor',
          value: task.executorPrincipalId
            ? formatAccountabilityField(task.executorPrincipalId)
            : task.taskmasterDrivable
              ? { label: 'Task Master drivable', degraded: false }
              : formatAccountabilityField(null),
          meta: task.taskmasterDrivable ? 'policy-drivable unassigned state' : 'individual executor expected',
        },
        {
          label: 'Submitted by',
          value: formatAccountabilityField(task.submittedBy),
          meta: 'review submission principal',
        },
        {
          label: 'Reviewer',
          value: formatAccountabilityField(task.reviewer),
          meta: 'review decision principal',
        },
        {
          label: 'Approver',
          value: formatAccountabilityField(task.approver),
          meta: 'human gate principal',
        },
      ]
    : [];
  const routingState = task
    ? buildRoutingStateView({
        assignee: task.assignee,
        assignmentState: task.assignmentState,
        taskmasterDrivable: task.taskmasterDrivable,
        executorPrincipalId: task.executorPrincipalId,
        ownerPrincipalId: task.ownerPrincipalId,
        ownerPrincipalType: task.ownerPrincipalType,
        metadataRecord: task.metadataRecord,
        activityEventTypes: task.activity.map((entry) => entry.activityEventType),
      })
    : null;

  return (
    <div className="fixed inset-0 z-[85] pointer-events-none">
      <div
        className={`pointer-events-auto absolute inset-0 bg-[var(--overlay-strong)] transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        data-testid="task-detail-panel"
        className={`pointer-events-auto absolute bottom-0 right-0 top-[45px] flex h-[calc(100%-45px)] w-full flex-col overflow-hidden border-l border-[var(--border-primary)] bg-[var(--panel-surface)] shadow-[-10px_0_28px_rgba(0,0,0,0.22)] transition-[transform,opacity] duration-200 ease-out sm:w-[min(50vw,760px)] ${
          visible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
        }`}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Task detail"
        onClick={(event) => event.stopPropagation()}
      >
	        <div className="shrink-0 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]/95 px-4 py-3 sm:px-5">
	          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
	            <div className="min-w-0 flex-1">
	              <textarea
	                rows={2}
	                value={form?.name ?? ''}
	                onChange={(event) => updateFormField('name', event.target.value)}
	                onBlur={() => void saveTitle()}
	                onKeyDown={(event) => {
	                  if (event.key === 'Enter' && !event.shiftKey) {
	                    event.preventDefault();
	                    (event.target as HTMLTextAreaElement).blur();
	                  }
	                }}
	                placeholder="Task name"
		                className="line-clamp-2 h-[2.75rem] w-full resize-none border-0 bg-transparent px-0 py-0 text-lg font-semibold leading-[1.22] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
	                disabled={!form}
	              />
	              <div className="mt-1 grid w-full grid-cols-[auto_auto_auto_minmax(9rem,1fr)] gap-1.5 text-[11px] text-[var(--text-muted)]">
	                <span className="whitespace-nowrap rounded-full border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-0.5 text-[var(--text-secondary)]">
	                  {task ? `#${task.id}` : `#${taskId}`}
	                </span>
	                <span className="whitespace-nowrap rounded-full border border-slate-500/25 bg-slate-500/10 px-2 py-0.5 text-slate-300">
	                  {form ? COLUMN_LABELS[form.column] : 'Loading'}
	                </span>
	                <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 ${
	                  form?.blocked
	                    ? 'border-[var(--error)]/35 bg-[var(--surface-error)] text-[var(--error)]'
	                    : 'border-[var(--accent)]/25 bg-[var(--surface-accent)] text-[var(--accent)]'
	                }`}>
	                  {form?.blocked ? 'Blocked' : 'Clear'}
	                </span>
	                <span className="min-w-max whitespace-nowrap rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
	                  Created by {task?.createdBy ?? 'Unknown'}
	                </span>
	                <span className="col-span-2 min-w-max whitespace-nowrap rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-amber-200">
	                  Created {task ? formatDateTime(task.createdAt) : '-'}
	                </span>
	                <span className="col-span-2 min-w-max whitespace-nowrap rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-sky-200">
	                  Updated {task ? formatDateTime(task.updatedAt) : '-'}
	                </span>
	                {busyAction || saveMessage ? (
	                  <span className="text-[var(--accent)]">{busyAction ? `${busyAction}...` : saveMessage}</span>
	                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
              <button
                type="button"
                className="mc-shell-btn mc-shell-btn-active inline-flex h-9 w-9 items-center justify-center px-0 text-base font-semibold text-[var(--text-primary)]"
                onClick={() => void handleFollowUp()}
                disabled={!task || busyAction !== null}
                aria-label="Create follow-up task"
                title="Follow-up"
              >
                ↳
              </button>
              <button type="button" className="mc-shell-btn px-3 py-2 text-xs font-medium" onClick={() => void handleContinueWork()} disabled={!task || busyAction !== null}>
                Continue
              </button>
              <button
                ref={closeButtonRef}
                type="button"
                className="mc-shell-btn inline-flex h-10 min-w-[3rem] items-center justify-center px-3 py-0 text-base text-[var(--text-primary)] sm:h-9 sm:min-w-[2.75rem] sm:px-2"
                onClick={handleClose}
                aria-label="Close task detail"
                title="Close"
              >
                ×
              </button>
            </div>
          </div>

	          <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)_72px_minmax(0,0.9fr)_minmax(0,0.9fr)]">
	            <label className="min-w-0">
	              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
	                Assignee
	              </span>
	              <select
	                value={form?.assignee ?? 'Unassigned'}
	                onChange={(event) => {
                  const value = event.target.value;
                  updateFormField('assignee', value);
                  void patchTask({ assignee: value }, { successMessage: 'Assignee saved.' });
                }}
	                className="mc-shell-input h-8 w-full px-2 py-1 text-xs"
	                disabled={!form || busyAction !== null}
	              >
                {assigneeOptions.map((assignee) => (
                  <option key={assignee} value={assignee}>
                    {assignee}
                  </option>
                ))}
	              </select>
	            </label>

	            <label className="min-w-0">
	              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
	                Due Date
	              </span>
	              <input
	                type="date"
                value={form?.dueDate ?? ''}
                onChange={(event) => {
                  const value = event.target.value;
                  updateFormField('dueDate', value);
                  void patchTask({ due_date: value }, { successMessage: 'Due date saved.' });
                }}
	                className="mc-shell-input h-8 w-full px-2 py-1 text-xs"
	                disabled={!form || busyAction !== null}
	              />
	            </label>

	            <label className="min-w-0">
	              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
	                Priority
	              </span>
	              <select
                value={form?.priority ?? 'P2'}
                onChange={(event) => {
                  const value = normalizePriority(event.target.value);
                  updateFormField('priority', value);
                  void patchTask({ priority: value }, { successMessage: 'Priority saved.' });
                }}
	                className="mc-shell-input h-8 w-full px-2 py-1 text-xs"
	                disabled={!form || busyAction !== null}
	              >
                {PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
	              </select>
	            </label>

	            <label className="min-w-0">
	              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
	                Column
	              </span>
	              <select
                value={form?.column ?? 'backlog'}
                onChange={(event) => {
                  const value = normalizeColumn(event.target.value);
                  updateFormField('column', value);
                  void patchTask({ column: value }, { successMessage: 'Column saved.' });
                }}
	                className="mc-shell-input h-8 w-full px-2 py-1 text-xs"
	                disabled={!form || busyAction !== null}
	              >
                {TASK_COLUMNS.map((column) => (
                  <option key={column} value={column}>
                    {COLUMN_LABELS[column]}
                  </option>
                ))}
	              </select>
	            </label>

	            <label className="min-w-0">
	              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
	                Model
	              </span>
	              <select
                value={form?.model ?? ''}
                onChange={(event) => void saveModel(event.target.value)}
	                className="mc-shell-input h-8 w-full px-2 py-1 text-xs"
	                disabled={!form || busyAction !== null}
	              >
                <option value="">Default</option>
                {modelOptions
                  .filter((option) => option)
                  .map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
	              </select>
	            </label>
	          </div>

	          <div className="mt-2">
	            <button
	              type="button"
	              className="text-[11px] font-medium text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
	              onClick={() => setAdvancedFieldsOpen((current) => !current)}
	              aria-expanded={advancedFieldsOpen}
	            >
	              {advancedFieldsOpen ? 'Hide' : 'Show'} estimate, time, blocker
	            </button>
	          </div>

	          {advancedFieldsOpen ? (
	          <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
	            <label className="min-w-0">
	              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
	                Estimate
	              </span>
	              <input
                type="number"
                step="0.25"
                placeholder="hrs"
                value={form?.estimateHours ?? ''}
                onChange={(event) => updateFormField('estimateHours', event.target.value)}
                onBlur={() => void saveEstimateHours()}
	                className="mc-shell-input h-8 w-full px-2 py-1 text-xs"
	                disabled={!form}
	              />
	            </label>

	            <label className="min-w-0">
	              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
	                Time Spent
	              </span>
	              <input
                type="number"
                step="0.25"
                placeholder="hrs"
                value={form?.timeSpent ?? ''}
                onChange={(event) => updateFormField('timeSpent', event.target.value)}
                onBlur={() => void saveTimeSpent()}
	                className="mc-shell-input h-8 w-full px-2 py-1 text-xs"
	                disabled={!form}
	              />
	            </label>

	            <div className="min-w-0">
	              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
	                Blocked?
	              </div>
	              <div className="flex h-8 flex-nowrap items-center gap-2 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2">
	                <label className="inline-flex shrink-0 items-center gap-1.5 text-xs text-[var(--text-secondary)]">
	                  <input
                    type="checkbox"
                    checked={form?.blocked ?? false}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      updateFormField('blocked', checked);
                      if (!checked) {
                        updateFormField('blockerReason', '');
                      }
                      void patchTask(
                        {
                          blocked: checked,
                          blocker_reason: checked ? form?.blockerReason ?? '' : '',
                        },
                        { successMessage: checked ? 'Task marked blocked.' : 'Task unblocked.' }
                      );
                    }}
                    disabled={!form || busyAction !== null}
                  />
                  <span>Yes</span>
                </label>
	                {form?.blocked ? (
	                  <input
                    type="text"
                    value={form.blockerReason}
                    onChange={(event) => updateFormField('blockerReason', event.target.value)}
                    onBlur={() => void saveBlockerReason()}
                    placeholder="Reason..."
	                    className="mc-shell-input h-7 min-w-0 flex-1 px-2 py-1 text-xs"
	                  />
	                ) : (
	                  <span className="truncate text-xs text-[var(--text-muted)]">No active blocker</span>
	                )}
	              </div>
	            </div>
	          </div>
	          ) : null}
	        </div>

	        <div className="relative min-h-0 flex-1 overflow-hidden">
	          <aside
	            data-testid="task-detail-rail"
	            className="absolute bottom-0 right-0 top-0 z-10 block w-[4.5rem] border-l border-[var(--border-primary)] bg-[var(--bg-primary)]/70 backdrop-blur"
	            aria-label="Task detail sections"
	          >
            {[
              { icon: '⌁', label: 'Activity', tab: 'activity' as const, count: task?.activity.filter((entry) => !isTechnicalActivity(entry)).length ?? 0 },
              { icon: '▣', label: 'Logs', tab: 'logs' as const, count: task?.activity.filter(isTechnicalActivity).length ?? 0 },
              { icon: '◌', label: 'Comments', tab: 'comments' as const, count: comments.length },
              { icon: '☷', label: 'Subtasks', tab: 'subtasks' as const, count: subtasks.length },
              { icon: '🔗', label: 'Links', tab: 'links' as const, count: outputLinks.length },
            ].map(({ icon, label, tab, count }) => (
              <button
                key={label}
                type="button"
	                onClick={() => {
	                  setDetailTab(tab);
	                  setActivityView(tab === 'logs' ? 'technical' : 'human');
	                  window.requestAnimationFrame(() => {
	                    detailSectionRef.current?.scrollIntoView({ block: 'start' });
	                  });
	                }}
	                className={`flex min-h-[64px] w-full flex-col items-center justify-center gap-0.5 border-b border-[var(--border-primary)] px-1 text-center text-[11px] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] ${
	                  detailTab === tab ? 'bg-[var(--surface-accent)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
	                }`}
                aria-pressed={detailTab === tab}
              >
	                <span className="text-base text-[var(--accent)]" aria-hidden="true">{icon}</span>
                <span>{label}</span>
                {count > 0 ? (
                  <span className="rounded-full bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px]">{count}</span>
                ) : null}
	              </button>
	            ))}
	          </aside>
	          <div className="h-full overflow-y-auto overscroll-contain px-4 py-3 pr-[5.25rem] sm:px-5 sm:pr-[5.25rem]">
	          {loading ? (
	            <div className="flex flex-col gap-3">
              <div className="h-28 rounded-xl bg-[var(--bg-tertiary)]" />
              <div className="h-40 rounded-xl bg-[var(--bg-tertiary)]" />
              <div className="h-56 rounded-xl bg-[var(--bg-tertiary)]" />
            </div>
	          ) : task && form ? (
	            <div className="flex flex-col gap-3">
              {error ? (
                <div className="rounded-xl border border-[var(--error)]/40 bg-[var(--surface-error)] px-4 py-3 text-sm text-[var(--error)]">
                  {error}
                </div>
              ) : null}

	              <section style={{ order: 1 }} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-3">
	                <div className="mb-1.5 flex items-center justify-between gap-3">
	                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
	                    Description
	                  </div>
	                  <span className="text-xs text-[var(--text-muted)]">Markdown supported</span>
	                </div>
	                <textarea
                  value={form.description}
                  onChange={(event) => updateFormField('description', event.target.value)}
                  onBlur={() => void saveDescription()}
	                  className="mc-shell-input min-h-[104px] w-full resize-y px-3 py-2 text-sm leading-5"
	                  placeholder="Add task details, context, or markdown notes."
	                />
	              </section>

	              <section
	                style={{ order: 2 }}
	                className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-3"
	                data-testid="task-accountability-panel"
	              >
	                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
	                  <div>
	                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
	                      Accountability
	                    </div>
	                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">
	                      Work-object principals for ownership, execution, review, and approval.
	                    </p>
	                  </div>
	                  {accountabilityRows.some((row) => row.value.degraded) ? (
	                    <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-200">
	                      Unknown or legacy fields present
	                    </span>
	                  ) : (
	                    <span className="rounded-full border border-[var(--accent)]/25 bg-[var(--surface-accent)] px-2 py-0.5 text-[11px] text-[var(--accent)]">
	                      Complete
	                    </span>
	                  )}
	                </div>
	                <div className="grid gap-2 text-xs text-[var(--text-secondary)] sm:grid-cols-2">
	                  <div className={accountabilityCardClass(formatAccountabilityField(task.createdByPrincipalId ?? task.createdBy).degraded)}>
	                    <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Created by</div>
	                    <div>{formatAccountabilityField(task.createdByPrincipalId ?? task.createdBy).label}</div>
	                    <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">record creator</div>
	                  </div>
	                  {accountabilityRows.map((row) => (
	                    <div key={row.label} className={accountabilityCardClass(row.value.degraded)}>
	                      <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">{row.label}</div>
	                      <div>{row.value.label}</div>
	                      <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">{row.meta}</div>
	                    </div>
	                  ))}
	                </div>
	              </section>

	              <section
	                style={{ order: 2 }}
	                className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-3"
	                data-testid="task-routing-state-panel"
	              >
	                <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
	                  <div>
	                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
	                      Task Master Routing
	                    </div>
	                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">
	                      Task Master helps recover policy-drivable work; it is not the universal executor for every task.
	                    </p>
	                  </div>
	                  {routingState ? (
	                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${routingToneClass(routingState.tone)}`}>
	                      {routingState.label}
	                    </span>
	                  ) : null}
	                </div>
	                {routingState ? (
	                  <div className="grid gap-2 text-xs text-[var(--text-secondary)] sm:grid-cols-2">
	                    <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5 sm:col-span-2">
	                      <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Policy reason</div>
	                      <div>{routingState.reason}</div>
	                    </div>
	                    <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5">
	                      <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Assignment state</div>
	                      <div>{task.assignmentState ?? 'Unknown'}</div>
	                      <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">Assignee: {task.assignee || 'Unassigned'}</div>
	                    </div>
	                    <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5">
	                      <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Executor</div>
	                      <div>{task.executorPrincipalId ?? (task.taskmasterDrivable ? 'Task Master drivable' : 'Individual executor expected')}</div>
	                      <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
	                        Owner: {task.ownerPrincipalId ?? 'Unknown'}{task.ownerPrincipalType ? ` (${task.ownerPrincipalType})` : ''}
	                      </div>
	                    </div>
	                    {routingState.reasonChain.length > 0 ? (
	                      <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5 sm:col-span-2">
	                        <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Routing reason chain</div>
	                        <ol className="mt-1 list-decimal space-y-1 pl-4">
	                          {routingState.reasonChain.map((entry, index) => (
	                            <li key={`${index}-${entry}`}>{entry}</li>
	                          ))}
	                        </ol>
	                      </div>
	                    ) : null}
	                  </div>
	                ) : null}
	              </section>

                  {worktypeOverlay ? (
                    <section
                      style={{ order: 2 }}
                      className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-3"
                      data-testid="task-worktype-overlay-panel"
                    >
                      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                            Worktype Overlay
                          </div>
                          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                            Domain fields shown with registry labels, not engineering schema terms.
                          </p>
                        </div>
                        <span className="rounded-full border border-[var(--accent)]/25 bg-[var(--surface-accent)] px-2 py-0.5 text-xs text-[var(--accent)]">
                          {worktypeOverlay.label}
                        </span>
                      </div>
                      <div className="mb-2 flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)]">
                        <span>{worktypeOverlay.schema}</span>
                        <span>sensitivity: {worktypeOverlay.sensitivity}</span>
                      </div>
                      {worktypeOverlay.rows.length > 0 ? (
                        <div className="grid gap-2 text-xs text-[var(--text-secondary)] sm:grid-cols-2">
                          {worktypeOverlay.rows.map((row) => (
                            <div key={row.label} className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">{row.label}</span>
                                {row.indexable ? <span className="text-[10px] text-sky-300">filterable</span> : null}
                              </div>
                              <div className="mt-0.5 capitalize">{row.value}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-[var(--text-muted)]">No overlay values recorded yet.</p>
                      )}
                    </section>
                  ) : null}

	              <section style={{ order: 2 }} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-3">
	                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
	                  <div>
	                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
	                      Review Policy
	                    </div>
	                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">
	                      Reviewer assignment, reason chain, and review decision.
	                    </p>
	                  </div>
	                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${reviewGateToneClass(task.reviewState, task.reviewRequired)}`}>
	                    {task.reviewRequired ? formatReviewGateToken(task.reviewState, 'Pending') : 'Not required'}
	                  </span>
	                </div>
	                <div className="grid gap-2 text-xs text-[var(--text-secondary)] sm:grid-cols-2">
	                  <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5">
	                    <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Eligible reviewer</div>
	                    <div>{reviewField(task.reviewerPrincipalId ?? task.reviewer ?? task.metadataRecord.reviewer ?? task.metadataRecord.review_owner)}</div>
	                    <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
	                      {reviewActorEligible ? 'Controls available to you' : 'Controls hidden unless profile matches reviewer'}
	                    </div>
	                  </div>
	                  <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5">
	                    <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Decision</div>
	                    <div>{formatReviewGateToken(task.reviewState, 'Pending')}</div>
	                    <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">{reviewField(task.metadataRecord.review_decision_reason ?? task.metadataRecord.review_note, 'No note recorded')}</div>
	                  </div>
	                  <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5">
	                    <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Type / Risk</div>
	                    <div>{reviewField(task.metadataRecord.review_type ?? task.metadataRecord.review_class)} / {reviewField(task.metadataRecord.risk_level)}</div>
	                  </div>
	                  <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5">
	                    <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Packet</div>
	                    <div>{hasReviewMetadata(task.metadataRecord) ? reviewPacketSummary(task.metadataRecord) : 'No legacy packet metadata'}</div>
	                  </div>
	                  {task.policyReasonChain.length > 0 ? (
	                    <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5 sm:col-span-2">
	                      <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Reason Chain</div>
	                      <ol className="mt-1 list-decimal space-y-1 pl-4">
	                        {task.policyReasonChain.slice(0, 5).map((entry, index) => (
	                          <li key={`${index}-${readFirstString(entry.decision, entry.reason) ?? 'reason'}`}>{formatReasonChainEntry(entry, index)}</li>
	                        ))}
	                      </ol>
	                    </div>
	                  ) : null}
	                  {task.overrideAudit.length > 0 ? (
	                    <div className="rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1.5 text-amber-100 sm:col-span-2">
	                      <div className="text-[10px] uppercase tracking-[0.1em] text-amber-200/80">Override Audit</div>
	                      <ol className="mt-1 list-decimal space-y-1 pl-4">
	                        {task.overrideAudit.slice(0, 4).map((entry, index) => (
	                          <li key={`${index}-${readFirstString(entry.actor, entry.reason) ?? 'override'}`}>{formatReasonChainEntry(entry, index)}</li>
	                        ))}
	                      </ol>
	                    </div>
	                  ) : null}
	                </div>
                  {task.reviewRequired ? (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--border-primary)] pt-3">
                      {reviewActorEligible ? (
                        <>
                          <button
                            type="button"
                            className="mc-shell-btn px-3 py-1.5 text-xs font-medium"
                            onClick={() => void saveReviewDecision('accepted')}
                            disabled={busyAction !== null || task.reviewState === 'accepted'}
                          >
                            Accept review
                          </button>
                          <button
                            type="button"
                            className="mc-shell-btn px-3 py-1.5 text-xs font-medium"
                            onClick={() => void saveReviewDecision('accepted', { complete: true })}
                            disabled={busyAction !== null || (task.humanGateRequired && task.humanGateState !== 'approved')}
                          >
                            Accept + Done
                          </button>
                          <button
                            type="button"
                            className="mc-shell-btn px-3 py-1.5 text-xs font-medium"
                            onClick={() => void saveReviewDecision('needs_fix')}
                            disabled={busyAction !== null || task.reviewState === 'request_fix'}
                          >
                            Request fix
                          </button>
                        </>
                      ) : (
                        <div className="text-[11px] text-[var(--text-muted)]">
                          Review controls are hidden because your profile does not match the eligible reviewer.
                        </div>
                      )}
                      {task.reviewState !== 'accepted' ? (
                        <div className="basis-full text-[11px] text-[var(--text-muted)]">
                          Done is locked until the required review is accepted.
                        </div>
                      ) : null}
                    </div>
                  ) : null}
	              </section>

	              <section style={{ order: 3 }} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-3">
	                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
	                  <div>
	                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
	                      Human Gate
	                    </div>
	                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">
	                      Separate approval state for high-risk or externally visible work.
	                    </p>
	                  </div>
	                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${reviewGateToneClass(task.humanGateState, task.humanGateRequired)}`}>
	                    {task.humanGateRequired ? formatReviewGateToken(task.humanGateState, 'Pending') : 'Not required'}
	                  </span>
	                </div>
	                <div className="grid gap-2 text-xs text-[var(--text-secondary)] sm:grid-cols-2">
	                  <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5">
	                    <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Human approver</div>
	                    <div>{reviewField(task.approverPrincipalId ?? task.approver)}</div>
	                    <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
	                      {humanGateActorEligible ? 'Controls available to you' : 'Controls hidden unless profile matches approver'}
	                    </div>
	                  </div>
	                  <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5">
	                    <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Decision</div>
	                    <div>{formatReviewGateToken(task.humanGateState)}</div>
	                    <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">{reviewField(task.metadataRecord.human_gate_reason, 'No note recorded')}</div>
	                  </div>
	                </div>
                  {task.humanGateRequired ? (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--border-primary)] pt-3">
                      {task.humanGateState === 'pending' && humanGateActorEligible ? (
                        <>
                          <button
                            type="button"
                            className="mc-shell-btn px-3 py-1.5 text-xs font-medium"
                            onClick={() => void saveHumanGateAction('approve')}
                            disabled={busyAction !== null}
                          >
                            Approve human gate
                          </button>
                          <button
                            type="button"
                            className="mc-shell-btn px-3 py-1.5 text-xs font-medium"
                            onClick={() => void saveHumanGateAction('reject')}
                            disabled={busyAction !== null}
                          >
                            Reject human gate
                          </button>
                        </>
                      ) : task.humanGateState !== 'approved' && task.humanGateState !== 'rejected' && humanGateRequestEligible ? (
                        <button
                          type="button"
                          className="mc-shell-btn px-3 py-1.5 text-xs font-medium"
                          onClick={() => void saveHumanGateAction('request')}
                          disabled={busyAction !== null}
                        >
                          Request human gate
                        </button>
                      ) : (
                        <div className="text-[11px] text-[var(--text-muted)]">
                          Human-gate controls are hidden until the assigned human approver is viewing this task.
                        </div>
                      )}
                      {task.humanGateState !== 'approved' ? (
                        <div className="basis-full text-[11px] text-[var(--text-muted)]">
                          Done is locked until the required human gate is approved.
                        </div>
                      ) : null}
                    </div>
                  ) : null}
	              </section>

                  <Suspense fallback={null}>
                    <TaskChatContextPanel
                      taskId={task.id}
                      apiBase={apiBase}
                      proofAvailable={Boolean(receiptProof)}
                      documentObjectCount={documentObjectViews.length}
                      outputLinkCount={outputLinks.length}
                    />
                  </Suspense>

                  {receiptProof ? (
                    <section
                      style={{ order: 3 }}
                      className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-3"
                      data-testid="task-receipt-proof-panel"
                    >
                      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                            Receipt and Proof
                          </div>
                          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                            Canonical receipt metadata, evidence state, and artifact identity.
                          </p>
                        </div>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${receiptToneClass(receiptProof.statusTone)}`}>
                          {receiptProof.status}
                        </span>
                      </div>

                      <div className="grid gap-2 text-xs text-[var(--text-secondary)] sm:grid-cols-2">
                        <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5">
                          <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Receipt Link</div>
                          {receiptProof.receiptHref ? (
                            <a
                              href={receiptProof.receiptHref}
                              className="mt-0.5 block break-all text-sky-300 hover:text-sky-200"
                              data-testid="task-receipt-link"
                            >
                              {receiptProof.receiptHref}
                            </a>
                          ) : (
                            <div className="mt-0.5 text-amber-200">No stable receipt link recorded.</div>
                          )}
                          {receiptProof.artifactId ? (
                            <div className="mt-1 break-all text-[10px] text-[var(--text-muted)]">Artifact {receiptProof.artifactId}</div>
                          ) : null}
                        </div>

                        <div
                          className={`rounded-md border px-2 py-1.5 ${
                            receiptProof.artifactMode === 'raw'
                              ? 'border-sky-500/25 bg-sky-500/10'
                              : receiptProof.artifactMode === 'curated'
                                ? 'border-violet-500/25 bg-violet-500/10'
                                : 'border-[var(--border-primary)] bg-[var(--bg-primary)]'
                          }`}
                        >
                          <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Artifact Type</div>
                          <div>{receiptProof.artifactMode === 'raw' ? 'Raw proof artifact' : receiptProof.artifactMode === 'curated' ? 'Curated interpretation' : 'Artifact type unknown'}</div>
                          <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                            {receiptProof.artifactKind} / {receiptProof.mutability}
                          </div>
                        </div>

                        <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5">
                          <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Integrity</div>
                          <div data-testid="task-receipt-integrity-state">{receiptProof.integrityState}</div>
                          <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">Availability: {receiptProof.availabilityState}</div>
                        </div>

                        <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5">
                          <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Provenance</div>
                          <div>{receiptProof.provenance}</div>
                          <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                            {receiptProof.createdAt ? `Created ${formatDateTime(receiptProof.createdAt)}` : 'Creation time unknown'}
                          </div>
                        </div>

                        <div
                          className={`rounded-md border px-2 py-1.5 sm:col-span-2 ${
                            receiptProof.missingEvidence
                              ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
                              : 'border-[var(--border-primary)] bg-[var(--bg-primary)]'
                          }`}
                          data-testid="task-receipt-missing-evidence"
                        >
                          <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Evidence Summary</div>
                          <div>{receiptProof.evidenceSummary}</div>
                          <div className="mt-1 text-[11px]">
                            {receiptProof.missingEvidence
                              ? `Missing evidence: ${receiptProof.missingEvidenceReason ?? 'no evidence links or output artifacts were recorded'}`
                              : 'Missing evidence: no'}
                          </div>
                        </div>

                        <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5">
                          <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Review</div>
                          <div>{receiptProof.reviewDecision}</div>
                          <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">Approval: {receiptProof.approvalDecision}</div>
                        </div>

                        <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5">
                          <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Content Hash</div>
                          <div className="break-all">{receiptProof.contentHash ?? 'Not recorded'}</div>
                        </div>
                      </div>

                      <div className="mt-3 grid gap-2 lg:grid-cols-2">
                        <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2">
                          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
                            Evidence References
                          </div>
                          {receiptProof.evidenceLinks.length > 0 ? (
                            <div className="space-y-1.5">
                              {receiptProof.evidenceLinks.map((link) => (
                                <a
                                  key={`${link.label}-${link.href ?? 'no-href'}`}
                                  href={link.href ?? undefined}
                                  target={link.external ? '_blank' : undefined}
                                  rel={link.external ? 'noreferrer' : undefined}
                                  className="block min-w-0 rounded border border-[var(--border-primary)] px-2 py-1.5 text-xs text-sky-300 hover:text-sky-200"
                                >
                                  <span className="block truncate">{link.label}</span>
                                  {link.meta ? <span className="mt-0.5 block text-[10px] text-[var(--text-muted)]">{link.meta}</span> : null}
                                </a>
                              ))}
                            </div>
                          ) : (
                            <div className="text-xs text-[var(--text-muted)]">No structured evidence references recorded.</div>
                          )}
                        </div>

                        <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2">
                          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
                            Output Links
                          </div>
                          {receiptProof.outputLinks.length > 0 ? (
                            <div className="space-y-1.5">
                              {receiptProof.outputLinks.map((link) => (
                                <a
                                  key={link.href ?? link.label}
                                  href={link.href ?? undefined}
                                  target={link.external ? '_blank' : undefined}
                                  rel={link.external ? 'noreferrer' : undefined}
                                  className="block min-w-0 rounded border border-[var(--border-primary)] px-2 py-1.5 text-xs text-sky-300 hover:text-sky-200"
                                >
                                  <span className="block truncate">{link.label}</span>
                                  {link.meta ? <span className="mt-0.5 block text-[10px] text-[var(--text-muted)]">{link.meta}</span> : null}
                                </a>
                              ))}
                            </div>
                          ) : (
                            <div className="text-xs text-[var(--text-muted)]">No output artifact links recorded.</div>
                          )}
                        </div>
                      </div>

                      {receiptProof.degradedMessages.length > 0 ? (
                        <ul className="mt-3 list-disc space-y-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-2 pl-6 text-xs text-amber-100">
                          {receiptProof.degradedMessages.map((message) => (
                            <li key={message}>{message}</li>
                          ))}
                        </ul>
                      ) : null}
                    </section>
                  ) : null}

                  {documentObjectViews.length > 0 ? (
                    <section
                      style={{ order: 4 }}
                      className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-3"
                      data-testid="task-document-object-panel"
                    >
                      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                            Docs, Files, and Artifacts
                          </div>
                          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                            External refs, Entity-native markdown, raw proof, and curated interpretation are labeled separately.
                          </p>
                        </div>
                        <span className="rounded-full border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]">
                          {documentObjectViews.length} object{documentObjectViews.length === 1 ? '' : 's'}
                        </span>
                      </div>

                      <div className="grid gap-2 lg:grid-cols-2">
                        {documentObjectViews.map((object) => (
                          <article
                            key={`${object.objectType}-${object.id}-${object.objectRefs.map((ref) => ref.linkRole ?? 'link').join('-')}`}
                            className={`rounded-md border px-3 py-2 text-xs ${
                              object.displayKind === 'external'
                                ? 'border-amber-500/25 bg-amber-500/10'
                                : object.displayKind === 'native'
                                  ? 'border-emerald-500/25 bg-emerald-500/10'
                                  : object.displayKind === 'raw_proof'
                                    ? 'border-sky-500/25 bg-sky-500/10'
                                    : object.displayKind === 'curated'
                                      ? 'border-violet-500/25 bg-violet-500/10'
                                      : 'border-[var(--border-primary)] bg-[var(--bg-primary)]'
                            }`}
                            data-testid="task-document-object-card"
                            data-object-kind={object.displayKind}
                          >
                            <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
                                  {object.label}
                                </div>
                                {object.href ? (
                                  <a
                                    href={object.href}
                                    target={object.externalHref ? '_blank' : undefined}
                                    rel={object.externalHref ? 'noreferrer' : undefined}
                                    className="mt-0.5 block truncate text-sm font-medium text-sky-300 hover:text-sky-200"
                                  >
                                    {object.title}
                                  </a>
                                ) : (
                                  <div className="mt-0.5 truncate text-sm font-medium text-[var(--text-primary)]">
                                    {object.title}
                                  </div>
                                )}
                              </div>
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] ${documentObjectToneClass(object.statusTone)}`}>
                                {object.status}
                              </span>
                            </div>

                            <div className="grid gap-1.5 text-[11px] text-[var(--text-secondary)] sm:grid-cols-2">
                              <div>
                                <span className="text-[var(--text-muted)]">Source: </span>
                                {object.sourceLabel}
                              </div>
                              <div>
                                <span className="text-[var(--text-muted)]">Canonicality: </span>
                                {object.canonicality}
                              </div>
                              <div>
                                <span className="text-[var(--text-muted)]">Mutability: </span>
                                {object.mutability}
                              </div>
                              <div className="break-all">
                                <span className="text-[var(--text-muted)]">ID: </span>
                                {object.restricted ? 'Hidden' : object.id}
                              </div>
                            </div>

                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {object.objectRefs.map((ref) => (
                                <span
                                  key={`${ref.objectType}-${ref.objectId}-${ref.linkRole ?? 'link'}`}
                                  className="rounded-full border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]"
                                  data-testid="task-document-object-link-role"
                                >
                                  {ref.linkRole ?? 'linked'} to {ref.objectType}:{ref.objectId}
                                </span>
                              ))}
                            </div>

                            {object.externalPreview ? (
                              <div
                                className={`mt-3 rounded-md border px-2.5 py-2 ${
                                  object.externalPreview.degraded
                                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
                                    : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100'
                                }`}
                                data-testid="task-external-doc-preview"
                                data-read-only-google-mutation-controls="none"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
                                      External Preview
                                    </div>
                                    <div className="mt-0.5 truncate text-sm font-semibold">
                                      {object.externalPreview.title}
                                    </div>
                                    <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                                      {object.externalPreview.ownershipLabel}
                                    </div>
                                  </div>
                                  {object.externalPreview.canOpen && object.externalPreview.openUrl ? (
                                    <a
                                      href={object.externalPreview.openUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="rounded border border-sky-400/30 bg-sky-500/10 px-2 py-1 text-[11px] font-medium text-sky-200 hover:text-sky-100"
                                      data-testid="task-external-doc-open-link"
                                    >
                                      Open external doc
                                    </a>
                                  ) : (
                                    <span className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-[11px] text-[var(--text-muted)]">
                                      No external link available
                                    </span>
                                  )}
                                </div>

                                <div className="mt-2 grid gap-1.5 text-[11px] text-[var(--text-secondary)] sm:grid-cols-2">
                                  <div>
                                    <span className="text-[var(--text-muted)]">Connector: </span>
                                    {object.externalPreview.connectorLabel}
                                  </div>
                                  <div>
                                    <span className="text-[var(--text-muted)]">Auth: </span>
                                    {object.externalPreview.authLabel}
                                  </div>
                                  <div>
                                    <span className="text-[var(--text-muted)]">Readiness: </span>
                                    {object.externalPreview.readinessLabel}
                                  </div>
                                  <div>
                                    <span className="text-[var(--text-muted)]">Scopes: </span>
                                    {object.externalPreview.scopeLabel}
                                  </div>
                                  {object.externalPreview.mimeLabel ? (
                                    <div className="sm:col-span-2">
                                      <span className="text-[var(--text-muted)]">MIME: </span>
                                      {object.externalPreview.mimeLabel}
                                    </div>
                                  ) : null}
                                  {object.externalPreview.externalPermissionSummary ? (
                                    <div className="sm:col-span-2">
                                      <span className="text-[var(--text-muted)]">External permission: </span>
                                      {object.externalPreview.externalPermissionSummary}
                                    </div>
                                  ) : null}
                                </div>

                                <div
                                  className="mt-2 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5 text-[11px]"
                                  data-testid="task-external-doc-preview-snippet"
                                >
                                  {object.externalPreview.previewAvailable && object.externalPreview.previewText
                                    ? object.externalPreview.previewText
                                    : 'Preview unavailable until Google auth and preview scope are healthy.'}
                                </div>

                                <div
                                  className="mt-2 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5 text-[11px] text-[var(--text-secondary)]"
                                  data-testid="task-external-doc-readonly-posture"
                                >
                                  {object.externalPreview.readOnlyMessage}
                                </div>

                                {object.externalPreview.degradedMessages.length > 0 ? (
                                  <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px]">
                                    {object.externalPreview.degradedMessages.map((message) => (
                                      <li key={message}>{message}</li>
                                    ))}
                                  </ul>
                                ) : null}
                              </div>
                            ) : null}

                            {object.restricted ? (
                              <div
                                className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100"
                                data-testid="task-document-object-placeholder"
                              >
                                Restricted by Entity permissions. Snippets and previews are hidden.
                              </div>
                            ) : null}

                            {object.degradedMessages.length > 0 ? (
                              <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-amber-100">
                                {object.degradedMessages.map((message) => (
                                  <li key={message}>{message}</li>
                                ))}
                              </ul>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    </section>
                  ) : null}

	              <section style={{ order: 5 }} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2.5">
	                <div className={`${outputExpanded ? 'mb-2' : ''} flex flex-wrap items-center justify-between gap-2`}>
	                  <div className="flex min-w-0 items-center gap-2">
	                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
	                      Output
	                    </div>
	                    {outputIsEmpty ? (
	                      <span className="rounded-full border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]">
	                        Empty
	                      </span>
	                    ) : null}
	                  </div>
	                  <div className="flex shrink-0 items-center gap-2">
	                    <span className="text-xs text-[var(--text-muted)]">
	                      {outputLinks.length} link{outputLinks.length === 1 ? '' : 's'}
	                    </span>
	                    {outputIsEmpty && !outputExpanded ? (
	                      <>
	                        <button
	                          type="button"
	                          className="mc-shell-btn px-2.5 py-1.5 text-xs"
	                          onClick={() => setOutputSectionOpen(true)}
	                        >
	                          Add output
	                        </button>
	                        <button
	                          type="button"
	                          className="mc-shell-btn px-2.5 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
	                          onClick={() => void autoGenerateSubtasks()}
	                          disabled={busyAction !== null}
	                        >
	                          Auto-subtasks
	                        </button>
	                      </>
	                    ) : null}
	                  </div>
	                </div>
	                {outputExpanded ? (
	                  <>
	                    <div className="mb-2 min-h-[56px] rounded-md bg-[var(--bg-primary)] px-3 py-2 text-[13px] text-[var(--text-secondary)]">
	                      {task.output.trim() ? (
	                        <pre className="whitespace-pre-wrap break-words font-sans">{renderLinkedText(task.output, onDocsLinkNavigate)}</pre>
	                      ) : (
	                        <div className="flex min-h-[36px] items-center text-sm text-[var(--text-muted)]">
	                          No output yet.
	                        </div>
	                      )}
	                    </div>
	                    <div className="mb-2 space-y-1.5">
	                      {outputLinks.length > 0 ? (
	                        outputLinks.map((link) => (
	                          <div
	                            key={link.href}
	                            className="flex items-center justify-between gap-3 rounded-md bg-[var(--bg-primary)] px-3 py-2"
	                          >
	                            <div className="min-w-0">
	                              <div className="truncate text-sm font-medium text-[var(--text-primary)]">
	                                {link.external ? 'External link' : 'Entity docs link'}
	                              </div>
	                              <div className="mt-1 truncate text-xs text-[var(--text-muted)]">{link.label}</div>
	                            </div>
	                            <a
	                              href={link.href}
	                              target={link.external ? '_blank' : undefined}
	                              rel={link.external ? 'noreferrer' : undefined}
	                              className="mc-shell-btn shrink-0 px-3 py-1.5 text-xs"
	                            >
	                              Open
	                            </a>
	                          </div>
	                        ))
	                      ) : (
	                        <div className="rounded-md bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-muted)]">
	                          No docs links attached.
	                        </div>
	                      )}
	                    </div>
	                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
	                      <textarea
	                        value={outputInput}
	                        onChange={(event) => setOutputInput(event.target.value)}
	                        rows={2}
	                        placeholder="Paste output, logs, or links..."
	                        className="mc-shell-input min-h-[64px] flex-1 px-3 py-2 text-sm"
	                      />
	                      <div className="flex shrink-0 flex-row gap-2 sm:flex-col">
	                        <button
	                          type="button"
	                          className="mc-shell-btn px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40"
	                          onClick={() => void saveOutput()}
	                          disabled={busyAction === 'save' || outputInput === task.output}
	                        >
	                          Save
	                        </button>
	                        <button
	                          type="button"
	                          className="mc-shell-btn px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40"
	                          onClick={() => void autoGenerateSubtasks()}
	                          disabled={busyAction !== null}
	                        >
	                          Auto-subtasks
	                        </button>
	                      </div>
	                    </div>
	                  </>
	                ) : null}
	              </section>

	              <section style={{ order: 4 }} className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-4">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                    Projects
                  </div>
                  <div className="mb-3 flex min-h-[28px] flex-wrap gap-2">
                    {selectedProjects.length > 0 ? (
                      selectedProjects.map((project) => (
                        <span
                          key={project.id}
                          className="inline-flex items-center gap-2 rounded-full border border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-3 py-1 text-xs text-[var(--text-secondary)]"
                        >
                          {project.color ? (
                            <span
                              className="inline-block h-2 w-2 rounded-full"
                              style={{ backgroundColor: project.color }}
                              aria-hidden="true"
                            />
                          ) : null}
                          <span>{project.name}</span>
                          <button
                            type="button"
                            className="text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
                            onClick={() => void removeProject(project.id)}
                            aria-label={`Remove ${project.name}`}
                          >
                            ×
                          </button>
                        </span>
                      ))
                    ) : (
                      <div className="text-sm text-[var(--text-muted)]">No projects linked.</div>
                    )}
                  </div>

                  <div ref={projectDropdownRef} className="relative">
                    <input
                      type="text"
                      value={projectSearch}
                      onChange={(event) => {
                        setProjectSearch(event.target.value);
                        setProjectDropdownOpen(true);
                      }}
                      onFocus={() => setProjectDropdownOpen(true)}
                      placeholder="Search projects..."
                      className="mc-shell-input w-full px-3 py-2 text-sm"
                    />
                    {projectDropdownOpen ? (
                      <div className="absolute z-10 mt-2 max-h-60 w-full overflow-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-1 shadow-[0_12px_32px_rgba(0,0,0,0.35)]">
                        {filteredProjectOptions.length > 0 ? (
                          filteredProjectOptions.map((project) => (
                            <button
                              key={project.id}
                              type="button"
                              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                              onMouseDown={(event) => {
                                event.preventDefault();
                                void addProject(project.id);
                              }}
                            >
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: project.color ?? '#6b7280' }}
                                aria-hidden="true"
                              />
                              <span>{project.name}</span>
                            </button>
                          ))
                        ) : (
                          <div className="px-3 py-2 text-sm text-[var(--text-muted)]">No matching projects.</div>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-4">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                    Dependencies
                  </div>
                  <div className="mb-3 flex min-h-[28px] flex-wrap gap-2">
                    {task.dependencies.length > 0 ? (
                      task.dependencies.map((dependency) => (
                        <span
                          key={dependency.id}
                          className="inline-flex items-center rounded-full border border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-3 py-1 text-xs text-[var(--text-secondary)]"
                        >
                          {findDependencyName(dependency, boardTasks)} ({`#${dependency.id}`})
                        </span>
                      ))
                    ) : (
                      <div className="text-sm text-[var(--text-muted)]">No dependencies yet.</div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      type="text"
                      value={dependencyInput}
                      onChange={(event) => setDependencyInput(event.target.value)}
                      placeholder="Task IDs (e.g. 1, 2, 3)"
                      className="mc-shell-input w-full px-3 py-2 text-sm sm:max-w-[220px]"
                    />
                    <button
                      type="button"
                      className="mc-shell-btn px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={() => void saveDependencies()}
                      disabled={busyAction === 'save'}
                    >
                      Save
                    </button>
                  </div>
                </div>
              </section>

	              <section style={{ order: 5 }} className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-4">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                  Attachments
                </div>
                <div className="mb-3 space-y-2">
                  {task.attachments.length > 0 ? (
                    task.attachments.map((attachment, index) => (
                      <a
                        key={`${attachment.path}-${index}`}
                        href={attachment.path}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-sky-400 hover:text-sky-300"
                      >
                        <div className="font-medium">{attachment.name}</div>
                        <div className="mt-1 break-all text-xs text-[var(--text-muted)]">{attachment.path}</div>
                      </a>
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-muted)]">
                      No attachments yet.
                    </div>
                  )}
                </div>
                <div className="grid gap-2 md:grid-cols-[minmax(0,140px)_minmax(0,1fr)_auto]">
                  <input
                    type="text"
                    value={attachmentName}
                    onChange={(event) => setAttachmentName(event.target.value)}
                    placeholder="Name"
                    className="mc-shell-input px-3 py-2 text-sm"
                  />
                  <input
                    type="text"
                    value={attachmentPath}
                    onChange={(event) => setAttachmentPath(event.target.value)}
                    placeholder="URL or path"
                    className="mc-shell-input px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    className="mc-shell-btn px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => void addAttachment()}
                    disabled={busyAction === 'save'}
                  >
                    Attach
                  </button>
                </div>
              </section>

	              <div style={{ order: 6 }}>
	                <PluginDetailSlot apiBase={apiBase} module="tasks" entity={task} />
	              </div>

	              <section ref={detailSectionRef} style={{ order: 3 }} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-3">
	                {detailTab === 'activity' || detailTab === 'logs' ? (
	                  <div>
	                    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
	                      <div>
	                        <h4 className="text-sm font-semibold text-[var(--text-primary)]">Activity Log</h4>
	                        <div className="text-xs text-[var(--text-muted)]">
	                          {activityView === 'technical' ? 'Technical activity, raw metadata, and system details.' : 'Human-readable updates and notes.'}
	                        </div>
	                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="mc-shell-btn px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                          onClick={() => void syncSessionLogs()}
                          disabled={busyAction === 'sync'}
                        >
                          🔄 Sync
                        </button>
                        <div className="flex rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-1">
                          <button
                            type="button"
                            className={`rounded-md px-3 py-1 text-xs ${activityView === 'human' ? 'bg-[var(--surface-accent)] text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}
                            onClick={() => setActivityView('human')}
                          >
                            Human
                          </button>
                          <button
                            type="button"
                            className={`rounded-md px-3 py-1 text-xs ${activityView === 'technical' ? 'bg-[var(--surface-accent)] text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}
                            onClick={() => setActivityView('technical')}
                          >
                            Technical
                          </button>
                        </div>
                      </div>
                    </div>

                    {visibleActivity.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-[var(--border-primary)] bg-[var(--bg-primary)] px-4 py-6 text-sm text-[var(--text-muted)]">
                        {activityView === 'technical'
                          ? 'No technical logs yet. Agents can write technical entries via POST /api/tasks/:id/activity with type "technical".'
                          : 'No activity yet.'}
                      </div>
                    ) : (
	                      <div className="space-y-2">
	                        {visibleActivity.map((activity) => {
                          const actorLabel = activity.actorPrincipalId
                            ? `${activity.actorPrincipalId} (${formatActivityToken(activity.actorType)})`
                            : `${formatActivityToken(activity.actorType)} actor`;
                          const schemaLabel = activity.schemaStatus === 'structured'
                            ? 'structured'
                            : activity.schemaStatus === 'legacy_unknown'
                              ? 'weak legacy event'
                              : formatActivityToken(activity.schemaStatus);
                          const provenanceItems = [
                            `event: ${formatActivityToken(activity.activityEventType)}`,
                            `actor: ${actorLabel}`,
                            `schema: ${schemaLabel}`,
                            activity.payloadVersion ? `payload v${activity.payloadVersion}` : null,
                            activity.permissionState !== 'visible' ? `permission: ${formatActivityToken(activity.permissionState)}` : null,
                            activity.reason ? `reason: ${activity.reason}` : null,
                            activity.provenance ? `provenance: ${activity.provenance}` : null,
                            ...activity.objectRefs.slice(0, 3).map((ref) => `object: ${formatObjectRef(ref)}`),
                          ].filter((item): item is string => Boolean(item));

                          return (
	                          <article
	                            key={activity.id}
	                            className="min-w-0 overflow-hidden rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2"
	                          >
	                            <div className="min-w-0 overflow-hidden">
	                              <div className="flex min-w-0 items-baseline justify-between gap-3 text-sm font-medium text-[var(--text-primary)]">
	                                <div className="flex min-w-0 items-baseline gap-1.5">
	                                  <span className="min-w-0 truncate">
	                                    {activity.agentEmoji ? `${activity.agentEmoji} ` : ''}
	                                    {activity.agentName}
	                                  </span>
	                                  <span className="shrink-0 text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
	                                    - {activity.action}
	                                  </span>
	                                </div>
	                                <time
	                                  className="shrink-0 whitespace-nowrap text-[10px] text-[var(--text-muted)]"
	                                  dateTime={activity.createdAt}
	                                >
	                                  {formatDateTime(activity.createdAt)}
	                                </time>
	                              </div>
	                              <div className="mt-0.5 w-full min-w-0 max-w-full overflow-hidden whitespace-pre-wrap break-words text-[13px] leading-[1.35] text-[var(--text-secondary)] [overflow-wrap:anywhere]">{activity.description}</div>
	                            </div>

                              <div className="mt-2 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                                {provenanceItems.map((item) => (
                                  <span
                                    key={item}
                                    className={activity.degraded ? 'rounded-full border border-amber-500/40 px-2 py-0.5 text-amber-300' : ''}
                                  >
                                    {item}
                                  </span>
                                ))}
                              </div>

	                            {activityView === 'technical' ? (
	                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
	                              <span>{activity.type.replace(/_/g, ' ')}</span>
	                              {activity.legacyType ? <span>legacy: {formatActivityToken(activity.legacyType)}</span> : null}
	                              {activity.taskColumn ? <span>{activity.taskColumn}</span> : null}
	                              {activity.filePath ? <span>{activity.filePath}</span> : null}
	                              {activity.warnings.map((warning) => (
                                  <span key={`${activity.id}-${warning.code}`} className="rounded-full border border-amber-500/40 px-2 py-0.5 text-amber-300">
                                    {formatActivityToken(warning.code)}
                                  </span>
                                ))}
	                            </div>
	                            ) : null}

                            {activityView === 'technical' && activity.warnings.length > 0 ? (
                              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-200">
                                {activity.warnings.map((warning) => (
                                  <li key={`${activity.id}-${warning.code}-${warning.message}`}>{warning.message}</li>
                                ))}
                              </ul>
                            ) : null}

                            {activityView === 'technical' && activity.metadataText ? (
                              <pre className="mt-3 overflow-x-auto rounded-lg border border-[var(--border-primary)] bg-[#0f0f0f] px-3 py-3 text-xs text-[#d1d5db]">
                                {activity.metadataText}
                              </pre>
                            ) : null}
                          </article>
                          );
                        })}
                      </div>
                    )}

                    <div className="mt-5">
                      <h4 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Add Note</h4>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <input
                          type="text"
                          value={noteInput}
                          onChange={(event) => setNoteInput(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              void addNote();
                            }
                          }}
                          placeholder="Add a note or update..."
                          className="mc-shell-input min-w-0 flex-1 px-3 py-2 text-sm"
                        />
                        <button
                          type="button"
                          className="mc-shell-btn mc-shell-btn-active px-3 py-2 text-xs font-medium text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                          onClick={() => void addNote()}
                          disabled={busyAction === 'note' || !noteInput.trim()}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  </div>
                ) : detailTab === 'comments' ? (
                  <div>
                    {!commentsAvailable ? (
                      <div className="mb-4 rounded-xl border border-[var(--surface-muted)] bg-[var(--surface-muted)] px-4 py-3 text-sm text-[var(--text-secondary)]">
                        Comments endpoint unavailable. New comments will fall back to activity entries.
                      </div>
                    ) : null}

                    {commentTree.length > 0 ? (
                      <div className="space-y-3">{renderCommentNodes(commentTree)}</div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-[var(--border-primary)] bg-[var(--bg-primary)] px-4 py-6 text-sm text-[var(--text-muted)]">
                        No comments yet.
                      </div>
                    )}

                    <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="relative min-w-0 flex-1">
                        <input
                          type="text"
                          value={commentInput}
                          onChange={(event) => handleCommentInputChange(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape' && mentionQuery !== null) {
                              event.preventDefault();
                              setMentionQuery(null);
                              return;
                            }
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              if (mentionQuery !== null && mentionMatches.length > 0) {
                                applyMention(mentionMatches[0]!);
                                return;
                              }
                              void postComment();
                            }
                          }}
                          placeholder="Add a comment... use @ to mention an agent"
                          className="mc-shell-input w-full px-3 py-2 text-sm"
                        />
                        {mentionQuery !== null && mentionMatches.length > 0 ? (
                          <div className="absolute bottom-full left-0 z-30 mb-1 w-64 overflow-hidden rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] shadow-[0_16px_40px_rgba(0,0,0,0.35)]">
                            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                              Mention an agent
                            </div>
                            {mentionMatches.map((name) => (
                              <button
                                key={name}
                                type="button"
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--text-secondary)] transition hover:bg-[var(--bg-tertiary)]"
                                onClick={() => applyMention(name)}
                              >
                                <span aria-hidden="true">🤖</span>
                                <span>@{name}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="mc-shell-btn mc-shell-btn-active px-3 py-2 text-xs font-medium text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => void postComment()}
                        disabled={busyAction === 'comment' || !commentInput.trim()}
                      >
                        Comment
                      </button>
                    </div>
                  </div>
                ) : detailTab === 'subtasks' ? (
                  <div>
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-semibold text-[var(--text-primary)]">Subtasks</h4>
                        <div className="mt-1 text-xs text-[var(--text-muted)]">
                          {subtasks.length} linked task{subtasks.length === 1 ? '' : 's'} under #{task.id}.
                        </div>
                      </div>
                      <button
                        type="button"
                        className="mc-shell-btn mc-shell-btn-active px-3 py-2 text-xs font-medium text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => void autoGenerateSubtasks()}
                        disabled={busyAction !== null}
                      >
                        Auto-generate subtasks
                      </button>
                    </div>
                    {subtasks.length > 0 ? (
                      <div className="space-y-2">
                        {subtasks.map((subtask) => (
                          <a
                            key={subtask.id}
                            href={`/task/${subtask.id}`}
                            className="block rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] px-4 py-3 hover:border-[var(--border-secondary)]"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-[var(--text-primary)]">#{subtask.id} {subtask.name}</div>
                                <div className="mt-1 line-clamp-2 text-xs text-[var(--text-muted)]">{subtask.description || 'No description.'}</div>
                              </div>
                              <div className="flex shrink-0 gap-2 text-[11px]">
                                <span className="rounded-full border border-[var(--border-primary)] px-2 py-1">{COLUMN_LABELS[subtask.column]}</span>
                                <span className="rounded-full border border-[var(--border-primary)] px-2 py-1">{subtask.priority}</span>
                              </div>
                            </div>
                          </a>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-[var(--border-primary)] bg-[var(--bg-primary)] px-4 py-6 text-sm text-[var(--text-muted)]">
                        No subtasks yet. Use auto-generation or create a follow-up task.
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="mb-4">
                      <h4 className="text-sm font-semibold text-[var(--text-primary)]">Linked Evidence</h4>
                      <div className="mt-1 text-xs text-[var(--text-muted)]">
                        Output links open through Entity docs when they point to local markdown.
                      </div>
                    </div>
                    {outputLinks.length > 0 ? (
                      <div className="space-y-2">
                        {outputLinks.map((link) => (
                          <a
                            key={link.href}
                            href={link.href}
                            target={link.external ? '_blank' : undefined}
                            rel={link.external ? 'noreferrer' : undefined}
                            className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] px-4 py-3 hover:border-[var(--border-secondary)]"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                                {link.external ? 'External link' : 'Entity docs link'}
                              </div>
                              <div className="mt-1 truncate text-xs text-[var(--text-muted)]">{link.label}</div>
                            </div>
                            <span className="mc-shell-btn shrink-0 px-3 py-1.5 text-xs">Open</span>
                          </a>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-[var(--border-primary)] bg-[var(--bg-primary)] px-4 py-6 text-sm text-[var(--text-muted)]">
                        No output links found.
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>
          ) : (
	            <div className="rounded-xl border border-[var(--error)]/40 bg-[var(--surface-error)] px-4 py-3 text-sm text-[var(--error)]">
	              {error ?? 'Task detail is unavailable.'}
	            </div>
	          )}
	          </div>
	        </div>
      </div>
    </div>
  );
}
