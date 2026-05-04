import { describe, expect, it } from 'vitest';
import type { TaskRecord } from '../../../db/src';
import { buildMergeAuditNote, findTaskDuplicateCandidates, normalizeTaskTitle } from '../task-dedupe';

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 1,
    name: 'Default task',
    description: null,
    column: 'todo',
    assignee: 'Ada',
    model: null,
    archived: false,
    priority: 'P2',
    due_date: null,
    estimate_hours: null,
    time_spent: null,
    output: null,
    brief: null,
    origin_channel: null,
    progress_status: null,
    recurring: false,
    recurring_config: null,
    blocked: false,
    blocker_reason: null,
    metadata: null,
    created_at: '2026-03-19T00:00:00.000Z',
    updated_at: '2026-03-19T00:00:00.000Z',
    ...overrides,
  };
}

describe('task dedupe helpers', () => {
  it('normalizes punctuation and casing for exact title dedupe', () => {
    expect(normalizeTaskTitle('  Fix: MC  TASK dedupe!!! ')).toBe('fix mc task dedupe');
  });

  it('matches exact duplicates only among active non-archived tasks', () => {
    const tasks: TaskRecord[] = [
      makeTask({ id: 1, name: 'Implement MC task dedupe + merge flow', column: 'todo' }),
      makeTask({ id: 2, name: 'Implement MC task dedupe + merge flow', column: 'done' }),
      makeTask({ id: 3, name: 'Implement MC task dedupe + merge flow', archived: true, column: 'doing' }),
    ];

    const candidates = findTaskDuplicateCandidates('implement mc task dedupe + merge flow', tasks);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.task.id).toBe(1);
    expect(candidates[0]?.exact).toBe(true);
  });

  it('detects fuzzy duplicates with high overlap and excludes self', () => {
    const tasks: TaskRecord[] = [
      makeTask({ id: 10, name: 'Implement mission control task dedupe flow', column: 'doing' }),
      makeTask({ id: 11, name: 'Implement mission control dedupe and merge workflow', column: 'review' }),
      makeTask({ id: 12, name: 'Completely unrelated weather check', column: 'todo' }),
    ];

    const candidates = findTaskDuplicateCandidates('Implement Mission Control dedupe + merge flow', tasks, {
      excludeTaskId: 10,
    });

    expect(candidates.some((candidate) => candidate.task.id === 11)).toBe(true);
    expect(candidates.some((candidate) => candidate.task.id === 10)).toBe(false);
    expect(candidates.some((candidate) => candidate.task.id === 12)).toBe(false);
  });

  it('builds merge audit note with source context fields', () => {
    const source = makeTask({
      id: 44,
      name: 'Duplicate card',
      description: 'Carry over this context.',
      brief: 'Short brief',
      output: 'output/merge-proof.md',
      blocked: true,
      blocker_reason: 'Waiting for API key',
    });
    const target = makeTask({ id: 45, name: 'Canonical card' });

    const note = buildMergeAuditNote(source, target);
    expect(note).toContain('Merged duplicate task #44');
    expect(note).toContain('Source description: Carry over this context.');
    expect(note).toContain('Source brief: Short brief');
    expect(note).toContain('Source output: output/merge-proof.md');
    expect(note).toContain('Source blocker: Waiting for API key');
  });
});
