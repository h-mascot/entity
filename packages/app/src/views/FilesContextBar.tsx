import { lazy, Suspense } from 'react';

const PresenceChips = lazy(() => import('../components/PresenceChips').then((module) => ({ default: module.PresenceChips })));

function formatAuthorshipBadgePercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }

  if (value < 1) {
    return '<1';
  }

  const rounded = Math.round(value);
  if (rounded <= 0) {
    return '<1';
  }

  return String(rounded);
}

function LazyPresenceChips(props: any) {
  return (
    <Suspense fallback={null}>
      <PresenceChips {...props} />
    </Suspense>
  );
}

export default function FilesContextBar(props: any) {
  const {
    runtime,
    currentFile,
    handleBackToDashboard,
    selectedSource,
    currentSourceId,
    currentFileReadOnly,
    currentFileCacheMeta,
    currentFileCachedAgeLabel,
    editorCollabMode,
    setEditorCollabMode,
    documentsReady,
    authorshipStats,
    currentDocId,
    remotePresence,
    followEnabled,
    followedActorId,
    resolveAgentIdForActor,
    pushToast,
    setEditMode,
    setWatchMode,
    setFollowingAgent,
    setFollowDetached,
    toggleWatchMode,
    watchMode,
    editMode,
    splitMode,
    exitSplitMode,
    setSplitMode,
    setSplitRatio,
    setRightPaneSourceId,
    setRightPaneFile,
    setRightPaneReadOnly,
    setRightPaneUpdatedAt,
    setRightPaneContent,
    rightLastContentRef,
    rightSaveTimeoutRef,
    setFileHistoryPanelOpen,
    fileHistoryPanelOpen,
    canEditCurrentFile,
    handleSave,
    savedAgoLabel,
    actionsOnly = false,
  } = props;

  const actionControls = (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={editorCollabMode}
        onChange={(event) => setEditorCollabMode(event.target.value)}
        className={`rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 py-1 text-xs text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none ${
          currentFile ? '' : 'cursor-not-allowed opacity-40'
        }`}
        aria-label="Editor mode"
        disabled={!currentFile}
        title="Editor mode"
      >
        <option value="editing">Editing</option>
        <option value="suggesting" disabled={!documentsReady}>
          Suggesting
        </option>
        <option value="viewing">Viewing</option>
      </select>
      {runtime.agentNativeEditorEnabled && currentFile && authorshipStats.totalRanges > 0 && (
        <div
          className="flex items-center gap-1 text-xs text-[var(--text-muted)]"
          aria-label="Authorship breakdown"
          title={`Reviewed ${authorshipStats.reviewedPercent}%`}
        >
          {authorshipStats.human > 0 && <span>👤 {formatAuthorshipBadgePercent(authorshipStats.human)}%</span>}
          {authorshipStats.ada > 0 && (
            <span className="text-purple-400">Assistant {formatAuthorshipBadgePercent(authorshipStats.ada)}%</span>
          )}
          {authorshipStats.spock > 0 && (
            <span className="text-blue-400">Assistant {formatAuthorshipBadgePercent(authorshipStats.spock)}%</span>
          )}
          {authorshipStats.scotty > 0 && (
            <span className="text-green-400">Assistant {formatAuthorshipBadgePercent(authorshipStats.scotty)}%</span>
          )}
        </div>
      )}
      {runtime.agentNativeEditorEnabled && currentDocId && remotePresence.length > 0 && (
        <LazyPresenceChips
          presence={remotePresence}
          selectedActorId={followEnabled ? followedActorId : null}
          onSelectActor={(actorId: string) => {
            const agentId = resolveAgentIdForActor(actorId);
            if (!agentId) {
              pushToast('Follow mode is only available for agent cursors.', 'warning');
              return;
            }

            setEditMode(true);
            setWatchMode(true);

            setFollowingAgent((current: any) => {
              const normalized = current?.trim?.().toLowerCase?.() ?? '';
              const nextNormalized = agentId.trim().toLowerCase();
              if (followEnabled && normalized === nextNormalized) {
                setFollowDetached(true);
                return current;
              }
              setFollowDetached(false);
              return agentId;
            });
          }}
        />
      )}
      <button
        type="button"
        onClick={toggleWatchMode}
        disabled={!currentFile}
        className={`mc-shell-btn px-3 py-1 text-xs font-medium ${
          watchMode ? 'mc-shell-btn-active text-[var(--text-primary)]' : ''
        } ${currentFile ? '' : 'cursor-not-allowed opacity-40'}`}
      >
        {watchMode ? 'Watch Mode' : 'Interact Mode'}
      </button>
      <button
        type="button"
        onClick={() => setEditMode((prev: boolean) => !prev)}
        disabled={!currentFile}
        className={`mc-shell-btn px-3 py-1 text-xs ${
          editMode ? 'mc-shell-btn-active text-[var(--text-primary)]' : ''
        } ${currentFile ? '' : 'cursor-not-allowed opacity-40'}`}
      >
        {editMode ? 'Preview' : 'Edit'}
      </button>
      <button
        type="button"
        onClick={() => {
          if (splitMode) {
            exitSplitMode();
            return;
          }
          setSplitMode('horizontal');
          setSplitRatio(0.5);
          setRightPaneSourceId(null);
          setRightPaneFile(null);
          setRightPaneReadOnly(false);
          setRightPaneUpdatedAt(null);
          setRightPaneContent('');
          rightLastContentRef.current = '';
          if (rightSaveTimeoutRef.current) {
            clearTimeout(rightSaveTimeoutRef.current);
            rightSaveTimeoutRef.current = undefined;
          }
        }}
        disabled={!currentFile}
        className={`mc-shell-btn px-3 py-1 text-xs ${
          splitMode ? 'mc-shell-btn-active text-[var(--text-primary)]' : ''
        } ${currentFile ? '' : 'cursor-not-allowed opacity-40'}`}
        aria-label={splitMode ? 'Exit split view' : 'Split editor'}
        title={splitMode ? 'Exit split view' : 'Split editor'}
      >
        Split
      </button>
      {/* History intentionally omitted: version history lives in the right sidebar as "Versions". */}
      <button
        type="button"
        onClick={() => {
          navigator.clipboard
            .writeText(window.location.href)
            .then(() => {
              pushToast('Link copied to clipboard!', 'success');
            })
            .catch(() => {
              pushToast('Failed to copy link', 'error');
            });
        }}
        disabled={!currentFile}
        className={`mc-shell-btn px-3 py-1 text-xs ${currentFile ? '' : 'cursor-not-allowed opacity-40'}`}
        aria-label="Copy link to this file"
        title="Copy link to this file"
      >
        🔗 Share
      </button>
      {editMode && editorCollabMode !== 'viewing' && !watchMode && currentFile && canEditCurrentFile && (
        <button
          type="button"
          onClick={handleSave}
          className="mc-shell-btn mc-shell-btn-active border-[var(--accent)] px-3 py-1 text-xs font-medium text-[var(--text-primary)]"
        >
          Save
        </button>
      )}
      {savedAgoLabel && (
        <span className="text-xs text-[var(--accent)]">Saved {savedAgoLabel} ago</span>
      )}
    </div>
  );

  if (actionsOnly) {
    return actionControls;
  }

  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-[220px] flex-1 items-center gap-2">
        {runtime.fsMultiSourceEnabled && currentFile && (
          <button
            type="button"
            onClick={handleBackToDashboard}
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            title="Back to Dashboard"
            aria-label="Back to Dashboard"
          >
            ←
          </button>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1 truncate text-xs text-[var(--text-muted)]">
            {currentFile ? `${selectedSource ? `${selectedSource.displayName} • ` : ''}${currentFile}` : 'No file selected'}
          </div>
          {runtime.fsMultiSourceEnabled && currentSourceId && (
            <span className="mc-shell-pill px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
              Source
            </span>
          )}
          {runtime.fsMultiSourceEnabled && currentSourceId && currentFileReadOnly && (
            <span className="mc-shell-pill px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
              Read-only
            </span>
          )}
          {currentFileCacheMeta.cached && (
            <span className="mc-shell-pill px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
              cached ({currentFileCachedAgeLabel ?? 'just now'})
            </span>
          )}
        </div>
      </div>
      {actionControls}
    </div>
  );
}
