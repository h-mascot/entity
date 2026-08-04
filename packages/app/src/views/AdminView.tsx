import { lazy, Suspense, type ComponentProps, type Dispatch, type SetStateAction } from 'react';
import type { DocsTtsSettings } from '../components/MarkdownAudioControls';

const FileSourcesSettings = lazy(() => import('../components/settings/FileSourcesSettings'));
const EffectiveConfigSettings = lazy(() => import('../components/settings/EffectiveConfigSettings'));
const VoiceSettings = lazy(() => import('../components/settings/VoiceSettings'));
const AgentRegistrySettings = lazy(() => import('../components/settings/AgentRegistrySettings'));
const AdminAgentSettingsPanel = lazy(() => import('../components/settings/AdminAgentSettingsPanel'));
const TaskMasterSettings = lazy(() => import('../components/TaskMasterSettings'));
const DocsSettings = lazy(() => import('../components/settings/DocsSettings'));
const PluginAdminPanel = lazy(() => import('../components/plugins/PluginAdminPanel'));
const OfflineAwareChat = lazy(() => import('../components/OfflineAwareChat'));
const UsersAndRolesSettings = lazy(() => import('../components/settings/UsersAndRolesSettings'));
const AdminSettingsForm = lazy(() => import('../components/settings/AdminSettingsForm'));

type AdminSection =
  | 'general'
  | 'profile'
  | 'accessControl'
  | 'businessOnboarding'
  | 'missionControl'
  | 'engineering'
  | 'workplanes'
  | 'strategicRoadmap'
  | 'scopedSearch'
  | 'channels'
  | 'integrations'
  | 'tts'
  | 'plugins'
  | 'agents'
  | 'voice'
  | 'taskMaster'
  | 'enterprise'
  | 'docs';
type AppTheme = 'dark' | 'light' | 'kitz' | 'nebula' | 'aurora' | 'paper';
type DocumentsAuthOrigin = 'dev-runtime' | 'user';
type DocumentsAuth =
  | { kind: 'bearer'; token: string; origin?: DocumentsAuthOrigin }
  | { kind: 'service'; token: string; actorId: string; origin?: DocumentsAuthOrigin }
  | null;
type DocsTtsProvider = DocsTtsSettings['provider'];
type DocsTtsProviderOption = {
  value: DocsTtsProvider;
  label: string;
  hint: string;
};

interface AdminViewProps {
  adminSection: AdminSection;
  enterpriseFrameNonce: number;
  enterpriseFrameSrc: string;
  enterpriseFrameReady: boolean;
  enterpriseFrameTimedOut: boolean;
  setEnterpriseFrameReady: (ready: boolean) => void;
  setEnterpriseFrameTimedOut: (timedOut: boolean) => void;
  setEnterpriseFrameNonce: Dispatch<SetStateAction<number>>;
  loginRequired: boolean;
  toggleLoginRequirement: (required: boolean) => void;
  authSession: { username: string } | null;
  handleLogout: () => void;
  appTheme: AppTheme;
  setAppTheme: (theme: AppTheme) => void;
  apiBase: string;
  fsMultiSourceEnabled: boolean;
  profileNameDraft: string;
  setProfileNameDraft: (value: string) => void;
  profileHandleDraft: string;
  setProfileHandleDraft: (value: string) => void;
  profileAvatarDraft: string;
  setProfileAvatarDraft: (value: string) => void;
  profileEmailDraft: string;
  setProfileEmailDraft: (value: string) => void;
  userProfile: { displayName: string; handle: string; avatarUrl: string; email: string };
  handleUserProfileSave: () => void;
  showArchiveColumn: boolean;
  setShowArchiveColumn: (visible: boolean) => void;
  applyArchiveVisibility: (visible: boolean) => void;
  tasksLoading: boolean;
  taskCount: number;
  reloadTasks: () => Promise<unknown> | unknown;
  connected: boolean;
  syncStatusLabel: string;
  agentsError: string | null;
  isOffline: boolean;
  documentsAuth: DocumentsAuth;
  documentsAuthTokenDraft: string;
  setDocumentsAuthTokenDraft: (value: string) => void;
  documentsAuthKindDraft: 'bearer' | 'service';
  setDocumentsAuthKindDraft: (value: 'bearer' | 'service') => void;
  documentsAuthActorDraft: string;
  setDocumentsAuthActorDraft: (value: string) => void;
  setDocumentsAuth: (auth: DocumentsAuth) => void;
  pushToast: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
  docsTtsSettings: DocsTtsSettings;
  setDocsTtsSettings: Dispatch<SetStateAction<DocsTtsSettings>>;
  onAgentRegistryChanged: () => void;
  onOpenTaskMasterSettings?: () => void;
  onInstallApp?: () => void;
  installPromptAvailable?: boolean;
  pwaInstalled?: boolean;
}

function FeatureSettingsCard({
  title,
  status,
  body,
  bullets,
}: {
  title: string;
  status: string;
  body: string;
  bullets: string[];
}) {
  return (
    <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-[var(--text-primary)]">{title}</div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">{body}</div>
        </div>
        <span className="mc-shell-pill px-2.5 py-1 text-[11px] text-[var(--text-secondary)]">{status}</span>
      </div>
      <ul className="mt-3 space-y-1 text-xs text-[var(--text-muted)]">
        {bullets.map((bullet) => (
          <li key={bullet} className="flex gap-2">
            <span aria-hidden="true">-</span>
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
    </div>
  );
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

function LazyEffectiveConfigSettings(props: { apiBase?: string }) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading settings" />}>
      <EffectiveConfigSettings {...props} />
    </Suspense>
  );
}

function LazyFileSourcesSettings(props: { apiBase?: string; enabled?: boolean }) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading settings" />}>
      <FileSourcesSettings {...props} />
    </Suspense>
  );
}

function LazyAdminSettingsForm(props: ComponentProps<typeof AdminSettingsForm>) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading settings" />}>
      <AdminSettingsForm {...props} />
    </Suspense>
  );
}

function LazyUsersAndRolesSettings(props: { apiBase?: string }) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading users and roles" />}>
      <UsersAndRolesSettings {...props} />
    </Suspense>
  );
}

function LazyOfflineAwareChat(props: { isOffline: boolean }) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading chat status" />}>
      <OfflineAwareChat {...props} />
    </Suspense>
  );
}

function LazyPluginAdminPanel(props: { apiBase?: string }) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading plugins" />}>
      <PluginAdminPanel {...props} />
    </Suspense>
  );
}

function LazyAgentRegistrySettings(props: { apiBase?: string; onRegistryChanged?: () => void }) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading agents" />}>
      <AgentRegistrySettings {...props} />
    </Suspense>
  );
}

function LazyAdminAgentSettingsPanel() {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading agent invite settings" />}>
      <AdminAgentSettingsPanel />
    </Suspense>
  );
}

function LazyVoiceSettings(props: { apiBase?: string }) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading settings" />}>
      <VoiceSettings {...props} />
    </Suspense>
  );
}

function LazyTaskMasterSettings(props: { apiBase: string }) {
  return (
    <Suspense fallback={<LazySurfaceFallback label="Loading Task Master" />}>
      <TaskMasterSettings {...props} />
    </Suspense>
  );
}

export default function AdminView({
  adminSection,
  enterpriseFrameNonce,
  enterpriseFrameSrc,
  enterpriseFrameReady,
  enterpriseFrameTimedOut,
  setEnterpriseFrameReady,
  setEnterpriseFrameTimedOut,
  setEnterpriseFrameNonce,
  loginRequired,
  toggleLoginRequirement,
  authSession,
  handleLogout,
  appTheme,
  setAppTheme,
  apiBase,
  fsMultiSourceEnabled,
  profileNameDraft,
  setProfileNameDraft,
  profileHandleDraft,
  setProfileHandleDraft,
  profileAvatarDraft,
  setProfileAvatarDraft,
  profileEmailDraft,
  setProfileEmailDraft,
  userProfile,
  handleUserProfileSave,
  showArchiveColumn,
  setShowArchiveColumn,
  applyArchiveVisibility,
  tasksLoading,
  taskCount,
  reloadTasks,
  connected,
  syncStatusLabel,
  agentsError,
  isOffline,
  documentsAuth,
  documentsAuthTokenDraft,
  setDocumentsAuthTokenDraft,
  documentsAuthKindDraft,
  setDocumentsAuthKindDraft,
  documentsAuthActorDraft,
  setDocumentsAuthActorDraft,
  setDocumentsAuth,
  pushToast,
  docsTtsSettings,
  setDocsTtsSettings,
  onAgentRegistryChanged,
  onOpenTaskMasterSettings,
  onInstallApp,
  installPromptAvailable = false,
  pwaInstalled = false,
}: AdminViewProps) {
  if (adminSection === 'enterprise') {
    return (
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <iframe
          key={enterpriseFrameNonce}
          src={enterpriseFrameSrc}
          title="Openclaw Admin"
          className="block h-full w-full border-0 bg-[var(--bg-secondary)]"
          loading="eager"
          onLoad={() => {
            setEnterpriseFrameReady(true);
            setEnterpriseFrameTimedOut(false);
          }}
          onError={() => {
            setEnterpriseFrameReady(false);
            setEnterpriseFrameTimedOut(true);
          }}
        />
        {!enterpriseFrameReady && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--bg-primary)]/45 p-4">
            <div className="mc-shell-card w-full max-w-md border border-[var(--border-secondary)] p-4 text-center">
              <div className="mb-2 text-sm font-medium text-[var(--text-primary)]">
                {enterpriseFrameTimedOut ? 'Unable to load Openclaw in this view' : 'Loading Openclaw...'}
              </div>
              <div className="mb-3 text-xs text-[var(--text-muted)]">
                {enterpriseFrameTimedOut
                  ? 'Embedding may be blocked by browser or network security. Retry, or open it in a new tab.'
                  : 'Connecting to the embedded admin dashboard.'}
              </div>
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setEnterpriseFrameNonce((value) => value + 1)}
                  className="mc-shell-btn px-3 py-1 text-xs"
                >
                  Retry
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4 lg:p-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
        {adminSection === 'general' && (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
                <div className="mb-1 text-sm font-medium text-[var(--text-primary)]">Require login</div>
                <div className="mb-3 text-xs text-[var(--text-muted)]">Gate the full app behind the login prompt. Changes apply after refresh.</div>
                <button
                  type="button"
                  onClick={() => toggleLoginRequirement(!loginRequired)}
                  className={`mc-shell-btn px-3 py-1 text-xs ${loginRequired ? 'mc-shell-btn-active text-[var(--text-primary)]' : ''}`}
                >
                  {loginRequired ? 'On' : 'Off'}
                </button>
              </div>
              <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
                <div className="mb-1 text-sm font-medium text-[var(--text-primary)]">Session</div>
                <div className="mb-3 text-xs text-[var(--text-muted)]">
                  {authSession ? `Logged in as ${authSession.username}` : 'No active login session'}
                </div>
                {authSession && (
                  <button type="button" onClick={handleLogout} className="mc-shell-btn px-3 py-1 text-xs text-[var(--error)]">
                    Sign out
                  </button>
                )}
              </div>
              <div className="mc-shell-card border border-[var(--border-secondary)] p-4 md:col-span-2">
                <div className="mb-1 text-sm font-medium text-[var(--text-primary)]">Install Entity</div>
                <div className="mb-3 text-xs text-[var(--text-muted)]">
                  {pwaInstalled
                    ? 'Entity is running as an installed app.'
                    : 'Install Entity as a standalone app (PWA). On iOS use Share → Add to Home Screen; on desktop browsers use the address-bar install icon if the button is unavailable.'}
                </div>
                {!pwaInstalled && (
                  <button
                    type="button"
                    onClick={() => onInstallApp?.()}
                    className={`mc-shell-btn px-3 py-1 text-xs ${installPromptAvailable ? 'mc-shell-btn-active border-[var(--accent)] text-[var(--text-primary)]' : ''}`}
                  >
                    {installPromptAvailable ? 'Install app' : 'Show install instructions'}
                  </button>
                )}
              </div>
              <div className="mc-shell-card border border-[var(--border-secondary)] p-4 md:col-span-2">
                <div className="mb-1 text-sm font-medium text-[var(--text-primary)]">Theme</div>
                <div className="mb-3 text-xs text-[var(--text-muted)]">Switch workspace colors and typography.</div>
                <div className="grid gap-2 md:grid-cols-3">
                  {([
                    { value: 'dark', label: 'Dark', hint: 'Classic black shell' },
                    { value: 'light', label: 'Light', hint: 'Clean white workspace' },
                    { value: 'kitz', label: 'Kitz', hint: 'Dark gradient workspace' },
                    { value: 'nebula', label: 'Nebula', hint: 'Glassy blue violet' },
                    { value: 'aurora', label: 'Aurora', hint: 'Mint peach glass' },
                    { value: 'paper', label: 'Paper', hint: 'Notebook desk board' },
                  ] as const).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setAppTheme(option.value)}
                      className={`mc-shell-btn flex flex-col items-start gap-1 px-3 py-2 text-left ${
                        appTheme === option.value
                          ? 'mc-shell-btn-active border-[var(--accent)] bg-[var(--surface-accent)] text-[var(--text-primary)]'
                          : ''
                      }`}
                      aria-pressed={appTheme === option.value}
                    >
                      <span className="text-sm font-medium">{option.label}</span>
                      <span className={`text-[11px] ${appTheme === option.value ? 'text-white' : 'text-[var(--text-muted)]'}`}>
                        {option.hint}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <LazyEffectiveConfigSettings apiBase={apiBase} />
            <LazyFileSourcesSettings apiBase={apiBase} enabled={fsMultiSourceEnabled} />
          </>
        )}

        {adminSection === 'profile' && (
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
              <div className="mb-1 text-sm font-medium text-[var(--text-primary)]">User profile</div>
              <div className="mb-4 text-xs text-[var(--text-muted)]">
                Used anywhere the app shows your human identity, including chat messages, login defaults, mentions, and task actions.
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                  <span>Display name</span>
                  <input
                    value={profileNameDraft}
                    onChange={(event) => setProfileNameDraft(event.target.value)}
                    className="mc-shell-input px-3 py-2 text-sm"
                    aria-label="User display name"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                  <span>Handle</span>
                  <input
                    value={profileHandleDraft}
                    onChange={(event) => setProfileHandleDraft(event.target.value)}
                    className="mc-shell-input px-3 py-2 text-sm"
                    aria-label="User handle"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)] md:col-span-2">
                  <span>Avatar URL</span>
                  <input
                    value={profileAvatarDraft}
                    onChange={(event) => setProfileAvatarDraft(event.target.value)}
                    className="mc-shell-input px-3 py-2 text-sm"
                    aria-label="User avatar URL"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)] md:col-span-2">
                  <span>Email</span>
                  <input
                    value={profileEmailDraft}
                    onChange={(event) => setProfileEmailDraft(event.target.value)}
                    className="mc-shell-input px-3 py-2 text-sm"
                    aria-label="User email"
                  />
                </label>
              </div>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setProfileNameDraft(userProfile.displayName);
                    setProfileHandleDraft(userProfile.handle);
                    setProfileAvatarDraft(userProfile.avatarUrl);
                    setProfileEmailDraft(userProfile.email);
                  }}
                  className="mc-shell-btn px-3 py-1.5 text-xs"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={handleUserProfileSave}
                  className="mc-shell-btn mc-shell-btn-active border-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)]"
                >
                  Save profile
                </button>
              </div>
            </div>
            <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
              <div className="mb-3 text-xs uppercase tracking-wider text-[var(--text-muted)]">Preview</div>
              <div className="flex items-center gap-3">
                <img
                  src={profileAvatarDraft.trim() || userProfile.avatarUrl}
                  alt={profileNameDraft.trim() || userProfile.displayName}
                  className="h-14 w-14 rounded-full object-cover"
                  onError={(event) => {
                    (event.currentTarget as HTMLImageElement).src = userProfile.avatarUrl;
                  }}
                />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                    {profileNameDraft.trim() || userProfile.displayName}
                  </div>
                  <div className="truncate text-xs text-[var(--text-muted)]">
                    @{profileHandleDraft.trim() || userProfile.handle}
                  </div>
                  {profileEmailDraft.trim() ? (
                    <div className="mt-1 truncate text-xs text-[var(--text-muted)]">{profileEmailDraft.trim()}</div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        )}



        {adminSection === 'accessControl' && (
          <div className="grid gap-3">
            <LazyUsersAndRolesSettings apiBase={apiBase} />
            <LazyAdminSettingsForm
              apiBase={apiBase}
              section="accessControl"
              title="Access control settings"
              description="Workspace auth defaults and principal resolution policy."
              fields={[
                { kind: 'boolean', key: 'loginRequiredDefault', label: 'Default login required' },
                { kind: 'text', key: 'defaultOrgId', label: 'Default org ID' },
                { kind: 'boolean', key: 'enforceStoredPrincipals', label: 'Enforce stored principals' },
                { kind: 'boolean', key: 'allowHeaderCompat', label: 'Allow local header compatibility path' },
                { kind: 'text', key: 'apiPrincipalId', label: 'API principal ID', hint: 'Principal bound to API token auth for admin mutations.' },
              ]}
            />
            <div className="grid gap-3 md:grid-cols-2">
            <FeatureSettingsCard
              title="Login gate"
              status={loginRequired ? 'required' : 'optional'}
              body="Workspace-level auth posture for the browser app. Changes to the login gate remain controlled from General settings."
              bullets={[
                authSession ? `Current session: ${authSession.username}` : 'No active browser login session.',
                'Document API credentials are configured under Integrations and enforce document scopes separately.',
                'Agent registry module scopes are configured under Agent registry.',
              ]}
            />
            <FeatureSettingsCard
              title="RBAC / principal posture"
              status="editable above"
              body="Stored principals resolve server-side grants. Disabled principals fail closed; unknown local principals still use the tested header compatibility path."
              bullets={[
                'Create principals and scoped grants in the Users & Roles panel above.',
                'Object access decisions return safe envelopes with required/effective role information.',
                'x-entity-role is ignored when a stored principal record exists.',
              ]}
            />
            <FeatureSettingsCard
              title="Agent/module scopes"
              status="editable in Agent registry"
              body="Agent-level enablement, permissions, and module scope labels live in the Agent registry settings page."
              bullets={[
                'Use Agent registry to enable/disable agents and review module scopes.',
                'Disabling preserves records; deletion removes them from the registry.',
              ]}
            />
            <FeatureSettingsCard
              title="Documents API access"
              status="editable in Integrations"
              body="Bearer/service token setup for comments, suggestions, and reviews is under Integrations."
              bullets={[
                'Requires documents:read plus write scopes for comments/suggestions/reviews.',
                'Service tokens require an explicit X-Entity-Actor value.',
              ]}
            />
            </div>
          </div>
        )}

        {adminSection === 'businessOnboarding' && (
          <LazyAdminSettingsForm
            apiBase={apiBase}
            section="businessOnboarding"
            title="Business onboarding"
            description="Control whether onboarding is enabled, the default domain, and dry-run safety requirements."
            fields={[
              { kind: 'boolean', key: 'enabled', label: 'Enable business onboarding flow' },
              { kind: 'select', key: 'defaultDomain', label: 'Default domain', options: [
                { value: 'claims', label: 'Claims' },
                { value: 'engineering', label: 'Engineering' },
                { value: 'product', label: 'Product' },
                { value: 'sales', label: 'Sales' },
                { value: 'marketing', label: 'Marketing' },
                { value: 'finance', label: 'Finance' },
                { value: 'customer_success', label: 'Customer success' },
                { value: 'people_ops', label: 'People ops' },
                { value: 'health_business', label: 'Health business' },
                { value: 'ai_ops', label: 'AI ops' },
                { value: 'other', label: 'Other' },
              ] },
              { kind: 'boolean', key: 'requireDryRun', label: 'Require dry-run confirmation before writes' },
            ]}
          />
        )}

        {adminSection === 'missionControl' && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
              <div className="mb-1 text-sm font-medium text-[var(--text-primary)]">Archive column</div>
              <div className="mb-3 text-xs text-[var(--text-muted)]">Show or hide archive from board/header/counts.</div>
              <button
                type="button"
                onClick={() => {
                  const next = !showArchiveColumn;
                  setShowArchiveColumn(next);
                  applyArchiveVisibility(next);
                }}
                className={`mc-shell-btn px-3 py-1 text-xs ${showArchiveColumn ? 'mc-shell-btn-active text-[var(--text-primary)]' : ''}`}
              >
                {showArchiveColumn ? 'Visible' : 'Hidden'}
              </button>
            </div>
            <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
              <div className="mb-1 text-sm font-medium text-[var(--text-primary)]">Insights row</div>
              <div className="text-xs text-[var(--text-muted)]">Insights now lives in its own dashboard tab next to Kanban.</div>
            </div>
            <div className="mc-shell-card border border-[var(--border-secondary)] p-4 md:col-span-2">
              <div className="mb-1 text-sm font-medium text-[var(--text-primary)]">Task data health</div>
              <div className="mb-3 text-xs text-[var(--text-muted)]">
                {tasksLoading ? 'Refreshing tasks…' : `${taskCount} tasks indexed in workspace.`}
              </div>
              <button type="button" onClick={() => void reloadTasks()} className="mc-shell-btn px-3 py-1 text-xs">
                Refresh task cache
              </button>
            </div>
          </div>
        )}



        {adminSection === 'engineering' && (
          <LazyAdminSettingsForm
            apiBase={apiBase}
            section="engineering"
            title="Engineering"
            description="Engineering board defaults and import safety gates."
            fields={[
              { kind: 'select', key: 'defaultWorkDomain', label: 'Default work domain', options: [
                { value: 'engineering', label: 'Engineering' },
              ] },
              { kind: 'boolean', key: 'importDryRunRequired', label: 'Require import dry-run' },
              { kind: 'boolean', key: 'showEmptyStateHints', label: 'Show empty-state hints' },
            ]}
          />
        )}

        {adminSection === 'workplanes' && (
          <LazyAdminSettingsForm
            apiBase={apiBase}
            section="workplanes"
            title="Workplanes"
            description="Task workplane proof and layout safety controls."
            fields={[
              { kind: 'boolean', key: 'requireProofBeforeReview', label: 'Require proof before review-ready' },
              { kind: 'boolean', key: 'lockAgentLayoutMutation', label: 'Reject agent layout mutation' },
              { kind: 'boolean', key: 'showActivityDegradedBanner', label: 'Show degraded activity banner' },
            ]}
          />
        )}

        {adminSection === 'strategicRoadmap' && (
          <LazyAdminSettingsForm
            apiBase={apiBase}
            section="strategicRoadmap"
            title="Strategic roadmap"
            description="Control which strategic roadmap lanes are visible in Mission Control."
            fields={[
              { kind: 'boolean', key: 'showBacklogLane', label: 'Show backlog lane' },
              { kind: 'boolean', key: 'showRecurringLane', label: 'Show recurring lane' },
              { kind: 'boolean', key: 'showDependencyHints', label: 'Show dependency hints' },
            ]}
          />
        )}

        {adminSection === 'scopedSearch' && (
          <LazyAdminSettingsForm
            apiBase={apiBase}
            section="scopedSearch"
            title="Scoped search"
            description="Default search collection and degraded-result visibility."
            fields={[
              { kind: 'select', key: 'defaultCollection', label: 'Default collection', options: [
                { value: 'all', label: 'All' },
                { value: 'obsidian', label: 'Obsidian' },
                { value: 'superada', label: 'Superada' },
                { value: 'sessions', label: 'Sessions' },
                { value: 'scotty', label: 'Scotty' },
                { value: 'spock', label: 'Spock' },
                { value: 'memory', label: 'Memory' },
              ] },
              { kind: 'boolean', key: 'labelDegradedResults', label: 'Label degraded results' },
              { kind: 'boolean', key: 'includeTaskProof', label: 'Include task/proof surfaces' },
            ]}
          />
        )}

        {adminSection === 'channels' && (
          <LazyAdminSettingsForm
            apiBase={apiBase}
            section="channels"
            title="Channels"
            description="Channel adapter enablement and delivery preferences."
            fields={[
              { kind: 'boolean', key: 'referenceAdapterEnabled', label: 'Enable reference adapter' },
              { kind: 'string-list', key: 'preferredChannels', label: 'Preferred channels' },
              { kind: 'boolean', key: 'degradeOnAdapterFailure', label: 'Degrade visibly on adapter failure' },
            ]}
          />
        )}

        {adminSection === 'integrations' && (
          <div className="grid gap-3 md:grid-cols-3">
            <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
              <div className="text-xs uppercase tracking-wider text-[var(--text-muted)]">WebSocket</div>
              <div className={`mt-2 text-sm font-medium ${connected ? 'text-[var(--accent)]' : 'text-[var(--error)]'}`}>
                {connected ? 'Connected' : 'Disconnected'}
              </div>
            </div>
            <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
              <div className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Sync</div>
              <div className="mt-2 text-sm font-medium text-[var(--text-primary)]">{syncStatusLabel}</div>
            </div>
            <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
              <div className="text-xs uppercase tracking-wider text-[var(--text-muted)]">OpenClaw</div>
              <div className={`mt-2 text-sm font-medium ${agentsError ? 'text-[var(--error)]' : 'text-[var(--accent)]'}`}>
                {agentsError ? 'Fallback' : 'Connected'}
              </div>
            </div>
            <LazyOfflineAwareChat isOffline={isOffline} />
            <div className="mc-shell-card border border-[var(--border-secondary)] p-4 md:col-span-3">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium text-[var(--text-primary)]">Documents API</div>
                <div className="text-xs text-[var(--text-muted)]">
                  {documentsAuth
                    ? (documentsAuth.kind === 'service' ? `Service as ${documentsAuth.actorId}` : 'Bearer')
                    : 'Not connected'}
                </div>
              </div>
              <div className="mb-3 text-xs text-[var(--text-muted)]">
                Used for comments, suggestions, and reviews on source-backed files in the editor.
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const token = documentsAuthTokenDraft.trim();
                  if (!token) {
                    setDocumentsAuth(null);
                    pushToast('Cleared Documents token.', 'info');
                    return;
                  }

                  if (documentsAuthKindDraft === 'service') {
                    const actorId = documentsAuthActorDraft.trim().toLowerCase();
                    if (!actorId) {
                      pushToast('Service tokens require an actor id (ada/spock/scotty).', 'warning');
                      return;
                    }
                    setDocumentsAuth({ kind: 'service', token, actorId, origin: 'user' });
                    pushToast('Service token saved.', 'success');
                    return;
                  }

                  setDocumentsAuth({ kind: 'bearer', token, origin: 'user' });
                  pushToast('Bearer token saved.', 'success');
                }}
                className="flex flex-col gap-2"
              >
                <div className="grid gap-2 md:grid-cols-2">
                  <select
                    value={documentsAuthKindDraft}
                    onChange={(event) => setDocumentsAuthKindDraft(event.target.value as 'bearer' | 'service')}
                    className="mc-shell-input w-full px-3 py-2 text-sm"
                    aria-label="Token type"
                  >
                    <option value="bearer">Bearer token</option>
                    <option value="service">Service token</option>
                  </select>
                  {documentsAuthKindDraft === 'service' ? (
                    <input
                      value={documentsAuthActorDraft}
                      onChange={(event) => setDocumentsAuthActorDraft(event.target.value)}
                      className="mc-shell-input w-full px-3 py-2 text-sm"
                      placeholder="X-Entity-Actor (ada/spock/scotty)"
                      aria-label="Service token actor id"
                    />
                  ) : (
                    <div className="hidden md:block" aria-hidden="true" />
                  )}
                </div>

                <input
                  value={documentsAuthTokenDraft}
                  onChange={(event) => setDocumentsAuthTokenDraft(event.target.value)}
                  className="mc-shell-input w-full px-3 py-2 text-sm"
                  placeholder="Paste token (Authorization: Bearer ...)"
                  aria-label="Documents API token"
                />

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setDocumentsAuth(null);
                      setDocumentsAuthTokenDraft('');
                      pushToast('Cleared Documents token.', 'info');
                    }}
                    className="mc-shell-btn px-3 py-1.5 text-xs"
                  >
                    Clear
                  </button>
                  <button
                    type="submit"
                    className="mc-shell-btn mc-shell-btn-active border-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)]"
                  >
                    Save
                  </button>
                </div>

                <div className="text-[11px] text-[var(--text-muted)]">
                  Requires scopes: <span className="text-[var(--text-secondary)]">documents:read</span> and{' '}
                  <span className="text-[var(--text-secondary)]">documents:comment:write</span>/
                  <span className="text-[var(--text-secondary)]">documents:suggest:write</span>/
                  <span className="text-[var(--text-secondary)]">documents:review:write</span>.
                </div>
              </form>
            </div>
          </div>
        )}

        {adminSection === 'tts' && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="mc-shell-card border border-[var(--border-secondary)] p-4 md:col-span-2">
              <div className="mb-1 text-sm font-medium text-[var(--text-primary)]">TTS Provider</div>
              <div className="mb-3 text-xs text-[var(--text-muted)]">
                Browser TTS runs locally; all others use server endpoints. Kokoro needs a local service running.
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                {([
                  { value: 'browser', label: 'Browser TTS', hint: 'Web Speech API - no server needed' },
                  { value: 'kokoro', label: 'Kokoro', hint: 'Local service at KOKORO_TTS_BASE_URL' },
                  { value: 'edge', label: 'Edge TTS', hint: 'Microsoft Edge - fast, free voices' },
                  { value: 'openai', label: 'OpenAI TTS', hint: 'Requires OPENAI_API_KEY on server' },
                  { value: 'deepgram', label: 'Deepgram', hint: 'Requires DEEPGRAM_API_KEY on server' },
                  { value: 'elevenlabs', label: 'ElevenLabs', hint: 'Requires ELEVENLABS_API_KEY on server' },
                ] satisfies DocsTtsProviderOption[]).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setDocsTtsSettings((current) => ({ ...current, provider: option.value }))}
                    className={`mc-shell-btn flex flex-col items-start gap-1 px-3 py-2 text-left ${
                      docsTtsSettings.provider === option.value
                        ? 'mc-shell-btn-active border-[var(--accent)] bg-[var(--surface-accent)] text-[var(--text-primary)]'
                        : ''
                    }`}
                    aria-pressed={docsTtsSettings.provider === option.value}
                  >
                    <span className="text-sm font-medium">{option.label}</span>
                    <span className="text-[11px] text-[var(--text-muted)]">{option.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
              <label className="mb-1 block text-sm font-medium text-[var(--text-primary)]" htmlFor="kokoro-voice">
                Kokoro voice
              </label>
              <div className="mb-1 text-xs text-[var(--text-muted)]">
                bf_alice, bf_emma, bf_isabelle, bf_nicole, bf_sky, bm_daniel, bm_federico, bm_george, bm_lewis, bm_matilda
              </div>
              <input
                id="kokoro-voice"
                value={docsTtsSettings.kokoroVoice}
                onChange={(event) => setDocsTtsSettings((current) => ({ ...current, kokoroVoice: event.target.value }))}
                className="mc-shell-input w-full px-3 py-2 text-sm"
                placeholder="bf_alice"
              />
            </div>

            <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
              <label className="mb-1 block text-sm font-medium text-[var(--text-primary)]" htmlFor="edge-voice">
                Edge TTS voice
              </label>
              <div className="mb-1 text-xs text-[var(--text-muted)]">
                en-GB-SoniaNeural, en-GB-RyanNeural, en-US-JennyNeural, en-US-GuyNeural, en-US-AriaNeural, en-AU-NatashaNeural, en-NZ-MollyNeural
              </div>
              <input
                id="edge-voice"
                value={docsTtsSettings.edgeVoice}
                onChange={(event) => setDocsTtsSettings((current) => ({ ...current, edgeVoice: event.target.value }))}
                className="mc-shell-input w-full px-3 py-2 text-sm"
                placeholder="en-GB-SoniaNeural"
              />
            </div>

            <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
              <label className="mb-1 block text-sm font-medium text-[var(--text-primary)]" htmlFor="openai-voice">
                OpenAI voice
              </label>
              <div className="mb-1 text-xs text-[var(--text-muted)]">
                alloy, echo, fable, onyx, nova, shimmer
              </div>
              <input
                id="openai-voice"
                value={docsTtsSettings.openaiVoice}
                onChange={(event) => setDocsTtsSettings((current) => ({ ...current, openaiVoice: event.target.value }))}
                className="mc-shell-input w-full px-3 py-2 text-sm"
                placeholder="alloy"
              />
            </div>

            <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
              <label className="mb-1 block text-sm font-medium text-[var(--text-primary)]" htmlFor="deepgram-voice">
                Deepgram voice
              </label>
              <div className="mb-1 text-xs text-[var(--text-muted)]">
                aura-angus-en, aura-asteria-en, aura-asteria-en (see /api/tts/voices?provider=deepgram for full list)
              </div>
              <input
                id="deepgram-voice"
                value={docsTtsSettings.deepgramVoice}
                onChange={(event) => setDocsTtsSettings((current) => ({ ...current, deepgramVoice: event.target.value }))}
                className="mc-shell-input w-full px-3 py-2 text-sm"
                placeholder="aura-angus-en"
              />
            </div>

            <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
              <label className="mb-1 block text-sm font-medium text-[var(--text-primary)]" htmlFor="elevenlabs-voice">
                ElevenLabs voice ID
              </label>
              <div className="mb-1 text-xs text-[var(--text-muted)]">
                Voice ID from ElevenLabs voice library
              </div>
              <input
                id="elevenlabs-voice"
                value={docsTtsSettings.elevenlabsVoice}
                onChange={(event) => setDocsTtsSettings((current) => ({ ...current, elevenlabsVoice: event.target.value }))}
                className="mc-shell-input w-full px-3 py-2 text-sm"
                placeholder="EXAVITc4tvU7xuL82wvV"
              />
            </div>

            <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
              <label className="mb-1 block text-sm font-medium text-[var(--text-primary)]" htmlFor="openai-model">
                OpenAI model
              </label>
              <div className="mb-1 text-xs text-[var(--text-muted)]">
                gpt-4o-mini-tts or gpt-4o-tts
              </div>
              <input
                id="openai-model"
                value={docsTtsSettings.openaiModel}
                onChange={(event) => setDocsTtsSettings((current) => ({ ...current, openaiModel: event.target.value }))}
                className="mc-shell-input w-full px-3 py-2 text-sm"
                placeholder="gpt-4o-mini-tts"
              />
            </div>

            <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
              <label className="mb-1 block text-sm font-medium text-[var(--text-primary)]" htmlFor="playback-rate">
                Default playback speed
              </label>
              <div className="mb-1 text-xs text-[var(--text-muted)]">
                0.5x to 2x - affects audio element playbackRate
              </div>
              <select
                id="playback-rate"
                value={docsTtsSettings.playbackRate}
                onChange={(event) => setDocsTtsSettings((current) => ({ ...current, playbackRate: Number(event.target.value) }))}
                className="mc-shell-input w-full px-3 py-2 text-sm"
              >
                <option value={0.5}>0.5x (half speed)</option>
                <option value={0.75}>0.75x</option>
                <option value={1}>1x (normal)</option>
                <option value={1.25}>1.25x</option>
                <option value={1.5}>1.5x</option>
                <option value={2}>2x (double speed)</option>
              </select>
            </div>
          </div>
        )}

        {adminSection === 'plugins' && (
          <LazyPluginAdminPanel apiBase={apiBase} />
        )}

        {adminSection === 'agents' && (
          <div className="space-y-4">
            <LazyAdminAgentSettingsPanel />
            <LazyAgentRegistrySettings
              apiBase={apiBase}
              onRegistryChanged={onAgentRegistryChanged}
            />
          </div>
        )}

        {adminSection === 'voice' && (
          <LazyVoiceSettings apiBase={apiBase} />
        )}

        {adminSection === 'taskMaster' && (
          <LazyTaskMasterSettings apiBase={apiBase} />
        )}

        {adminSection === 'docs' && (
          <Suspense fallback={<LazySurfaceFallback label="Loading Docs settings" />}>
            <DocsSettings apiBase={apiBase} onOpenTaskMasterSettings={onOpenTaskMasterSettings} />
          </Suspense>
        )}

      </div>
    </div>
  );
}
