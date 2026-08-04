/**
 * CH-A-02 / THE-918 — Channel adapter interface.
 *
 * Bidirectional contract:
 *   intake → task / ActivityEvent proposals (host applies; adapters do not write)
 *   notify ← status (Entity status changes fan out to external channels)
 *
 * CH-A-03 Slack reference adapter: ENTITY_CHANNEL_SLACK_ADAPTER + offline transport.
 * CH-A-04: applyChannelIntakeProposals is the sole host write path; adapters
 * must not become alternate task truth stores.
 */

import type {
  NotificationDeliveryAdapter,
  NotificationDeliveryRequest,
  NotificationDeliveryResult,
} from '../notification-routing';
import {
  sanitizeChannelMetadata,
  sanitizeChannelPublicText,
} from './sanitize';
import {
  CHANNEL_ADAPTER_KINDS,
  channelKindToNotificationChannel,
  type ChannelAdapterAvailability,
  type ChannelAdapterKind,
  type ChannelExternalRef,
  type ChannelIntakeActivityProposal,
  type ChannelIntakeMessage,
  type ChannelIntakeMode,
  type ChannelIntakeParseResult,
  type ChannelIntakeTaskProposal,
  type ChannelNotifyResult,
  type ChannelStatusNotifyRequest,
} from './types';

export interface ChannelAdapterDescriptor {
  id: string;
  kind: ChannelAdapterKind;
  /** Human label for admin/debug; never includes secrets. */
  displayName: string;
  /** When false, host must not register for production notify/intake. */
  enabled: boolean;
}

/**
 * Minimal channel adapter surface for Entity Phase A.
 *
 * Implementations parse inbound messages into host-applied proposals and
 * deliver outbound status notifications. They must not persist tasks or
 * ActivityEvents themselves.
 */
export interface ChannelAdapter extends ChannelAdapterDescriptor {
  getAvailability: () => ChannelAdapterAvailability | Promise<ChannelAdapterAvailability>;

  /**
   * Normalize provider-specific inbound payload into intake proposals.
   * Success path returns task and/or activity proposals; failure is explicit.
   */
  parseIntake: (raw: unknown) => ChannelIntakeParseResult | Promise<ChannelIntakeParseResult>;

  /**
   * Notify the external channel of an Entity task status change.
   * Unavailable/not_configured adapters should return skipped/degraded,
   * never invent a healthy delivery.
   */
  notifyStatus: (
    request: ChannelStatusNotifyRequest,
  ) => ChannelNotifyResult | Promise<ChannelNotifyResult>;
}

export function isChannelAdapterKind(value: unknown): value is ChannelAdapterKind {
  return typeof value === 'string' && (CHANNEL_ADAPTER_KINDS as readonly string[]).includes(value);
}

export function isChannelAdapter(value: unknown): value is ChannelAdapter {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ChannelAdapter>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.trim().length > 0 &&
    isChannelAdapterKind(candidate.kind) &&
    typeof candidate.displayName === 'string' &&
    typeof candidate.enabled === 'boolean' &&
    typeof candidate.getAvailability === 'function' &&
    typeof candidate.parseIntake === 'function' &&
    typeof candidate.notifyStatus === 'function'
  );
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readPositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed) && parsed >= 1) return parsed;
  }
  return null;
}

function normalizeIntakeMode(value: unknown): ChannelIntakeMode | undefined {
  if (value === 'create_task' || value === 'append_activity' || value === 'link_existing_task') {
    return value;
  }
  return undefined;
}

function normalizeExternalRef(raw: Record<string, unknown>): ChannelExternalRef | null {
  const externalId =
    readNonEmptyString(raw.externalId) ??
    readNonEmptyString(raw.external_id) ??
    readNonEmptyString(raw.id);
  if (!externalId) return null;
  return {
    externalId: sanitizeChannelPublicText(externalId),
    threadId: readNonEmptyString(raw.threadId ?? raw.thread_id),
    roomId: readNonEmptyString(raw.roomId ?? raw.room_id ?? raw.channelId ?? raw.channel_id),
    permalink: readNonEmptyString(raw.permalink ?? raw.url),
  };
}

/**
 * Shared normalizer for webhook/poll payloads shaped like ChannelIntakeMessage.
 * Provider-specific adapters may call this after mapping their native shape.
 */
export function normalizeChannelIntakeRaw(
  raw: unknown,
  defaults: { adapterId: string; kind: ChannelAdapterKind },
): ChannelIntakeParseResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      code: 'invalid_intake_payload',
      message: 'Channel intake payload must be a non-null object',
      degraded: true,
      warnings: [{ code: 'invalid_intake_payload', message: 'Expected object payload' }],
    };
  }

  const record = raw as Record<string, unknown>;
  const kindValue = record.kind ?? record.channelKind ?? record.channel_kind ?? defaults.kind;
  if (!isChannelAdapterKind(kindValue)) {
    return {
      ok: false,
      code: 'unknown_channel_kind',
      message: 'Channel kind is missing or unsupported',
      degraded: true,
      warnings: [{ code: 'unknown_channel_kind', message: String(kindValue ?? '') }],
    };
  }

  const externalSource =
    record.external && typeof record.external === 'object' && !Array.isArray(record.external)
      ? (record.external as Record<string, unknown>)
      : record;
  const external = normalizeExternalRef(externalSource);
  if (!external) {
    return {
      ok: false,
      code: 'missing_external_id',
      message: 'Channel intake requires a stable externalId for dedupe',
      degraded: true,
      warnings: [{ code: 'missing_external_id', message: 'externalId is required' }],
    };
  }

  const title =
    sanitizeChannelPublicText(
      readNonEmptyString(record.title) ??
        readNonEmptyString(record.subject) ??
        readNonEmptyString(record.name) ??
        'Channel intake',
    );
  const body = sanitizeChannelPublicText(
    readNonEmptyString(record.body) ??
      readNonEmptyString(record.text) ??
      readNonEmptyString(record.description) ??
      '',
  );

  const taskId = readPositiveInteger(record.taskId ?? record.task_id);
  const mode =
    normalizeIntakeMode(record.mode) ??
    (taskId ? 'append_activity' : 'create_task');

  const warnings: Array<{ code: string; message: string }> = [];
  let degraded = false;

  if (!body && mode !== 'link_existing_task') {
    degraded = true;
    warnings.push({
      code: 'empty_intake_body',
      message: 'Intake body is empty; host should treat as degraded content',
    });
  }

  const message: ChannelIntakeMessage = {
    kind: kindValue,
    adapterId:
      readNonEmptyString(record.adapterId ?? record.adapter_id) ?? defaults.adapterId,
    orgId: readNonEmptyString(record.orgId ?? record.org_id) ?? undefined,
    actorPrincipalId: readNonEmptyString(record.actorPrincipalId ?? record.actor_principal_id),
    external,
    title,
    body,
    occurredAt: readNonEmptyString(record.occurredAt ?? record.occurred_at) ?? undefined,
    taskId,
    mode,
    metadata: (sanitizeChannelMetadata(record.metadata ?? {}) ?? {}) as Record<string, unknown>,
  };

  return {
    ok: true,
    message,
    taskProposal: buildIntakeTaskProposal(message),
    activityProposal: buildIntakeActivityProposal(message),
    degraded,
    warnings,
  };
}

export function buildIntakeTaskProposal(
  message: ChannelIntakeMessage,
): ChannelIntakeTaskProposal | null {
  if (message.mode === 'append_activity' || message.mode === 'link_existing_task') {
    return null;
  }
  return {
    name: message.title,
    description: message.body,
    origin_channel: `${message.kind}:${message.adapterId}`,
    status: 'backlog',
    metadata: {
      ...(message.metadata ?? {}),
      channel: {
        kind: message.kind,
        adapterId: message.adapterId,
        externalId: message.external.externalId,
        threadId: message.external.threadId ?? null,
        roomId: message.external.roomId ?? null,
      },
    },
  };
}

export function buildIntakeActivityProposal(
  message: ChannelIntakeMessage,
): ChannelIntakeActivityProposal | null {
  if (message.mode === 'create_task' && !message.taskId) {
    // Host should append task_created after create; still emit a proposal
    // shaped for post-create linkage when taskId becomes known.
    return {
      taskId: null,
      event: {
        eventType: 'task_created',
        action: 'channel_intake',
        description: `Intake from ${message.kind}: ${message.title}`,
        actorPrincipalId: message.actorPrincipalId ?? undefined,
        actorType: 'system',
        payload: {
          channel: {
            kind: message.kind,
            adapterId: message.adapterId,
            externalId: message.external.externalId,
          },
          source: 'channel_adapter',
        },
        metadata: {
          origin: 'channel_adapter',
          adapterId: message.adapterId,
        },
      },
    };
  }

  if (!message.taskId) {
    return null;
  }

  return {
    taskId: message.taskId,
    event: {
      eventType: 'task_updated',
      action: 'channel_intake',
      description: `Channel update from ${message.kind}: ${message.title}`,
      actorPrincipalId: message.actorPrincipalId ?? undefined,
      actorType: 'system',
      payload: {
        channel: {
          kind: message.kind,
          adapterId: message.adapterId,
          externalId: message.external.externalId,
        },
        source: 'channel_adapter',
        body: message.body,
      },
      metadata: {
        origin: 'channel_adapter',
        adapterId: message.adapterId,
      },
    },
  };
}

/**
 * Wrap a ChannelAdapter.notifyStatus as a NotificationDeliveryAdapter so the
 * existing inbox-first routing library can fan out without a second adapter model.
 */
export function asNotificationDeliveryAdapter(
  adapter: ChannelAdapter,
): NotificationDeliveryAdapter {
  const channel = channelKindToNotificationChannel(adapter.kind);
  return {
    channel,
    deliver: async (request: NotificationDeliveryRequest): Promise<NotificationDeliveryResult> => {
      const availability = await adapter.getAvailability();
      if (availability === 'not_configured' || availability === 'unavailable') {
        return {
          status: 'failed',
          failureReason: `${adapter.id} ${availability}`,
          metadata: { availability, adapterId: adapter.id },
        };
      }

      const taskId =
        readPositiveInteger(
          request.objectRef.object_type === 'task'
            ? request.objectRef.object_id
            : (request.metadata as { taskId?: unknown }).taskId,
        ) ?? 0;

      const notifyRequest: ChannelStatusNotifyRequest = {
        kind: adapter.kind,
        adapterId: adapter.id,
        orgId: request.notification.org_id,
        taskId,
        status: String(
          (request.metadata as { status?: unknown }).status ??
            request.notification.notification_type,
        ),
        title: sanitizeChannelPublicText(request.title),
        body: request.body ? sanitizeChannelPublicText(request.body) : null,
        activityEventId: request.notification.canonical_event_id,
        metadata: (sanitizeChannelMetadata(request.metadata) ?? {}) as Record<string, unknown>,
      };

      const result = await adapter.notifyStatus(notifyRequest);
      if (availability === 'degraded' && result.status === 'sent') {
        return {
          status: 'degraded',
          externalRef: result.externalRef,
          degradedReason: result.degradedReason ?? `${adapter.id} degraded`,
          metadata: { ...(result.metadata ?? {}), availability, adapterId: adapter.id },
        };
      }

      if (result.status === 'skipped') {
        return {
          status: 'failed',
          failureReason: result.failureReason ?? result.degradedReason ?? 'notify skipped',
          metadata: { ...(result.metadata ?? {}), availability, adapterId: adapter.id, skipped: true },
        };
      }

      return {
        status: result.status,
        externalRef: result.externalRef,
        failureReason: result.failureReason,
        degradedReason: result.degradedReason,
        metadata: { ...(result.metadata ?? {}), availability, adapterId: adapter.id },
      };
    },
  };
}

/**
 * Contract stub used only in tests / local characterization.
 * Never registers outbound production credentials.
 */
export function createNullChannelAdapter(
  overrides: Partial<ChannelAdapterDescriptor> & {
    availability?: ChannelAdapterAvailability;
  } = {},
): ChannelAdapter {
  const id = overrides.id ?? 'null-channel';
  const kind = overrides.kind ?? 'other';
  const availability = overrides.availability ?? 'not_configured';

  return {
    id,
    kind,
    displayName: overrides.displayName ?? 'Null channel adapter',
    enabled: overrides.enabled ?? false,
    getAvailability: () => availability,
    parseIntake: (raw) => normalizeChannelIntakeRaw(raw, { adapterId: id, kind }),
    notifyStatus: (request) => {
      if (availability === 'not_configured' || availability === 'unavailable') {
        return {
          status: 'skipped',
          degradedReason: `${id} ${availability}`,
          metadata: {
            adapterId: id,
            taskId: request.taskId,
            status: request.status,
          },
        };
      }
      if (availability === 'degraded') {
        return {
          status: 'degraded',
          degradedReason: `${id} degraded`,
          externalRef: `null:${request.taskId}:${request.status}`,
          metadata: { adapterId: id },
        };
      }
      return {
        status: 'sent',
        externalRef: `null:${request.taskId}:${request.status}`,
        metadata: { adapterId: id },
      };
    },
  };
}
