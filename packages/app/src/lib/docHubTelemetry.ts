import { buildApiCandidates, withApiToken } from './http.ts';

export type DocHubTelemetryEventName =
  | 'doc_hub.copy_share.attempt'
  | 'doc_hub.copy_share.result'
  | 'doc_hub.clipboard_fallback.displayed'
  | 'doc_hub.mobile_tool_sheet.opened'
  | 'doc_hub.mobile_tool.selected'
  | 'doc_hub.audio_generation.started'
  | 'doc_hub.audio_generation.completed'
  | 'doc_hub.audio_playback.error'
  | 'doc_hub.deep_link_restoration.success'
  | 'doc_hub.deep_link_restoration.failure';

export interface DocHubTelemetryInput {
  name: DocHubTelemetryEventName | string;
  properties?: Record<string, unknown>;
  context?: {
    environment?: string;
    buildId?: string;
    gitSha?: string;
  };
}

export interface SafeDocHubTelemetryEvent {
  name: DocHubTelemetryEventName;
  properties: Record<string, string | number | boolean>;
  environment?: string;
  buildId?: string;
  gitSha?: string;
}

type PropertyRule =
  | { type: 'boolean' }
  | { type: 'number' }
  | { type: 'enum'; values: readonly string[] };

const eventSchemas = {
  'doc_hub.copy_share.attempt': {
    mechanism: { type: 'enum', values: ['clipboard', 'native-share'] },
    surface: { type: 'enum', values: ['desktop', 'mobile'] },
  },
  'doc_hub.copy_share.result': {
    mechanism: { type: 'enum', values: ['clipboard', 'native-share'] },
    outcome: { type: 'enum', values: ['success', 'fallback', 'failure', 'cancelled'] },
    recoverable: { type: 'boolean' },
  },
  'doc_hub.clipboard_fallback.displayed': {
    surface: { type: 'enum', values: ['desktop', 'mobile'] },
    reason: {
      type: 'enum',
      values: ['clipboard-unavailable', 'clipboard-denied', 'clipboard-failed'],
    },
  },
  'doc_hub.mobile_tool_sheet.opened': {
    source: { type: 'enum', values: ['document-header', 'deep-link'] },
  },
  'doc_hub.mobile_tool.selected': {
    tool: { type: 'enum', values: ['intelligence', 'convert', 'comments', 'share', 'audio'] },
    source: { type: 'enum', values: ['bottom-sheet', 'deep-link'] },
  },
  'doc_hub.audio_generation.started': {
    provider: {
      type: 'enum',
      values: ['browser', 'kokoro', 'edge', 'openai', 'deepgram', 'elevenlabs'],
    },
    surface: { type: 'enum', values: ['desktop', 'mobile'] },
  },
  'doc_hub.audio_generation.completed': {
    provider: {
      type: 'enum',
      values: ['browser', 'kokoro', 'edge', 'openai', 'deepgram', 'elevenlabs'],
    },
    outcome: {
      type: 'enum',
      values: ['success', 'failure', 'timeout', 'provider-missing', 'cancelled'],
    },
    cached: { type: 'boolean' },
    truncated: { type: 'boolean' },
    durationMs: { type: 'number' },
  },
  'doc_hub.audio_playback.error': {
    phase: { type: 'enum', values: ['play', 'decode', 'media', 'browser'] },
    recoverable: { type: 'boolean' },
    provider: {
      type: 'enum',
      values: ['browser', 'kokoro', 'edge', 'openai', 'deepgram', 'elevenlabs'],
    },
  },
  'doc_hub.deep_link_restoration.success': {
    contentClass: {
      type: 'enum',
      values: ['source', 'workspace', 'task-output', 'artifact'],
    },
    hasTool: { type: 'boolean' },
  },
  'doc_hub.deep_link_restoration.failure': {
    reason: {
      type: 'enum',
      values: ['invalid-route', 'document-missing', 'source-missing', 'load-failed', 'unsupported'],
    },
    recoverable: { type: 'boolean' },
  },
} as const satisfies Record<DocHubTelemetryEventName, Record<string, PropertyRule>>;

const safeContextPattern = /^[a-zA-Z0-9._-]{1,80}$/;

function isEventName(name: string): name is DocHubTelemetryEventName {
  return Object.prototype.hasOwnProperty.call(eventSchemas, name);
}

function propertyMatchesRule(value: unknown, rule: PropertyRule): value is string | number | boolean {
  if (rule.type === 'boolean') return typeof value === 'boolean';
  if (rule.type === 'number') {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  }
  return typeof value === 'string' && rule.values.includes(value);
}

function safeContextValue(value: unknown): string | undefined {
  return typeof value === 'string' && safeContextPattern.test(value) ? value : undefined;
}

export function buildDocHubTelemetryEvent(
  input: DocHubTelemetryInput,
): SafeDocHubTelemetryEvent {
  if (!isEventName(input.name)) {
    throw new Error(`Unsupported Doc Hub telemetry event: ${input.name}`);
  }

  const schema = eventSchemas[input.name] as Record<string, PropertyRule>;
  const sourceProperties = input.properties ?? {};
  const properties: Record<string, string | number | boolean> = {};
  for (const [key, rule] of Object.entries(schema)) {
    const value = sourceProperties[key];
    if (propertyMatchesRule(value, rule)) {
      properties[key] = value;
    }
  }

  const environment = safeContextValue(input.context?.environment);
  const buildId = safeContextValue(input.context?.buildId);
  const gitSha = safeContextValue(input.context?.gitSha);
  return {
    name: input.name,
    properties,
    ...(environment ? { environment } : {}),
    ...(buildId ? { buildId } : {}),
    ...(gitSha ? { gitSha } : {}),
  };
}

export interface DocHubTelemetryTransportOptions {
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

function sendToServer(
  event: SafeDocHubTelemetryEvent,
  options: DocHubTelemetryTransportOptions = {},
): void {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return;
  const apiBasePromise = options.apiBase === undefined
    ? import('../config/runtime').then(({ runtime }) => runtime.apiBase)
    : Promise.resolve(options.apiBase);
  void apiBasePromise
    .then((apiBase) => {
      const endpoint = buildApiCandidates('/telemetry/doc-hub', apiBase)[0];
      return fetchImpl(endpoint, withApiToken({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
        keepalive: true,
      }));
    })
    .catch(() => {
      // Telemetry must never interrupt the document workflow.
    });
}

export function emitDocHubTelemetry(
  input: DocHubTelemetryInput,
  send?: (event: SafeDocHubTelemetryEvent) => void,
  transportOptions?: DocHubTelemetryTransportOptions,
): SafeDocHubTelemetryEvent {
  const event = buildDocHubTelemetryEvent(input);
  if (send) {
    send(event);
  } else {
    sendToServer(event, transportOptions);
  }
  return event;
}
