import type {
  MCViewport,
} from '../components/TaskBoard.tsx';
import type {
  TaskBoardProject,
  TaskBoardTask,
  TaskColumn,
  TaskPriority,
} from '../hooks/useTaskBoard.ts';
import { buildApiCandidates, requestJsonWithFallback, toErrorMessage } from './http.ts';

const ENGINEERING_WORK_DOMAIN = 'engineering';
const TASK_PAGE_LIMIT = 2_000;
const TASK_COLUMNS = new Set<TaskColumn>(['backlog', 'todo', 'doing', 'review', 'done']);
const TASK_PRIORITIES = new Set<TaskPriority>(['P0', 'P1', 'P2', 'P3']);

interface TaskPageMeta {
  count: number;
  hasMore: boolean;
}

interface EngineeringTaskRequestOptions {
  urls: string[];
  fallbackError?: string;
}

type EngineeringTaskRequest = (options: EngineeringTaskRequestOptions) => Promise<unknown>;

interface LoadEngineeringTasksOptions {
  apiBase?: string;
  request?: EngineeringTaskRequest;
}

export function buildEngineeringTaskCandidates(apiBase = ''): string[] {
  return buildApiCandidates(`/tasks?work_domain=${ENGINEERING_WORK_DOMAIN}`, apiBase);
}

export function isEngineeringViewportMatch(viewport: MCViewport, width: number): boolean {
  if (viewport === 'desktop') {
    return width >= 1_024;
  }
  if (viewport === 'tablet') {
    return width >= 768 && width < 1_024;
  }
  return width < 768;
}

export function resolveEngineeringHighlightTaskId(
  tasks: readonly TaskBoardTask[],
  highlightTaskId: number | null,
): number | null {
  return highlightTaskId !== null && tasks.some((task) => task.id === highlightTaskId)
    ? highlightTaskId
    : null;
}

function appendPageQuery(url: string, offset: number): string {
  return `${url}&limit=${TASK_PAGE_LIMIT}&offset=${offset}`;
}

function readTaskPageMeta(payload: unknown): TaskPageMeta | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.tasks) || typeof record.hasMore !== 'boolean') {
    return null;
  }

  const reportedCount = Number(record.count);
  return {
    count:
      Number.isInteger(reportedCount) && reportedCount >= 0
        ? reportedCount
        : record.tasks.length,
    hasMore: record.hasMore,
  };
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function timestamp(value: unknown): string {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

function normalizeProjects(value: unknown): TaskBoardProject[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const name = optionalString(record.name);
    if (!name) {
      return [];
    }
    const id = Number(record.id);
    return [{
      id: Number.isInteger(id) && id > 0 ? id : undefined,
      name,
      color: optionalString(record.color),
      created_at: optionalString(record.created_at),
    }];
  });
}

function normalizeEngineeringTask(raw: unknown): TaskBoardTask | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const row = raw as Record<string, unknown>;
  if (
    row.work_domain !== ENGINEERING_WORK_DOMAIN ||
    row.work_domain_state !== 'resolved'
  ) {
    return null;
  }

  const id = Number(row.id);
  const name = optionalString(row.name);
  if (!Number.isInteger(id) || id <= 0 || !name) {
    return null;
  }

  const rawColumn = optionalString(row.column)?.toLowerCase() as TaskColumn | undefined;
  const column = rawColumn && TASK_COLUMNS.has(rawColumn) ? rawColumn : 'backlog';
  const rawPriority = optionalString(row.priority)?.toUpperCase() as TaskPriority | undefined;
  const priority = rawPriority && TASK_PRIORITIES.has(rawPriority) ? rawPriority : 'P2';
  const projects = normalizeProjects(row.projects);
  const projectId = Number(row.project_id);
  const createdAt = timestamp(row.created_at);
  const output = typeof row.output === 'string' ? row.output : null;
  const subtaskCount = Number(row.subtask_count);
  const subtaskDoneCount = Number(row.subtask_done_count);
  const parentTaskId = Number(row.parent_task_id);

  return {
    id,
    org_id: optionalString(row.org_id),
    team_id: optionalString(row.team_id),
    project_id: Number.isInteger(projectId) && projectId > 0 ? projectId : null,
    created_by_principal_id: optionalString(row.created_by_principal_id),
    initiator_principal_id: optionalString(row.initiator_principal_id),
    initiator_type: optionalString(row.initiator_type),
    owner_principal_id: optionalString(row.owner_principal_id),
    owner_principal_type: optionalString(row.owner_principal_type),
    executor_principal_id: optionalString(row.executor_principal_id),
    assignment_state: optionalString(row.assignment_state),
    taskmaster_drivable: row.taskmaster_drivable === true || row.taskmaster_drivable === 1,
    name,
    description: typeof row.description === 'string' ? row.description : null,
    column,
    assignee: optionalString(row.assignee) ?? 'Unassigned',
    model: optionalString(row.model),
    archived: row.archived === true || row.archived === 1,
    priority,
    project:
      optionalString(row.project) ??
      (projects.map((project) => project.name).join(', ') || 'General'),
    projects,
    blocked: row.blocked === true || row.blocked === 1,
    blocker_reason: optionalString(row.blocker_reason),
    due_at: optionalString(row.due_at ?? row.due_date),
    recurring: row.recurring === true || row.recurring === 1,
    progress_status: optionalString(row.progress_status),
    created_at: createdAt,
    updated_at: timestamp(row.updated_at ?? row.created_at),
    metadata: typeof row.metadata === 'string' ? row.metadata : null,
    worktype: optionalString(row.worktype),
    work_domain: ENGINEERING_WORK_DOMAIN,
    work_domain_state: 'resolved',
    policy_inputs_json:
      typeof row.policy_inputs_json === 'string' ? row.policy_inputs_json : null,
    review_required: row.review_required === true || row.review_required === 1,
    review_state: optionalString(row.review_state),
    human_gate_required:
      row.human_gate_required === true || row.human_gate_required === 1,
    human_gate_state: optionalString(row.human_gate_state),
    output,
    output_links_count:
      output?.match(/https?:\/\/\S+|\/(?:docs|task|tasks)\/\S+/gi)?.length ?? 0,
    parent_task_id:
      Number.isInteger(parentTaskId) && parentTaskId > 0 ? parentTaskId : null,
    subtask_count:
      Number.isFinite(subtaskCount) && subtaskCount > 0 ? Math.trunc(subtaskCount) : 0,
    subtask_done_count:
      Number.isFinite(subtaskDoneCount) && subtaskDoneCount > 0
        ? Math.trunc(subtaskDoneCount)
        : 0,
  };
}

export function filterEngineeringTaskPayload(payload: unknown): TaskBoardTask[] {
  const rawTasks = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { tasks?: unknown }).tasks)
      ? (payload as { tasks: unknown[] }).tasks
      : [];

  return rawTasks
    .map(normalizeEngineeringTask)
    .filter((task): task is TaskBoardTask => task !== null);
}

export async function loadEngineeringTasks({
  apiBase = '',
  request = requestJsonWithFallback,
}: LoadEngineeringTasksOptions = {}): Promise<TaskBoardTask[]> {
  const candidates = buildEngineeringTaskCandidates(apiBase);
  const tasks: TaskBoardTask[] = [];
  let offset = 0;

  for (;;) {
    const payload = await request({
      urls: candidates.map((url) => appendPageQuery(url, offset)),
      fallbackError: 'Unable to reach Engineering task endpoints.',
    });
    tasks.push(...filterEngineeringTaskPayload(payload));

    const pageMeta = readTaskPageMeta(payload);
    if (!pageMeta?.hasMore) {
      return tasks;
    }

    const rawPageLength =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? ((payload as { tasks?: unknown[] }).tasks?.length ?? 0)
        : 0;
    const nextOffset = offset + (pageMeta.count > 0 ? pageMeta.count : rawPageLength);
    if (nextOffset <= offset) {
      return tasks;
    }
    offset = nextOffset;
  }
}

export function toEngineeringLoadError(error: unknown): string {
  return `Engineering board could not load: ${toErrorMessage(error, 'Task request failed.')}`;
}
