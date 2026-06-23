import {
  TASK_COLUMNS,
  type CreateTaskInput,
  type ProjectRecord,
  type TaskColumn,
  type TaskRecord,
  type UpdateTaskInput,
} from './index';
import type { TaskAdapter } from './task-sync';

type FetchImplementation = (input: string, init?: RequestInit) => Promise<Response>;

interface RequestResult {
  payload: unknown;
  notFound: boolean;
}

export interface CloudTaskAdapterOptions {
  baseUrl: string;
  fetchImpl?: FetchImplementation;
  headers?: Record<string, string>;
}

function normalizeTaskColumn(value: unknown): TaskColumn {
  if (typeof value !== 'string') {
    return 'backlog';
  }

  const lowered = value.toLowerCase();
  return (TASK_COLUMNS as readonly string[]).includes(lowered) ? (lowered as TaskColumn) : 'backlog';
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

function normalizeNullableNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
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

function normalizeProjectRecord(raw: unknown): ProjectRecord | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const row = raw as Record<string, unknown>;
  const id = Number(row.id);
  const name = typeof row.name === 'string' ? row.name.trim() : '';

  if (!Number.isInteger(id) || id <= 0 || !name) {
    return null;
  }

  return {
    id,
    org_id: typeof row.org_id === 'string' && row.org_id.trim() ? row.org_id.trim() : undefined,
    team_id: typeof row.team_id === 'string' && row.team_id.trim() ? row.team_id.trim() : undefined,
    name,
    color: typeof row.color === 'string' && row.color.trim() ? row.color.trim() : null,
    created_at: normalizeTimestamp(row.created_at),
  };
}

function normalizeTaskProjects(value: unknown): ProjectRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeProjectRecord).filter((project): project is ProjectRecord => project !== null);
}

function normalizeTaskRecord(raw: unknown): TaskRecord | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const row = raw as Record<string, unknown>;
  const id = Number(row.id);
  const name = typeof row.name === 'string' ? row.name.trim() : '';

  if (!Number.isInteger(id) || id <= 0 || !name) {
    return null;
  }

  return {
    id,
    org_id: typeof row.org_id === 'string' && row.org_id.trim() ? row.org_id.trim() : undefined,
    team_id: typeof row.team_id === 'string' && row.team_id.trim() ? row.team_id.trim() : undefined,
    project_id: Number.isInteger(Number(row.project_id)) && Number(row.project_id) > 0 ? Number(row.project_id) : null,
    created_by_principal_id:
      typeof row.created_by_principal_id === 'string' && row.created_by_principal_id.trim()
        ? row.created_by_principal_id.trim()
        : 'legacy-system',
    initiator_principal_id:
      typeof row.initiator_principal_id === 'string' && row.initiator_principal_id.trim()
        ? row.initiator_principal_id.trim()
        : 'legacy-unknown',
    initiator_type:
      typeof row.initiator_type === 'string' && row.initiator_type.trim() ? row.initiator_type.trim() : 'unknown',
    owner_principal_id:
      typeof row.owner_principal_id === 'string' && row.owner_principal_id.trim()
        ? row.owner_principal_id.trim()
        : 'legacy-owner',
    owner_principal_type:
      typeof row.owner_principal_type === 'string' && row.owner_principal_type.trim()
        ? row.owner_principal_type.trim()
        : 'unknown',
    executor_principal_id:
      typeof row.executor_principal_id === 'string' && row.executor_principal_id.trim()
        ? row.executor_principal_id.trim()
        : null,
    assignment_state:
      typeof row.assignment_state === 'string' && row.assignment_state.trim() ? row.assignment_state.trim() : 'unassigned',
    taskmaster_drivable:
      typeof row.taskmaster_drivable === 'boolean'
        ? row.taskmaster_drivable
        : typeof row.taskmaster_drivable === 'number'
          ? row.taskmaster_drivable !== 0
          : typeof row.taskmaster_drivable === 'string'
            ? row.taskmaster_drivable.trim().toLowerCase() === '1' ||
              row.taskmaster_drivable.trim().toLowerCase() === 'true'
            : false,
    name,
    description: typeof row.description === 'string' ? row.description : null,
    brief: typeof row.brief === 'string' ? row.brief : null,
    origin_channel:
      typeof row.origin_channel === 'string'
        ? row.origin_channel
        : typeof row.originChannel === 'string'
          ? row.originChannel
          : null,
    column: normalizeTaskColumn(row.column),
    assignee: typeof row.assignee === 'string' && row.assignee.trim() ? row.assignee : 'Unassigned',
    blocked:
      typeof row.blocked === 'boolean'
        ? row.blocked
        : typeof row.blocked === 'number'
          ? row.blocked !== 0
          : typeof row.blocked === 'string'
            ? row.blocked.trim().toLowerCase() === '1' || row.blocked.trim().toLowerCase() === 'true'
            : false,
    blocker_reason:
      typeof row.blocker_reason === 'string' && row.blocker_reason.trim()
        ? row.blocker_reason.trim()
        : typeof row.blockerReason === 'string' && row.blockerReason.trim()
          ? row.blockerReason.trim()
        : null,
    project:
      typeof row.project === 'string' && row.project.trim()
        ? row.project.trim()
        : typeof row.project_name === 'string' && row.project_name.trim()
          ? row.project_name.trim()
          : 'General',
    projects: normalizeTaskProjects(row.projects),
    due_date:
      typeof row.due_date === 'string' && row.due_date.trim()
        ? row.due_date.trim()
        : typeof row.dueDate === 'string' && row.dueDate.trim()
          ? row.dueDate.trim()
          : null,
    priority:
      typeof row.priority === 'string' && row.priority.trim()
        ? row.priority.trim()
        : typeof row.priorityLevel === 'string' && row.priorityLevel.trim()
          ? row.priorityLevel.trim()
          : null,
    estimate_hours: normalizeNullableNumber(
      typeof row.estimate_hours !== 'undefined' ? row.estimate_hours : row.estimateHours
    ),
    time_spent: normalizeNullableNumber(typeof row.time_spent !== 'undefined' ? row.time_spent : row.timeSpent),
    output: typeof row.output === 'string' ? row.output : null,
    progress_status:
      typeof row.progress_status === 'string'
        ? row.progress_status
        : typeof row.progressStatus === 'string'
          ? row.progressStatus
          : null,
    recurring:
      typeof row.recurring === 'boolean'
        ? row.recurring
        : typeof row.recurring === 'number'
          ? row.recurring !== 0
          : typeof row.recurring === 'string'
            ? row.recurring.trim().toLowerCase() === '1' || row.recurring.trim().toLowerCase() === 'true'
            : false,
    recurring_config:
      typeof row.recurring_config === 'string'
        ? row.recurring_config
        : typeof row.recurringConfig === 'string'
          ? row.recurringConfig
          : null,
    model: typeof row.model === 'string' ? row.model : null,
    archived:
      typeof row.archived === 'boolean'
        ? row.archived
        : typeof row.archived === 'number'
          ? row.archived !== 0
          : typeof row.archived === 'string'
            ? row.archived.trim().toLowerCase() === '1' || row.archived.trim().toLowerCase() === 'true'
            : false,
    created_at: normalizeTimestamp(row.created_at),
    updated_at: normalizeTimestamp(row.updated_at ?? row.created_at),
    metadata: typeof row.metadata === 'string' ? row.metadata : null,
  };
}

function toTaskList(payload: unknown): TaskRecord[] {
  if (Array.isArray(payload)) {
    return payload.map(normalizeTaskRecord).filter((task): task is TaskRecord => task !== null);
  }

  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.tasks)) {
      return record.tasks.map(normalizeTaskRecord).filter((task): task is TaskRecord => task !== null);
    }
  }

  return [];
}

function toSingleTask(payload: unknown): TaskRecord | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const direct = normalizeTaskRecord(payload);
  if (direct) {
    return direct;
  }

  const record = payload as Record<string, unknown>;
  if (record.task && typeof record.task === 'object') {
    return normalizeTaskRecord(record.task);
  }

  return null;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('Cloud adapter received invalid JSON.');
  }
}

function extractErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (typeof record.error === 'string' && record.error.trim()) {
      return record.error.trim();
    }
  }

  return `Cloud request failed with status ${status}.`;
}

function sanitizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function buildTaskUrls(baseUrl: string, endpoint: string): string[] {
  return [`${baseUrl}/api${endpoint}`, `${baseUrl}${endpoint}`];
}

async function requestTaskApi(
  baseUrl: string,
  fetchImpl: FetchImplementation,
  endpoint: string,
  init: RequestInit | undefined,
  headers: Record<string, string>,
  allowNotFound = false
): Promise<RequestResult> {
  const urls = buildTaskUrls(baseUrl, endpoint);
  let lastError: Error | null = null;

  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index];

    try {
      const response = await fetchImpl(url, {
        ...init,
        headers: {
          ...headers,
          ...(init?.headers ?? {}),
        },
      });

      const payload = await readJson(response);
      if (response.status === 404 && index < urls.length - 1) {
        continue;
      }

      if (response.status === 404 && allowNotFound) {
        return { payload: null, notFound: true };
      }

      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, response.status));
      }

      return { payload, notFound: false };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Cloud request failed.');
    }
  }

  if (allowNotFound) {
    return { payload: null, notFound: true };
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error('Cloud request failed.');
}

export function createCloudTaskAdapter(options: CloudTaskAdapterOptions): TaskAdapter {
  const baseUrl = sanitizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseHeaders = options.headers ?? {};

  async function listTasks(): Promise<TaskRecord[]> {
    const { payload } = await requestTaskApi(baseUrl, fetchImpl, '/tasks', undefined, baseHeaders);
    return toTaskList(payload);
  }

  async function getTask(id: number): Promise<TaskRecord | undefined> {
    const { payload, notFound } = await requestTaskApi(
      baseUrl,
      fetchImpl,
      `/tasks/${id}`,
      undefined,
      baseHeaders,
      true
    );
    if (notFound) {
      return undefined;
    }

    return toSingleTask(payload) ?? undefined;
  }

  async function createTask(input: CreateTaskInput): Promise<TaskRecord> {
    const { payload } = await requestTaskApi(
      baseUrl,
      fetchImpl,
      '/tasks',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      {
        'Content-Type': 'application/json',
        ...baseHeaders,
      }
    );

    const task = toSingleTask(payload);
    if (!task) {
      throw new Error('Cloud createTask returned an invalid task payload.');
    }

    return task;
  }

  async function updateTask(id: number, updates: UpdateTaskInput): Promise<TaskRecord | undefined> {
    const { payload, notFound } = await requestTaskApi(
      baseUrl,
      fetchImpl,
      `/tasks/${id}`,
      {
        method: 'PUT',
        body: JSON.stringify(updates),
      },
      {
        'Content-Type': 'application/json',
        ...baseHeaders,
      },
      true
    );

    if (notFound) {
      return undefined;
    }

    return toSingleTask(payload) ?? undefined;
  }

  async function moveTask(id: number, nextColumn: string): Promise<TaskRecord | undefined> {
    const { payload, notFound } = await requestTaskApi(
      baseUrl,
      fetchImpl,
      `/tasks/${id}/move`,
      {
        method: 'PUT',
        body: JSON.stringify({ column: nextColumn }),
      },
      {
        'Content-Type': 'application/json',
        ...baseHeaders,
      },
      true
    );

    if (notFound) {
      return undefined;
    }

    return toSingleTask(payload) ?? undefined;
  }

  async function deleteTask(id: number): Promise<boolean> {
    const { notFound } = await requestTaskApi(
      baseUrl,
      fetchImpl,
      `/tasks/${id}`,
      {
        method: 'DELETE',
      },
      baseHeaders,
      true
    );

    return !notFound;
  }

  return {
    mode: 'CLOUD',
    listTasks,
    getTask,
    createTask,
    updateTask,
    moveTask,
    deleteTask,
  };
}
