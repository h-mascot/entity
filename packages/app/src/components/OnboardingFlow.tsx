import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { UserProfile } from '../lib/userProfile';

type AppTheme = 'dark' | 'light' | 'kitz' | 'nebula' | 'aurora' | 'paper';
type SetupMode = 'quick' | 'agent' | 'manual';
type WorkspaceMode = 'private' | 'team' | 'open-source';
type StarterPreset = 'solo' | 'crew' | 'open-source';
type FirstAgentMode = 'assistant' | 'invite' | 'manual' | 'skip';
type FirstSourceMode = 'current-folder' | 'github' | 'skip';
type IconName =
  | 'agent'
  | 'arrow'
  | 'bot'
  | 'check'
  | 'clipboard'
  | 'code'
  | 'copy'
  | 'database'
  | 'download'
  | 'file'
  | 'folder'
  | 'gear'
  | 'globe'
  | 'help'
  | 'info'
  | 'key'
  | 'link'
  | 'lock'
  | 'palette'
  | 'rocket'
  | 'search'
  | 'spark'
  | 'upload'
  | 'user'
  | 'users'
  | 'warning';

interface OnboardingState {
  completed: boolean;
  skipped: boolean;
  completedAt: string | null;
  mode: SetupMode;
  currentStep: number;
  workspaceMode: WorkspaceMode;
  selectedTheme: AppTheme;
  defaultAiProvider: string;
  defaultAiModel: string;
  starterPreset: StarterPreset;
  firstAgentMode: FirstAgentMode;
  firstSourceMode: FirstSourceMode;
}

interface AgentSession {
  token: string;
  setupUrl: string;
  expiresAt: string;
  progress: Array<{ id: string; label: string; status: 'pending' | 'running' | 'done' | 'error'; message?: string }>;
}

interface ChatModelOption {
  id: string;
  name: string;
  provider: string;
  isLocal: boolean;
  available?: boolean;
  source?: string;
}

interface OnboardingFlowProps {
  apiBase?: string;
  routeToken?: string | null;
  userProfile: UserProfile;
  appTheme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
  onProfileSave: (profile: Partial<UserProfile>) => void;
  onComplete: () => void;
}

const DEFAULT_STATE: OnboardingState = {
  completed: false,
  skipped: false,
  completedAt: null,
  mode: 'quick',
  currentStep: 1,
  workspaceMode: 'private',
  selectedTheme: 'aurora',
  defaultAiProvider: 'codex',
  defaultAiModel: 'GPT-5.5',
  starterPreset: 'crew',
  firstAgentMode: 'assistant',
  firstSourceMode: 'current-folder',
};

const SETUP_STEPS = [
  { label: 'Mode', detail: 'Choose setup path' },
  { label: 'Workspace', detail: 'Name and visibility' },
  { label: 'Theme', detail: 'Workspace look' },
  { label: 'Default AI', detail: 'Provider and model' },
  { label: 'Modules', detail: 'Starter capabilities' },
  { label: 'Source', detail: 'Agent and data source' },
  { label: 'Finish', detail: 'Ready to go' },
];

const AGENT_STEPS = ['Setup link', 'Agent installs', 'Agent registers', 'Verify workspace', 'Finish'];

const SETUP_OPTIONS: Array<{
  id: SetupMode;
  title: string;
  chip: string;
  description: string;
  icon: IconName;
}> = [
  { id: 'quick', title: 'Quick setup', chip: 'Fastest', description: 'Use recommended defaults and enter the workspace.', icon: 'rocket' },
  { id: 'agent', title: 'Set up with agent', chip: 'Agent-assisted', description: 'Create a setup link your coding agent can complete.', icon: 'bot' },
  { id: 'manual', title: 'Manual setup', chip: 'Guided', description: 'Walk through the core setup yourself.', icon: 'clipboard' },
];

const THEMES: Array<{ id: AppTheme; title: string; hint: string }> = [
  { id: 'dark', title: 'Dark', hint: 'Classic black shell' },
  { id: 'light', title: 'Light', hint: 'Clean white workspace' },
  { id: 'kitz', title: 'Kitz', hint: 'Enterprise gradient dark' },
  { id: 'nebula', title: 'Nebula', hint: 'Glassy blue violet' },
  { id: 'aurora', title: 'Aurora', hint: 'Mint peach glass' },
  { id: 'paper', title: 'Paper', hint: 'Notebook desk board' },
];

const PROVIDERS: Array<{ id: string; title: string; icon: IconName; tone: string }> = [
  { id: 'claude-code', title: 'Claude Code', icon: 'spark', tone: 'orange' },
  { id: 'codex', title: 'Codex', icon: 'code', tone: 'blue' },
  { id: 'pi', title: 'Pi', icon: 'spark', tone: 'gold' },
  { id: 'gemini', title: 'Gemini', icon: 'spark', tone: 'yellow' },
  { id: 'opencode', title: 'OpenCode', icon: 'code', tone: 'green' },
];

const PRESETS: Array<{
  id: StarterPreset;
  title: string;
  description: string;
  icon: IconName;
  modules: Array<{ label: string; icon: IconName }>;
}> = [
  {
    id: 'solo',
    title: 'Solo agent',
    description: 'Best when one local assistant will help you manage the workspace.',
    icon: 'user',
    modules: [
      { label: 'Files', icon: 'folder' },
      { label: 'Tasks', icon: 'check' },
      { label: 'Chat', icon: 'bot' },
    ],
  },
  {
    id: 'crew',
    title: 'Multi agents',
    description: 'Best when more than one agent will work in the same workspace.',
    icon: 'users',
    modules: [
      { label: 'Agents', icon: 'users' },
      { label: 'Tasks', icon: 'check' },
      { label: 'Files', icon: 'folder' },
      { label: 'Chat', icon: 'bot' },
      { label: 'Plugins', icon: 'gear' },
    ],
  },
];

const WORKSPACE_MODES: Array<{
  id: WorkspaceMode;
  title: string;
  detail: string;
  icon: IconName;
  disabled?: boolean;
  badge?: string;
}> = [
  { id: 'private', title: 'Private local', detail: 'Runs on this machine with local workspace settings.', icon: 'lock' },
  { id: 'open-source', title: 'Open-source starter', detail: 'Public project setup will be finished from Admin.', icon: 'code', disabled: true, badge: 'Later' },
];

function normalizeLoadedState(loaded: OnboardingState): OnboardingState {
  return {
    ...loaded,
    workspaceMode: loaded.workspaceMode === 'team' ? 'private' : loaded.workspaceMode,
    starterPreset: loaded.starterPreset === 'open-source' ? 'crew' : loaded.starterPreset,
  };
}

function normalizeModel(value: unknown): ChatModelOption | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !row.id.trim()) return null;
  const id = row.id.trim();
  const provider = typeof row.provider === 'string' && row.provider.trim() ? row.provider.trim() : id.split('/')[0] ?? 'unknown';
  return {
    id,
    name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : id,
    provider,
    isLocal: Boolean(row.isLocal ?? row.local),
    available: typeof row.available === 'boolean' ? row.available : undefined,
    source: typeof row.source === 'string' ? row.source : undefined,
  };
}

function formatModelLabel(label: string): string {
  return label
    .replace(/\bgpt\b/gi, 'GPT')
    .replace(/\bcodex\b/gi, 'Codex')
    .replace(/\bopenai\b/gi, 'OpenAI')
    .replace(/\banthropic\b/gi, 'Anthropic')
    .replace(/\bopenrouter\b/gi, 'OpenRouter');
}

function apiPath(apiBase: string | undefined, path: string): string {
  return `${apiBase ?? ''}${path}`;
}

function setupUrl(path: string): string {
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

function absoluteUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return '';
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (typeof window === 'undefined') return pathOrUrl;
  return new URL(pathOrUrl, window.location.origin).toString();
}

function progressLabel(step: number): string {
  return `Setup ${Math.min(Math.max(step, 1), 7)} of 7`;
}

function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  const shared = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  const paths: Record<IconName, ReactNode> = {
    agent: <><path d="M8 16a4 4 0 0 1 8 0" /><circle cx="12" cy="9" r="3" /><path d="M5 20h14" /></>,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    bot: <><rect x="5" y="8" width="14" height="10" rx="3" /><path d="M12 8V5" /><path d="M9 12h.01" /><path d="M15 12h.01" /><path d="M9.5 16h5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    clipboard: <><rect x="7" y="4" width="10" height="16" rx="2" /><path d="M9 4h6v4H9z" /><path d="M10 12h4" /><path d="M10 16h3" /></>,
    code: <><path d="m8 8-4 4 4 4" /><path d="m16 8 4 4-4 4" /><path d="m14 5-4 14" /></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M5 15V5h10" /></>,
    database: <><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" /><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" /></>,
    download: <><path d="M12 4v10" /><path d="m8 10 4 4 4-4" /><path d="M5 20h14" /></>,
    file: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v5h5" /><path d="M9 13h6" /><path d="M9 17h4" /></>,
    folder: <><path d="M3 7h7l2 2h9v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>,
    gear: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.8-1L14.4 3h-4l-.4 3.1a7 7 0 0 0-1.8 1l-2.4-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 1.8 1l.4 3.1h4l.4-3.1a7 7 0 0 0 1.8-1l2.4 1 2-3.4-2-1.5c.1-.3.1-.7.1-1z" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18" /><path d="M12 3a14 14 0 0 0 0 18" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.4 2.4 0 0 1 4.5 1.2c0 1.8-2.3 2-2.3 3.8" /><path d="M12 17h.01" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>,
    key: <><circle cx="8" cy="15" r="3" /><path d="m10.2 12.8 8-8" /><path d="M15 6h3v3" /></>,
    link: <><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" /></>,
    lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    palette: <><path d="M12 3a9 9 0 0 0 0 18h1.5a2 2 0 0 0 1.5-3.3 1.8 1.8 0 0 1 1.4-3h1.1A4.5 4.5 0 0 0 22 10.2C22 6.2 17.5 3 12 3z" /><path d="M7.5 10h.01" /><path d="M10 7.5h.01" /><path d="M14 7.5h.01" /><path d="M16.5 10h.01" /></>,
    rocket: <><path d="M4.5 16.5c-1 1-1.5 2.2-1.5 4 1.8 0 3-.5 4-1.5" /><path d="M8 16 5 19" /><path d="M9 15 4 10l4-1 7-7c3.2.4 5.6 2.8 6 6l-7 7-1 4z" /><path d="M14 6l4 4" /></>,
    search: <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>,
    spark: <><path d="M12 2v20" /><path d="M4 12h16" /><path d="m5 5 14 14" /><path d="m19 5-14 14" /></>,
    upload: <><path d="M12 20V8" /><path d="m8 12 4-4 4 4" /><path d="M5 20h14" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M5 21a7 7 0 0 1 14 0" /></>,
    users: <><path d="M16 21a5 5 0 0 0-8 0" /><circle cx="12" cy="8" r="4" /><path d="M20 19a4 4 0 0 0-3-3.8" /><path d="M4 19a4 4 0 0 1 3-3.8" /></>,
    warning: <><path d="M12 3 2 20h20z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  };

  return <svg {...shared}>{paths[name]}</svg>;
}

function StatusChip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'active' | 'warning' | 'success' }) {
  const toneClass = tone === 'active'
    ? 'border-blue-300 bg-blue-50 text-blue-700'
    : tone === 'warning'
      ? 'border-amber-300 bg-amber-50 text-amber-700'
      : tone === 'success'
        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
        : 'border-[var(--border-secondary)] bg-white/50 text-[var(--text-muted)]';
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${toneClass}`}>{children}</span>;
}

function CircleState({ state }: { state: 'done' | 'active' | 'idle' }) {
  if (state === 'done') {
    return <span className="onboarding-dot onboarding-dot-done"><Icon name="check" className="h-3.5 w-3.5" /></span>;
  }
  if (state === 'active') {
    return <span className="onboarding-dot onboarding-dot-active" />;
  }
  return <span className="onboarding-dot onboarding-dot-idle" />;
}

function TopProgress({ step, isAgentRoute }: { step: number; isAgentRoute: boolean }) {
  if (isAgentRoute) {
    return (
      <div className="hidden min-w-[520px] max-w-2xl flex-1 items-center justify-center gap-2 md:flex">
        {AGENT_STEPS.map((label, index) => (
          <div key={label} className="flex min-w-0 items-center gap-2">
            <div className="flex flex-col items-center gap-1">
              <span className={`onboarding-agent-step ${index === 0 ? 'onboarding-agent-step-active' : ''}`}>{index + 1}</span>
              <span className={`text-[11px] ${index === 0 ? 'text-blue-700' : 'text-[var(--text-muted)]'}`}>{label}</span>
            </div>
            {index < AGENT_STEPS.length - 1 && <span className="h-px w-16 bg-[var(--border-secondary)]" />}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="hidden min-w-[440px] flex-1 flex-col items-center justify-center gap-2 md:flex">
      <div className="flex items-center gap-2">
        {SETUP_STEPS.map((_, index) => {
          const current = index + 1;
          const dotState = current < step ? 'done' : current === step ? 'active' : 'idle';
          return (
            <div key={current} className="flex items-center gap-2">
              <CircleState state={dotState} />
              {current < SETUP_STEPS.length && <span className={`h-px w-10 ${current < step ? 'bg-emerald-400' : 'bg-[var(--border-secondary)]'}`} />}
            </div>
          );
        })}
      </div>
      <div className="text-xs font-medium text-[var(--text-muted)]">{progressLabel(step)}</div>
    </div>
  );
}

function OptionCard({
  title,
  description,
  selected,
  chip,
  icon,
  onClick,
}: {
  title: string;
  description: string;
  selected: boolean;
  chip: string;
  icon: IconName;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`onboarding-option-card ${selected ? 'onboarding-option-card-selected' : ''}`}
      aria-pressed={selected}
    >
      <span className="onboarding-icon-tile">
        <Icon name={icon} className="h-8 w-8" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-3">
          <span className="text-lg font-semibold text-[var(--text-primary)]">{title}</span>
          <StatusChip tone={selected ? 'active' : 'neutral'}>{chip}</StatusChip>
        </span>
        <span className="mt-2 block text-sm text-[var(--text-muted)]">{description}</span>
      </span>
      <span className={`onboarding-radio ${selected ? 'onboarding-radio-selected' : ''}`}>
        {selected ? <Icon name="check" className="h-4 w-4" /> : null}
      </span>
    </button>
  );
}

function TimelineCard({ step }: { step: number }) {
  return (
    <aside className="onboarding-card p-6">
      <h2 className="text-base font-semibold text-[var(--text-primary)]">What happens next</h2>
      <p className="mt-2 text-sm text-[var(--text-muted)]">We will guide you through these steps.</p>
      <div className="mt-6 space-y-5">
        {SETUP_STEPS.slice(1).map((item, index) => {
          const itemStep = index + 2;
          const status = itemStep < step ? 'done' : itemStep === step ? 'active' : 'idle';
          return (
            <div key={item.label} className="relative flex gap-4">
              {index < SETUP_STEPS.slice(1).length - 1 && <span className="absolute left-[15px] top-8 h-8 border-l border-dashed border-[var(--border-secondary)]" />}
              <CircleState state={status} />
              <div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">{item.label === 'Workspace' ? 'Workspace profile' : item.label}</div>
                <div className="mt-1 text-xs text-[var(--text-muted)]">{item.detail}</div>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function ThemePreview({ theme }: { theme: AppTheme }) {
  return (
    <div className={`theme-preview-window theme-preview-${theme}`}>
      <div className="theme-preview-header">
        <span>⚡</span>
        <span>Entity</span>
        <span className="ml-auto">☰</span>
      </div>
      <div className="theme-preview-body">
        <div className="theme-preview-nav">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="theme-preview-grid">
          <span />
          <span />
          <span />
          <span className="theme-preview-chart" />
        </div>
      </div>
    </div>
  );
}

function IconListItem({ icon, title, detail }: { icon: IconName; title: string; detail: string }) {
  return (
    <div className="onboarding-list-item">
      <span className="onboarding-small-icon"><Icon name={icon} className="h-5 w-5" /></span>
      <div>
        <div className="text-sm font-semibold text-[var(--text-primary)]">{title}</div>
        <div className="mt-1 text-xs text-[var(--text-muted)]">{detail}</div>
      </div>
    </div>
  );
}

export default function OnboardingFlow({
  apiBase = '',
  routeToken,
  userProfile,
  appTheme,
  onThemeChange,
  onProfileSave,
  onComplete,
}: OnboardingFlowProps) {
  const [state, setState] = useState<OnboardingState>({ ...DEFAULT_STATE, selectedTheme: appTheme });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentSession, setAgentSession] = useState<AgentSession | null>(null);
  const [sourceStatus, setSourceStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [modelOptions, setModelOptions] = useState<ChatModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState({
    displayName: userProfile.displayName,
    handle: userProfile.handle,
    avatarUrl: userProfile.avatarUrl,
    workspaceName: 'Entity Workspace',
    publicUrl: typeof window === 'undefined' ? 'http://localhost:3000' : window.location.origin,
    sourcePath: '',
    githubUrl: '',
  });

  const isAgentRoute = Boolean(routeToken);
  const step = isAgentRoute ? 6 : state.currentStep;

  const patchState = useCallback(async (patch: Partial<OnboardingState>) => {
    setState((current) => ({ ...current, ...patch }));
    try {
      const res = await fetch(apiPath(apiBase, '/api/onboarding/state'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const saved = await res.json() as OnboardingState;
        setState(normalizeLoadedState(saved));
      }
    } catch {
      // Keep the UI responsive; completion will retry persistence.
    }
  }, [apiBase]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(apiPath(apiBase, '/api/onboarding/state'));
        if (!res.ok) throw new Error(`state ${res.status}`);
        const loaded = normalizeLoadedState(await res.json() as OnboardingState);
        if (!cancelled) {
          setState(loaded);
          onThemeChange(loaded.selectedTheme);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load onboarding state');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [apiBase, onThemeChange]);

  useEffect(() => {
    if (!routeToken) return;
    const token = routeToken;
    let cancelled = false;
    async function loadManifest() {
      try {
        const res = await fetch(apiPath(apiBase, `/api/onboarding/agent-session/${encodeURIComponent(token)}/manifest`));
        if (!res.ok) return;
        const manifest = await res.json() as { checklist?: AgentSession['progress']; expiresAt?: string };
        if (!cancelled) {
          setAgentSession({
            token,
            setupUrl: `/onboard/agent/${token}`,
            expiresAt: manifest.expiresAt ?? '',
            progress: manifest.checklist ?? [],
          });
        }
      } catch {
        // The UI still shows the copied route token so humans can recover.
      }
    }
    void loadManifest();
    return () => { cancelled = true; };
  }, [apiBase, routeToken]);

  useEffect(() => {
    let cancelled = false;
    async function loadModels() {
      setModelsLoading(true);
      try {
        const res = await fetch(apiPath(apiBase, '/api/chat/models?agent=ada'));
        if (!res.ok) return;
        const payload = await res.json() as { models?: unknown[]; agents?: Record<string, { models?: unknown[] }>; defaultModel?: string };
        const explicitModels = Array.isArray(payload.models)
          ? payload.models.map(normalizeModel).filter(Boolean) as ChatModelOption[]
          : [];
        const perAgentModels = payload.agents
          ? Object.values(payload.agents).flatMap((entry) => Array.isArray(entry.models) ? entry.models : []).map(normalizeModel).filter(Boolean) as ChatModelOption[]
          : [];
        const seen = new Set<string>();
        const nextModels = [...explicitModels, ...perAgentModels].filter((model) => {
          if (seen.has(model.id)) return false;
          seen.add(model.id);
          return true;
        });
        if (!cancelled) setModelOptions(nextModels);
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    }
    void loadModels();
    return () => { cancelled = true; };
  }, [apiBase]);

  const selectedPreset = useMemo(
    () => PRESETS.find((preset) => preset.id === state.starterPreset) ?? PRESETS[1],
    [state.starterPreset],
  );
  const selectedPresetModules = selectedPreset.modules.map((module) => module.label);
  const selectedDefaultModel = useMemo(
    () => modelOptions.find((model) => model.id === state.defaultAiModel || model.name === state.defaultAiModel) ?? null,
    [modelOptions, state.defaultAiModel],
  );
  const cloudModelOptions = useMemo(
    () => modelOptions.filter((model) => !model.isLocal),
    [modelOptions],
  );
  const localModelOptions = useMemo(
    () => modelOptions.filter((model) => model.isLocal),
    [modelOptions],
  );
  const defaultModelLabel = formatModelLabel(selectedDefaultModel?.name ?? state.defaultAiModel);

  useEffect(() => {
    if (modelOptions.length === 0 || selectedDefaultModel) return;
    const preferred = modelOptions.find((model) => model.id.includes('gpt-5.5') || model.name.toLowerCase().includes('gpt-5.5')) ?? modelOptions[0];
    if (!preferred) return;
    void patchState({ defaultAiProvider: 'codex', defaultAiModel: preferred.id });
  }, [modelOptions, patchState, selectedDefaultModel]);

  const continueNext = async () => {
    if (state.currentStep === 2) {
      onProfileSave({
        displayName: profileDraft.displayName,
        handle: profileDraft.handle,
        avatarUrl: profileDraft.avatarUrl,
      });
      await fetch(apiPath(apiBase, '/api/settings/config/runtime'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: { displayName: profileDraft.workspaceName, ownerName: profileDraft.displayName },
          server: { publicBaseUrl: profileDraft.publicUrl },
        }),
      }).catch(() => undefined);
    }

    await patchState({ currentStep: Math.min(step + 1, 7) });
  };

  const complete = async (skipped = false) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(apiPath(apiBase, '/api/onboarding/complete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...state, skipped }),
      });
      if (!res.ok) throw new Error(`complete ${res.status}`);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete onboarding');
    } finally {
      setSaving(false);
    }
  };

  const createAgentSession = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(apiPath(apiBase, '/api/onboarding/agent-session'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: { ...state, mode: 'agent' } }),
      });
      if (!res.ok) throw new Error(`agent-session ${res.status}`);
      const created = await res.json() as AgentSession;
      setAgentSession(created);
      await patchState({ mode: 'agent', firstAgentMode: 'invite' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create setup link');
    } finally {
      setSaving(false);
    }
  };

  const copyText = async (text: string) => {
    await navigator.clipboard?.writeText(text).catch(() => undefined);
  };

  const testSource = async () => {
    setSourceStatus('testing');
    try {
      if (state.firstSourceMode === 'skip') {
        setSourceStatus('ok');
        return;
      }
      const sourceValue = state.firstSourceMode === 'github' ? profileDraft.githubUrl.trim() : profileDraft.sourcePath.trim();
      if (!sourceValue) throw new Error('source path required');
      const payload = state.firstSourceMode === 'github'
        ? { displayName: 'GitHub source', type: 'github', baseUrl: profileDraft.githubUrl, icon: '⚡' }
        : { displayName: 'Workspace source', type: 'local', basePath: sourceValue, icon: '⚡' };
      const res = await fetch(apiPath(apiBase, '/api/sources'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok && res.status !== 409) throw new Error(`source ${res.status}`);
      setSourceStatus('ok');
    } catch {
      setSourceStatus('error');
    }
  };

  const agentSetupUrl = agentSession ? setupUrl(agentSession.setupUrl) : routeToken ? setupUrl(`/onboard/agent/${routeToken}`) : '';
  const activeToken = agentSession?.token ?? routeToken;
  const manifestUrl = activeToken ? absoluteUrl(apiPath(apiBase, `/api/onboarding/agent-session/${encodeURIComponent(activeToken)}/manifest`)) : '';
  const bundleUrl = activeToken ? absoluteUrl(apiPath(apiBase, `/api/onboarding/agent-session/${encodeURIComponent(activeToken)}/bundle`)) : '';
  const skillUrl = activeToken ? absoluteUrl(apiPath(apiBase, `/api/onboarding/agent-session/${encodeURIComponent(activeToken)}/skill`)) : '';
  const progressUrl = activeToken ? absoluteUrl(apiPath(apiBase, `/api/onboarding/agent-session/${encodeURIComponent(activeToken)}/progress`)) : '';
  const entityOrigin = typeof window === 'undefined' ? profileDraft.publicUrl : window.location.origin;
  const firstSourceValue = state.firstSourceMode === 'github' ? profileDraft.githubUrl.trim() : profileDraft.sourcePath.trim();
  const canTestSource = state.firstSourceMode === 'skip' || firstSourceValue.length > 0;
  const agentPrompt = activeToken ? [
    'You are setting up Entity for this user. Complete only the onboarding setup described below.',
    '',
    'Session',
    `- Setup URL: ${agentSetupUrl}`,
    `- Manifest URL: ${manifestUrl}`,
    `- Entity MC bundle URL: ${bundleUrl}`,
    `- Entity MC skill URL: ${skillUrl}`,
    `- Progress URL: ${progressUrl}`,
    '',
    'Selected setup',
    `- Workspace: ${profileDraft.workspaceName}`,
    `- Workspace mode: ${state.workspaceMode === 'private' ? 'Private local' : state.workspaceMode}`,
    `- Theme: ${state.selectedTheme}`,
    `- Default AI: Codex / ${defaultModelLabel}`,
    `- Starter preset: ${selectedPreset.title}`,
    `- First agent: ${state.firstAgentMode}`,
    `- First source: ${state.firstSourceMode}`,
    '',
    'Instructions',
    '1. Open the setup URL or fetch the manifest URL. Treat the manifest as the source of truth.',
    '2. Download the Entity MC bundle or skill from the URLs above.',
    `3. Install the skill with: ./install.sh --entity-url ${entityOrigin} --token <token-from-manifest>`,
    `4. Verify the skill with: ./verify.sh --entity-url ${entityOrigin} --token <token-from-manifest>`,
    '5. Apply the selected workspace setup. Keep optional advanced settings for Admin unless the user explicitly asks.',
    '6. Report progress through the manifest progress endpoint after each meaningful step.',
    '7. Stop when the workspace is configured, the skill verifies, and the setup checklist is complete.',
    '',
    'Guardrails',
    '- Do not commit or print the raw token except where a setup command requires it.',
    '- Do not configure Documents API, Voice/TTS, Task Master, OpenClaw, advanced scopes, or unrelated modules during onboarding.',
    '- Do not overwrite user files, secrets, databases, or local configuration unless the manifest explicitly requires it.',
    '- If a step fails, report the exact blocker and leave the workspace in a recoverable state.',
    '',
    'Final response',
    '- Summarize what you configured.',
    '- List any Admin follow-up items.',
    '- Confirm whether Entity MC verification passed.',
  ].join('\n') : '';

  if (loading) {
    return (
      <div className="entity-onboarding-shell fixed inset-0 flex items-center justify-center text-[var(--text-secondary)]">
        <div className="onboarding-card border border-[var(--border-secondary)] p-6 text-sm">Loading Entity setup...</div>
      </div>
    );
  }

  const renderActions = () => (
    <div className="onboarding-actions">
      <button
        type="button"
        className="onboarding-action-secondary"
        onClick={() => isAgentRoute ? undefined : void patchState({ currentStep: Math.max(state.currentStep - 1, 1) })}
        disabled={isAgentRoute || state.currentStep <= 1}
      >
        <Icon name="arrow" className="h-4 w-4 rotate-180" />
        Back
      </button>
      <div className="flex flex-wrap gap-3">
        {state.mode === 'agent' && step === 1 && (
          <button
            type="button"
            className="onboarding-action-secondary"
            onClick={async () => {
              await createAgentSession();
              await patchState({ currentStep: 6 });
            }}
          >
            Create agent setup link
          </button>
        )}
        {step < 7 && !isAgentRoute && (
          <button type="button" className="onboarding-action-primary" onClick={() => void continueNext()}>
            Continue
            <Icon name="arrow" className="h-5 w-5" />
          </button>
        )}
        {step === 7 && (
          <button type="button" className="onboarding-action-primary" onClick={() => void complete(false)} disabled={saving}>
            {saving ? 'Saving...' : 'Enter workspace'}
            <Icon name="arrow" className="h-5 w-5" />
          </button>
        )}
        {isAgentRoute && (
          <button type="button" className="onboarding-action-secondary" onClick={() => { window.location.href = '/onboarding'; }}>
            I will set up manually
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="entity-onboarding-shell fixed inset-0 flex h-screen w-screen max-w-[100vw] flex-col overflow-hidden bg-[var(--bg-primary)] text-[var(--text-secondary)]">
      <header className="onboarding-topbar">
        <div className="flex items-center gap-3 text-2xl font-semibold text-[var(--text-primary)]">
          <span className="text-3xl text-amber-400">⚡</span>
          Entity
        </div>
        <TopProgress step={step} isAgentRoute={isAgentRoute} />
        <div className="flex items-center gap-3">
          <button type="button" className="onboarding-help-button">
            <Icon name="help" className="h-5 w-5" />
            Help
          </button>
          {!isAgentRoute && (
            <button type="button" onClick={() => void complete(true)} className="onboarding-action-secondary px-4 py-2" disabled={saving}>
              Skip setup
            </button>
          )}
          {isAgentRoute && (
            <button type="button" onClick={() => { window.location.href = '/onboarding'; }} className="onboarding-action-secondary px-4 py-2">
              Cancel
            </button>
          )}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto px-5 py-6 md:px-8">
        <div className="mx-auto max-w-[1420px]">
          {error && <div className="mb-4 rounded-xl border border-[var(--error)]/40 bg-[var(--surface-error)] p-3 text-sm text-[var(--error)]">{error}</div>}

          {step === 1 && (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
              <section className="onboarding-card p-6 md:p-8">
                <h1 className="text-3xl font-semibold text-[var(--text-primary)]">Set up Entity</h1>
                <p className="mt-2 text-base text-[var(--text-muted)]">Choose the path that matches how you want this workspace configured.</p>
                <div className="mt-6 grid gap-4">
                  {SETUP_OPTIONS.map((option) => (
                    <OptionCard
                      key={option.id}
                      title={option.title}
                      chip={option.chip}
                      icon={option.icon}
                      selected={state.mode === option.id}
                      description={option.description}
                      onClick={() => void patchState({ mode: option.id })}
                    />
                  ))}
                </div>
              </section>
              <TimelineCard step={step} />
              {renderActions()}
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
              <section className="onboarding-card p-8 md:p-10">
                <h1 className="text-3xl font-semibold text-[var(--text-primary)]">Workspace basics</h1>
                <p className="mt-3 text-base text-[var(--text-muted)]">Name the workspace and choose how it should start.</p>
                <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.25fr)]">
                  <div className="grid gap-5">
                    {[
                      { label: 'Your name', key: 'displayName', icon: 'user' as IconName, hint: '' },
                      { label: 'Handle', key: 'handle', icon: 'agent' as IconName, hint: 'This is how you will be mentioned by agents.' },
                      { label: 'Workspace name', key: 'workspaceName', icon: 'database' as IconName, hint: 'A friendly name for your workspace.' },
                      { label: 'Public URL', key: 'publicUrl', icon: 'globe' as IconName, hint: 'This is the URL agents use to reach Entity.' },
                    ].map((field) => (
                      <label key={field.key} className="grid gap-2 text-sm font-semibold text-[var(--text-primary)]">
                        {field.label}{field.key === 'handle' ? <span className="font-normal text-[var(--text-muted)]"> (optional)</span> : null}
                        <span className="onboarding-input-wrap">
                          <Icon name={field.icon} className="h-5 w-5 text-[var(--text-muted)]" />
                          <input
                            value={profileDraft[field.key as keyof typeof profileDraft]}
                            onChange={(event) => setProfileDraft((prev) => ({ ...prev, [field.key]: event.target.value }))}
                            className="min-w-0 flex-1 bg-transparent text-base outline-none"
                          />
                        </span>
                        {field.hint ? <span className="text-xs font-normal text-[var(--text-muted)]">{field.hint}</span> : null}
                      </label>
                    ))}
                  </div>
                  <div className="grid content-start gap-7">
                    <div>
                      <div className="text-sm font-semibold text-[var(--text-primary)]">Workspace avatar</div>
                      <div className="mt-1 text-sm text-[var(--text-muted)]">This avatar represents your workspace.</div>
                      <div className="mt-5 flex flex-wrap gap-4">
                        {(['spark', 'palette', 'bot', 'database'] as IconName[]).map((icon, index) => (
                          <button key={icon} type="button" className={`onboarding-avatar-option ${index === 0 ? 'onboarding-avatar-option-selected' : ''}`}>
                            <Icon name={icon} className="h-8 w-8" />
                            {index === 0 ? <span className="onboarding-avatar-check"><Icon name="check" className="h-3.5 w-3.5" /></span> : null}
                          </button>
                        ))}
                        <button type="button" className="onboarding-avatar-option text-sm">
                          <Icon name="upload" className="h-6 w-6" />
                          Upload
                        </button>
                      </div>
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-[var(--text-primary)]">Workspace mode</div>
                      <div className="mt-1 text-sm text-[var(--text-muted)]">Choose how this workspace will be used.</div>
                      <div className="mt-5 grid gap-3 md:grid-cols-2">
                        {WORKSPACE_MODES.map((mode) => (
                          <button
                            key={mode.id}
                            type="button"
                            onClick={() => { if (!mode.disabled) void patchState({ workspaceMode: mode.id }); }}
                            disabled={mode.disabled}
                            className={`onboarding-stage-card ${state.workspaceMode === mode.id ? 'onboarding-stage-card-selected' : ''} ${mode.disabled ? 'onboarding-stage-card-disabled' : ''}`}
                          >
                            <span className="onboarding-small-icon"><Icon name={mode.icon} className="h-5 w-5" /></span>
                            <span className="mt-4 flex items-center gap-2 text-base font-semibold text-[var(--text-primary)]">
                              {mode.title}
                              {mode.badge ? <StatusChip>{mode.badge}</StatusChip> : null}
                            </span>
                            <span className="mt-2 block text-sm text-[var(--text-muted)]">{mode.detail}</span>
                            {state.workspaceMode === mode.id ? <span className="onboarding-card-check"><Icon name="check" className="h-4 w-4" /></span> : null}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[var(--border-secondary)] bg-white/50 p-4 text-sm text-[var(--text-muted)]">
                      <Icon name="info" className="mr-2 inline h-4 w-4 text-blue-500" />
                      Advanced paths and tokens can be configured later in Admin.
                    </div>
                  </div>
                </div>
              </section>
              <aside className="onboarding-card p-5">
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">Recommended defaults</h2>
                <p className="mt-2 text-sm text-[var(--text-muted)]">We will configure these for you.</p>
                <div className="mt-6 grid gap-4">
                  <IconListItem icon="palette" title="Aurora theme" detail="Clean, modern, and easy on the eyes." />
                  <IconListItem icon="code" title="Codex default" detail="GPT-5.5 model selected." />
                  <IconListItem icon="users" title="Multi agents preset" detail="Good starting modules and permissions." />
                  <IconListItem icon="database" title="First source optional" detail="You can add data sources after setup." />
                </div>
              </aside>
              {renderActions()}
            </div>
          )}

          {step === 3 && (
            <div className="grid gap-6">
              <section className="onboarding-card p-8">
                <h1 className="text-3xl font-semibold text-[var(--text-primary)]">Choose a theme</h1>
                <p className="mt-3 text-base text-[var(--text-muted)]">Pick the look for your workspace. You can change it later in Admin.</p>
                <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                  {THEMES.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      onClick={() => { onThemeChange(theme.id); void patchState({ selectedTheme: theme.id }); }}
                      className={`onboarding-theme-card ${state.selectedTheme === theme.id ? 'onboarding-theme-card-selected' : ''}`}
                    >
                      <div className="text-left text-lg font-semibold text-[var(--text-primary)]">{theme.title}</div>
                      <ThemePreview theme={theme.id} />
                      <div className="mt-3 text-left text-sm text-[var(--text-muted)]">{theme.hint}</div>
                      {state.selectedTheme === theme.id ? <span className="onboarding-card-check"><Icon name="check" className="h-4 w-4" /></span> : null}
                    </button>
                  ))}
                </div>
              </section>
              {renderActions()}
            </div>
          )}

          {step === 4 && (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
              <section className="onboarding-card p-8 md:p-10">
                <h1 className="text-3xl font-semibold text-[var(--text-primary)]">Choose your default AI</h1>
                <p className="mt-3 text-base text-[var(--text-muted)]">Entity uses this for setup help and recommended agent defaults. You can change it later.</p>
                <div className="relative mt-8 grid gap-4">
                  {PROVIDERS.map((provider) => {
                    const selected = state.defaultAiProvider === provider.id;
                    const disabled = provider.id !== 'codex';
                    return (
                      <button
                        key={provider.id}
                        type="button"
                        onClick={() => { if (!disabled) void patchState({ defaultAiProvider: provider.id }); }}
                        disabled={disabled}
                        className={`onboarding-provider-row ${selected ? 'onboarding-provider-row-selected' : ''} ${disabled ? 'onboarding-provider-row-disabled' : ''}`}
                      >
                        <span className={`onboarding-provider-icon onboarding-provider-icon-${provider.tone}`}>
                          <Icon name={provider.icon} className="h-7 w-7" />
                        </span>
                        <span className="flex-1 text-left">
                          <span className="block text-xl font-semibold text-[var(--text-primary)]">{provider.title}</span>
                          {disabled ? <span className="mt-1 block text-xs text-[var(--text-muted)]">Configure later in Admin</span> : null}
                        </span>
                        {provider.id === 'codex' ? (
                          <span
                            role="button"
                            tabIndex={0}
                            className="onboarding-model-select"
                            onClick={(event) => {
                              event.stopPropagation();
                              setModelMenuOpen((open) => !open);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                event.stopPropagation();
                                setModelMenuOpen((open) => !open);
                              }
                            }}
                          >
                            {modelsLoading ? 'Loading models' : defaultModelLabel}
                            <span className="text-sm">{modelMenuOpen ? '⌃' : '⌄'}</span>
                          </span>
                        ) : null}
                        <span className={`onboarding-radio ${selected ? 'onboarding-radio-selected' : ''}`}>{selected ? <span /> : null}</span>
                      </button>
                    );
                  })}
                  {state.defaultAiProvider === 'codex' && modelMenuOpen && (
                    <div className="onboarding-model-menu">
                      <div className="flex items-center gap-3 border-b border-[var(--border-secondary)] px-4 py-3 text-sm text-[var(--text-muted)]">
                        <Icon name="search" className="h-4 w-4" />
                        Models from the Entity model registry
                      </div>
                      {modelsLoading && <div className="px-4 py-4 text-sm text-[var(--text-muted)]">Loading available models...</div>}
                      {!modelsLoading && modelOptions.length === 0 && <div className="px-4 py-4 text-sm text-[var(--text-muted)]">No models returned yet. You can set this later in Admin.</div>}
                      {[
                        ['Cloud Models', cloudModelOptions],
                        ['Local Models', localModelOptions],
                      ].map(([label, models]) => (
                        (models as ChatModelOption[]).length > 0 ? (
                          <div key={label as string}>
                            <div className="px-4 py-3 text-xs font-semibold text-[var(--text-muted)]">{label as string}</div>
                            {(models as ChatModelOption[]).map((model) => (
                              <button
                                key={model.id}
                                type="button"
                                onClick={() => {
                                  setModelMenuOpen(false);
                                  void patchState({ defaultAiProvider: 'codex', defaultAiModel: model.id });
                                }}
                                className={`flex w-full items-center gap-3 rounded-lg px-4 py-2 text-left text-sm ${selectedDefaultModel?.id === model.id ? 'bg-blue-50 text-blue-700' : 'text-[var(--text-primary)] hover:bg-white/60'}`}
                              >
                                <span className="w-4">{selectedDefaultModel?.id === model.id ? '✓' : ''}</span>
                                <span className="min-w-0">
                                  <span className="block truncate font-medium">{formatModelLabel(model.name)}</span>
                                  <span className="block truncate text-xs text-[var(--text-muted)]">{model.provider}{model.source ? ` · ${model.source}` : ''}</span>
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : null
                      ))}
                    </div>
                  )}
                </div>
              </section>
              <aside className="onboarding-card p-8">
                <h2 className="text-xl font-semibold text-[var(--text-primary)]">Readiness</h2>
                <p className="mt-2 text-sm text-[var(--text-muted)]">We will check a few things before you continue.</p>
                <div className="mt-8 divide-y divide-[var(--border-secondary)]">
                  {[
                    ['Provider selected', 'Codex'],
                    ['Model available', selectedDefaultModel ? `${selectedDefaultModel.name} is available` : 'Model registry connected'],
                  ].map(([title, detail]) => (
                    <div key={title} className="flex gap-4 py-5 first:pt-0">
                      <span className="onboarding-success-icon"><Icon name="check" className="h-4 w-4" /></span>
                      <div>
                        <div className="font-semibold text-[var(--text-primary)]">{title}</div>
                        <div className="mt-1 text-sm text-[var(--text-muted)]">{detail}</div>
                      </div>
                    </div>
                  ))}
                  <div className="flex gap-4 py-5">
                    <span className="onboarding-warning-icon"><Icon name="warning" className="h-4 w-4" /></span>
                    <div className="text-sm text-[var(--text-muted)]">API keys and other providers can be configured later in Admin.</div>
                  </div>
                </div>
              </aside>
              {renderActions()}
            </div>
          )}

          {step === 5 && (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
              <section className="onboarding-card p-8">
                <div className="flex items-start gap-6">
                  <span className="onboarding-icon-tile"><Icon name="gear" className="h-8 w-8" /></span>
                  <div>
                    <h1 className="text-3xl font-semibold text-[var(--text-primary)]">Choose a starter setup</h1>
                    <p className="mt-3 text-base text-[var(--text-muted)]">Pick a simple preset. You can fine tune every module later in Admin.</p>
                  </div>
                </div>
                <div className="mt-8 grid gap-5 lg:grid-cols-2">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => void patchState({ starterPreset: preset.id })}
                      className={`onboarding-preset-card ${state.starterPreset === preset.id ? 'onboarding-preset-card-selected' : ''}`}
                    >
                      <div className="flex items-start gap-4">
                        <span className="onboarding-small-icon"><Icon name={preset.icon} className="h-5 w-5" /></span>
                        <div className="text-left">
                          <div className="text-lg font-semibold text-[var(--text-primary)]">{preset.title}</div>
                          <div className="mt-1 text-sm text-[var(--text-muted)]">{preset.description}</div>
                        </div>
                        <span className={`onboarding-radio ml-auto ${state.starterPreset === preset.id ? 'onboarding-radio-selected' : ''}`}>{state.starterPreset === preset.id ? <Icon name="check" className="h-4 w-4" /> : null}</span>
                      </div>
                      <div className="mt-7 border-t border-[var(--border-secondary)] pt-5">
                        <div className="mb-3 text-left text-sm font-semibold text-[var(--text-primary)]">Includes</div>
                        <div className="flex flex-wrap gap-3">
                          {preset.modules.map((module) => (
                            <span key={module.label} className="onboarding-module-chip">
                              <Icon name={module.icon} className="h-4 w-4" />
                              {module.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--border-secondary)] bg-white/45 p-5">
                  <div className="flex items-center gap-4">
                    <span className="onboarding-small-icon"><Icon name="gear" className="h-5 w-5" /></span>
                    <div>
                      <div className="font-semibold text-[var(--text-primary)]">Advanced module toggles</div>
                      <div className="mt-1 text-sm text-[var(--text-muted)]">Enable or disable individual modules.</div>
                    </div>
                  </div>
                  <button type="button" className="onboarding-action-secondary px-4 py-2" disabled>Configure later in Admin</button>
                </div>
              </section>
              <aside className="onboarding-card p-5">
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">Enabled now</h2>
                <div className="mt-4 space-y-2">
                  {selectedPreset.modules.map((module) => <IconListItem key={module.label} icon={module.icon} title={module.label} detail={module.label === 'Tasks' ? 'Track tasks and activity' : module.label === 'Files' ? 'Connect and index data' : module.label === 'Plugins' ? 'Manage plugins and tools' : 'Ready after setup'} />)}
                </div>
                <div className="mt-4 border-t border-[var(--border-secondary)] pt-4">
                  <div className="font-semibold text-[var(--text-primary)]">Later in Admin</div>
                  <div className="mt-3 grid gap-2">
                    {[
                      ['Voice / TTS', 'Voice and audio tools', 'spark' as IconName],
                      ['Task Master', 'Advanced task orchestration', 'check' as IconName],
                      ['Documents API', 'Programmatic document access', 'file' as IconName],
                      ['OpenClaw', 'Embedded crew admin', 'agent' as IconName],
                    ].map(([title, detail, icon]) => <IconListItem key={title as string} icon={icon as IconName} title={title as string} detail={detail as string} />)}
                  </div>
                </div>
              </aside>
              {renderActions()}
            </div>
          )}

          {step === 6 && (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
              <section className="onboarding-card p-8">
                <div className="flex items-start gap-6">
                  <span className="onboarding-icon-tile"><Icon name={isAgentRoute || state.firstAgentMode === 'invite' || agentSession ? 'link' : 'agent'} className="h-8 w-8" /></span>
                  <div>
                    <h1 className="text-3xl font-semibold text-[var(--text-primary)]">{isAgentRoute ? 'Give this setup link to your agent' : 'Add your first agent and source'}</h1>
                    <p className="mt-3 text-base text-[var(--text-muted)]">{isAgentRoute ? 'Your agent can complete setup using recommended defaults or the choices you already made.' : 'You can skip either one and finish setup in Admin later.'}</p>
                  </div>
                </div>
                {isAgentRoute || state.firstAgentMode === 'invite' || agentSession ? (
                  <div className="mt-8 grid gap-5">
                    <div className="onboarding-link-card">
                      <Icon name="link" className="h-6 w-6 text-blue-600" />
                      <div className="min-w-0 flex-1">
                        <code className="block truncate text-lg font-semibold text-blue-700">{agentSetupUrl || 'Create a setup link first'}</code>
                        <div className="mt-2 flex items-center gap-2 text-sm text-[var(--text-muted)]">
                          <Icon name="key" className="h-4 w-4" />
                          Link expires in 30 minutes
                        </div>
                      </div>
                      <button type="button" className="onboarding-action-secondary px-4 py-2" onClick={() => void copyText(agentSetupUrl)} disabled={!agentSetupUrl}>
                        <Icon name="copy" className="h-4 w-4" />
                        Copy
                      </button>
                    </div>
                    <div className="rounded-2xl border border-[var(--border-secondary)] bg-white/45 p-5">
                      <div className="mb-4 flex items-center gap-3 text-lg font-semibold text-[var(--text-primary)]">
                        <span className="onboarding-small-icon"><Icon name="code" className="h-5 w-5" /></span>
                        Agent prompt
                      </div>
                      {agentPrompt ? (
                        <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl border border-[var(--border-secondary)] bg-white/60 p-5 font-mono text-sm leading-7 text-[var(--text-primary)]">{agentPrompt}</pre>
                      ) : (
                        <div className="rounded-xl border border-dashed border-[var(--border-secondary)] bg-white/45 p-5 text-sm leading-6 text-[var(--text-muted)]">
                          Create a setup link first. Entity will generate a copyable agent prompt with the setup URL, manifest, Entity MC bundle, selected setup choices, and completion rules.
                        </div>
                      )}
                      <div className="mt-4 flex flex-wrap justify-between gap-3">
                        <button type="button" className="onboarding-action-secondary px-4 py-2" onClick={() => void copyText(agentPrompt)} disabled={!agentPrompt}>
                          <Icon name="copy" className="h-4 w-4" />
                          Copy prompt
                        </button>
                        {activeToken ? (
                          <a className="onboarding-action-secondary px-4 py-2" href={apiPath(apiBase, `/api/onboarding/agent-session/${encodeURIComponent(activeToken)}/bundle`)}>
                            <Icon name="download" className="h-4 w-4" />
                            Download Entity MC bundle
                          </a>
                        ) : null}
                        {!agentSession && !routeToken ? (
                          <button type="button" className="onboarding-action-primary" onClick={() => void createAgentSession()} disabled={saving}>
                            Create setup link
                            <Icon name="arrow" className="h-5 w-5" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-8 grid gap-6 lg:grid-cols-2">
                    <div className="rounded-2xl border border-[var(--border-secondary)] bg-white/50 p-5">
                      <div className="text-lg font-semibold text-[var(--text-primary)]">First agent</div>
                      <div className="mt-4 grid gap-3">
                        {[
                          ['assistant', 'Use local assistant', 'agent' as IconName, false],
                          ['invite', 'Invite setup agent', 'link' as IconName, false],
                          ['manual', 'Add manually in Admin', 'user' as IconName, true],
                          ['skip', 'Skip for now', 'arrow' as IconName, false],
                        ].map(([id, label, icon, disabled]) => (
                          <button
                            key={id as string}
                            type="button"
                            className={`onboarding-choice-row ${state.firstAgentMode === id ? 'onboarding-choice-row-selected' : ''} ${disabled ? 'onboarding-choice-row-disabled' : ''}`}
                            disabled={Boolean(disabled)}
                            onClick={() => { if (!disabled) void patchState({ firstAgentMode: id as FirstAgentMode }); }}
                          >
                            <span className="onboarding-small-icon"><Icon name={icon as IconName} className="h-5 w-5" /></span>
                            {label as string}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-[var(--border-secondary)] bg-white/50 p-5">
                      <div className="text-lg font-semibold text-[var(--text-primary)]">First file source</div>
                      <div className="mt-4 grid gap-3">
                        {[
                          ['current-folder', 'Current project folder', 'folder' as IconName],
                          ['github', 'GitHub repo', 'code' as IconName],
                          ['skip', 'Skip for now', 'arrow' as IconName],
                        ].map(([id, label, icon]) => (
                          <button key={id as string} type="button" className={`onboarding-choice-row ${state.firstSourceMode === id ? 'onboarding-choice-row-selected' : ''}`} onClick={() => void patchState({ firstSourceMode: id as FirstSourceMode })}>
                            <span className="onboarding-small-icon"><Icon name={icon as IconName} className="h-5 w-5" /></span>
                            {label as string}
                          </button>
                        ))}
                        {state.firstSourceMode !== 'skip' && (
                          <span className="onboarding-input-wrap mt-2">
                            <Icon name={state.firstSourceMode === 'github' ? 'code' : 'folder'} className="h-5 w-5 text-[var(--text-muted)]" />
                            <input
                              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                              value={state.firstSourceMode === 'github' ? profileDraft.githubUrl : profileDraft.sourcePath}
                              onChange={(event) => setProfileDraft((prev) => state.firstSourceMode === 'github' ? { ...prev, githubUrl: event.target.value } : { ...prev, sourcePath: event.target.value })}
                            />
                          </span>
                        )}
                        <button type="button" onClick={() => void testSource()} disabled={!canTestSource || sourceStatus === 'testing'} className="onboarding-action-secondary mt-2 justify-center px-4 py-2 disabled:cursor-not-allowed disabled:opacity-50">
                          {sourceStatus === 'testing' ? 'Testing...' : 'Test source'}
                        </button>
                        {!canTestSource && <StatusChip tone="neutral">Enter a source path or choose skip</StatusChip>}
                        {sourceStatus === 'ok' && <StatusChip tone="success">Reachable</StatusChip>}
                        {sourceStatus === 'error' && <StatusChip tone="warning">Needs Admin follow-up</StatusChip>}
                      </div>
                    </div>
                  </div>
                )}
              </section>
              <aside className="grid gap-5">
                <div className="onboarding-card p-6">
                  <h2 className="text-lg font-semibold text-[var(--text-primary)]">{isAgentRoute || agentSession ? 'Live setup timeline' : 'Admin can do later'}</h2>
                  <div className="mt-5 space-y-4">
                    {(agentSession?.progress ?? [
                      { id: 'docs', label: 'Documents API', status: 'pending' as const },
                      { id: 'plugins', label: 'Plugin installs', status: 'pending' as const },
                      { id: 'task-master', label: 'Task Master', status: 'pending' as const },
                      { id: 'voice', label: 'Voice/TTS', status: 'pending' as const },
                    ]).map((item, index) => (
                      <div key={item.id} className="relative flex gap-4">
                        {index < 5 && (isAgentRoute || agentSession) ? <span className="absolute left-[15px] top-8 h-8 border-l border-dashed border-[var(--border-secondary)]" /> : null}
                        <CircleState state={item.status === 'done' ? 'done' : 'idle'} />
                        <div>
                          <div className="text-sm font-semibold text-[var(--text-primary)]">{item.label}</div>
                          <div className="mt-1 text-xs text-[var(--text-muted)]">{item.status === 'done' ? 'Just now' : 'Pending'}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {(isAgentRoute || agentSession) && (
                  <div className="onboarding-card p-6">
                    <div className="flex items-center gap-3 text-lg font-semibold text-[var(--text-primary)]">
                      <span className="onboarding-small-icon"><Icon name="lock" className="h-5 w-5" /></span>
                      Scoped access
                    </div>
                    <div className="mt-5 grid gap-3 text-sm text-[var(--text-muted)]">
                      <div><Icon name="key" className="mr-2 inline h-4 w-4" />Token: one-time</div>
                      <div><Icon name="lock" className="mr-2 inline h-4 w-4" />Permissions: setup only</div>
                      <div><Icon name="info" className="mr-2 inline h-4 w-4" />Invalid after use or expiry.</div>
                    </div>
                  </div>
                )}
              </aside>
              {renderActions()}
            </div>
          )}

          {step === 7 && (
            <section className="onboarding-card p-8 md:p-10">
              <div className="flex items-start gap-6">
                <span className="onboarding-icon-tile"><Icon name="check" className="h-8 w-8" /></span>
                <div>
                  <h1 className="text-4xl font-semibold text-[var(--text-primary)]">Entity is ready</h1>
                  <p className="mt-3 text-base text-[var(--text-muted)]">You can enter the workspace now and keep configuring advanced settings in Admin.</p>
                </div>
              </div>
              <div className="mt-8 grid gap-4 xl:grid-cols-5">
                {[
                  ['Workspace saved', profileDraft.workspaceName, 'Private local', 'check' as IconName],
                  ['Aurora theme', 'Mint peach glass', 'Selected', 'palette' as IconName],
                  ['Codex default AI', defaultModelLabel, selectedDefaultModel?.provider ?? 'Codex', 'code' as IconName],
                  ['Starter preset', selectedPreset.title, `${selectedPresetModules.length} modules enabled`, 'users' as IconName],
                  ['Source connected', 'Local documents', sourceStatus === 'ok' ? 'Healthy' : 'Optional', 'folder' as IconName],
                ].map(([title, line1, line2, icon]) => (
                  <div key={title as string} className="rounded-2xl border border-[var(--border-secondary)] bg-white/50 p-4">
                    <span className="onboarding-small-icon"><Icon name={icon as IconName} className="h-5 w-5" /></span>
                    <div className="mt-3 font-semibold text-[var(--text-primary)]">{title as string}</div>
                    <div className="mt-1 text-sm text-[var(--text-muted)]">{line1 as string}</div>
                    <div className="text-sm text-[var(--text-muted)]">{line2 as string}</div>
                  </div>
                ))}
              </div>
              <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_390px]">
                <div className="rounded-2xl border border-[var(--border-secondary)] bg-white/45 p-5">
                  <h2 className="text-lg font-semibold text-[var(--text-primary)]">Setup checklist</h2>
                  <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border-secondary)]">
                    {[
                      ['Profile created', 'Workspace identity and access configured'],
                      ['Theme selected', `${state.selectedTheme} theme applied`],
                      ['Default AI selected', `Codex (${defaultModelLabel}) set as default`],
                      ['Starter modules enabled', 'Essential modules are ready'],
                      ['First agent/source optional', 'At least one agent and source configured'],
                    ].map(([title, detail]) => (
                      <div key={title} className="grid gap-2 border-b border-[var(--border-secondary)] bg-white/45 px-4 py-3 text-sm last:border-b-0 md:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)]">
                        <div className="flex items-center gap-3 font-semibold text-[var(--text-primary)]"><span className="onboarding-success-icon"><Icon name="check" className="h-4 w-4" /></span>{title}</div>
                        <div className="text-[var(--text-muted)]">{detail}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50/70 p-5">
                    <div className="flex items-center gap-3 font-semibold text-amber-800"><Icon name="info" className="h-5 w-5" />Finish later in Admin</div>
                    <p className="mt-2 text-sm text-amber-700">These items are optional and can be configured anytime.</p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      {['Documents API', 'Plugins', 'Voice / TTS', 'Task Master', 'OpenClaw', 'Advanced scopes'].map((item) => <StatusChip key={item} tone="warning">{item}</StatusChip>)}
                    </div>
                  </div>
                </div>
                <aside className="rounded-2xl border border-[var(--border-secondary)] bg-white/50 p-5">
                  <h2 className="text-lg font-semibold text-[var(--text-primary)]">Next steps</h2>
                  <p className="mt-2 text-sm text-[var(--text-muted)]">Choose what you would like to do next.</p>
                  <div className="mt-5 grid gap-3">
                    <button type="button" className="onboarding-action-primary justify-start" onClick={() => void complete(false)}>
                      <Icon name="arrow" className="h-5 w-5" />
                      <span className="text-left">Enter workspace<br /><span className="text-xs font-normal text-white/85">Open your workspace now</span></span>
                    </button>
                    {[
                      ['Continue setup in Admin', 'Configure advanced settings', 'gear' as IconName, false],
                      ['Create first task', 'Available after setup', 'check' as IconName, true],
                      ['Invite another agent', 'Available after setup', 'users' as IconName, true],
                    ].map(([title, detail, icon, disabled]) => (
                      <button
                        key={title as string}
                        type="button"
                        className={`onboarding-next-action ${disabled ? 'onboarding-next-action-disabled' : ''}`}
                        disabled={Boolean(disabled)}
                        onClick={() => {
                          if (disabled) return;
                          window.localStorage?.setItem('entity.sidebar.tab', 'admin');
                          void complete(false);
                        }}
                      >
                        <Icon name={icon as IconName} className="h-5 w-5" />
                        <span className="text-left">
                          <span className="font-semibold">{title as string}</span>
                          <span className="mt-1 block text-xs text-[var(--text-muted)]">{detail as string}</span>
                        </span>
                      </button>
                    ))}
                    <div className="mt-2 rounded-xl border border-[var(--border-secondary)] bg-blue-50/50 p-4 text-sm text-[var(--text-muted)]">
                      <Icon name="info" className="mr-2 inline h-4 w-4 text-blue-600" />
                      You can revisit onboarding from Admin later.
                    </div>
                  </div>
                </aside>
              </div>
              {renderActions()}
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
