import { lazy, Suspense, useState } from 'react';
import MobileBottomNav from '../components/MobileBottomNav';
import { shouldRenderMarkdownPreview } from '../lib/markdownFile';

const CodeMirrorEditor = lazy(() => import('../components/CodeMirrorEditor'));
const CodeMirrorFileViewer = lazy(() => import('../components/CodeMirrorFileViewer'));
const DocumentReadingView = lazy(() => import('../components/DocumentReadingView'));
const AuthorshipStatsPanel = lazy(() => import('../components/editor/AuthorshipStatsPanel'));
const UnifiedFileDashboard = lazy(() => import('../components/UnifiedFileDashboard'));
const AgentsSidebarTab = lazy(() => import('../components/AgentsSidebarTab'));
const AgentsMobileDetail = lazy(() => import('../components/AgentsMobileDetail'));
const PluginSubViewSlot = lazy(() => import('../components/plugins/PluginSubViewSlot'));
const PluginTopLevelSlot = lazy(() => import('../components/plugins/PluginTopLevelSlot'));
const ChatView = lazy(() => import('../components/Chat/ChatView'));
const ActivityStream = lazy(() => import('../components/ActivityStream'));
const TaskDetailPanel = lazy(() => import('../components/mission-control/TaskDetailPanel'));

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

const MOBILE_TAB_TITLES: Record<string, string> = {
  files: 'Files',
  agents: 'Agents',
  tasks: 'Tasks',
  services: 'Services',
  chat: 'Chat',
  activity: 'Activity',
};

const TASK_SEGMENTS: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'backlog', label: 'Backlog' },
  { id: 'todo', label: 'Todo' },
  { id: 'doing', label: 'Doing' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
];

// 'all' groups these columns; done + archived are intentionally excluded from the default view.
const TASK_GROUP_ORDER = ['backlog', 'todo', 'doing', 'review'] as const;

const TASK_COLUMN_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  doing: 'Doing',
  review: 'Review',
  done: 'Done',
  archived: 'Archived',
};

const TASK_PRIORITY_CLASS: Record<string, string> = {
  P0: 'bg-red-400/15 text-red-300',
  P1: 'bg-amber-400/15 text-amber-300',
  P2: 'bg-sky-400/15 text-sky-300',
  P3: 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]',
};

function ChevronLeftIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function fileBaseName(path: string): string {
  const normalized = String(path ?? '').replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
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
    docsTtsSettings,
    handleDocsTtsSettingsChange,
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

  const [taskSegment, setTaskSegment] = useState<string>('all');

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

  const clearCurrentFile = () => {
    setCurrentFile(null);
    setFileContent('');
    setCurrentFilePreviewMeta(defaultFilePreviewMeta());
    setCurrentFileCacheMeta(defaultFileCacheMeta());
  };

  const inFileDeepView = Boolean(mobileTab === 'files' && currentFile);
  const inTaskDetail = typeof highlightTaskId === 'number';
  const inDeepView = inFileDeepView || inTaskDetail;

  const boardTasks: any[] = Array.isArray(filteredBoardTasks) ? filteredBoardTasks : [];
  const nonArchivedTasks = boardTasks.filter((task) => !task.archived && task.column !== 'archived');
  const taskCountFor = (segmentId: string): number => {
    if (segmentId === 'all') {
      return nonArchivedTasks.filter((task) => task.column !== 'done').length;
    }
    return nonArchivedTasks.filter((task) => task.column === segmentId).length;
  };

  const renderTaskEmptyState = () => (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="text-4xl opacity-30" aria-hidden="true">
        🗂️
      </span>
      <div className="text-sm text-[var(--text-muted)]">Nothing here yet.</div>
    </div>
  );

  const renderTaskCard = (task: any) => (
    <button
      key={task.id}
      type="button"
      onClick={() => handleTaskSelect(task.id)}
      className="w-full rounded-2xl bg-[var(--bg-secondary)] px-4 py-3.5 text-left transition-opacity active:opacity-80"
    >
      <div className="line-clamp-2 text-[15px] font-medium text-[var(--text-primary)]">{task.name}</div>
      <div className="mt-2 flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <span
          className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
            TASK_PRIORITY_CLASS[task.priority] ?? TASK_PRIORITY_CLASS.P3
          }`}
        >
          {task.priority}
        </span>
        {task.assignee && <span className="truncate">{task.assignee}</span>}
        {task.blocked && <span className="shrink-0 text-amber-300">· blocked</span>}
      </div>
    </button>
  );

  const renderTaskContent = () => {
    if (tasksLoading) {
      return (
        <div className="space-y-2.5">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-20 animate-pulse rounded-2xl bg-[var(--bg-secondary)]" />
          ))}
        </div>
      );
    }

    if (taskSegment === 'all') {
      const groups = TASK_GROUP_ORDER.map((column) => ({
        column,
        items: nonArchivedTasks.filter((task) => task.column === column),
      })).filter((group) => group.items.length > 0);

      if (groups.length === 0) {
        return renderTaskEmptyState();
      }

      return (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.column} className="space-y-2.5">
              <div className="sticky top-0 z-10 bg-[var(--bg-primary)] px-1 py-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                {TASK_COLUMN_LABELS[group.column]} · {group.items.length}
              </div>
              {group.items.map(renderTaskCard)}
            </div>
          ))}
        </div>
      );
    }

    const items = nonArchivedTasks.filter((task) => task.column === taskSegment);
    if (items.length === 0) {
      return renderTaskEmptyState();
    }
    return <div className="space-y-2.5">{items.map(renderTaskCard)}</div>;
  };

  const renderConnectionDot = () => (
    <span
      className={`h-2 w-2 rounded-full ${connected ? 'bg-[var(--accent)]' : 'bg-orange-400'}`}
      aria-label={connected ? 'Connected' : 'Offline'}
      title={connected ? 'Connected' : 'Offline'}
    />
  );

  return (
    <>
      <div
        className={`flex min-w-0 flex-1 flex-col bg-[var(--bg-primary)] md:hidden ${inDeepView ? 'pb-0' : 'pb-24'}`}
      >
        {inFileDeepView ? (
          <div className="flex items-center gap-1 bg-[var(--bg-primary)] px-2 py-2">
            <button
              type="button"
              onClick={clearCurrentFile}
              aria-label="Back to files"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] transition-opacity active:opacity-70"
            >
              <ChevronLeftIcon />
            </button>
            <span className="min-w-0 flex-1 truncate text-center text-[13px] text-[var(--text-secondary)]">
              {fileBaseName(currentFile)}
            </span>
            <div className="flex shrink-0 items-center">
              <button
                type="button"
                disabled={!currentFile}
                onClick={() => setEditMode(!editMode)}
                className="flex h-11 items-center px-3 text-[13px] font-medium text-[var(--accent)] transition-opacity active:opacity-70 disabled:opacity-40"
              >
                {editMode ? 'Preview' : 'Edit'}
              </button>
              {editMode && editorCollabMode !== 'viewing' && !watchMode && canEditCurrentFile && (
                <button
                  type="button"
                  onClick={handleSave}
                  className="flex h-11 items-center px-3 text-[13px] font-semibold text-[var(--accent)] transition-opacity active:opacity-70"
                >
                  Save
                </button>
              )}
            </div>
          </div>
        ) : mobileTab === 'chat' ? (
          <div className="flex items-center justify-between bg-[var(--bg-primary)] px-5 pb-2 pt-3">
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">Chat</h1>
            {renderConnectionDot()}
          </div>
        ) : (
          <div className="flex items-center justify-between bg-[var(--bg-primary)] px-5 pb-3 pt-4">
            <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
              {MOBILE_TAB_TITLES[mobileTab] ?? 'Entity'}
            </h1>
            {renderConnectionDot()}
          </div>
        )}

        <div className="min-h-0 flex-1">
          {mobileTab === 'files' && (
            <div className="flex h-full min-h-0 flex-col">
              {currentFile ? (
                <div className="flex min-h-0 flex-1 flex-col">
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
                        <LazyDocumentReadingView
                          content={fileContent}
                          docsPath={currentFile ?? ''}
                          ttsSettings={docsTtsSettings}
                          onTtsSettingsChange={handleDocsTtsSettingsChange}
                          onToast={pushToast}
                          onDocsLinkNavigate={handleMarkdownDocsNavigation}
                          tts="none"
                          dense
                          animate={fileTransitionActive}
                        />
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
            <div className="h-full overflow-auto px-2">
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
                  agentsLoading={agentsLoading}
                  agentsError={agentsError}
                  selectedAgentId={selectedAgent}
                  followingAgentId={followingAgent}
                  watchMode={watchMode}
                  activities={activities}
                  onSelectAgent={setSelectedAgent}
                  onFollowAgent={setFollowingAgent}
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
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex gap-2 overflow-x-auto px-5 pb-3">
                  {TASK_SEGMENTS.map((segment) => {
                    const active = taskSegment === segment.id;
                    return (
                      <button
                        key={segment.id}
                        type="button"
                        onClick={() => setTaskSegment(segment.id)}
                        className={`shrink-0 rounded-full px-4 py-2 text-[13px] transition-colors ${
                          active
                            ? 'bg-[var(--accent)]/15 text-[var(--text-primary)]'
                            : 'bg-[var(--bg-secondary)] text-[var(--text-muted)]'
                        }`}
                      >
                        {segment.label} <span className="opacity-70">{taskCountFor(segment.id)}</span>
                      </button>
                    );
                  })}
                </div>
                {tasksError && (
                  <div className="mx-5 mb-2 rounded-xl bg-red-400/10 px-3 py-2 text-xs text-red-300">
                    {String(tasksError)}
                  </div>
                )}
                <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{renderTaskContent()}</div>
              </div>
            )
          )}

          {mobileTab === 'services' && (
            <LazyPluginTopLevelSlot apiBase={runtime.apiBase} pluginId="entity-services" />
          )}

          {mobileTab === 'chat' && (
            <div className="flex h-full min-h-0 flex-col pb-2">
              <LazyChatView />
            </div>
          )}

          {mobileTab === 'activity' && (
            <div className="h-full min-h-0">
              <LazyActivityStream
                activities={activities}
                loading={activityLoading}
                error={activityError}
                isOpen={mobileActivityPanelOpen}
                onToggleOpen={() => setMobileActivityPanelOpen((prev: boolean) => !prev)}
                onOpenFile={handleFileSelect}
                onOpenTask={handleTaskSelect}
                fillHeight
              />
            </div>
          )}
        </div>
      </div>

      {inTaskDetail && (
        <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-[var(--bg-primary)] md:hidden">
          <div className="flex items-center gap-1 bg-[var(--bg-primary)] px-2 py-2">
            <button
              type="button"
              onClick={handleCloseTaskDetail}
              aria-label="Close task"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] transition-opacity active:opacity-70"
            >
              <ChevronLeftIcon />
            </button>
            <span className="min-w-0 flex-1 truncate text-center text-[13px] text-[var(--text-secondary)]">
              Task #{highlightTaskId}
            </span>
            <span className="h-11 w-11 shrink-0" aria-hidden="true" />
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <Suspense fallback={<LazySurfaceFallback label="Loading task" />}>
              <TaskDetailPanel
                taskId={highlightTaskId}
                apiBase={runtime.mcOrigin}
                onClose={handleCloseTaskDetail}
                onDocsLinkNavigate={handleTaskOutputDocsNavigation}
              />
            </Suspense>
          </div>
        </div>
      )}

      {!inDeepView && (
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
      )}

      {renderOfflineSyncBar(true)}
    </>
  );
}
