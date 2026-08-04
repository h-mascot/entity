/**
 * EEPC-B-01 — Client-side public health redaction for execution-engine UI.
 *
 * Server routes already project public health. This helper is defense-in-depth
 * so operator UI never renders secret-shaped leftovers if a payload regresses.
 */

const URL_RE = /https?:\/\/[^\s)'"]+/gi;
const PATH_RE = /(?:^|[\s"'=(])(\/(?:Users|home|var|tmp|opt|etc|private)\/[^\s'")]+)/gi;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9_\-.+/=]{8,}/gi;
const SK_RE = /\bsk-[A-Za-z0-9]{10,}\b/g;
const SECRET_VALUE_RE =
  /^(Bearer\s+)?[A-Za-z0-9_\-]{32,}$|api[_-]?key\s*=|token\s*=|sk-[A-Za-z0-9]{10,}/i;

export interface PublicExecutionEngineHealth {
  available: boolean;
  message?: string;
  latencyMs?: number;
}

export interface PublicExecutionEngineListItem {
  id?: string;
  name: string;
  label: string;
  kind?: 'execution-engine';
  category?: string;
  description?: string;
  capabilities?: string[];
  acceptsDispatch?: boolean;
  executionMode?: string;
  mode?: string;
  health?: PublicExecutionEngineHealth;
  meta?: {
    category?: string;
    description?: string;
    capabilities?: string[];
    acceptsDispatch?: boolean;
    executionMode?: string;
  };
}

export function redactExecutionEngineMessage(message: string | undefined): string | undefined {
  if (typeof message !== 'string') return undefined;
  const trimmed = message.trim();
  if (!trimmed) return undefined;
  if (SECRET_VALUE_RE.test(trimmed)) return '[redacted]';

  let out = message;
  out = out.replace(URL_RE, '[redacted-url]');
  out = out.replace(PATH_RE, (match, pathPart: string) => match.replace(pathPart, '[redacted-path]'));
  out = out.replace(BEARER_RE, 'Bearer [redacted]');
  out = out.replace(SK_RE, '[redacted-secret]');
  return out;
}

export function projectExecutionEngineHealthForUi(
  health: PublicExecutionEngineHealth | null | undefined,
): PublicExecutionEngineHealth {
  if (!health || typeof health !== 'object') {
    return { available: false, message: 'Health unknown' };
  }

  const projected: PublicExecutionEngineHealth = {
    available: Boolean(health.available),
  };

  const message = redactExecutionEngineMessage(health.message);
  if (message) projected.message = message;

  if (typeof health.latencyMs === 'number' && Number.isFinite(health.latencyMs)) {
    projected.latencyMs = health.latencyMs;
  }

  return projected;
}

export function normalizeExecutionEngineListItem(
  raw: PublicExecutionEngineListItem,
): PublicExecutionEngineListItem & { health: PublicExecutionEngineHealth } {
  const category = raw.category ?? raw.meta?.category;
  const description = raw.description ?? raw.meta?.description;
  const capabilities = raw.capabilities ?? raw.meta?.capabilities;
  const acceptsDispatch = raw.acceptsDispatch ?? raw.meta?.acceptsDispatch;
  const executionMode = raw.executionMode ?? raw.meta?.executionMode ?? raw.mode;

  return {
    id: raw.id ?? `swarm.${raw.name}`,
    name: raw.name,
    label: raw.label || raw.name,
    kind: 'execution-engine',
    category,
    description,
    capabilities,
    acceptsDispatch,
    executionMode,
    mode: raw.mode ?? executionMode,
    health: projectExecutionEngineHealthForUi(raw.health),
  };
}

export function containsSecretShapedValue(value: unknown): boolean {
  const serialized = JSON.stringify(value ?? '');
  return (
    /https?:\/\//i.test(serialized) ||
    /\/Users\/|\/home\/|\/tmp\//.test(serialized) ||
    /\bBearer\s+[A-Za-z0-9_\-.+/=]{8,}/i.test(serialized) ||
    /\bsk-[A-Za-z0-9]{10,}\b/.test(serialized) ||
    /api[_-]?key\s*=/i.test(serialized)
  );
}
