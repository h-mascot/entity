import { describe, expect, it, vi } from 'vitest';
import type { TaskRecord, TaskRepository } from './index';
import { createLocalTaskAdapter } from './local';

const task = {
  id: 17,
  name: 'Injected repository task',
  column: 'todo',
  created_at: '2026-07-30T00:00:00.000Z',
  updated_at: '2026-07-30T00:00:00.000Z',
} as TaskRecord;

describe('local task adapter project mutations', () => {
  it('keeps atomic project-bearing mutations on the injected repository', async () => {
    const createTask = vi.fn(() => task);
    const updateTask = vi.fn(() => task);
    const createTaskWithProjects = vi.fn(() => ({
      ...task,
      project_id: 9,
    }));
    const updateTaskWithProjects = vi.fn(() => ({
      ...task,
      project_id: null,
    }));
    const repository = {
      createTask,
      updateTask,
      createTaskWithProjects,
      updateTaskWithProjects,
    } as unknown as TaskRepository;
    const adapter = createLocalTaskAdapter({ repository });

    await adapter.createTask({
      name: task.name,
      projectIds: [9],
    });
    await adapter.updateTask(task.id, { projectIds: [] });

    expect(createTaskWithProjects).toHaveBeenCalledWith(
      expect.objectContaining({ projectIds: [9] }),
    );
    expect(updateTaskWithProjects).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({ projectIds: [] }),
    );
    expect(createTask).not.toHaveBeenCalled();
    expect(updateTask).not.toHaveBeenCalled();
  });
});
