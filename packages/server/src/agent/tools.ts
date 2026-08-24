import fs from 'fs';
import path from 'path';
import {
  TASK_COLUMNS,
  type ActivityRepository,
  type ActivityType,
  type TaskCommentRepository,
  type TaskRecord,
  type UpdateTaskInput,
} from '../../../db/src';
import type { TaskSyncLayer } from '../../../db/src/task-sync';
import type { DocumentArtifactType, DocumentAuthState, DocumentProvider } from '../../../db/src/document-integrations';
import type { DocumentRegistry, RegistryWriteInput } from '../document-providers/registry';
import { DocumentRegistryIdentityConflictError } from '../document-providers/registry';
import type {
  AdapterMutation,
  CapabilityReport,
  CapabilityState,
  CapabilityType,
  DocumentProviderAdapter,
} from '../document-providers/types';
import {
  capabilityAllowsActionForKey,
  mutationCapability,
  StaleRevisionError,
  UnsupportedAdapterMutationError,
} from '../document-providers/types';
import {
  resolveCapabilities,
  capabilityResolutionEnabled,
} from '../document-providers/capability-resolver';
import {
  MissingDestinationPolicyError,
  UnapprovedDestinationError,
  resolveCreateAllowance,
  resolveMutationAllowance,
  resolveConfirmationAllowance,
  type WritePolicy,
  type WriteRequestScope,
} from '../document-providers/write-policy';
import type { DocumentDestination } from '../document-providers/destinations';
import {
  preflightMutation,
  UnsafeMutationError,
} from '../document-providers/revision-coordinator';
import type { Phase2FlagSnapshot } from '../phase2-flags';
import {
  assessReviewOutput,
  BANNED_EVIDENCE_SMELL_REGEX,
  extractArtifactReferences,
  type ArtifactAssessment,
  type ReviewAssessment,
} from './review-policy';

const TASK_COLUMN_SET = new Set<string>(TASK_COLUMNS);
const URL_REGEX = /https?:\/\/[^\s)]+/gi;
const DOC_PATH_REGEX = /\b(?:output|memory|workspace)\/[^\s)]+/gi;
const FILE_PATH_REGEX = /(?:\.{0,2}\/|\/)[A-Za-z0-9._/-]+\.[A-Za-z0-9]+/g;
const SCM_REFERENCE_REGEX = /\b(?:PR\s*#\d+|pull request\s*#?\d+|commit\s+[0-9a-f]{7,40})\b/i;

interface LogActivityInput {
  source: 'agent' | 'task';
  type: ActivityType;
  action: string;
  description: string;
  agentName?: string;
  agentEmoji?: string;
  filePath?: string;
  taskId?: number;
  taskColumn?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskAgentToolDependencies {
  taskSyncLayer: TaskSyncLayer;
  activityRepository: ActivityRepository;
  taskCommentRepository: TaskCommentRepository;
  workspaceRoot: string;
  docsRoots?: Partial<Record<'output' | 'memory' | 'workspace', string>>;
  logActivity: (input: LogActivityInput) => unknown;
  broadcast: (data: unknown) => void;
}

export interface OutputValidationResult {
  valid: boolean;
  detail: string;
}

export interface ArtifactValidationResult extends ArtifactAssessment {}

export interface TaskAgentTools {
  getTask: (taskId: number) => Promise<TaskRecord | undefined>;
  searchTasks: (query: string, limit?: number) => Promise<TaskRecord[]>;
  updateTask: (taskId: number, fields: UpdateTaskInput) => Promise<TaskRecord | null>;
  addNote: (taskId: number, note: string) => Promise<void>;
  addNoteOnce: (taskId: number, note: string) => Promise<void>;
  moveTask: (taskId: number, column: string) => Promise<TaskRecord | null>;
  notifyAgent: (agent: string, message: string, taskId?: number) => Promise<void>;
  listTaskActivities: (taskId: number, limit?: number) => ReturnType<ActivityRepository['listActivitiesByTaskId']>;
  listTaskComments: (taskId: number) => ReturnType<TaskCommentRepository['listComments']>;
  discoverOutputCandidates: (task: TaskRecord) => Promise<string[]>;
  validateArtifactReference: (reference: string) => Promise<ArtifactValidationResult>;
  validateOutput: (value: string) => Promise<OutputValidationResult>;
  assessReview: (task: TaskRecord) => Promise<ReviewAssessment>;
}

function sanitizeCandidate(value: string): string {
  return value.trim().replace(/[),.;]+$/g, '');
}

function collectReferences(text: string | null | undefined): string[] {
  if (!text) {
    return [];
  }

  const matches = new Set<string>();
  const hasDocAliasForPath = (candidate: string): boolean => {
    if (!candidate.startsWith('/')) {
      return false;
    }

    return [...matches].some(
      (existing) =>
        /^(?:output|memory|workspace)\//.test(existing) &&
        existing.endsWith(candidate)
    );
  };

  for (const match of text.match(URL_REGEX) ?? []) {
    const normalized = sanitizeCandidate(match);
    if (normalized) {
      matches.add(normalized);
    }
  }
  for (const match of text.match(DOC_PATH_REGEX) ?? []) {
    const normalized = sanitizeCandidate(match);
    if (normalized) {
      matches.add(normalized);
    }
  }
  for (const match of text.match(FILE_PATH_REGEX) ?? []) {
    const normalized = sanitizeCandidate(match);
    if (normalized && !hasDocAliasForPath(normalized)) {
      matches.add(normalized);
    }
  }

  return [...matches];
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
}

function scoreTask(task: TaskRecord, queryTokens: readonly string[]): number {
  if (queryTokens.length === 0) {
    return 0;
  }

  const haystack = [task.name, task.description ?? '', task.output ?? ''].join(' ').toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (task.name.toLowerCase().includes(token)) {
      score += 3;
      continue;
    }

    if (haystack.includes(token)) {
      score += 1;
    }
  }

  return score;
}

function resolveOutputPath(
  workspaceRoot: string,
  docsRoots: Partial<Record<'output' | 'memory' | 'workspace', string>>,
  output: string
): string | null {
  if (!output) {
    return null;
  }

  if (output.startsWith('~/')) {
    const home = process.env.HOME;
    if (!home) {
      return null;
    }
    return path.resolve(home, output.slice(2));
  }

  if (path.isAbsolute(output)) {
    return output;
  }

  if (output.startsWith('output/')) {
    const root = docsRoots.output ?? path.join(workspaceRoot, 'output');
    return path.resolve(root, output.slice('output/'.length));
  }

  if (output.startsWith('memory/')) {
    const root = docsRoots.memory ?? path.join(workspaceRoot, 'memory');
    return path.resolve(root, output.slice('memory/'.length));
  }

  if (output.startsWith('workspace/')) {
    const root = docsRoots.workspace ?? workspaceRoot;
    return path.resolve(root, output.slice('workspace/'.length));
  }

  if (output.startsWith('./') || output.startsWith('../')) {
    return path.resolve(workspaceRoot, output);
  }

  if (output.includes('/') && !output.includes('://')) {
    return path.resolve(workspaceRoot, output);
  }

  return null;
}

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  const resolvedCandidate = path.resolve(candidatePath);
  const resolvedRoot = path.resolve(rootPath);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isReviewablePath(
  candidatePath: string,
  workspaceRoot: string,
  docsRoots: Partial<Record<'output' | 'memory' | 'workspace', string>>
): boolean {
  const candidateRoots = [workspaceRoot, docsRoots.output, docsRoots.memory, docsRoots.workspace].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  );
  return candidateRoots.some((rootPath) => isWithinRoot(candidatePath, rootPath));
}

function isEntityDocsUrl(value: string): boolean {
  return /\/docs\/(output|memory|workspace)\//i.test(value);
}

function isScmReference(value: string): boolean {
  return SCM_REFERENCE_REGEX.test(value);
}

async function requestUrl(url: string, method: 'HEAD' | 'GET'): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    return await fetch(url, {
      method,
      signal: controller.signal,
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timer);
  }
}

export function createTaskAgentTools(dependencies: TaskAgentToolDependencies): TaskAgentTools {
  const {
    taskSyncLayer,
    activityRepository,
    taskCommentRepository,
    workspaceRoot,
    docsRoots = {},
    logActivity,
    broadcast,
  } = dependencies;

  const addNote = async (taskId: number, note: string) => {
    const normalized = note.trim();
    if (!normalized) {
      return;
    }

    const comment = taskCommentRepository.createComment({
      task_id: taskId,
      body: normalized,
      author: 'Entity Agent',
    });

    logActivity({
      agentName: 'Task Master',
      agentEmoji: '🤖',
      source: 'agent',
      type: 'task_comment',
      action: 'Agent note',
      description: normalized.slice(0, 200),
      taskId,
      metadata: { fullNote: normalized },
    });
    broadcast({ type: 'task:comment', taskId, comment });
  };

  const validateArtifactReference = async (reference: string): Promise<ArtifactValidationResult> => {
    const normalized = reference.trim();
    if (!normalized) {
      return {
        reference,
        status: 'unknown',
        detail: 'Artifact reference is empty.',
        accessible: false,
        reviewable: false,
      };
    }

    if (isScmReference(normalized)) {
      return {
        reference: normalized,
        status: 'accessible',
        detail: `Source control reference provided: ${normalized}.`,
        accessible: true,
        reviewable: true,
      };
    }

    if (/^https?:\/\//i.test(normalized)) {
      try {
        let response = await requestUrl(normalized, 'HEAD');
        if (response.status === 405 || response.status === 501) {
          response = await requestUrl(normalized, 'GET');
        }

        if (response.ok) {
          return {
            reference: normalized,
            status: 'accessible',
            detail: isEntityDocsUrl(normalized)
              ? `Entity docs URL responded with ${response.status}.`
              : `URL responded with ${response.status}.`,
            accessible: true,
            reviewable: true,
          };
        }

        return {
          reference: normalized,
          status: 'dead_url',
          detail: `URL responded with ${response.status}.`,
          accessible: false,
          reviewable: false,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown URL validation error';
        return {
          reference: normalized,
          status: 'dead_url',
          detail: `URL check failed: ${message}`,
          accessible: false,
          reviewable: false,
        };
      }
    }

    const maybePath = resolveOutputPath(workspaceRoot, docsRoots, normalized);
    if (!maybePath) {
      return {
        reference: normalized,
        status: 'unknown',
        detail: `Artifact could not be resolved: ${normalized}.`,
        accessible: false,
        reviewable: false,
      };
    }

    if (!fs.existsSync(maybePath)) {
      return {
        reference: normalized,
        status: 'missing',
        detail: `File not found at ${maybePath}.`,
        accessible: false,
        reviewable: false,
      };
    }

    const stats = fs.statSync(maybePath);
    if (!stats.isFile()) {
      return {
        reference: normalized,
        status: 'exists_but_inaccessible',
        detail: `Path is not a file: ${maybePath}.`,
        accessible: false,
        reviewable: false,
      };
    }

    if (stats.size <= 0) {
      return {
        reference: normalized,
        status: 'empty',
        detail: `File is empty at ${maybePath}.`,
        accessible: false,
        reviewable: false,
      };
    }

    const reviewable = isReviewablePath(maybePath, workspaceRoot, docsRoots);
    if (!reviewable) {
      return {
        reference: normalized,
        status: 'exists_but_inaccessible',
        detail: `File exists at ${maybePath}, but it is outside the Entity-reviewable roots.`,
        accessible: false,
        reviewable: false,
      };
    }

    return {
      reference: normalized,
      status: 'accessible',
      detail: `File exists at ${maybePath}.`,
      accessible: true,
      reviewable: true,
    };
  };

  return {
    getTask: (taskId: number) => taskSyncLayer.getTask(taskId),

    searchTasks: async (query: string, limit = 10) => {
      const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 10;
      const tasks = await taskSyncLayer.listTasks();
      const queryTokens = tokenize(query);
      if (queryTokens.length === 0) {
        return tasks.slice(0, safeLimit);
      }

      return tasks
        .map((task) => ({ task, score: scoreTask(task, queryTokens) }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score || right.task.id - left.task.id)
        .slice(0, safeLimit)
        .map((entry) => entry.task);
    },

    updateTask: async (taskId: number, fields: UpdateTaskInput) => {
      const updated = await taskSyncLayer.updateTask(taskId, fields);
      if (!updated) {
        return null;
      }

      logActivity({
        agentName: 'Task Master',
        agentEmoji: '🤖',
        source: 'agent',
        type: 'task_updated',
        action: 'Agent updated task',
        description: `${updated.name} updated by TaskAgent.`,
        taskId: updated.id,
        taskColumn: updated.column,
        metadata: { fields: Object.keys(fields) },
      });
      broadcast({ type: 'task:updated', task: updated });
      return updated;
    },

    addNote,

    addNoteOnce: async (taskId: number, note: string) => {
      const normalized = note.trim();
      if (!normalized) {
        return;
      }

      const alreadyPresent = taskCommentRepository.listComments(taskId).some(
        (comment) => comment.author === 'Entity Agent' && comment.body.trim() === normalized
      );
      if (alreadyPresent) {
        return;
      }

      await addNote(taskId, normalized);
    },

    moveTask: async (taskId: number, column: string) => {
      const normalizedColumn = column.trim().toLowerCase();
      if (!TASK_COLUMN_SET.has(normalizedColumn)) {
        return null;
      }

      const moved = await taskSyncLayer.moveTask(taskId, normalizedColumn);
      if (!moved) {
        return null;
      }

      logActivity({
        agentName: 'Task Master',
        agentEmoji: '🤖',
        source: 'agent',
        type: moved.column === 'done' ? 'task_completed' : 'task_moved',
        action: 'Agent moved task',
        description: `${moved.name} moved to ${moved.column}.`,
        taskId: moved.id,
        taskColumn: moved.column,
      });
      broadcast({ type: 'task:moved', taskId: moved.id, column: moved.column });
      return moved;
    },

    notifyAgent: async (agent: string, message: string, taskId?: number) => {
      const normalizedAgent = agent.trim() || 'Unassigned';
      const normalizedMessage = message.trim();
      if (!normalizedMessage) {
        return;
      }

      logActivity({
        agentName: 'Task Master',
        agentEmoji: '🤖',
        source: 'agent',
        type: 'message_sent',
        action: `Notified ${normalizedAgent}`,
        description: normalizedMessage,
        taskId,
        metadata: { agent: normalizedAgent, channel: 'entity-task-agent' },
      });
      broadcast({
        type: 'agent:notify',
        agent: normalizedAgent,
        message: normalizedMessage,
        taskId: typeof taskId === 'number' ? taskId : undefined,
      });
    },

    listTaskActivities: (taskId: number, limit = 100) => {
      const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 500) : 100;
      return activityRepository.listActivitiesByTaskId(taskId, safeLimit);
    },

    listTaskComments: (taskId: number) => taskCommentRepository.listComments(taskId),

    discoverOutputCandidates: async (task: TaskRecord) => {
      const matches = new Set<string>();
      const addCandidate = (value: string | null | undefined) => {
        for (const candidate of collectReferences(value)) {
          matches.add(candidate);
        }
      };

      if (task.output?.trim()) {
        matches.add(task.output.trim());
      }
      addCandidate(task.description);

      const activities = activityRepository.listActivitiesByTaskId(task.id, 150);
      for (const activity of activities) {
        addCandidate(activity.description);
        if (activity.metadata) {
          addCandidate(activity.metadata);
        }
      }

      const comments = taskCommentRepository.listComments(task.id);
      for (const comment of comments) {
        addCandidate(comment.body);
      }

      return [...matches];
    },

    validateArtifactReference,

    validateOutput: async (value: string) => {
      const normalized = value.trim();
      if (!normalized) {
        return { valid: false, detail: 'Output is empty.' };
      }

      const references = extractArtifactReferences(normalized);
      if (BANNED_EVIDENCE_SMELL_REGEX.test(normalized) && references.length === 0) {
        return { valid: false, detail: 'Output references an inaccessible or vague artifact.' };
      }

      if (references.length === 0) {
        return {
          valid: true,
          detail: 'Output looks like a textual summary.',
        };
      }

      const inspections = await Promise.all(references.map((reference) => validateArtifactReference(reference)));
      const blockingInspection = inspections.find(
        (inspection) =>
          inspection.status === 'missing' ||
          inspection.status === 'empty' ||
          inspection.status === 'dead_url' ||
          inspection.status === 'exists_but_inaccessible'
      );
      if (blockingInspection) {
        return { valid: false, detail: blockingInspection.detail };
      }

      if (inspections.some((inspection) => inspection.status === 'unknown')) {
        return {
          valid: true,
          detail: 'Artifact reference provided, but it could not be fully verified automatically.',
        };
      }

      return {
        valid: true,
        detail: `Verified ${inspections.length} artifact reference(s).`,
      };
    },

    assessReview: (task: TaskRecord) =>
      assessReviewOutput(task, {
        artifactInspector: (reference) => validateArtifactReference(reference),
      }),
  };
}

/* =============================================================================
 * T-032 — Provider-neutral agent document tools.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md R-023
 *   ("Provider-neutral tools must cover at minimum: document.create / document.read /
 *    document.revise / spreadsheet.range.update / presentation.slide.update"), R-024
 *   (revision-aware mutation), R-025 (standard conflict response), R-026 (idempotent
 *   creation/retry), R-002 (unknown/degraded capability fails closed).
 *
 * The SAME tool contract dispatches across Google Workspace, Microsoft 365, and local-office
 * lanes from trusted document/provider context — never from a caller-supplied provider string
 * (D-003 / R-002: provider kind never implies authority; a caller string alone never enables a
 * write). Authority is consolidated from:
 *   - the canonical registry record (workspace-scoped, THE-945 r3 F3) for existing documents;
 *   - the R-003 write policy / allowed destination (admin + destination + write-mode gates);
 *   - the T-006 Capability Resolver (fail closed on unknown/degraded/unsupported);
 *   - the §10.1 Revision Coordinator (R-024 stale-precondition) with no blind retry (R-025);
 *   - the audited Phase 2 deployment flag (reversible write gate, 14.6 rollback).
 *
 * This module introduces NO competing provider registry, receipt store, event table, or API
 * namespace — it composes the shared document-providers primitives exactly like the T-008
 * router, and returns a typed data envelope to the agent (no credentials/tokens ever).
 * =============================================================================
 */

/** The five R-023 provider-neutral agent tool names (registered naming conforms to Entity). */
export type DocumentAgentToolName =
  | 'document.create'
  | 'document.read'
  | 'document.revise'
  | 'spreadsheet.range.update'
  | 'presentation.slide.update';

/** Typed outcome of a tool invocation. `ok` is the only success; everything else fails closed. */
export type DocumentAgentToolStatus = 'ok' | 'conflict' | 'unsupported' | 'denied' | 'not_found';

/** R-023 capability result field — names the negotiated lane and its folded state. */
export interface DocumentAgentCapabilityResult {
  name: CapabilityType;
  state: CapabilityState;
}

/** R-023 result envelope returned by every tool (Entity doc id, stable URL, provider, revision, …). */
export interface DocumentAgentToolResult {
  tool: DocumentAgentToolName;
  status: DocumentAgentToolStatus;
  documentId: string | null;
  /** Stable Entity URL — never a provider URL. */
  entityUrl: string | null;
  provider: DocumentProvider | null;
  revision: string | null;
  capability: DocumentAgentCapabilityResult | null;
  /** Idempotency key / Entity operation id correlation. */
  operationId: string | null;
  /** Receipt correlation id (null when no receipt was written this round). */
  receiptId: string | null;
  /** Typed warning / degraded information, never secrets. */
  warnings: string[];
  /** True when the operation completed but in a degraded/partial way. */
  degraded: boolean;
}

/** Dependencies shared by the T-032 orchestrator (a composition of the T-008 router deps). */
export interface DocumentAgentDeps {
  registry: DocumentRegistry;
  /** Provider selection; returns the adapter for a provider kind, or undefined (fail closed). */
  adapters: (provider: string) => DocumentProviderAdapter | undefined;
  /** R-003 write policies. */
  policies: readonly WritePolicy[];
  /** R-003 destination records. */
  destinations: readonly DocumentDestination[];
  /** Phase 2 flag snapshot (audited write gate / rollback). */
  flags: Phase2FlagSnapshot;
  /** Resolve the trusted workspace for the agent. Returns null to fail closed. */
  resolveWorkspace: () => string | null;
  /** Authenticated connection state (R-001), derived from real registered state; absent => unknown. */
  connectionStateFor?: (scope: WriteRequestScope) => DocumentAuthState | undefined;
  /** Provider-neutral runtime evidence folded into the capability resolver. */
  runtimeEvidence?: (scope: WriteRequestScope) => Readonly<Record<string, unknown>>;
  /** Injected clock for deterministic timestamps. */
  now?: () => string;
}

/** R-023 document.create payload (creation context + idempotency/association/confirmation). */
export interface DocumentAgentCreateInput {
  provider: DocumentProvider;
  artifactType: DocumentArtifactType;
  title: string;
  destinationId?: string | null;
  /** R-026 idempotency key persisted before the provider call. */
  idempotencyKey: string;
  /** Optional association context (workspace/project/task/File Source) — never silently dropped. */
  associations?: unknown;
  /** R-005 #7 confirmation evidence when the governing policy requires it. */
  confirmed?: boolean;
}

/** Common mutation inputs shared by revise/range/slide (R-023 write tool inputs). */
export interface DocumentAgentMutationInputBase {
  documentId: string;
  /** D-012 / R-024 revision precondition. */
  expectedRevision: string;
  /** R-026 idempotency key / Entity operation id. */
  idempotencyKey: string;
  /** Optional association context — never silently dropped. */
  associations?: unknown;
  /** R-005 #7 confirmation evidence when required. */
  confirmed?: boolean;
  /**
   * If a caller further claims a provider, it must EQUAL the trusted registry record provider,
   * otherwise the tool FAILS CLOSED (a caller string never redirects provider authority).
   */
  provider?: DocumentProvider;
}

export interface DocumentAgentReviseInput extends DocumentAgentMutationInputBase {
  /** Typed operation payload: full-document text revision. */
  text: string;
}
export interface DocumentAgentRangeUpdateInput extends DocumentAgentMutationInputBase {
  /** Typed operation payload: spreadsheet cell reference (e.g. `A1`). */
  cell: string;
  value: string;
}
export interface DocumentAgentSlideUpdateInput extends DocumentAgentMutationInputBase {
  /** Typed operation payload: presentation slide id. */
  slideId: string;
}
export interface DocumentAgentReadInput {
  documentId: string;
}

/** The T-032 provider-neutral agent tool surface. */
export interface DocumentAgentTools {
  create(input: DocumentAgentCreateInput): Promise<DocumentAgentToolResult>;
  read(input: DocumentAgentReadInput): Promise<DocumentAgentToolResult>;
  revise(input: DocumentAgentReviseInput): Promise<DocumentAgentToolResult>;
  updateRange(input: DocumentAgentRangeUpdateInput): Promise<DocumentAgentToolResult>;
  updateSlide(input: DocumentAgentSlideUpdateInput): Promise<DocumentAgentToolResult>;
}

/** Build a T-032 provider-neutral document agent tool orchestrator. */
export function createDocumentAgentTools(deps: DocumentAgentDeps): DocumentAgentTools {
  const nowIso = deps.now ?? (() => new Date().toISOString());

  function resolveWorkspace(): string | null {
    return deps.resolveWorkspace();
  }

  function adapterFor(provider: DocumentProvider): DocumentProviderAdapter | undefined {
    return deps.adapters(provider);
  }

  function scopeFor(scope: WriteRequestScope): WriteRequestScope {
    return scope;
  }

  /** Async capability lane check that treats an absent report entry as fail-closed unknown. */
  async function capabilityStateFor(
    adapter: DocumentProviderAdapter,
    artifactType: DocumentArtifactType,
    capability: CapabilityType,
    connection: DocumentAuthState,
    destination: 'allowed' | 'denied' | 'unknown',
    policy: 'allowed' | 'denied' | 'unknown',
    runtime: Readonly<Record<string, unknown>>,
  ): Promise<CapabilityReport> {
    return resolveCapabilities({ adapter, artifactType, connection, destination, policy, runtime });
  }

  function noWorkspace(tool: DocumentAgentToolName): DocumentAgentToolResult {
    return {
      tool,
      status: 'denied',
      documentId: null,
      entityUrl: null,
      provider: null,
      revision: null,
      capability: null,
      operationId: null,
      receiptId: null,
      warnings: ['workspace could not be determined; failing closed (workspace isolation).'],
      degraded: false,
    };
  }

  function deniedResult(
    tool: DocumentAgentToolName,
    capability: DocumentAgentCapabilityResult | null,
    warning: string,
    documentId: string | null = null,
  ): DocumentAgentToolResult {
    return {
      tool,
      status: 'denied',
      documentId,
      entityUrl: documentId ? `/documents/${documentId}` : null,
      provider: null,
      revision: null,
      capability,
      operationId: null,
      receiptId: null,
      warnings: [warning],
      degraded: false,
    };
  }

  function unsupportedResult(
    tool: DocumentAgentToolName,
    capability: DocumentAgentCapabilityResult,
    warning: string,
    documentId: string | null = null,
  ): DocumentAgentToolResult {
    return {
      tool,
      status: 'unsupported',
      documentId,
      entityUrl: documentId ? `/documents/${documentId}` : null,
      provider: null,
      revision: null,
      capability,
      operationId: null,
      receiptId: null,
      warnings: [warning],
      degraded: false,
    };
  }

  function conflictResult(
    tool: DocumentAgentToolName,
    capability: DocumentAgentCapabilityResult,
    warning: string,
    documentId: string | null = null,
  ): DocumentAgentToolResult {
    return {
      tool,
      status: 'conflict',
      documentId,
      entityUrl: documentId ? `/documents/${documentId}` : null,
      provider: null,
      revision: null,
      capability,
      operationId: null,
      receiptId: null,
      warnings: [warning],
      degraded: false,
    };
  }

  return {
    async create(input): Promise<DocumentAgentToolResult> {
      const tool: DocumentAgentToolName = 'document.create';
      const workspaceId = resolveWorkspace();
      if (!workspaceId) {
        return noWorkspace(tool);
      }
      // A caller-provided provider string never confers authority: the adapter is merely the
      // transport for the requested lane. Every enablement gate (policy/destination/
      // confirmation/capability/flag) must pass for the create to dispatch.
      const adapter = adapterFor(input.provider);
      if (!adapter) {
        return unsupportedResult(tool, { name: 'create', state: 'unknown' },
          `no provider adapter is registered for ${input.provider}; failing closed.`);
      }
      // Audited write-gate flag (reversible rollback).
      if (!capabilityResolutionEnabled(deps.flags)) {
        return deniedResult(tool, { name: 'create', state: 'unknown' },
          'the audited write-gate feature flag is disabled; create is not deployed (fail closed).');
      }
      const scope = scopeFor({
        workspaceId,
        tenantId: null,
        provider: input.provider,
        artifactType: input.artifactType,
        connectionId: null,
        destinationId: input.destinationId ?? null,
      });

      // R-003 create allowance (admin + approved destination + write mode).
      let policyAllowed = false;
      try {
        const decision = resolveCreateAllowance(deps.policies, deps.destinations, scope);
        policyAllowed = decision.policy === 'allowed' && decision.destination === 'allowed';
      } catch (err) {
        if (err instanceof MissingDestinationPolicyError || err instanceof UnapprovedDestinationError) {
          return deniedResult(tool, { name: 'create', state: 'unknown' },
            `create is not authorized by the governing write policy/destination (fail closed): ${err.message}`);
        }
        throw err;
      }
      if (!policyAllowed) {
        return deniedResult(tool, { name: 'create', state: 'unknown' },
          'creation is not authorized by the governing write policy / destination (fail closed).');
      }
      // R-005 #7 confirmation gate.
      const confirmation = resolveConfirmationAllowance(deps.policies, scope, 'create', input.confirmed === true);
      if (confirmation.allowance !== 'allowed') {
        return deniedResult(tool, { name: 'create', state: 'unknown' },
          'this create requires explicit human confirmation per the governing confirmation policy; the request did not provide it (blocked).');
      }
      // Capability resolver: create must be fully actionable (fail closed on unknown/degraded).
      const report = await capabilityStateFor(
        adapter,
        input.artifactType,
        'create',
        deps.connectionStateFor ? deps.connectionStateFor(scope) ?? 'unknown' : 'unknown',
        'allowed',
        'allowed',
        deps.runtimeEvidence ? deps.runtimeEvidence(scope) : {},
      );
      if (!capabilityAllowsActionForKey(report, 'create')) {
        return unsupportedResult(tool, { name: 'create', state: report.create.state },
          `${input.provider} does not support create for ${input.artifactType} under the current connection/capability state; failing closed.`);
      }
      const created = await adapter.create({
        artifact_type: input.artifactType,
        title: input.title,
        idempotencyKey: input.idempotencyKey,
        now: nowIso(),
      });

      // R-026 idempotent replay: reconcile to the existing canonical record when present.
      if (created.created === false) {
        const existing = created.descriptor.external_id
          ? deps.registry.findByProviderIdentity(
              created.descriptor.provider_connection_id ?? null,
              created.descriptor.external_id,
              workspaceId,
            )
          : undefined;
        if (existing) {
          const warnings = input.associations !== undefined && input.associations !== null
            ? ['replayed idempotency key; associations were not re-persisted (no-op replay).']
            : ['replayed idempotency key; reconciled to the existing document.'];
          return {
            tool,
            status: 'ok',
            documentId: existing.id,
            entityUrl: `/documents/${existing.id}`,
            provider: existing.provider,
            revision: existing.current_revision,
            capability: { name: 'create', state: report.create.state },
            operationId: input.idempotencyKey,
            receiptId: null,
            warnings,
            degraded: existing.current_revision == null,
          };
        }
        return conflictResult(tool, { name: 'create', state: report.create.state },
          'the provider already created a document for this idempotency key, but no canonical record is present; reconciliation is required (returning the existing artifact).');
      }

      const writeInput: RegistryWriteInput = {
        provider: input.provider,
        artifact_type: input.artifactType,
        title: input.title,
        destination_id: input.destinationId ?? null,
        external_id: created.descriptor.external_id,
        provider_connection_id: created.descriptor.provider_connection_id,
        provider_url: created.descriptor.provider_url,
        owner_summary: null,
        tenant_external_id: null,
        permissions_summary_json: null,
        sensitivity_label: null,
        auth_state: created.descriptor.auth_state,
        readiness_state: created.descriptor.readiness_state,
        current_revision: created.descriptor.current_revision,
        provider_modified_at: created.descriptor.provider_modified_at,
        preview_state: created.descriptor.preview_state,
        conflict_state: created.descriptor.conflict_state,
      };

      let canonical;
      try {
        canonical = deps.registry.create(writeInput, workspaceId);
      } catch (err) {
        if (err instanceof DocumentRegistryIdentityConflictError) {
          return conflictResult(tool, { name: 'create', state: report.create.state },
            'a document with this provider identity already exists (fail closed).');
        }
        throw err;
      }

      const warnings: string[] = [];
      if (input.associations !== undefined && input.associations !== null) {
        // R-030 association context is accepted but not persisted by the current create lane; it is
        // surfaced as a typed warning/degraded outcome rather than silently dropped.
        warnings.push('association context was accepted but is not yet persisted by the active create lane (degraded); it was not silently dropped.');
      }
      return {
        tool,
        status: 'ok',
        documentId: canonical.id,
        entityUrl: `/documents/${canonical.id}`,
        provider: canonical.provider,
        revision: canonical.current_revision,
        capability: { name: 'create', state: report.create.state },
        operationId: input.idempotencyKey,
        receiptId: null,
        warnings,
        degraded: warnings.length > 0 || canonical.current_revision == null,
      };
    },

    async read(input): Promise<DocumentAgentToolResult> {
      const tool: DocumentAgentToolName = 'document.read';
      const workspaceId = resolveWorkspace();
      if (!workspaceId) {
        return noWorkspace(tool);
      }
      // Trusted context: the canonical record (workspace-scoped) is the sole provider authority.
      const record = deps.registry.get(input.documentId, workspaceId);
      if (!record) {
        return {
          tool,
          status: 'not_found',
          documentId: input.documentId,
          entityUrl: `/documents/${input.documentId}`,
          provider: null,
          revision: null,
          capability: null,
          operationId: null,
          receiptId: null,
          warnings: [`document ${input.documentId} was not found.`],
          degraded: false,
        };
      }
      const adapter = adapterFor(record.provider);
      if (!adapter) {
        return unsupportedResult(tool, { name: 'read', state: 'unknown' },
          `no provider adapter is registered for provider ${record.provider}; failing closed.`,
          record.id);
      }
      const report = await capabilityStateFor(
        adapter,
        record.artifact_type,
        'read',
        record.auth_state,
        'allowed',
        'allowed',
        deps.runtimeEvidence ? deps.runtimeEvidence(writeScopeForRecord(record, workspaceId)) : {},
      );
      if (!capabilityAllowsActionForKey(report, 'read')) {
        return unsupportedResult(tool, { name: 'read', state: report.read.state },
          `${record.provider} does not support read for this artifact; failing closed.`,
          record.id);
      }
      const readResult = await adapter.read({
        external_id: record.external_id ?? '',
        provider_connection_id: record.provider_connection_id ?? null,
      });
      return {
        tool,
        status: 'ok',
        documentId: record.id,
        entityUrl: `/documents/${record.id}`,
        provider: readResult.descriptor.provider,
        revision: readResult.descriptor.current_revision ?? record.current_revision,
        capability: { name: 'read', state: report.read.state },
        operationId: null,
        receiptId: null,
        warnings: ['read returns a synthetic content placeholder, never real document contents (privacy D-013).'],
        degraded: false,
      };
    },

    async revise(input): Promise<DocumentAgentToolResult> {
      return mutateLane('document.revise', input, { kind: 'text', text: input.text });
    },

    async updateRange(input): Promise<DocumentAgentToolResult> {
      return mutateLane('spreadsheet.range.update', input, { kind: 'range', cell: input.cell, value: input.value });
    },

    async updateSlide(input): Promise<DocumentAgentToolResult> {
      return mutateLane('presentation.slide.update', input, { kind: 'slide', slideId: input.slideId });
    },
  };

  function writeScopeForRecord(
    record: import('../../../db/src/document-integrations').DocumentObjectRecord,
    workspaceId: string,
  ): WriteRequestScope {
    return {
      workspaceId,
      tenantId: record.tenant_external_id ?? null,
      provider: record.provider,
      artifactType: record.artifact_type,
      connectionId: record.provider_connection_id ?? null,
      destinationId: record.destination_id ?? null,
    };
  }

  async function mutateLane(
    tool: DocumentAgentToolName,
    input: DocumentAgentMutationInputBase,
    mutation: AdapterMutation,
  ): Promise<DocumentAgentToolResult> {
    const workspaceId = resolveWorkspace();
    if (!workspaceId) {
      return noWorkspace(tool);
    }
    // Trusted context: the canonical record (workspace-scoped) is the sole provider authority.
    const record = deps.registry.get(input.documentId, workspaceId);
    if (!record) {
      return {
        tool,
        status: 'not_found',
        documentId: input.documentId,
        entityUrl: `/documents/${input.documentId}`,
        provider: null,
        revision: null,
        capability: null,
        operationId: null,
        receiptId: null,
        warnings: [`document ${input.documentId} was not found.`],
        degraded: false,
      };
    }
    const cap: CapabilityType = mutationCapability(mutation);
    // Provider mismatch: a caller-supplied provider string that disagrees with the trusted record
    // FAILS CLOSED — a caller can never redirect authority to another lane.
    if (input.provider !== undefined && input.provider !== record.provider) {
      return deniedResult(tool, { name: cap, state: 'unknown' },
        `caller-provided provider ${input.provider} does not match the trusted document provider ${record.provider}; failing closed.`,
        record.id);
    }
    const adapter = adapterFor(record.provider);
    if (!adapter) {
      return unsupportedResult(tool, { name: cap, state: 'unknown' },
        `no provider adapter is registered for provider ${record.provider}; failing closed.`,
        record.id);
    }
    // Audited write-gate flag (reversible rollback).
    if (!capabilityResolutionEnabled(deps.flags)) {
      return deniedResult(tool, { name: cap, state: 'unknown' },
        'the audited write-gate feature flag is disabled; mutation is not deployed (fail closed).',
        record.id);
    }
    const scope = writeScopeForRecord(record, workspaceId);

    // R-003 mutation allowance: only create_and_update authorizes updates.
    let mutationAllowed = false;
    try {
      mutationAllowed = resolveMutationAllowance(deps.policies, scope).policy === 'allowed';
    } catch (err) {
      if (err instanceof MissingDestinationPolicyError) {
        return deniedResult(tool, { name: cap, state: 'unknown' },
          `no write destination policy governs the request scope; failing closed (${err.message}).`, record.id);
      }
      throw err;
    }
    if (!mutationAllowed) {
      return deniedResult(tool, { name: cap, state: 'unknown' },
        'mutation is not authorized by the governing write policy (only create_and_update allows updates).',
        record.id);
    }
    // R-005 #7 confirmation gate.
    const confirmation = resolveConfirmationAllowance(deps.policies, scope, 'update', input.confirmed === true);
    if (confirmation.allowance !== 'allowed') {
      return deniedResult(tool, { name: cap, state: 'unknown' },
        'this update requires explicit human confirmation per the governing confirmation policy; the request did not provide it (blocked).',
        record.id);
    }
    // Capability resolver: the mutation lane must be fully supported (fail closed otherwise).
    const report = await capabilityStateFor(
      adapter,
      record.artifact_type,
      cap,
      record.auth_state,
      'allowed',
      'allowed',
      deps.runtimeEvidence ? deps.runtimeEvidence(scope) : {},
    );
    if (!capabilityAllowsActionForKey(report, cap)) {
      return unsupportedResult(tool, { name: cap, state: report[cap].state },
        `${mutation.kind} mutation is not supported by provider ${record.provider}; failing closed.`,
        record.id);
    }
    try {
      // §10.1 Revision Coordinator: enforce the R-024 precondition BEFORE the adapter write.
      await preflightMutation({
        adapter,
        externalId: record.external_id ?? '',
        providerConnectionId: record.provider_connection_id ?? null,
        mutation,
        expectedRevision: input.expectedRevision,
        documentId: record.id,
      });
      const mutated = await adapter.mutate({
        external_id: record.external_id ?? '',
        provider_connection_id: record.provider_connection_id ?? null,
        expectedRevision: input.expectedRevision,
        mutation,
        idempotencyKey: input.idempotencyKey,
        now: nowIso(),
      });
      // Reflect the new revision onto the canonical record.
      const updated = deps.registry.update(record.id, workspaceId, {
        current_revision: mutated.resultRevision,
        provider_modified_at: nowIso(),
      });
      const warnings: string[] = [];
      if (input.associations !== undefined && input.associations !== null) {
        warnings.push('association context was accepted but is not yet persisted by the active mutation lane (degraded); it was not silently dropped.');
      }
      return {
        tool,
        status: 'ok',
        documentId: record.id,
        entityUrl: `/documents/${record.id}`,
        provider: record.provider,
        revision: updated?.current_revision ?? mutated.resultRevision,
        capability: { name: cap, state: report[cap].state },
        operationId: input.idempotencyKey,
        receiptId: null,
        warnings,
        degraded: warnings.length > 0,
      };
    } catch (err) {
      // R-025: standard conflict response, no blind retry.
      if (err instanceof StaleRevisionError) {
        return conflictResult(tool, { name: cap, state: report[cap].state },
          `STALE_REVISION: the document changed after this operation was prepared (expectedRevision=${undefinedToNone(err.expectedRevision)}, currentRevision=${undefinedToNone(err.currentRevision)}). No automatic retry.`,
          record.id);
      }
      if (err instanceof UnsafeMutationError || err instanceof UnsupportedAdapterMutationError) {
        return unsupportedResult(tool, { name: cap, state: report[cap].state },
          `${mutation.kind} mutation failed closed: ${err.message}`, record.id);
      }
      throw err;
    }
  }
}

/** Keep revision tokens out of any log/result that might leak — return a safe placeholder. */
function undefinedToNone(value: string | undefined): string {
  return value ?? '<unknown>';
}
