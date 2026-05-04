export interface EforgeSession {
  id?: string;
  sessionId?: string;
  status?: string;
  [key: string]: unknown;
}

export interface EforgeRun {
  id?: string;
  runId?: string;
  sessionId?: string;
  session_id?: string;
  status?: string;
  state?: string;
  prdPath?: string;
  prd_path?: string;
  queueFile?: string;
  queue_file?: string;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  session?: EforgeSession;
  [key: string]: unknown;
}

export interface EforgeEvent {
  id?: string;
  type?: string;
  category?: string;
  action?: string;
  name?: string;
  status?: string;
  message?: string;
  text?: string;
  createdAt?: string;
  timestamp?: string;
  data?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

function withTimeoutSignal(timeoutMs = 5000): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    signal: withTimeoutSignal(5000),
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`eforge API ${response.status} for ${url}`);
  }

  return await response.json() as T;
}

function normalizeRuns(payload: unknown): EforgeRun[] {
  if (Array.isArray(payload)) return payload as EforgeRun[];
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.runs)) return record.runs as EforgeRun[];
    if (Array.isArray(record.data)) return record.data as EforgeRun[];
  }
  return [];
}

function normalizeEvents(payload: unknown): EforgeEvent[] {
  if (Array.isArray(payload)) return payload as EforgeEvent[];
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.events)) return record.events as EforgeEvent[];
    if (Array.isArray(record.data)) return record.data as EforgeEvent[];
  }
  return [];
}

export async function getRuns(apiUrl: string): Promise<EforgeRun[]> {
  try {
    const payload = await fetchJson<unknown>(`${apiUrl.replace(/\/$/, '')}/api/runs`);
    return normalizeRuns(payload);
  } catch (error) {
    console.warn('[swarm][eforge] getRuns failed:', error instanceof Error ? error.message : error);
    return [];
  }
}

export async function getSessionEvents(apiUrl: string, sessionId: string): Promise<EforgeEvent[]> {
  if (!sessionId) return [];

  try {
    const payload = await fetchJson<unknown>(`${apiUrl.replace(/\/$/, '')}/api/sessions/${encodeURIComponent(sessionId)}/events`);
    return normalizeEvents(payload);
  } catch (error) {
    console.warn('[swarm][eforge] getSessionEvents failed:', error instanceof Error ? error.message : error);
    return [];
  }
}

export async function getRunStatus(apiUrl: string, runId: string): Promise<EforgeRun | null> {
  if (!runId) return null;
  const runs = await getRuns(apiUrl);
  return runs.find((run) => String(run.id ?? run.runId ?? '') === runId) ?? null;
}
