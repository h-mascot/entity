export interface NamedTaskProject {
  id: number;
  name: string | null;
}

interface TaskProjectSummary {
  project?: string | null;
  projects?: readonly NamedTaskProject[] | null;
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
