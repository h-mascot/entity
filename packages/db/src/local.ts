import {
  createTaskRepository,
  type CreateTaskInput,
  type TaskRecord,
  type TaskRepository,
  type UpdateTaskInput,
} from './index';
import type { TaskAdapter } from './task-sync';

export interface LocalTaskAdapterOptions {
  repository?: TaskRepository;
}

export function createLocalTaskAdapter(options: LocalTaskAdapterOptions = {}): TaskAdapter {
  const repository = options.repository ?? createTaskRepository();

  return {
    mode: 'LOCAL',
    listTasks: async (): Promise<TaskRecord[]> => repository.listTasks(),
    getTask: async (id: number): Promise<TaskRecord | undefined> => repository.getTask(id),
    createTask: async (input: CreateTaskInput): Promise<TaskRecord> => repository.createTask(input),
    updateTask: async (id: number, updates: UpdateTaskInput): Promise<TaskRecord | undefined> =>
      repository.updateTask(id, updates),
    moveTask: async (id: number, nextColumn: string): Promise<TaskRecord | undefined> =>
      repository.moveTask(id, nextColumn),
    deleteTask: async (id: number): Promise<boolean> => repository.deleteTask(id),
  };
}
