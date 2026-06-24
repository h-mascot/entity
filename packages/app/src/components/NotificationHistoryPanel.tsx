import { useEffect, useMemo, useRef, useState } from 'react';
import type { EntityNotification } from '../hooks/useEntityNotifications';
import type { NotificationItem, NotificationType } from '../hooks/useNotificationCenter';

function typeAccent(type: NotificationType): { icon: string; ring: string; text: string } {
  switch (type) {
    case 'success':
      return { icon: '✓', ring: 'border-green-500/30 bg-green-500/10', text: 'text-green-200' };
    case 'warning':
      return { icon: '!', ring: 'border-yellow-500/30 bg-yellow-500/10', text: 'text-yellow-100' };
    case 'error':
      return { icon: '×', ring: 'border-red-500/30 bg-red-500/10', text: 'text-red-100' };
    default:
      return { icon: 'i', ring: 'border-[var(--accent)] bg-[var(--surface-accent)]', text: 'text-[var(--text-primary)]' };
  }
}

function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

function formatListTimestamp(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function formatPolicyReasons(value: string): string {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return 'No policy reason recorded.';
    const reasons = parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const record = entry as Record<string, unknown>;
        return [record.source, record.decision, record.reason]
          .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
          .join(': ');
      })
      .filter((entry): entry is string => Boolean(entry));
    return reasons.length > 0 ? reasons.join(' · ') : 'No policy reason recorded.';
  } catch {
    return 'No policy reason recorded.';
  }
}

function deliveryTone(status: string): string {
  if (status === 'failed') return 'border-red-500/30 bg-red-500/10 text-red-100';
  if (status === 'degraded') return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-100';
  if (status === 'sent') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100';
  return 'border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-muted)]';
}

export default function NotificationHistoryPanel({
  isOpen,
  notifications,
  selectedId,
  onClose,
  onSelect,
  onMarkAllRead,
  onClearAll,
  entityNotifications = [],
  entityNotificationsLoading = false,
  entityNotificationsError = null,
  onEntityNotificationRead,
}: {
  isOpen: boolean;
  notifications: readonly NotificationItem[];
  selectedId: string | null;
  onClose: () => void;
  onSelect: (id: string) => void;
  onMarkAllRead: () => void;
  onClearAll: () => void;
  entityNotifications?: readonly EntityNotification[];
  entityNotificationsLoading?: boolean;
  entityNotificationsError?: string | null;
  onEntityNotificationRead?: (id: string) => void;
}) {
  const ANIMATION_MS = 200;
  const [mounted, setMounted] = useState(isOpen);
  const [visible, setVisible] = useState(isOpen);
  const closeTimeoutRef = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const sorted = useMemo(() => [...notifications].sort((a, b) => b.createdAt - a.createdAt), [notifications]);
  const effectiveSelectedId = useMemo(() => {
    if (selectedId && sorted.some((item) => item.id === selectedId)) return selectedId;
    return sorted[0]?.id ?? null;
  }, [selectedId, sorted]);
  const selected = sorted.find((item) => item.id === effectiveSelectedId) ?? null;
  const listRef = useRef<HTMLDivElement | null>(null);
  const hasUnread = useMemo(() => notifications.some((item) => !item.readAt), [notifications]);
  const hasAny = notifications.length > 0;
  const sortedEntityNotifications = useMemo(
    () => [...entityNotifications].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    [entityNotifications],
  );

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      if (panel.contains(event.target as Node)) return;
      onClose();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (closeTimeoutRef.current) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }

    if (isOpen) {
      setMounted(true);
      if (!mounted) {
        setVisible(false);
        window.requestAnimationFrame(() => setVisible(true));
      } else {
        setVisible(true);
      }
      return;
    }

    setVisible(false);
    if (!mounted) return;

    closeTimeoutRef.current = window.setTimeout(() => {
      setMounted(false);
      closeTimeoutRef.current = null;
    }, ANIMATION_MS);
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        window.clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    listRef.current.scrollTop = 0;
  }, [isOpen]);

  if (!isOpen && !mounted) return null;

  return (
    <div className="fixed inset-0 z-[90]">
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className={`absolute right-0 top-0 flex h-full w-[min(28rem,92vw)] flex-col border-l border-[var(--border-primary)] bg-[var(--bg-secondary)] shadow-[0_20px_60px_rgba(0,0,0,0.55)] transition-[transform,opacity] duration-200 ease-out ${
          visible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Notification history"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[var(--text-primary)]">Notifications</div>
            <div className="text-xs text-[var(--text-muted)]">
              {sortedEntityNotifications.length} Entity · {notifications.length} local
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="mc-shell-btn px-2 py-1 text-xs text-[var(--error)] hover:text-[var(--error)] disabled:cursor-not-allowed disabled:opacity-40"
              onClick={onClearAll}
              disabled={!hasAny}
              aria-disabled={!hasAny}
            >
              Clear all
            </button>
            <button
              type="button"
              className="mc-shell-btn px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              onClick={onMarkAllRead}
              disabled={!hasUnread}
              aria-disabled={!hasUnread}
            >
              Mark all read
            </button>
            <button type="button" className="mc-shell-btn px-2 py-1 text-xs" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="border-b border-[var(--border-primary)] px-4 py-3">
          {selected ? (
            <div className="mc-shell-card border border-[var(--border-secondary)] bg-[var(--bg-primary)]/60 p-3">
              <div className="flex items-start gap-3">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-lg border ${typeAccent(selected.type).ring} ${typeAccent(
                    selected.type
                  ).text}`}
                  aria-hidden="true"
                >
                  <span className="text-sm font-semibold">{typeAccent(selected.type).icon}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{selected.title}</div>
                  <div className="mt-1 whitespace-pre-wrap text-sm text-[var(--text-secondary)]">{selected.message}</div>
                  <div className="mt-2 text-xs text-[var(--text-muted)]">{formatTimestamp(selected.createdAt)}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-[var(--text-muted)]">No notifications yet.</div>
          )}
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3 space-y-3">
          <section data-testid="entity-notification-inbox" className="space-y-2" aria-label="Entity notification inbox">
            <div className="flex items-center justify-between px-1">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">Entity inbox</div>
              {entityNotificationsLoading ? <div className="text-[11px] text-[var(--text-muted)]">Loading...</div> : null}
            </div>
            {entityNotificationsError ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                {entityNotificationsError}
              </div>
            ) : null}
            {sortedEntityNotifications.length === 0 && !entityNotificationsLoading ? (
              <div className="rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-muted)]">
                No Entity inbox notifications.
              </div>
            ) : null}
            {sortedEntityNotifications.map((notification) => {
              const metadata = parseJsonRecord(notification.metadata_json);
              const deliveryProblem = notification.deliveries.find((delivery) => delivery.status === 'failed' || delivery.status === 'degraded');
              return (
                <article
                  key={notification.id}
                  data-testid={`entity-notification-${notification.id}`}
                  className="mc-shell-card border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[var(--text-primary)]">{notification.title}</div>
                      <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{notification.body}</div>
                    </div>
                    <span
                      data-testid="entity-notification-canonical-state"
                      className="rounded-full border border-[var(--accent)]/30 bg-[var(--surface-accent)] px-2 py-0.5 text-[11px] text-[var(--accent)]"
                    >
                      Entity: {notification.inbox_state}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1" data-testid="entity-notification-delivery-state">
                    {notification.deliveries.map((delivery) => (
                      <span key={delivery.id} className={`rounded-full border px-2 py-0.5 text-[11px] ${deliveryTone(delivery.status)}`}>
                        {delivery.channel}: {delivery.status}
                      </span>
                    ))}
                  </div>
                  {deliveryProblem ? (
                    <div className="mt-1 text-xs text-yellow-100">
                      {deliveryProblem.failure_reason ?? deliveryProblem.degraded_reason ?? 'External delivery needs attention.'}
                    </div>
                  ) : null}
                  <div data-testid="entity-notification-policy-reason" className="mt-2 text-xs text-[var(--text-muted)]">
                    Policy: {formatPolicyReasons(notification.policy_reason_chain_json)}
                  </div>
                  <div data-testid="entity-notification-object-ref" className="mt-1 text-xs text-[var(--text-muted)]">
                    Object: {notification.object_ref.object_type}:{notification.object_ref.object_id} ({notification.object_ref.link_role})
                    {notification.object_href ? (
                      <a className="ml-2 text-[var(--accent)] hover:underline" href={notification.object_href}>
                        Open
                      </a>
                    ) : null}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
                    <span>{new Date(notification.created_at).toLocaleString()}</span>
                    {metadata.routing && typeof metadata.routing === 'object' ? <span>Routing metadata recorded</span> : null}
                    {notification.inbox_state === 'unread' && onEntityNotificationRead ? (
                      <button type="button" className="mc-shell-btn px-2 py-1 text-[11px]" onClick={() => onEntityNotificationRead(notification.id)}>
                        Mark read
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </section>

          <div className="px-1 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">Local toasts</div>
          {sorted.length === 0 ? (
            <div className="px-1 py-4 text-sm text-[var(--text-muted)]">Nothing to show.</div>
          ) : (
            sorted.map((item) => {
              const accent = typeAccent(item.type);
              const isSelected = item.id === effectiveSelectedId;
              const isUnread = !item.readAt;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`mc-shell-card w-full border px-3 py-2 text-left transition-colors hover:bg-[var(--bg-tertiary)] ${
                    isSelected ? 'border-[var(--accent)] bg-[var(--surface-accent)]' : 'border-[var(--border-secondary)]'
                  }`}
                  onClick={() => onSelect(item.id)}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg border ${accent.ring} ${accent.text}`}
                      aria-hidden="true"
                    >
                      <span className="text-xs font-semibold">{accent.icon}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{item.title}</div>
                        {isUnread ? (
                          <span
                            className="inline-flex h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]"
                            aria-label="Unread"
                            title="Unread"
                          />
                        ) : null}
                        <div className="ml-auto shrink-0 text-[11px] text-[var(--text-muted)]">
                          {formatListTimestamp(item.createdAt)}
                        </div>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">{item.message}</div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
