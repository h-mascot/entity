import { useEffect, useRef } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: string;
  notificationId: string;
  title: string;
  message: string;
  type: ToastType;
  createdAt: number;
  ttlMs?: number;
}

function typeClassName(type: ToastItem['type']): string {
  switch (type) {
    case 'success':
      return 'border-green-500/30 bg-green-500/10 text-green-200';
    case 'warning':
      return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-100';
    case 'error':
      return 'border-red-500/30 bg-red-500/10 text-red-100';
    case 'info':
      return 'border-[var(--accent)] bg-[var(--surface-accent)] text-[var(--text-secondary)]';
    default:
      return 'border-[var(--border-secondary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]';
  }
}

function typeIcon(type: ToastItem['type']): string {
  switch (type) {
    case 'success':
      return '✓';
    case 'warning':
      return '!';
    case 'error':
      return '×';
    default:
      return 'i';
  }
}

export function ToastItem({
  toast,
  onDismiss,
  onOpen,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
  onOpen?: (notificationId: string) => void;
}) {
  const ttlMs = typeof toast.ttlMs === 'number' && toast.ttlMs > 0 ? toast.ttlMs : 5000;
  const fadeOutMs = 260;
  const fadeDelayMs = Math.max(0, ttlMs - fadeOutMs);

  const animation = `mc-toast-in 180ms ease-out both, mc-toast-out ${fadeOutMs}ms ease-in forwards ${fadeDelayMs}ms`;

  return (
    <div
      className={`mc-toast pointer-events-auto flex items-start justify-between gap-3 rounded-lg border px-3 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.35)] ${typeClassName(
        toast.type
      )}`}
      role="status"
      tabIndex={0}
      onClick={() => onOpen?.(toast.notificationId)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen?.(toast.notificationId);
        }
      }}
      style={{ animation }}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div
          className="flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-black/20 text-xs font-semibold text-[var(--text-primary)]"
          aria-hidden="true"
        >
          {typeIcon(toast.type)}
        </div>
        <div className="min-w-0 flex-1 text-sm">
          <div className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{toast.title}</div>
          <div className="truncate text-[12px] text-[var(--text-secondary)]">{toast.message}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDismiss(toast.id);
        }}
        className="mc-shell-btn px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  );
}

export function ToastViewport({
  toasts,
  onDismiss,
  onOpen,
}: {
  toasts: readonly ToastItem[];
  onDismiss: (id: string) => void;
  onOpen?: (notificationId: string) => void;
}) {
  const timersRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const timers = timersRef.current;
    const activeIds = new Set(toasts.map((toast) => toast.id));

    // Clear timers for removed toasts.
    for (const [id, timerId] of Object.entries(timers)) {
      if (!activeIds.has(id)) {
        window.clearTimeout(timerId);
        delete timers[id];
      }
    }

    // Schedule timers for new toasts without resetting existing ones.
    for (const toast of toasts) {
      if (timers[toast.id] !== undefined) continue;
      const ttlMs = typeof toast.ttlMs === 'number' && toast.ttlMs > 0 ? toast.ttlMs : 0;
      if (ttlMs <= 0) continue;

      const elapsedMs = Math.max(0, Date.now() - toast.createdAt);
      const remainingMs = Math.max(0, ttlMs - elapsedMs);

      timers[toast.id] = window.setTimeout(() => {
        delete timersRef.current[toast.id];
        onDismiss(toast.id);
      }, remainingMs);
    }
  }, [onDismiss, toasts]);

  useEffect(() => {
    return () => {
      const timers = timersRef.current;
      for (const timerId of Object.values(timers)) {
        window.clearTimeout(timerId);
      }
      timersRef.current = {};
    };
  }, []);

  if (toasts.length === 0) {
    return null;
  }

  const visibleToasts = toasts.slice(-3);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(22rem,92vw)] flex-col gap-2">
      {visibleToasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} onOpen={onOpen} />
      ))}
    </div>
  );
}
