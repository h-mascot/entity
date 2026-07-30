export interface NamedTaskProject {
  id: number;
  name: string | null;
  org_id?: string;
  team_id?: string;
  work_domain?: string | null;
}

interface TaskProjectSummary {
  org_id?: string;
  team_id?: string;
  project_id?: number | null;
  project?: string | null;
  projects?: readonly NamedTaskProject[] | null;
}

export type TaskWorkDomainState =
  | 'resolved'
  | 'unclassified_project'
  | 'missing_primary_project'
  | 'invalid_primary_project';

export interface TaskWorkDomain {
  work_domain: string | null;
  work_domain_state: TaskWorkDomainState;
}

interface TaskProjectSyncOptions {
  addTaskProject: (taskId: number, projectId: number) => boolean;
  removeTaskProject: (taskId: number, projectId: number) => boolean;
}

export interface TaskProjectDiff {
  toAdd: number[];
  toRemove: number[];
}

export function diffTaskProjectIds(currentIds: readonly number[], nextIds: readonly number[]): TaskProjectDiff {
  const current = new Set(currentIds);
  const next = new Set(nextIds);

  return {
    toAdd: nextIds.filter((projectId) => !current.has(projectId)),
    toRemove: currentIds.filter((projectId) => !next.has(projectId)),
  };
}

export function parseTaskProjectNames(value: string | null | undefined): string[] {
  if (typeof value !== 'string') {
    return [];
  }

  const names: string[] = [];
  const seen = new Set<string>();

  for (const entry of value.split(',')) {
    const trimmed = entry.trim();
    const normalized = trimmed.toLowerCase();
    if (!trimmed || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    names.push(trimmed);
  }

  return names;
}

export function buildTaskProjectLabel(
  projectIds: readonly number[],
  projects: readonly NamedTaskProject[],
  fallback = 'General'
): string {
  const namesById = new Map<number, string>();

  for (const project of projects) {
    const name = typeof project.name === 'string' ? project.name.trim() : '';
    if (project.id > 0 && name) {
      namesById.set(project.id, name);
    }
  }

  const names: string[] = [];
  const seen = new Set<string>();
  for (const projectId of projectIds) {
    const name = namesById.get(projectId);
    if (!name || seen.has(name)) {
      continue;
    }

    seen.add(name);
    names.push(name);
  }

  return names.length > 0 ? names.join(', ') : fallback;
}

export function taskHasProjectName(task: TaskProjectSummary, projectName: string): boolean {
  const normalizedTarget = projectName.trim().toLowerCase();
  if (!normalizedTarget) {
    return false;
  }

  const structuredProjectNames = (task.projects ?? [])
    .map((project) => (typeof project.name === 'string' ? project.name.trim() : ''))
    .filter(Boolean);

  const candidateNames = structuredProjectNames.length > 0
    ? structuredProjectNames
    : parseTaskProjectNames(task.project);

  return candidateNames.some((candidateName) => candidateName.toLowerCase() === normalizedTarget);
}

export function deriveTaskWorkDomain(task: TaskProjectSummary): TaskWorkDomain {
  if (!Number.isInteger(task.project_id) || Number(task.project_id) <= 0) {
    return {
      work_domain: null,
      work_domain_state: 'missing_primary_project',
    };
  }

  const primaryProject = (task.projects ?? []).find((project) => {
    if (project.id !== task.project_id) {
      return false;
    }
    if (task.org_id && project.org_id && project.org_id !== task.org_id) {
      return false;
    }
    if (task.team_id && project.team_id && project.team_id !== task.team_id) {
      return false;
    }
    return true;
  });

  if (!primaryProject) {
    return {
      work_domain: null,
      work_domain_state: 'invalid_primary_project',
    };
  }

  const workDomain =
    typeof primaryProject.work_domain === 'string' &&
    primaryProject.work_domain.length <= 64 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(primaryProject.work_domain)
      ? primaryProject.work_domain
      : null;

  return {
    work_domain: workDomain,
    work_domain_state: workDomain ? 'resolved' : 'unclassified_project',
  };
}

export function syncTaskProjectAssignments(
  taskId: number,
  currentIds: readonly number[],
  nextIds: readonly number[],
  options: TaskProjectSyncOptions
): TaskProjectDiff {
  const diff = diffTaskProjectIds(currentIds, nextIds);

  for (const projectId of diff.toRemove) {
    options.removeTaskProject(taskId, projectId);
  }

  for (const projectId of diff.toAdd) {
    options.addTaskProject(taskId, projectId);
  }

  return diff;
}
