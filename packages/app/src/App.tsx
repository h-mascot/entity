import {
  lazy,
  Suspense,
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useMemo,
  type ComponentProps,
  type FormEvent,
} from 'react';
import type {
  EditorAuthorshipRange,
  EditorCursorActivity,
  EditorSelectionRange,
  EditorSelectionSnapshot,
  EditorSuggestingEditRequest,
} from './components/CodeMirrorEditor';
import type { NewCommentPopoverAnchor } from './components/NewCommentPopover';
import { ToastViewport } from './components/Toast';
import type { DocsTtsSettings } from './components/MarkdownAudioControls';
import TaskBoard from './components/TaskBoard';
import type { MobileTab } from './components/MobileBottomNav';
import { formatTaskProjectSummary, hasTaskProjectName } from './components/mission-control/utils/taskHelpers';
import { useWebSocket } from './hooks/useWebSocket';
import { useActivityStream } from './hooks/useActivityStream';
import { useFileSources } from './hooks/useFileSources';
import { useFollowMode } from './hooks/useFollowMode';
import { useWatchModeAutoFollow } from './hooks/useWatchModeAutoFollow';
import { useTaskBoard, type TaskBoardTask } from './hooks/useTaskBoard';
import { useIsMobile } from './hooks/useIsMobile';
import { useEntityNotifications } from './hooks/useEntityNotifications';
import { useNotificationCenter } from './hooks/useNotificationCenter';
import { useSyncStatus } from './hooks/useSyncStatus';
import { runtime } from './config/runtime';
import {
  BUILT_IN_AGENTS,
  BUILT_IN_AUTHORSHIP_ACTORS,
  getAgentRegistryRecord,
  resolveAgentAvatarUrl,
} from './lib/agentRegistry';
import { readUserProfile, useUserProfile } from './lib/userProfile';
import { buildApiCandidates, requestJsonWithFallback } from './lib/http';
import { shouldRenderMarkdownPreview } from './lib/markdownFile';
import { resolveTaskOutputDocTarget } from './lib/taskOutputDocTarget';
import {
  buildOpenFileTab,
  buildOpenFileTabKey,
  removeOpenFileTab,
  upsertOpenFileTab,
  type OpenFileTab,
} from './lib/openFileTabs';
import type { DocumentsApiClient, DocumentsClientAuth } from './lib/documents-client';
import { usePluginStore } from './stores/pluginStore';
import {
  OFFLINE_QUEUE_DRAINED_EVENT,
  OFFLINE_QUEUE_STATUS_EVENT,
  readOfflineWriteQueueSnapshot,
  replayOfflineWriteQueue,
  type OfflineQueueSnapshotItem,
} from './lib/offline';
import type {
  DocumentAuthorshipActor,
  DocumentAuthorshipAuthorStats,
  DocumentAuthorshipRangeRecord,
  DocumentAuthorshipStats,
  DocumentCommentThread,
  DocumentPresenceRecord,
  DocumentReviewFinding,
  DocumentReviewMode,
  DocumentReviewRunRecord,
  DocumentSuggestionUiRecord,
} from './types/collaboration';

const FileTree = lazy(() => import('./components/FileTree'));
const SourceFileTree = lazy(() => import('./components/SourceFileTree'));
const NotificationHistoryPanel = lazy(() => import('./components/NotificationHistoryPanel'));
const FileHistoryPanel = lazy(() => import('./components/FileHistoryPanel'));
const ActivityStream = lazy(() => import('./components/ActivityStream'));
const BottomTerminalPanel = lazy(() => import('./components/BottomTerminalPanel'));
const OnboardingFlow = lazy(() => import('./components/OnboardingFlow'));
const PluginSubViewSlot = lazy(() => import('./components/plugins/PluginSubViewSlot'));
const PluginTopLevelSlot = lazy(() => import('./components/plugins/PluginTopLevelSlot'));
const MCStrategicView = lazy(() => import('./components/mission-control/MCStrategicView'));
const AgentsSidebarTab = lazy(() => import('./components/AgentsSidebarTab'));
const AgentsMobileDetail = lazy(() => import('./components/AgentsMobileDetail'));
const AgentDashboardV2 = lazy(() => import('./components/AgentDashboardV2'));
const ChatView = lazy(() => import('./components/Chat/ChatView'));
const NewCommentPopover = lazy(() => import('./components/NewCommentPopover').then((module) => ({ default: module.NewCommentPopover })));
const QuickSwitcher = lazy(() => import('./components/QuickSwitcher'));
const MCCreateTaskModal = lazy(() => import('./components/mission-control/MCCreateTaskModal'));
const ShowClawFeaturedPage = lazy(() => import('./ShowClawFeaturedPage'));
const AdminView = lazy(() => import('./views/AdminView'));
const DocsRouteView = lazy(() => import('./views/DocsRouteView'));
const MobileView = lazy(() => import('./views/MobileView'));
const FilesView = lazy(() => import('./views/FilesView'));

const LOGIN_REQUIRED_KEY = 'entity.auth.login-required.v1';
const AUTH_SESSION_KEY = 'entity.auth.session.v1';
const DOCUMENTS_AUTH_KEY = 'entity.documents.auth.v1';
const MC_SHOW_ARCHIVE_KEY = 'mc_showArchive';
const SIDEBAR_COLLAPSED_KEY = 'entity.sidebar.collapsed.v1';
const RIGHT_SIDEBAR_COLLAPSED_KEY = 'entity.rightSidebar.collapsed.v1';
const THEME_KEY = 'entity.theme.v1';
const PWA_INSTALL_CTA_DISMISSED_KEY = 'entity.pwa.install-cta-dismissed.v1';
const DEFAULT_LOGIN_PASSWORD = 'mission';
const ENTERPRISE_ADMIN_URL = '';

type DocumentsAuthOrigin = 'dev-runtime' | 'user';
type DocumentsAuth = DocumentsClientAuth & { origin?: DocumentsAuthOrigin };

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

function LazyFileTree(props: ComponentProps<typeof FileTree>) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading files" />}>
      <FileTree {...props} />
    </Suspense>
  );
}

function LazySourceFileTree(props: ComponentProps<typeof SourceFileTree>) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading files" />}>
      <SourceFileTree {...props} />
    </Suspense>
  );
}

function LazyNotificationHistoryPanel(props: ComponentProps<typeof NotificationHistoryPanel>) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading notifications" />}>
      <NotificationHistoryPanel {...props} />
    </Suspense>
  );
}

function LazyFileHistoryPanel(props: ComponentProps<typeof FileHistoryPanel>) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading file history" />}>
      <FileHistoryPanel {...props} />
    </Suspense>
  );
}

function LazyActivityStream(props: ComponentProps<typeof ActivityStream>) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading activity" />}>
      <ActivityStream {...props} />
    </Suspense>
  );
}

function LazyBottomTerminalPanel(props: ComponentProps<typeof BottomTerminalPanel>) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading terminal" />}>
      <BottomTerminalPanel {...props} />
    </Suspense>
  );
}

function LazyOnboardingFlow(props: ComponentProps<typeof OnboardingFlow>) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading onboarding" />}>
      <OnboardingFlow {...props} />
    </Suspense>
  );
}

function LazyPluginSubViewSlot(props: ComponentProps<typeof PluginSubViewSlot>) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading plugin" />}>
      <PluginSubViewSlot {...props} />
    </Suspense>
  );
}

function LazyPluginTopLevelSlot(props: ComponentProps<typeof PluginTopLevelSlot>) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading plugin" />}>
      <PluginTopLevelSlot {...props} />
    </Suspense>
  );
}

function LazyMCStrategicView() {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading strategy" />}>
      <MCStrategicView />
    </Suspense>
  );
}

function LazyAgentsSidebarTab(props: ComponentProps<typeof AgentsSidebarTab>) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading agents" />}>
      <AgentsSidebarTab {...props} />
    </Suspense>
  );
}

function LazyAgentsMobileDetail(props: ComponentProps<typeof AgentsMobileDetail>) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading agent" />}>
      <AgentsMobileDetail {...props} />
    </Suspense>
  );
}

function LazyAgentDashboardV2(props: ComponentProps<typeof AgentDashboardV2>) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading agents" />}>
      <AgentDashboardV2 {...props} />
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

interface AgentCapability {
  adapterType?: string;
  runtimeType?: string;
  moduleCount?: number;
  status?: string;
  ownerLabel?: string;
  verificationLabel?: string;
  capabilityLabels?: string[];
  permissionLabels?: string[];
  scopeLabels?: string[];
  runtimeLabel?: string;
  identityLabel?: string;
}

interface AgentRuntimeStatusSummary {
  source: 'helm';
  binding_id: string | null;
  state: 'healthy' | 'degraded' | 'unavailable' | 'unknown';
  health: 'healthy' | 'degraded' | 'unavailable' | 'unknown';
  readiness: 'ready' | 'degraded' | 'unavailable' | 'unknown';
  current_work: string | null;
  heartbeat_at: string | null;
  checked_at: string;
  stale: boolean;
  reason: string;
  helm_link: string | null;
}

interface Agent {
  id: string;
  slug?: string;
  name: string;
  emoji: string;
  avatarUrl?: string;
  description?: string;
  focusFile?: string;
  model: string;
  runtime: string;
  status: 'online' | 'offline';
  rawStatus?: string;
  adapterType?: string;
  runtimeType?: string;
  capabilities?: AgentCapability;
  runtimeStatus?: AgentRuntimeStatusSummary;
  metadata?: Record<string, unknown> | null;
  lastActivity?: {
    action: string;
    timestamp: string;
  };
}

interface AuthSession {
  username: string;
  loggedInAt: string;
}

type WorkspaceTab = 'files' | 'agents' | 'tasks' | 'services' | 'chat' | 'admin';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const navigatorWithStandalone = navigator as NavigatorWithStandalone;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    navigatorWithStandalone.standalone === true
  );
}

function ElapsedTimer({ since }: { since: string }) {
  const [elapsed, setElapsed] = useState('');
  useEffect(() => {
    const update = () => {
      const diff = Date.now() - new Date(since).getTime();
      if (diff < 0) { setElapsed('0s'); return; }
      const secs = Math.floor(diff / 1000);
      const mins = Math.floor(secs / 60);
      const hrs = Math.floor(mins / 60);
      const days = Math.floor(hrs / 24);
      if (days > 0) setElapsed(days + 'd ' + (hrs % 24) + 'h');
      else if (hrs > 0) setElapsed(hrs + 'h ' + (mins % 60) + 'm');
      else if (mins > 0) setElapsed(mins + 'm ' + (secs % 60) + 's');
      else setElapsed(secs + 's');
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [since]);
  return <span className="font-mono text-[var(--accent)]">{elapsed}</span>;
}
/* ── Sidebar Activity Group (collapsible) ── */
function SidebarActivityGroup({ group, onFileSelect, onTaskSelect }: {
  group: {
    key: string;
    agentName: string;
    agentEmoji: string;
    items: Array<{
      id?: string;
      type?: string;
      description?: string;
      timestamp: string;
      filePath?: string;
      taskId?: number;
      taskColumn?: string;
      action?: string;
      agentName?: string;
      agentEmoji?: string;
    }>;
  };
  onFileSelect: (path: string) => void;
  onTaskSelect: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const isSingle = group.items.length === 1;
  const first = group.items[0];

  const formatAction = (action: string) => {
    if (action === 'note') return 'Added note';
    if (action === 'tool_call') return 'Tool call';
    return action;
  };

  const renderEntry = (a: typeof first, i: number) => {
    const entryId = a.id ?? String(i);
    const isExpanded = expandedId === entryId;
    const tooltipText = `${a.agentName ?? 'System'}: ${formatAction(a.action ?? '')}${a.description ? '\n' + a.description : ''}${a.taskId !== undefined ? '\nTask #' + a.taskId : ''}`;
    return (
      <div key={entryId} className="relative group">
        <button
          type="button"
          className="w-full text-left px-2 py-1 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
          onClick={() => {
            if (a.taskId !== undefined) onTaskSelect(a.taskId);
            else if (a.filePath) onFileSelect(a.filePath);
            else setExpandedId(isExpanded ? null : entryId);
          }}
        >
          <div className="flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1 truncate">
              <span className="rounded bg-[var(--bg-tertiary)] px-1 py-0.5 text-[10px] uppercase text-[var(--text-muted)]">{a.type?.replace(/_/g, ' ') ?? ''}</span>
              <span className="truncate text-[var(--text-secondary)]">{formatAction(a.action ?? '')}</span>
            </span>
            <span className="text-[var(--text-muted)] shrink-0 ml-1"><ElapsedTimer since={a.timestamp} /></span>
          </div>
          {isExpanded && (
            <div className="mt-1 text-xs text-[var(--text-secondary)] whitespace-pre-wrap">{a.description}</div>
          )}
        </button>
        {/* Hover tooltip — positioned to the right, overlaying the board */}
        <div className="pointer-events-none fixed z-[9999] hidden w-72 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-primary)] p-3 shadow-xl group-hover:block" style={{ left: '260px', marginTop: '-40px' }}>
          <div className="text-xs font-semibold text-[var(--text-primary)]">{a.agentEmoji ?? '⚡'} {a.agentName ?? 'System'}</div>
          <div className="mt-0.5 text-[11px] font-medium text-[var(--accent)]">{formatAction(a.action ?? '')}</div>
          <div className="mt-1.5 text-[11px] text-[var(--text-secondary)] whitespace-pre-wrap break-words max-h-32 overflow-y-auto">{a.description || 'No details'}</div>
          {a.taskId !== undefined && <div className="mt-1.5 text-[10px] text-[var(--accent)] font-medium">📋 Task #{a.taskId}{a.taskColumn ? ` · ${a.taskColumn}` : ''}</div>}
          {a.filePath && <div className="mt-1 text-[10px] text-[var(--accent)] truncate">📄 {a.filePath}</div>}
          <div className="mt-1.5 text-[10px] text-[var(--text-muted)] border-t border-[var(--border-primary)] pt-1">{new Date(a.timestamp).toLocaleString()}</div>
        </div>
      </div>
    );
  };

  if (isSingle) {
    return (
      <div className="mb-1 rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] overflow-hidden">
        <div className="flex items-center gap-1 px-2 pt-1.5 pb-0.5 text-[11px]">
          <span>{group.agentEmoji}</span>
          <span className="font-medium text-[var(--text-primary)]">{group.agentName}</span>
        </div>
        {renderEntry(first, 0)}
      </div>
    );
  }

  return (
    <div className="mb-1 rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-1 px-2 py-1.5 text-[11px] hover:bg-[var(--bg-tertiary)] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span>{group.agentEmoji}</span>
        <span className="font-medium text-[var(--text-primary)]">{group.agentName}</span>
        <span className="text-[var(--text-muted)]">· {group.items.length} actions</span>
        <span className="ml-auto text-[var(--text-muted)]"><ElapsedTimer since={first.timestamp} /></span>
        <span className="text-[10px] text-[var(--text-muted)] ml-1">{expanded ? '▼' : '▶'}</span>
      </button>
      {!expanded && (
        <div className="px-2 pb-1.5 truncate text-xs text-[var(--text-secondary)]">{first.description}</div>
      )}
      {expanded && (
        <div className="border-t border-[var(--border-primary)]">
          {group.items.map((a, i) => renderEntry(a, i))}
        </div>
      )}
    </div>
  );
}

const BUILTIN_MC_BOARD_TABS = ['kanban', 'strategic', 'insights'] as const;

type BuiltInMCBoardTab = (typeof BUILTIN_MC_BOARD_TABS)[number];
type MCBoardTab = BuiltInMCBoardTab | string;
type MCRuntimeBoard = 'ops' | 'strategic' | 'agents';
type MCAssigneeFilter = string;
const PROJECT_FILTER_OPTIONS = ['all', 'Soteria', 'Curacel', 'Personal', 'Moltbot'] as const;
type MCProjectFilter = (typeof PROJECT_FILTER_OPTIONS)[number];
type AdminSection =
  | 'general'
  | 'profile'
  | 'missionControl'
  | 'agents'
  | 'integrations'
  | 'tts'
  | 'plugins'
  | 'voice'
  | 'enterprise'
  | 'taskMaster'
  | 'docs';
const ADMIN_SECTION_LABELS: Record<AdminSection, string> = {
  general: 'General',
  profile: 'User Profile',
  missionControl: 'Mission Control',
  agents: 'Agent Registry',
  integrations: 'Integrations',
  tts: 'Listen / TTS',
  plugins: 'Plugins',
  voice: 'Voice',
  enterprise: 'Openclaw',
  taskMaster: 'Task Master',
  docs: 'Docs',
};
type AppTheme = 'dark' | 'light' | 'kitz' | 'nebula' | 'aurora' | 'paper';
type EditorCollaborationMode = 'editing' | 'suggesting' | 'viewing';
type DocsTtsProvider = DocsTtsSettings['provider'];
type DocsTtsProviderOption = {
  value: DocsTtsProvider;
  label: string;
  hint: string;
};

function isBuiltInMCBoardTab(value: string): value is BuiltInMCBoardTab {
  return (BUILTIN_MC_BOARD_TABS as readonly string[]).includes(value);
}

function normalizeStoredMCBoardTab(value: string | null): MCBoardTab {
  const normalized = value?.trim() ?? '';
  if (!normalized) {
    return 'kanban';
  }

  return normalized === 'ops' ? 'kanban' : normalized;
}

const FALLBACK_MODULE_LABELS: Record<string, string> = {
  chat: 'Chat',
  tasks: 'Mission Control',
  files: 'Files',
  docs: 'Docs',
  swarm: 'Swarm',
  plugins: 'Plugins',
};

const FALLBACK_MODULE_PERMISSIONS: Record<string, string[]> = {
  chat: ['Post', 'Mention'],
  tasks: ['Assign', 'Review'],
  files: ['Read', 'Write'],
  docs: ['Comment', 'Review'],
  swarm: ['Dispatch', 'Supervise'],
  plugins: ['Toggle', 'Configure'],
};

function uniqueLabels(values: string[], limit: number): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    labels.push(value.trim());
    if (labels.length >= limit) {
      break;
    }
  }

  return labels;
}

function buildFallbackAgentCapabilities(agent: (typeof BUILT_IN_AGENTS)[number]): AgentCapability {
  const capabilityLabels = uniqueLabels(
    agent.modules.map((module) => FALLBACK_MODULE_LABELS[module] ?? module),
    4,
  );
  const permissionLabels = uniqueLabels(
    agent.modules.flatMap((module) => FALLBACK_MODULE_PERMISSIONS[module] ?? []),
    4,
  );

  return {
    status: agent.status,
    verificationLabel: 'Local fallback',
    capabilityLabels,
    permissionLabels,
    scopeLabels: [],
    runtimeLabel: `fallback · ${agent.status}`,
    moduleCount: agent.modules.length,
  };
}
const FALLBACK_AGENTS: Agent[] = BUILT_IN_AGENTS.map((agent) => ({
  id: agent.id,
  slug: agent.slug,
  name: agent.name,
  emoji: agent.emoji,
  avatarUrl: agent.avatarUrl,
  model: '',
  runtime: 'built-in fallback',
  status: agent.status,
  rawStatus: agent.status,
  capabilities: buildFallbackAgentCapabilities(agent),
}));

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function normalizeRuntimeStatus(value: unknown): AgentRuntimeStatusSummary | undefined {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (!record || record.source !== 'helm') {
    return undefined;
  }

  const state = String(record.state ?? '').toLowerCase();
  const health = String(record.health ?? '').toLowerCase();
  const readiness = String(record.readiness ?? '').toLowerCase();
  const normalizedState = state === 'healthy' || state === 'degraded' || state === 'unavailable' || state === 'unknown'
    ? state
    : 'unknown';
  const normalizedHealth = health === 'healthy' || health === 'degraded' || health === 'unavailable' || health === 'unknown'
    ? health
    : 'unknown';
  const normalizedReadiness = readiness === 'ready' || readiness === 'degraded' || readiness === 'unavailable' || readiness === 'unknown'
    ? readiness
    : 'unknown';

  return {
    source: 'helm',
    binding_id: typeof record.binding_id === 'string' && record.binding_id.trim() ? record.binding_id.trim() : null,
    state: normalizedState,
    health: normalizedHealth,
    readiness: normalizedReadiness,
    current_work: typeof record.current_work === 'string' && record.current_work.trim() ? record.current_work.trim() : null,
    heartbeat_at: typeof record.heartbeat_at === 'string' && record.heartbeat_at.trim() ? record.heartbeat_at.trim() : null,
    checked_at: typeof record.checked_at === 'string' && record.checked_at.trim() ? record.checked_at.trim() : new Date().toISOString(),
    stale: record.stale === true,
    reason: typeof record.reason === 'string' && record.reason.trim() ? record.reason.trim() : 'helm_status_unknown',
    helm_link: typeof record.helm_link === 'string' && /^https?:\/\//.test(record.helm_link) ? record.helm_link : null,
  };
}

function normalizeAgentStatus(value: unknown): 'online' | 'offline' {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ['online', 'active', 'running', 'ready'].includes(normalized) ? 'online' : 'offline';
}

function normalizeLabelPart(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function formatAgentRuntime(adapterType: unknown, runtimeType: unknown): string {
  const parts = [adapterType, runtimeType].map(normalizeLabelPart).filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'registry';
}

function prettifyModelId(modelId: string): string {
  const raw = modelId.split('/').slice(1).join('/') || modelId;
  return raw
    .replace(/:latest$/, '')
    .split(/[-_:.\/]/)
    .filter(Boolean)
    .map((part) => {
      const upper = part.toUpperCase();
      return ['GPT', 'GLM', 'AI', 'API', 'MLX'].includes(upper)
        ? upper
        : part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

function normalizeAgentModelLabel(modelId: unknown, models: unknown): string {
  const id = normalizeLabelPart(modelId);
  if (!id) {
    return '';
  }

  if (Array.isArray(models)) {
    const match = models.find((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      return normalizeLabelPart((entry as Record<string, unknown>).id) === id;
    }) as Record<string, unknown> | undefined;
    const name = normalizeLabelPart(match?.name);
    if (name) {
      return name;
    }
  }

  return prettifyModelId(id);
}

function modelRegistryAgentKey(agent: Pick<Agent, 'id' | 'slug' | 'name'>): string {
  const slug = normalizeLabelPart(agent.slug).toLowerCase();
  if (slug) {
    return slug;
  }
  if (agent.id === 'main') {
    return 'ada';
  }
  return normalizeLabelPart(agent.id || agent.name).toLowerCase();
}

async function loadAgentDefaultModelLabels(agents: Agent[]): Promise<Record<string, string>> {
  const agentKeys = Array.from(new Set(agents.map(modelRegistryAgentKey).filter(Boolean)));
  if (agentKeys.length === 0) {
    return {};
  }

  const response = await fetch(`/api/chat/models?agents=${encodeURIComponent(agentKeys.join(','))}`);
  if (!response.ok) {
    return {};
  }

  const data = await response.json() as { agents?: Record<string, { defaultModel?: unknown; models?: unknown[] }> };
  const labels: Record<string, string> = {};
  for (const [agentKey, modelSet] of Object.entries(data.agents ?? {})) {
    const label = normalizeAgentModelLabel(modelSet.defaultModel, modelSet.models);
    if (label) {
      labels[agentKey] = label;
    }
  }
  return labels;
}

function normalizeAgentFromApi(entry: any, userDisplayName?: string): Agent | null {
  const id = String(entry?.id || entry?.slug || entry?.name?.toLowerCase?.() || '').trim();
  if (!id) return null;
  const slug = String(entry?.slug || id).trim().toLowerCase();
  const registryRecord = getAgentRegistryRecord(id) ?? getAgentRegistryRecord(slug) ?? getAgentRegistryRecord(entry?.name);
  const metadata = parseJsonRecord(entry?.metadata_json ?? entry?.metadata);
  const isPlaceholder =
    slug === 'assistant' ||
    metadata?.template === true ||
    metadata?.placeholder === true ||
    String(metadata?.kind ?? '').toLowerCase() === 'template' ||
    String(entry?.status ?? '').toLowerCase() === 'template';
  if (isPlaceholder) return null;

  const adapterType =
    entry?.agentRuntime ||
    entry?.agent_runtime ||
    entry?.adapterType ||
    entry?.adapter_type ||
    entry?.capabilities?.agentRuntime ||
    entry?.capabilities?.adapterType;
  const runtimeType = entry?.runtimeType || entry?.runtime_type || entry?.capabilities?.runtimeType;
  const rawStatus = String(entry?.status ?? entry?.rawStatus ?? entry?.capabilities?.status ?? '').trim();
  const runtimeStatus = normalizeRuntimeStatus(entry?.runtime_status ?? entry?.runtimeStatus);
  const capabilities = entry?.capabilities
    ? {
        ...entry.capabilities,
        ownerLabel:
          typeof entry.capabilities.ownerLabel === 'string' && /henry/i.test(entry.capabilities.ownerLabel) && userDisplayName
            ? userDisplayName
            : entry.capabilities.ownerLabel,
      }
    : undefined;

  return {
    id,
    slug,
    name: entry?.name || entry?.displayName || registryRecord?.name || id,
    emoji: entry?.emoji || registryRecord?.emoji || '🤖',
    description: entry?.description || undefined,
    model: entry?.model || entry?.model_name || normalizeLabelPart(metadata?.model) || '',
    runtime: formatAgentRuntime(adapterType, runtimeType),
    status: normalizeAgentStatus(entry?.status),
    rawStatus: rawStatus || undefined,
    adapterType: adapterType || undefined,
    runtimeType: runtimeType || undefined,
    capabilities,
    runtimeStatus,
    metadata,
    avatarUrl: resolveAgentAvatarUrl(id) || resolveAgentAvatarUrl(slug) || registryRecord?.avatarUrl || entry?.avatarUrl || entry?.avatar_url || undefined,
  };
}

const AUTHORSHIP_ACTORS: readonly DocumentAuthorshipActor[] = BUILT_IN_AUTHORSHIP_ACTORS as readonly DocumentAuthorshipActor[];
const AUTHORSHIP_ACTOR_SET = new Set<DocumentAuthorshipActor>(AUTHORSHIP_ACTORS);

interface FilePreviewMeta {
  contentType: string;
  size: number | null;
  isBinary: boolean;
}

interface FileCacheMeta {
  cached: boolean;
  cachedAt: string | null;
  cacheAgeMs: number | null;
}

interface OfflineQueueStatusEventDetail {
  pending?: number;
}

interface OfflineQueueDrainedEventDetail {
  at?: string;
  applied?: number;
}

function defaultFilePreviewMeta(): FilePreviewMeta {
  return {
    contentType: 'text/plain',
    size: null,
    isBinary: false,
  };
}

function defaultFileCacheMeta(): FileCacheMeta {
  return {
    cached: false,
    cachedAt: null,
    cacheAgeMs: null,
  };
}

function formatElapsedMs(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
    return 'just now';
  }

  if (ms < 60_000) {
    return `${Math.max(1, Math.floor(ms / 1000))}s ago`;
  }
  if (ms < 3_600_000) {
    return `${Math.floor(ms / 60_000)}m ago`;
  }
  if (ms < 86_400_000) {
    return `${Math.floor(ms / 3_600_000)}h ago`;
  }
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function describeQueuedWrite(item: OfflineQueueSnapshotItem): string {
  let path = item.url;
  try {
    const parsed = new URL(item.url, window.location.origin);
    path = parsed.pathname + parsed.search;
  } catch {
    // Keep raw URL fallback.
  }
  return `${item.method.toUpperCase()} ${path}`;
}

function buildDocumentId(sourceId: string | null, filePath: string): string {
  const normalizedPath = filePath.startsWith('/') ? filePath : `/${filePath}`;
  return sourceId ? `${sourceId}:${normalizedPath}` : `local:${normalizedPath}`;
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

function isTextualContentType(contentType: string | null | undefined): boolean {
  const normalized = normalizeDetectedContentType(contentType);
  if (!normalized) {
    return false;
  }

  if (normalized.startsWith('text/')) {
    return true;
  }

  if (normalized.endsWith('+json') || normalized.endsWith('+xml')) {
    return true;
  }

  return (
    normalized === 'application/json' ||
    normalized === 'application/xml' ||
    normalized === 'application/javascript' ||
    normalized === 'application/typescript' ||
    normalized === 'application/yaml' ||
    normalized === 'application/toml' ||
    normalized === 'application/sql' ||
    normalized === 'application/x-sh' ||
    normalized === 'image/svg+xml'
  );
}

function deriveBinaryFlag(contentType: string | null | undefined, explicitFlag: unknown): boolean {
  if (typeof explicitFlag === 'boolean') {
    return explicitFlag;
  }

  const normalized = normalizeDetectedContentType(contentType);
  if (!normalized) {
    return false;
  }

  return !isTextualContentType(normalized);
}

function buildRawFilePreviewUrl(filePath: string | null, sourceId: string | null, apiBase = ''): string | null {
  if (!filePath) {
    return null;
  }

  const params = new URLSearchParams({ path: filePath });
  if (sourceId) {
    params.set('source', sourceId);
  }

  const candidates = buildApiCandidates(`/file/raw?${params.toString()}`, apiBase);
  return candidates[0] ?? null;
}

function extractTaskRouteId(pathname: string): number | null {
  const match = pathname.match(/^\/(?:task|tasks)\/(\d+)(?:\/|$)/i);
  if (!match) {
    return null;
  }

  const taskId = Number(match[1]);
  return Number.isInteger(taskId) && taskId > 0 ? taskId : null;
}

function normalizeAuthorshipActor(author: string): DocumentAuthorshipActor {
  const normalized = author.trim().toLowerCase();
  if (AUTHORSHIP_ACTOR_SET.has(normalized as DocumentAuthorshipActor)) {
    return normalized as DocumentAuthorshipActor;
  }

  return 'human';
}

function toPercent(part: number, whole: number): number {
  if (whole <= 0) {
    return 0;
  }

  return Number(((part / whole) * 100).toFixed(2));
}

function createEmptyAuthorStats(): DocumentAuthorshipAuthorStats {
  return {
    ranges: 0,
    reviewedRanges: 0,
    coveredCharacters: 0,
  };
}

function createEmptyAuthorshipStats(): DocumentAuthorshipStats {
  const byAuthor: Record<string, DocumentAuthorshipAuthorStats> = {};
  for (const actor of AUTHORSHIP_ACTORS) {
    byAuthor[actor] = createEmptyAuthorStats();
  }

  return {
    totalRanges: 0,
    reviewedRanges: 0,
    reviewedPercent: 0,
    coveredCharacters: 0,
    human: 0,
    ada: 0,
    spock: 0,
    scotty: 0,
    byAuthor,
  };
}

function buildAuthorshipStats(contentLength: number, ranges: readonly DocumentAuthorshipRangeRecord[]): DocumentAuthorshipStats {
  const stats = createEmptyAuthorshipStats();
  const maxOffset = Math.max(0, Math.floor(contentLength));

  for (const range of ranges) {
    const start = Math.max(0, Math.min(maxOffset, Math.floor(range.start_offset)));
    const end = Math.max(start, Math.min(maxOffset, Math.floor(range.end_offset)));
    if (end <= start) {
      continue;
    }

    const author = normalizeAuthorshipActor(range.author);
    const span = end - start;
    const authorStats = stats.byAuthor[author] ?? createEmptyAuthorStats();

    stats.totalRanges += 1;
    stats.coveredCharacters += span;
    authorStats.ranges += 1;
    authorStats.coveredCharacters += span;

    if (range.reviewed) {
      stats.reviewedRanges += 1;
      authorStats.reviewedRanges += 1;
    }

    stats.byAuthor[author] = authorStats;
  }

  stats.reviewedPercent = toPercent(stats.reviewedRanges, stats.totalRanges);
  stats.human = toPercent(stats.byAuthor.human?.coveredCharacters ?? 0, stats.coveredCharacters);
  stats.ada = toPercent(stats.byAuthor.ada?.coveredCharacters ?? 0, stats.coveredCharacters);
  stats.spock = toPercent(stats.byAuthor.spock?.coveredCharacters ?? 0, stats.coveredCharacters);
  stats.scotty = toPercent(stats.byAuthor.scotty?.coveredCharacters ?? 0, stats.coveredCharacters);
  return stats;
}

function readLoginRequired(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(LOGIN_REQUIRED_KEY) === 'true';
}

function readAuthSession(): AuthSession | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(AUTH_SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const username = typeof record.username === 'string' ? record.username.trim() : '';
    const loggedInAt = typeof record.loggedInAt === 'string' ? record.loggedInAt : new Date().toISOString();
    if (!username) {
      return null;
    }

    return { username, loggedInAt };
  } catch {
    return null;
  }
}

function persistLoginRequired(value: boolean) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(LOGIN_REQUIRED_KEY, value ? 'true' : 'false');
}

function persistAuthSession(session: AuthSession | null) {
  if (typeof window === 'undefined') {
    return;
  }

  if (!session) {
    window.localStorage.removeItem(AUTH_SESSION_KEY);
    return;
  }

  window.localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
}

function readDocumentsAuth(): DocumentsAuth | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(DOCUMENTS_AUTH_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const kind = typeof record.kind === 'string' ? record.kind.trim().toLowerCase() : '';
    const token = typeof record.token === 'string' ? record.token.trim() : '';
    const origin =
      record.origin === 'dev-runtime' || record.origin === 'user' ? record.origin : undefined;
    if (!token) {
      return null;
    }

    if (origin === 'dev-runtime') {
      window.localStorage.removeItem(DOCUMENTS_AUTH_KEY);
      return null;
    }

    if (kind === 'service') {
      const actorId = typeof record.actorId === 'string' ? record.actorId.trim() : '';
      if (!actorId) {
        return null;
      }
      return { kind: 'service', token, actorId, ...(origin ? { origin } : {}) };
    }

    return { kind: 'bearer', token, ...(origin ? { origin } : {}) };
  } catch {
    return null;
  }
}

function persistDocumentsAuth(auth: DocumentsAuth | null) {
  if (typeof window === 'undefined') {
    return;
  }

  if (!auth || auth.origin === 'dev-runtime') {
    window.localStorage.removeItem(DOCUMENTS_AUTH_KEY);
    return;
  }

  window.localStorage.setItem(DOCUMENTS_AUTH_KEY, JSON.stringify(auth));
}

async function readRuntimeDocumentsAuth(): Promise<DocumentsAuth | null> {
  const response = await fetch(`${runtime.apiBase}/api/runtime`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as { devDocumentsToken?: unknown };
  const runtimeToken = typeof body.devDocumentsToken === 'string' ? body.devDocumentsToken.trim() : '';
  const token = runtimeToken || runtime.devDocumentsToken?.trim() || '';
  return token ? { kind: 'bearer', token, origin: 'dev-runtime' } : null;
}

function toDocumentsClientAuth(auth: DocumentsAuth | null): DocumentsClientAuth | undefined {
  if (!auth) {
    return undefined;
  }

  if (auth.kind === 'service') {
    return { kind: 'service', token: auth.token, actorId: auth.actorId };
  }

  return { kind: 'bearer', token: auth.token };
}

function isSameDocumentsAuth(left: DocumentsAuth | null, right: DocumentsAuth | null): boolean {
  if (!left || !right || left.kind !== right.kind || left.token !== right.token) {
    return false;
  }

  if (left.kind === 'service' || right.kind === 'service') {
    return left.kind === 'service' && right.kind === 'service' && left.actorId === right.actorId;
  }

  return true;
}

function isDocumentsAuthError(error: unknown): boolean {
  const status =
    error && typeof error === 'object' && 'status' in error ? (error as { status?: unknown }).status : undefined;
  if (status === 401) {
    return true;
  }

  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const normalizedMessage = message.toLowerCase();
  return (
    normalizedMessage.includes('authorization') ||
    normalizedMessage.includes('invalid or disabled') ||
    normalizedMessage.includes('token')
  );
}

function readArchivePreference(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }

  const raw = window.localStorage.getItem(MC_SHOW_ARCHIVE_KEY);
  if (raw === null) {
    return true;
  }
  return raw === 'true';
}

function persistArchivePreference(value: boolean) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(MC_SHOW_ARCHIVE_KEY, value ? 'true' : 'false');
}

function readSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
}

function persistSidebarCollapsed(value: boolean) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, value ? 'true' : 'false');
}

function readRightSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(RIGHT_SIDEBAR_COLLAPSED_KEY) === 'true';
}

function persistRightSidebarCollapsed(value: boolean) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(RIGHT_SIDEBAR_COLLAPSED_KEY, value ? 'true' : 'false');
}

function normalizeTheme(value: string | null): AppTheme {
  if (value === 'crew') {
    return 'kitz';
  }

  if (value === 'light' || value === 'kitz' || value === 'nebula' || value === 'aurora' || value === 'paper' || value === 'dark') {
    return value;
  }
  return 'dark';
}

function readThemePreference(): AppTheme {
  if (typeof window === 'undefined') {
    return 'dark';
  }

  try {
    return normalizeTheme(window.localStorage.getItem(THEME_KEY));
  } catch {
    return 'dark';
  }
}

function persistThemePreference(theme: AppTheme) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Ignore persistence errors and keep in-memory theme state.
  }
}

function readInstallCtaDismissed(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(PWA_INSTALL_CTA_DISMISSED_KEY) === 'true';
}

function persistInstallCtaDismissed(value: boolean) {
  if (typeof window === 'undefined') {
    return;
  }

  if (value) {
    window.localStorage.setItem(PWA_INSTALL_CTA_DISMISSED_KEY, 'true');
    return;
  }

  window.localStorage.removeItem(PWA_INSTALL_CTA_DISMISSED_KEY);
}

function applyDocumentTheme(theme: AppTheme) {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.setAttribute('data-theme', theme);
}

function formatElapsedTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function buildTaskSearchSnippet(task: TaskBoardTask, query: string): string {
  const description = task.description?.trim() ?? '';
  if (!description) {
    return `${formatTaskProjectSummary(task)} • ${task.assignee} • ${task.priority}`;
  }

  const lowerDescription = description.toLowerCase();
  const queryIndex = lowerDescription.indexOf(query);
  if (queryIndex < 0) {
    return description.length > 120 ? `${description.slice(0, 117)}...` : description;
  }

  const start = Math.max(0, queryIndex - 24);
  const end = Math.min(description.length, queryIndex + query.length + 64);
  const excerpt = description.slice(start, end).trim();
  const prefix = start > 0 ? '...' : '';
  const suffix = end < description.length ? '...' : '';
  return `${prefix}${excerpt}${suffix}`;
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function buildLocalApiFallbackUrls(path: string): string[] {
  const normalizedPath = normalizePath(path);
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

  return Array.from(
    new Set([
      ...buildApiCandidates(normalizedPath, runtime.apiBase),
      `http://localhost:3001/api${normalizedPath}`,
      `http://127.0.0.1:3001/api${normalizedPath}`,
      `http://${host}:3001/api${normalizedPath}`,
    ])
  );
}

async function requestWithFallback(urls: string[], init: RequestInit, fallbackMessage: string): Promise<Response> {
  let lastError: Error | null = null;

  for (const url of urls) {
    try {
      const response = await fetch(url, init);
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(fallbackMessage);
    }
  }

  throw lastError ?? new Error(fallbackMessage);
}

function createLazyDocumentsApiClient(options: { apiBase?: string; auth?: DocumentsClientAuth }): DocumentsApiClient {
  const loadClient = async () => {
    const { createDocumentsApiClient } = await import('./lib/documents-client');
    return createDocumentsApiClient(options);
  };

  return {
    getIndex: async (...args) => (await loadClient()).getIndex(...args),
    getHealth: async (...args) => (await loadClient()).getHealth(...args),
    getState: async (...args) => (await loadClient()).getState(...args),
    getComments: async (...args) => (await loadClient()).getComments(...args),
    postComment: async (...args) => (await loadClient()).postComment(...args),
    postCommentReply: async (...args) => (await loadClient()).postCommentReply(...args),
    postCommentResolve: async (...args) => (await loadClient()).postCommentResolve(...args),
    getSuggestions: async (...args) => (await loadClient()).getSuggestions(...args),
    postSuggestion: async (...args) => (await loadClient()).postSuggestion(...args),
    acceptSuggestion: async (...args) => (await loadClient()).acceptSuggestion(...args),
    rejectSuggestion: async (...args) => (await loadClient()).rejectSuggestion(...args),
    postReview: async (...args) => (await loadClient()).postReview(...args),
    getReview: async (...args) => (await loadClient()).getReview(...args),
    applyReviewFinding: async (...args) => (await loadClient()).applyReviewFinding(...args),
    ignoreReviewFinding: async (...args) => (await loadClient()).ignoreReviewFinding(...args),
    postEdit: async (...args) => (await loadClient()).postEdit(...args),
    postAuthorship: async (...args) => (await loadClient()).postAuthorship(...args),
    postCursor: async (...args) => (await loadClient()).postCursor(...args),
  };
}

interface DocsApiResponse {
  content?: string;
  path?: string;
  filename?: string;
}

function normalizeDocsRoutePath(value: string): string {
  return value
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/');
}

function decodeDocsRoutePath(value: string): string {
  return value
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join('/');
}

function encodeDocsRoutePath(value: string): string {
  return normalizeDocsRoutePath(value)
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

const KNOWN_DOCS_ROOTS = ['output', 'memory', 'workspace'];

function parseDocsPathFromPathname(pathname: string): string | null {
  if (pathname.startsWith('/docs/')) {
    const rawPath = pathname.slice('/docs/'.length);
    const normalized = normalizeDocsRoutePath(decodeDocsRoutePath(rawPath));
    return normalized || null;
  }

  // Support bare root paths like /output/foo.md → output/foo.md
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length >= 2 && KNOWN_DOCS_ROOTS.includes(segments[0])) {
    const normalized = normalizeDocsRoutePath(decodeDocsRoutePath(segments.join('/')));
    return normalized || null;
  }

  return null;
}

function docsFilenameFromPath(pathname: string | null): string {
  if (!pathname) {
    return 'Document';
  }

  const parts = normalizeDocsRoutePath(pathname).split('/').filter(Boolean);
  return parts[parts.length - 1] ?? 'Document';
}

function filePathSegments(filePath: string | null): string[] {
  return filePath?.split('/').filter(Boolean) ?? [];
}

function filenameFromFilePath(filePath: string | null): string {
  const segments = filePathSegments(filePath);
  return segments[segments.length - 1] ?? 'Document';
}

function buildDocsApiUrls(docPath: string): string[] {
  const encodedDocPath = encodeDocsRoutePath(docPath);
  return buildApiCandidates(`/docs/${encodedDocPath}`, runtime.apiBase).filter((url) => url.includes('/api/'));
}

function resolveDocsPathFromHref(href: string, currentDocsPath: string | null): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const baseUrl = currentDocsPath
    ? `${window.location.origin}/docs/${encodeDocsRoutePath(currentDocsPath)}`
    : `${window.location.origin}/docs/`;

  try {
    const resolved = new URL(trimmed, baseUrl);
    if (resolved.hostname !== window.location.hostname || !resolved.pathname.startsWith('/docs/')) {
      return null;
    }

    return parseDocsPathFromPathname(resolved.pathname);
  } catch {
    return null;
  }
}


export default function App() {
  if (typeof window !== 'undefined' && window.location.pathname === '/showclaw/entity-featured') {
    return (
      <Suspense fallback={<LazySurfaceFallback label="Loading page" />}>
        <ShowClawFeaturedPage />
      </Suspense>
    );
  }
  const initialDocumentsAuth = readDocumentsAuth();
  const [docsPath, setDocsPath] = useState<string | null>(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    return parseDocsPathFromPathname(window.location.pathname);
  });
  const [docsContent, setDocsContent] = useState('');
  const [docsFilename, setDocsFilename] = useState<string>(() => {
    if (typeof window === 'undefined') {
      return 'Document';
    }
    return docsFilenameFromPath(parseDocsPathFromPathname(window.location.pathname));
  });
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [currentFile, setCurrentFile] = useState<string | null>(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    const params = new URLSearchParams(window.location.search);
    return params.get('file') || window.localStorage.getItem('entity.last.file') || null;
  });
  const [currentSourceId, setCurrentSourceId] = useState<string | null>(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    const params = new URLSearchParams(window.location.search);
    return params.get('source') || window.localStorage.getItem('entity.last.source') || null;
  });
  const [splitMode, setSplitMode] = useState<false | 'horizontal'>(false);
  const [rightPaneFile, setRightPaneFile] = useState<string | null>(null);
  const [rightPaneSourceId, setRightPaneSourceId] = useState<string | null>(null);
  const [rightPaneReadOnly, setRightPaneReadOnly] = useState(false);
  const [rightPaneUpdatedAt, setRightPaneUpdatedAt] = useState<string | null>(null);
  const [rightPanePreviewMeta, setRightPanePreviewMeta] = useState<FilePreviewMeta>(() => defaultFilePreviewMeta());
  const [rightPaneCacheMeta, setRightPaneCacheMeta] = useState<FileCacheMeta>(() => defaultFileCacheMeta());
  const [rightPaneContent, setRightPaneContent] = useState('');
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [splitResizing, setSplitResizing] = useState(false);
  const [currentFileReadOnly, setCurrentFileReadOnly] = useState(false);
  const [currentFileUpdatedAt, setCurrentFileUpdatedAt] = useState<string | null>(null);
  const [currentFilePreviewMeta, setCurrentFilePreviewMeta] = useState<FilePreviewMeta>(() => defaultFilePreviewMeta());
  const [currentFileCacheMeta, setCurrentFileCacheMeta] = useState<FileCacheMeta>(() => defaultFileCacheMeta());
  const [openFileTabs, setOpenFileTabs] = useState<OpenFileTab[]>(() => {
    if (typeof window === 'undefined') {
      return [];
    }
    const params = new URLSearchParams(window.location.search);
    const file = params.get('file') || window.localStorage.getItem('entity.last.file');
    const source = params.get('source') || window.localStorage.getItem('entity.last.source');
    if (!file) {
      return [];
    }
    return [buildOpenFileTab(source, file)];
  });
  const [docIntelligenceFocus, setDocIntelligenceFocus] = useState<'intelligence' | 'comments' | 'ask' | 'notes' | 'versions' | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [authorshipRanges, setAuthorshipRanges] = useState<DocumentAuthorshipRangeRecord[]>([]);
  const [manualAuthorshipAuthor, setManualAuthorshipAuthor] = useState<DocumentAuthorshipActor>('human');
  const [sidebarTab, setSidebarTab] = useState<WorkspaceTab>(() => {
    if (typeof window !== 'undefined') {
      const requestedTab = new URLSearchParams(window.location.search).get('tab') as WorkspaceTab | null;
      const validTabs: readonly string[] = ['files', 'agents', 'tasks', 'services', 'chat', 'admin'];
      if (requestedTab && validTabs.includes(requestedTab)) {
        return requestedTab;
      }
    }
    if (typeof window === 'undefined' || !window.localStorage) {
      return 'files';
    }
    const saved = window.localStorage.getItem('entity.sidebar.tab') as WorkspaceTab | null;
    const VALID_TABS: readonly string[] = ['files', 'agents', 'tasks', 'services', 'chat', 'admin'] as const;
    if (saved && VALID_TABS.includes(saved)) {
      return saved;
    }
    return 'files';
  });
  // Persist sidebar tab to localStorage
  useEffect(() => {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    window.localStorage.setItem('entity.sidebar.tab', sidebarTab);
  }, [sidebarTab]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const url = new URL(window.location.href);
    if (currentFile && currentSourceId) {
      url.searchParams.set('file', currentFile);
      url.searchParams.set('source', currentSourceId);
      window.localStorage.setItem('entity.last.file', currentFile);
      window.localStorage.setItem('entity.last.source', currentSourceId);
    } else {
      url.searchParams.delete('file');
      url.searchParams.delete('source');
      window.localStorage.removeItem('entity.last.file');
      window.localStorage.removeItem('entity.last.source');
    }

    if (url.toString() !== window.location.href) {
      window.history.replaceState(null, '', url.toString());
    }
  }, [currentFile, currentSourceId]);

  const [mobileTab, setMobileTab] = useState<MobileTab>('files');
  const [tabletSidebarOpen, setTabletSidebarOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [watchMode, setWatchMode] = useState(false);
  const [editorCollabMode, setEditorCollabMode] = useState<EditorCollaborationMode>('editing');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [agentsErrorDismissed, setAgentsErrorDismissed] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [followingAgent, setFollowingAgent] = useState<string | null>(null);
  const [followDetached, setFollowDetached] = useState(false);
  const [docPresenceByDocId, setDocPresenceByDocId] = useState<Record<string, Record<string, any>>>({});
  const [documentsAuth, setDocumentsAuth] = useState<DocumentsAuth | null>(() => initialDocumentsAuth);
  const [documentsAuthHydrated, setDocumentsAuthHydrated] = useState(false);
  const [documentsAuthTokenDraft, setDocumentsAuthTokenDraft] = useState<string>(() => initialDocumentsAuth?.token ?? '');
  const [documentsAuthKindDraft, setDocumentsAuthKindDraft] = useState<'bearer' | 'service'>(() =>
    initialDocumentsAuth?.kind === 'service' ? 'service' : 'bearer'
  );
  const [documentsAuthActorDraft, setDocumentsAuthActorDraft] = useState<string>(() =>
    initialDocumentsAuth?.kind === 'service' ? initialDocumentsAuth.actorId : 'ada'
  );
  const documentsAuthRef = useRef<DocumentsAuth | null>(initialDocumentsAuth);
  const [commentThreads, setCommentThreads] = useState<DocumentCommentThread[]>([]);
  const [suggestions, setSuggestions] = useState<DocumentSuggestionUiRecord[]>([]);
  const [reviewRun, setReviewRun] = useState<DocumentReviewRunRecord | null>(null);
  const [reviewFindings, setReviewFindings] = useState<DocumentReviewFinding[]>([]);
  const [reviewMode, setReviewMode] = useState<DocumentReviewMode>('grammar');
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [editorSelection, setEditorSelection] = useState<EditorSelectionSnapshot | null>(null);
  const [focusRange, setFocusRange] = useState<EditorSelectionRange | null>(null);
  const [commentPopover, setCommentPopover] = useState<{
    anchor: NewCommentPopoverAnchor;
    selection: EditorSelectionRange;
    selectedText: string;
  } | null>(null);
  const {
    notifications,
    toasts,
    unreadCount: notificationsUnreadCount,
    panelOpen: notificationsPanelOpen,
    selectedNotificationId,
    pushToast,
    dismissToast,
    openPanel: openNotificationsPanel,
    closePanel: closeNotificationsPanel,
    selectNotification: selectNotificationInPanel,
    markAllRead: markAllNotificationsRead,
    clearAll: clearAllNotifications,
  } = useNotificationCenter();
  const [fileHistoryPanelOpen, setFileHistoryPanelOpen] = useState(false);
  const [pendingOverlayRefresh, setPendingOverlayRefresh] = useState<{
    event: 'document.comment' | 'document.suggestion' | 'document.review';
    docId: string;
    emittedAt?: string;
  } | null>(null);
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [quickSwitcherTargetPane, setQuickSwitcherTargetPane] = useState<'left' | 'right'>('left');
  const [activityPanelOpen, setActivityPanelOpen] = useState(false);
  const [mobileActivityPanelOpen, setMobileActivityPanelOpen] = useState(false);
  const [highlightTaskId, setHighlightTaskId] = useState<number | null>(null);
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const [reloadPrompt, setReloadPrompt] = useState<{ path: string; content: string } | null>(null);
  const [loginRequired, setLoginRequired] = useState<boolean>(() => readLoginRequired());
  const [loginGateArmedOnLoad] = useState<boolean>(() => readLoginRequired());
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => readAuthSession());
  const [userProfile, saveUserProfile] = useUserProfile();
  const entityNotifications = useEntityNotifications({
    apiBase: runtime.apiBase,
    recipientPrincipalId: userProfile.handle,
    enabled: notificationsPanelOpen,
  });
  const totalNotificationsUnreadCount = notificationsUnreadCount + entityNotifications.unreadCount;
  const [profileNameDraft, setProfileNameDraft] = useState<string>(() => readUserProfile().displayName);
  const [profileHandleDraft, setProfileHandleDraft] = useState<string>(() => readUserProfile().handle);
  const [profileAvatarDraft, setProfileAvatarDraft] = useState<string>(() => readUserProfile().avatarUrl);
  const [profileEmailDraft, setProfileEmailDraft] = useState<string>(() => readUserProfile().email);
  const [loginUsername, setLoginUsername] = useState<string>(() => readAuthSession()?.username ?? readUserProfile().displayName);
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [showArchiveColumn, setShowArchiveColumn] = useState<boolean>(() => readArchivePreference());
  const [mcBoardTab, setMcBoardTab] = useState<MCBoardTab>(() => {
    if (typeof window === 'undefined' || !window.localStorage) return 'kanban';
    return normalizeStoredMCBoardTab(window.localStorage.getItem('entity.tasks.tab'));
  });
  const [mcAssigneeFilter, setMcAssigneeFilter] = useState<MCAssigneeFilter>('all');
  const [mcPriorityFilter, setMcPriorityFilter] = useState('all');
  const [mcProjectFilter, setMcProjectFilter] = useState<MCProjectFilter>('all');
  const [docsTtsSettings, setDocsTtsSettings] = useState<DocsTtsSettings>(() => {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { provider: 'browser', kokoroVoice: 'bf_alice', edgeVoice: 'en-GB-SoniaNeural', openaiVoice: 'alloy', openaiModel: 'tts-1', deepgramVoice: 'aura-angus-en', elevenlabsVoice: 'EXAVITc4tvU7xuL82wvV', playbackRate: 1 };
    }
    const stored = window.localStorage.getItem('entity.docsTts');
    if (stored) {
      try { return JSON.parse(stored); } catch { /* ignore */ }
    }
    return { provider: 'browser', kokoroVoice: 'bf_alice', edgeVoice: 'en-GB-SoniaNeural', openaiVoice: 'alloy', openaiModel: 'tts-1', deepgramVoice: 'aura-angus-en', elevenlabsVoice: 'EXAVITc4tvU7xuL82wvV', playbackRate: 1 };
  });

  // Persist tasks sub-tab to localStorage
  useEffect(() => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem('entity.tasks.tab', mcBoardTab);
  }, [mcBoardTab]);

  // Persist docs TTS settings to localStorage
  useEffect(() => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem('entity.docsTts', JSON.stringify(docsTtsSettings));
  }, [docsTtsSettings]);

  const handleDocsTtsSettingsChange = useCallback((settings: DocsTtsSettings) => {
    setDocsTtsSettings(settings);
  }, []);

  const [taskSearchQuery, setTaskSearchQuery] = useState('');
  const [createTaskModalOpen, setCreateTaskModalOpen] = useState(false);
  const [adminSection, setAdminSection] = useState<AdminSection>('general');
  const [enterpriseFrameNonce, setEnterpriseFrameNonce] = useState(0);
  const [enterpriseFrameReady, setEnterpriseFrameReady] = useState(false);
  const [enterpriseFrameTimedOut, setEnterpriseFrameTimedOut] = useState(false);
  const [appTheme, setAppTheme] = useState<AppTheme>(() => readThemePreference());
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => readSidebarCollapsed());
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState<boolean>(() => readRightSidebarCollapsed());
  const [isOffline, setIsOffline] = useState<boolean>(() => (typeof navigator !== 'undefined' ? !navigator.onLine : false));
  const [offlineQueuePending, setOfflineQueuePending] = useState(0);
  const [offlineQueueItems, setOfflineQueueItems] = useState<OfflineQueueSnapshotItem[]>([]);
  const [offlineQueueExpanded, setOfflineQueueExpanded] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [pwaInstalled, setPwaInstalled] = useState<boolean>(() => isStandaloneDisplayMode());
  const [installCtaDismissed, setInstallCtaDismissed] = useState<boolean>(() => readInstallCtaDismissed());
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rightSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastContentRef = useRef('');
  const rightLastContentRef = useRef('');
  const currentFileRef = useRef<string | null>(null);
  const lastFileTransitionRef = useRef<string | null>(null);
  const fileTransitionTimeoutRef = useRef<number | null>(null);
  const [fileTransitionActive, setFileTransitionActive] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const splitResizeRafRef = useRef<number | null>(null);
  const isMobile = useIsMobile();
  const {
    activities,
    loading: activityLoading,
    error: activityError,
  } = useActivityStream({ apiBase: runtime.apiBase, maxEntries: 200, useMockData: false });
  const {
    tasks,
    loading: tasksLoading,
    error: tasksError,
    createTask,
    reloadTasks,
  } = useTaskBoard({ apiBase: runtime.apiBase });
  const plugins = usePluginStore((state) => state.plugins);
  const pluginsInitialized = usePluginStore((state) => state.initialized);
  const pluginsLoading = usePluginStore((state) => state.loading);
  const fetchPlugins = usePluginStore((state) => state.fetchPlugins);
  const {
    sources: fileSources,
    fetchFile: fetchSourceFile,
    writeFile: writeSourceFile,
  } = useFileSources({ apiBase: runtime.apiBase, enabled: runtime.fsMultiSourceEnabled });
  const { label: syncStatusLabel, refreshStatus } = useSyncStatus({ apiBase: runtime.apiBase });
  const loginLocked = loginGateArmedOnLoad && loginRequired && !authSession;
  const presenceStatusRef = useRef<Record<string, Record<string, string>>>({});
  const currentDocIdRef = useRef<string | null>(null);
  const documentsReadyRef = useRef(false);
  const cursorHeartbeatTimeoutRef = useRef<number | null>(null);
  const cursorHeartbeatPendingRef = useRef<{ docId: string; payload: Record<string, unknown> } | null>(null);
  const cursorHeartbeatLastSentAtRef = useRef<number>(0);
  const reviewPollAbortRef = useRef<AbortController | null>(null);
  const reviewPollRunIdRef = useRef<string | null>(null);
  const lastBuildHashToastRef = useRef<string | null>(null);
  const docsModeActive = Boolean(docsPath);
  const docsBreadcrumbSegments = useMemo(() => (docsPath ? docsPath.split('/').filter(Boolean) : []), [docsPath]);
  const installCtaVisible = !pwaInstalled && !installCtaDismissed;
  const showOfflineSyncBar = isOffline || offlineQueuePending > 0 || syncingNow;
  const currentFileCachedAgeLabel = currentFileCacheMeta.cached ? formatElapsedMs(currentFileCacheMeta.cacheAgeMs) : null;
  const rightPaneCachedAgeLabel = rightPaneCacheMeta.cached ? formatElapsedMs(rightPaneCacheMeta.cacheAgeMs) : null;
  const taskModulePlugins = useMemo(
    () =>
      plugins.filter(
        (plugin) =>
          plugin.enabled &&
          plugin.mountPoint.type === 'module-sub-view' &&
          plugin.mountPoint.module === 'tasks',
      ),
    [plugins],
  );
  const activeTaskSubViewPlugin = useMemo(
    () => taskModulePlugins.find((plugin) => plugin.id === mcBoardTab) ?? null,
    [mcBoardTab, taskModulePlugins],
  );

  useEffect(() => {
    if (!pluginsInitialized && !pluginsLoading) {
      void fetchPlugins(runtime.apiBase);
    }
  }, [fetchPlugins, pluginsInitialized, pluginsLoading]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${runtime.apiBase}/api/onboarding/state`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`onboarding ${res.status}`))))
      .then((state: { completed?: boolean }) => {
        if (!cancelled) setOnboardingCompleted(Boolean(state.completed));
      })
      .catch(() => {
        if (!cancelled) setOnboardingCompleted(true);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (sidebarTab !== 'tasks') {
      return;
    }

    // Only reset to 'kanban' after plugins have been initialized —
    // otherwise we'd clobber a localStorage-restored plugin tab
    // before the plugin registry has loaded.
    if (!pluginsInitialized) {
      return;
    }

    if (!isBuiltInMCBoardTab(mcBoardTab) && !activeTaskSubViewPlugin) {
      setMcBoardTab('kanban');
    }
  }, [activeTaskSubViewPlugin, mcBoardTab, pluginsInitialized, sidebarTab]);

  const handleInstallClick = useCallback(async () => {
    if (deferredInstallPrompt) {
      try {
        console.log("[PWA] Calling prompt()...", deferredInstallPrompt);
        await deferredInstallPrompt.prompt();
        console.log("[PWA] Prompt shown");
        const choice = await deferredInstallPrompt.userChoice;
        console.log("[PWA] User choice:", choice.outcome);
        if (choice.outcome === 'accepted') {
          setPwaInstalled(true);
        }
      } catch {
        console.error("[PWA] Install error:", arguments[0]);
      } finally {
        setDeferredInstallPrompt(null);
      }
      return;
    }

    pushToast('Use browser menu > Add to Dock (desktop) or Add to Home Screen (mobile).', 'info');
  }, [deferredInstallPrompt, pushToast]);

  const handleDismissInstallCta = useCallback(() => {
    setInstallCtaDismissed(true);
  }, []);

  const refreshOfflineQueueState = useCallback(async () => {
    const snapshot = await readOfflineWriteQueueSnapshot().catch(() => []);
    setOfflineQueueItems(snapshot);
    setOfflineQueuePending(snapshot.length);
  }, []);

  const handleSyncNow = useCallback(async () => {
    if (syncingNow) {
      return;
    }

    setSyncingNow(true);
    try {
      await replayOfflineWriteQueue();
      await refreshOfflineQueueState();
      void reloadTasks();
      void refreshStatus();
    } finally {
      setSyncingNow(false);
    }
  }, [refreshOfflineQueueState, refreshStatus, reloadTasks, syncingNow]);

  const navigateToDocsPath = useCallback(
    (nextPath: string, replace = false, returnTaskId?: number | null): boolean => {
      if (typeof window === 'undefined') {
        return false;
      }

      const normalized = normalizeDocsRoutePath(nextPath);
      if (!normalized) {
        return false;
      }

      // Preserve the originating task across doc→doc navigation unless a new
      // origin is explicitly provided, so "back" can return to the task detail.
      const existingState = window.history.state as { returnTaskId?: unknown } | null;
      const inheritedReturnTaskId =
        existingState && typeof existingState.returnTaskId === 'number' ? existingState.returnTaskId : null;
      const nextReturnTaskId = returnTaskId !== undefined ? returnTaskId : inheritedReturnTaskId;
      const docsState = { mode: 'docs', returnTaskId: nextReturnTaskId };

      const nextPathname = `/docs/${encodeDocsRoutePath(normalized)}`;
      if (window.location.pathname !== nextPathname) {
        if (replace) {
          window.history.replaceState(docsState, '', nextPathname);
        } else {
          window.history.pushState(docsState, '', nextPathname);
        }
      } else {
        window.history.replaceState(docsState, '', nextPathname);
      }

      setDocsPath(normalized);
      return true;
    },
    []
  );

  const handleDocsBackToHome = useCallback(() => {
    const state =
      typeof window !== 'undefined' && window.history.state && typeof window.history.state === 'object'
        ? (window.history.state as { returnTaskId?: unknown })
        : null;
    const returnTaskId = state && typeof state.returnTaskId === 'number' ? state.returnTaskId : null;

    setDocsPath(null);
    setDocsError(null);
    setDocsLoading(false);
    setDocsContent('');
    setDocsFilename('Document');

    if (returnTaskId !== null) {
      // Return to the task detail the doc was opened from.
      if (typeof window !== 'undefined') {
        const nextUrl = new URL(window.location.href);
        nextUrl.pathname = '/task/' + returnTaskId;
        nextUrl.searchParams.delete('file');
        nextUrl.searchParams.delete('source');
        window.history.pushState({ mode: 'task', taskId: returnTaskId }, '', nextUrl.toString());
      }
      setCurrentSourceId(null);
      setCurrentFile(null);
      setMcBoardTab('kanban');
      setSidebarTab('tasks');
      setMobileTab('tasks');
      setHighlightTaskId(returnTaskId);
      return;
    }

    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.history.pushState({ mode: 'app' }, '', '/');
    }
  }, []);

  const handleMarkdownDocsNavigation = useCallback(
    (href: string): boolean => {
      const resolved = resolveDocsPathFromHref(href, docsPath);
      if (!resolved) {
        return false;
      }

      return navigateToDocsPath(resolved);
    },
    [docsPath, navigateToDocsPath]
  );

  // Opening an output doc from a task: prefer the Doc Hub (files tab) so the
  // document opens as a workspace tab with the full Doc Hub chrome. Docs paths
  // look like "<root>/<path>"; when the root matches a configured file source
  // we open it there, otherwise fall back to the standalone /docs route.
  const handleTaskOutputDocsNavigation = useCallback(
    (href: string): boolean => {
      const resolved = resolveDocsPathFromHref(href, docsPath);
      if (!resolved) {
        return false;
      }

      const target = resolveTaskOutputDocTarget(resolved, fileSources, runtime.fsMultiSourceEnabled);
      if (target.kind === 'source') {
        // Leave the /task/<id> route before opening the doc so the URL (and a
        // later reload) reflects the files workspace rather than the task.
        if (typeof window !== 'undefined' && extractTaskRouteId(window.location.pathname) !== null) {
          window.history.pushState({ mode: 'app' }, '', '/');
        }
        handleSourceFileSelect(target.sourceId, target.path);
        return true;
      }

      return navigateToDocsPath(resolved, false, highlightTaskId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleSourceFileSelect is re-created per render
    [docsPath, fileSources, highlightTaskId, navigateToDocsPath, watchMode]
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const syncRouteState = () => {
      const nextPath = parseDocsPathFromPathname(window.location.pathname);
      const routeTaskId = extractTaskRouteId(window.location.pathname);
      setDocsPath(nextPath);

      if (routeTaskId !== null) {
        setCurrentSourceId(null);
        setCurrentFile(null);
        setSidebarTab('tasks');
        setMobileTab('tasks');
        setMcBoardTab('kanban');
        setHighlightTaskId(routeTaskId);
      }
    };

    syncRouteState();

    window.addEventListener('popstate', syncRouteState);
    return () => window.removeEventListener('popstate', syncRouteState);
  }, []);

  useEffect(() => {
    if (!docsPath) {
      return;
    }

    let cancelled = false;
    setDocsLoading(true);
    setDocsError(null);

    requestJsonWithFallback<DocsApiResponse>({
      urls: buildDocsApiUrls(docsPath),
      fallbackError: 'Failed to load document.',
    })
      .then((response) => {
        if (cancelled) {
          return;
        }

        const filenameCandidate =
          typeof response.filename === 'string' && response.filename.trim()
            ? response.filename.trim()
            : docsFilenameFromPath(docsPath);
        setDocsContent(typeof response.content === 'string' ? response.content : '');
        setDocsFilename(filenameCandidate);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setDocsContent('');
        setDocsFilename(docsFilenameFromPath(docsPath));
        setDocsError(error instanceof Error ? error.message : 'Failed to load document.');
      })
      .finally(() => {
        if (!cancelled) {
          setDocsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [docsPath]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleConnectivityChange = () => {
      setIsOffline(!window.navigator.onLine);
    };

    handleConnectivityChange();
    window.addEventListener('online', handleConnectivityChange);
    window.addEventListener('offline', handleConnectivityChange);

    return () => {
      window.removeEventListener('online', handleConnectivityChange);
      window.removeEventListener('offline', handleConnectivityChange);
    };
  }, []);

  useEffect(() => {
    void refreshOfflineQueueState();

    const handleQueueStatus = (event: Event) => {
      const detail = (event as CustomEvent<OfflineQueueStatusEventDetail>).detail;
      if (detail && typeof detail.pending === 'number' && Number.isFinite(detail.pending)) {
        setOfflineQueuePending(Math.max(0, Math.floor(detail.pending)));
      }
      void refreshOfflineQueueState();
    };

    const handleQueueDrained = (event: Event) => {
      const detail = (event as CustomEvent<OfflineQueueDrainedEventDetail>).detail;
      const applied = detail && typeof detail.applied === 'number' && Number.isFinite(detail.applied) ? detail.applied : 0;
      if (applied > 0) {
        pushToast(`Synced! ${applied} changes applied`, 'success');
      }
      void refreshOfflineQueueState();
    };

    const handleOnline = () => {
      void refreshOfflineQueueState();
    };

    const intervalId = window.setInterval(() => {
      void refreshOfflineQueueState();
    }, 15_000);

    window.addEventListener(OFFLINE_QUEUE_STATUS_EVENT, handleQueueStatus);
    window.addEventListener(OFFLINE_QUEUE_DRAINED_EVENT, handleQueueDrained);
    window.addEventListener('online', handleOnline);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener(OFFLINE_QUEUE_STATUS_EVENT, handleQueueStatus);
      window.removeEventListener(OFFLINE_QUEUE_DRAINED_EVENT, handleQueueDrained);
      window.removeEventListener('online', handleOnline);
    };
  }, [pushToast, refreshOfflineQueueState]);

  useEffect(() => {
    if (offlineQueuePending > 0) {
      return;
    }
    setOfflineQueueExpanded(false);
  }, [offlineQueuePending]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; latestHash?: string } | null;
      if (!data || typeof data.type !== 'string') {
        return;
      }

      if (data.type === 'ENTITY_OFFLINE_QUEUE_CHANGED') {
        void refreshOfflineQueueState();
        return;
      }

      if (data.type === 'ENTITY_BUILD_HASH_CHANGED') {
        const latestHash = typeof data.latestHash === 'string' ? data.latestHash : '';
        if (latestHash && lastBuildHashToastRef.current === latestHash) {
          return;
        }
        if (latestHash) {
          lastBuildHashToastRef.current = latestHash;
        }
        pushToast('Update available. Refresh to load the latest build.', 'info');
      }
    };

    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, [pushToast, refreshOfflineQueueState]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredInstallPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setPwaInstalled(true);
      setDeferredInstallPrompt(null);
    };

    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayModeChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setPwaInstalled(true);
        setDeferredInstallPrompt(null);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleDisplayModeChange);
    } else {
      mediaQuery.addListener(handleDisplayModeChange);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', handleDisplayModeChange);
      } else {
        mediaQuery.removeListener(handleDisplayModeChange);
      }
    };
  }, []);

  useEffect(() => {
    persistLoginRequired(loginRequired);
  }, [loginRequired]);

  useEffect(() => {
    persistAuthSession(authSession);
  }, [authSession]);

  useEffect(() => {
    setProfileNameDraft(userProfile.displayName);
    setProfileHandleDraft(userProfile.handle);
    setProfileAvatarDraft(userProfile.avatarUrl);
    setProfileEmailDraft(userProfile.email);
  }, [userProfile]);

  useEffect(() => {
    persistDocumentsAuth(documentsAuth);
  }, [documentsAuth]);

  useEffect(() => {
    documentsAuthRef.current = documentsAuth;
  }, [documentsAuth]);

  useEffect(() => {
    let cancelled = false;
    readRuntimeDocumentsAuth()
      .then((auth) => {
        try {
          if (cancelled) {
            return;
          }

          const currentAuth = documentsAuthRef.current;
          if (!auth) {
            if (currentAuth?.origin === 'dev-runtime') {
              setDocumentsAuth(null);
              setDocumentsAuthTokenDraft('');
              setDocumentsAuthKindDraft('bearer');
              setDocumentsAuthActorDraft('ada');
            }
            return;
          }

          if (currentAuth?.origin === 'user') {
            return;
          }

          if (currentAuth?.origin === 'dev-runtime' && isSameDocumentsAuth(currentAuth, auth)) {
            return;
          }

          setDocumentsAuth(auth);
          setDocumentsAuthTokenDraft(auth.token);
          setDocumentsAuthKindDraft('bearer');
          setDocumentsAuthActorDraft('ada');
        } finally {
          setDocumentsAuthHydrated(true);
        }
      })
      .catch(() => {
        // Runtime dev auth is optional; Admin-provided tokens still work.
        setDocumentsAuthHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    persistArchivePreference(showArchiveColumn);
  }, [showArchiveColumn]);

  useEffect(() => {
    persistSidebarCollapsed(sidebarCollapsed);
  }, [sidebarCollapsed]);

  useEffect(() => {
    persistRightSidebarCollapsed(rightSidebarCollapsed);
  }, [rightSidebarCollapsed]);

  useEffect(() => {
    persistThemePreference(appTheme);
    applyDocumentTheme(appTheme);
  }, [appTheme]);

  useEffect(() => {
    persistInstallCtaDismissed(installCtaDismissed);
  }, [installCtaDismissed]);

  useEffect(() => {
    if (sidebarTab !== 'admin' || adminSection !== 'enterprise') {
      return;
    }

    setEnterpriseFrameReady(false);
    setEnterpriseFrameTimedOut(false);

    const timeoutId = window.setTimeout(() => {
      setEnterpriseFrameTimedOut(true);
    }, 5000);

    return () => window.clearTimeout(timeoutId);
  }, [sidebarTab, adminSection, enterpriseFrameNonce]);

  // Update ref
  useEffect(() => {
    currentFileRef.current = currentFile;
  }, [currentFile]);

// [MOVED] exitSplitMode useEffect moved after its definition

  useLayoutEffect(() => {
    if (fileTransitionTimeoutRef.current !== null) {
      window.clearTimeout(fileTransitionTimeoutRef.current);
      fileTransitionTimeoutRef.current = null;
    }

    if (!currentFile) {
      lastFileTransitionRef.current = null;
      setFileTransitionActive(false);
      return;
    }

    if (lastFileTransitionRef.current && lastFileTransitionRef.current !== currentFile) {
      setFileTransitionActive(true);
      fileTransitionTimeoutRef.current = window.setTimeout(() => {
        setFileTransitionActive(false);
        fileTransitionTimeoutRef.current = null;
      }, 220);
    }

    lastFileTransitionRef.current = currentFile;

    return () => {
      if (fileTransitionTimeoutRef.current !== null) {
        window.clearTimeout(fileTransitionTimeoutRef.current);
        fileTransitionTimeoutRef.current = null;
      }
    };
  }, [currentFile]);

  useEffect(() => {
    setAuthorshipRanges([]);
  }, [currentFile, currentSourceId]);

  const currentDocId = useMemo(() => {
    if (!currentFile) {
      return null;
    }
    return buildDocumentId(currentSourceId, currentFile);
  }, [currentFile, currentSourceId]);

  useEffect(() => {
    currentDocIdRef.current = currentDocId;
  }, [currentDocId]);

  // WebSocket for real-time updates
  const { connected } = useWebSocket({
    onFileChange: useCallback((path: string, content: string) => {
      if (currentSourceId) {
        return;
      }
      // If user is editing this file, show reload prompt
      if (currentFileRef.current === path && editMode) {
        setReloadPrompt({ path, content });
      } else if (currentFileRef.current === path) {
        // Live update in preview mode
        setFileContent(content);
      }
    }, [currentSourceId, editMode]),
    onFileCreate: useCallback((path: string) => {
      // Refresh file tree if in files tab
      // This would need a refresh trigger
    }, []),
    onFileDelete: useCallback((path: string) => {
      if (currentSourceId) {
        return;
      }
      if (currentFileRef.current === path) {
        setCurrentFile(null);
        setFileContent('');
        setCurrentFilePreviewMeta(defaultFilePreviewMeta());
        setCurrentFileCacheMeta(defaultFileCacheMeta());
      }
    }, [currentSourceId]),
    onMention: useCallback((agent: string, document: string, instruction: string) => {
      console.log(`[WS] ${agent} mentioned in ${document}: ${instruction}`);
    }, []),
    onEditorEvent: useCallback((message: { event: string; docId: string; payload: unknown; emittedAt?: string }) => {
      const { event, docId, payload, emittedAt } = message;
      const normalizedEvent = event.trim();
      if (!payload || typeof payload !== 'object') {
        return;
      }

      const record = payload as Record<string, unknown>;
      if (normalizedEvent === 'document.cursor' || normalizedEvent === 'document:cursor') {
        const actor = typeof record.actor === 'string' ? record.actor.trim().toLowerCase() : '';
        if (!actor) {
          return;
        }

        const heartbeatAtCandidate =
          typeof record.heartbeatAt === 'string'
            ? record.heartbeatAt
            : typeof record.heartbeat_at === 'string'
              ? record.heartbeat_at
              : typeof emittedAt === 'string'
                ? emittedAt
                : null;
        const heartbeatAt = typeof heartbeatAtCandidate === 'string' ? heartbeatAtCandidate : new Date().toISOString();

        const presence = record.presence;
        const cursorCandidate = record.cursor ?? record.cursor_json ?? record.position ?? record.selection;
        const nextPresence =
          presence && typeof presence === 'object'
            ? presence
            : cursorCandidate
              ? {
                  id: `cursor-${docId}-${actor}`,
                  doc_id: docId,
                  agent_id: actor,
                  status: 'active',
                  cursor_json: cursorCandidate,
                  last_activity_at: heartbeatAt,
                  created_at: heartbeatAt,
                  updated_at: heartbeatAt,
                }
              : null;

        if (!nextPresence || typeof nextPresence !== 'object') {
          return;
        }

        setDocPresenceByDocId((current) => {
          const existingDoc = current[docId] ?? {};
          return {
            ...current,
            [docId]: {
              ...existingDoc,
              [actor]: nextPresence,
            },
          };
        });
        return;
      }

      if (normalizedEvent === 'document.presence' || normalizedEvent === 'document:presence') {
        const actor = typeof record.actor === 'string' ? record.actor.trim().toLowerCase() : '';
        const presence = record.presence;
        if (!actor || !presence || typeof presence !== 'object') {
          return;
        }

        const action = typeof record.action === 'string' ? record.action.trim().toLowerCase() : '';
        const presenceRecord = presence as Record<string, unknown>;
        const statusCandidate = typeof presenceRecord.status === 'string' ? presenceRecord.status.trim().toLowerCase() : '';
        let nextStatus =
          statusCandidate === 'active' || statusCandidate === 'idle' || statusCandidate === 'disconnected'
            ? statusCandidate
            : null;

        if (!nextStatus && action === 'joined') {
          nextStatus = 'active';
        } else if (!nextStatus && action === 'left') {
          nextStatus = 'disconnected';
        }

        const previousStatus = presenceStatusRef.current[docId]?.[actor] ?? null;
        const prevWasDisconnected = !previousStatus || previousStatus === 'disconnected';
        const nextIsDisconnected = !nextStatus || nextStatus === 'disconnected';

        let toastAction: 'joined' | 'left' | null = null;
        if (action === 'joined' || action === 'left') {
          toastAction = action as 'joined' | 'left';
        } else if (nextStatus) {
          if (prevWasDisconnected && !nextIsDisconnected) {
            toastAction = 'joined';
          } else if (!prevWasDisconnected && nextIsDisconnected) {
            toastAction = 'left';
          }
        }

        if (docId === currentDocId && toastAction) {
          const label =
            actor === 'assistant'
              ? 'Assistant'
              : actor === 'human'
                ? 'Human'
                : actor;
          pushToast(`${label} ${toastAction === 'joined' ? 'joined' : 'left'} the document`, 'info');
        }

        if (nextStatus) {
          const existingDocStatuses = presenceStatusRef.current[docId] ?? {};
          presenceStatusRef.current[docId] = {
            ...existingDocStatuses,
            [actor]: nextStatus,
          };
        }

        setDocPresenceByDocId((current) => {
          const existingDoc = current[docId] ?? {};
          return {
            ...current,
            [docId]: {
              ...existingDoc,
              [actor]: presence,
            },
          };
        });
        return;
      }

      if (docId !== currentDocId) {
        return;
      }

      if (normalizedEvent === 'document.comment' || normalizedEvent.startsWith('document:comment:')) {
        setPendingOverlayRefresh({ event: 'document.comment', docId, emittedAt });
        return;
      }

      if (normalizedEvent === 'document.suggestion' || normalizedEvent.startsWith('document:suggestion:')) {
        setPendingOverlayRefresh({ event: 'document.suggestion', docId, emittedAt });
        return;
      }

      if (normalizedEvent === 'document.review' || normalizedEvent === 'document:review:completed') {
        setPendingOverlayRefresh({ event: 'document.review', docId, emittedAt });
        return;
      }
    }, [currentDocId, pushToast]),
  });

  // Fetch agents through Entity so registry config is merged before UI display.
  useEffect(() => {
    let cancelled = false;
    setAgentsLoading(true);
    setAgentsError(null);
    setAgentsErrorDismissed(false);

    fetch('/api/agents')
      .then(r => r.json())
      .then(async data => {
        if (cancelled) return;
        const agentList = data.list || data.agents || [];
        const normalizedAgents = agentList
          .map((entry: any) => normalizeAgentFromApi(entry, userProfile.displayName))
          .filter((agent: Agent | null): agent is Agent => Boolean(agent));
        setAgents(normalizedAgents);
        setAgentsLoading(false);
        try {
          const modelLabels = await loadAgentDefaultModelLabels(normalizedAgents);
          if (!cancelled && Object.keys(modelLabels).length > 0) {
            setAgents((currentAgents) => currentAgents.map((agent) => ({
              ...agent,
              model: modelLabels[modelRegistryAgentKey(agent)] || agent.model,
            })));
          }
        } catch {
          // Model labels are additive; registry agents still render if model lookup is unavailable.
        }
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Unable to reach OpenClaw';
        setAgentsError(message);
        setAgentsErrorDismissed(false);
        setAgents(FALLBACK_AGENTS);
        setAgentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userProfile.displayName])
  // Poll agent status (online/offline) every 30s
  useEffect(() => {
    let cancelled = false;
    const pollStatus = async () => {
      try {
        const res = await fetch('/api/agents/status');
        const data = await res.json();
        if (!cancelled && data.agents) {
          setAgents(prev => prev.map(agent => {
            const status = data.agents.find((s: any) => s.id === agent.id);
            return status ? { ...agent, status: normalizeAgentStatus(status.status), rawStatus: status.status || agent.rawStatus } : agent;
          }));
        }
      } catch { /* ignore */ }
    };
    pollStatus();
    const interval = setInterval(pollStatus, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Poll agent focus (currently editing) every 15s
  useEffect(() => {
    let cancelled = false;
    const pollFocus = async () => {
      try {
        const res = await fetch('/api/agents/focus');
        const data = await res.json();
        if (!cancelled && data.agents) {
          setAgents(prev => prev.map(agent => {
            const focus = data.agents.find((f: any) => f.id === agent.id);
            return focus && focus.file
              ? { ...agent, lastActivity: { action: 'editing', timestamp: focus.lastModified || new Date().toISOString() }, focusFile: focus.file }
              : { ...agent, focusFile: undefined };
          }));
        }
      } catch { /* ignore */ }
    };
    pollFocus();
    const interval = setInterval(pollFocus, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);
;

  // Keep followed agent valid as agent list changes.
  useEffect(() => {
    if (agents.length === 0) {
      setFollowingAgent(null);
      return;
    }

    setFollowingAgent((current) => {
      if (current && agents.some((agent) => agent.id === current)) {
        return current;
      }
      const onlineAgent = agents.find((agent) => agent.status === 'online');
      return (onlineAgent ?? agents[0]).id;
    });
  }, [agents]);

  useEffect(() => {
    if (!watchMode) {
      setFollowDetached(false);
      return;
    }

    // Re-attach follow when watch mode or target agent changes.
    setFollowDetached(false);
  }, [followingAgent, watchMode]);

  useEffect(() => {
    if (isMobile) {
      setTabletSidebarOpen(false);
    }
  }, [isMobile]);

  // Fetch file content
  useEffect(() => {
    if (!currentFile) return;
    let cancelled = false;

    if (runtime.fsMultiSourceEnabled && currentSourceId) {
      fetchSourceFile(currentSourceId, currentFile)
        .then((data) => {
          if (cancelled) {
            return;
          }
          const binaryFlag = deriveBinaryFlag(data.contentType, data.isBinary);
          setFileContent(data.content || '');
          setCurrentFileReadOnly(Boolean(data.readOnly) || binaryFlag);
          setCurrentFileUpdatedAt(data.updatedAt ?? null);
          setCurrentFilePreviewMeta({
            contentType: data.contentType || 'text/plain',
            size: typeof data.size === 'number' ? data.size : null,
            isBinary: binaryFlag,
          });
          const cacheAgeMs =
            typeof data.cacheAgeMs === 'number'
              ? data.cacheAgeMs
              : typeof data.cachedAt === 'string'
                ? Math.max(0, Date.now() - new Date(data.cachedAt).getTime())
                : null;
          setCurrentFileCacheMeta({
            cached: data.cached === true,
            cachedAt: typeof data.cachedAt === 'string' ? data.cachedAt : null,
            cacheAgeMs: data.cached === true ? cacheAgeMs : null,
          });
          lastContentRef.current = data.content || '';
          setLastSaved(Date.now());
        })
        .catch((err) => {
          if (cancelled) {
            return;
          }
          console.error(err);
          setCurrentFileReadOnly(true);
          setCurrentFilePreviewMeta(defaultFilePreviewMeta());
          setCurrentFileCacheMeta(defaultFileCacheMeta());
        });
      return () => {
        cancelled = true;
      };
    }

    const encodedPath = encodeURIComponent(currentFile);
    requestJsonWithFallback<{ content?: string; contentType?: string; size?: number; isBinary?: boolean }>({
      urls: buildLocalApiFallbackUrls(`/file?path=${encodedPath}`),
      fallbackError: 'Failed to fetch file.',
    })
      .then(d => {
        if (cancelled) {
          return;
        }
        const binaryFlag = deriveBinaryFlag(d.contentType, d.isBinary);
        setFileContent(d.content || '');
        setCurrentFileReadOnly(binaryFlag);
        setCurrentFileUpdatedAt(null);
        setCurrentFilePreviewMeta({
          contentType: d.contentType || 'text/plain',
          size: typeof d.size === 'number' ? d.size : null,
          isBinary: binaryFlag,
        });
        setCurrentFileCacheMeta(defaultFileCacheMeta());
        lastContentRef.current = d.content || '';
        setLastSaved(Date.now());
      })
      .catch((err) => {
        if (!cancelled) {
          console.error(err);
          setCurrentFilePreviewMeta(defaultFilePreviewMeta());
          setCurrentFileCacheMeta(defaultFileCacheMeta());
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentFile, currentSourceId, fetchSourceFile]);

  // Fetch right pane file content (split view)
  useEffect(() => {
    if (!rightPaneFile) {
      setRightPaneContent('');
      setRightPaneReadOnly(false);
      setRightPaneUpdatedAt(null);
      setRightPanePreviewMeta(defaultFilePreviewMeta());
      setRightPaneCacheMeta(defaultFileCacheMeta());
      rightLastContentRef.current = '';
      return;
    }

    if (rightSaveTimeoutRef.current) {
      clearTimeout(rightSaveTimeoutRef.current);
      rightSaveTimeoutRef.current = undefined;
    }

    let cancelled = false;
    if (runtime.fsMultiSourceEnabled && rightPaneSourceId) {
      fetchSourceFile(rightPaneSourceId, rightPaneFile)
        .then((data) => {
          if (cancelled) {
            return;
          }
          const binaryFlag = deriveBinaryFlag(data.contentType, data.isBinary);
          const nextContent = data.content || '';
          setRightPaneContent(nextContent);
          setRightPaneReadOnly(Boolean(data.readOnly) || binaryFlag);
          setRightPaneUpdatedAt(data.updatedAt ?? null);
          setRightPanePreviewMeta({
            contentType: data.contentType || 'text/plain',
            size: typeof data.size === 'number' ? data.size : null,
            isBinary: binaryFlag,
          });
          const cacheAgeMs =
            typeof data.cacheAgeMs === 'number'
              ? data.cacheAgeMs
              : typeof data.cachedAt === 'string'
                ? Math.max(0, Date.now() - new Date(data.cachedAt).getTime())
                : null;
          setRightPaneCacheMeta({
            cached: data.cached === true,
            cachedAt: typeof data.cachedAt === 'string' ? data.cachedAt : null,
            cacheAgeMs: data.cached === true ? cacheAgeMs : null,
          });
          rightLastContentRef.current = nextContent;
        })
        .catch((err) => {
          if (cancelled) {
            return;
          }
          console.error(err);
          setRightPaneReadOnly(true);
          setRightPanePreviewMeta(defaultFilePreviewMeta());
          setRightPaneCacheMeta(defaultFileCacheMeta());
        });
      return () => {
        cancelled = true;
      };
    }

    const encodedPath = encodeURIComponent(rightPaneFile);
    requestJsonWithFallback<{ content?: string; contentType?: string; size?: number; isBinary?: boolean }>({
      urls: buildLocalApiFallbackUrls(`/file?path=${encodedPath}`),
      fallbackError: 'Failed to fetch file.',
    })
      .then((d) => {
        if (cancelled) {
          return;
        }
        const binaryFlag = deriveBinaryFlag(d.contentType, d.isBinary);
        const nextContent = d.content || '';
        setRightPaneContent(nextContent);
        setRightPaneReadOnly(binaryFlag);
        setRightPaneUpdatedAt(null);
        setRightPanePreviewMeta({
          contentType: d.contentType || 'text/plain',
          size: typeof d.size === 'number' ? d.size : null,
          isBinary: binaryFlag,
        });
        setRightPaneCacheMeta(defaultFileCacheMeta());
        rightLastContentRef.current = nextContent;
      })
      .catch((err) => {
        if (!cancelled) {
          console.error(err);
          setRightPanePreviewMeta(defaultFilePreviewMeta());
          setRightPaneCacheMeta(defaultFileCacheMeta());
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fetchSourceFile, rightPaneFile, rightPaneSourceId]);

  // Auto-save with debounce
  const scheduleAutoSave = useCallback((content: string) => {
    if (currentSourceId) {
      return;
    }

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      if (content !== lastContentRef.current && currentFile) {
        const encodedPath = encodeURIComponent(currentFile);
        await requestWithFallback(
          buildLocalApiFallbackUrls(`/file?path=${encodedPath}`),
          {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
          },
          'Failed to save file.'
        );
        lastContentRef.current = content;
        setLastSaved(Date.now());
      }
    }, 2000);
  }, [currentFile, currentSourceId]);

  const scheduleRightPaneAutoSave = useCallback((content: string) => {
    if (rightPaneSourceId) {
      return;
    }

    if (rightSaveTimeoutRef.current) clearTimeout(rightSaveTimeoutRef.current);
    rightSaveTimeoutRef.current = setTimeout(async () => {
      if (content !== rightLastContentRef.current && rightPaneFile) {
        const encodedPath = encodeURIComponent(rightPaneFile);
        await requestWithFallback(
          buildLocalApiFallbackUrls(`/file?path=${encodedPath}`),
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
          },
          'Failed to save file.'
        );
        rightLastContentRef.current = content;
      }
    }, 2000);
  }, [rightPaneFile, rightPaneSourceId]);

  // Handle content changes
  const handleContentChange = useCallback((newContent: string) => {
    setFileContent(newContent);
    scheduleAutoSave(newContent);
  }, [scheduleAutoSave]);

  const handleRightPaneContentChange = useCallback((newContent: string) => {
    setRightPaneContent(newContent);
    scheduleRightPaneAutoSave(newContent);
  }, [scheduleRightPaneAutoSave]);

  const handleManualAttribution = useCallback(
    (selection: EditorSelectionRange) => {
      if (!currentFile) {
        return;
      }

      const maxOffset = Math.max(0, fileContent.length);
      const from = Math.max(0, Math.min(maxOffset, Math.floor(selection.from)));
      const to = Math.max(from, Math.min(maxOffset, Math.floor(selection.to)));
      if (to <= from) {
        return;
      }

      setAuthorshipRanges((previous) => {
        const existing = previous.find(
          (range) => range.start_offset === from && range.end_offset === to
        );
        const existingAuthor = existing ? normalizeAuthorshipActor(existing.author) : null;
        if (existing && existingAuthor === manualAuthorshipAuthor) {
          return previous.filter((range) => range.id !== existing.id);
        }

        const now = new Date().toISOString();
        const nextRange: DocumentAuthorshipRangeRecord = {
          id: existing?.id ?? `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          doc_id: buildDocumentId(currentSourceId, currentFile),
          start_offset: from,
          end_offset: to,
          author: manualAuthorshipAuthor,
          reviewed: manualAuthorshipAuthor === 'human' ? true : existing?.reviewed ?? false,
          created_at: existing?.created_at ?? now,
          updated_at: now,
        };

        const withoutCurrent = existing ? previous.filter((range) => range.id !== existing.id) : previous;
        return [...withoutCurrent, nextRange].sort((left, right) => {
          if (left.start_offset !== right.start_offset) {
            return left.start_offset - right.start_offset;
          }
          return left.end_offset - right.end_offset;
        });
      });
    },
    [currentFile, currentSourceId, fileContent.length, manualAuthorshipAuthor]
  );

  // Handle @mention - send to OpenClaw
  const handleSave = useCallback(async () => {
    if (!currentFile) return;

    // Save source files via the source write API
    if (currentSourceId) {
      try {
        await writeSourceFile(currentSourceId, currentFile, fileContent);
        lastContentRef.current = fileContent;
        setLastSaved(Date.now());
      } catch (e) {
        console.error('[Save] Source file save failed:', e);
      }
      return;
    }

    // Check for @mentions
    const mentionRegex = /@(\w+)/g;
    const matches = fileContent.match(mentionRegex);
    if (matches && matches.length > 0) {
      const mentionedAgents = [...new Set(matches.map(m => m.slice(1)))];
      for (const agent of mentionedAgents) {
        try {
          await fetch(`${runtime.apiBase}/api/mention`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agent,
              document: currentFile,
              instruction: `User mentioned you in ${currentFile.split('/').pop()}. Please help with the content.`,
              context: fileContent.slice(0, 1000),
              author: userProfile.displayName,
            }),
          });
          console.log(`[Mention] Notified ${agent}`);
        } catch (e) {
          console.error(`[Mention] Failed to notify ${agent}:`, e);
        }
      }
    }

    // Save file
    const encodedPath = encodeURIComponent(currentFile);
    await requestWithFallback(
      buildLocalApiFallbackUrls(`/file?path=${encodedPath}`),
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: fileContent }),
      },
      'Failed to save file.'
    );
    lastContentRef.current = fileContent;
    setLastSaved(Date.now());
  }, [currentFile, currentSourceId, fileContent, writeSourceFile]);

  const handleFileSelect = (path: string) => {
    setSidebarTab('files');
    setMobileTab('files');
    setTabletSidebarOpen(false);
    setCurrentSourceId(null);
    setCurrentFile(path);
    setCurrentFileReadOnly(false);
    setCurrentFileUpdatedAt(null);
    setCurrentFilePreviewMeta(defaultFilePreviewMeta());
    setCurrentFileCacheMeta(defaultFileCacheMeta());
    setEditMode(watchMode ? true : false);
    setEditorCollabMode('editing');
    setReloadPrompt(null);
    setHighlightTaskId(null);
    setOpenFileTabs((prev) => upsertOpenFileTab(prev, buildOpenFileTab(null, path)));
  };

  const handleSourceFileSelect = (sourceId: string, path: string) => {
    setSidebarTab('files');
    setMobileTab('files');
    setTabletSidebarOpen(false);
    setCurrentSourceId(sourceId);
    setCurrentFile(path);
    setCurrentFilePreviewMeta(defaultFilePreviewMeta());
    setCurrentFileCacheMeta(defaultFileCacheMeta());
    setEditMode(watchMode ? true : false);
    setEditorCollabMode('editing');
    setReloadPrompt(null);
    setHighlightTaskId(null);
    setOpenFileTabs((prev) => upsertOpenFileTab(prev, buildOpenFileTab(sourceId, path)));
  };

  const handleRightPaneFileSelect = useCallback((path: string) => {
    setSidebarTab('files');
    setMobileTab('files');
    setTabletSidebarOpen(false);
    setRightPaneSourceId(null);
    setRightPaneFile(path);
    setRightPaneReadOnly(false);
    setRightPaneUpdatedAt(null);
    setRightPanePreviewMeta(defaultFilePreviewMeta());
    setRightPaneCacheMeta(defaultFileCacheMeta());
    setRightPaneContent('');
    rightLastContentRef.current = '';
  }, []);

  const handleRightPaneSourceFileSelect = useCallback((sourceId: string, path: string) => {
    setSidebarTab('files');
    setMobileTab('files');
    setTabletSidebarOpen(false);
    setRightPaneSourceId(sourceId);
    setRightPaneFile(path);
    setRightPaneReadOnly(false);
    setRightPaneUpdatedAt(null);
    setRightPanePreviewMeta(defaultFilePreviewMeta());
    setRightPaneCacheMeta(defaultFileCacheMeta());
    setRightPaneContent('');
    rightLastContentRef.current = '';
  }, []);

  const exitSplitMode = useCallback(() => {
    setSplitResizing(false);
    setSplitMode(false);
    setSplitRatio(0.5);
    setRightPaneSourceId(null);
    setRightPaneFile(null);
    setRightPaneReadOnly(false);
    setRightPaneUpdatedAt(null);
    setRightPanePreviewMeta(defaultFilePreviewMeta());
    setRightPaneCacheMeta(defaultFileCacheMeta());
    setRightPaneContent('');
    rightLastContentRef.current = '';

    if (rightSaveTimeoutRef.current) {
      clearTimeout(rightSaveTimeoutRef.current);
      rightSaveTimeoutRef.current = undefined;
    }

    if (splitResizeRafRef.current !== null) {
      cancelAnimationFrame(splitResizeRafRef.current);
      splitResizeRafRef.current = null;
    }
  }, []);

  const handleWatchModeAutoOpenFile = useCallback((path: string) => {
    setCurrentSourceId(null);
    setCurrentFile(path);
    setCurrentFileReadOnly(false);
    setCurrentFileUpdatedAt(null);
    setCurrentFilePreviewMeta(defaultFilePreviewMeta());
    setCurrentFileCacheMeta(defaultFileCacheMeta());
    setEditMode(true);
    setEditorCollabMode('editing');
    setReloadPrompt(null);
    setHighlightTaskId(null);
  }, []);

  const handleBackToDashboard = () => {
    exitSplitMode();
    setCurrentSourceId(null);
    setCurrentFile(null);
    setCurrentFileReadOnly(false);
    setCurrentFileUpdatedAt(null);
    setCurrentFilePreviewMeta(defaultFilePreviewMeta());
    setCurrentFileCacheMeta(defaultFileCacheMeta());
    setEditMode(false);
    setEditorCollabMode('editing');
    setReloadPrompt(null);
    setHighlightTaskId(null);
  };

  const activeFileTabKey = useMemo(() => {
    if (!currentFile) {
      return null;
    }
    return buildOpenFileTabKey(currentSourceId, currentFile);
  }, [currentFile, currentSourceId]);

  const handleSelectOpenFileTab = useCallback((tab: OpenFileTab) => {
    if (tab.sourceId) {
      setSidebarTab('files');
      setMobileTab('files');
      setTabletSidebarOpen(false);
      setCurrentSourceId(tab.sourceId);
      setCurrentFile(tab.path);
      setCurrentFilePreviewMeta(defaultFilePreviewMeta());
      setCurrentFileCacheMeta(defaultFileCacheMeta());
      setEditMode(watchMode ? true : false);
      setEditorCollabMode('editing');
      setReloadPrompt(null);
      setHighlightTaskId(null);
      return;
    }

    setSidebarTab('files');
    setMobileTab('files');
    setTabletSidebarOpen(false);
    setCurrentSourceId(null);
    setCurrentFile(tab.path);
    setCurrentFileReadOnly(false);
    setCurrentFileUpdatedAt(null);
    setCurrentFilePreviewMeta(defaultFilePreviewMeta());
    setCurrentFileCacheMeta(defaultFileCacheMeta());
    setEditMode(watchMode ? true : false);
    setEditorCollabMode('editing');
    setReloadPrompt(null);
    setHighlightTaskId(null);
  }, [watchMode]);

  const handleCloseOpenFileTab = useCallback((tabKey: string) => {
    setOpenFileTabs((prev) => {
      const next = removeOpenFileTab(prev, tabKey);
      const activeKey = buildOpenFileTabKey(currentSourceId, currentFile ?? '');
      if (activeKey !== tabKey) {
        return next;
      }

      const fallback = next[next.length - 1];
      if (fallback) {
        queueMicrotask(() => handleSelectOpenFileTab(fallback));
      } else {
        queueMicrotask(() => handleBackToDashboard());
      }
      return next;
    });
  }, [currentFile, currentSourceId, handleSelectOpenFileTab]);

  const handleAddOpenFileTab = useCallback(() => {
    setQuickSwitcherTargetPane('left');
    setQuickSwitcherOpen(true);
  }, []);

  const handleFocusCommentsRail = useCallback(() => {
    setRightSidebarCollapsed(false);
    setDocIntelligenceFocus('comments');
  }, []);

  const handleTaskSelect = (taskId: number) => {
    if (typeof window !== 'undefined') {
      const nextUrl = new URL(window.location.href);
      nextUrl.pathname = '/task/' + taskId;
      nextUrl.searchParams.delete('file');
      nextUrl.searchParams.delete('source');
      if (nextUrl.toString() !== window.location.href) {
        window.history.pushState({ mode: 'task', taskId }, '', nextUrl.toString());
      }
    }

    setCurrentSourceId(null);
    setCurrentFile(null);
    setMcBoardTab('kanban');
    setSidebarTab('tasks');
    setMobileTab('tasks');
    setTabletSidebarOpen(false);
    setHighlightTaskId(taskId);
  };

  const handleCloseTaskDetail = () => {
    setHighlightTaskId(null);
  };

  const handleSidebarTabChange = (tab: WorkspaceTab) => {
    setSidebarTab(tab);
    setMobileTab(tab);
    setTabletSidebarOpen(false);
  };

  const handleReload = () => {
    if (reloadPrompt) {
      setFileContent(reloadPrompt.content);
      lastContentRef.current = reloadPrompt.content;
      setReloadPrompt(null);
    }
  };

  const toggleWatchMode = useCallback(() => {
    setWatchMode((prev) => {
      const next = !prev;
      if (next && !followingAgent && agents.length > 0) {
        const onlineAgent = agents.find((agent) => agent.status === 'online');
        setFollowingAgent((onlineAgent ?? agents[0]).id);
      }
      return next;
    });
  }, [agents, followingAgent]);

  const openMissionControlModal = useCallback(() => {
    setCreateTaskModalOpen(true);
  }, []);

  const applyArchiveVisibility = useCallback((visible: boolean) => {
    const runtimeFn = (window as unknown as Record<string, unknown>).setArchiveVisibility;
    if (typeof runtimeFn === 'function') {
      (runtimeFn as (value: boolean) => void)(visible);
    }
  }, []);

  useEffect(() => {
    if (sidebarTab !== 'tasks' && sidebarTab !== 'agents') {
      return;
    }

    if (sidebarTab === 'tasks' && !isBuiltInMCBoardTab(mcBoardTab)) {
      return;
    }

    const timer = window.setTimeout(() => {
      const runtimeApi = window as unknown as Record<string, unknown>;
      const boardToRender: MCRuntimeBoard = sidebarTab === 'agents'
        ? 'agents'
        : mcBoardTab === 'strategic'
          ? 'strategic'
          : 'ops';

      const setBoard = runtimeApi.setBoard;
      if (typeof setBoard === 'function') {
        (setBoard as (board: MCRuntimeBoard, updateHash?: boolean) => void)(boardToRender, false);
      }

      const setAssignee = runtimeApi.filterByUser;
      if (sidebarTab === 'tasks' && typeof setAssignee === 'function') {
        (setAssignee as (assignee: MCAssigneeFilter) => void)(mcAssigneeFilter);
      }

      const setPriority = runtimeApi.setPriorityFilter;
      if (sidebarTab === 'tasks' && typeof setPriority === 'function') {
        (setPriority as (priority: string) => void)(mcPriorityFilter);
      }

      const setArchiveVisibility = runtimeApi.setArchiveVisibility;
      if (typeof setArchiveVisibility === 'function') {
        (setArchiveVisibility as (value: boolean) => void)(showArchiveColumn);
      }
    }, 50);

    return () => window.clearTimeout(timer);
  }, [mcAssigneeFilter, mcBoardTab, mcPriorityFilter, showArchiveColumn, sidebarTab]);

  const handleLoginSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const username = loginUsername.trim() || userProfile.displayName;
      const password = loginPassword.trim();

      if (password !== DEFAULT_LOGIN_PASSWORD) {
        setLoginError('Invalid credentials');
        return;
      }

      setAuthSession({
        username,
        loggedInAt: new Date().toISOString(),
      });
      setLoginUsername(username);
      setLoginPassword('');
      setLoginError('');
    },
    [loginPassword, loginUsername, userProfile.displayName]
  );

  const handleUserProfileSave = useCallback(() => {
    const next = saveUserProfile({
      displayName: profileNameDraft,
      handle: profileHandleDraft,
      avatarUrl: profileAvatarDraft,
      email: profileEmailDraft,
    });
    setLoginUsername((current) => current.trim() || next.displayName);
    if (authSession) {
      setAuthSession({
        ...authSession,
        username: next.displayName,
      });
    }
    pushToast('User profile saved.', 'success');
  }, [authSession, profileAvatarDraft, profileEmailDraft, profileHandleDraft, profileNameDraft, pushToast, saveUserProfile]);

  const handleLogout = useCallback(() => {
    setAuthSession(null);
    setLoginPassword('');
    setLoginError('');
  }, []);

  const toggleLoginRequirement = useCallback((enabled: boolean) => {
    setLoginRequired(enabled);
    setLoginError('');
    setLoginPassword('');
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && watchMode && !followDetached) {
        e.preventDefault();
        setFollowDetached(true);
        return;
      }

      const target = e.target instanceof HTMLElement
        ? e.target
        : document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      if (target?.closest('input, textarea, select') || target?.isContentEditable) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && (e.key === 'p' || e.key === 'k')) {
        e.preventDefault();
        setQuickSwitcherTargetPane('left');
        setQuickSwitcherOpen(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault();
        if (currentFile) setEditMode(m => !m);
      } else if ((e.metaKey || e.ctrlKey) && e.key === 's' && editMode && !watchMode) {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentFile, editMode, followDetached, handleSave, watchMode]);

  const updateSplitRatioFromClientX = useCallback((clientX: number) => {
    const container = splitContainerRef.current;
    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || rect.width <= 0) {
      return;
    }

    const nextRaw = (clientX - rect.left) / rect.width;
    const next = Math.min(0.8, Math.max(0.2, nextRaw));
    setSplitRatio(next);
  }, []);

  useEffect(() => {
    if (!splitResizing) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handlePointerMove = (event: PointerEvent) => {
      if (splitResizeRafRef.current !== null) {
        window.cancelAnimationFrame(splitResizeRafRef.current);
      }

      splitResizeRafRef.current = window.requestAnimationFrame(() => {
        updateSplitRatioFromClientX(event.clientX);
        splitResizeRafRef.current = null;
      });
    };

    const stopResizing = () => {
      setSplitResizing(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResizing);
    window.addEventListener('pointercancel', stopResizing);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResizing);
      window.removeEventListener('pointercancel', stopResizing);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      if (splitResizeRafRef.current !== null) {
        window.cancelAnimationFrame(splitResizeRafRef.current);
        splitResizeRafRef.current = null;
      }
    };
  }, [splitResizing, updateSplitRatioFromClientX]);

  const savedAgo = lastSaved ? Math.floor((Date.now() - lastSaved) / 1000) : 0;
  const savedAgoLabel = savedAgo > 0 ? formatElapsedTime(savedAgo) : null;
  const normalizedTaskSearchQuery = taskSearchQuery.trim().toLowerCase();
  const taskSearchResults = useMemo(() => {
    if (!normalizedTaskSearchQuery) {
      return [];
    }

    return tasks
      .filter((task) => {
        const haystack = `${task.id} ${task.name} ${task.description ?? ''} ${task.assignee} ${formatTaskProjectSummary(task)}`.toLowerCase();
        return haystack.includes(normalizedTaskSearchQuery);
      })
      .slice(0, 8);
  }, [tasks, normalizedTaskSearchQuery]);
  const filteredBoardTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (mcAssigneeFilter !== 'all' && task.assignee !== mcAssigneeFilter) {
        return false;
      }

      if (mcPriorityFilter !== 'all' && task.priority !== mcPriorityFilter) {
        return false;
      }

      if (mcProjectFilter !== 'all' && !hasTaskProjectName(task, mcProjectFilter)) {
        return false;
      }

      return true;
    });
  }, [tasks, mcAssigneeFilter, mcPriorityFilter, mcProjectFilter]);
  const selectedAgentData = selectedAgent ? agents.find((agent) => agent.id === selectedAgent) : null;
  const selectedSource = currentSourceId ? fileSources.find((source) => source.id === currentSourceId) : null;
  const rightPaneSource = rightPaneSourceId ? fileSources.find((source) => source.id === rightPaneSourceId) : null;
  const currentRawFileUrl = useMemo(
    () => buildRawFilePreviewUrl(currentFile, currentSourceId, runtime.apiBase),
    [currentFile, currentSourceId]
  );
  const rightPaneRawFileUrl = useMemo(
    () => buildRawFilePreviewUrl(rightPaneFile, rightPaneSourceId, runtime.apiBase),
    [rightPaneFile, rightPaneSourceId]
  );
  const documentsClient = useMemo(
    () =>
      createLazyDocumentsApiClient({
        apiBase: runtime.apiBase,
        auth: toDocumentsClientAuth(documentsAuth),
      }),
    [documentsAuth]
  );
  const remotePresence = useMemo(() => {
    if (!currentDocId) {
      return [];
    }
    const map = docPresenceByDocId[currentDocId] ?? {};
    return Object.values(map).filter((entry) => entry && typeof entry === 'object') as DocumentPresenceRecord[];
  }, [docPresenceByDocId, currentDocId]);
  const followedAgentData = followingAgent ? agents.find((agent) => agent.id === followingAgent) : null;
  const followedActorId = useMemo(() => {
    if (followedAgentData?.name) {
      return followedAgentData.name.trim().toLowerCase();
    }
    if (!followingAgent) {
      return null;
    }
    return followingAgent.trim().toLowerCase();
  }, [followedAgentData?.name, followingAgent]);
  const { followEvent: watchModeFollowEvent } = useWatchModeAutoFollow({
    enabled: watchMode && !followDetached,
    followedActorId,
    activities,
    currentFile,
    onSwitchFile: handleWatchModeAutoOpenFile,
  });
  const watchModeCursor = useMemo(() => {
    if (!watchMode || followDetached) {
      return null;
    }
    if (!watchModeFollowEvent || watchModeFollowEvent.filePath !== currentFile) {
      return null;
    }
    return watchModeFollowEvent.cursor ?? null;
  }, [currentFile, followDetached, watchMode, watchModeFollowEvent]);
  const watchModeGhostPresence = useMemo<DocumentPresenceRecord | null>(() => {
    if (!watchMode || followDetached) {
      return null;
    }
    if (!watchModeFollowEvent || watchModeFollowEvent.filePath !== currentFile) {
      return null;
    }

    const nowIso = new Date().toISOString();
    const cursorJson = (watchModeFollowEvent.cursor ?? { line: 0, ch: 0, action: 'cursor' }) as any;

    return {
      id: `watch-ghost-${followedActorId ?? watchModeFollowEvent.agentName.toLowerCase()}-${currentDocId ?? 'doc'}`,
      doc_id: currentDocId ?? 'watch',
      agent_id: followedActorId ?? watchModeFollowEvent.agentName.toLowerCase(),
      status: 'active',
      cursor_json: cursorJson,
      last_activity_at: watchModeFollowEvent.timestamp ?? nowIso,
      created_at: nowIso,
      updated_at: nowIso,
    };
  }, [currentDocId, currentFile, followDetached, followedActorId, watchMode, watchModeFollowEvent]);
  const editorPresence = useMemo(() => {
    if (!watchModeGhostPresence) {
      return remotePresence;
    }

    const filtered = remotePresence.filter((entry) => entry.agent_id !== watchModeGhostPresence.agent_id);
    return [watchModeGhostPresence, ...filtered];
  }, [remotePresence, watchModeGhostPresence]);
  const followEnabled = Boolean(currentDocId) && Boolean(followedActorId) && watchMode && editMode && !followDetached;
  const followGlowClassName = useMemo(() => {
    if (!followEnabled) {
      return '';
    }

    switch (followedActorId) {
      case 'ada':
        return 'following-ada';
      case 'spock':
        return 'following-spock';
      case 'scotty':
        return 'following-scotty';
      default:
        return 'following-generic';
    }
  }, [followEnabled, followedActorId]);
  const [followTypingPulseActive, setFollowTypingPulseActive] = useState(false);
  const followedPresence = useMemo(() => {
    if (!currentDocId || !followedActorId) {
      return null;
    }

    return docPresenceByDocId[currentDocId]?.[followedActorId] ?? null;
  }, [currentDocId, docPresenceByDocId, followedActorId]);
  useEffect(() => {
    if (!followEnabled) {
      setFollowTypingPulseActive(false);
      return;
    }

    if (!followedPresence || typeof followedPresence !== 'object') {
      setFollowTypingPulseActive(false);
      return;
    }

    const presenceRecord = followedPresence as Record<string, unknown>;
    const status = typeof presenceRecord.status === 'string' ? presenceRecord.status.trim().toLowerCase() : '';
    const lastActivityAt =
      typeof presenceRecord.last_activity_at === 'string' ? presenceRecord.last_activity_at : null;
    const cursorJson = presenceRecord.cursor_json;

    let action: string | null = null;
    if (cursorJson && typeof cursorJson === 'object' && !Array.isArray(cursorJson)) {
      const actionCandidate = (cursorJson as Record<string, unknown>).action;
      if (typeof actionCandidate === 'string') {
        action = actionCandidate.trim().toLowerCase();
      }
    }

    let lastActivityMs: number | null = null;
    if (typeof lastActivityAt === 'string') {
      const parsed = Date.parse(lastActivityAt);
      lastActivityMs = Number.isFinite(parsed) ? parsed : null;
    }

    const now = Date.now();
    const typingWindowMs = 2500;
    const isRecent = typeof lastActivityMs === 'number' ? now - lastActivityMs <= typingWindowMs : false;
    const shouldPulse = isRecent && (action === 'typing' || (!action && status === 'active'));
    setFollowTypingPulseActive(shouldPulse);

    if (!shouldPulse || typeof lastActivityMs !== 'number') {
      return;
    }

    const expiresInMs = Math.max(0, typingWindowMs - (now - lastActivityMs)) + 30;
    const timeoutId = window.setTimeout(() => setFollowTypingPulseActive(false), expiresInMs);
    return () => window.clearTimeout(timeoutId);
  }, [followEnabled, followedPresence]);
  const followCursor = useMemo(() => {
    if (!currentDocId || !followedActorId) {
      return watchModeCursor ?? null;
    }
    const presence = docPresenceByDocId[currentDocId]?.[followedActorId] as any;
    return presence?.cursor_json ?? watchModeCursor ?? null;
  }, [currentDocId, docPresenceByDocId, followedActorId, watchModeCursor]);
  const { cursor: debouncedFollowCursor } = useFollowMode({
    enabled: followEnabled,
    cursor: followCursor,
    debounceMs: 100,
  });
  const canEditCurrentFile = Boolean(currentFile) && !currentFileReadOnly;
  const authorshipStats = useMemo(
    () => buildAuthorshipStats(fileContent.length, authorshipRanges),
    [authorshipRanges, fileContent.length]
  );
  const editorAuthorshipRanges = useMemo<EditorAuthorshipRange[]>(
    () =>
      authorshipRanges.map((range) => ({
        startOffset: range.start_offset,
        endOffset: range.end_offset,
        author: normalizeAuthorshipActor(range.author),
        reviewed: range.reviewed,
      })),
    [authorshipRanges]
  );
  const manualAttributionEnabled = runtime.agentNativeEditorEnabled;
  const documentsReady = Boolean(runtime.agentNativeEditorEnabled && currentDocId && currentSourceId && documentsAuth);
  const rightSidebarHasComments = documentsReady || commentThreads.length > 0;
  const rightSidebarHasSuggestions = suggestions.length > 0;
  const rightSidebarHasReview = reviewFindings.length > 0 || Boolean(reviewRun);
  const rightSidebarHasPanels = rightSidebarHasComments || rightSidebarHasSuggestions || rightSidebarHasReview;
  const rightSidebarIsCollapsed = rightSidebarCollapsed || !rightSidebarHasPanels;
  const activeTasks = tasks.filter((task) => task.column === 'doing');
  const onlineAgents = agents.filter((agent) => agent.status === 'online').length;
  const workspaceTab = isMobile ? mobileTab : sidebarTab;
  const enterpriseFrameSrc = ENTERPRISE_ADMIN_URL;

  useEffect(() => {
    if (currentDocId && rightSidebarHasPanels) {
      setRightSidebarCollapsed(false);
    }
  }, [currentDocId, rightSidebarHasPanels]);

  useEffect(() => {
    documentsReadyRef.current = documentsReady;
  }, [documentsReady]);

  useEffect(() => {
    if (!documentsReady && editorCollabMode === 'suggesting') {
      setEditorCollabMode('editing');
    }
  }, [documentsReady, editorCollabMode]);

  const handleToggleSuggestingMode = useCallback(() => {
    if (!documentsReady) {
      pushToast('Connect a Documents token to use suggesting mode.', 'warning');
      return;
    }

    setEditorCollabMode((prev) => (prev === 'suggesting' ? 'editing' : 'suggesting'));
  }, [documentsReady, pushToast]);

  const handleExitSuggestingMode = useCallback(() => {
    setEditorCollabMode((prev) => (prev === 'suggesting' ? 'editing' : prev));
  }, []);

  const handleSuggestingEdit = useCallback(
    (request: EditorSuggestingEditRequest) => {
      if (!documentsReady || !currentDocId) {
        return;
      }

      void (async () => {
        try {
          const response = await documentsClient.postSuggestion(currentDocId, {
            from: request.from,
            to: request.to,
            originalText: request.originalText,
            suggestedText: request.suggestedText,
            type: request.type,
          });
          setSuggestions(response.suggestions);
        } catch (error) {
          pushToast(error instanceof Error ? error.message : 'Failed to create suggestion.', 'error');
        }
      })();
    },
    [currentDocId, documentsClient, documentsReady, pushToast]
  );

  useEffect(() => {
    if (cursorHeartbeatTimeoutRef.current !== null) {
      window.clearTimeout(cursorHeartbeatTimeoutRef.current);
      cursorHeartbeatTimeoutRef.current = null;
    }
    cursorHeartbeatPendingRef.current = null;
    cursorHeartbeatLastSentAtRef.current = 0;
  }, [currentDocId, documentsReady]);

  useEffect(() => {
    return () => {
      if (cursorHeartbeatTimeoutRef.current !== null) {
        window.clearTimeout(cursorHeartbeatTimeoutRef.current);
        cursorHeartbeatTimeoutRef.current = null;
      }
      cursorHeartbeatPendingRef.current = null;
      cursorHeartbeatLastSentAtRef.current = 0;
    };
  }, []);

  const handleEditorCursorActivity = useCallback(
    (activity: EditorCursorActivity) => {
      if (!documentsReady || !currentDocId) {
        return;
      }

      cursorHeartbeatPendingRef.current = {
        docId: currentDocId,
        payload: {
          cursor: { pos: Math.max(0, Math.floor(activity.pos)) },
          selection: {
            from: Math.max(0, Math.floor(activity.selection.from)),
            to: Math.max(0, Math.floor(activity.selection.to)),
          },
          action: activity.action,
          status: 'active',
        },
      };

      const scheduleFlush = (delayMs: number) => {
        if (cursorHeartbeatTimeoutRef.current !== null) {
          return;
        }

        cursorHeartbeatTimeoutRef.current = window.setTimeout(() => {
          cursorHeartbeatTimeoutRef.current = null;

          const pending = cursorHeartbeatPendingRef.current;
          cursorHeartbeatPendingRef.current = null;

          if (!pending || !documentsReadyRef.current || pending.docId !== currentDocIdRef.current) {
            return;
          }

          cursorHeartbeatLastSentAtRef.current = Date.now();

          void (async () => {
            try {
              const response = await documentsClient.postCursor(pending.docId, pending.payload);
              const actor = response.actor?.trim?.().toLowerCase?.() ?? '';
              if (!actor) {
                return;
              }

              const nextStatus = response.presence.status?.trim?.().toLowerCase?.() ?? '';
              if (nextStatus) {
                const existingDocStatuses = presenceStatusRef.current[pending.docId] ?? {};
                presenceStatusRef.current[pending.docId] = {
                  ...existingDocStatuses,
                  [actor]: nextStatus,
                };
              }

              setDocPresenceByDocId((current) => {
                const existingDoc = current[pending.docId] ?? {};
                return {
                  ...current,
                  [pending.docId]: {
                    ...existingDoc,
                    [actor]: response.presence,
                  },
                };
              });
            } catch {
              // Presence heartbeats are best-effort; avoid spamming toasts on transient failures.
            }
          })();
        }, delayMs);
      };

      const now = Date.now();
      const elapsedMs = now - cursorHeartbeatLastSentAtRef.current;
      if (elapsedMs >= 500) {
        scheduleFlush(0);
      } else {
        scheduleFlush(500 - elapsedMs);
      }
    },
    [currentDocId, documentsClient, documentsReady]
  );

  const resolveAgentIdForActor = useCallback(
    (actorId: string): string | null => {
      const normalized = actorId.trim().toLowerCase();
      if (!normalized || normalized === 'human') {
        return null;
      }

      const direct = agents.find((agent) => agent.id.trim().toLowerCase() === normalized);
      if (direct) {
        return direct.id;
      }

      const byName = agents.find((agent) => agent.name.trim().toLowerCase() === normalized);
      return byName ? byName.id : null;
    },
    [agents]
  );

  const applyPresenceSeed = useCallback(
    (docId: string, presence: readonly DocumentPresenceRecord[]) => {
      setDocPresenceByDocId((current) => {
        const existingDoc = current[docId] ?? {};
        const seeded: Record<string, any> = {};
        const statusSeed: Record<string, string> = {};
        for (const entry of presence) {
          const actor = entry.agent_id?.trim?.().toLowerCase?.() ?? '';
          if (!actor) continue;
          seeded[actor] = entry;
          const nextStatus = entry.status?.trim?.().toLowerCase?.() ?? '';
          if (nextStatus) {
            statusSeed[actor] = nextStatus;
          }
        }

        const existingStatuses = presenceStatusRef.current[docId] ?? {};
        presenceStatusRef.current[docId] = { ...statusSeed, ...existingStatuses };
        return {
          ...current,
          [docId]: {
            ...seeded,
            ...existingDoc,
          },
        };
      });
    },
    []
  );

  const refreshComments = useCallback(async () => {
    if (!documentsReady || !currentDocId) {
      return;
    }

    try {
      const response = await documentsClient.getComments(currentDocId);
      setCommentThreads(response.threads);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Failed to refresh comments.', 'error');
    }
  }, [currentDocId, documentsClient, documentsReady, pushToast]);

  const refreshSuggestions = useCallback(async () => {
    if (!documentsReady || !currentDocId) {
      return;
    }

    try {
      const response = await documentsClient.getSuggestions(currentDocId);
      setSuggestions(response.suggestions);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Failed to refresh suggestions.', 'error');
    }
  }, [currentDocId, documentsClient, documentsReady, pushToast]);

  const refreshReviewLatest = useCallback(async () => {
    if (!documentsReady || !currentDocId) {
      return;
    }

    try {
      const state = await documentsClient.getState(currentDocId);
      applyPresenceSeed(currentDocId, state.presence);

      const latest = state.reviewSummary.latestRun;
      setReviewRun(latest ?? null);
      if (!latest) {
        setReviewFindings([]);
        return;
      }

      const review = await documentsClient.getReview(currentDocId, latest.id);
      setReviewRun(review.run);
      setReviewFindings(review.findings);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Failed to refresh review.', 'error');
    }
  }, [applyPresenceSeed, currentDocId, documentsClient, documentsReady, pushToast]);

  useEffect(() => {
    if (!pendingOverlayRefresh) {
      return;
    }

    if (pendingOverlayRefresh.docId !== currentDocId) {
      return;
    }

    if (!documentsReady) {
      return;
    }

    if (pendingOverlayRefresh.event === 'document.comment') {
      void refreshComments();
      return;
    }

    if (pendingOverlayRefresh.event === 'document.suggestion') {
      void refreshSuggestions();
      return;
    }

    if (pendingOverlayRefresh.event === 'document.review') {
      void refreshReviewLatest();
    }
  }, [currentDocId, documentsReady, pendingOverlayRefresh, refreshComments, refreshReviewLatest, refreshSuggestions]);

  useEffect(() => {
    if (!documentsReady || !documentsAuthHydrated || !currentDocId) {
      setCommentThreads([]);
      setSuggestions([]);
      setReviewRun(null);
      setReviewFindings([]);
      setSelectedCommentId(null);
      setSelectedSuggestionId(null);
      setSelectedFindingId(null);
      return;
    }

    let cancelled = false;
    const requestAuth = documentsAuthRef.current;
    (async () => {
      try {
        const [state, comments, suggestionsResponse] = await Promise.all([
          documentsClient.getState(currentDocId),
          documentsClient.getComments(currentDocId),
          documentsClient.getSuggestions(currentDocId),
        ]);
        if (cancelled) return;

        applyPresenceSeed(currentDocId, state.presence);
        setAuthorshipRanges(state.collaboration.authorship_ranges);
        setCommentThreads(comments.threads);
        setSuggestions(suggestionsResponse.suggestions);

        const latest = state.reviewSummary.latestRun;
        setReviewRun(latest ?? null);
        if (!latest) {
          setReviewFindings([]);
          return;
        }

        const review = await documentsClient.getReview(currentDocId, latest.id);
        if (cancelled) return;
        setReviewRun(review.run);
        setReviewFindings(review.findings);
      } catch (error) {
        if (cancelled) return;
        if (isDocumentsAuthError(error)) {
          const currentAuth = documentsAuthRef.current;
          if (requestAuth?.origin !== 'user' && isSameDocumentsAuth(currentAuth, requestAuth)) {
            setDocumentsAuth(null);
            setDocumentsAuthTokenDraft('');
            setDocumentsAuthKindDraft('bearer');
            setDocumentsAuthActorDraft('ada');
          }
          return;
        }
        pushToast(error instanceof Error ? error.message : 'Failed to load collaboration overlays.', 'error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyPresenceSeed, currentDocId, documentsAuthHydrated, documentsClient, documentsReady, pushToast]);

  useEffect(() => {
    if (!documentsReady || !currentDocId || !reviewRun || reviewRun.status !== 'running') {
      reviewPollAbortRef.current?.abort();
      reviewPollAbortRef.current = null;
      reviewPollRunIdRef.current = null;
      return;
    }

    if (reviewPollRunIdRef.current === reviewRun.id) {
      return;
    }

    reviewPollAbortRef.current?.abort();
    const controller = new AbortController();
    reviewPollAbortRef.current = controller;
    reviewPollRunIdRef.current = reviewRun.id;

    const runId = reviewRun.id;

    void (async () => {
      const startedAt = Date.now();
      const maxPollMs = 5 * 60_000;
      let delayMs = 900;

      while (!controller.signal.aborted) {
        await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        if (controller.signal.aborted) {
          return;
        }

        // If the user navigated away, drop this poll loop.
        if (!documentsReadyRef.current || currentDocIdRef.current !== currentDocId) {
          return;
        }

        try {
          const response = await documentsClient.getReview(currentDocId, runId, { signal: controller.signal });
          if (controller.signal.aborted) {
            return;
          }

          setReviewRun(response.run);
          setReviewFindings(response.findings);

          if (response.run.status !== 'running') {
            reviewPollRunIdRef.current = null;
            return;
          }

          delayMs = Math.min(3000, Math.round(delayMs * 1.2));
        } catch {
          // Transient failures: back off but keep polling for a reasonable window.
          delayMs = Math.min(5000, Math.round(delayMs * 1.5));
        }

        if (Date.now() - startedAt > maxPollMs) {
          reviewPollRunIdRef.current = null;
          return;
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [currentDocId, documentsClient, documentsReady, reviewRun]);

  const handleApplyReviewFindingFix = useCallback(
    (findingId: string) => {
      void (async () => {
        if (currentFileReadOnly) {
          pushToast('This source is read-only. Review fixes cannot be applied.', 'warning');
          return;
        }
        if (!documentsReady || !currentDocId) {
          pushToast('Connect a Documents token to apply review fixes.', 'warning');
          return;
        }
        if (!reviewRun) {
          pushToast('No review run selected.', 'warning');
          return;
        }

        try {
          const response = await documentsClient.applyReviewFinding(currentDocId, reviewRun.id, findingId);
          setReviewRun(response.run);
          setReviewFindings(response.findings);
          pushToast('Fix applied.', 'success');
          if (currentSourceId && currentFile) {
            const updated = await fetchSourceFile(currentSourceId, currentFile);
            setFileContent(updated.content || '');
          }
        } catch (error) {
          pushToast(error instanceof Error ? error.message : 'Failed to apply fix.', 'error');
        }
      })();
    },
    [currentDocId, currentFile, currentFileReadOnly, currentSourceId, documentsClient, documentsReady, fetchSourceFile, pushToast, reviewRun]
  );

  const handleIgnoreReviewFinding = useCallback(
    (findingId: string) => {
      void (async () => {
        if (!documentsReady || !currentDocId) {
          pushToast('Connect a Documents token to ignore findings.', 'warning');
          return;
        }
        if (!reviewRun) {
          pushToast('No review run selected.', 'warning');
          return;
        }

        try {
          const response = await documentsClient.ignoreReviewFinding(currentDocId, reviewRun.id, findingId);
          setReviewRun(response.run);
          setReviewFindings(response.findings);
        } catch (error) {
          pushToast(error instanceof Error ? error.message : 'Failed to ignore finding.', 'error');
        }
      })();
    },
    [currentDocId, documentsClient, documentsReady, pushToast, reviewRun]
  );

  const renderAgentsPanel = () => (
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
  );

  const renderTaskSidebarPanel = () => {
    // Group consecutive activities by same agent
    const recent = activities.slice(0, 100);
    const groups: Array<{ key: string; agentName: string; agentEmoji: string; items: typeof recent }> = [];
    for (const a of recent) {
      const last = groups[groups.length - 1];
      if (last && last.agentName === (a.agentName ?? 'System') && last.items.length < 20) {
        last.items.push(a);
      } else {
        groups.push({ key: a.id ?? String(groups.length), agentName: a.agentName ?? 'System', agentEmoji: a.agentEmoji ?? '⚡', items: [a] });
      }
    }

    return (
      <div className="p-2">
        <div className="mb-2 px-2 text-xs uppercase tracking-wider text-[var(--text-muted)]">Recent Activity</div>
        {groups.map((g) => (
          <SidebarActivityGroup key={g.key} group={g} onFileSelect={handleFileSelect} onTaskSelect={handleTaskSelect} />
        ))}
        {activities.length === 0 && <div className="px-2 text-xs text-[var(--text-muted)]">No recent activity</div>}
      </div>
    );
  };

  const renderAdminSidebarPanel = () => {
    const items: Array<{ key: AdminSection; title: string; hint: string }> = [
      { key: 'general', title: 'General settings', hint: 'Workspace + security' },
      { key: 'profile', title: 'User profile', hint: 'Name + avatar' },
      { key: 'missionControl', title: 'Mission Control', hint: 'Board + data behavior' },
      { key: 'agents', title: 'Agent registry', hint: 'Crew + scopes' },
      { key: 'integrations', title: 'Integrations', hint: 'Gateway + sync' },
      { key: 'plugins', title: 'Plugins', hint: 'Registry + runtime toggles' },
      { key: 'voice', title: 'Voice / TTS', hint: 'TTS provider + settings' },
      { key: 'taskMaster', title: 'Task Master', hint: 'AI agent settings + logs' },
      { key: 'docs', title: 'Docs', hint: 'Doc Hub + Intelligence' },
      { key: 'enterprise', title: 'Openclaw', hint: 'Embedded crew admin' },
    ];

    return (
      <div className="p-2">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setAdminSection(item.key)}
            className={`mc-shell-card mb-1 w-full border px-3 py-2 text-left transition-colors ${
              adminSection === item.key
                ? 'border-[var(--accent)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
            }`}
          >
            <div className="text-sm font-medium">{item.title}</div>
            <div className="text-xs text-[var(--text-muted)]">{item.hint}</div>
          </button>
        ))}
      </div>
    );
  };

  const renderAdminWorkspace = () => (
    <Suspense fallback={<LazySurfaceFallback label="Loading admin" />}>
      <AdminView
        adminSection={adminSection}
        onOpenTaskMasterSettings={() => setAdminSection('taskMaster')}
        enterpriseFrameNonce={enterpriseFrameNonce}
        enterpriseFrameSrc={enterpriseFrameSrc}
        enterpriseFrameReady={enterpriseFrameReady}
        enterpriseFrameTimedOut={enterpriseFrameTimedOut}
        setEnterpriseFrameReady={setEnterpriseFrameReady}
        setEnterpriseFrameTimedOut={setEnterpriseFrameTimedOut}
        setEnterpriseFrameNonce={setEnterpriseFrameNonce}
        loginRequired={loginRequired}
        toggleLoginRequirement={toggleLoginRequirement}
        authSession={authSession}
        handleLogout={handleLogout}
        appTheme={appTheme}
        setAppTheme={setAppTheme}
        apiBase={runtime.apiBase}
        fsMultiSourceEnabled={runtime.fsMultiSourceEnabled}
        profileNameDraft={profileNameDraft}
        setProfileNameDraft={setProfileNameDraft}
        profileHandleDraft={profileHandleDraft}
        setProfileHandleDraft={setProfileHandleDraft}
        profileAvatarDraft={profileAvatarDraft}
        setProfileAvatarDraft={setProfileAvatarDraft}
        profileEmailDraft={profileEmailDraft}
        setProfileEmailDraft={setProfileEmailDraft}
        userProfile={userProfile}
        handleUserProfileSave={handleUserProfileSave}
        showArchiveColumn={showArchiveColumn}
        setShowArchiveColumn={setShowArchiveColumn}
        applyArchiveVisibility={applyArchiveVisibility}
        tasksLoading={tasksLoading}
        taskCount={tasks.length}
        reloadTasks={reloadTasks}
        connected={connected}
        syncStatusLabel={syncStatusLabel}
        agentsError={agentsError}
        isOffline={isOffline}
        documentsAuth={documentsAuth}
        documentsAuthTokenDraft={documentsAuthTokenDraft}
        setDocumentsAuthTokenDraft={setDocumentsAuthTokenDraft}
        documentsAuthKindDraft={documentsAuthKindDraft}
        setDocumentsAuthKindDraft={setDocumentsAuthKindDraft}
        documentsAuthActorDraft={documentsAuthActorDraft}
        setDocumentsAuthActorDraft={setDocumentsAuthActorDraft}
        setDocumentsAuth={setDocumentsAuth}
        pushToast={pushToast}
        docsTtsSettings={docsTtsSettings}
        setDocsTtsSettings={setDocsTtsSettings}
        onAgentRegistryChanged={() => {
          fetch('/api/agents')
            .then((res) => res.json())
            .then(async (data) => {
              const agentList = data.list || data.agents || [];
              const normalizedAgents = agentList
                .map((entry: any) => normalizeAgentFromApi(entry, userProfile.displayName))
                .filter((agent: Agent | null): agent is Agent => Boolean(agent));
              const modelLabels = await loadAgentDefaultModelLabels(normalizedAgents);
              setAgents(normalizedAgents.map((agent: Agent) => ({
                ...agent,
                model: modelLabels[modelRegistryAgentKey(agent)] || agent.model,
              })));
            })
            .catch(() => undefined);
        }}
      />
    </Suspense>
  );

  const renderSidebarContent = () => {
    if (sidebarTab === 'files') {
      return renderFileSidebarTree();
    }

    if (sidebarTab === 'services') {
      return renderServicesSidebarPanel();
    }

    if (sidebarTab === 'chat') {
      return null;
    }

    if (sidebarTab === 'admin') {
      return renderAdminSidebarPanel();
    }

    if (sidebarTab === 'agents') {
      return renderAgentsPanel();
    }

    return renderTaskSidebarPanel();
  };

  const renderServicesSidebarPanel = () => (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
        <div className="text-sm font-medium text-[var(--text-primary)]">Services</div>
        <div className="mt-2 text-xs text-[var(--text-muted)]">
          Live operational registry for Entity runtime services, linked plugins, and crew tooling.
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          setSidebarTab('admin');
          setAdminSection('plugins');
        }}
        className="mc-shell-btn px-3 py-2 text-left text-xs"
      >
        Open plugin admin
      </button>
      {ENTERPRISE_ADMIN_URL && (
        <a
          href={ENTERPRISE_ADMIN_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="mc-shell-btn px-3 py-2 text-left text-xs"
        >
          Open Crew Admin
        </a>
      )}
    </div>
  );

  const renderFileSidebarTree = () => {
    if (!runtime.fsMultiSourceEnabled) {
      return (
        <LazyFileTree
          onSelect={(path) => {
            if (watchMode) {
              setFollowDetached(true);
            }
            handleFileSelect(path);
          }}
          selected={currentFile}
        />
      );
    }

    return (
      <LazySourceFileTree
        apiBase={runtime.apiBase}
        selectedSourceId={currentSourceId}
        selectedPath={currentFile}
        onSelect={(sourceId, path) => {
          if (watchMode) {
            setFollowDetached(true);
          }
          handleSourceFileSelect(sourceId, path);
        }}
      />
    );
  };

  const renderContextRail = (showCloseButton: boolean) => (
    <>
      {showCloseButton && (
        <div className="flex justify-end border-b border-[var(--border-primary)] px-3 py-2">
          <button
            type="button"
            onClick={() => setTabletSidebarOpen(false)}
            className="mc-shell-btn px-2 py-1 text-xs font-medium"
          >
            Close
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">{renderSidebarContent()}</div>
    </>
  );

  const renderContextBar = () => {
    if (sidebarTab === 'files') {
      return null;
    }

    if (sidebarTab === 'admin') {
      return (
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-[var(--text-muted)]">Admin control center</div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setAdminSection('general')} className="mc-shell-btn px-2 py-1 text-xs">
              General
            </button>
            <button type="button" onClick={() => setAdminSection('missionControl')} className="mc-shell-btn px-2 py-1 text-xs">
              Mission Control
            </button>
            <button type="button" onClick={() => setAdminSection('agents')} className="mc-shell-btn px-2 py-1 text-xs">
              Agents
            </button>
            <button type="button" onClick={() => setAdminSection('integrations')} className="mc-shell-btn px-2 py-1 text-xs">
              Integrations
            </button>
            <button type="button" onClick={() => setAdminSection('plugins')} className="mc-shell-btn px-2 py-1 text-xs">
              Plugins
            </button>
            <button type="button" onClick={() => setAdminSection('voice')} className="mc-shell-btn px-2 py-1 text-xs">
              Voice / TTS
            </button>
            <button type="button" onClick={() => setAdminSection('taskMaster')} className="mc-shell-btn px-2 py-1 text-xs">
              Task Master
            </button>
            <button type="button" onClick={() => setAdminSection('docs')} className="mc-shell-btn px-2 py-1 text-xs">
              Docs
            </button>
            <button type="button" onClick={() => setAdminSection('enterprise')} className="mc-shell-btn px-2 py-1 text-xs">
              Openclaw
            </button>
            {adminSection === 'enterprise' && ENTERPRISE_ADMIN_URL && (
              <a
                href={ENTERPRISE_ADMIN_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="mc-shell-btn px-2 py-1 text-xs"
              >
                Open in new tab
              </a>
            )}
          </div>
        </div>
      );
    }

    if (sidebarTab === 'services') {
      return (
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-[var(--text-muted)]">Operational services registry</div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSidebarTab('admin');
                setAdminSection('plugins');
              }}
              className="mc-shell-btn px-2 py-1 text-xs"
            >
              Plugin admin
            </button>
            {ENTERPRISE_ADMIN_URL && (
            <a
              href={ENTERPRISE_ADMIN_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="mc-shell-btn px-2 py-1 text-xs"
            >
              Crew Admin
            </a>
            )}
          </div>
        </div>
      );
    }

    if (sidebarTab === 'tasks') {
      return (
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {BUILTIN_MC_BOARD_TABS.map((board) => (
              <button
                key={board}
                type="button"
                onClick={() => setMcBoardTab(board)}
	                className={`mc-shell-btn entity-context-tab px-3 py-1 text-xs font-medium capitalize ${
                  mcBoardTab === board ? 'mc-shell-btn-active text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                }`}
              >
                {board === 'kanban' ? 'Kanban' : board}
              </button>
            ))}
            {taskModulePlugins.map((plugin) => (
              <button
                key={plugin.id}
                type="button"
                onClick={() => setMcBoardTab(plugin.id)}
	                className={`mc-shell-btn entity-context-tab px-3 py-1 text-xs font-medium ${
                  mcBoardTab === plugin.id ? 'mc-shell-btn-active text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                }`}
              >
                {plugin.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {activeTaskSubViewPlugin ? (
              <span className="mc-shell-pill px-3 py-1 text-xs text-[var(--text-secondary)]">
                Plugin view · {activeTaskSubViewPlugin.name}
              </span>
            ) : (
              <>
                <select
                  value={mcAssigneeFilter}
                  onChange={(event) => setMcAssigneeFilter(event.target.value as MCAssigneeFilter)}
                  className="mc-shell-input px-2 py-1 text-xs"
                  aria-label="Filter by assignee"
                >
                  <option value="all">Assignee: All</option>
                  <option value="Assistant">Assistant</option>
                  <option value="Human">Human</option>
                  <option value={userProfile.displayName}>{userProfile.displayName}</option>
                </select>
                <select
                  value={mcPriorityFilter}
                  onChange={(event) => setMcPriorityFilter(event.target.value)}
                  className="mc-shell-input px-2 py-1 text-xs"
                  aria-label="Filter by priority"
                >
                  <option value="all">Priority: All</option>
                  <option value="P0">Priority: P0</option>
                  <option value="P1">Priority: P1</option>
                  <option value="P2">Priority: P2</option>
                  <option value="P3">Priority: P3</option>
                </select>
                <select
                  value={mcProjectFilter}
                  onChange={(event) => setMcProjectFilter(event.target.value as MCProjectFilter)}
                  className="mc-shell-input px-2 py-1 text-xs"
                  aria-label="Filter by project"
                >
                  {PROJECT_FILTER_OPTIONS.map((projectOption) => (
                    <option key={projectOption} value={projectOption}>
                      Project: {projectOption === 'all' ? 'All' : projectOption}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    setMcAssigneeFilter('all');
                    setMcPriorityFilter('all');
                    setMcProjectFilter('all');
                    setTaskSearchQuery('');
                  }}
                  className="mc-shell-btn inline-flex h-8 w-8 items-center justify-center px-0 py-0 text-sm"
                  aria-label="Reset task filters"
                  title="Reset task filters"
                >
                  ↺
                </button>
                <div className="relative">
                  <label className="flex h-8 min-w-[17rem] items-center gap-2 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-3 text-xs text-[var(--text-muted)]">
                    <span className="text-sm">🔍</span>
                    <input
                      type="text"
                      value={taskSearchQuery}
                      onChange={(event) => setTaskSearchQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          setTaskSearchQuery('');
                          return;
                        }

                        if (event.key === 'Enter' && taskSearchResults[0]) {
                          handleTaskSelect(taskSearchResults[0].id);
                          setTaskSearchQuery('');
                        }
                      }}
                      placeholder="Global search tasks, assignees, projects..."
                      className="w-full bg-transparent text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                      aria-label="Global task search"
                    />
                    {taskSearchQuery ? (
                      <button
                        type="button"
                        onClick={() => setTaskSearchQuery('')}
                        className="text-[11px] text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
                        aria-label="Clear task search"
                        title="Clear task search"
                      >
                        ✕
                      </button>
                    ) : null}
                  </label>
                  {normalizedTaskSearchQuery ? (
                    <div className="absolute right-0 top-full z-20 mt-2 w-[min(28rem,88vw)] overflow-hidden rounded-lg border border-[var(--border-secondary)] bg-[var(--card-bg)] shadow-[0_16px_36px_rgba(0,0,0,0.32)]">
                      {taskSearchResults.length > 0 ? (
                        taskSearchResults.map((task) => (
                          <button
                            key={task.id}
                            type="button"
                            onClick={() => {
                              handleTaskSelect(task.id);
                              setTaskSearchQuery('');
                            }}
                            className="block w-full border-b border-[var(--border-primary)] px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-[var(--bg-tertiary)]"
                          >
                            <div className="text-sm font-medium text-[var(--text-primary)]">{task.name}</div>
                            <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">#{task.id} • {task.column} • {task.assignee}</div>
                            <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{buildTaskSearchSnippet(task, normalizedTaskSearchQuery)}</div>
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-3 text-xs text-[var(--text-muted)]">No task results found</div>
                      )}
                    </div>
                  ) : null}
                </div>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                setSidebarTab('admin');
                setAdminSection('missionControl');
              }}
              className="mc-shell-btn inline-flex h-8 w-8 items-center justify-center px-0 py-0 text-sm"
              aria-label="Mission Control settings"
              title="Mission Control settings"
            >
              ⚙
            </button>
            <button
              type="button"
              onClick={openMissionControlModal}
              className="mc-shell-btn mc-shell-btn-active inline-flex h-8 w-8 items-center justify-center px-0 py-0 text-base font-semibold text-[var(--text-primary)]"
              aria-label="New task"
              title="New task"
            >
              +
            </button>
          </div>
        </div>
      );
    }

    if (sidebarTab === 'agents') {
      return (
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="text-xs text-[var(--text-muted)]">
              Agents online: {onlineAgents}/{agents.length}
            </div>
            <button
              type="button"
              onClick={() => setSelectedAgent(null)}
              className={`mc-shell-btn px-2 py-1 text-xs ${
                selectedAgent === null ? 'mc-shell-btn-active text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
              }`}
            >
              Crew
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedAgentData ? (
              <span className="mc-shell-pill px-2 py-1 text-xs text-[var(--text-secondary)]">
                Focus: {selectedAgentData.emoji} {selectedAgentData.name}
              </span>
            ) : (
              <span className="mc-shell-pill px-2 py-1 text-xs text-[var(--text-secondary)]">Focus: none</span>
            )}
            <span className="mc-shell-pill px-2 py-1 text-xs text-[var(--text-secondary)]">
              Watch: {watchMode ? 'On' : 'Off'}
            </span>
          </div>
        </div>
      );
    }

    if (sidebarTab === 'chat') {
      return null;
    }

    return null;
  };

  const renderShellContextRow = () => {
    if (sidebarTab === 'files') {
      return null;
    }

    return (
      <div className="entity-context-row flex items-center border-b border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 lg:px-4">
        {renderContextBar()}
      </div>
    );
  };

  const renderShellTopRows = () => (
    <div className="entity-top-row flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 lg:px-4">
        <div className="flex min-w-[320px] flex-1 items-center gap-2">
          {sidebarTab !== 'chat' && (
            <button
              type="button"
              onClick={() => setTabletSidebarOpen(true)}
              className="mc-shell-btn px-2 py-1 text-xs lg:hidden"
            >
              ☰
            </button>
          )}
          <div className="mr-1 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <span>⚡ Entity</span>

          </div>
          {(['files', 'agents', 'tasks', 'services', 'chat', 'admin'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => handleSidebarTabChange(tab)}
	              className={`mc-shell-btn entity-top-tab px-2 py-1 text-xs capitalize ${
                sidebarTab === tab ? 'mc-shell-btn-active text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setQuickSwitcherTargetPane('left');
              setQuickSwitcherOpen(true);
            }}
            className="mc-shell-btn hidden h-8 w-56 max-w-[14rem] items-center gap-2 px-2.5 py-1 text-left text-xs text-[var(--text-muted)] sm:inline-flex"
            aria-label="Search across Entity"
            title="Search across Entity"
          >
            <span className="text-[var(--text-secondary)]" aria-hidden="true">🔍</span>
            <span className="min-w-0 flex-1 truncate">Search across Entity</span>
            <span className="rounded border border-[var(--border-secondary)] px-1 py-0.5 text-[10px] leading-none text-[var(--text-muted)]">
              ⌘K
            </span>
          </button>
          <button
              type="button"
              onClick={() => {
                if (notificationsPanelOpen) {
                  closeNotificationsPanel();
                  return;
                }

                const latestId = notifications[notifications.length - 1]?.id;
                openNotificationsPanel(latestId);
                if (latestId) {
                  selectNotificationInPanel(latestId);
                }
              }}
              className={`mc-shell-btn relative inline-flex items-center justify-center px-2 py-1 text-xs ${
                notificationsPanelOpen ? 'mc-shell-btn-active text-[var(--text-primary)]' : ''
              }`}
              aria-label="Notifications"
              title="Notifications"
            >
              <span aria-hidden="true">🔔</span>
              {totalNotificationsUnreadCount > 0 ? (
                <span
                  className="mc-unread-badge-pulse absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-semibold text-white"
                  aria-label={`${totalNotificationsUnreadCount} unread notifications`}
                >
                  {totalNotificationsUnreadCount > 99 ? '99+' : totalNotificationsUnreadCount}
                </span>
              ) : null}
            </button>
          <span
            className="mc-shell-btn inline-flex items-center px-2 py-1 text-xs"
            aria-label={connected ? 'Online' : 'Offline'}
            title={connected ? 'Online' : 'Offline'}
          >
            <span
              className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-[var(--accent)]' : 'bg-orange-400'}`}
              aria-hidden="true"
            />
          </span>
        </div>
      </div>
  );

  const openExpandedSidebarTab = (tab: WorkspaceTab) => {
    handleSidebarTabChange(tab);
    setSidebarCollapsed(false);
  };

  const renderCollapsedContextMiniPanel = () => {
    if (sidebarTab === 'files') {
      return (
        <button
          type="button"
          onClick={() => openExpandedSidebarTab('files')}
          className="mc-shell-btn inline-flex h-10 w-10 items-center justify-center px-0 py-0 text-base text-[var(--text-primary)]"
          aria-label="Open file browser"
          title="Open file browser"
        >
          <span aria-hidden="true">🗂️</span>
        </button>
      );
    }

    if (sidebarTab === 'agents') {
      return (
        <div className="flex flex-col items-center gap-2">
          {agents.slice(0, 4).map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => {
                handleSidebarTabChange('agents');
                setSelectedAgent(agent.id);
              }}
              className={`mc-shell-btn relative inline-flex h-9 w-9 items-center justify-center px-0 py-0 text-sm ${
                selectedAgent === agent.id ? 'mc-shell-btn-active text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
              }`}
              aria-label={agent.name}
              title={`${agent.name} · ${agent.status}`}
            >
              <span aria-hidden="true">{agent.emoji}</span>
              <span
                className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ${
                  agent.status === 'online' ? 'bg-[var(--accent)]' : 'bg-[var(--text-muted)]'
                }`}
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      );
    }

    if (sidebarTab === 'chat') {
      return (
        <button
          type="button"
          onClick={() => openExpandedSidebarTab('chat')}
          className="mc-shell-btn inline-flex h-10 w-10 items-center justify-center px-0 py-0 text-base text-[var(--text-primary)]"
          aria-label="Open chat"
          title="Open chat"
        >
          <span aria-hidden="true">💬</span>
        </button>
      );
    }
    if (sidebarTab === 'admin') {
      const miniItems: Array<{ key: AdminSection; icon: string; label: string }> = [
        { key: 'general', icon: '🧩', label: 'General settings' },
        { key: 'profile', icon: '👤', label: 'User profile' },
        { key: 'missionControl', icon: '📋', label: 'Mission Control' },
        { key: 'integrations', icon: '🔌', label: 'Integrations' },
        { key: 'plugins', icon: '🧠', label: 'Plugins' },
        { key: 'voice', icon: '🎙️', label: 'Voice / TTS' },
        { key: 'taskMaster', icon: '🤖', label: 'Task Master' },
        { key: 'docs', icon: '📄', label: 'Docs' },
        { key: 'enterprise', icon: '🧭', label: 'Openclaw' },
      ];
      return (
        <div className="flex flex-col items-center gap-2">
          {miniItems.map(({ key, icon, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                handleSidebarTabChange('admin');
                setAdminSection(key);
              }}
              className={`mc-shell-btn inline-flex h-9 w-9 items-center justify-center px-0 py-0 text-sm ${
                adminSection === key ? 'mc-shell-btn-active text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
              }`}
              aria-label={label}
              title={label}
            >
              <span aria-hidden="true">{icon}</span>
            </button>
          ))}
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center gap-2">
        <div
          className="mc-shell-pill inline-flex h-5 min-w-[1.25rem] items-center justify-center px-1 text-[10px] font-semibold text-[var(--text-primary)]"
          aria-label={`${activeTasks.length} active tasks`}
          title={`${activeTasks.length} active tasks`}
        >
          {activeTasks.length}
        </div>
        {activeTasks.slice(0, 5).map((task) => (
          <button
            key={task.id}
            type="button"
            onClick={() => openExpandedSidebarTab('tasks')}
            className="mc-shell-btn inline-flex h-8 w-8 items-center justify-center px-0 py-0 text-[10px] text-[var(--text-secondary)]"
            aria-label={task.name}
            title={`#${task.id} · ${task.name}`}
          >
            <span className="truncate px-1">#{task.id}</span>
          </button>
        ))}
      </div>
    );
  };

  const renderSidebar = (showCloseButton: boolean, allowCollapse = false, forceCollapsed = false) => (
    <div className="flex h-full min-h-0 flex-col">
      {allowCollapse && (sidebarCollapsed || forceCollapsed) ? (
        <div className="flex min-h-0 flex-1 flex-col items-center py-2">
          <div className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto pb-2">
            {renderCollapsedContextMiniPanel()}
          </div>
        </div>
      ) : (
        renderContextRail(showCloseButton)
      )}
      {allowCollapse && !forceCollapsed && (
        <div className="border-t border-[var(--border-primary)] px-2 py-2">
          <button
            type="button"
            onClick={() => setSidebarCollapsed((prev) => !prev)}
            className="mc-shell-btn flex w-full items-center justify-center gap-1 px-2 py-1 text-xs"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <span>{sidebarCollapsed ? '»' : '«'}</span>
          </button>
        </div>
      )}
    </div>
  );

  const renderDesktopWorkspace = (viewport: 'desktop' | 'tablet') => (
    <>
      {sidebarTab === 'tasks' ? (
        <div className="flex-1 min-h-0">
          {activeTaskSubViewPlugin ? (
            <LazyPluginSubViewSlot apiBase={runtime.apiBase} module="tasks" pluginId={activeTaskSubViewPlugin.id} />
          ) : mcBoardTab === 'strategic' ? (
            <LazyMCStrategicView />
          ) : (
            <TaskBoard
              viewport={viewport}
              compactShell
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
          )}
        </div>
      ) : sidebarTab === 'agents' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <LazyAgentDashboardV2
            agents={agents}
            selectedAgentId={selectedAgent}
            onSelectAgent={setSelectedAgent}
            activities={activities}
            tasks={tasks}
            wsConnected={connected}
          />
        </div>
      ) : sidebarTab === 'services' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <LazyPluginTopLevelSlot apiBase={runtime.apiBase} pluginId="entity-services" />
        </div>
      ) : sidebarTab === 'chat' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <LazyChatView />
        </div>
      ) : sidebarTab === 'admin' ? (
        <div className="flex min-h-0 flex-1 flex-col">{renderAdminWorkspace()}</div>
      ) : (
        <Suspense fallback={<LazySurfaceFallback label="Loading files" />}>
          <FilesView
            runtime={runtime}
            currentFile={currentFile}
            handleSourceFileSelect={handleSourceFileSelect}
            openFileTabs={openFileTabs}
            activeFileTabKey={activeFileTabKey}
            onSelectOpenFileTab={handleSelectOpenFileTab}
            onCloseOpenFileTab={handleCloseOpenFileTab}
            onAddOpenFileTab={handleAddOpenFileTab}
            onGoHome={handleBackToDashboard}
            showDocHubTts={shouldRenderMarkdownPreview(currentFile, currentFilePreviewMeta.contentType) && !currentFilePreviewMeta.isBinary}
            filesContextBarProps={{
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
            }}
            currentSourceId={currentSourceId}
            fileContent={fileContent}
            setFileContent={setFileContent}
            editMode={editMode}
            setEditMode={setEditMode}
            splitMode={splitMode}
            splitContainerRef={splitContainerRef}
            splitResizing={splitResizing}
            splitRatio={splitRatio}
            setSplitResizing={setSplitResizing}
            updateSplitRatioFromClientX={updateSplitRatioFromClientX}
            rightPaneFile={rightPaneFile}
            rightPaneSource={rightPaneSource}
            rightPaneSourceId={rightPaneSourceId}
            rightPaneReadOnly={rightPaneReadOnly}
            rightPaneCacheMeta={rightPaneCacheMeta}
            rightPaneCachedAgeLabel={rightPaneCachedAgeLabel}
            setQuickSwitcherTargetPane={setQuickSwitcherTargetPane}
            setQuickSwitcherOpen={setQuickSwitcherOpen}
            exitSplitMode={exitSplitMode}
            rightPaneContent={rightPaneContent}
            handleRightPaneContentChange={handleRightPaneContentChange}
            rightPanePreviewMeta={rightPanePreviewMeta}
            rightPaneRawFileUrl={rightPaneRawFileUrl}
            handleContentChange={handleContentChange}
            handleSave={handleSave}
            editorCollabMode={editorCollabMode}
            watchMode={watchMode}
            currentFileReadOnly={currentFileReadOnly}
            documentsReady={documentsReady}
            currentDocId={currentDocId}
            handleSuggestingEdit={handleSuggestingEdit}
            handleToggleSuggestingMode={handleToggleSuggestingMode}
            handleExitSuggestingMode={handleExitSuggestingMode}
            manualAttributionEnabled={manualAttributionEnabled}
            editorAuthorshipRanges={editorAuthorshipRanges}
            handleManualAttribution={handleManualAttribution}
            setEditorSelection={setEditorSelection}
            handleEditorCursorActivity={handleEditorCursorActivity}
            commentThreads={commentThreads}
            setRightSidebarCollapsed={setRightSidebarCollapsed}
            setSelectedCommentId={setSelectedCommentId}
            setFocusRange={setFocusRange}
            suggestions={suggestions}
            setSelectedSuggestionId={setSelectedSuggestionId}
            documentsClient={documentsClient}
            setSuggestions={setSuggestions}
            pushToast={pushToast}
            fetchSourceFile={fetchSourceFile}
            reviewFindings={reviewFindings}
            setSelectedFindingId={setSelectedFindingId}
            handleApplyReviewFindingFix={handleApplyReviewFindingFix}
            handleIgnoreReviewFinding={handleIgnoreReviewFinding}
            editorPresence={editorPresence}
            focusRange={focusRange}
            followEnabled={followEnabled}
            debouncedFollowCursor={debouncedFollowCursor}
            setFollowDetached={setFollowDetached}
            currentFilePreviewMeta={currentFilePreviewMeta}
            filename={currentFile ? filenameFromFilePath(currentFile) : null}
            sourceName={selectedSource?.displayName ?? null}
            currentFileUpdatedAt={currentFileUpdatedAt}
            setFileHistoryPanelOpen={setFileHistoryPanelOpen}
            fileHistoryPanelOpen={fileHistoryPanelOpen}
            currentRawFileUrl={currentRawFileUrl}
            handleMarkdownDocsNavigation={handleMarkdownDocsNavigation}
            docsTtsSettings={docsTtsSettings}
            handleDocsTtsSettingsChange={handleDocsTtsSettingsChange}
            rightSidebarHasPanels={rightSidebarHasPanels}
            rightSidebarIsCollapsed={rightSidebarIsCollapsed}
            rightSidebarHasComments={rightSidebarHasComments}
            rightSidebarHasSuggestions={rightSidebarHasSuggestions}
            rightSidebarHasReview={rightSidebarHasReview}
            editorSelection={editorSelection}
            setCommentPopover={setCommentPopover}
            setCommentThreads={setCommentThreads}
            selectedCommentId={selectedCommentId}
            selectedSuggestionId={selectedSuggestionId}
            reviewMode={reviewMode}
            setReviewMode={setReviewMode}
            reviewRun={reviewRun}
            setReviewRun={setReviewRun}
            setReviewFindings={setReviewFindings}
            selectedFindingId={selectedFindingId}
            followGlowClassName={followGlowClassName}
            followTypingPulseActive={followTypingPulseActive}
            fileTransitionActive={fileTransitionActive}
            docIntelligenceFocus={docIntelligenceFocus}
            onDocIntelligenceFocusApplied={() => setDocIntelligenceFocus(null)}
            onFocusCommentsRail={handleFocusCommentsRail}
            tasks={tasks}
            onOpenTask={handleTaskSelect}
            onOpenRelatedDoc={handleSourceFileSelect}
          />
        </Suspense>
      )}
      {sidebarTab !== 'admin' && (
        <LazyBottomTerminalPanel
          isOpen={activityPanelOpen}
          onToggleOpen={() => setActivityPanelOpen((prev) => !prev)}
        />
      )}
    </>
  );

  const renderInstallCta = (bottomClassName: string) => {
    if (!installCtaVisible) {
      return null;
    }

    return (
      // Mobile: pin under the header instead of floating over the composer/nav.
      <div className={`fixed right-3 z-[72] ${bottomClassName} max-md:bottom-auto max-md:top-3`}>
        <div className="flex items-center gap-2 rounded-md border border-[var(--border-secondary)] bg-[var(--bg-secondary)]/95 px-2 py-1.5 shadow-lg backdrop-blur">
          <button
            type="button"
            onClick={() => {
              void handleInstallClick();
            }}
            className="mc-shell-btn border-[var(--accent)] bg-[var(--bg-secondary)] px-3 py-1 text-xs font-medium text-[var(--text-primary)]"
          >
            {deferredInstallPrompt ? 'Install App' : 'Add to Dock'}
          </button>
          <button
            type="button"
            onClick={handleDismissInstallCta}
            className="mc-shell-btn px-1.5 py-0.5 text-[11px] leading-none text-[var(--text-muted)] max-md:min-h-[44px] max-md:min-w-[44px] max-md:text-sm"
            aria-label="Dismiss app install prompt"
            title="Dismiss app install prompt"
          >
            ×
          </button>
        </div>
      </div>
    );
  };

  const renderOfflineSyncBar = (mobileHasBottomNav: boolean) => {
    if (!showOfflineSyncBar) {
      return null;
    }

    const pendingLabel = offlineQueuePending === 1 ? '1 change' : `${offlineQueuePending} changes`;
    const summaryText = isOffline
      ? `Offline - ${pendingLabel} pending - changes will sync when back online`
      : syncingNow
        ? `Syncing queue - ${pendingLabel} pending`
        : `${pendingLabel} pending sync`;

    const canExpand = offlineQueueItems.length > 0;

    return (
      <>
        {offlineQueueExpanded && canExpand && (
          <div className={`fixed left-0 right-0 z-[74] px-2 pb-2 ${mobileHasBottomNav ? 'bottom-[3.5rem] md:bottom-8' : 'bottom-8'}`}>
            <div className="mx-auto w-full max-w-4xl rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-2 shadow-lg">
              <div className="mb-2 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Queued Changes</div>
              <div className="max-h-40 space-y-1 overflow-auto">
                {offlineQueueItems.map((item) => (
                  <div key={item.id} className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-xs">
                    <div className="text-[var(--text-primary)]">{describeQueuedWrite(item)}</div>
                    <div className="text-[10px] text-[var(--text-muted)]">
                      queued {new Date(item.createdAt).toLocaleTimeString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        <div className={`fixed left-0 right-0 z-[73] ${mobileHasBottomNav ? 'bottom-14 md:bottom-0' : 'bottom-0'}`}>
          <div className="flex items-center justify-between border-t border-[var(--border-secondary)] bg-[var(--bg-secondary)]/95 px-3 py-1.5 text-xs text-[var(--text-primary)] backdrop-blur">
            <button
              type="button"
              onClick={() => setOfflineQueueExpanded((prev) => (canExpand ? !prev : false))}
              className={`text-left ${canExpand ? 'hover:text-[var(--accent)]' : ''}`}
              disabled={!canExpand}
            >
              {summaryText}
            </button>
            <button
              type="button"
              onClick={() => {
                void handleSyncNow();
              }}
              disabled={offlineQueuePending <= 0 || syncingNow || isOffline}
              className={`mc-shell-btn px-2 py-0.5 text-[11px] ${
                offlineQueuePending > 0 && !syncingNow && !isOffline
                  ? 'mc-shell-btn-active text-[var(--text-primary)]'
                  : 'cursor-not-allowed opacity-40'
              }`}
            >
              {syncingNow ? 'Syncing…' : 'Sync Now'}
            </button>
          </div>
        </div>
      </>
    );
  };

  if (docsModeActive && docsPath) {
    const docsBackState =
      typeof window !== 'undefined' && window.history.state && typeof window.history.state === 'object'
        ? (window.history.state as { returnTaskId?: unknown })
        : null;
    const docsBackTaskId =
      docsBackState && typeof docsBackState.returnTaskId === 'number' ? docsBackState.returnTaskId : null;
    return (
      <Suspense fallback={<LazySurfaceFallback label="Loading document" />}>
        <DocsRouteView
          docsPath={docsPath}
          docsFilename={docsFilename || docsFilenameFromPath(docsPath)}
          docsBreadcrumbSegments={docsBreadcrumbSegments}
          docsError={docsError}
          docsContent={docsContent}
          docsLoading={docsLoading}
          docsTtsSettings={docsTtsSettings}
          docsBackTaskId={docsBackTaskId}
          onBackToHome={handleDocsBackToHome}
          onDocsLinkNavigate={handleMarkdownDocsNavigation}
          onDocsTtsSettingsChange={handleDocsTtsSettingsChange}
          onToast={(msg, type) => pushToast(msg, type === 'success' ? 'success' : type === 'error' ? 'error' : 'info')}
          renderInstallCta={renderInstallCta}
          renderOfflineSyncBar={renderOfflineSyncBar}
        />
      </Suspense>
    );
  }

  const onboardingToken = typeof window !== 'undefined' ? window.location.pathname.match(/^\/onboard\/agent\/([^/]+)$/)?.[1] ?? null : null;
  const onboardingRouteActive = typeof window !== 'undefined' && window.location.pathname === '/onboarding';
  const shouldShowOnboarding = Boolean(onboardingToken) || onboardingRouteActive || onboardingCompleted === false;

  if (shouldShowOnboarding) {
    return (
      <LazyOnboardingFlow
        apiBase={runtime.apiBase}
        routeToken={onboardingToken}
        userProfile={userProfile}
        appTheme={appTheme}
        onThemeChange={setAppTheme}
        onProfileSave={saveUserProfile}
        onComplete={() => {
          setOnboardingCompleted(true);
          if (typeof window !== 'undefined' && (window.location.pathname === '/onboarding' || onboardingToken)) {
            window.history.replaceState(null, '', '/');
          }
        }}
      />
    );
  }

  const showLeftSidebar = sidebarTab !== 'chat';
  const paperTaskRail = appTheme === 'paper' && sidebarTab === 'tasks';

  return (
    <div
      className="entity-shell flex h-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-secondary)]"
      data-workspace-tab={sidebarTab}
    >
      {renderInstallCta('bottom-28 md:bottom-8')}
      {quickSwitcherOpen ? (
        <Suspense fallback={null}>
          <QuickSwitcher
            isOpen={quickSwitcherOpen}
            onClose={() => {
              setQuickSwitcherOpen(false);
              setQuickSwitcherTargetPane('left');
            }}
            onSelect={(path, sourceId) => {
              if (quickSwitcherTargetPane === 'right') {
                if (!splitMode) {
                  setSplitMode('horizontal');
                  setSplitRatio(0.5);
                }

                if (sourceId) {
                  handleRightPaneSourceFileSelect(sourceId, path);
                  return;
                }

                handleRightPaneFileSelect(path);
                return;
              }

              if (sourceId) {
                handleSourceFileSelect(sourceId, path);
                return;
              }

              handleFileSelect(path);
            }}
            apiBase={runtime.apiBase}
            useUnifiedSearch={runtime.fsMultiSourceEnabled}
          />
        </Suspense>
      ) : null}

      {notificationsPanelOpen ? (
        <LazyNotificationHistoryPanel
          isOpen={notificationsPanelOpen}
          notifications={notifications}
          selectedId={selectedNotificationId}
          onClose={closeNotificationsPanel}
          onSelect={selectNotificationInPanel}
          onMarkAllRead={markAllNotificationsRead}
          onClearAll={clearAllNotifications}
          entityNotifications={entityNotifications.notifications}
          entityNotificationsLoading={entityNotifications.loading}
          entityNotificationsError={entityNotifications.error}
          onEntityNotificationRead={(id) => void entityNotifications.markState(id, 'read')}
        />
      ) : null}

      {fileHistoryPanelOpen ? (
        <LazyFileHistoryPanel
          apiBase={runtime.apiBase}
          filePath={currentSourceId ? null : currentFile}
          latestSavedContent={fileContent}
          currentContent={fileContent}
          isOpen={fileHistoryPanelOpen}
          onClose={() => setFileHistoryPanelOpen(false)}
        />
      ) : null}

      {reloadPrompt && (
        <div className="fixed left-0 right-0 top-0 z-50 flex items-center justify-between border-b border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-4 py-2 text-[var(--text-primary)]">
          <span>📝 Agent updated this file. <strong>Reload to see changes?</strong></span>
          <div className="flex gap-2">
            <button
              onClick={handleReload}
              className="mc-shell-btn mc-shell-btn-active border-[var(--accent)] px-3 py-1 text-sm font-medium text-[var(--text-primary)]"
            >
              Reload
            </button>
            <button onClick={() => setReloadPrompt(null)} className="mc-shell-btn px-3 py-1 text-sm">
              Ignore
            </button>
          </div>
        </div>
      )}

      <div className="hidden min-w-0 flex-1 flex-col md:flex">
        {renderShellTopRows()}
        <div className="flex min-h-0 flex-1 bg-[var(--bg-primary)]">
          {showLeftSidebar && (
            <aside
              className={`entity-left-rail hidden shrink-0 flex-col border-r border-[var(--border-primary)] bg-[var(--bg-primary)] transition-[width] duration-200 lg:flex ${
                paperTaskRail ? 'w-[5.25rem]' : sidebarCollapsed ? 'w-14' : 'w-64'
              }`}
            >
              {renderSidebar(false, true, paperTaskRail)}
            </aside>
          )}
          <div className="hidden min-w-0 flex-1 flex-col lg:flex">
            {renderShellContextRow()}
            {renderDesktopWorkspace('desktop')}
          </div>
          <div className="flex min-w-0 flex-1 flex-col lg:hidden">
            {renderShellContextRow()}
            {renderDesktopWorkspace('tablet')}
          </div>
        </div>
      </div>

      {showLeftSidebar && tabletSidebarOpen && (
        <div
          className="fixed inset-0 z-40 hidden bg-[var(--overlay-strong)] md:block lg:hidden"
          onClick={() => setTabletSidebarOpen(false)}
        >
          <aside
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-[var(--border-primary)] bg-[var(--bg-primary)]"
            onClick={(event) => event.stopPropagation()}
          >
            {renderSidebar(true)}
          </aside>
        </div>
      )}

      {isMobile ? (
        <Suspense fallback={<LazySurfaceFallback label="Loading mobile workspace" />}>
          <MobileView
            mobileTab={mobileTab}
            workspaceTab={workspaceTab}
            onlineAgents={onlineAgents}
            agents={agents}
            connected={connected}
            currentFile={currentFile}
            setCurrentFile={setCurrentFile}
            setFileContent={setFileContent}
            setCurrentFilePreviewMeta={setCurrentFilePreviewMeta}
            setCurrentFileCacheMeta={setCurrentFileCacheMeta}
            selectedSource={selectedSource}
            currentFileCacheMeta={currentFileCacheMeta}
            currentFileCachedAgeLabel={currentFileCachedAgeLabel}
            runtime={runtime}
            handleBackToDashboard={handleBackToDashboard}
            editMode={editMode}
            setEditMode={setEditMode}
            editorCollabMode={editorCollabMode}
            watchMode={watchMode}
            canEditCurrentFile={canEditCurrentFile}
            handleSave={handleSave}
            manualAttributionEnabled={manualAttributionEnabled}
            authorshipStats={authorshipStats}
            manualAuthorshipAuthor={manualAuthorshipAuthor}
            setManualAuthorshipAuthor={setManualAuthorshipAuthor}
            followGlowClassName={followGlowClassName}
            followTypingPulseActive={followTypingPulseActive}
            fileTransitionActive={fileTransitionActive}
            fileContent={fileContent}
            handleContentChange={handleContentChange}
            currentFileReadOnly={currentFileReadOnly}
            documentsReady={documentsReady}
            handleSuggestingEdit={handleSuggestingEdit}
            handleToggleSuggestingMode={handleToggleSuggestingMode}
            handleExitSuggestingMode={handleExitSuggestingMode}
            editorAuthorshipRanges={editorAuthorshipRanges}
            handleManualAttribution={handleManualAttribution}
            handleEditorCursorActivity={handleEditorCursorActivity}
            suggestions={suggestions}
            setSelectedSuggestionId={setSelectedSuggestionId}
            setSelectedFindingId={setSelectedFindingId}
            setFocusRange={setFocusRange}
            documentsClient={documentsClient}
            currentDocId={currentDocId}
            setSuggestions={setSuggestions}
            pushToast={pushToast}
            currentSourceId={currentSourceId}
            fetchSourceFile={fetchSourceFile}
            reviewFindings={reviewFindings}
            handleApplyReviewFindingFix={handleApplyReviewFindingFix}
            handleIgnoreReviewFinding={handleIgnoreReviewFinding}
            editorPresence={editorPresence}
            followEnabled={followEnabled}
            debouncedFollowCursor={debouncedFollowCursor}
            setFollowDetached={setFollowDetached}
            currentFilePreviewMeta={currentFilePreviewMeta}
            currentRawFileUrl={currentRawFileUrl}
            handleMarkdownDocsNavigation={handleMarkdownDocsNavigation}
            docsTtsSettings={docsTtsSettings}
            handleDocsTtsSettingsChange={handleDocsTtsSettingsChange}
            selectedAgent={selectedAgent}
            selectedAgentData={selectedAgentData}
            activities={activities}
            tasks={tasks}
            setSelectedAgent={setSelectedAgent}
            activeTaskSubViewPlugin={activeTaskSubViewPlugin}
            mcBoardTab={mcBoardTab}
            highlightTaskId={highlightTaskId}
            handleTaskSelect={handleTaskSelect}
            handleCloseTaskDetail={handleCloseTaskDetail}
            handleTaskOutputDocsNavigation={handleTaskOutputDocsNavigation}
            taskSearchQuery={taskSearchQuery}
            showArchiveColumn={showArchiveColumn}
            setShowArchiveColumn={setShowArchiveColumn}
            filteredBoardTasks={filteredBoardTasks}
            tasksLoading={tasksLoading}
            tasksError={tasksError}
            mobileActivityPanelOpen={mobileActivityPanelOpen}
            setMobileActivityPanelOpen={setMobileActivityPanelOpen}
            activityLoading={activityLoading}
            activityError={activityError}
            handleFileSelect={handleFileSelect}
            handleSourceFileSelect={handleSourceFileSelect}
            setTabletSidebarOpen={setTabletSidebarOpen}
            setMobileTab={setMobileTab}
            setSidebarTab={setSidebarTab}
            renderOfflineSyncBar={renderOfflineSyncBar}
            renderAdminWorkspace={renderAdminWorkspace}
            adminSection={adminSection}
            setAdminSection={setAdminSection}
            agentsLoading={agentsLoading}
            agentsError={agentsError}
            followingAgent={followingAgent}
            setFollowingAgent={setFollowingAgent}
          />
        </Suspense>
      ) : null}

      {createTaskModalOpen ? (
        <Suspense fallback={null}>
          <MCCreateTaskModal
            open
            apiBase={runtime.apiBase}
            onClose={() => setCreateTaskModalOpen(false)}
            onCreateTask={createTask}
            onCreated={(task) => {
              handleTaskSelect(task.id);
            }}
          />
        </Suspense>
      ) : null}

      <div
        id="loginOverlay"
        className={`fixed inset-0 z-[70] items-center justify-center bg-[var(--overlay-strong)] p-4 ${
          loginLocked ? 'flex' : 'hidden'
        }`}
      >
        <form
          onSubmit={handleLoginSubmit}
          className="w-full max-w-sm rounded-xl border border-[var(--border-secondary)] bg-[var(--card-bg)] p-6 text-[var(--text-secondary)] shadow-[0_16px_48px_rgba(0,0,0,0.35)]"
        >
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">Login</h2>
          </div>
          <p className="mb-4 text-sm text-[var(--text-muted)]">
            Enter your workspace credentials (default password: {DEFAULT_LOGIN_PASSWORD}).
          </p>
          <input
            id="loginUsername"
            type="text"
            placeholder="Username"
            value={loginUsername}
            onChange={(event) => setLoginUsername(event.target.value)}
            className="mc-shell-input mb-2 w-full px-3 py-2 text-sm"
            autoComplete="username"
          />
          <input
            id="loginPassword"
            type="password"
            placeholder="Password"
            value={loginPassword}
            onChange={(event) => setLoginPassword(event.target.value)}
            className="mc-shell-input mb-3 w-full px-3 py-2 text-sm"
            autoComplete="current-password"
          />
          <button
            type="submit"
            className="mc-shell-btn mc-shell-btn-active w-full border-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--text-primary)]"
          >
            Login
          </button>
          <div id="loginError" className="mt-3 min-h-5 text-sm text-[var(--error)]">
            {loginError}
          </div>
        </form>
      </div>

      {agentsError && !agentsErrorDismissed && (
        <div className="fixed right-3 top-16 z-[75] flex items-center gap-2 rounded-md border border-[var(--error)] bg-[var(--bg-secondary)]/95 px-3 py-1 text-xs text-[var(--error)] md:top-20">
          <span>Agent registry unavailable. Using local agent identities.</span>
          <button
            type="button"
            onClick={() => setAgentsErrorDismissed(true)}
            className="mc-shell-btn px-2 py-0.5 text-[10px] text-[var(--error)]"
            aria-label="Dismiss agent registry error"
          >
            ×
          </button>
        </div>
      )}

      {commentPopover && (
        <Suspense fallback={null}>
          <NewCommentPopover
            anchor={commentPopover.anchor}
            selectedText={commentPopover.selectedText}
            onCancel={() => setCommentPopover(null)}
            onSubmit={(text) => {
              void (async () => {
                const value = text.trim();
                if (!value) return;
                if (!documentsReady || !currentDocId) {
                  pushToast('Connect a Documents token to create comments.', 'warning');
                  return;
                }

                try {
                  const response = await documentsClient.postComment(currentDocId, {
                    from: commentPopover.selection.from,
                    to: commentPopover.selection.to,
                    text: value,
                    selectedText: commentPopover.selectedText,
                  });
                  setCommentThreads(response.threads);
                  setCommentPopover(null);
                  pushToast('Comment created.', 'success');
                } catch (error) {
                  pushToast(error instanceof Error ? error.message : 'Failed to create comment.', 'error');
                }
              })();
            }}
          />
        </Suspense>
      )}

      <ToastViewport
        toasts={toasts}
        onDismiss={dismissToast}
        onOpen={(notificationId) => {
          openNotificationsPanel(notificationId);
          selectNotificationInPanel(notificationId);
        }}
      />
    </div>
  );
}
