/**
 * Board task membership — pure adapter deriving the tasks visible in a board from
 * its persisted filter configuration (BRD-003). Boards never copy task rows; they
 * select from the shared task list. Engineering-template boards default to a
 * workDomain=engineering filter using existing task work-domain metadata.
 *
 * Self-contained (no local type import) to stay compatible with the app's ts-node
 * ESM test loader. The filter shape mirrors BoardFilterConfig from boardsState.
 */

export interface BoardFilterableTask {
  id: number;
  projects?: ReadonlyArray<{ id?: number; name?: string }>;
  work_domain?: string | null;
}

export interface BoardFilterConfigLike {
  scope: 'all' | 'projects' | 'workDomain' | 'none';
  projectIds?: number[];
  workDomain?: string | null;
}

function normalizeDomain(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** Whether a single task satisfies a board filter config. */
export function taskMatchesBoardFilter(
  task: BoardFilterableTask,
  filter: BoardFilterConfigLike,
): boolean {
  switch (filter.scope) {
    case 'all':
      return true;
    case 'none':
      return false;
    case 'projects': {
      const wanted = Array.isArray(filter.projectIds) ? filter.projectIds : [];
      if (wanted.length === 0) return false;
      const ids = (task.projects ?? [])
        .map((project) => project.id)
        .filter((id): id is number => typeof id === 'number' && id > 0);
      return wanted.some((wantedId) => ids.includes(wantedId));
    }
    case 'workDomain': {
      const target = normalizeDomain(filter.workDomain ?? null);
      if (!target) return false;
      return normalizeDomain(task.work_domain ?? null) === target;
    }
    default:
      return true;
  }
}

/** Select the subset of tasks visible in the given board. */
export function selectTasksForBoard<T extends BoardFilterableTask>(
  tasks: readonly T[],
  board: { filter_config: BoardFilterConfigLike },
): T[] {
  return tasks.filter((task) => taskMatchesBoardFilter(task, board.filter_config));
}
