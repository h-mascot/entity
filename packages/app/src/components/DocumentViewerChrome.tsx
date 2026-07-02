import type { ReactNode } from 'react';

interface DocumentViewerChromeProps {
  filename: string;
  breadcrumb?: string;
  breadcrumbSegments?: string[];
  pathHint?: string;
  onBack?: () => void;
  backLabel?: string;
  actions?: ReactNode;
}

export default function DocumentViewerChrome({
  filename,
  breadcrumb,
  breadcrumbSegments = [],
  pathHint,
  onBack,
  backLabel = '← Entity Home',
  actions,
}: DocumentViewerChromeProps) {
  const breadcrumbLabel = breadcrumb ?? breadcrumbSegments.join(' / ');

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-3">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="mc-shell-btn px-3 py-1 text-xs font-medium"
        >
          {backLabel}
        </button>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
          {filename}
        </div>
        <div className="truncate text-xs text-[var(--text-muted)]">
          {breadcrumbLabel}
        </div>
      </div>
      {actions ? (
        <div className="flex max-w-[45%] flex-shrink-0 items-center justify-end gap-2">
          {pathHint ? (
            <div className="hidden min-w-0 truncate text-right text-xs text-[var(--text-muted)] sm:block">
              {pathHint}
            </div>
          ) : null}
          {actions}
        </div>
      ) : pathHint ? (
        <div className="hidden max-w-[45%] truncate text-right text-xs text-[var(--text-muted)] sm:block">
          {pathHint}
        </div>
      ) : null}
    </header>
  );
}
