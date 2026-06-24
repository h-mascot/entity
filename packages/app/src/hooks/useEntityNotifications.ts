import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildApiCandidates, requestJsonWithFallback, toErrorMessage } from '../lib/http';

export interface EntityNotificationDelivery {
  id: number;
  notification_id: string;
  channel: string;
  status: string;
  external_ref: string | null;
  failure_reason: string | null;
  degraded_reason: string | null;
  policy_reason_json: string;
  attempted_at: string;
  completed_at: string | null;
  metadata_json: string;
}

export interface EntityNotification {
  id: string;
  org_id: string;
  recipient_principal_id: string;
  canonical_event_id: string;
  object_ref: {
    object_type: string;
    object_id: string;
    link_role: string;
  };
  notification_type: string;
  inbox_state: string;
  canonical_state?: string;
  title: string;
  body: string;
  policy_reason_chain_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  deliveries: EntityNotificationDelivery[];
  object_href?: string;
}

interface EntityNotificationsPayload {
  notifications?: EntityNotification[];
}

export function useEntityNotifications({
  apiBase = '',
  recipientPrincipalId,
  enabled,
}: {
  apiBase?: string;
  recipientPrincipalId: string;
  enabled: boolean;
}) {
  const [notifications, setNotifications] = useState<EntityNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const recipient = recipientPrincipalId.trim();
    if (!enabled || !recipient) return;
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ recipientPrincipalId: recipient, inboxState: 'all' });
      const payload = await requestJsonWithFallback<EntityNotificationsPayload>({
        urls: buildApiCandidates(`/notifications?${query.toString()}`, apiBase),
        fallbackError: 'Unable to load Entity notifications.',
      });
      setNotifications(Array.isArray(payload.notifications) ? payload.notifications : []);
    } catch (err) {
      setError(toErrorMessage(err, 'Unable to load Entity notifications.'));
    } finally {
      setLoading(false);
    }
  }, [apiBase, enabled, recipientPrincipalId]);

  useEffect(() => {
    void load();
  }, [load]);

  const markState = useCallback(async (id: string, inboxState: 'unread' | 'read' | 'archived') => {
    const payload = await requestJsonWithFallback<{ notification?: EntityNotification }>({
      urls: buildApiCandidates(`/notifications/${encodeURIComponent(id)}`, apiBase),
      init: {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inbox_state: inboxState }),
      },
      fallbackError: 'Unable to update Entity notification.',
    });
    if (payload.notification) {
      setNotifications((current) => current.map((item) => item.id === id ? payload.notification! : item));
    }
  }, [apiBase]);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => notification.inbox_state === 'unread').length,
    [notifications],
  );

  return {
    notifications,
    loading,
    error,
    unreadCount,
    reload: load,
    markState,
  };
}
