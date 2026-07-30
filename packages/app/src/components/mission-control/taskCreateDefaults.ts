import type { ProjectOption } from './projectOptions.ts';

export type TaskCreateWorkDomain = 'engineering';

export interface TaskCreateDomainDefaults {
  projectIds: number[];
  error: string | null;
}

const ENGINEERING_PROJECT_KEY = 'entity-engineering';

export function resolveTaskCreateDomainDefaults(
  projects: readonly ProjectOption[],
  workDomain: TaskCreateWorkDomain | null,
): TaskCreateDomainDefaults {
  if (workDomain === null) {
    return { projectIds: [], error: null };
  }

  const domainProjects = projects.filter((project) => project.work_domain === workDomain);
  const canonicalProject =
    domainProjects.find((project) => project.project_key === ENGINEERING_PROJECT_KEY) ??
    domainProjects[0];

  if (!canonicalProject) {
    return {
      projectIds: [],
      error:
        'Engineering project is unavailable. Task creation is disabled to prevent unclassified work.',
    };
  }

  return {
    projectIds: [canonicalProject.id],
    error: null,
  };
}
