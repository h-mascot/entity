import { useState } from 'react';

interface DocumentViewerProps {
  url: string | null;
  onClose: () => void;
}

export default function DocumentViewer({ url, onClose }: DocumentViewerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  if (!url) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--overlay-strong)] p-4">
      <div className="flex h-[90vh] w-full max-w-6xl flex-col rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-primary)] shadow-[0_16px_48px_rgba(0,0,0,0.35)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="text-lg">🌐</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-[var(--text-primary)]">
                {url}
              </div>
              <div className="text-xs text-[var(--text-muted)]">
                External content loaded in Entity
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="mc-shell-btn px-3 py-1.5 text-xs"
              title="Open in new tab"
            >
              ↗ Open in new tab
            </a>
            <button
              type="button"
              onClick={onClose}
              className="mc-shell-btn mc-shell-btn-active border-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)]"
            >
              ✕ Close
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="relative min-h-0 flex-1 overflow-hidden bg-[var(--bg-secondary)]">
          {isLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-[var(--text-muted)]">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent"></div>
              <span className="text-sm">Loading content...</span>
            </div>
          )}
          
          {hasError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center">
              <span className="text-4xl">⚠️</span>
              <div className="text-sm font-medium text-[var(--text-primary)]">
                Unable to load content in iframe
              </div>
              <div className="max-w-md text-xs text-[var(--text-muted)]">
                This website may block iframe embedding due to security settings (X-Frame-Options or Content-Security-Policy).
              </div>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="mc-shell-btn mc-shell-btn-active border-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--text-primary)]"
              >
                Open in new tab instead
              </a>
            </div>
          )}

          <iframe
            src={url}
            title="Document Viewer"
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            onLoad={() => setIsLoading(false)}
            onError={() => {
              setIsLoading(false);
              setHasError(true);
            }}
          />
        </div>
      </div>
    </div>
  );
}
