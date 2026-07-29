import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { DocsTtsSettings } from '../MarkdownAudioControls';
import {
  buildOpenFileTabKey,
  filenameFromOpenFileTab,
  type OpenFileTab,
} from '../../lib/openFileTabs';
import { shouldRenderMarkdownPreview } from '../../lib/markdownFile';
import {
  buildCanonicalLocalDocHubUrl,
  buildCanonicalDocHubUrl,
  parseDocHubRouteState,
} from '../../lib/docHubRoute';
import {
  reduceDesktopManualCopyState,
  type DesktopManualCopyState,
} from '../../lib/documentShellState';
import { createShareAdapter } from '../../lib/shareAdapter';
import { emitDocHubTelemetry } from '../../lib/docHubTelemetry';

const MarkdownAudioControls = lazy(() => import('../MarkdownAudioControls'));
const FilesContextBar = lazy(() => import('../../views/FilesContextBar'));
const shareAdapter = createShareAdapter();

interface DocHubWorkspaceChromeProps {
  openFileTabs: OpenFileTab[];
  activeTabKey: string | null;
  onSelectTab: (tab: OpenFileTab) => void;
  onCloseTab: (tabKey: string) => void;
  onAddTab: () => void;
  onGoHome?: () => void;
  showTts: boolean;
  docsPath: string;
  currentSourceId: string | null;
  fsMultiSourceEnabled: boolean;
  fileContent: string;
  docsTtsSettings: DocsTtsSettings;
  onDocsTtsSettingsChange?: (settings: DocsTtsSettings) => void;
  onOpenVoiceSettings?: () => void;
  pushToast: (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void;
  filesContextBarProps: Record<string, unknown>;
}

function ManualCopyFallback({
  value,
  onDismiss,
}: {
  value: string;
  onDismiss: () => void;
}) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fieldRef.current?.focus();
    fieldRef.current?.select();
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Copy link manually"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          onDismiss();
        }
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-4 shadow-2xl">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">Copy link manually</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Select the link below and copy it manually.
        </p>
        <textarea
          ref={fieldRef}
          readOnly
          value={value}
          rows={3}
          aria-label="Canonical link to copy"
          className="mt-3 w-full resize-none rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          onFocus={(event) => event.currentTarget.select()}
          onClick={(event) => event.currentTarget.select()}
          onPointerUp={(event) => {
            event.preventDefault();
            event.currentTarget.select();
          }}
        />
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            className="mc-shell-btn px-3 py-1.5 text-sm"
            onClick={onDismiss}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
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
  currentSourceId,
  fsMultiSourceEnabled,
  fileContent,
  docsTtsSettings,
  onDocsTtsSettingsChange,
  onOpenVoiceSettings,
  pushToast,
  filesContextBarProps,
}: DocHubWorkspaceChromeProps) {
  const documentIdentity = JSON.stringify([currentSourceId, docsPath]);
  const documentIdentityRef = useRef(documentIdentity);
  documentIdentityRef.current = documentIdentity;
  const [manualCopyState, setManualCopyState] = useState<DesktopManualCopyState>({
    documentIdentity,
    value: null,
  });
  const copyLinkButtonRef = useRef<HTMLButtonElement>(null);
  const dismissManualCopy = () => {
    setManualCopyState((state) => ({ ...state, value: null }));
    copyLinkButtonRef.current?.focus();
  };
  useEffect(() => {
    setManualCopyState((state) => reduceDesktopManualCopyState(state, {
      type: 'document-changed',
      documentIdentity,
    }));
  }, [documentIdentity]);
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
              ref={copyLinkButtonRef}
              type="button"
              onClick={() => {
                const restoredState = parseDocHubRouteState(
                  window.location.pathname,
                  window.location.search,
                );
                const canonicalUrl = !fsMultiSourceEnabled && currentSourceId === null
                  ? buildCanonicalLocalDocHubUrl(
                      docsPath,
                      window.location.pathname,
                      window.location.search,
                      window.location.origin,
                    )
                  : buildCanonicalDocHubUrl(
                      {
                        sourceId: currentSourceId ?? restoredState?.sourceId ?? 'workspace',
                        path: docsPath,
                        ...(restoredState?.tool ? { tool: restoredState.tool } : {}),
                        ...(restoredState?.convert ? { convert: restoredState.convert } : {}),
                      },
                      window.location.origin,
                    );

                const requestedDocumentIdentity = documentIdentity;
                emitDocHubTelemetry({
                  name: 'doc_hub.copy_share.attempt',
                  properties: { mechanism: 'clipboard', surface: 'desktop' },
                });
                void shareAdapter.copy(canonicalUrl).then((result) => {
                  if (documentIdentityRef.current !== requestedDocumentIdentity) {
                    return;
                  }
                  if (result.status === 'copied') {
                    emitDocHubTelemetry({
                      name: 'doc_hub.copy_share.result',
                      properties: {
                        mechanism: 'clipboard',
                        outcome: 'success',
                        recoverable: true,
                      },
                    });
                    pushToast('Link copied.', 'success');
                  } else if (result.status === 'manual-required') {
                    emitDocHubTelemetry({
                      name: 'doc_hub.copy_share.result',
                      properties: {
                        mechanism: 'clipboard',
                        outcome: 'fallback',
                        recoverable: true,
                      },
                    });
                    emitDocHubTelemetry({
                      name: 'doc_hub.clipboard_fallback.displayed',
                      properties: {
                        surface: 'desktop',
                        reason: 'clipboard-unavailable',
                      },
                    });
                    setManualCopyState((state) => reduceDesktopManualCopyState(state, {
                      type: 'manual-required',
                      documentIdentity: requestedDocumentIdentity,
                      value: result.value,
                    }));
                  } else if (result.status === 'failed') {
                    emitDocHubTelemetry({
                      name: 'doc_hub.copy_share.result',
                      properties: {
                        mechanism: 'clipboard',
                        outcome: 'failure',
                        recoverable: true,
                      },
                    });
                    pushToast(result.safeMessage, 'error');
                  }
                });
              }}
              className="mc-shell-btn px-2 py-1 text-xs"
              title="Copy link"
              aria-label="Copy link"
            >
              ⧉
            </button>
            {showTts ? (
              <Suspense fallback={null}>
                <MarkdownAudioControls
                  docsPath={docsPath}
                  documentIdentity={documentIdentity}
                  content={fileContent}
                  settings={docsTtsSettings}
                  onSettingsChange={onDocsTtsSettingsChange}
                  onOpenVoiceSettings={onOpenVoiceSettings}
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
      {manualCopyState.documentIdentity === documentIdentity && manualCopyState.value ? (
        <ManualCopyFallback
          value={manualCopyState.value}
          onDismiss={dismissManualCopy}
        />
      ) : null}
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
