import {
  createTaskRepository,
  createTaskWithProjects,
  type ClaimTaskForTaskMasterInput,
  type CreateTaskInput,
  type TaskMasterClaimResult,
  type TaskRecord,
  type TaskRepository,
  type UpdateTaskInput,
  updateTaskWithProjects,
} from './index';
import type { TaskAdapter } from './task-sync';

export interface LocalTaskAdapterOptions {
  repository?: TaskRepository;
}

export function createLocalTaskAdapter(options: LocalTaskAdapterOptions = {}): TaskAdapter {
  const repository = options.repository ?? createTaskRepository();
  const hasInjectedRepository = options.repository !== undefined;

  const createWithProjects = (input: CreateTaskInput): TaskRecord => {
    if (repository.createTaskWithProjects) {
      return repository.createTaskWithProjects(input);
    }
    if (hasInjectedRepository) {
      throw new Error('Configured task repository does not support atomic project assignment.');
    }
    return createTaskWithProjects(input, repository);
  };

  const updateWithProjects = (
    id: number,
    updates: UpdateTaskInput,
  ): TaskRecord | undefined => {
    if (repository.updateTaskWithProjects) {
      return repository.updateTaskWithProjects(id, updates);
    }
    if (hasInjectedRepository) {
      throw new Error('Configured task repository does not support atomic project assignment.');
    }
    return updateTaskWithProjects(id, updates, repository);
  };

  return {
    mode: 'LOCAL',
    listTasks: async (): Promise<TaskRecord[]> => repository.listTasks(),
    listSubtasks: async (parentTaskId: number): Promise<TaskRecord[]> => repository.listSubtasks(parentTaskId),
    getTask: async (id: number): Promise<TaskRecord | undefined> => repository.getTask(id),
    createTask: async (input: CreateTaskInput): Promise<TaskRecord> =>
      input.projectIds === undefined ? repository.createTask(input) : createWithProjects(input),
    updateTask: async (id: number, updates: UpdateTaskInput): Promise<TaskRecord | undefined> =>
      updates.projectIds === undefined
        ? repository.updateTask(id, updates)
        : updateWithProjects(id, updates),
    claimTaskForTaskMaster: async (
      id: number,
      input?: ClaimTaskForTaskMasterInput,
    ): Promise<TaskMasterClaimResult> => repository.claimTaskForTaskMaster(id, input),
    moveTask: async (id: number, nextColumn: string): Promise<TaskRecord | undefined> =>
      repository.moveTask(id, nextColumn),
    deleteTask: async (id: number): Promise<boolean> => repository.deleteTask(id),
  };
}
