import { lazy, Suspense } from 'react';

const UnifiedFileDashboard = lazy(() => import('../components/UnifiedFileDashboard'));
const DocumentEditorView = lazy(() => import('./DocumentEditorView'));

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

function LazyUnifiedFileDashboard(props: any) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading files" />}>
      <UnifiedFileDashboard {...props} />
    </Suspense>
  );
}

export default function FilesView(props: any) {
  const { runtime, currentFile, handleSourceFileSelect } = props;

  const renderFileHome = () => {
    if (runtime.fsMultiSourceEnabled) {
      return <LazyUnifiedFileDashboard apiBase={runtime.apiBase} enabled onOpen={handleSourceFileSelect} />;
    }

    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
        Select a file from the sidebar to begin.
      </div>
    );
  };

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        {currentFile ? (
          <Suspense fallback={<LazySurfaceFallback label="Loading editor" />}>
            <DocumentEditorView {...props} />
          </Suspense>
        ) : renderFileHome()}
      </div>
    </>
  );
}
