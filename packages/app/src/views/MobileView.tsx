import { lazy, Suspense } from 'react';
import MobileBottomNav from '../components/MobileBottomNav';
import TaskBoard from '../components/TaskBoard';

const CodeMirrorEditor = lazy(() => import('../components/CodeMirrorEditor'));
const CodeMirrorFileViewer = lazy(() => import('../components/CodeMirrorFileViewer'));
const MarkdownPreview = lazy(() => import('../components/MarkdownPreview'));
const MarkdownAudioControls = lazy(() => import('../components/MarkdownAudioControls'));
const AuthorshipStatsPanel = lazy(() => import('../components/editor/AuthorshipStatsPanel'));
const UnifiedFileDashboard = lazy(() => import('../components/UnifiedFileDashboard'));
const AgentsSidebarTab = lazy(() => import('../components/AgentsSidebarTab'));
const AgentsMobileDetail = lazy(() => import('../components/AgentsMobileDetail'));
const PluginSubViewSlot = lazy(() => import('../components/plugins/PluginSubViewSlot'));
const PluginTopLevelSlot = lazy(() => import('../components/plugins/PluginTopLevelSlot'));
const ChatView = lazy(() => import('../components/Chat/ChatView'));
const ActivityStream = lazy(() => import('../components/ActivityStream'));

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

function LazyMarkdownPreview(props: any) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading preview" />}>
      <MarkdownPreview {...props} />
    </Suspense>
  );
}

function LazyMarkdownAudioControls(props: any) {
  return (
    <Suspense fallback={null}>
      <MarkdownAudioControls {...props} />
    </Suspense>
  );
}

function LazyAuthorshipStatsPanel(props: any) {
  return (
    <Suspense fallback={null}>
      <AuthorshipStatsPanel {...props} />
    </Suspense>
  );
}

function LazyUnifiedFileDashboard(props: any) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading files" />}>
      <UnifiedFileDashboard {...props} />
    </Suspense>
  );
}

function LazyAgentsSidebarTab(props: any) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading agents" />}>
      <AgentsSidebarTab {...props} />
    </Suspense>
  );
}

function LazyAgentsMobileDetail(props: any) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading agent" />}>
      <AgentsMobileDetail {...props} />
    </Suspense>
  );
}

function LazyPluginSubViewSlot(props: any) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading plugin" />}>
      <PluginSubViewSlot {...props} />
    </Suspense>
  );
}

function LazyPluginTopLevelSlot(props: any) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading services" />}>
      <PluginTopLevelSlot {...props} />
    </Suspense>
  );
}

function LazyChatView() {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading chat" />}>
      <ChatView />
    </Suspense>
  );
}

function LazyActivityStream(props: any) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading activity" />}>
      <ActivityStream {...props} />
    </Suspense>
  );
}

function defaultFilePreviewMeta() {
  return {
    contentType: 'text/plain',
    size: null,
    isBinary: false,
  };
}

function defaultFileCacheMeta() {
  return {
    cached: false,
    cachedAt: null,
    cacheAgeMs: null,
  };
}

function normalizeDetectedContentType(contentType: string | null | undefined): string {
  if (typeof contentType !== 'string') {
    return '';
  }

  return contentType
    .split(';')[0]
    ?.trim()
    .toLowerCase() ?? '';
}

function isMarkdownContentType(contentType: string | null | undefined): boolean {
  const normalized = normalizeDetectedContentType(contentType);
  if (!normalized) {
    return false;
  }

  return normalized === 'text/markdown' || normalized === 'application/markdown' || normalized.includes('markdown');
}

function isMarkdownFilePath(filePath: string | null): boolean {
  if (!filePath) return false;
  const normalized = filePath.trim().toLowerCase();
  return normalized.endsWith('.md') || normalized.endsWith('.markdown') || normalized.endsWith('.mdx');
}

function shouldRenderMarkdownPreview(filePath: string | null, contentType: string | null | undefined): boolean {
  return isMarkdownFilePath(filePath) || isMarkdownContentType(contentType);
}

export default function MobileView(props: any) {
  const {
    mobileTab,
    workspaceTab,
    onlineAgents,
    agents,
    connected,
    currentFile,
    setCurrentFile,
    setFileContent,
    setCurrentFilePreviewMeta,
    setCurrentFileCacheMeta,
    selectedSource,
    currentFileCacheMeta,
    currentFileCachedAgeLabel,
    runtime,
    handleBackToDashboard,
    editMode,
    setEditMode,
    editorCollabMode,
    watchMode,
    canEditCurrentFile,
    handleSave,
    manualAttributionEnabled,
    authorshipStats,
    manualAuthorshipAuthor,
    setManualAuthorshipAuthor,
    followGlowClassName,
    followTypingPulseActive,
    fileTransitionActive,
    fileContent,
    handleContentChange,
    currentFileReadOnly,
    documentsReady,
    handleSuggestingEdit,
    handleToggleSuggestingMode,
    handleExitSuggestingMode,
    editorAuthorshipRanges,
    handleManualAttribution,
    handleEditorCursorActivity,
    suggestions,
    setSelectedSuggestionId,
    setSelectedFindingId,
    setFocusRange,
    documentsClient,
    currentDocId,
    setSuggestions,
    pushToast,
    currentSourceId,
    fetchSourceFile,
    reviewFindings,
    handleApplyReviewFindingFix,
    handleIgnoreReviewFinding,
    editorPresence,
    followEnabled,
    debouncedFollowCursor,
    setFollowDetached,
    currentFilePreviewMeta,
    currentRawFileUrl,
    handleMarkdownDocsNavigation,
    selectedAgent,
    selectedAgentData,
    activities,
    tasks,
    setSelectedAgent,
    activeTaskSubViewPlugin,
    mcBoardTab,
    highlightTaskId,
    handleTaskSelect,
    handleCloseTaskDetail,
    handleTaskOutputDocsNavigation,
    taskSearchQuery,
    showArchiveColumn,
    setShowArchiveColumn,
    filteredBoardTasks,
    tasksLoading,
    tasksError,
    mobileActivityPanelOpen,
    setMobileActivityPanelOpen,
    activityLoading,
    activityError,
    handleFileSelect,
    handleSourceFileSelect,
    setTabletSidebarOpen,
    setMobileTab,
    setSidebarTab,
    renderOfflineSyncBar,
    agentsLoading,
    agentsError,
    followingAgent,
    setFollowingAgent,
  } = props;

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
      <div className="flex min-w-0 flex-1 flex-col bg-[var(--bg-primary)] pb-14 md:hidden">
        <div className="flex items-center justify-between border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-3">
          <div>
            <div className="text-sm font-semibold">Entity Mission Control</div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              {workspaceTab} · {onlineAgents}/{agents.length} agents online
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="mc-shell-btn inline-flex items-center px-2 py-1 text-[11px]"
              aria-label={connected ? 'Online' : 'Offline'}
              title={connected ? 'Online' : 'Offline'}
            >
              <span
                className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-[var(--accent)]' : 'bg-orange-400'}`}
                aria-hidden="true"
              />
            </span>
            <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{mobileTab}</div>
          </div>
        </div>

        <div className="min-h-0 flex-1">
          {mobileTab === 'files' && (
            <div className="flex h-full min-h-0 flex-col">
              {currentFile ? (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="flex items-center gap-2 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setCurrentFile(null);
                        setFileContent('');
                        setCurrentFilePreviewMeta(defaultFilePreviewMeta());
                        setCurrentFileCacheMeta(defaultFileCacheMeta());
                      }}
                      className="mc-shell-btn px-2 py-1 text-[11px]"
                      aria-label="Back to files"
                    >
                      ←
                    </button>
                    <span className="flex-1 truncate text-[var(--text-muted)]">
                      {selectedSource ? `${selectedSource.displayName} • ` : ''}{currentFile}
                    </span>
                    {currentFileCacheMeta.cached && (
                      <span className="mc-shell-pill px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
                        cached ({currentFileCachedAgeLabel ?? 'just now'})
                      </span>
                    )}
                    {runtime.fsMultiSourceEnabled && (
                      <button
                        type="button"
                        onClick={handleBackToDashboard}
                        className="mc-shell-btn px-2 py-1 text-[11px]"
                      >
                        Back
                      </button>
                    )}
                    <button
                      disabled={!currentFile}
                      onClick={() => setEditMode(!editMode)}
                      className={`mc-shell-btn px-2 py-1 text-[11px] ${
                        editMode ? 'mc-shell-btn-active text-[var(--text-primary)]' : ''
                      } ${currentFile ? '' : 'cursor-not-allowed opacity-40'}`}
                    >
                      {editMode ? 'Preview' : 'Edit'}
                    </button>
                    {editMode && editorCollabMode !== 'viewing' && !watchMode && canEditCurrentFile && (
                      <button
                        onClick={handleSave}
                        className="mc-shell-btn mc-shell-btn-active border-[var(--accent)] px-2 py-1 text-[11px] font-medium text-[var(--text-primary)]"
                      >
                        Save
                      </button>
                    )}
                  </div>
                  {manualAttributionEnabled && (
                    <div className="hidden border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 md:block">
                      <LazyAuthorshipStatsPanel
                        stats={authorshipStats}
                        selectedAuthor={manualAuthorshipAuthor}
                        onSelectAuthor={setManualAuthorshipAuthor}
                      />
                    </div>
                  )}
                  <div className="min-h-0 flex-1 overflow-auto">
                    {editMode ? (
                      <div
                        className={`h-full w-full ${followGlowClassName} ${followTypingPulseActive ? 'agent-typing' : ''} ${
                          fileTransitionActive ? 'mc-file-switch-anim' : ''
                        }`}
                      >
                        <LazyCodeMirrorEditor
                          content={fileContent}
                          onChange={handleContentChange}
                          onSave={handleSave}
                          readOnly={editorCollabMode === 'viewing' || watchMode || (editorCollabMode === 'editing' && currentFileReadOnly)}
                          shortcutsEnabled={runtime.agentNativeEditorEnabled}
                          collabMode={editorCollabMode}
                          onSuggestingEdit={documentsReady ? handleSuggestingEdit : undefined}
                          onToggleSuggestingMode={handleToggleSuggestingMode}
                          onExitSuggestingMode={handleExitSuggestingMode}
                          authorshipRanges={manualAttributionEnabled ? editorAuthorshipRanges : undefined}
                          onManualAttribution={manualAttributionEnabled ? handleManualAttribution : undefined}
                          onCursorActivity={documentsReady ? handleEditorCursorActivity : undefined}
                          suggestions={suggestions}
                          onSelectSuggestion={(suggestionId: string) => {
                            const suggestion = suggestions.find((entry: any) => entry.id === suggestionId) ?? null;
                            if (!suggestion) return;
                            setEditMode(true);
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
                          followEnabled={followEnabled}
                          followCursor={debouncedFollowCursor}
                          onDetachFollow={() => setFollowDetached(true)}
                        />
                      </div>
                    ) : (
                      shouldRenderMarkdownPreview(currentFile, currentFilePreviewMeta.contentType) ? (
                        <div className={`mx-auto max-w-3xl p-4 ${fileTransitionActive ? 'mc-file-switch-anim' : ''}`}>
                          <LazyMarkdownPreview content={fileContent} onDocsLinkNavigate={handleMarkdownDocsNavigation} />
                          <LazyMarkdownAudioControls
                            docsPath={currentFile ?? ''}
                            content={fileContent}
                            settings={props.docsTtsSettings}
                            onSettingsChange={props.handleDocsTtsSettingsChange}
                            onToast={(msg: string, type: string) => pushToast(msg, type === 'success' ? 'success' : type === 'error' ? 'error' : 'info')}
                            compact
                          />
                        </div>
                      ) : (
                        <div className={`h-full w-full overflow-hidden ${fileTransitionActive ? 'mc-file-switch-anim' : ''}`}>
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
              ) : (
                <div className="min-h-0 flex-1">{renderFileHome()}</div>
              )}
            </div>
          )}

          {mobileTab === 'agents' && (
            <div className="h-full overflow-auto">
              {selectedAgent !== null ? (
                <LazyAgentsMobileDetail
                  agent={
                    selectedAgentData ?? {
                      id: selectedAgent,
                      name: selectedAgent,
                      emoji: '🤖',
                      model: '',
                      runtime: '',
                      status: 'offline',
                    }
                  }
                  activities={activities}
                  tasks={tasks}
                  onBack={() => setSelectedAgent(null)}
                />
              ) : (
                <LazyAgentsSidebarTab
                  agents={agents}
                  loading={agentsLoading}
                  error={agentsError}
                  selectedAgentId={selectedAgent}
                  followingAgentId={followingAgent}
                  watchMode={watchMode}
                  activities={activities}
                  onSelectAgent={setSelectedAgent}
                  onSetFollowingAgent={setFollowingAgent}
                  onSetFollowDetached={setFollowDetached}
                  onOpenFile={handleFileSelect}
                  tasks={tasks}
                />
              )}
            </div>
          )}

          {mobileTab === 'tasks' && (
            activeTaskSubViewPlugin ? (
              <LazyPluginSubViewSlot apiBase={runtime.apiBase} module="tasks" pluginId={activeTaskSubViewPlugin.id} />
            ) : (
              <TaskBoard
                viewport="mobile"
                apiBase={runtime.mcOrigin}
                showInsights={mcBoardTab === 'insights'}
                activeTab={mcBoardTab === 'insights' ? 'insights' : 'kanban'}
                highlightTaskId={highlightTaskId}
                onOpenTask={handleTaskSelect}
                onCloseTask={handleCloseTaskDetail}
                onDocsLinkNavigate={handleTaskOutputDocsNavigation}
                searchQuery={taskSearchQuery}
                showArchiveColumn={showArchiveColumn}
                onArchiveColumnVisibilityChange={setShowArchiveColumn}
                tasks={filteredBoardTasks}
                loading={tasksLoading}
                error={tasksError}
              />
            )
          )}

          {mobileTab === 'services' && (
            <LazyPluginTopLevelSlot apiBase={runtime.apiBase} pluginId="entity-services" />
          )}

          {mobileTab === 'chat' && (
            <div className="h-full min-h-0">
              <LazyChatView />
            </div>
          )}

          {mobileTab === 'activity' && (
            <LazyActivityStream
              activities={activities}
              loading={activityLoading}
              error={activityError}
              isOpen={mobileActivityPanelOpen}
              onToggleOpen={() => setMobileActivityPanelOpen((prev: boolean) => !prev)}
              onOpenFile={handleFileSelect}
              onOpenTask={handleTaskSelect}
            />
          )}
        </div>
      </div>

      <MobileBottomNav
        activeTab={mobileTab}
        onChange={(tab) => {
          setTabletSidebarOpen(false);
          setMobileTab(tab);
          if (tab === 'tasks') {
            setSidebarTab('tasks');
            return;
          }
          if (tab === 'services') {
            setSidebarTab('services');
            return;
          }
          if (tab === 'chat') {
            setSidebarTab('chat');
            return;
          }
          if (tab === 'files' || tab === 'agents') {
            setSidebarTab(tab);
          }
        }}
      />

      {renderOfflineSyncBar(true)}
    </>
  );
}
