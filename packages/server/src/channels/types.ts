/**
 * CH-A-02 / THE-918 — Channel adapter contract types.
 *
 * Channels are intake + notify adapters over Entity work state.
 * They must not become alternate task truth stores (CH-A-04 hardens this).
 * Production Slack/Telegram/Discord/email adapters are not mounted by default.
 * CH-A-03 provides a Slack reference adapter behind ENTITY_CHANNEL_SLACK_ADAPTER.
 */

import type { NotificationDeliveryChannel } from '../../../db/src';
import type { ActivityEventAppendInput } from '../activity-events';

/** External channel kinds supported by the adapter contract. */
export const CHANNEL_ADAPTER_KINDS = [
  'clickclack',
  'email',
  'discord',
  'slack',
  'telegram',
  'agentpush',
  'webhook',
  'other',
] as const;

export type ChannelAdapterKind = (typeof CHANNEL_ADAPTER_KINDS)[number];

/**
 * Availability for adapters. Missing/unknown must surface as not_configured
 * or unavailable — never silently coerced to healthy.
 */
export const CHANNEL_ADAPTER_AVAILABILITY = [
  'available',
  'degraded',
  'unavailable',
  'not_configured',
] as const;

export type ChannelAdapterAvailability = (typeof CHANNEL_ADAPTER_AVAILABILITY)[number];

/** How an intake message should land in Entity. */
export type ChannelIntakeMode =
  | 'create_task'
  | 'append_activity'
  | 'link_existing_task';

export interface ChannelExternalRef {
  /** Stable external message/event id for dedupe. */
  externalId: string;
  /** Provider-native thread/conversation id when present. */
  threadId?: string | null;
  /** Provider-native channel/room id when present. */
  roomId?: string | null;
  /** Opaque public-safe permalink (no secrets). */
  permalink?: string | null;
}

/**
 * Normalized inbound payload after adapter parsing.
 * Text and titles are public-safe (secrets redacted by sanitize helpers).
 */
export interface ChannelIntakeMessage {
  kind: ChannelAdapterKind;
  adapterId: string;
  orgId?: string;
  actorPrincipalId?: string | null;
  external: ChannelExternalRef;
  title: string;
  body: string;
  occurredAt?: string;
  /** Optional existing Entity task to append against. */
  taskId?: number | null;
  /** Preferred intake mode; host may override by policy. */
  mode?: ChannelIntakeMode;
  /** Public-safe structured extras only. */
  metadata?: Record<string, unknown>;
}

/** Proposal the host applies — adapters never write tasks themselves. */
export interface ChannelIntakeTaskProposal {
  name: string;
  description: string;
  origin_channel: string;
  status?: string;
  metadata: {
    channel: {
      kind: ChannelAdapterKind;
      adapterId: string;
      externalId: string;
      threadId?: string | null;
      roomId?: string | null;
    };
    [key: string]: unknown;
  };
}

export interface ChannelIntakeActivityProposal {
  taskId: number | null;
  event: ActivityEventAppendInput;
}

export type ChannelIntakeParseResult =
  | {
      ok: true;
      message: ChannelIntakeMessage;
      taskProposal: ChannelIntakeTaskProposal | null;
      activityProposal: ChannelIntakeActivityProposal | null;
      degraded: boolean;
      warnings: Array<{ code: string; message: string }>;
    }
  | {
      ok: false;
      code: string;
      message: string;
      degraded: true;
      warnings: Array<{ code: string; message: string }>;
    };

/** Entity → channel status notify request (notify ← status). */
export interface ChannelStatusNotifyRequest {
  kind: ChannelAdapterKind;
  adapterId: string;
  orgId?: string;
  taskId: number;
  /** Canonical Entity task status / lane. */
  status: string;
  previousStatus?: string | null;
  title: string;
  body?: string | null;
  /** Optional ActivityEvent id that triggered the notify. */
  activityEventId?: number | string | null;
  recipientExternalRef?: string | null;
  objectDeepLink?: string | null;
  /** Public-safe structured extras only. */
  metadata?: Record<string, unknown>;
}

export type ChannelNotifyStatus = 'sent' | 'failed' | 'degraded' | 'skipped';

export interface ChannelNotifyResult {
  status: ChannelNotifyStatus;
  externalRef?: string | null;
  failureReason?: string | null;
  degradedReason?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Maps ChannelAdapterKind onto the existing notification delivery enum.
 * `telegram` is adapter-contract-only today and maps to `other` until
 * NotificationDeliveryChannel gains an explicit telegram value.
 */
export function channelKindToNotificationChannel(
  kind: ChannelAdapterKind,
): NotificationDeliveryChannel {
  switch (kind) {
    case 'clickclack':
    case 'email':
    case 'discord':
    case 'slack':
    case 'agentpush':
    case 'webhook':
    case 'other':
      return kind;
    case 'telegram':
      return 'other';
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
