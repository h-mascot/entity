import express from 'express';
import http from 'http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  CreateNotificationDeliveryInput,
  CreateNotificationInput,
  NotificationDeliveryRecord,
  NotificationRecord,
  NotificationRepository,
} from '../../../db/src';
import { createNotificationRouter } from './notifications';

const now = '2026-06-24T04:30:00.000Z';

function createMemoryNotificationRepository(): NotificationRepository {
  const notifications = new Map<string, NotificationRecord>();
  let nextDeliveryId = 1;

  function createDelivery(notificationId: string, input: CreateNotificationDeliveryInput): NotificationDeliveryRecord {
    return {
      id: nextDeliveryId++,
      notification_id: notificationId,
      channel: input.channel as NotificationDeliveryRecord['channel'],
      status: (input.status ?? 'pending') as NotificationDeliveryRecord['status'],
      external_ref: input.external_ref ?? null,
      failure_reason: input.failure_reason ?? null,
      degraded_reason: input.degraded_reason ?? null,
      policy_reason_json: input.policy_reason_json ?? '{}',
      attempted_at: now,
      completed_at: input.completed_at ?? null,
      metadata_json: input.metadata_json ?? '{}',
    };
  }

  return {
    createNotification: (input: CreateNotificationInput) => {
      const id = input.id ?? `notification-${notifications.size + 1}`;
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
        created_at: now,
        updated_at: now,
        deliveries: (input.deliveries ?? []).map((delivery) => createDelivery(id, delivery)),
      };
      notifications.set(id, notification);
      return notification;
    },
    getNotification: (id) => notifications.get(id),
    listNotificationsForRecipient: (input) => [...notifications.values()]
      .filter((notification) => notification.recipient_principal_id === input.recipient_principal_id)
      .filter((notification) => !input.org_id || notification.org_id === input.org_id)
      .filter((notification) => !input.inbox_state || input.inbox_state === 'all' || notification.inbox_state === input.inbox_state)
      .slice(0, input.limit ?? 100),
    updateInboxState: (id, inboxState) => {
      const notification = notifications.get(id);
      if (!notification) return undefined;
      const updated = { ...notification, inbox_state: inboxState as NotificationRecord['inbox_state'], updated_at: now };
      notifications.set(id, updated);
      return updated;
    },
    addDeliveryAttempt: (notificationId, input) => {
      const notification = notifications.get(notificationId);
      if (!notification) throw new Error('notification does not exist');
      const delivery = createDelivery(notificationId, input);
      notifications.set(notificationId, { ...notification, deliveries: [...notification.deliveries, delivery] });
      return delivery;
    },
    listDeliveryAttempts: (notificationId) => notifications.get(notificationId)?.deliveries ?? [],
  };
}

async function startServer(repo: NotificationRepository) {
  const app = express();
  app.use(express.json());
  app.use('/api/notifications', createNotificationRouter({ notificationRepository: repo }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server failed to bind');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())),
  };
}

describe('notification routes', () => {
  let repo: NotificationRepository;
  let server: Awaited<ReturnType<typeof startServer>>;

  beforeEach(async () => {
    repo = createMemoryNotificationRepository();
    server = await startServer(repo);
  });

  afterEach(async () => {
    await server.close();
  });

  it('lists canonical notification state separately from external delivery state', async () => {
    repo.createNotification({
      id: 'notification-1',
      recipient_principal_id: 'owner-1',
      canonical_event_id: 'activity-1',
      object_ref: { object_type: 'task', object_id: '42', link_role: 'target' },
      notification_type: 'receipt_failure',
      title: 'Receipt failed',
      body: 'Receipt writer failed.',
      policy_reason_chain_json: JSON.stringify([{ source: 'receipt', decision: 'notify_owner', reason: 'missing evidence' }]),
      deliveries: [
        { channel: 'entity_inbox', status: 'sent' },
        { channel: 'email', status: 'failed', failure_reason: 'SMTP unavailable' },
        { channel: 'slack', status: 'degraded', degraded_reason: 'workspace degraded' },
      ],
    });

    const response = await fetch(`${server.baseUrl}/api/notifications?recipientPrincipalId=owner-1&inboxState=all`);
    expect(response.status).toBe(200);
    const payload = await response.json() as any;

    expect(payload.total).toBe(1);
    expect(payload.notifications[0]).toMatchObject({
      id: 'notification-1',
      canonical_state: 'unread',
      object_href: '/tasks/42',
      external_delivery_summary: [
        { channel: 'entity_inbox', status: 'sent' },
        { channel: 'email', status: 'failed', failure_reason: 'SMTP unavailable' },
        { channel: 'slack', status: 'degraded', degraded_reason: 'workspace degraded' },
      ],
    });
  });

  it('updates inbox state and rejects malformed queries', async () => {
    repo.createNotification({
      id: 'notification-2',
      recipient_principal_id: 'owner-1',
      canonical_event_id: 'activity-2',
      object_ref: { object_type: 'task', object_id: '77', link_role: 'target' },
      notification_type: 'review_request',
      title: 'Review requested',
    });

    const missingRecipient = await fetch(`${server.baseUrl}/api/notifications`);
    expect(missingRecipient.status).toBe(400);

    const update = await fetch(`${server.baseUrl}/api/notifications/notification-2`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inbox_state: 'read' }),
    });
    expect(update.status).toBe(200);
    expect((await update.json() as any).notification).toMatchObject({
      id: 'notification-2',
      inbox_state: 'read',
      canonical_state: 'read',
    });
  });
});
