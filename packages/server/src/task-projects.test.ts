import { describe, expect, it } from 'vitest';
import {
  buildTaskProjectLabel,
  diffTaskProjectIds,
  parseTaskProjectNames,
  syncTaskProjectAssignments,
  taskHasProjectName,
} from './task-projects';

describe('task project helpers', () => {
  it('builds a comma-separated project label in requested order', () => {
    expect(
      buildTaskProjectLabel(
        [3, 1, 2],
        [
          { id: 1, name: 'Alpha' },
          { id: 2, name: 'Bravo' },
          { id: 3, name: 'Charlie' },
        ]
      )
    ).toBe('Charlie, Alpha, Bravo');
  });

  it('falls back when no requested projects resolve to names', () => {
    expect(buildTaskProjectLabel([], [{ id: 1, name: 'Alpha' }])).toBe('General');
    expect(buildTaskProjectLabel([9], [{ id: 1, name: 'Alpha' }], 'Fallback')).toBe('Fallback');
  });

  it('parses distinct project names from a legacy label', () => {
    expect(parseTaskProjectNames(' Soteria, Curacel, Soteria, , Personal ')).toEqual([
      'Soteria',
      'Curacel',
      'Personal',
    ]);
  });

  it('matches a project filter against structured task projects before falling back to the legacy label', () => {
    expect(
      taskHasProjectName(
        {
          project: 'General',
          projects: [
            { id: 1, name: 'Soteria' },
            { id: 2, name: 'Curacel' },
          ],
        },
        'curacel'
      )
    ).toBe(true);

    expect(
      taskHasProjectName(
        {
          project: 'Personal, Moltbot',
          projects: [],
        },
        'Moltbot'
      )
    ).toBe(true);

    expect(
      taskHasProjectName(
        {
          project: 'Personal, Moltbot',
          projects: [{ id: 99, name: 'Soteria' }],
        },
        'Personal'
      )
    ).toBe(false);
  });

  it('computes add/remove project diffs', () => {
    expect(diffTaskProjectIds([1, 2, 5], [2, 3, 5])).toEqual({
      toAdd: [3],
      toRemove: [1],
    });
  });

  it('syncs task project assignments by removing stale links before adding new ones', () => {
    const calls: string[] = [];

    const diff = syncTaskProjectAssignments(42, [1, 2], [2, 3, 4], {
      addTaskProject: (taskId, projectId) => {
        calls.push(`add:${taskId}:${projectId}`);
        return true;
      },
      removeTaskProject: (taskId, projectId) => {
        calls.push(`remove:${taskId}:${projectId}`);
        return true;
      },
    });

    expect(diff).toEqual({
      toAdd: [3, 4],
      toRemove: [1],
    });
    expect(calls).toEqual([
      'remove:42:1',
      'add:42:3',
      'add:42:4',
    ]);
  });
});
