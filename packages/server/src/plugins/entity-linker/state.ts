const DEFAULT_MAX_RECENT_EVENTS = 25;

export interface EntityLinkerObservation {
  hook: string;
  taskId: number | null;
  observedAt: string;
}

interface EntityLinkerState {
  byHook: Record<string, number>;
  recent: EntityLinkerObservation[];
}

const state: EntityLinkerState = {
  byHook: {},
  recent: [],
};

function normalizeMaxRecentEvents(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_MAX_RECENT_EVENTS;
  }

  return Math.max(1, Math.min(100, Math.floor(value)));
}

export function extractTaskId(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const directTaskId = record.taskId;
  if (typeof directTaskId === 'number' && Number.isFinite(directTaskId)) {
    return directTaskId;
  }

  const task = record.task;
  if (task && typeof task === 'object') {
    const nestedTaskId = (task as Record<string, unknown>).id;
    if (typeof nestedTaskId === 'number' && Number.isFinite(nestedTaskId)) {
      return nestedTaskId;
    }
  }

  return null;
}

export function recordEntityLinkerObservation(options: {
  hook: string;
  payload: unknown;
  maxRecentEvents?: unknown;
}): EntityLinkerObservation {
  const observation: EntityLinkerObservation = {
    hook: options.hook,
    taskId: extractTaskId(options.payload),
    observedAt: new Date().toISOString(),
  };

  state.byHook[options.hook] = (state.byHook[options.hook] ?? 0) + 1;
  state.recent.unshift(observation);
  state.recent = state.recent.slice(0, normalizeMaxRecentEvents(options.maxRecentEvents));
  return observation;
}

export function getEntityLinkerState() {
  return {
    byHook: { ...state.byHook },
    recent: state.recent.map((entry) => ({ ...entry })),
    totalObserved: Object.values(state.byHook).reduce((sum, count) => sum + count, 0),
  };
}

export function resetEntityLinkerState(): void {
  for (const key of Object.keys(state.byHook)) {
    delete state.byHook[key];
  }
  state.recent = [];
}
