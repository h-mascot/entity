import { useCallback, useEffect, useRef } from 'react';
import { create } from 'zustand';
import { useEntityWebSocket } from './useEntityWebSocket';
import { buildApiCandidates, requestJsonWithFallback, toErrorMessage } from '../lib/http';
import {
  cacheApiPayload,
  isOfflineQueuedResponsePayload,
  OFFLINE_QUEUE_DRAINED_EVENT,
  readCachedApiPayload,
  readOfflineWriteQueueSnapshot,
} from '../lib/offline';
import { readUserProfile } from '../lib/userProfile';

const DEFAULT_API_BASE = '';
const TASK_RELOAD_POLL_INTERVAL_MS = 30_000;
const TASK_WS_RECENT_UPDATE_WINDOW_MS = 25_000;
const TASK_WS_RECONNECT_DELAY_MS = 3_000;

export const TASK_COLUMNS = ['backlog', 'todo', 'doing', 'review', 'done'] as const;

export type TaskColumn = (typeof TASK_COLUMNS)[number];
export type TaskPriority = 'P0' | 'P1' | 'P2' | 'P3';

export interface TaskBoardProject {
  id?: number;
  name: string;
  color: string | null;
  created_at?: string | null;
}

export interface TaskActivity {
  id?: number | string;
  agent_name?: string | null;
  user?: string | null;
  action?: string | null;
  details?: string | null;
  created_at: string;
}

export interface TaskBoardTask {
  id: number;
  org_id: string | null;
  team_id: string | null;
  project_id: number | null;
  created_by_principal_id: string | null;
  initiator_principal_id: string | null;
  initiator_type: string | null;
  owner_principal_id: string | null;
  owner_principal_type: string | null;
  executor_principal_id: string | null;
  assignment_state: string | null;
  taskmaster_drivable: boolean;
  name: string;
  description: string | null;
  column: TaskColumn;
  assignee: string;
  model: string | null;
  archived: boolean;
  priority: TaskPriority;
  project: string;
  projects: TaskBoardProject[];
  blocked: boolean;
  blocker_reason: string | null;
  due_at: string | null;
  recurring: boolean;
  progress_status: string | null;
  activity?: TaskActivity[];
  created_at: string;
  updated_at: string;
  metadata: string | null;
  worktype: string | null;
  policy_inputs_json: string | null;
  review_required?: boolean;
  review_state?: string | null;
  human_gate_required?: boolean;
  human_gate_state?: string | null;
  output: string | null;
  output_links_count: number;
  parent_task_id: number | null;
  subtask_count: number;
  subtask_done_count: number;
}

export interface CreateTaskPayload {
  name: string;
  org_id?: string;
  team_id?: string;
  project_id?: number | null;
  created_by_principal_id?: string;
  initiator_principal_id?: string;
  initiator_type?: string;
  owner_principal_id?: string;
  owner_principal_type?: string;
  executor_principal_id?: string;
  assignment_state?: string;
  taskmaster_drivable?: boolean;
  description?: string;
  assignee?: string;
  column?: TaskColumn;
  model?: string;
  archived?: boolean;
  priority?: TaskPriority;
  project?: string;
  projectIds?: number[];
  blocked?: boolean;
  blocker_reason?: string;
  due_date?: string | null;
  due_at?: string | null;
  recurring?: boolean;
  metadata?: string;
  worktype?: string;
  policy_inputs_json?: string;
}

interface TaskBoardState {
  tasks: TaskBoardTask[];
  loading: boolean;
  error: string | null;
  initialized: boolean;
  setTasks: (tasks: TaskBoardTask[]) => void;
  upsertTask: (task: TaskBoardTask) => void;
  removeTask: (taskId: number) => void;
  setTaskColumn: (taskId: number, column: TaskColumn) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setInitialized: (initialized: boolean) => void;
}

interface UseTaskBoardOptions {
  apiBase?: string;
  autoLoad?: boolean;
}

interface TaskBoardWsMessage {
  type?: string;
  task?: unknown;
  taskId?: unknown;
  id?: unknown;
}

const useTaskBoardStore = create<TaskBoardState>((set) => ({
  tasks: [],
  loading: false,
  error: null,
  initialized: false,
  setTasks: (tasks) => set({ tasks }),
  upsertTask: (task) =>
    set((state) => {
      const existingIndex = state.tasks.findIndex((candidate) => candidate.id === task.id);
      if (existingIndex < 0) {
        return { tasks: [task, ...state.tasks] };
      }

      const nextTasks = [...state.tasks];
      nextTasks[existingIndex] = task;
      return { tasks: nextTasks };
    }),
  removeTask: (taskId) =>
    set((state) => ({
      tasks: state.tasks.filter((task) => task.id !== taskId),
    })),
  setTaskColumn: (taskId, column) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              column,
              updated_at: new Date().toISOString(),
            }
          : task
      ),
    })),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setInitialized: (initialized) => set({ initialized }),
}));

function isTaskColumn(value: string): value is TaskColumn {
  return (TASK_COLUMNS as readonly string[]).includes(value);
}

function normalizeTaskColumn(value: unknown): TaskColumn {
  if (typeof value !== 'string') {
    return 'backlog';
  }

  const lowered = value.toLowerCase();
  if (isTaskColumn(lowered)) {
    return lowered;
  }

  return 'backlog';
}

function toTimestamp(value: unknown): string {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date().toISOString();
}

function normalizePriority(value: unknown): TaskPriority {
  if (typeof value !== 'string') {
    return 'P2';
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === 'P0' || normalized === 'P1' || normalized === 'P2' || normalized === 'P3') {
    return normalized;
  }

  return 'P2';
}

function normalizeBlocked(value: unknown): boolean {
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

function normalizeBlockerReason(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseMetadata(metadata: unknown): Record<string, unknown> | null {
  if (typeof metadata !== 'string' || !metadata.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(metadata) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeProject(value: unknown): string {
  if (typeof value !== 'string') {
    return 'General';
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : 'General';
}

function parseProjectNames(value: unknown): string[] {
  const rawNames =
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : typeof value === 'string'
        ? value.split(',')
        : [];

  const names: string[] = [];
  const seen = new Set<string>();
  for (const rawName of rawNames) {
    const trimmed = rawName.trim();
    const normalized = trimmed.toLowerCase();
    if (!trimmed || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    names.push(trimmed);
  }

  return names;
}

function normalizeTaskProject(value: unknown): TaskBoardProject | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!name) {
    return null;
  }

  const id = Number(record.id);
  return {
    id: Number.isInteger(id) && id > 0 ? id : undefined,
    name,
    color: typeof record.color === 'string' && record.color.trim() ? record.color.trim() : null,
    created_at: typeof record.created_at === 'string' ? toTimestamp(record.created_at) : null,
  };
}

function mergeTaskProjects(projects: TaskBoardProject[], fallbackNames: string[]): TaskBoardProject[] {
  if (fallbackNames.length === 0) {
    return projects;
  }

  const seen = new Set(projects.map((project) => project.name.trim().toLowerCase()));
  const nextProjects = [...projects];

  for (const fallbackName of fallbackNames) {
    const normalized = fallbackName.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    nextProjects.push({
      name: fallbackName,
      color: null,
    });
  }

  return nextProjects;
}

function normalizeTaskProjects(
  value: unknown,
  fallbackNames: string[] = []
): TaskBoardProject[] {
  const structuredProjects = Array.isArray(value)
    ? value.map(normalizeTaskProject).filter((project): project is TaskBoardProject => project !== null)
    : [];

  return mergeTaskProjects(structuredProjects, fallbackNames);
}

function buildProjectLabel(projects: readonly TaskBoardProject[], fallback: string): string {
  const names = projects.map((project) => project.name.trim()).filter(Boolean);
  return names.length > 0 ? names.join(', ') : normalizeProject(fallback);
}

function normalizeDueAt(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function resolveDueDateInput(payload: Pick<CreateTaskPayload, 'due_at' | 'due_date'>): string | null {
  if (typeof payload.due_date === 'string') {
    return payload.due_date;
  }

  if (typeof payload.due_at === 'string') {
    return payload.due_at;
  }

  return null;
}

function normalizeTaskActivity(value: unknown): TaskActivity[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries: TaskActivity[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const record = entry as Record<string, unknown>;
    entries.push({
      id: typeof record.id === 'number' || typeof record.id === 'string' ? record.id : undefined,
      agent_name: typeof record.agent_name === 'string' ? record.agent_name : null,
      user: typeof record.user === 'string' ? record.user : null,
      action: typeof record.action === 'string' ? record.action : null,
      details: typeof record.details === 'string' ? record.details : null,
      created_at: toTimestamp(record.created_at ?? record.timestamp),
    });
  }

  entries.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return entries.length > 0 ? entries : undefined;
}

function normalizeTask(raw: unknown): TaskBoardTask | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const row = raw as Record<string, unknown>;
  const id = Number(row.id);
  const name = typeof row.name === 'string' ? row.name.trim() : '';

  if (!Number.isInteger(id) || id === 0 || !name) {
    return null;
  }

  const metadata = typeof row.metadata === 'string' ? row.metadata : null;
  const metadataRecord = parseMetadata(metadata);

  const priority =
    row.priority ??
    row.task_priority ??
    metadataRecord?.priority ??
    metadataRecord?.task_priority;
  const project =
    row.project ??
    row.project_name ??
    row.team ??
    metadataRecord?.project ??
    metadataRecord?.project_name;
  const fallbackProjectNames = [
    ...parseProjectNames(metadataRecord?.project_names),
    ...parseProjectNames(project),
  ];
  const projects = normalizeTaskProjects(row.projects, fallbackProjectNames);
  const dueAt =
    row.due_at ??
    row.dueAt ??
    row.due_date ??
    row.deadline ??
    metadataRecord?.due_at ??
    metadataRecord?.due_date;
  const blocked =
    row.blocked ??
    metadataRecord?.blocked ??
    metadataRecord?.is_blocked;
  const blockerReason =
    row.blocker_reason ??
    row.blockerReason ??
    metadataRecord?.blocker_reason ??
    metadataRecord?.blockerReason;
  const model =
    row.model ??
    metadataRecord?.model;
  const archived =
    row.archived ??
    metadataRecord?.archived;
  const recurring =
    row.recurring ??
    metadataRecord?.recurring;
  const progressStatus =
    row.progress_status ??
    row.progressStatus ??
    metadataRecord?.progress_status;
  const activity = normalizeTaskActivity(row.activity ?? metadataRecord?.activity);
  const outputValue = typeof row.output === 'string'
    ? row.output
    : typeof metadataRecord?.output === 'string'
      ? metadataRecord.output
      : null;
  const outputLinksCount = outputValue ? (outputValue.match(/https?:\/\/\S+|\/(?:docs|task|tasks)\/\S+|\b(?:output|memory|workspace|projects|zora|spock|docs|notes)\/\S+|\/(?:Users|home)\/\S+/gi)?.length ?? 0) : 0;
  const parentTaskIdCandidate = Number(
    row.parent_task_id ?? row.parentTaskId ?? metadataRecord?.parent_task_id ?? metadataRecord?.parentTaskId
  );
  const parentTaskId = Number.isInteger(parentTaskIdCandidate) && parentTaskIdCandidate > 0 ? parentTaskIdCandidate : null;
  const subtaskCountCandidate = Number(row.subtask_count ?? row.subtaskCount ?? metadataRecord?.subtask_count);
  const subtaskDoneCountCandidate = Number(row.subtask_done_count ?? row.subtaskDoneCount ?? metadataRecord?.subtask_done_count);
  const projectIdCandidate = Number(row.project_id ?? row.projectId);

  return {
    id,
    org_id: normalizeOptionalString(row.org_id ?? row.orgId),
    team_id: normalizeOptionalString(row.team_id ?? row.teamId),
    project_id: Number.isInteger(projectIdCandidate) && projectIdCandidate > 0 ? projectIdCandidate : null,
    created_by_principal_id: normalizeOptionalString(row.created_by_principal_id ?? row.createdByPrincipalId),
    initiator_principal_id: normalizeOptionalString(row.initiator_principal_id ?? row.initiatorPrincipalId),
    initiator_type: normalizeOptionalString(row.initiator_type ?? row.initiatorType),
    owner_principal_id: normalizeOptionalString(row.owner_principal_id ?? row.ownerPrincipalId),
    owner_principal_type: normalizeOptionalString(row.owner_principal_type ?? row.ownerPrincipalType),
    executor_principal_id: normalizeOptionalString(row.executor_principal_id ?? row.executorPrincipalId),
    assignment_state: normalizeOptionalString(row.assignment_state ?? row.assignmentState),
    taskmaster_drivable: normalizeBlocked(row.taskmaster_drivable ?? row.taskmasterDrivable),
    name,
    description: typeof row.description === 'string' ? row.description : null,
    column: normalizeTaskColumn(row.column),
    assignee: typeof row.assignee === 'string' && row.assignee.trim() ? row.assignee.trim() : 'Unassigned',
    model: typeof model === 'string' ? model.trim() || null : null,
    archived: normalizeBlocked(archived),
    priority: normalizePriority(priority),
    project: buildProjectLabel(projects, typeof project === 'string' ? project : 'General'),
    projects,
    blocked: normalizeBlocked(blocked),
    blocker_reason: normalizeBlockerReason(blockerReason),
    due_at: normalizeDueAt(dueAt),
    recurring: normalizeBlocked(recurring),
    progress_status: typeof progressStatus === 'string' && progressStatus.trim() ? progressStatus.trim().toLowerCase() : null,
    activity,
    created_at: toTimestamp(row.created_at),
    updated_at: toTimestamp(row.updated_at ?? row.created_at),
    metadata,
    worktype: normalizeOptionalString(row.worktype ?? metadataRecord?.worktype),
    policy_inputs_json: typeof row.policy_inputs_json === 'string' ? row.policy_inputs_json : null,
    review_required: normalizeBlocked(row.review_required ?? row.reviewRequired ?? metadataRecord?.review_required),
    review_state: normalizeOptionalString(row.review_state ?? row.reviewState ?? metadataRecord?.review_state),
    human_gate_required: normalizeBlocked(row.human_gate_required ?? row.humanGateRequired ?? metadataRecord?.human_gate_required),
    human_gate_state: normalizeOptionalString(row.human_gate_state ?? row.humanGateState ?? metadataRecord?.human_gate_state),
    output: outputValue,
    output_links_count: outputLinksCount,
    parent_task_id: parentTaskId,
    subtask_count: Number.isFinite(subtaskCountCandidate) && subtaskCountCandidate > 0 ? Math.trunc(subtaskCountCandidate) : 0,
    subtask_done_count: Number.isFinite(subtaskDoneCountCandidate) && subtaskDoneCountCandidate > 0 ? Math.trunc(subtaskDoneCountCandidate) : 0,
  };
}

function extractTasks(payload: unknown): TaskBoardTask[] {
  if (Array.isArray(payload)) {
    return payload.map(normalizeTask).filter((task): task is TaskBoardTask => task !== null);
  }

  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.tasks)) {
      return record.tasks.map(normalizeTask).filter((task): task is TaskBoardTask => task !== null);
    }
  }

  return [];
}

function toTaskTimestamp(task: TaskBoardTask): number {
  const parsed = new Date(task.updated_at).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeTaskListsLastWriteWins(primary: TaskBoardTask[], secondary: TaskBoardTask[]): TaskBoardTask[] {
  const merged = new Map<number, TaskBoardTask>();

  for (const task of primary) {
    merged.set(task.id, task);
  }

  for (const task of secondary) {
    const current = merged.get(task.id);
    if (!current || toTaskTimestamp(task) >= toTaskTimestamp(current)) {
      merged.set(task.id, task);
    }
  }

  return Array.from(merged.values()).sort((left, right) => toTaskTimestamp(right) - toTaskTimestamp(left));
}

function extractPendingTaskDeletes(queueItems: Array<{ method: string; url: string }>): Set<number> {
  const pendingDeletes = new Set<number>();
  const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';

  for (const item of queueItems) {
    if (item.method.toUpperCase() !== 'DELETE') {
      continue;
    }

    try {
      const parsed = new URL(item.url, base);
      const normalizedPath = parsed.pathname.startsWith('/api/') ? parsed.pathname.slice(4) : parsed.pathname;
      const match = normalizedPath.match(/^\/tasks\/(-?\d+)(?:\/|$)/);
      if (!match) {
        continue;
      }

      const taskId = Number(match[1]);
      if (Number.isInteger(taskId) && taskId !== 0) {
        pendingDeletes.add(taskId);
      }
    } catch {
      continue;
    }
  }

  return pendingDeletes;
}

function buildOfflineQueuedTask(payload: CreateTaskPayload, queueId: number): TaskBoardTask {
  const now = new Date().toISOString();
  const dueDate = resolveDueDateInput(payload);
  const metadataRecord = parseMetadata(payload.metadata);
  const projectNames = [
    ...parseProjectNames(metadataRecord?.project_names),
    ...parseProjectNames(payload.project),
  ];
  const projects = projectNames.map((name, index) => {
    const projectId = payload.projectIds?.[index];
    return {
      id: typeof projectId === 'number' && Number.isInteger(projectId) && projectId > 0 ? projectId : undefined,
      name,
      color: null,
    };
  });

  return {
    id: -Math.abs(queueId),
    org_id: normalizeOptionalString(payload.org_id) ?? 'default-org',
    team_id: normalizeOptionalString(payload.team_id) ?? 'default-team',
    project_id: payload.project_id ?? payload.projectIds?.[0] ?? null,
    created_by_principal_id: normalizeOptionalString(payload.created_by_principal_id),
    initiator_principal_id: normalizeOptionalString(payload.initiator_principal_id) ?? 'legacy-unknown',
    initiator_type: normalizeOptionalString(payload.initiator_type) ?? 'unknown',
    owner_principal_id: normalizeOptionalString(payload.owner_principal_id) ?? 'legacy-owner',
    owner_principal_type: normalizeOptionalString(payload.owner_principal_type) ?? 'unknown',
    executor_principal_id: normalizeOptionalString(payload.executor_principal_id),
    assignment_state: normalizeOptionalString(payload.assignment_state),
    taskmaster_drivable: Boolean(payload.taskmaster_drivable),
    name: payload.name.trim() || 'Offline Task',
    description: typeof payload.description === 'string' ? payload.description : null,
    column: normalizeTaskColumn(payload.column ?? 'backlog'),
    assignee: typeof payload.assignee === 'string' && payload.assignee.trim() ? payload.assignee.trim() : 'Unassigned',
    model: typeof payload.model === 'string' && payload.model.trim() ? payload.model.trim() : null,
    archived: typeof payload.archived === 'boolean' ? payload.archived : false,
    priority: normalizePriority(payload.priority ?? 'P2'),
    project: buildProjectLabel(projects, payload.project ?? 'General'),
    projects,
    blocked: typeof payload.blocked === 'boolean' ? payload.blocked : false,
    blocker_reason: normalizeBlockerReason(payload.blocker_reason),
    due_at: normalizeDueAt(dueDate),
    recurring: typeof payload.recurring === 'boolean' ? payload.recurring : false,
    progress_status: null,
    activity: undefined,
    created_at: now,
    updated_at: now,
    metadata:
      payload.metadata ??
      JSON.stringify({
        priority: payload.priority,
        project: payload.project,
        project_ids: payload.projectIds,
        due_date: dueDate,
        due_at: dueDate,
        recurring: payload.recurring,
        worktype: payload.worktype,
      }),
    worktype: normalizeOptionalString(payload.worktype),
    policy_inputs_json: payload.policy_inputs_json ?? null,
    output: null,
    output_links_count: 0,
    parent_task_id: null,
    subtask_count: 0,
    subtask_done_count: 0,
  };
}

export function useTaskBoard({ apiBase = DEFAULT_API_BASE, autoLoad = true }: UseTaskBoardOptions = {}) {
  const tasks = useTaskBoardStore((state) => state.tasks);
  const loading = useTaskBoardStore((state) => state.loading);
  const error = useTaskBoardStore((state) => state.error);
  const initialized = useTaskBoardStore((state) => state.initialized);
  const setTasks = useTaskBoardStore((state) => state.setTasks);
  const upsertTask = useTaskBoardStore((state) => state.upsertTask);
  const removeTask = useTaskBoardStore((state) => state.removeTask);
  const setTaskColumn = useTaskBoardStore((state) => state.setTaskColumn);
  const setLoading = useTaskBoardStore((state) => state.setLoading);
  const setError = useTaskBoardStore((state) => state.setError);
  const setInitialized = useTaskBoardStore((state) => state.setInitialized);
  const lastWsUpdateRef = useRef<number>(0);

  const reloadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    const taskUrls = buildApiCandidates('/tasks', apiBase);

    try {
      const payload = await requestJsonWithFallback({
        urls: taskUrls,
        fallbackError: 'Unable to reach task endpoints.',
      });
      void cacheApiPayload(taskUrls[0] ?? '/api/tasks', payload);

      const normalized = extractTasks(payload);
      const queueItems = await readOfflineWriteQueueSnapshot().catch(() => []);
      const pendingTaskQueue = queueItems.filter((item) => {
        try {
          const parsed = new URL(item.url, window.location.origin);
          const normalizedPath = parsed.pathname.startsWith('/api/') ? parsed.pathname.slice(4) : parsed.pathname;
          return normalizedPath === '/tasks' || normalizedPath.startsWith('/tasks/');
        } catch {
          return false;
        }
      });

      let nextTasks = normalized;
      if (pendingTaskQueue.length > 0) {
        const cachedPayload = await readCachedApiPayload(taskUrls);
        const cachedTasks = extractTasks(cachedPayload);
        nextTasks = mergeTaskListsLastWriteWins(nextTasks, cachedTasks);
        const pendingDeletes = extractPendingTaskDeletes(pendingTaskQueue);
        if (pendingDeletes.size > 0) {
          nextTasks = nextTasks.filter((task) => !pendingDeletes.has(task.id));
        }
      }

      setTasks(nextTasks);
      setInitialized(true);
      return nextTasks;
    } catch (loadError) {
      const cachedPayload = await readCachedApiPayload(taskUrls);
      if (cachedPayload !== null) {
        const cachedTasks = extractTasks(cachedPayload);
        setTasks(cachedTasks);
        setInitialized(true);
        setError(null);
        return cachedTasks;
      }

      setError(toErrorMessage(loadError, 'Task request failed.'));
      return [];
    } finally {
      setLoading(false);
    }
  }, [apiBase, setError, setInitialized, setLoading, setTasks]);

  const createTask = useCallback(
    async (payload: CreateTaskPayload) => {
      const name = payload.name.trim();
      if (!name) {
        throw new Error('Task title is required.');
      }

      setError(null);
      const dueDate = resolveDueDateInput(payload);

      const createdPayload = await requestJsonWithFallback({
        urls: buildApiCandidates('/tasks', apiBase),
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Keep top-level fields plus metadata for API compatibility across MC versions.
          body: JSON.stringify({
            name,
            org_id: payload.org_id,
            team_id: payload.team_id,
            project_id: payload.project_id,
            created_by_principal_id: payload.created_by_principal_id,
            initiator_principal_id: payload.initiator_principal_id,
            initiator_type: payload.initiator_type,
            owner_principal_id: payload.owner_principal_id,
            owner_principal_type: payload.owner_principal_type,
            executor_principal_id: payload.executor_principal_id,
            assignment_state: payload.assignment_state,
            taskmaster_drivable: payload.taskmaster_drivable,
            description: payload.description,
            assignee: payload.assignee,
            column: payload.column,
            priority: payload.priority,
            project: payload.project,
            projectIds: payload.projectIds,
            blocked: payload.blocked,
            blocker_reason: payload.blocker_reason,
            due_date: dueDate,
            due_at: dueDate,
            recurring: payload.recurring,
            worktype: payload.worktype,
            policy_inputs_json: payload.policy_inputs_json,
            metadata:
              payload.metadata ??
              JSON.stringify({
                priority: payload.priority,
                project: payload.project,
                project_ids: payload.projectIds,
                due_date: dueDate,
                due_at: dueDate,
                recurring: payload.recurring,
                worktype: payload.worktype,
              }),
          }),
        },
        fallbackError: 'Unable to reach task endpoints.',
      });

      if (isOfflineQueuedResponsePayload(createdPayload)) {
        const optimisticTask = buildOfflineQueuedTask(payload, createdPayload.queueId);
        upsertTask(optimisticTask);
        return optimisticTask;
      }

      const createdTask = normalizeTask(createdPayload);
      if (!createdTask) {
        throw new Error('Failed to create task from server response.');
      }

      upsertTask(createdTask);
      return createdTask;
    },
    [apiBase, setError, upsertTask]
  );

  const updateTask = useCallback(
    async (taskId: number, payload: Omit<CreateTaskPayload, 'name'> & { name?: string }) => {
      setError(null);
      const dueDate = resolveDueDateInput(payload);

      const updatedPayload = await requestJsonWithFallback({
        urls: buildApiCandidates(`/tasks/${taskId}`, apiBase),
        init: {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            due_date: dueDate,
            due_at: dueDate,
            user: readUserProfile().displayName,
          }),
        },
        fallbackError: 'Unable to reach task endpoints.',
      });

      if (isOfflineQueuedResponsePayload(updatedPayload)) {
        const now = new Date().toISOString();
        const existing = useTaskBoardStore.getState().tasks.find((task) => task.id === taskId) ?? null;
        const metadataRecord = parseMetadata(payload.metadata);
        const projectNames = [
          ...parseProjectNames(metadataRecord?.project_names),
          ...parseProjectNames(payload.project),
        ];
        const projects = projectNames.length > 0
          ? projectNames.map((name, index) => {
              const projectId = payload.projectIds?.[index];
              return {
                id: typeof projectId === 'number' && Number.isInteger(projectId) && projectId > 0 ? projectId : undefined,
                name,
                color: null,
              };
            })
          : existing?.projects ?? [];
        const optimisticTask: TaskBoardTask = {
          id: taskId,
          org_id: existing?.org_id ?? normalizeOptionalString(payload.org_id) ?? 'default-org',
          team_id: existing?.team_id ?? normalizeOptionalString(payload.team_id) ?? 'default-team',
          project_id: payload.project_id ?? existing?.project_id ?? payload.projectIds?.[0] ?? null,
          created_by_principal_id:
            normalizeOptionalString(payload.created_by_principal_id) ?? existing?.created_by_principal_id ?? null,
          initiator_principal_id:
            normalizeOptionalString(payload.initiator_principal_id) ?? existing?.initiator_principal_id ?? 'legacy-unknown',
          initiator_type: normalizeOptionalString(payload.initiator_type) ?? existing?.initiator_type ?? 'unknown',
          owner_principal_id:
            normalizeOptionalString(payload.owner_principal_id) ?? existing?.owner_principal_id ?? 'legacy-owner',
          owner_principal_type:
            normalizeOptionalString(payload.owner_principal_type) ?? existing?.owner_principal_type ?? 'unknown',
          executor_principal_id:
            normalizeOptionalString(payload.executor_principal_id) ?? existing?.executor_principal_id ?? null,
          assignment_state: normalizeOptionalString(payload.assignment_state) ?? existing?.assignment_state ?? null,
          taskmaster_drivable:
            typeof payload.taskmaster_drivable === 'boolean'
              ? payload.taskmaster_drivable
              : existing?.taskmaster_drivable ?? false,
          name: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : existing?.name ?? `Task #${taskId}`,
          description: Object.prototype.hasOwnProperty.call(payload, 'description')
            ? typeof payload.description === 'string'
              ? payload.description
              : null
            : existing?.description ?? null,
          column: payload.column ? normalizeTaskColumn(payload.column) : existing?.column ?? 'backlog',
          assignee:
            typeof payload.assignee === 'string' && payload.assignee.trim()
              ? payload.assignee.trim()
              : existing?.assignee ?? 'Unassigned',
          model:
            typeof payload.model === 'string'
              ? payload.model.trim() || null
              : existing?.model ?? null,
          archived:
            typeof payload.archived === 'boolean'
              ? payload.archived
              : existing?.archived ?? false,
          priority: payload.priority ? normalizePriority(payload.priority) : existing?.priority ?? 'P2',
          project: buildProjectLabel(projects, payload.project ?? existing?.project ?? 'General'),
          projects,
          blocked:
            typeof payload.blocked === 'boolean'
              ? payload.blocked
              : existing?.blocked ?? false,
          blocker_reason: Object.prototype.hasOwnProperty.call(payload, 'blocker_reason')
            ? normalizeBlockerReason(payload.blocker_reason)
            : existing?.blocker_reason ?? null,
          due_at:
            Object.prototype.hasOwnProperty.call(payload, 'due_at') ||
            Object.prototype.hasOwnProperty.call(payload, 'due_date')
            ? normalizeDueAt(dueDate)
            : existing?.due_at ?? null,
          recurring: Object.prototype.hasOwnProperty.call(payload, 'recurring')
            ? Boolean(payload.recurring)
            : existing?.recurring ?? false,
          progress_status: existing?.progress_status ?? null,
          activity: existing?.activity,
          created_at: existing?.created_at ?? now,
          updated_at: now,
          metadata:
            typeof payload.metadata === 'string'
              ? payload.metadata
              : existing?.metadata ?? null,
          worktype: normalizeOptionalString(payload.worktype) ?? existing?.worktype ?? null,
          policy_inputs_json: payload.policy_inputs_json ?? existing?.policy_inputs_json ?? null,
          output: existing?.output ?? null,
          output_links_count: existing?.output_links_count ?? 0,
          parent_task_id: existing?.parent_task_id ?? null,
          subtask_count: existing?.subtask_count ?? 0,
          subtask_done_count: existing?.subtask_done_count ?? 0,
        };

        upsertTask(optimisticTask);
        return optimisticTask;
      }

      const updatedTask = normalizeTask(updatedPayload);
      if (!updatedTask) {
        throw new Error('Failed to update task from server response.');
      }

      upsertTask(updatedTask);
      return updatedTask;
    },
    [apiBase, setError, upsertTask]
  );

  const moveTask = useCallback(
    async (taskId: number, column: TaskColumn) => {
      const snapshot = useTaskBoardStore.getState().tasks;
      setTaskColumn(taskId, column);

      try {
        const movedPayload = await requestJsonWithFallback({
          urls: buildApiCandidates(`/tasks/${taskId}/move`, apiBase),
          init: {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ column, user: readUserProfile().displayName }),
          },
          fallbackError: 'Unable to reach task endpoints.',
        });

        if (isOfflineQueuedResponsePayload(movedPayload)) {
          const optimisticTask = useTaskBoardStore.getState().tasks.find((task) => task.id === taskId);
          if (optimisticTask) {
            return optimisticTask;
          }

          const now = new Date().toISOString();
          return {
            id: taskId,
            org_id: null,
            team_id: null,
            project_id: null,
            created_by_principal_id: null,
            initiator_principal_id: 'legacy-unknown',
            initiator_type: 'unknown',
            owner_principal_id: 'legacy-owner',
            owner_principal_type: 'unknown',
            executor_principal_id: null,
            assignment_state: null,
            taskmaster_drivable: false,
            name: `Task #${taskId}`,
            description: null,
            column,
            assignee: 'Unassigned',
            model: null,
            archived: false,
            priority: 'P2',
            project: 'General',
            projects: [],
            blocked: false,
            blocker_reason: null,
            due_at: null,
            recurring: false,
            progress_status: null,
            activity: undefined,
            created_at: now,
            updated_at: now,
            metadata: null,
            worktype: null,
            policy_inputs_json: null,
            output: null,
            output_links_count: 0,
            parent_task_id: null,
            subtask_count: 0,
            subtask_done_count: 0,
          };
        }

        const movedTask = normalizeTask(movedPayload);
        if (!movedTask) {
          throw new Error('Failed to move task from server response.');
        }

        upsertTask(movedTask);
        return movedTask;
      } catch (moveError) {
        setTasks(snapshot);
        setError(toErrorMessage(moveError, 'Task request failed.'));
        throw moveError;
      }
    },
    [apiBase, setError, setTaskColumn, setTasks, upsertTask]
  );

  const deleteTask = useCallback(
    async (taskId: number) => {
      setError(null);
      const snapshot = useTaskBoardStore.getState().tasks;
      removeTask(taskId);

      try {
        const deletedPayload = await requestJsonWithFallback({
          urls: buildApiCandidates(`/tasks/${taskId}`, apiBase),
          init: {
            method: 'DELETE',
          },
          continueOnStatuses: [],
          fallbackError: 'Unable to reach task endpoints.',
        }).catch((error) => {
          const message = toErrorMessage(error, '');
          if (message.includes('404')) {
            return null;
          }
          throw error;
        });

        if (isOfflineQueuedResponsePayload(deletedPayload)) {
          return true;
        }

        removeTask(taskId);
        return true;
      } catch (deleteError) {
        setTasks(snapshot);
        setError(toErrorMessage(deleteError, 'Task request failed.'));
        throw deleteError;
      }
    },
    [apiBase, removeTask, setError, setTasks]
  );

  useEffect(() => {
    if (!autoLoad || initialized) {
      return;
    }

    void reloadTasks();
  }, [autoLoad, initialized, reloadTasks]);

  useEffect(() => {
    if (!autoLoad) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (Date.now() - lastWsUpdateRef.current < TASK_WS_RECENT_UPDATE_WINDOW_MS) {
        return;
      }

      void reloadTasks();
    }, TASK_RELOAD_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [autoLoad, reloadTasks]);

  useEntityWebSocket(
    (rawMessage) => {
      const message = rawMessage as TaskBoardWsMessage;
      switch (message.type) {
        case 'task:updated':
        case 'task:created': {
          lastWsUpdateRef.current = Date.now();
          const normalizedTask = normalizeTask(message.task);
          if (normalizedTask) {
            upsertTask(normalizedTask);
          }
          break;
        }
        case 'task:deleted': {
          lastWsUpdateRef.current = Date.now();
          const taskId = Number(message.taskId ?? message.id);
          if (Number.isInteger(taskId) && taskId !== 0) {
            removeTask(taskId);
          }
          break;
        }
        default:
          break;
      }
    },
    { enabled: autoLoad, reconnectDelayMs: TASK_WS_RECONNECT_DELAY_MS },
  );

  useEffect(() => {
    if (!autoLoad) {
      return;
    }

    const handleQueueDrained = () => {
      void reloadTasks();
    };

    const handleOnline = () => {
      void reloadTasks();
    };

    window.addEventListener(OFFLINE_QUEUE_DRAINED_EVENT, handleQueueDrained);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener(OFFLINE_QUEUE_DRAINED_EVENT, handleQueueDrained);
      window.removeEventListener('online', handleOnline);
    };
  }, [autoLoad, reloadTasks]);

  return {
    tasks,
    loading,
    error,
    columns: TASK_COLUMNS,
    reloadTasks,
    createTask,
    updateTask,
    moveTask,
    deleteTask,
  };
}
