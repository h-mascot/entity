import { lazy, Suspense, useState } from 'react';
import { isMarkdownFilePath, shouldRenderMarkdownPreview } from '../lib/markdownFile';

const CodeMirrorEditor = lazy(() => import('../components/CodeMirrorEditor'));
const CodeMirrorFileViewer = lazy(() => import('../components/CodeMirrorFileViewer'));
const DocIntelligencePanel = lazy(() => import('../components/doc-intelligence/DocIntelligencePanel'));
const DocumentReadingView = lazy(() => import('../components/DocumentReadingView'));
const EditorFormattingToolbar = lazy(() => import('../components/EditorFormattingToolbar'));

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

function LazyCodeMirrorEditor(props: any) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading editor" />}>
      <CodeMirrorEditor {...props} />
    </Suspense>
  );
}

function LazyCodeMirrorFileViewer(props: any) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading file viewer" />}>
      <CodeMirrorFileViewer {...props} />
    </Suspense>
  );
}

function LazyDocumentReadingView(props: any) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading preview" />}>
      <DocumentReadingView {...props} />
    </Suspense>
  );
}

function LazyDocIntelligencePanel(props: any) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading document intelligence" />}>
      <DocIntelligencePanel {...props} />
    </Suspense>
  );
}

export default function DocumentEditorView(props: any) {
  const {
    currentFile,
    currentSourceId,
    fileContent,
    setFileContent,
    editMode,
    setEditMode,
    splitMode,
    splitContainerRef,
    splitResizing,
    splitRatio,
    setSplitResizing,
    updateSplitRatioFromClientX,
    rightPaneFile,
    rightPaneSource,
    rightPaneSourceId,
    rightPaneReadOnly,
    rightPaneCacheMeta,
    rightPaneCachedAgeLabel,
    setQuickSwitcherTargetPane,
    setQuickSwitcherOpen,
    exitSplitMode,
    rightPaneContent,
    handleRightPaneContentChange,
    rightPanePreviewMeta,
    rightPaneRawFileUrl,
    handleContentChange,
    handleSave,
    editorCollabMode,
    watchMode,
    currentFileReadOnly,
    runtime,
    documentsReady,
    currentDocId,
    handleSuggestingEdit,
    handleToggleSuggestingMode,
    handleExitSuggestingMode,
    manualAttributionEnabled,
    editorAuthorshipRanges,
    handleManualAttribution,
    setEditorSelection,
    handleEditorCursorActivity,
    commentThreads,
    setRightSidebarCollapsed,
    setSelectedCommentId,
    setFocusRange,
    suggestions,
    setSelectedSuggestionId,
    documentsClient,
    setSuggestions,
    pushToast,
    fetchSourceFile,
    reviewFindings,
    setSelectedFindingId,
    handleApplyReviewFindingFix,
    handleIgnoreReviewFinding,
    editorPresence,
    focusRange,
    followEnabled,
    debouncedFollowCursor,
    setFollowDetached,
    currentFilePreviewMeta,
    currentRawFileUrl,
    handleMarkdownDocsNavigation,
    docsTtsSettings,
    handleDocsTtsSettingsChange,
    rightSidebarIsCollapsed,
    rightSidebarHasComments,
    rightSidebarHasSuggestions,
    editorSelection,
    setCommentPopover,
    setCommentThreads,
    selectedCommentId,
    selectedSuggestionId,
    reviewMode,
    setReviewMode,
    reviewRun,
    setReviewRun,
    setReviewFindings,
    selectedFindingId,
    sourceName,
    currentFileUpdatedAt,
    setFileHistoryPanelOpen,
    fileHistoryPanelOpen,
  } = props;

  const [editorViewGetter, setEditorViewGetter] = useState<{ getView: () => any } | null>(null);
  const isMarkdownDoc = isMarkdownFilePath(currentFile);
  const editorIsWritable =
    editMode && editorCollabMode !== 'viewing' && !watchMode && !(editorCollabMode === 'editing' && currentFileReadOnly);

  const renderPrimaryEditorContent = () => (
    <div className="flex min-h-0 flex-1 flex-col">
      {editorIsWritable && editorViewGetter ? (
        <Suspense fallback={null}>
          <EditorFormattingToolbar getView={editorViewGetter.getView} />
        </Suspense>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
      {editMode ? (
        <div
          className={`h-full w-full ${props.followGlowClassName} ${props.followTypingPulseActive ? 'agent-typing' : ''} ${
            props.fileTransitionActive ? 'mc-file-switch-anim' : ''
          }`}
        >
          <LazyCodeMirrorEditor
            content={fileContent}
            onChange={handleContentChange}
            onSave={handleSave}
            readOnly={editorCollabMode === 'viewing' || watchMode || (editorCollabMode === 'editing' && currentFileReadOnly)}
            hideGutter={isMarkdownDoc}
            onViewReady={(getView: () => any) => setEditorViewGetter({ getView })}
            shortcutsEnabled={runtime.agentNativeEditorEnabled}
            collabMode={editorCollabMode}
            onSuggestingEdit={documentsReady ? handleSuggestingEdit : undefined}
            onToggleSuggestingMode={handleToggleSuggestingMode}
            onExitSuggestingMode={handleExitSuggestingMode}
            authorshipRanges={manualAttributionEnabled ? editorAuthorshipRanges : undefined}
            onManualAttribution={manualAttributionEnabled ? handleManualAttribution : undefined}
            onSelectionChange={setEditorSelection}
            onCursorActivity={documentsReady ? handleEditorCursorActivity : undefined}
            onNewComment={(request: any) => {
              if (!documentsReady || !currentDocId) {
                pushToast('Connect a Documents token to use comments.', 'warning');
                return;
              }

              setEditMode(true);
              props.onFocusCommentsRail?.();
              setCommentPopover({
                anchor: request.anchor,
                selection: request.selection,
                selectedText: request.selectedText,
              });
            }}
            commentThreads={commentThreads}
            onSelectComment={(commentId: string) => {
              const thread = commentThreads.find((entry: any) => entry.id === commentId) ?? null;
              if (!thread) return;

              setEditMode(true);
              setRightSidebarCollapsed(false);
              props.onFocusCommentsRail?.();
              setSelectedCommentId(commentId);
              setFocusRange({ from: thread.range.from, to: thread.range.to });

              window.requestAnimationFrame(() => {
                document.getElementById(`comment-thread-${commentId}`)?.scrollIntoView({ block: 'nearest' });
              });
            }}
            suggestions={suggestions}
            onSelectSuggestion={(suggestionId: string) => {
              const suggestion = suggestions.find((entry: any) => entry.id === suggestionId) ?? null;
              if (!suggestion) return;

              setEditMode(true);
              setRightSidebarCollapsed(false);
              setSelectedSuggestionId(suggestionId);
              setFocusRange({ from: suggestion.range.from, to: suggestion.range.to });
            }}
            onAcceptSuggestion={(suggestionId: string) => {
              void (async () => {
                if (currentFileReadOnly) {
                  pushToast('This source is read-only. Suggestions cannot be accepted.', 'warning');
                  return;
                }
                if (!documentsReady || !currentDocId) {
                  pushToast('Connect a Documents token to accept suggestions.', 'warning');
                  return;
                }
                try {
                  const response = await documentsClient.acceptSuggestion(currentDocId, suggestionId);
                  setSuggestions(response.suggestions);
                  pushToast('Suggestion accepted.', 'success');
                  if (currentSourceId && currentFile) {
                    const updated = await fetchSourceFile(currentSourceId, currentFile);
                    setFileContent(updated.content || '');
                  }
                } catch (error) {
                  pushToast(error instanceof Error ? error.message : 'Failed to accept suggestion.', 'error');
                }
              })();
            }}
            onRejectSuggestion={(suggestionId: string) => {
              void (async () => {
                if (!documentsReady || !currentDocId) {
                  pushToast('Connect a Documents token to reject suggestions.', 'warning');
                  return;
                }
                try {
                  const response = await documentsClient.rejectSuggestion(currentDocId, suggestionId);
                  setSuggestions(response.suggestions);
                  pushToast('Suggestion rejected.', 'info');
                } catch (error) {
                  pushToast(error instanceof Error ? error.message : 'Failed to reject suggestion.', 'error');
                }
              })();
            }}
            reviewFindings={reviewFindings.filter((finding: any) => finding.status !== 'ignored')}
            onSelectFinding={(findingId: string) => {
              const finding = reviewFindings.find((entry: any) => entry.id === findingId) ?? null;
              if (!finding || !finding.range) return;

              setEditMode(true);
              setSelectedFindingId(findingId);
              setFocusRange({ from: finding.range.from, to: finding.range.to });
            }}
            onApplyFindingFix={handleApplyReviewFindingFix}
            onIgnoreFinding={handleIgnoreReviewFinding}
            remotePresence={editorPresence}
            focusRange={focusRange}
            followEnabled={followEnabled}
            followCursor={debouncedFollowCursor}
            onDetachFollow={() => setFollowDetached(true)}
          />
        </div>
      ) : (
        shouldRenderMarkdownPreview(currentFile, currentFilePreviewMeta.contentType) ? (
          <LazyDocumentReadingView
            content={fileContent}
            docsPath={currentFile ?? ''}
            ttsSettings={docsTtsSettings}
            onTtsSettingsChange={handleDocsTtsSettingsChange}
            onToast={pushToast}
            onDocsLinkNavigate={handleMarkdownDocsNavigation}
            animate={props.fileTransitionActive}
            tts="none"
          />
        ) : (
          <div className={`h-full w-full overflow-hidden ${props.fileTransitionActive ? 'mc-file-switch-anim' : ''}`}>
            <LazyCodeMirrorFileViewer
              content={fileContent}
              filePath={currentFile ?? ''}
              contentType={currentFilePreviewMeta.contentType}
              fileSize={currentFilePreviewMeta.size}
              isBinary={currentFilePreviewMeta.isBinary}
              rawFileUrl={currentRawFileUrl}
            />
          </div>
        )
      )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1">
      {splitMode ? (
        <div ref={splitContainerRef} className="flex min-h-0 flex-1 overflow-hidden">
          <div
            className={`flex min-h-0 flex-col min-w-0 ${
              splitResizing ? '' : 'transition-[width] duration-150 ease-out'
            }`}
            style={{ width: `${splitRatio * 100}%` }}
          >
            {/* Avoid a second header row: file identity + actions live in the shell context bar above. */}
            {renderPrimaryEditorContent()}
          </div>

          <div
            className="relative w-3 shrink-0 cursor-col-resize touch-none"
            onPointerDown={(event) => {
              event.preventDefault();
              setSplitResizing(true);
              updateSplitRatioFromClientX(event.clientX);
            }}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize editor panes"
            title="Drag to resize"
          >
            <div className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-[var(--border-secondary)]" />
          </div>

          <div className="flex min-h-0 flex-1 flex-col min-w-0">
            <div className="flex items-center gap-2 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-xs">
              <span className="flex-1 min-w-0 truncate text-[var(--text-muted)]">
                {rightPaneFile
                  ? `${rightPaneSource ? `${rightPaneSource.displayName} • ` : ''}${rightPaneFile}`
                  : 'Right pane: no file'}
              </span>
              {(rightPaneReadOnly || Boolean(rightPaneSourceId)) && (
                <span className="mc-shell-pill px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
                  Read-only
                </span>
              )}
              {rightPaneCacheMeta.cached && (
                <span className="mc-shell-pill px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
                  cached ({rightPaneCachedAgeLabel ?? 'just now'})
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setQuickSwitcherTargetPane('right');
                  setQuickSwitcherOpen(true);
                }}
                className="mc-shell-btn px-2 py-1 text-[11px]"
              >
                Open
              </button>
              <button
                type="button"
                onClick={exitSplitMode}
                className="mc-shell-btn px-2 py-1 text-[11px]"
                aria-label="Close split view"
                title="Close split view"
              >
                Close
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              {rightPaneFile ? (
                editMode ? (
                  <div className="h-full w-full">
                    <LazyCodeMirrorEditor
                      content={rightPaneContent}
                      onChange={handleRightPaneContentChange}
                      readOnly={rightPaneReadOnly || Boolean(rightPaneSourceId)}
                    />
                  </div>
                ) : (
                  shouldRenderMarkdownPreview(rightPaneFile, rightPanePreviewMeta.contentType) ? (
                    <LazyDocumentReadingView
                      content={rightPaneContent}
                      docsPath={rightPaneFile ?? ''}
                      ttsSettings={docsTtsSettings}
                      onTtsSettingsChange={handleDocsTtsSettingsChange}
                      onToast={pushToast}
                      onDocsLinkNavigate={handleMarkdownDocsNavigation}
                      tts="none"
                    />
                  ) : (
                    <div className="h-full w-full overflow-hidden">
                      <LazyCodeMirrorFileViewer
                        content={rightPaneContent}
                        filePath={rightPaneFile ?? ''}
                        contentType={rightPanePreviewMeta.contentType}
                        fileSize={rightPanePreviewMeta.size}
                        isBinary={rightPanePreviewMeta.isBinary}
                        rawFileUrl={rightPaneRawFileUrl}
                      />
                    </div>
                  )
                )
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--text-muted)]">
                  <div className="text-sm">Open a file to show it in the right pane.</div>
                  <button
                    type="button"
                    onClick={() => {
                      setQuickSwitcherTargetPane('right');
                      setQuickSwitcherOpen(true);
                    }}
                    className="mc-shell-btn px-3 py-1 text-xs"
                  >
                    Open File
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Avoid a second header row: file identity + actions live in the shell context bar above. */}
          {renderPrimaryEditorContent()}
        </div>
      )}

      {runtime.agentNativeEditorEnabled && documentsReady && (
        <LazyDocIntelligencePanel
          collapsed={rightSidebarIsCollapsed}
          setCollapsed={setRightSidebarCollapsed}
          docText={fileContent}
          metadata={{
            filename: props.filename ?? null,
            path: currentFile ?? null,
            sourceName: sourceName ?? null,
            contentType: currentFilePreviewMeta.contentType ?? null,
            size: currentFilePreviewMeta.size ?? null,
            updatedAt: currentFileUpdatedAt ?? null,
            readOnly: Boolean(currentFileReadOnly),
            isBinary: Boolean(currentFilePreviewMeta.isBinary),
          }}
          canOpenVersionHistory={Boolean(currentFile && !currentSourceId)}
          versionHistoryOpen={Boolean(fileHistoryPanelOpen)}
          onOpenVersionHistory={() => setFileHistoryPanelOpen(true)}
          documentsReady={documentsReady}
          currentDocId={currentDocId}
          currentFile={currentFile}
          currentSourceId={currentSourceId}
          currentFileReadOnly={currentFileReadOnly}
          editMode={editMode}
          setEditMode={setEditMode}
          setFileContent={setFileContent}
          editorSelection={editorSelection}
          commentThreads={commentThreads}
          setCommentThreads={setCommentThreads}
          selectedCommentId={selectedCommentId}
          setSelectedCommentId={setSelectedCommentId}
          setCommentPopover={setCommentPopover}
          suggestions={suggestions}
          setSuggestions={setSuggestions}
          selectedSuggestionId={selectedSuggestionId}
          setSelectedSuggestionId={setSelectedSuggestionId}
          reviewFindings={reviewFindings}
          reviewMode={reviewMode}
          setReviewMode={setReviewMode}
          reviewRun={reviewRun}
          setReviewRun={setReviewRun}
          setReviewFindings={setReviewFindings}
          selectedFindingId={selectedFindingId}
          setSelectedFindingId={setSelectedFindingId}
          setFocusRange={setFocusRange}
          documentsClient={documentsClient}
          fetchSourceFile={fetchSourceFile}
          pushToast={pushToast}
          handleApplyReviewFindingFix={handleApplyReviewFindingFix}
          handleIgnoreReviewFinding={handleIgnoreReviewFinding}
          rightSidebarHasComments={rightSidebarHasComments}
          rightSidebarHasSuggestions={rightSidebarHasSuggestions}
          focusedRail={props.docIntelligenceFocus}
          onFocusedRailApplied={props.onDocIntelligenceFocusApplied}
          apiBase={runtime.apiBase}
          tasks={props.tasks}
          onOpenTask={props.onOpenTask}
          onOpenRelatedDoc={props.onOpenRelatedDoc}
          splitMode={Boolean(splitMode)}
        />
      )}
    </div>
  );
}
