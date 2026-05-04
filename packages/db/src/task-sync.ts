import type { CreateTaskInput, TaskRecord, UpdateTaskInput } from './index';
import { createCloudTaskAdapter, type CloudTaskAdapterOptions } from './cloud';
import { createLocalTaskAdapter, type LocalTaskAdapterOptions } from './local';

export type DbMode = 'LOCAL' | 'CLOUD';

export interface TaskAdapter {
  mode: DbMode;
  listTasks: () => Promise<TaskRecord[]>;
  getTask: (id: number) => Promise<TaskRecord | undefined>;
  createTask: (input: CreateTaskInput) => Promise<TaskRecord>;
  updateTask: (id: number, updates: UpdateTaskInput) => Promise<TaskRecord | undefined>;
  moveTask: (id: number, nextColumn: string) => Promise<TaskRecord | undefined>;
  deleteTask: (id: number) => Promise<boolean>;
}

export interface TaskSyncLayer {
  getMode: () => DbMode;
  setMode: (mode: DbMode | null) => void;
  hasCloudAdapter: () => boolean;
  listTasks: () => Promise<TaskRecord[]>;
  getTask: (id: number) => Promise<TaskRecord | undefined>;
  createTask: (input: CreateTaskInput) => Promise<TaskRecord>;
  updateTask: (id: number, updates: UpdateTaskInput) => Promise<TaskRecord | undefined>;
  moveTask: (id: number, nextColumn: string) => Promise<TaskRecord | undefined>;
  deleteTask: (id: number) => Promise<boolean>;
}

export interface TaskSyncLayerOptions {
  mode?: DbMode | string | null;
  cloudBaseUrl?: string;
  platform?: string | null;
  local?: LocalTaskAdapterOptions;
  cloud?: Omit<CloudTaskAdapterOptions, 'baseUrl'>;
}

const DB_MODE_ENV_KEYS = ['ENTITY_DB_MODE', 'DB_MODE'] as const;
const CLOUD_BASE_ENV_KEYS = ['ENTITY_CLOUD_API_BASE', 'CLOUD_API_BASE'] as const;
const PLATFORM_ENV_KEYS = ['ENTITY_RUNTIME', 'ENTITY_PLATFORM'] as const;

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function normalizeDbMode(value: unknown): DbMode | null {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  const upper = normalized.toUpperCase();
  if (upper === 'LOCAL' || upper === 'CLOUD') {
    return upper;
  }

  return null;
}

function readFirstDefinedEnv(keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = normalizeString(process.env[key]);
    if (value) {
      return value;
    }
  }

  return null;
}

function prefersLocalRuntime(platform: string | null): boolean {
  if (!platform) {
    return false;
  }

  const normalized = platform.toLowerCase();
  return normalized === 'electron' || normalized === 'desktop' || normalized === 'mobile';
}

function resolveCloudBaseUrl(explicitBaseUrl?: string): string | null {
  const explicit = normalizeString(explicitBaseUrl);
  if (explicit) {
    return explicit;
  }

  return readFirstDefinedEnv(CLOUD_BASE_ENV_KEYS);
}

function resolvePlatform(explicitPlatform?: string | null): string | null {
  const explicit = normalizeString(explicitPlatform);
  if (explicit) {
    return explicit;
  }

  return readFirstDefinedEnv(PLATFORM_ENV_KEYS);
}

export function createTaskSyncLayer(options: TaskSyncLayerOptions = {}): TaskSyncLayer {
  const localAdapter = createLocalTaskAdapter(options.local);
  const cloudBaseUrl = resolveCloudBaseUrl(options.cloudBaseUrl);
  const cloudAdapter = cloudBaseUrl
    ? createCloudTaskAdapter({
        baseUrl: cloudBaseUrl,
        ...options.cloud,
      })
    : null;
  let runtimeModeOverride = normalizeDbMode(options.mode);
  const runtimePlatform = resolvePlatform(options.platform);

  function resolveMode(): DbMode {
    if (runtimeModeOverride === 'CLOUD' && cloudAdapter) {
      return 'CLOUD';
    }
    if (runtimeModeOverride === 'LOCAL') {
      return 'LOCAL';
    }

    for (const key of DB_MODE_ENV_KEYS) {
      const envMode = normalizeDbMode(process.env[key]);
      if (!envMode) {
        continue;
      }
      if (envMode === 'CLOUD' && cloudAdapter) {
        return 'CLOUD';
      }
      return 'LOCAL';
    }

    if (prefersLocalRuntime(runtimePlatform)) {
      return 'LOCAL';
    }

    return cloudAdapter ? 'CLOUD' : 'LOCAL';
  }

  function getAdapter(): TaskAdapter {
    return resolveMode() === 'CLOUD' && cloudAdapter ? cloudAdapter : localAdapter;
  }

  return {
    getMode: () => resolveMode(),
    setMode: (mode: DbMode | null) => {
      runtimeModeOverride = mode;
    },
    hasCloudAdapter: () => Boolean(cloudAdapter),
    listTasks: () => getAdapter().listTasks(),
    getTask: (id: number) => getAdapter().getTask(id),
    createTask: (input: CreateTaskInput) => getAdapter().createTask(input),
    updateTask: (id: number, updates: UpdateTaskInput) => getAdapter().updateTask(id, updates),
    moveTask: (id: number, nextColumn: string) => getAdapter().moveTask(id, nextColumn),
    deleteTask: (id: number) => getAdapter().deleteTask(id),
  };
}
