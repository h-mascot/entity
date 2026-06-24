import { Router } from 'express';
import type {
  NotificationInboxState,
  NotificationRecord,
  NotificationRepository,
} from '../../../db/src';

export interface NotificationRouterDeps {
  notificationRepository: NotificationRepository;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readInboxState(value: unknown): NotificationInboxState | 'all' | null {
  const normalized = readString(value)?.toLowerCase();
  if (!normalized) return null;
  if (normalized === 'all' || normalized === 'unread' || normalized === 'read' || normalized === 'archived') {
    return normalized;
  }
  return null;
}

function serializeNotification(notification: NotificationRecord) {
  return {
    ...notification,
    canonical_state: notification.inbox_state,
    external_delivery_summary: notification.deliveries.map((delivery) => ({
      channel: delivery.channel,
      status: delivery.status,
      failure_reason: delivery.failure_reason,
      degraded_reason: delivery.degraded_reason,
    })),
    object_href: `/${notification.object_ref.object_type}s/${notification.object_ref.object_id}`,
  };
}

export function createNotificationRouter({ notificationRepository }: NotificationRouterDeps): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const recipientPrincipalId =
      readString(req.query.recipientPrincipalId) ??
      readString(req.query.recipient_principal_id);
    if (!recipientPrincipalId) {
      return res.status(400).json({ error: 'recipientPrincipalId query parameter is required' });
    }

    const inboxState = readInboxState(req.query.inboxState ?? req.query.inbox_state) ?? 'all';
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 100;
    const notifications = notificationRepository
      .listNotificationsForRecipient({
        org_id: readString(req.query.orgId ?? req.query.org_id) ?? undefined,
        recipient_principal_id: recipientPrincipalId,
        inbox_state: inboxState,
        limit,
      })
      .map(serializeNotification);

    return res.json({
      notifications,
      total: notifications.length,
      recipient_principal_id: recipientPrincipalId,
      inbox_state: inboxState,
    });
  });

  router.patch('/:id', (req, res) => {
    const inboxState = readInboxState(req.body?.inbox_state ?? req.body?.inboxState);
    if (!inboxState || inboxState === 'all') {
      return res.status(400).json({ error: 'inbox_state must be unread, read, or archived' });
    }

    try {
      const updated = notificationRepository.updateInboxState(String(req.params.id), inboxState);
      if (!updated) {
        return res.status(404).json({ error: 'notification not found' });
      }
      return res.json({ notification: serializeNotification(updated) });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'invalid notification update' });
    }
  });

  return router;
}
