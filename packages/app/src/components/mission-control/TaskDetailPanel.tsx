import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import {
  fetchProjectOptions as fetchAllowedProjectOptions,
  normalizeProjectOption,
  type ProjectOption,
} from './projectOptions';
import { getCachedAgents } from '../../lib/agentRegistry';

const DEFAULT_ASSIGNEE_OPTIONS = ['Assistant', 'Human'] as const;
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

interface TaskActivity {
  id: number;
  source: 'agent' | 'task';
  type: string;
  action: string;
  description: string;
  agentName: string;
  agentEmoji: string | null;
  taskColumn: string | null;
  filePath: string | null;
  metadataText: string | null;
  metadataRecord: Record<string, unknown> | null;
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

  return {
    id,
    source: record.source === 'task' ? 'task' : 'agent',
    type: readNonEmptyString(record.type) ?? 'task_updated',
    action: readNonEmptyString(record.action) ?? 'Updated task',
    description: readNonEmptyString(record.description) ?? 'No details recorded.',
    agentName: readFirstString(record.agent_name, metadataRecord?.user) ?? 'Entity',
    agentEmoji: readNonEmptyString(record.agent_emoji),
    taskColumn: readNonEmptyString(record.task_column),
    filePath: readNonEmptyString(record.file_path),
    metadataText: metadataRecord ? JSON.stringify(metadataRecord, null, 2) : metadataText,
    metadataRecord,
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
  return `${outcome}${criteria > 0 ? ` / ${criteria} criterion${criteria === 1 ? '' : 'a'}` : ''}`;
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

  const assigneeOptions = useMemo(() => {
    const agents = getCachedAgents();
    const agentNames = agents.map((a) => a.name);
    const options = [...DEFAULT_ASSIGNEE_OPTIONS, ...agentNames, userProfile.displayName, 'Unassigned'];
    // deduplicate while preserving order
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const o of options) {
      if (!seen.has(o)) {
        seen.add(o);
        deduped.push(o);
      }
    }
    if (form?.assignee && !seen.has(form.assignee)) {
      return [form.assignee, ...deduped];
    }
    return deduped;
  }, [form?.assignee, userProfile.displayName]);

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

  return (
    <div className="fixed inset-0 z-[85] pointer-events-none">
      <div
        className={`absolute inset-0 bg-transparent transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        data-testid="task-detail-panel"
        className={`pointer-events-auto absolute bottom-0 right-0 top-[45px] flex h-[calc(100%-45px)] w-full flex-col overflow-hidden border-l border-[var(--border-primary)] bg-[var(--bg-secondary)] shadow-[-10px_0_28px_rgba(0,0,0,0.22)] transition-[transform,opacity] duration-200 ease-out sm:w-[min(50vw,760px)] ${
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

	              <section style={{ order: 2 }} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-3">
	                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
	                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
	                    Review
	                  </div>
	                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${
	                    hasReviewMetadata(task.metadataRecord)
	                      ? 'border-[var(--accent)]/25 bg-[var(--surface-accent)] text-[var(--accent)]'
	                      : 'border-amber-500/25 bg-amber-500/10 text-amber-200'
	                  }`}>
	                    {hasReviewMetadata(task.metadataRecord) ? 'Packet present' : 'Needs packet'}
	                  </span>
	                </div>
	                <div className="grid gap-2 text-xs text-[var(--text-secondary)] sm:grid-cols-2">
	                  <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5">
	                    <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Reviewer</div>
	                    <div>{normalizeBoolean(task.metadataRecord.henry_required ?? task.metadataRecord.requires_henry) ? 'Henry' : reviewField(task.metadataRecord.reviewer ?? task.metadataRecord.review_owner)}</div>
	                  </div>
	                  <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5">
	                    <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Decision</div>
	                    <div>{reviewField(task.metadataRecord.review_decision, 'Pending')}</div>
	                  </div>
	                  <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5">
	                    <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Type / Risk</div>
	                    <div>{reviewField(task.metadataRecord.review_type ?? task.metadataRecord.review_class)} / {reviewField(task.metadataRecord.risk_level)}</div>
	                  </div>
	                  <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5">
	                    <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Reviewed By</div>
	                    <div>{reviewField(task.metadataRecord.reviewed_by)}</div>
	                  </div>
	                  <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5 sm:col-span-2">
	                    <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Packet</div>
	                    <div>{reviewPacketSummary(task.metadataRecord)}</div>
	                  </div>
	                  {readNonEmptyString(task.metadataRecord.review_note) ? (
	                    <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5 sm:col-span-2">
	                      <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Review Note</div>
	                      <div>{readNonEmptyString(task.metadataRecord.review_note)}</div>
	                    </div>
	                  ) : null}
	                </div>
                  {hasReviewMetadata(task.metadataRecord) ? (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--border-primary)] pt-3">
                      <button
                        type="button"
                        className="mc-shell-btn px-3 py-1.5 text-xs font-medium"
                        onClick={() => void saveReviewDecision('accepted')}
                        disabled={busyAction !== null || normalizeReviewDecision(task.metadataRecord.review_decision) === 'accepted'}
                      >
                        Accept review
                      </button>
                      <button
                        type="button"
                        className="mc-shell-btn px-3 py-1.5 text-xs font-medium"
                        onClick={() => void saveReviewDecision('accepted', { complete: true })}
                        disabled={busyAction !== null}
                      >
                        Accept + Done
                      </button>
                      <button
                        type="button"
                        className="mc-shell-btn px-3 py-1.5 text-xs font-medium"
                        onClick={() => void saveReviewDecision('needs_fix')}
                        disabled={busyAction !== null || normalizeReviewDecision(task.metadataRecord.review_decision) === 'needs_fix'}
                      >
                        Needs fix
                      </button>
                      <button
                        type="button"
                        className="mc-shell-btn px-3 py-1.5 text-xs font-medium"
                        onClick={() => void saveReviewDecision('rejected')}
                        disabled={busyAction !== null || normalizeReviewDecision(task.metadataRecord.review_decision) === 'rejected'}
                      >
                        Reject
                      </button>
                      {normalizeReviewDecision(task.metadataRecord.review_decision) !== 'accepted' ? (
                        <div className="basis-full text-[11px] text-[var(--text-muted)]">
                          Done is locked until the review decision is accepted.
                        </div>
                      ) : null}
                    </div>
                  ) : null}
	              </section>

	              <section style={{ order: 3 }} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2.5">
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
	                        {visibleActivity.map((activity) => (
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

	                            {activityView === 'technical' ? (
	                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
	                              {activityView === 'technical' ? <span>{activity.type.replace(/_/g, ' ')}</span> : null}
	                              {activityView === 'technical' && activity.taskColumn ? <span>{activity.taskColumn}</span> : null}
	                              {activityView === 'technical' && activity.filePath ? <span>{activity.filePath}</span> : null}
	                            </div>
	                            ) : null}

                            {activityView === 'technical' && activity.metadataText ? (
                              <pre className="mt-3 overflow-x-auto rounded-lg border border-[var(--border-primary)] bg-[#0f0f0f] px-3 py-3 text-xs text-[#d1d5db]">
                                {activity.metadataText}
                              </pre>
                            ) : null}
                          </article>
                        ))}
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
                      <input
                        type="text"
                        value={commentInput}
                        onChange={(event) => setCommentInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void postComment();
                          }
                        }}
                        placeholder="Add a comment..."
                        className="mc-shell-input min-w-0 flex-1 px-3 py-2 text-sm"
                      />
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
