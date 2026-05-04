import { useCallback, useEffect, useMemo, useState } from 'react';

export type NotificationType = 'success' | 'error' | 'info' | 'warning';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  createdAt: number;
  readAt: number | null;
}

export interface ToastItem {
  id: string;
  notificationId: string;
  type: NotificationType;
  title: string;
  message: string;
  createdAt: number;
  ttlMs: number;
}

export interface PushToastOptions {
  title?: string;
  ttlMs?: number;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultTitleForType(type: NotificationType): string {
  switch (type) {
    case 'success':
      return 'Success';
    case 'error':
      return 'Error';
    case 'warning':
      return 'Warning';
    default:
      return 'Info';
  }
}

export function useNotificationCenter({
  maxVisibleToasts = 3,
  toastTtlMs = 5000,
  maxStoredNotifications = 50,
}: {
  maxVisibleToasts?: number;
  toastTtlMs?: number;
  maxStoredNotifications?: number;
} = {}) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedNotificationId, setSelectedNotificationId] = useState<string | null>(null);

  const unreadCount = useMemo(
    () => notifications.reduce((count, item) => count + (item.readAt ? 0 : 1), 0),
    [notifications]
  );

  const pushToast = useCallback(
    (message: string, type: NotificationType = 'info', options?: string | PushToastOptions) => {
      const createdAt = Date.now();
      const notificationId = createId('notif');
      const toastId = createId('toast');
      const resolvedOptions = typeof options === 'string' ? { title: options } : options ?? {};
      const resolvedTitle = resolvedOptions.title ?? defaultTitleForType(type);
      const resolvedTtlMs =
        typeof resolvedOptions.ttlMs === 'number' && resolvedOptions.ttlMs > 0 ? resolvedOptions.ttlMs : toastTtlMs;

      const notification: NotificationItem = {
        id: notificationId,
        type,
        title: resolvedTitle,
        message,
        createdAt,
        readAt: null,
      };

      const toast: ToastItem = {
        id: toastId,
        notificationId,
        type,
        title: resolvedTitle,
        message,
        createdAt,
        ttlMs: resolvedTtlMs,
      };

      const maxHistory = Math.min(50, Math.max(1, Math.floor(maxStoredNotifications)));
      setNotifications((prev) => [...prev, notification].slice(-maxHistory));
      setToasts((prev) => [...prev, toast].slice(-Math.max(1, maxVisibleToasts)));
      return notificationId;
    },
    [maxStoredNotifications, maxVisibleToasts, toastTtlMs]
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const markAllRead = useCallback(() => {
    const now = Date.now();
    setNotifications((prev) => prev.map((item) => (item.readAt ? item : { ...item, readAt: now })));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
    setToasts([]);
    setSelectedNotificationId(null);
  }, []);

  const selectNotification = useCallback((id: string) => {
    const now = Date.now();
    setSelectedNotificationId(id);
    setNotifications((prev) =>
      prev.map((item) => (item.id === id && !item.readAt ? { ...item, readAt: now } : item))
    );
  }, []);

  const openPanel = useCallback((selectId?: string) => {
    setPanelOpen(true);
    if (selectId) {
      setSelectedNotificationId(selectId);
    }
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
  }, []);

  useEffect(() => {
    if (!panelOpen) return;
    if (notifications.some((item) => !item.readAt)) {
      markAllRead();
    }
  }, [markAllRead, notifications, panelOpen]);

  return {
    notifications,
    toasts,
    unreadCount,
    panelOpen,
    selectedNotificationId,
    pushToast,
    dismissToast,
    openPanel,
    closePanel,
    selectNotification,
    markAllRead,
    clearAll,
  };
}
