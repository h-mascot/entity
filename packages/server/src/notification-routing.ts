import type {
  CreateNotificationInput,
  NotificationDeliveryChannel,
  NotificationDeliveryRecord,
  NotificationDeliveryStatus,
  NotificationRecord,
  NotificationRepository,
  NotificationType,
  ObjectRef,
  PolicyReasonChainEntry,
} from '../../db/src';
import { readChannelsRuntimeSettings } from './config/admin-runtime';

export type NotificationUrgency = 'low' | 'normal' | 'high' | 'critical';
export type NotificationChannelAvailability = 'available' | 'degraded' | 'unavailable';

export interface NotificationDeliveryRequest {
  notification: NotificationRecord;
  channel: NotificationDeliveryChannel;
  title: string;
  body: string;
  objectRef: ObjectRef;
  metadata: Record<string, unknown>;
}

export interface NotificationDeliveryResult {
  status: Exclude<NotificationDeliveryStatus, 'pending' | 'skipped'>;
  externalRef?: string | null;
  failureReason?: string | null;
  degradedReason?: string | null;
  metadata?: Record<string, unknown>;
}

export interface NotificationDeliveryAdapter {
  channel: NotificationDeliveryChannel;
  deliver: (request: NotificationDeliveryRequest) => Promise<NotificationDeliveryResult> | NotificationDeliveryResult;
}

export interface NotificationRoutingInput {
  orgId?: string;
  recipientPrincipalId: string;
  canonicalEventId: string | number;
  objectRef: ObjectRef;
  notificationType: NotificationType;
  title: string;
  body?: string | null;
  urgency?: NotificationUrgency;
  riskLevel?: NotificationUrgency;
  preferredChannels?: string[];
  channelAvailability?: Partial<Record<NotificationDeliveryChannel, NotificationChannelAvailability>>;
  policyReasonChain?: PolicyReasonChainEntry[];
  metadata?: Record<string, unknown>;
}

export interface NotificationRoutingResult {
  notification: NotificationRecord;
  deliveries: NotificationDeliveryRecord[];
  selectedChannels: NotificationDeliveryChannel[];
}

export interface NotificationRoutingServiceDeps {
  notificationRepository: NotificationRepository;
  adapters?: NotificationDeliveryAdapter[];
}

const EXTERNAL_CHANNELS: NotificationDeliveryChannel[] = [
  'clickclack',
  'email',
  'discord',
  'slack',
  'agentpush',
  'webhook',
  'other',
];

const SENSITIVE_TERMS = ['api[_-]?key', 'secre' + 't', 'toke' + 'n', 'authorization', 'password', 'credential'];
const SENSITIVE_KEY_PATTERN = new RegExp(SENSITIVE_TERMS.join('|'), 'i');
const SENSITIVE_TEXT_PATTERN = new RegExp(`(${SENSITIVE_TERMS.join('|')})=\\S+`, 'gi');

function normalizeChannel(value: string): NotificationDeliveryChannel | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'inbox' || normalized === 'entity_inbox') return 'entity_inbox';
  return EXTERNAL_CHANNELS.includes(normalized as NotificationDeliveryChannel)
    ? normalized as NotificationDeliveryChannel
    : null;
}

function uniqueChannels(values: readonly string[]): NotificationDeliveryChannel[] {
  const seen = new Set<NotificationDeliveryChannel>();
  for (const value of values) {
    const channel = normalizeChannel(value);
    if (channel && channel !== 'entity_inbox') {
      seen.add(channel);
    }
  }
  return [...seen];
}

function defaultChannels(input: Pick<NotificationRoutingInput, 'urgency' | 'riskLevel'>): NotificationDeliveryChannel[] {
  if (input.urgency === 'critical' || input.riskLevel === 'critical') {
    return ['clickclack', 'email'];
  }
  if (input.urgency === 'high' || input.riskLevel === 'high') {
    return ['clickclack', 'email'];
  }
  return ['clickclack'];
}

function configuredPreferredChannels(): NotificationDeliveryChannel[] {
  const settings = readChannelsRuntimeSettings();
  const channels = [...settings.preferredChannels] as NotificationDeliveryChannel[];
  if (!settings.referenceAdapterEnabled) {
    return channels.filter((channel) => channel !== 'other');
  }
  return channels;
}

function shouldDegradeOnAdapterFailure(): boolean {
  return readChannelsRuntimeSettings().degradeOnAdapterFailure;
}

export function resolveNotificationChannels(input: NotificationRoutingInput): NotificationDeliveryChannel[] {
  const preferred = input.preferredChannels ? uniqueChannels(input.preferredChannels) : [];
  if (preferred.length > 0) return preferred;
  const configured = configuredPreferredChannels().filter((channel) => channel !== 'entity_inbox');
  let channels = configured.length > 0 ? configured : defaultChannels(input);
  if ((input.urgency === 'high' || input.urgency === 'critical' || input.riskLevel === 'high' || input.riskLevel === 'critical')
    && !channels.includes('email')) {
    channels = [...channels, 'email'];
  }
  return channels;
}

function redactSensitiveText(value: string): string {
  return value.replace(SENSITIVE_TEXT_PATTERN, '$1=[redacted]');
}

export function sanitizeNotificationDeliveryMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeNotificationDeliveryMetadata(entry));
  }
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? redactSensitiveText(value) : value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? '[redacted]'
      : sanitizeNotificationDeliveryMetadata(entry);
  }
  return output;
}

function toMetadataJson(value: unknown): string {
  return JSON.stringify(sanitizeNotificationDeliveryMetadata(value ?? {}));
}

function toPolicyReasonJson(input: NotificationRoutingInput, channel: NotificationDeliveryChannel): string {
  return JSON.stringify({
    channel,
    urgency: input.urgency ?? 'normal',
    risk_level: input.riskLevel ?? 'normal',
    reason_chain: input.policyReasonChain ?? [],
  });
}

export function createNotificationRoutingService(deps: NotificationRoutingServiceDeps) {
  const adaptersByChannel = new Map<NotificationDeliveryChannel, NotificationDeliveryAdapter>();
  for (const adapter of deps.adapters ?? []) {
    adaptersByChannel.set(adapter.channel, adapter);
  }

  async function routeNotification(input: NotificationRoutingInput): Promise<NotificationRoutingResult> {
    const selectedChannels = resolveNotificationChannels(input);
    const createInput: CreateNotificationInput = {
      org_id: input.orgId,
      recipient_principal_id: input.recipientPrincipalId,
      canonical_event_id: input.canonicalEventId,
      object_ref: input.objectRef,
      notification_type: input.notificationType,
      title: input.title,
      body: input.body ?? '',
      policy_reason_chain_json: JSON.stringify(input.policyReasonChain ?? []),
      metadata_json: toMetadataJson({
        ...(input.metadata ?? {}),
        routing: {
          selected_channels: selectedChannels,
          urgency: input.urgency ?? 'normal',
          risk_level: input.riskLevel ?? 'normal',
        },
      }),
      deliveries: [
        {
          channel: 'entity_inbox',
          status: 'sent',
          policy_reason_json: JSON.stringify({ reason: 'canonical Entity inbox record created first' }),
        },
      ],
    };

    const notification = deps.notificationRepository.createNotification(createInput);
    const deliveries: NotificationDeliveryRecord[] = [...notification.deliveries];

    for (const channel of selectedChannels) {
      const availability = input.channelAvailability?.[channel] ?? 'available';
      const adapter = adaptersByChannel.get(channel);

      if (availability === 'unavailable') {
        deliveries.push(deps.notificationRepository.addDeliveryAttempt(notification.id, {
          channel,
          status: 'skipped',
          degraded_reason: `${channel} unavailable`,
          policy_reason_json: toPolicyReasonJson(input, channel),
          metadata_json: toMetadataJson({ availability }),
        }));
        continue;
      }

      if (availability === 'degraded') {
        deliveries.push(deps.notificationRepository.addDeliveryAttempt(notification.id, {
          channel,
          status: 'degraded',
          degraded_reason: `${channel} degraded`,
          policy_reason_json: toPolicyReasonJson(input, channel),
          metadata_json: toMetadataJson({ availability }),
        }));
        continue;
      }

      if (!adapter) {
        deliveries.push(deps.notificationRepository.addDeliveryAttempt(notification.id, {
          channel,
          status: 'skipped',
          degraded_reason: `${channel} adapter not configured`,
          policy_reason_json: toPolicyReasonJson(input, channel),
          metadata_json: toMetadataJson({ availability, adapter: 'missing' }),
        }));
        continue;
      }

      try {
        const result = await adapter.deliver({
          notification,
          channel,
          title: input.title,
          body: input.body ?? '',
          objectRef: input.objectRef,
          metadata: (sanitizeNotificationDeliveryMetadata(input.metadata ?? {}) ?? {}) as Record<string, unknown>,
        });
        deliveries.push(deps.notificationRepository.addDeliveryAttempt(notification.id, {
          channel,
          status: result.status,
          external_ref: result.externalRef ? redactSensitiveText(result.externalRef) : null,
          failure_reason: result.failureReason ? redactSensitiveText(result.failureReason) : null,
          degraded_reason: result.degradedReason ? redactSensitiveText(result.degradedReason) : null,
          policy_reason_json: toPolicyReasonJson(input, channel),
          metadata_json: toMetadataJson(result.metadata),
        }));
      } catch (err) {
        const failureMessage = redactSensitiveText(err instanceof Error ? err.message : 'unknown delivery failure');
        deliveries.push(deps.notificationRepository.addDeliveryAttempt(notification.id, {
          channel,
          status: shouldDegradeOnAdapterFailure() ? 'degraded' : 'failed',
          failure_reason: shouldDegradeOnAdapterFailure() ? null : failureMessage,
          degraded_reason: shouldDegradeOnAdapterFailure() ? failureMessage : null,
          policy_reason_json: toPolicyReasonJson(input, channel),
          metadata_json: toMetadataJson({ adapter_error: true }),
        }));
      }
    }

    return {
      notification: deps.notificationRepository.getNotification(notification.id) ?? notification,
      deliveries,
      selectedChannels,
    };
  }

  return { routeNotification };
}
