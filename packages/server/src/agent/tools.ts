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
