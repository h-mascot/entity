/**
 * CH-A-03 / THE-919 — Slack reference adapter behind feature flag.
 *
 * - Feature flag: ENTITY_CHANNEL_SLACK_ADAPTER=1 (default off)
 * - Default transport: deterministic offline/fake (no production Slack sends)
 * - Host applies intake proposals; this adapter never writes task truth
 * - Public outputs are sanitized; tokens/credentials never appear in results
 */

import type { ChannelAdapter } from './adapter';
import { isChannelAdapter, normalizeChannelIntakeRaw } from './adapter';
import {
  isSlackReferenceAdapterEnabled,
  SLACK_REFERENCE_FEATURE_FLAG,
} from './feature-flag';
import type { ChannelAdapterRegistry } from './registry';
import {
  sanitizeChannelMetadata,
  sanitizeChannelPublicText,
} from './sanitize';
import {
  createOfflineSlackTransport,
  type SlackTransport,
} from './slack-transport';
import type {
  ChannelAdapterAvailability,
  ChannelIntakeParseResult,
  ChannelNotifyResult,
  ChannelStatusNotifyRequest,
} from './types';

export const SLACK_REFERENCE_ADAPTER_ID = 'slack-reference';
export const SLACK_REFERENCE_DISPLAY_NAME = 'Slack reference adapter';

export {
  isSlackReferenceAdapterEnabled,
  SLACK_REFERENCE_FEATURE_FLAG,
} from './feature-flag';

export interface SlackReferenceAdapterOptions {
  /** Override env feature flag. Tests may force-enable. Default: env. */
  featureEnabled?: boolean;
  /** Injected transport. Defaults to offline fake transport. */
  transport?: SlackTransport;
  id?: string;
  displayName?: string;
  /** Default Slack channel / room id for notify when request omits one. */
  defaultChannel?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Map a Slack Events API-ish message payload into the shared intake normalizer.
 * Accepts either Slack-native shapes or already-normalized ChannelIntake fields.
 */
export function mapSlackIntakeRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return raw;
  }

  const record = raw as Record<string, unknown>;
  const event =
    record.event && typeof record.event === 'object' && !Array.isArray(record.event)
      ? (record.event as Record<string, unknown>)
      : record;

  const externalId =
    readNonEmptyString(record.externalId) ??
    readNonEmptyString(record.external_id) ??
    readNonEmptyString(event.ts) ??
    readNonEmptyString(event.client_msg_id) ??
    readNonEmptyString(record.ts);

  const text =
    readNonEmptyString(record.body) ??
    readNonEmptyString(record.text) ??
    readNonEmptyString(event.text) ??
    '';

  const title =
    readNonEmptyString(record.title) ??
    readNonEmptyString(record.subject) ??
    (text ? text.slice(0, 80) : 'Slack intake');

  const roomId =
    readNonEmptyString(record.roomId) ??
    readNonEmptyString(record.channel) ??
    readNonEmptyString(event.channel) ??
    readNonEmptyString(
      event.channel && typeof event.channel === 'object'
        ? (event.channel as { id?: unknown }).id
        : null,
    );

  const threadId =
    readNonEmptyString(record.threadId) ??
    readNonEmptyString(record.thread_ts) ??
    readNonEmptyString(event.thread_ts);

  return {
    kind: 'slack',
    adapterId: readNonEmptyString(record.adapterId) ?? SLACK_REFERENCE_ADAPTER_ID,
    orgId: record.orgId ?? record.org_id,
    actorPrincipalId: record.actorPrincipalId ?? record.actor_principal_id,
    externalId,
    threadId,
    roomId,
    title,
    body: text,
    text,
    occurredAt: record.occurredAt ?? record.occurred_at,
    taskId: record.taskId ?? record.task_id,
    mode: record.mode,
    metadata: {
      ...(typeof record.metadata === 'object' && record.metadata && !Array.isArray(record.metadata)
        ? (record.metadata as Record<string, unknown>)
        : {}),
      slack: {
        type: readNonEmptyString(event.type) ?? readNonEmptyString(record.type),
        user: readNonEmptyString(event.user) ?? readNonEmptyString(record.user),
      },
    },
  };
}

function resolveAvailability(input: {
  featureEnabled: boolean;
  transport: SlackTransport;
}): ChannelAdapterAvailability {
  if (!input.featureEnabled) return 'not_configured';
  const health = input.transport.getHealth();
  if (health === 'offline' || health === 'unavailable') return 'unavailable';
  if (health === 'degraded' || input.transport.mode === 'offline') return 'degraded';
  return 'available';
}

function buildNotifyText(request: ChannelStatusNotifyRequest): string {
  const title = sanitizeChannelPublicText(request.title);
  const body = request.body ? sanitizeChannelPublicText(request.body) : '';
  const status = sanitizeChannelPublicText(request.status);
  const previous = request.previousStatus
    ? sanitizeChannelPublicText(request.previousStatus)
    : null;
  const statusLine = previous
    ? `Status: ${previous} → ${status}`
    : `Status: ${status}`;
  return [title, statusLine, body].filter(Boolean).join('\n');
}

export function createSlackReferenceAdapter(
  options: SlackReferenceAdapterOptions = {},
): ChannelAdapter {
  const env = options.env ?? process.env;
  const featureEnabled =
    options.featureEnabled ?? isSlackReferenceAdapterEnabled(env);
  const transport = options.transport ?? createOfflineSlackTransport({
    defaultChannel: options.defaultChannel,
  });
  const id = options.id ?? SLACK_REFERENCE_ADAPTER_ID;
  const displayName = options.displayName ?? SLACK_REFERENCE_DISPLAY_NAME;
  const defaultChannel = options.defaultChannel ?? 'C-reference';

  const adapter: ChannelAdapter = {
    id,
    kind: 'slack',
    displayName,
    enabled: featureEnabled,
    getAvailability: () => resolveAvailability({ featureEnabled, transport }),
    parseIntake: (raw: unknown): ChannelIntakeParseResult => {
      if (!featureEnabled) {
        return {
          ok: false,
          code: 'adapter_disabled',
          message: 'Slack reference adapter feature flag is off',
          degraded: true,
          warnings: [
            {
              code: 'feature_flag_disabled',
              message: `${SLACK_REFERENCE_FEATURE_FLAG} is not enabled`,
            },
          ],
        };
      }
      return normalizeChannelIntakeRaw(mapSlackIntakeRaw(raw), {
        adapterId: id,
        kind: 'slack',
      });
    },
    notifyStatus: async (
      request: ChannelStatusNotifyRequest,
    ): Promise<ChannelNotifyResult> => {
      const availability = resolveAvailability({ featureEnabled, transport });
      const publicMeta = (sanitizeChannelMetadata({
        adapterId: id,
        taskId: request.taskId,
        status: request.status,
        transportMode: transport.mode,
        featureFlag: SLACK_REFERENCE_FEATURE_FLAG,
        featureEnabled,
      }) ?? {}) as Record<string, unknown>;

      if (!featureEnabled || availability === 'not_configured') {
        return {
          status: 'skipped',
          degradedReason: `${id} not_configured`,
          metadata: publicMeta,
        };
      }

      if (availability === 'unavailable') {
        return {
          status: 'skipped',
          degradedReason: `${id} unavailable`,
          failureReason: 'slack_transport_unavailable',
          metadata: publicMeta,
        };
      }

      const channel =
        readNonEmptyString(request.recipientExternalRef) ??
        readNonEmptyString(
          request.metadata && typeof request.metadata === 'object'
            ? (request.metadata as { channel?: unknown; roomId?: unknown }).channel ??
              (request.metadata as { roomId?: unknown }).roomId
            : null,
        ) ??
        defaultChannel;

      const result = await transport.postMessage({
        channel,
        text: buildNotifyText(request),
        threadTs:
          request.metadata && typeof request.metadata === 'object'
            ? readNonEmptyString((request.metadata as { threadTs?: unknown }).threadTs)
            : null,
        metadata: {
          taskId: request.taskId,
          status: request.status,
          activityEventId: request.activityEventId ?? null,
        },
      });

      if (!result.ok) {
        if (result.offline || result.degraded) {
          return {
            status: 'degraded',
            degradedReason: result.error ?? 'slack_transport_offline',
            failureReason: result.error ?? 'slack_transport_offline',
            metadata: {
              ...publicMeta,
              offline: true,
              channel: sanitizeChannelPublicText(result.channel ?? channel),
            },
          };
        }
        return {
          status: 'failed',
          failureReason: result.error ?? 'slack_transport_error',
          metadata: {
            ...publicMeta,
            channel: sanitizeChannelPublicText(result.channel ?? channel),
          },
        };
      }

      const externalRef = result.ts
        ? `slack:${sanitizeChannelPublicText(result.channel ?? channel)}:${result.ts}`
        : `slack:${sanitizeChannelPublicText(channel)}:ack`;

      // Offline transport always surfaces as degraded — never invent live health.
      if (transport.mode === 'offline' || result.degraded || availability === 'degraded') {
        return {
          status: 'degraded',
          externalRef,
          degradedReason: 'slack_reference_offline_transport',
          metadata: {
            ...publicMeta,
            channel: sanitizeChannelPublicText(result.channel ?? channel),
          },
        };
      }

      return {
        status: 'sent',
        externalRef,
        metadata: {
          ...publicMeta,
          channel: sanitizeChannelPublicText(result.channel ?? channel),
        },
      };
    },
  };

  if (!isChannelAdapter(adapter)) {
    throw new Error('slack_reference_adapter_invalid');
  }
  return adapter;
}

/**
 * Register the Slack reference adapter only when the feature flag is enabled.
 * Uses the offline transport by default — never mounts production credentials.
 */
export function registerSlackReferenceAdapterIfEnabled(
  registry: ChannelAdapterRegistry,
  options: Omit<SlackReferenceAdapterOptions, 'featureEnabled'> = {},
): ChannelAdapter | null {
  const env = options.env ?? process.env;
  if (!isSlackReferenceAdapterEnabled(env)) {
    return null;
  }
  const adapter = createSlackReferenceAdapter({
    ...options,
    env,
    featureEnabled: true,
    transport: options.transport ?? createOfflineSlackTransport({
      defaultChannel: options.defaultChannel,
    }),
  });
  registry.register(adapter);
  return adapter;
}
