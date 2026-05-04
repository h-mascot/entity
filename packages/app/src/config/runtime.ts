const DEFAULT_API_BASE = '';
const DEFAULT_MC_ORIGIN = '';
const DEFAULT_OPENCLAW_BASE = '';
const DEFAULT_WS_PORT = 3000;
const DEFAULT_FS_MULTISOURCE_ENABLED = true;
const DEFAULT_AGENT_NATIVE_EDITOR_ENABLED = true;

function normalizeBaseUrl(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  return trimmed.replace(/\/+$/, '');
}

function toInteger(value: string | undefined, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) {
    return fallback;
  }

  return numeric;
}

function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (typeof value === 'undefined') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function resolveWsUrl(defaultPort: number, hasExplicitPort: boolean): string {
  if (typeof window === 'undefined') {
    return `ws://localhost:${defaultPort}`;
  }

  const { protocol, host, hostname } = window.location;
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  if (!hasExplicitPort) {
    return `${wsProtocol}//${host}`;
  }

  return `${wsProtocol}//${hostname}:${defaultPort}`;
}

const apiBase = normalizeBaseUrl(import.meta.env.VITE_ENTITY_API_BASE, DEFAULT_API_BASE);
const mcOrigin = normalizeBaseUrl(import.meta.env.VITE_MC_ORIGIN, DEFAULT_MC_ORIGIN);
const openclawBase = normalizeBaseUrl(import.meta.env.VITE_OPENCLAW_BASE, DEFAULT_OPENCLAW_BASE);
const wsPortRaw = import.meta.env.VITE_ENTITY_WS_PORT;
const hasExplicitWsPort = typeof wsPortRaw === 'string' && wsPortRaw.trim().length > 0;
const wsPort = toInteger(wsPortRaw, DEFAULT_WS_PORT);
const wsUrl = normalizeBaseUrl(import.meta.env.VITE_ENTITY_WS_URL, resolveWsUrl(wsPort, hasExplicitWsPort));
const fsMultiSourceEnabled = toBoolean(import.meta.env.VITE_ENTITY_FS_MULTISOURCE, DEFAULT_FS_MULTISOURCE_ENABLED);
const agentNativeEditorEnabled = toBoolean(
  import.meta.env.VITE_ENTITY_AGENT_NATIVE_EDITOR,
  DEFAULT_AGENT_NATIVE_EDITOR_ENABLED,
);

export const runtime = {
  apiBase,
  mcOrigin,
  mcApiBase: `${mcOrigin}/api`,
  openclawBase,
  wsPort,
  wsUrl,
  fsMultiSourceEnabled,
  agentNativeEditorEnabled,
};

export type RuntimeConfig = typeof runtime;
