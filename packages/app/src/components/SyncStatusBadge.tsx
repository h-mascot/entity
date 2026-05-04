import type { SyncStatus } from '../hooks/useSyncStatus';

interface SyncStatusBadgeProps {
  status: SyncStatus;
  label: string;
  compact?: boolean;
}

export default function SyncStatusBadge({ status, label, compact = false }: SyncStatusBadgeProps) {
  const online = status === 'online';

  return (
    <div
      className={`mc-shell-btn inline-flex items-center px-2 py-1 text-xs font-medium ${
        online ? 'mc-shell-btn-active border-[var(--accent)] text-[var(--text-primary)]' : ''
      }`}
    >
      <span className={`mr-2 h-2 w-2 rounded-full ${online ? 'bg-[var(--accent)]' : 'bg-[var(--text-muted)]'}`} />
      <span className={compact ? 'hidden sm:inline' : ''}>{label}</span>
      {compact && <span className="sm:hidden">{online ? 'Online' : 'Offline'}</span>}
    </div>
  );
}
