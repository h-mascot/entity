import { lazy, Suspense } from 'react';
import type { DocsTtsSettings } from '../MarkdownAudioControls';
import {
  buildOpenFileTabKey,
  filenameFromOpenFileTab,
  type OpenFileTab,
} from '../../lib/openFileTabs';
import { shouldRenderMarkdownPreview } from '../../lib/markdownFile';

const MarkdownAudioControls = lazy(() => import('../MarkdownAudioControls'));
const FilesContextBar = lazy(() => import('../../views/FilesContextBar'));

interface DocHubWorkspaceChromeProps {
  openFileTabs: OpenFileTab[];
  activeTabKey: string | null;
  onSelectTab: (tab: OpenFileTab) => void;
  onCloseTab: (tabKey: string) => void;
  onAddTab: () => void;
  onGoHome?: () => void;
  showTts: boolean;
  docsPath: string;
  fileContent: string;
  docsTtsSettings: DocsTtsSettings;
  onDocsTtsSettingsChange?: (settings: DocsTtsSettings) => void;
  pushToast: (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void;
  filesContextBarProps: Record<string, unknown>;
}

function fileTabIcon(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'md' || ext === 'mdx') return '📝';
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(ext)) return '🎵';
  if (['mp4', 'webm', 'mov', 'mkv'].includes(ext)) return '🎬';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return '🖼️';
  if (ext === 'pdf') return '📕';
  return '📄';
}

export default function DocHubWorkspaceChrome({
  openFileTabs,
  activeTabKey,
  onSelectTab,
  onCloseTab,
  onAddTab,
  onGoHome,
  showTts,
  docsPath,
  fileContent,
  docsTtsSettings,
  onDocsTtsSettingsChange,
  pushToast,
  filesContextBarProps,
}: DocHubWorkspaceChromeProps) {
  // Home state (no open files): show the page title like every other tab
  // instead of a row of disabled editor controls.
  const homeMode = openFileTabs.length === 0;
  // Editor controls only make sense when a file is actively open — tabs can
  // stay listed while the user is back on the dashboard home.
  const showDocControls = Boolean(activeTabKey);

  return (
    <div className="shrink-0 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 lg:px-4" data-testid="doc-hub-workspace-chrome">
      <div className="flex min-h-[2.75rem] flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            type="button"
            onClick={onGoHome}
            className="hidden shrink-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-xs font-medium text-[var(--text-muted)] transition hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] sm:inline-flex"
            title="Back to Doc Hub home"
            aria-label="Back to Doc Hub home"
          >
            <span aria-hidden="true">📄</span>
            <span>Doc Hub /</span>
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {homeMode ? (
              <span className="truncate px-1 text-sm font-semibold text-[var(--text-primary)]">Files</span>
            ) : (
              openFileTabs.map((tab) => {
                const tabKey = buildOpenFileTabKey(tab.sourceId, tab.path);
                const active = tabKey === activeTabKey;
                const label = filenameFromOpenFileTab(tab);
                return (
                  <div
                    key={tabKey}
                    className={`group flex max-w-[14rem] shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs ${
                      active
                        ? 'border-[var(--border-secondary)] bg-[var(--bg-primary)] text-[var(--text-primary)]'
                        : 'border-transparent bg-transparent text-[var(--text-muted)] hover:border-[var(--border-secondary)] hover:bg-[var(--bg-primary)]/60 hover:text-[var(--text-secondary)]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectTab(tab)}
                      className="flex min-w-0 flex-1 items-center gap-1 truncate text-left"
                      title={tab.path}
                    >
                      <span aria-hidden="true">{fileTabIcon(tab.path)}</span>
                      <span className="truncate">{label}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onCloseTab(tabKey);
                      }}
                      className="rounded px-1 text-[10px] text-[var(--text-muted)] opacity-70 transition hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] group-hover:opacity-100"
                      aria-label={`Close ${label}`}
                      title={`Close ${label}`}
                    >
                      ×
                    </button>
                  </div>
                );
              })
            )}
            <button
              type="button"
              onClick={onAddTab}
              className="mc-shell-btn inline-flex h-7 w-7 shrink-0 items-center justify-center px-0 py-0 text-sm"
              aria-label="Open another file"
              title="Open another file"
            >
              +
            </button>
          </div>
        </div>

        {showDocControls ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (!fileContent) {
                  pushToast('Nothing to copy.', 'warning');
                  return;
                }
                navigator.clipboard
                  .writeText(fileContent)
                  .then(() => pushToast('Document copied to clipboard.', 'success'))
                  .catch(() => pushToast('Failed to copy document.', 'error'));
              }}
              disabled={!fileContent}
              className={`mc-shell-btn px-2 py-1 text-xs ${fileContent ? '' : 'cursor-not-allowed opacity-40'}`}
              title="Copy whole document"
              aria-label="Copy whole document"
            >
              ⧉
            </button>
            {showTts ? (
              <Suspense fallback={null}>
                <MarkdownAudioControls
                  docsPath={docsPath}
                  content={fileContent}
                  settings={docsTtsSettings}
                  onSettingsChange={onDocsTtsSettingsChange}
                  onToast={pushToast}
                  compact
                />
              </Suspense>
            ) : null}
            <Suspense fallback={null}>
              <FilesContextBar {...filesContextBarProps} actionsOnly />
            </Suspense>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function shouldShowDocHubTts(
  currentFile: string | null,
  contentType: string | null | undefined,
  isBinary: boolean | undefined,
): boolean {
  if (!currentFile || isBinary) {
    return false;
  }
  return shouldRenderMarkdownPreview(currentFile, contentType ?? null);
}
