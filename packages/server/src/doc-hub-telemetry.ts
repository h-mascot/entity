import type { Express } from 'express';
import { readReleaseInfo } from './release-info';

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

export interface ParsedDocHubTelemetryEvent {
  name: DocHubTelemetryEventName;
  properties: Record<string, string | number | boolean>;
  environment: string;
  gitSha: string | null;
  buildId?: string;
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

const safeReleaseValuePattern = /^[a-zA-Z0-9._-]{1,80}$/;

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Telemetry payload must be an object');
  }
  return value as Record<string, unknown>;
}

function isEventName(value: unknown): value is DocHubTelemetryEventName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(eventSchemas, value);
}

function parseProperty(key: string, value: unknown, rule: PropertyRule): string | number | boolean {
  if (rule.type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`Invalid boolean property: ${key}`);
    return value;
  }
  if (rule.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid numeric property: ${key}`);
    }
    return value;
  }
  if (typeof value !== 'string' || !rule.values.includes(value)) {
    throw new Error(`Invalid enum property: ${key}`);
  }
  return value;
}

function safeReleaseValue(value: unknown): string | null {
  return typeof value === 'string' && safeReleaseValuePattern.test(value) ? value : null;
}

export function parseDocHubTelemetryEvent(
  input: unknown,
  release: { environment: string; gitSha: string | null; buildId?: string | null },
): ParsedDocHubTelemetryEvent {
  const payload = toRecord(input);
  const allowedTopLevelKeys = new Set([
    'name',
    'properties',
    'environment',
    'buildId',
    'gitSha',
  ]);
  for (const key of Object.keys(payload)) {
    if (!allowedTopLevelKeys.has(key)) {
      throw new Error(`Unknown telemetry field: ${key}`);
    }
  }
  if (!isEventName(payload.name)) {
    throw new Error('Unknown Doc Hub telemetry event name');
  }

  const propertiesInput = payload.properties === undefined ? {} : toRecord(payload.properties);
  const schema = eventSchemas[payload.name] as Record<string, PropertyRule>;
  for (const key of Object.keys(propertiesInput)) {
    if (!Object.prototype.hasOwnProperty.call(schema, key)) {
      throw new Error(`Unknown telemetry property: ${key}`);
    }
  }

  const properties: Record<string, string | number | boolean> = {};
  for (const [key, rule] of Object.entries(schema)) {
    if (!Object.prototype.hasOwnProperty.call(propertiesInput, key)) {
      throw new Error(`Missing telemetry property: ${key}`);
    }
    properties[key] = parseProperty(key, propertiesInput[key], rule);
  }

  const environment = safeReleaseValue(release.environment);
  if (!environment) throw new Error('Invalid release environment');
  const gitSha = release.gitSha === null ? null : safeReleaseValue(release.gitSha);
  if (release.gitSha !== null && !gitSha) throw new Error('Invalid release git SHA');
  const buildId = safeReleaseValue(release.buildId);

  return {
    name: payload.name,
    properties,
    environment,
    gitSha,
    ...(buildId ? { buildId } : {}),
  };
}

export function registerDocHubTelemetryRoute(
  app: Express,
  options: {
    releaseRoot?: string;
    record?: (event: ParsedDocHubTelemetryEvent & { recordedAt: string }) => void;
  } = {},
): void {
  const record = options.record ?? ((event) => {
    console.info('[doc-hub-telemetry]', JSON.stringify(event));
  });

  app.post('/api/telemetry/doc-hub', (request, response) => {
    try {
      const release = readReleaseInfo(options.releaseRoot);
      const event = parseDocHubTelemetryEvent(request.body, {
        environment: release.environment,
        gitSha: release.gitSha,
        buildId: release.artifactHash ?? release.version,
      });
      record({ ...event, recordedAt: new Date().toISOString() });
      response.status(202).json({ accepted: true });
    } catch {
      response.status(400).json({ error: 'Invalid Doc Hub telemetry event.' });
    }
  });
}
