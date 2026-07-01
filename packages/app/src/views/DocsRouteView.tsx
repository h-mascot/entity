import { lazy, Suspense, type ComponentProps, type ReactNode } from 'react';
import type { DocsTtsSettings } from '../components/MarkdownAudioControls';

const MarkdownPreview = lazy(() => import('../components/MarkdownPreview'));
const MarkdownAudioControls = lazy(() => import('../components/MarkdownAudioControls'));

interface DocsRouteViewProps {
  docsPath: string;
  docsFilename: string;
  docsBreadcrumbSegments: string[];
  docsError: string | null;
  docsContent: string;
  docsLoading: boolean;
  docsTtsSettings: DocsTtsSettings;
  docsBackTaskId: number | null;
  onBackToHome: () => void;
  onDocsLinkNavigate: (href: string) => boolean;
  onDocsTtsSettingsChange: (settings: DocsTtsSettings) => void;
  onToast: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
  renderInstallCta: (bottomClassName: string) => ReactNode;
  renderOfflineSyncBar: (mobileHasBottomNav: boolean) => ReactNode;
}

function LazySurfaceFallback({ label = 'Loading workspace' }: { label?: string }) {
  return (
    <div className="flex h-full min-h-[12rem] w-full items-center justify-center text-sm text-[var(--text-muted)]">
      <div className="flex items-center gap-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" aria-hidden="true" />
        <span>{label}</span>
      </div>
    </div>
  );
}

function LazyMarkdownAudioControls(props: ComponentProps<typeof MarkdownAudioControls>) {
  return (
    <Suspense fallback={null}>
      <MarkdownAudioControls {...props} />
    </Suspense>
  );
}

function LazyMarkdownPreview(props: ComponentProps<typeof MarkdownPreview>) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading preview" />}>
      <MarkdownPreview {...props} />
    </Suspense>
  );
}

export default function DocsRouteView({
  docsPath,
  docsFilename,
  docsBreadcrumbSegments,
  docsError,
  docsContent,
  docsLoading,
  docsTtsSettings,
  docsBackTaskId,
  onBackToHome,
  onDocsLinkNavigate,
  onDocsTtsSettingsChange,
  onToast,
  renderInstallCta,
  renderOfflineSyncBar,
}: DocsRouteViewProps) {
  const docsPathParts = docsPath.split('/').filter(Boolean);
  const fallbackFilename = docsPathParts[docsPathParts.length - 1] ?? 'Document';

  return (
    <div className="entity-shell flex h-screen flex-col bg-[var(--bg-primary)] text-[var(--text-secondary)]">
      {renderInstallCta('bottom-10')}
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-3">
        <button
          type="button"
          onClick={onBackToHome}
          className="mc-shell-btn px-3 py-1 text-xs font-medium"
        >
          {docsBackTaskId !== null ? `← Back to task #${docsBackTaskId}` : '← Entity Home'}
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
            {docsFilename || fallbackFilename}
          </div>
          <div className="truncate text-xs text-[var(--text-muted)]">
            {docsBreadcrumbSegments.length > 0 ? docsBreadcrumbSegments.join(' / ') : docsPath}
          </div>
        </div>
        <div className="hidden max-w-[45%] truncate text-right text-xs text-[var(--text-muted)] sm:block">
          /docs/{docsPath}
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-8 lg:py-8">
          {docsError ? (
            <div className="rounded-xl border border-[var(--error)]/50 bg-[var(--bg-secondary)] p-4">
              <div className="text-sm font-medium text-[var(--error)]">Unable to load document</div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">{docsError}</div>
            </div>
          ) : (
            <>
              <LazyMarkdownAudioControls
                docsPath={docsPath}
                content={docsContent}
                settings={docsTtsSettings}
                onSettingsChange={onDocsTtsSettingsChange}
                onToast={onToast}
              />
              <LazyMarkdownPreview
                content={docsContent}
                loading={docsLoading}
                onDocsLinkNavigate={onDocsLinkNavigate}
              />
            </>
          )}
        </div>
      </main>
      {renderOfflineSyncBar(false)}
    </div>
  );
}
