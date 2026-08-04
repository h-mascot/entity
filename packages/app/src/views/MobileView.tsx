import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import MobileBottomNav from '../components/MobileBottomNav';
import MarkdownAudioControls, {
  type MarkdownAudioControlsHandle,
} from '../components/MarkdownAudioControls';
import MCEngineeringEntry from '../components/mission-control/MCEngineeringEntry';
import {
  buildMobileDocHubDocumentIdentity,
  buildMobileDocHubToolsModel,
  reduceMobileManualShareState,
} from '../lib/documentShellState';
import {
  buildCanonicalLocalDocHubUrl,
  buildCanonicalSelectedDocHubToolUrl,
  buildTransientDocHubHistoryRoute,
  parseDocHubRouteState,
  reduceMobileDocHubSurfaceState,
  resolveMobileConvertControlState,
  resolveMobileConvertPickerSelectionTransition,
  resolveMobileDocHubFocusIntent,
  type MobileDocHubSurfaceState,
} from '../lib/docHubRoute';
import { shouldRenderMarkdownPreview } from '../lib/markdownFile';
import { createShareAdapter } from '../lib/shareAdapter';
import { emitDocHubTelemetry } from '../lib/docHubTelemetry';
import {
  getMCBoardTabLabel,
  isMobileMCBoardTabActive,
} from '../lib/mcBoardTabs';

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
const MobileCommentsSurface = lazy(() => import('../components/doc-hub/MobileCommentsSurface'));
const mobileShareAdapter = createShareAdapter();
const MOBILE_DOC_HUB_SURFACE_STATE_KEY = 'entityMobileDocHubSurface';

function historySurface(): MobileDocHubSurfaceState['surface'] {
  if (typeof window === 'undefined' || !window.history.state || typeof window.history.state !== 'object') {
    return 'closed';
  }
  const surface = window.history.state[MOBILE_DOC_HUB_SURFACE_STATE_KEY];
  return surface === 'tools' || surface === 'convert' || surface === 'comments' || surface === 'picker'
    ? surface
    : 'closed';
}

function focusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), '
        + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true');
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
  admin: 'Admin',
};

const ADMIN_MOBILE_SECTIONS: Array<{ id: string; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'profile', label: 'Profile' },
  { id: 'missionControl', label: 'Mission Control' },
  { id: 'agents', label: 'Agents' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'voice', label: 'Voice' },
  { id: 'taskMaster', label: 'Task Master' },
  { id: 'docs', label: 'Docs' },
];

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

function BotIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-[var(--text-muted)]">
      <rect x="4" y="8" width="16" height="11" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 4v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="3.5" r="1.4" fill="currentColor" />
      <circle cx="9" cy="13" r="1.2" fill="currentColor" />
      <circle cx="15" cy="13" r="1.2" fill="currentColor" />
      <path d="M2 12v3M22 12v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function PulseIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-[var(--text-muted)]">
      <path
        d="M3 12h4l2-6 4 12 2-6h6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MobileTabEmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-8 pt-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--bg-tertiary)]">{icon}</div>
      <div className="text-[15px] font-medium text-[var(--text-primary)]">{title}</div>
      <div className="text-[13px] text-[var(--text-muted)]">{subtitle}</div>
    </div>
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
    setMcBoardTab,
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
    openMissionControlModal,
    renderOfflineSyncBar,
    agentsLoading,
    agentsError,
    followingAgent,
    setFollowingAgent,
  } = props;

  const initialMobileRouteState =
    typeof window === 'undefined'
      ? null
      : parseDocHubRouteState(window.location.pathname, window.location.search);
  const initialMobileConvertControls =
    typeof window === 'undefined'
      ? { outputType: 'markdown' as const, templateId: 'Default', jobId: null }
      : resolveMobileConvertControlState(window.location.pathname, window.location.search);
  const [taskSegment, setTaskSegment] = useState<string>('all');
  const [mobileConvertOutput, setMobileConvertOutput] = useState(
    initialMobileConvertControls.outputType,
  );
  const [mobileConvertTemplate, setMobileConvertTemplate] = useState(
    initialMobileConvertControls.templateId,
  );
  const [mobileConvertPrompt, setMobileConvertPrompt] = useState('');
  const currentDocumentIdentity = currentFile
    ? buildMobileDocHubDocumentIdentity(currentSourceId, currentFile)
    : null;
  const [mobileSurfaceState, dispatchMobileSurface] = useReducer(
    reduceMobileDocHubSurfaceState,
    {
      documentIdentity: currentDocumentIdentity,
      surface: 'closed',
      route: {
        activeTool: props.activeDocHubTool ?? initialMobileRouteState?.tool ?? null,
        activeJobId: initialMobileConvertControls.jobId,
      },
    },
  );
  const documentToolsOpen = mobileSurfaceState.surface !== 'closed';
  const mobileConvertOpen =
    mobileSurfaceState.surface === 'convert' || mobileSurfaceState.surface === 'picker';
  const mobileCommentsOpen = mobileSurfaceState.surface === 'comments';
  const [manualShareState, dispatchManualShare] = useReducer(
    reduceMobileManualShareState,
    { documentIdentity: currentDocumentIdentity, value: null, sheetSessionId: null },
  );
  const documentToolsTriggerRef = useRef<HTMLButtonElement>(null);
  const documentToolsDialogRef = useRef<HTMLDivElement>(null);
  const convertActionRef = useRef<HTMLButtonElement>(null);
  const commentsActionRef = useRef<HTMLButtonElement>(null);
  const mobileAudioControlsRef = useRef<MarkdownAudioControlsHandle>(null);
  const convertDialogRef = useRef<HTMLDivElement>(null);
  const commentsDialogRef = useRef<HTMLDivElement>(null);
  const convertCloseRef = useRef<HTMLButtonElement>(null);
  const templatePickerTriggerRef = useRef<HTMLButtonElement>(null);
  const templatePickerDialogRef = useRef<HTMLDivElement>(null);
  const previousSurfaceRef = useRef<MobileDocHubSurfaceState['surface']>('closed');
  const previousDocumentIdentityRef = useRef(currentDocumentIdentity);
  const autoOpenedConvertIdentityRef = useRef<string | null>(null);
  const autoOpenedCommentsIdentityRef = useRef<string | null>(null);
  const mobileShareSessionSequenceRef = useRef(0);
  const pendingMobileConvertTemplateRef = useRef<string | null>(null);
  const durableMobileRouteRef = useRef({
    pathname: typeof window === 'undefined' ? '' : window.location.pathname,
    search: typeof window === 'undefined' ? '' : window.location.search,
  });
  const pushMobileSurfaceHistory = useCallback(
    (surface: Exclude<MobileDocHubSurfaceState['surface'], 'closed'>) => {
      if (typeof window === 'undefined') return;
      const previousState =
        window.history.state && typeof window.history.state === 'object'
          ? window.history.state
          : {};
      window.history.pushState(
        { ...previousState, [MOBILE_DOC_HUB_SURFACE_STATE_KEY]: surface },
        '',
        window.location.href,
      );
    },
    [],
  );
  const synchronizeMobileConvertControlsFromRoute = useCallback(() => {
    if (typeof window === 'undefined') return;
    const controls = resolveMobileConvertControlState(
      window.location.pathname,
      window.location.search,
    );
    setMobileConvertOutput(controls.outputType);
    setMobileConvertTemplate(controls.templateId);
    return controls;
  }, []);
  const replaceMobileConvertRouteValue = useCallback(
    (key: 'convertOutput' | 'convertTemplate', value: string) => {
      if (typeof window === 'undefined') return;
      const url = new URL(window.location.href);
      url.searchParams.set(key, value);
      const previousState =
        window.history.state && typeof window.history.state === 'object'
          ? window.history.state
          : {};
      window.history.replaceState(previousState, '', url.toString());
      durableMobileRouteRef.current = {
        pathname: url.pathname,
        search: url.search,
      };
    },
    [],
  );
  const openDocumentTools = useCallback(() => {
    emitDocHubTelemetry({
      name: 'doc_hub.mobile_tool_sheet.opened',
      properties: { source: 'document-header' },
    });
    mobileShareSessionSequenceRef.current += 1;
    dispatchManualShare({
      type: 'sheet-opened',
      sheetSessionId: String(mobileShareSessionSequenceRef.current),
    });
    pushMobileSurfaceHistory('tools');
    dispatchMobileSurface({ type: 'tools-opened' });
  }, [pushMobileSurfaceHistory]);
  const closeDocumentTools = useCallback(() => {
    dispatchManualShare({ type: 'sheet-dismissed' });
    if (historySurface() === mobileSurfaceState.surface) {
      window.history.back();
      return;
    }
    dispatchMobileSurface({ type: 'close-requested' });
  }, [mobileSurfaceState.surface]);
  const openMobileConvert = useCallback(() => {
    if (!currentFile) return;
    props.onMobileDocHubToolActivated?.('convert');
    durableMobileRouteRef.current = {
      pathname: window.location.pathname,
      search: window.location.search,
    };
    autoOpenedConvertIdentityRef.current = currentDocumentIdentity;
    pushMobileSurfaceHistory('convert');
    dispatchMobileSurface({ type: 'convert-opened' });
  }, [
    currentDocumentIdentity,
    currentFile,
    props.onMobileDocHubToolActivated,
    pushMobileSurfaceHistory,
  ]);
  const openTemplatePicker = useCallback(() => {
    pushMobileSurfaceHistory('picker');
    dispatchMobileSurface({ type: 'picker-opened' });
  }, [pushMobileSurfaceHistory]);
  const openMobileComments = useCallback(() => {
    if (!currentFile) return;
    props.onMobileDocHubToolActivated?.('comments');
    durableMobileRouteRef.current = {
      pathname: window.location.pathname,
      search: window.location.search,
    };
    autoOpenedCommentsIdentityRef.current = currentDocumentIdentity;
    pushMobileSurfaceHistory('comments');
    dispatchMobileSurface({ type: 'comments-opened' });
  }, [
    currentDocumentIdentity,
    currentFile,
    props.onMobileDocHubToolActivated,
    pushMobileSurfaceHistory,
  ]);
  const handleMobileShare = useCallback(async () => {
    if (!currentFile) return;
    props.onMobileDocHubToolActivated?.('share');
    durableMobileRouteRef.current = {
      pathname: window.location.pathname,
      search: window.location.search,
    };

    const routeState = parseDocHubRouteState(window.location.pathname, window.location.search);
    const canonicalUrl = !runtime.fsMultiSourceEnabled && currentSourceId === null
      ? buildCanonicalLocalDocHubUrl(
          currentFile,
          window.location.pathname,
          window.location.search,
          window.location.origin,
        )
      : buildCanonicalSelectedDocHubToolUrl(
          {
            sourceId: currentSourceId ?? routeState?.sourceId ?? 'workspace',
            path: currentFile,
          },
          window.location.pathname,
          window.location.search,
          'share',
          window.location.origin,
        );
    const result = await mobileShareAdapter.share({
      title: fileBaseName(currentFile),
      url: canonicalUrl,
    });

    if (result.status === 'copied') {
      emitDocHubTelemetry({
        name: 'doc_hub.copy_share.result',
        properties: {
          mechanism: 'native-share',
          outcome: 'success',
          recoverable: true,
        },
      });
      pushToast('Link shared or copied.', 'success');
    } else if (result.status === 'manual-required') {
      emitDocHubTelemetry({
        name: 'doc_hub.copy_share.result',
        properties: {
          mechanism: 'native-share',
          outcome: 'fallback',
          recoverable: true,
        },
      });
      emitDocHubTelemetry({
        name: 'doc_hub.clipboard_fallback.displayed',
        properties: {
          surface: 'mobile',
          reason: 'clipboard-unavailable',
        },
      });
      dispatchManualShare({
        type: 'manual-required',
        documentIdentity: currentDocumentIdentity!,
        value: result.value,
        ...(manualShareState.sheetSessionId
          ? { sheetSessionId: manualShareState.sheetSessionId }
          : {}),
      });
    } else if (result.status === 'failed') {
      emitDocHubTelemetry({
        name: 'doc_hub.copy_share.result',
        properties: {
          mechanism: 'native-share',
          outcome: 'failure',
          recoverable: true,
        },
      });
      pushToast(result.safeMessage, 'error');
    } else if (result.status === 'cancelled') {
      emitDocHubTelemetry({
        name: 'doc_hub.copy_share.result',
        properties: {
          mechanism: 'native-share',
          outcome: 'cancelled',
          recoverable: true,
        },
      });
    }
  }, [
    currentFile,
    currentDocumentIdentity,
    currentSourceId,
    manualShareState.sheetSessionId,
    props.onMobileDocHubToolActivated,
    pushToast,
    runtime.fsMultiSourceEnabled,
  ]);
  const handleMobileAudio = useCallback(() => {
    if (!currentFile) return;
    props.onMobileDocHubToolActivated?.('audio');
    durableMobileRouteRef.current = {
      pathname: window.location.pathname,
      search: window.location.search,
    };
    mobileAudioControlsRef.current?.activate();
    closeDocumentTools();
  }, [
    closeDocumentTools,
    currentFile,
    props.onMobileDocHubToolActivated,
  ]);
  const mobileAudioSupported = Boolean(
    currentFile
      && !currentFilePreviewMeta.isBinary
      && shouldRenderMarkdownPreview(currentFile, currentFilePreviewMeta.contentType),
  );
  const documentToolsModel = currentFile
      ? buildMobileDocHubToolsModel(currentFile, {
        intelligenceConvert: openMobileConvert,
        comments: openMobileComments,
        share: handleMobileShare,
        ...(mobileAudioSupported ? { audio: handleMobileAudio } : {}),
      }, {
        activeTool: props.activeDocHubTool ?? mobileSurfaceState.route.activeTool,
      })
    : null;
  const manualShareValue =
    manualShareState.documentIdentity === currentDocumentIdentity ? manualShareState.value : null;

  useEffect(() => {
    const handleConvertClosed = () => {
      dispatchMobileSurface({ type: 'close-requested' });
      if (typeof window !== 'undefined' && historySurface() !== 'closed') {
        const nextState = { ...(window.history.state as Record<string, unknown>) };
        delete nextState[MOBILE_DOC_HUB_SURFACE_STATE_KEY];
        window.history.replaceState(nextState, '', window.location.href);
      }
    };
    window.addEventListener('entity:doc-convert-closed', handleConvertClosed);
    return () => window.removeEventListener('entity:doc-convert-closed', handleConvertClosed);
  }, []);

  useEffect(() => {
    dispatchManualShare({ type: 'document-changed', documentIdentity: currentDocumentIdentity });
    if (previousDocumentIdentityRef.current === currentDocumentIdentity) return;
    previousDocumentIdentityRef.current = currentDocumentIdentity;
    autoOpenedConvertIdentityRef.current = null;
    autoOpenedCommentsIdentityRef.current = null;
    durableMobileRouteRef.current = {
      pathname: typeof window === 'undefined' ? '' : window.location.pathname,
      search: typeof window === 'undefined' ? '' : window.location.search,
    };
    dispatchMobileSurface({ type: 'document-changed', documentIdentity: currentDocumentIdentity });
    if (typeof window !== 'undefined' && historySurface() !== 'closed') {
      const nextState = { ...(window.history.state as Record<string, unknown>) };
      delete nextState[MOBILE_DOC_HUB_SURFACE_STATE_KEY];
      window.history.replaceState(nextState, '', window.location.href);
    }
  }, [currentDocumentIdentity]);

  useEffect(() => {
    const routeState =
      typeof window === 'undefined'
        ? null
        : parseDocHubRouteState(window.location.pathname, window.location.search);
    dispatchMobileSurface({
      type: 'route-synchronized',
      activeTool: props.activeDocHubTool ?? routeState?.tool ?? null,
      activeJobId: synchronizeMobileConvertControlsFromRoute()?.jobId ?? null,
    });
  }, [props.activeDocHubTool, synchronizeMobileConvertControlsFromRoute]);

  useEffect(() => {
    if (
      !currentDocumentIdentity
      || props.activeDocHubTool !== 'convert'
      || mobileSurfaceState.surface !== 'closed'
      || autoOpenedConvertIdentityRef.current === currentDocumentIdentity
    ) {
      return;
    }
    autoOpenedConvertIdentityRef.current = currentDocumentIdentity;
    pushMobileSurfaceHistory('tools');
    dispatchMobileSurface({ type: 'tools-opened' });
    pushMobileSurfaceHistory('convert');
    dispatchMobileSurface({ type: 'convert-opened' });
  }, [
    currentDocumentIdentity,
    mobileSurfaceState.surface,
    props.activeDocHubTool,
    pushMobileSurfaceHistory,
  ]);

  useEffect(() => {
    if (
      !currentDocumentIdentity
      || props.activeDocHubTool !== 'comments'
      || mobileSurfaceState.surface !== 'closed'
      || autoOpenedCommentsIdentityRef.current === currentDocumentIdentity
    ) {
      return;
    }
    autoOpenedCommentsIdentityRef.current = currentDocumentIdentity;
    pushMobileSurfaceHistory('tools');
    dispatchMobileSurface({ type: 'tools-opened' });
    pushMobileSurfaceHistory('comments');
    dispatchMobileSurface({ type: 'comments-opened' });
  }, [
    currentDocumentIdentity,
    mobileSurfaceState.surface,
    props.activeDocHubTool,
    pushMobileSurfaceHistory,
  ]);

  useEffect(() => {
    const handlePopState = () => {
      const pendingTemplate = pendingMobileConvertTemplateRef.current;
      if (pendingTemplate) {
        const transition = resolveMobileConvertPickerSelectionTransition(
          window.location.pathname,
          window.location.search,
          pendingTemplate,
        );
        const selectedUrl = new URL(transition.route, window.location.origin);
        selectedUrl.hash = window.location.hash;
        const nextState =
          window.history.state && typeof window.history.state === 'object'
            ? { ...window.history.state }
            : {};
        window.history.replaceState(
          { ...nextState, [MOBILE_DOC_HUB_SURFACE_STATE_KEY]: transition.surface },
          '',
          selectedUrl.toString(),
        );
        durableMobileRouteRef.current = {
          pathname: selectedUrl.pathname,
          search: selectedUrl.search,
        };
        pendingMobileConvertTemplateRef.current = null;
      }
      if (previousSurfaceRef.current !== 'closed') {
        const preservedRoute = buildTransientDocHubHistoryRoute(
          durableMobileRouteRef.current.pathname,
          durableMobileRouteRef.current.search,
          window.location.pathname,
          window.location.search,
        );
        const preservedUrl = new URL(preservedRoute, window.location.origin);
        preservedUrl.hash = window.location.hash;
        window.history.replaceState(window.history.state, '', preservedUrl.toString());
        durableMobileRouteRef.current = {
          pathname: preservedUrl.pathname,
          search: preservedUrl.search,
        };
        const preservedTool =
          parseDocHubRouteState(preservedUrl.pathname, preservedUrl.search)?.tool;
        if (preservedTool) {
          props.onMobileDocHubToolActivated?.(preservedTool);
        }
      }
      const surface = historySurface();
      const controls = synchronizeMobileConvertControlsFromRoute();
      dispatchMobileSurface({ type: 'history-restored', surface });
      dispatchMobileSurface({
        type: 'route-synchronized',
        activeTool:
          parseDocHubRouteState(window.location.pathname, window.location.search)?.tool ?? null,
        activeJobId: controls?.jobId ?? null,
      });
      if (surface === 'closed') {
        dispatchManualShare({ type: 'sheet-dismissed' });
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [props.onMobileDocHubToolActivated, synchronizeMobileConvertControlsFromRoute]);

  useEffect(() => {
    const previousSurface = previousSurfaceRef.current;
    previousSurfaceRef.current = mobileSurfaceState.surface;
    const focusIntent = resolveMobileDocHubFocusIntent(
      previousSurface,
      mobileSurfaceState.surface,
    );
    if (focusIntent === 'document-trigger') {
      documentToolsTriggerRef.current?.focus();
    } else if (focusIntent === 'dialog-close') {
      if (mobileSurfaceState.surface === 'convert') {
        convertCloseRef.current?.focus();
      } else {
        focusableElements(documentToolsDialogRef.current)[0]?.focus();
      }
    } else if (focusIntent === 'first-tool-action') {
      const activeDialog =
        mobileSurfaceState.surface === 'picker'
          ? templatePickerDialogRef.current
          : commentsDialogRef.current;
      focusableElements(activeDialog)[0]?.focus();
    } else if (focusIntent === 'convert-action') {
      convertActionRef.current?.focus();
    } else if (focusIntent === 'comments-action') {
      commentsActionRef.current?.focus();
    } else if (focusIntent === 'template-trigger') {
      templatePickerTriggerRef.current?.focus();
    }
  }, [mobileSurfaceState.surface]);

  useEffect(() => {
    if (!documentToolsOpen) return;

    const handleSurfaceKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDocumentTools();
        return;
      }
      if (event.key !== 'Tab') return;
      const activeDialog =
        mobileSurfaceState.surface === 'picker'
          ? templatePickerDialogRef.current
          : mobileSurfaceState.surface === 'convert'
            ? convertDialogRef.current
            : mobileSurfaceState.surface === 'comments'
              ? commentsDialogRef.current
              : documentToolsDialogRef.current;
      const focusable = focusableElements(activeDialog);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleSurfaceKeyboard);
    return () => window.removeEventListener('keydown', handleSurfaceKeyboard);
  }, [closeDocumentTools, documentToolsOpen, mobileSurfaceState.surface]);

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
      className="w-full rounded-2xl bg-[var(--bg-tertiary)] px-4 py-4 text-left transition-opacity active:opacity-80"
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
        ref={(node) => {
          if (node) node.inert = documentToolsOpen;
        }}
        aria-hidden={documentToolsOpen ? 'true' : undefined}
        className={`flex min-w-0 flex-1 flex-col bg-[var(--bg-primary)] md:hidden ${inDeepView ? 'pb-0' : 'pb-24'}`}
      >
        {inFileDeepView ? (
          <div className="bg-[var(--bg-primary)] px-2 pb-2 pt-1">
            <div className="flex min-w-0 items-center">
              <button
                type="button"
                onClick={clearCurrentFile}
                aria-label="Back to files"
                title="Back to files"
                className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full text-xl text-[var(--text-secondary)] transition-opacity active:opacity-70"
              >
                <ChevronLeftIcon />
              </button>
              <span className="min-w-0 flex-1 pr-11 text-center">
                <span className="block text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                  Current document
                </span>
                <span
                  className="block truncate text-[13px] font-medium text-[var(--text-secondary)]"
                  title={currentFile}
                >
                  {currentFile}
                </span>
              </span>
            </div>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <button
                ref={documentToolsTriggerRef}
                type="button"
                onClick={openDocumentTools}
                aria-label={documentToolsModel?.trigger.accessibleName}
                title={documentToolsModel?.trigger.accessibleName}
                aria-haspopup="dialog"
                aria-expanded={documentToolsOpen}
                className="flex min-h-[44px] shrink-0 items-center gap-2 rounded-lg px-3 text-[14px] font-semibold text-[var(--text-primary)] transition-colors active:bg-[var(--bg-tertiary)]"
              >
                <span aria-hidden="true">{documentToolsModel?.trigger.icon}</span>
                <span>{documentToolsModel?.trigger.label}</span>
              </button>
              <div className="flex min-w-0 shrink-0 items-center">
                <button
                  type="button"
                  disabled={!currentFile}
                  onClick={() => setEditMode(!editMode)}
                  className="flex min-h-[44px] items-center px-3 text-[14px] font-medium text-[var(--accent)] transition-opacity active:opacity-70 disabled:opacity-40"
                >
                  {editMode ? 'Preview' : 'Edit'}
                </button>
                {editMode && editorCollabMode !== 'viewing' && !watchMode && canEditCurrentFile && (
                  <button
                    type="button"
                    onClick={handleSave}
                    className="flex min-h-[44px] items-center px-3 text-[14px] font-semibold text-[var(--accent)] transition-opacity active:opacity-70"
                  >
                    Save
                  </button>
                )}
              </div>
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
                  <div className="min-h-0 flex-1 overflow-auto pb-28">
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
              ) : !agentsLoading && !agentsError && (!Array.isArray(agents) || agents.length === 0) ? (
                <MobileTabEmptyState
                  icon={<BotIcon />}
                  title="No agents yet"
                  subtitle="Agents appear here when your crew comes online."
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
            <div className="flex h-full min-h-0 flex-col">
                <div className="flex gap-2 overflow-x-auto px-5 pb-3" aria-label="Mission Control boards">
                  {(['kanban', 'engineering'] as const).map((board) => {
                    const active = isMobileMCBoardTabActive(mcBoardTab, board);
                    return (
                      <button
                        key={board}
                        type="button"
                        onClick={() => setMcBoardTab(board)}
                        className={`shrink-0 rounded-full px-4 py-2.5 text-[14px] font-medium transition-colors ${
                          active
                            ? 'bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-[var(--text-primary)] ring-1 ring-[color-mix(in_srgb,var(--accent)_40%,transparent)]'
                            : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                        }`}
                        aria-pressed={active}
                      >
                        {getMCBoardTabLabel(board)}
                      </button>
                    );
                  })}
                </div>
                {activeTaskSubViewPlugin ? (
                  <LazyPluginSubViewSlot apiBase={runtime.apiBase} module="tasks" pluginId={activeTaskSubViewPlugin.id} />
                ) : mcBoardTab === 'engineering' ? (
                  <MCEngineeringEntry
                    viewport="mobile"
                    apiBase={runtime.mcOrigin}
                    highlightTaskId={highlightTaskId}
                    onCloseTask={handleCloseTaskDetail}
                    onDocsLinkNavigate={handleTaskOutputDocsNavigation}
                    onCreateTask={openMissionControlModal}
                  />
                ) : (
                  <>
                <div className="flex gap-2 overflow-x-auto px-5 pb-3">
                  {TASK_SEGMENTS.map((segment) => {
                    const active = taskSegment === segment.id;
                    return (
                      <button
                        key={segment.id}
                        type="button"
                        onClick={() => setTaskSegment(segment.id)}
                        className={`shrink-0 rounded-full px-4 py-2.5 text-[14px] font-medium transition-colors ${
                          active
                            ? 'bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-[var(--text-primary)] ring-1 ring-[color-mix(in_srgb,var(--accent)_40%,transparent)]'
                            : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
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
                  </>
                )}
            </div>
          )}

          {mobileTab === 'services' && (
            <LazyPluginTopLevelSlot apiBase={runtime.apiBase} pluginId="entity-services" />
          )}

          {mobileTab === 'chat' && (
            <div className="flex h-full min-h-0 flex-col">
              <LazyChatView />
            </div>
          )}

          {mobileTab === 'activity' && (
            <div className="h-full min-h-0">
              {!activityLoading && !activityError && (!Array.isArray(activities) || activities.length === 0) ? (
                <MobileTabEmptyState
                  icon={<PulseIcon />}
                  title="No activity yet"
                  subtitle="Workspace events will show up here."
                />
              ) : (
                <LazyActivityStream
                  activities={activities}
                  loading={activityLoading}
                  error={activityError}
                  isOpen
                  onToggleOpen={() => setMobileActivityPanelOpen((prev: boolean) => !prev)}
                  onOpenFile={handleFileSelect}
                  onOpenTask={handleTaskSelect}
                  fillHeight
                />
              )}
            </div>
          )}

          {mobileTab === 'admin' && (
            <div className="flex h-full min-h-0 flex-col">
              <div className="shrink-0 overflow-x-auto px-4 pb-2">
                <div className="flex w-max gap-2">
                  {ADMIN_MOBILE_SECTIONS.map((section) => (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => props.setAdminSection?.(section.id)}
                      className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2.5 text-[14px] font-medium transition-colors ${
                        props.adminSection === section.id
                          ? 'text-[var(--text-primary)] [background:color-mix(in_srgb,var(--accent)_20%,transparent)]'
                          : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                      }`}
                    >
                      {section.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {props.renderAdminWorkspace ? props.renderAdminWorkspace() : null}
              </div>
            </div>
          )}
        </div>
      </div>

      {currentFile
        && currentDocumentIdentity
        && mobileAudioSupported ? (
          <MarkdownAudioControls
            ref={mobileAudioControlsRef}
            docsPath={currentFile}
            documentIdentity={currentDocumentIdentity}
            content={fileContent}
            settings={docsTtsSettings}
            onSettingsChange={handleDocsTtsSettingsChange}
            onOpenVoiceSettings={() => {
              props.setAdminSection?.('voice');
              props.setMobileTab?.('admin');
              props.setSidebarTab?.('admin');
            }}
            onToast={pushToast}
            mobileSticky
            mobileDocumentLabel={fileBaseName(currentFile)}
          />
        ) : null}

      {documentToolsOpen && documentToolsModel ? (
        <div
          ref={documentToolsDialogRef}
          className="fixed inset-0 z-[60] md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={documentToolsModel.sheet.accessibleName}
          aria-hidden={mobileConvertOpen || mobileCommentsOpen ? 'true' : undefined}
        >
          <button
            type="button"
            aria-label="Close document tools"
            onClick={closeDocumentTools}
            className="absolute inset-0 h-full w-full bg-black/55"
          />
          <section
            className="entity-mobile-sheet-enter absolute inset-x-0 bottom-0 max-h-[min(32rem,calc(100dvh-2rem))] overflow-y-auto rounded-t-2xl border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 pt-3 shadow-2xl"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--border-primary)]" />
            <div className="mb-3 flex items-start justify-between gap-3 px-2">
              <div className="min-w-0">
                <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                  {documentToolsModel.sheet.documentIdentity.label}
                </div>
                <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                  {documentToolsModel.sheet.documentIdentity.value}
                </div>
              </div>
              <button
                type="button"
                onClick={closeDocumentTools}
                aria-label="Close document tools"
                className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full text-xl text-[var(--text-secondary)]"
              >
                ×
              </button>
            </div>
            <div className="mb-2 px-2">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Document actions</h2>
              <p className="text-xs text-[var(--text-muted)]">
                Convert, comment, share, or listen.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {documentToolsModel.sheet.actions.map((action) => {
                const active = action.active;
                const enabled = action.availability === 'enabled';
                return (
                  <button
                    key={action.id}
                    ref={
                      action.id === 'intelligence'
                        ? convertActionRef
                        : action.id === 'comments'
                          ? commentsActionRef
                          : undefined
                    }
                    type="button"
                    aria-label={action.accessibleName}
                    aria-pressed={enabled ? active : undefined}
                    aria-disabled={!enabled}
                    disabled={!enabled}
                    onClick={() => {
                      if (action.availability !== 'enabled') return;
                      emitDocHubTelemetry({
                        name: 'doc_hub.mobile_tool.selected',
                        properties: {
                          tool: action.id,
                          source: 'bottom-sheet',
                        },
                      });
                      if (action.id === 'share') {
                        emitDocHubTelemetry({
                          name: 'doc_hub.copy_share.attempt',
                          properties: {
                            mechanism: 'native-share',
                            surface: 'mobile',
                          },
                        });
                      }
                      void action.onSelect();
                    }}
                    className={`flex min-h-[5.75rem] min-w-0 flex-col items-start justify-between rounded-xl border p-3 text-left transition-colors ${
                      active
                        ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--text-primary)]'
                        : enabled
                          ? 'border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-secondary)]'
                          : 'border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-muted)] opacity-60'
                    }`}
                  >
                    <span className="text-xl" aria-hidden="true">{action.icon}</span>
                    <span>
                      <span className="block text-sm font-semibold leading-tight">{action.label}</span>
                      {active ? (
                        <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                          Active
                        </span>
                      ) : null}
                      {action.availability === 'unavailable' ? (
                        <span className="mt-1 block text-[10px] leading-tight">{action.unavailableReason}</span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
            {manualShareValue ? (
              <div className="mt-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3">
                <label
                  htmlFor="mobile-document-share-link"
                  className="text-xs font-medium text-[var(--text-secondary)]"
                >
                  Copy link manually
                </label>
                <textarea
                  id="mobile-document-share-link"
                  readOnly
                  rows={2}
                  value={manualShareValue}
                  aria-label="Canonical link to copy"
                  className="mt-2 w-full resize-none rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-2 text-xs text-[var(--text-primary)]"
                  onFocus={(event) => event.currentTarget.select()}
                  onClick={(event) => event.currentTarget.select()}
                  onPointerUp={(event) => {
                    event.preventDefault();
                    event.currentTarget.select();
                  }}
                />
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {mobileCommentsOpen && currentFile && currentDocumentIdentity ? (
        <div
          ref={commentsDialogRef}
          className="fixed inset-0 z-[70] overflow-hidden bg-[var(--bg-primary)] md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Document comments"
        >
          <Suspense fallback={<LazySurfaceFallback label="Loading comments" />}>
            <MobileCommentsSurface
              documentIdentity={currentDocumentIdentity}
              documentPath={currentFile}
              status={props.commentsLoadState ?? 'unavailable'}
              loadMessage={props.commentsLoadMessage ?? null}
              threads={props.commentThreads ?? []}
              onBack={closeDocumentTools}
              onRetry={() => {
                void props.onRetryMobileComments?.();
              }}
              onCreate={async (text: string) => {
                if (!props.onCreateMobileComment) {
                  throw new Error('Comments are unavailable for this document.');
                }
                await props.onCreateMobileComment(text);
              }}
            />
          </Suspense>
        </div>
      ) : null}

      {mobileConvertOpen && currentFile ? (
        <div
          ref={convertDialogRef}
          className="fixed inset-0 z-[70] flex flex-col overflow-hidden bg-[var(--bg-primary)] md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Convert document"
          aria-hidden={mobileSurfaceState.surface === 'picker' ? 'true' : undefined}
        >
          <header
            className="flex shrink-0 items-center gap-2 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-2"
            style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
          >
            <button
              ref={convertCloseRef}
              type="button"
              onClick={closeDocumentTools}
              aria-label="Back to document tools"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-[var(--text-primary)]"
            >
              <ChevronLeftIcon />
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold text-[var(--text-primary)]">Convert</div>
              <div className="truncate text-xs text-[var(--text-muted)]">{currentFile}</div>
            </div>
            <span className="rounded-full border border-[var(--border-primary)] px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Preview shell
            </span>
          </header>

          <main
            className="min-h-0 flex-1 overflow-y-auto px-3 py-4"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 112px)' }}
          >
            <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
              <section className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Source</h2>
                <div className="mt-3 rounded-xl bg-[var(--bg-primary)] p-3">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                    Current document
                  </div>
                  <div className="mt-1 break-words text-sm text-[var(--text-primary)]">{currentFile}</div>
                </div>
              </section>

              <section className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
                <label
                  htmlFor="mobile-convert-output"
                  className="text-sm font-semibold text-[var(--text-primary)]"
                >
                  Output
                </label>
                <select
                  id="mobile-convert-output"
                  value={mobileConvertOutput}
                  onChange={(event) => {
                    const output = event.target.value as 'html' | 'markdown' | 'audio';
                    setMobileConvertOutput(output);
                    replaceMobileConvertRouteValue('convertOutput', output);
                  }}
                  className="mt-3 min-h-[44px] w-full rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--text-primary)]"
                >
                  <option value="markdown">Markdown</option>
                  <option value="html">HTML</option>
                  <option value="audio">Audio</option>
                </select>
              </section>

              <section className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Template</h2>
                <button
                  ref={templatePickerTriggerRef}
                  type="button"
                  onClick={openTemplatePicker}
                  aria-haspopup="dialog"
                  className="mt-3 flex min-h-[44px] w-full items-center justify-between rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 text-left text-sm text-[var(--text-primary)]"
                >
                  <span>{mobileConvertTemplate}</span>
                  <span aria-hidden="true">›</span>
                </button>
              </section>

              <section className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
                <label
                  htmlFor="mobile-convert-prompt"
                  className="text-sm font-semibold text-[var(--text-primary)]"
                >
                  Prompt
                </label>
                <textarea
                  id="mobile-convert-prompt"
                  rows={5}
                  value={mobileConvertPrompt}
                  onChange={(event) => setMobileConvertPrompt(event.target.value)}
                  placeholder="Add optional conversion guidance"
                  className="mt-3 w-full resize-y rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                />
              </section>

              <section
                aria-label="Conversion progress"
                className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4"
              >
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Progress</h2>
                <div className="mt-3 flex items-center gap-3 text-sm text-[var(--text-secondary)]">
                  <span className="h-2.5 w-2.5 rounded-full bg-[var(--text-muted)]" aria-hidden="true" />
                  <span>
                    {mobileSurfaceState.route.activeJobId
                      ? `Job ${mobileSurfaceState.route.activeJobId} is preserved.`
                      : 'Ready when conversion is enabled.'}
                  </span>
                </div>
              </section>

              <section className="min-h-40 rounded-2xl border border-dashed border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Preview</h2>
                <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
                  Conversion output will appear here for review before anything is saved.
                </p>
              </section>
            </div>
          </main>

          <footer
            className="absolute inset-x-0 bottom-0 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 pt-3"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
          >
            <button
              type="button"
              disabled
              aria-describedby="mobile-convert-unavailable"
              className="min-h-[48px] w-full rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-white opacity-50"
            >
              Convert
            </button>
            <p id="mobile-convert-unavailable" className="mt-2 text-center text-[11px] text-[var(--text-muted)]">
              Conversion remains disabled until the governed job service is connected.
            </p>
          </footer>
        </div>
      ) : null}

      {mobileSurfaceState.surface === 'picker' ? (
        <div
          ref={templatePickerDialogRef}
          className="fixed inset-0 z-[80] flex items-end bg-black/55 p-3 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Choose conversion template"
        >
          <section
            className="w-full rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3 shadow-2xl"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Choose template</h2>
              <button
                type="button"
                onClick={closeDocumentTools}
                aria-label="Close template picker"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-xl text-[var(--text-secondary)]"
              >
                ×
              </button>
            </div>
            {[
              { id: 'Default', label: 'Default' },
              { id: 'executive-brief', label: 'Executive brief' },
              { id: 'clean-html', label: 'Clean HTML' },
            ].map((template) => (
              <button
                key={template.id}
                type="button"
                aria-pressed={mobileConvertTemplate === template.id}
                onClick={() => {
                  setMobileConvertTemplate(template.id);
                  pendingMobileConvertTemplateRef.current = template.id;
                  window.history.back();
                }}
                className="flex min-h-[48px] w-full items-center justify-between rounded-xl px-3 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
              >
                <span>{template.label}</span>
                {mobileConvertTemplate === template.id ? <span aria-hidden="true">✓</span> : null}
              </button>
            ))}
          </section>
        </div>
      ) : null}

      {inTaskDetail && (
        <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-[var(--bg-primary)] md:hidden">
          <div className="flex items-center gap-1 bg-[var(--bg-primary)] px-2 py-2">
            <button
              type="button"
              onClick={handleCloseTaskDetail}
              aria-label="Close task"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--bg-tertiary)] text-[var(--text-primary)] transition-opacity active:opacity-70"
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
                returnBoard={mcBoardTab}
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
            if (tab === 'files' || tab === 'agents' || tab === 'admin') {
              setSidebarTab(tab);
            }
          }}
        />
      )}

      {renderOfflineSyncBar(true)}
    </>
  );
}
