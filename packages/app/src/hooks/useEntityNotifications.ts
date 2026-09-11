import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildApiCandidates, requestJsonWithFallback, toErrorMessage } from '../lib/http.ts';
import type { UserProfile } from '../lib/userProfile.ts';

/**
 * Exact inbox principal identities for the local profile's notifications.
 *
 * Two legitimate producer paths address reminders with different profile
 * fields, and both must stay visible:
 * - Mission Control stamps the profile displayName into UI-created task
 *   principal fields (assignee options, created_by/initiator/owner), so
 *   task-driven reminders are addressed by displayName.
 * - API-created tasks may store the profile handle in owner/initiator
 *   (server persists request principals verbatim), so reminders can be
 *   addressed by handle.
 * Identities are queried individually and exactly — no case folding, no
 * directory mapping; distinct spellings (including case variants) are
 * distinct opaque ids and are all queried.
 */
export function inboxRecipientPrincipalIds(
  profile: Pick<UserProfile, 'displayName' | 'handle'>
): string[] {
  const identities: string[] = [];
  for (const value of [profile.displayName, profile.handle]) {
    const id = value.trim();
    if (id && !identities.includes(id)) {
      identities.push(id);
    }
  }
  return identities;
}

/** One exact-recipient inbox query per identity, in the same shape the bell route serves. */
export function buildInboxRequestPaths(recipientPrincipalIds: string[]): string[] {
  return recipientPrincipalIds
    .map((id) => id.trim())
    .filter(Boolean)
    .map((recipient) => {
      const query = new URLSearchParams({ recipientPrincipalId: recipient, inboxState: 'all' });
      return `/notifications?${query.toString()}`;
    });
}

/** Union per-identity inbox listings by notification id, newest first (mirrors repository ordering). */
export function unionNotificationsById(lists: EntityNotification[][]): EntityNotification[] {
  const byId = new Map<string, EntityNotification>();
  for (const list of lists) {
    for (const item of list) {
      if (!byId.has(item.id)) {
        byId.set(item.id, item);
      }
    }
  }
  return [...byId.values()].sort((a, b) =>
    a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1
  );
}

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
  recipientPrincipalIds,
  enabled,
}: {
  apiBase?: string;
  recipientPrincipalIds: string[];
  enabled: boolean;
}) {
  const [notifications, setNotifications] = useState<EntityNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recompute only when the exact identity set changes, not on every render
  // (callers may pass a fresh array literal each render).
  const recipientKey = JSON.stringify(recipientPrincipalIds);
  const requestPaths = useMemo(
    () => buildInboxRequestPaths(JSON.parse(recipientKey) as string[]),
    [recipientKey]
  );

  const load = useCallback(async () => {
    if (!enabled || requestPaths.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      // One exact-recipient query per profile identity. Each goes through the
      // shared request helper so the stored API bearer token (authenticated
      // principal context) and error semantics stay identical to before.
      const payloads = await Promise.all(
        requestPaths.map((path) =>
          requestJsonWithFallback<EntityNotificationsPayload>({
            urls: buildApiCandidates(path, apiBase),
            fallbackError: 'Unable to load Entity notifications.',
          })
        )
      );
      setNotifications(
        unionNotificationsById(
          payloads.map((payload) => (Array.isArray(payload.notifications) ? payload.notifications : []))
        )
      );
    } catch (err) {
      setError(toErrorMessage(err, 'Unable to load Entity notifications.'));
    } finally {
      setLoading(false);
    }
  }, [apiBase, enabled, requestPaths]);

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
