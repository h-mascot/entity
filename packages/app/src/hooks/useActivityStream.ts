import { useCallback, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { buildApiCandidates, requestJsonWithFallback, toErrorMessage } from '../lib/http';
import { useSharedWebSocket } from './useSharedWebSocket';

const DEFAULT_API_BASE = '';
const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_MOCK_INTERVAL_RANGE: [number, number] = [2000, 5000];

export type ActivitySource = 'agent' | 'task';

export type ActivityType =
  | 'file_edit'
  | 'tool_call'
  | 'message_sent'
  | 'command_run'
  | 'research'
  | 'thinking'
  | 'task_created'
  | 'task_updated'
  | 'task_moved'
  | 'task_completed'
  | 'task_deleted'
  | 'task_comment';

const TYPE_VALUES: ActivityType[] = [
  'file_edit',
  'tool_call',
  'message_sent',
  'command_run',
  'research',
  'thinking',
  'task_created',
  'task_updated',
  'task_moved',
  'task_completed',
  'task_deleted',
  'task_comment',
];

export interface ActivityEntry {
  id: string;
  source: ActivitySource;
  type: ActivityType;
  agentName: string;
  agentEmoji: string;
  action: string;
  description: string;
  timestamp: string;
  filePath?: string;
  cursor?: unknown;
  taskId?: number;
  taskColumn?: string;
  metadata?: string;
}

interface ActivityStreamState {
  activities: ActivityEntry[];
  paused: boolean;
  maxEntries: number;
  addActivity: (entry: ActivityEntry) => void;
  setActivities: (entries: ActivityEntry[]) => void;
  clearActivities: () => void;
  setPaused: (paused: boolean) => void;
  setMaxEntries: (maxEntries: number) => void;
}

interface UseActivityStreamOptions {
  apiBase?: string;
  enabled?: boolean;
  maxEntries?: number;
  pollIntervalMs?: number;
  useMockData?: boolean;
  mockIntervalRangeMs?: [min: number, max: number];
}

export const useActivityStreamStore = create<ActivityStreamState>((set) => ({
  activities: [],
  paused: false,
  maxEntries: DEFAULT_MAX_ENTRIES,
  addActivity: (entry) =>
    set((state) => {
      if (state.paused) {
        return state;
      }
      return {
        activities: [entry, ...state.activities.filter((activity) => activity.id !== entry.id)].slice(0, state.maxEntries),
      };
    }),
  setActivities: (entries) =>
    set((state) => ({
      activities: entries.slice(0, state.maxEntries),
    })),
  clearActivities: () => set({ activities: [] }),
  setPaused: (paused) => set({ paused }),
  setMaxEntries: (maxEntries) =>
    set((state) => ({
      maxEntries,
      activities: state.activities.slice(0, maxEntries),
    })),
}));

const AGENTS = [
  { name: 'Assistant', emoji: '🤖' },
] as const;

const MOCK_FILE_PATHS = [
  'docs/architecture.md',
  'README.md',
  'packages/app/src/App.tsx',
  'packages/server/src/index.ts',
  'scripts/ralph/prd.json',
];

const MOCK_TOOL_NAMES = ['ripgrep', 'npm', 'git', 'eslint', 'prettier'];
const MOCK_FILE_SWITCH_RANGE_MS: [number, number] = [5000, 10000];
const MOCK_GENERAL_TYPE_VALUES: ActivityType[] = TYPE_VALUES.filter((value) => value !== 'file_edit');

function randomFrom<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)];
}

function randomBetween(min: number, max: number): number {
  const safeMin = Math.min(min, max);
  const safeMax = Math.max(min, max);
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeType(value: unknown): ActivityType {
  if (typeof value !== 'string') {
    return 'message_sent';
  }

  const normalized = value.trim().toLowerCase();
  return (TYPE_VALUES as readonly string[]).includes(normalized)
    ? (normalized as ActivityType)
    : 'message_sent';
}

function normalizeSource(value: unknown): ActivitySource {
  return value === 'task' ? 'task' : 'agent';
}

function toIsoTimestamp(value: unknown): string {
  if (typeof value === 'string') {
    const fromString = new Date(value);
    if (!Number.isNaN(fromString.getTime())) {
      return fromString.toISOString();
    }
  }

  if (typeof value === 'number') {
    const fromNumber = new Date(value);
    if (!Number.isNaN(fromNumber.getTime())) {
      return fromNumber.toISOString();
    }
  }

  return new Date().toISOString();
}

function toTaskId(value: unknown): number | undefined {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric > 0) {
    return numeric;
  }

  return undefined;
}

function parseActivity(raw: unknown): ActivityEntry | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const source = normalizeSource(record.source);
  const type = normalizeType(record.type);
  const taskId = toTaskId(record.task_id ?? record.taskId);

  const fallbackAgentName = 'Entity';
  const fallbackAgentEmoji = '⚡';

  const idValue = record.id;
  const id =
    typeof idValue === 'string'
      ? idValue
      : Number.isFinite(Number(idValue))
        ? String(Number(idValue))
        : createId();

  return {
    id,
    source,
    type,
    agentName:
      typeof record.agentName === 'string'
        ? record.agentName
        : typeof record.agent_name === 'string'
          ? record.agent_name
          : typeof record.taskAssignee === 'string'
            ? record.taskAssignee
            : fallbackAgentName,
    agentEmoji:
      typeof record.agentEmoji === 'string'
        ? record.agentEmoji
        : typeof record.agent_emoji === 'string'
          ? record.agent_emoji
          : fallbackAgentEmoji,
    action: typeof record.action === 'string' ? record.action : 'Activity',
    description: typeof record.description === 'string' ? record.description : 'No description available.',
    timestamp: toIsoTimestamp(record.timestamp ?? record.created_at),
    filePath:
      typeof record.filePath === 'string'
        ? record.filePath
        : typeof record.file_path === 'string'
          ? record.file_path
          : undefined,
    cursor:
      record.cursor ??
      record.cursor_json ??
      record.cursorJson ??
      record.cursorJSON ??
      record.cursor_position ??
      record.cursorPosition ??
      undefined,
    taskId,
    taskColumn:
      typeof record.taskColumn === 'string'
        ? record.taskColumn
        : typeof record.task_column === 'string'
          ? record.task_column
          : undefined,
    metadata:
      typeof record.metadata === 'string'
        ? record.metadata
        : typeof record.meta === 'string'
          ? record.meta
          : undefined,
  };
}

function extractActivities(payload: unknown): ActivityEntry[] {
  const rawList = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>).activities)
      ? ((payload as Record<string, unknown>).activities as unknown[])
      : [];

  return rawList
    .map(parseActivity)
    .filter((entry): entry is ActivityEntry => entry !== null)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

function createMockGeneralActivity(): ActivityEntry {
  const agent = randomFrom(AGENTS);
  const type = randomFrom(MOCK_GENERAL_TYPE_VALUES);
  const filePath = randomFrom(MOCK_FILE_PATHS);
  const toolName = randomFrom(MOCK_TOOL_NAMES);

  if (type === 'task_created' || type === 'task_updated' || type === 'task_moved' || type === 'task_completed' || type === 'task_deleted' || type === 'task_comment') {
    const taskId = randomBetween(1, 30);
    return {
      id: createId(),
      source: 'task',
      type,
      agentName: 'Mission Control',
      agentEmoji: '📋',
      action: type === 'task_completed' ? 'Completed task' : 'Updated task',
      description: `Task #${taskId} changed in the board.`,
      timestamp: new Date().toISOString(),
      taskId,
    };
  }

  if (type === 'tool_call') {
    return {
      id: createId(),
      source: 'agent',
      type,
      agentName: agent.name,
      agentEmoji: agent.emoji,
      action: 'Called tool',
      description: `Ran ${toolName} to validate the current approach.`,
      timestamp: new Date().toISOString(),
    };
  }

  return {
    id: createId(),
    source: 'agent',
    type,
    agentName: agent.name,
    agentEmoji: agent.emoji,
    action: 'Working',
    description: `Reported progress while working on ${filePath}.`,
    timestamp: new Date().toISOString(),
    filePath,
  };
}

function createMockFileEditActivity(agent: (typeof AGENTS)[number], filePath: string): ActivityEntry {
  const cursor = {
    line: randomBetween(0, 80),
    ch: randomBetween(0, 28),
    action: Math.random() < 0.72 ? 'typing' : 'cursor',
  };

  return {
    id: createId(),
    source: 'agent',
    type: 'file_edit',
    agentName: agent.name,
    agentEmoji: agent.emoji,
    action: 'Edited file',
    description: `Updated ${filePath} to reflect latest workspace changes.`,
    timestamp: new Date().toISOString(),
    filePath,
    cursor,
  };
}

export function useActivityStream({
  apiBase = DEFAULT_API_BASE,
  enabled = true,
  maxEntries = DEFAULT_MAX_ENTRIES,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  useMockData = false,
  mockIntervalRangeMs = DEFAULT_MOCK_INTERVAL_RANGE,
}: UseActivityStreamOptions = {}) {
  const activities = useActivityStreamStore((state) => state.activities);
  const paused = useActivityStreamStore((state) => state.paused);
  const storeMaxEntries = useActivityStreamStore((state) => state.maxEntries);
  const addActivity = useActivityStreamStore((state) => state.addActivity);
  const setActivities = useActivityStreamStore((state) => state.setActivities);
  const clearActivities = useActivityStreamStore((state) => state.clearActivities);
  const setPaused = useActivityStreamStore((state) => state.setPaused);
  const setMaxEntries = useActivityStreamStore((state) => state.setMaxEntries);
  const [loading, setLoading] = useState(!useMockData);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const wasWsConnectedRef = useRef(false);

  const { connected: wsConnected } = useSharedWebSocket((message) => {
    if (!enabled || useMockData || message.type !== 'activity:created') {
      return;
    }

    const rawActivity = message.activity ?? message.payload;
    const activity = parseActivity(rawActivity);
    if (activity) {
      addActivity(activity);
      setError(null);
    }
  }, { enabled: enabled && !useMockData });

  useEffect(() => {
    const safeMaxEntries = Math.max(1, maxEntries);
    if (safeMaxEntries !== storeMaxEntries) {
      setMaxEntries(safeMaxEntries);
    }
  }, [maxEntries, setMaxEntries, storeMaxEntries]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchActivities = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      setError(null);
      const encodedLimit = encodeURIComponent(String(Math.max(1, maxEntries)));
      const payload = await requestJsonWithFallback({
        urls: buildApiCandidates(`/activities?limit=${encodedLimit}`, apiBase),
        fallbackError: 'Unable to reach activities endpoint.',
      });
      if (!mountedRef.current) {
        return;
      }

      setActivities(extractActivities(payload));
    } catch (fetchError) {
      if (mountedRef.current) {
        setError(toErrorMessage(fetchError, 'Unable to load activity stream.'));
      }
    } finally {
      if (mountedRef.current && showLoading) {
        setLoading(false);
      }
    }
  }, [apiBase, maxEntries, setActivities]);

  useEffect(() => {
    if (!enabled || useMockData) {
      if (!enabled) {
        setLoading(false);
      }
      return;
    }

    void fetchActivities();
  }, [enabled, fetchActivities, useMockData]);

  useEffect(() => {
    if (!enabled || useMockData || wsConnected) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void fetchActivities(false);
    }, Math.max(1000, pollIntervalMs));

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, fetchActivities, pollIntervalMs, useMockData, wsConnected]);

  useEffect(() => {
    if (!enabled || useMockData) {
      wasWsConnectedRef.current = false;
      return;
    }

    if (wsConnected && !wasWsConnectedRef.current) {
      void fetchActivities(false);
    }
    wasWsConnectedRef.current = wsConnected;
  }, [enabled, fetchActivities, useMockData, wsConnected]);

  useEffect(() => {
    if (!enabled || !useMockData) {
      return;
    }

    setLoading(false);
    setError(null);
    const [minDelay, maxDelay] = mockIntervalRangeMs;
    let generalTimerId: number | undefined;
    const fileTimerByAgent = new Map<string, number>();
    let cancelled = false;

    const enqueueGeneralMock = () => {
      if (cancelled) {
        return;
      }

      const delay = randomBetween(minDelay, maxDelay);
      generalTimerId = window.setTimeout(() => {
        addActivity(createMockGeneralActivity());
        enqueueGeneralMock();
      }, delay);
    };

    const agentFileIndex = new Map<string, number>(
      AGENTS.map((agent) => [agent.name, randomBetween(0, Math.max(0, MOCK_FILE_PATHS.length - 1))])
    );

    const scheduleFileSwitch = (agent: (typeof AGENTS)[number]) => {
      if (cancelled) {
        return;
      }

      const delay = randomBetween(MOCK_FILE_SWITCH_RANGE_MS[0], MOCK_FILE_SWITCH_RANGE_MS[1]);
      const timerId = window.setTimeout(() => {
        if (cancelled) {
          return;
        }

        const currentIndex = agentFileIndex.get(agent.name) ?? 0;
        const nextIndex = MOCK_FILE_PATHS.length > 0 ? (currentIndex + 1) % MOCK_FILE_PATHS.length : 0;
        agentFileIndex.set(agent.name, nextIndex);
        const nextPath = MOCK_FILE_PATHS[nextIndex] ?? 'README.md';

        addActivity(createMockFileEditActivity(agent, nextPath));
        scheduleFileSwitch(agent);
      }, delay);

      fileTimerByAgent.set(agent.name, timerId);
    };

    enqueueGeneralMock();
    for (const agent of AGENTS) {
      scheduleFileSwitch(agent);
    }

    return () => {
      cancelled = true;
      if (generalTimerId !== undefined) {
        window.clearTimeout(generalTimerId);
      }
      for (const timerId of fileTimerByAgent.values()) {
        window.clearTimeout(timerId);
      }
    };
  }, [addActivity, enabled, mockIntervalRangeMs, useMockData]);

  const pause = useCallback(() => setPaused(true), [setPaused]);
  const resume = useCallback(() => setPaused(false), [setPaused]);
  const togglePause = useCallback(() => setPaused(!paused), [paused, setPaused]);

  return {
    activities,
    connected: useMockData ? true : wsConnected,
    loading,
    error,
    paused,
    maxEntries: storeMaxEntries,
    pause,
    resume,
    togglePause,
    clearActivities,
  };
}
