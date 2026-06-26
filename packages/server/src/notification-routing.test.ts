import { describe, expect, it, vi } from 'vitest';
import type {
  CreateNotificationDeliveryInput,
  CreateNotificationInput,
  NotificationDeliveryRecord,
  NotificationRecord,
  NotificationRepository,
} from '../../db/src';
import {
  createNotificationRoutingService,
  resolveNotificationChannels,
  sanitizeNotificationDeliveryMetadata,
  type NotificationDeliveryAdapter,
} from './notification-routing';

function createMemoryNotificationRepository(): NotificationRepository {
  const notifications = new Map<string, NotificationRecord>();
  let nextDeliveryId = 1;

  const buildDelivery = (
    notificationId: string,
    input: CreateNotificationDeliveryInput,
  ): NotificationDeliveryRecord => ({
    id: nextDeliveryId++,
    notification_id: notificationId,
    channel: input.channel as NotificationDeliveryRecord['channel'],
    status: (input.status ?? 'pending') as NotificationDeliveryRecord['status'],
    external_ref: input.external_ref ?? null,
    failure_reason: input.failure_reason ?? null,
    degraded_reason: input.degraded_reason ?? null,
    policy_reason_json: input.policy_reason_json ?? '{}',
    attempted_at: '2026-06-24T04:00:00.000Z',
    completed_at: input.completed_at ?? null,
    metadata_json: input.metadata_json ?? '{}',
  });

  return {
    createNotification: (input: CreateNotificationInput) => {
      const id = input.id ?? `notification-${notifications.size + 1}`;
      const deliveries = (input.deliveries ?? []).map((delivery) => buildDelivery(id, delivery));
      const notification: NotificationRecord = {
        id,
        org_id: input.org_id ?? 'default-org',
        recipient_principal_id: input.recipient_principal_id,
        canonical_event_id: String(input.canonical_event_id),
        object_ref: input.object_ref,
        notification_type: input.notification_type as NotificationRecord['notification_type'],
        inbox_state: (input.inbox_state ?? 'unread') as NotificationRecord['inbox_state'],
        title: input.title,
        body: input.body ?? '',
        policy_reason_chain_json: input.policy_reason_chain_json ?? '[]',
        metadata_json: input.metadata_json ?? '{}',
        created_at: '2026-06-24T04:00:00.000Z',
        updated_at: '2026-06-24T04:00:00.000Z',
        deliveries,
      };
      notifications.set(id, notification);
      return notification;
    },
    getNotification: (id: string) => notifications.get(id),
    listNotificationsForRecipient: () => [...notifications.values()],
    updateInboxState: (id, inboxState) => {
      const notification = notifications.get(id);
      if (!notification) return undefined;
      const updated = { ...notification, inbox_state: inboxState as NotificationRecord['inbox_state'] };
      notifications.set(id, updated);
      return updated;
    },
    addDeliveryAttempt: (notificationId, input) => {
      const notification = notifications.get(notificationId);
      if (!notification) throw new Error('notification does not exist');
      const delivery = buildDelivery(notificationId, input);
      const updated = { ...notification, deliveries: [...notification.deliveries, delivery] };
      notifications.set(notificationId, updated);
      return delivery;
    },
    listDeliveryAttempts: (notificationId) => notifications.get(notificationId)?.deliveries ?? [],
  };
}

function baseInput() {
  return {
    orgId: 'org-a',
    recipientPrincipalId: 'owner-1',
    canonicalEventId: 'activity-1',
    objectRef: { object_type: 'task', object_id: '42', link_role: 'target' },
    notificationType: 'review_request' as const,
    title: 'Review requested',
    body: 'Review this task.',
  };
}

describe('notification routing service', () => {
  it('creates the Entity inbox notification before recording external delivery failure', async () => {
    const repo = createMemoryNotificationRepository();
    const failingEmail: NotificationDeliveryAdapter = {
      channel: 'email',
      deliver: vi.fn(() => {
        throw new Error('provider authorization=abc123 unavailable');
      }),
    };
    const service = createNotificationRoutingService({
      notificationRepository: repo,
      adapters: [failingEmail],
    });

    const result = await service.routeNotification({
      ...baseInput(),
      urgency: 'high',
      preferredChannels: ['email'],
      policyReasonChain: [
        { source: 'task', decision: 'notification_route', value: ['email'], reason: 'reviewer preference' },
      ],
    });

    expect(result.notification).toMatchObject({
      recipient_principal_id: 'owner-1',
      notification_type: 'review_request',
      inbox_state: 'unread',
    });
    expect(result.deliveries.map((delivery) => ({ channel: delivery.channel, status: delivery.status }))).toEqual([
      { channel: 'entity_inbox', status: 'sent' },
      { channel: 'email', status: 'failed' },
    ]);
    expect(result.deliveries[1].failure_reason).toBe('provider authorization=[redacted] unavailable');
    expect(failingEmail.deliver).toHaveBeenCalledOnce();
  });

  it('routes by preferences and channel availability without losing canonical notification', async () => {
    const repo = createMemoryNotificationRepository();
    const webhookAdapter: NotificationDeliveryAdapter = {
      channel: 'webhook',
      deliver: vi.fn(() => ({ status: 'sent' as const, externalRef: 'webhook-1' })),
    };
    const service = createNotificationRoutingService({
      notificationRepository: repo,
      adapters: [webhookAdapter],
    });

    const result = await service.routeNotification({
      ...baseInput(),
      notificationType: 'owner_escalation',
      preferredChannels: ['slack', 'webhook', 'email'],
      channelAvailability: {
        slack: 'unavailable',
        webhook: 'available',
        email: 'degraded',
      },
    });

    expect(result.selectedChannels).toEqual(['slack', 'webhook', 'email']);
    expect(result.deliveries.map((delivery) => ({ channel: delivery.channel, status: delivery.status }))).toEqual([
      { channel: 'entity_inbox', status: 'sent' },
      { channel: 'slack', status: 'skipped' },
      { channel: 'webhook', status: 'sent' },
      { channel: 'email', status: 'degraded' },
    ]);
    expect(repo.getNotification(result.notification.id)?.deliveries).toHaveLength(4);
  });

  it('does not depend on external channel success to retain the canonical notification claim', async () => {
    const repo = createMemoryNotificationRepository();
    const failingEmail: NotificationDeliveryAdapter = {
      channel: 'email',
      deliver: vi.fn(() => {
        throw new Error('mail relay unavailable');
      }),
    };
    const service = createNotificationRoutingService({
      notificationRepository: repo,
      adapters: [failingEmail],
    });

    const result = await service.routeNotification({
      ...baseInput(),
      notificationType: 'connector_degraded',
      title: 'Connector degraded',
      preferredChannels: ['email', 'slack', 'webhook'],
      channelAvailability: {
        slack: 'unavailable',
        webhook: 'degraded',
      },
    });

    const stored = repo.getNotification(result.notification.id);
    expect(stored).toMatchObject({
      inbox_state: 'unread',
      notification_type: 'connector_degraded',
      recipient_principal_id: 'owner-1',
    });
    expect(stored?.deliveries.map((delivery) => ({ channel: delivery.channel, status: delivery.status }))).toEqual([
      { channel: 'entity_inbox', status: 'sent' },
      { channel: 'email', status: 'failed' },
      { channel: 'slack', status: 'skipped' },
      { channel: 'webhook', status: 'degraded' },
    ]);
    expect(stored?.deliveries.some((delivery) => delivery.channel !== 'entity_inbox' && delivery.status === 'sent')).toBe(false);
    expect(stored?.deliveries[0].policy_reason_json).toContain('canonical Entity inbox record created first');
  });

  it('defaults high-risk notifications to ClickClack and email routes', () => {
    expect(resolveNotificationChannels({
      ...baseInput(),
      riskLevel: 'critical',
    })).toEqual(['clickclack', 'email']);
  });

  it('redacts sensitive adapter metadata and external refs before delivery attempts are stored', async () => {
    const repo = createMemoryNotificationRepository();
    const adapter: NotificationDeliveryAdapter = {
      channel: 'webhook',
      deliver: vi.fn((request) => ({
        status: 'sent' as const,
        externalRef: 'authorization=raw-value',
        metadata: {
          echoed: request.metadata,
          authorization: 'Bearer raw-value',
          nested: { credential: 'raw-value', ok: true },
        },
      })),
    };
    const service = createNotificationRoutingService({ notificationRepository: repo, adapters: [adapter] });

    const result = await service.routeNotification({
      ...baseInput(),
      preferredChannels: ['webhook'],
      metadata: {
        authorization: 'Bearer raw-value',
        safe: 'visible',
      },
    });

    expect(JSON.parse(result.notification.metadata_json)).toMatchObject({
      authorization: '[redacted]',
      safe: 'visible',
    });
    expect(result.deliveries[1].external_ref).toBe('authorization=[redacted]');
    expect(JSON.parse(result.deliveries[1].metadata_json)).toMatchObject({
      authorization: '[redacted]',
      nested: { credential: '[redacted]', ok: true },
      echoed: { authorization: '[redacted]', safe: 'visible' },
    });
    expect(sanitizeNotificationDeliveryMetadata('authorization=abc123')).toBe('authorization=[redacted]');
  });
});
