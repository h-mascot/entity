import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchDurableInvites,
  regenerateDurableInvite,
  revokeDurableInvite,
} from '../../lib/agentInviteApi';
import {
  canCopyInviteSecrets,
  canRegenerateInvite,
  canRevokeInvite,
  createInitialDeskState,
  deskApplyInviteUpdate,
  deskBeginLoad,
  deskFromListError,
  deskFromListSuccess,
  deskSelectInvite,
  deskStatusDisplay,
  inviteStatusLabel,
  mergeShowOnce,
  progressStepLabel,
  urlsUnavailableReason,
  verificationSummary,
  type AgentInviteDeskState,
  type DeskInviteView,
} from '../../lib/agentInviteDesk';
import {
  INVITE_URL_KEYS,
  buildInvitePrompt,
  copyInviteText,
  createInitialCopyState,
  inviteUrlLabel,
  textForCopyTarget,
  type InvitePromptCopyState,
  type InvitePromptCopyTarget,
} from '../../lib/addAgentInvitePrompt';
import { toErrorMessage } from '../../lib/http';
import AgentIdentityCapabilityCard from './AgentIdentityCapabilityCard';
import WorkplaneAttachedAgentsPanel from './WorkplaneAttachedAgentsPanel';
import WorkplaneChiefRoutingPanel from './WorkplaneChiefRoutingPanel';
import WorkplanePresencePanel from './WorkplanePresencePanel';

export interface AgentInviteDeskPanelProps {
  /** Optional refresh signal from parent (e.g. after Add Agent create). */
  refreshToken?: number;
  className?: string;
  /** Test / proof injectors */
  listLoader?: () => Promise<{ invites: DeskInviteView[]; count: number }>;
  revoker?: (inviteId: string) => Promise<DeskInviteView>;
  regenerator?: (inviteId: string) => Promise<DeskInviteView>;
}

function statusTone(status: DeskInviteView['status']): string {
  switch (status) {
    case 'completed':
      return 'text-[var(--success)]';
    case 'expired':
    case 'revoked':
      return 'text-[var(--error)]';
    case 'in_progress':
    case 'opened':
      return 'text-[var(--accent)]';
    default:
      return 'text-[var(--text-secondary)]';
  }
}

function formatWhen(value: string | null | undefined): string {
  if (!value) return '—';
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return value;
  return new Date(ms).toLocaleString();
}

export default function AgentInviteDeskPanel({
  refreshToken = 0,
  className = '',
  listLoader = fetchDurableInvites,
  revoker = revokeDurableInvite,
  regenerator = regenerateDurableInvite,
}: AgentInviteDeskPanelProps) {
  const [state, setState] = useState<AgentInviteDeskState>(() => createInitialDeskState());
  const [copyState, setCopyState] = useState<InvitePromptCopyState>(() => createInitialCopyState());
  const [presenceRefresh, setPresenceRefresh] = useState(0);

  const origin = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return window.location.origin;
  }, []);

  const load = useCallback(async () => {
    setState((prev) => deskBeginLoad(prev));
    try {
      const payload = await listLoader();
      setState((prev) => deskFromListSuccess(prev, payload));
      setPresenceRefresh((value) => value + 1);
    } catch (error) {
      setState((prev) => deskFromListError(prev, toErrorMessage(error, 'Unable to load invites.')));
    }
  }, [listLoader]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const selected = useMemo(() => {
    const row = state.invites.find((invite) => invite.id === state.selectedInviteId) ?? null;
    if (!row) return null;
    return mergeShowOnce(row, state.showOnceById);
  }, [state.invites, state.selectedInviteId, state.showOnceById]);

  const promptBuild = useMemo(() => {
    if (!selected || !canCopyInviteSecrets(selected.id, state.showOnceById)) return null;
    return buildInvitePrompt({
      invite: {
        id: selected.id,
        status: selected.status,
        agentName: selected.agentName,
        role: selected.role,
        creationSource: selected.creationSource,
        expiresAt: selected.expiresAt,
        selectedModules: selected.selectedModules,
        permissionsScope: selected.permissionsScope,
        safeStopConditions: selected.safeStopConditions,
        projectId: selected.projectId,
        workplaneId: selected.workplaneId,
        taskId: selected.taskId,
        setupPath: selected.setupPath ?? '',
        manifestPath: selected.manifestPath ?? '',
        bundlePath: selected.bundlePath ?? '',
        skillPath: selected.skillPath ?? '',
        progressPath: selected.progressPath ?? '',
        persistence: 'durable',
      },
      origin,
      workspaceName: 'Entity workspace',
    });
  }, [selected, state.showOnceById, origin]);

  const onRevoke = async () => {
    if (!selected || !canRevokeInvite(selected)) return;
    setState((prev) => ({ ...prev, actionBusyId: selected.id, actionError: null }));
    try {
      const updated = await revoker(selected.id);
      setState((prev) => deskApplyInviteUpdate(prev, updated));
      setCopyState(createInitialCopyState());
    } catch (error) {
      setState((prev) => ({
        ...prev,
        actionBusyId: null,
        actionError: toErrorMessage(error, 'Revoke failed.'),
      }));
    }
  };

  const onRegenerate = async () => {
    if (!selected || !canRegenerateInvite(selected)) return;
    setState((prev) => ({ ...prev, actionBusyId: selected.id, actionError: null }));
    try {
      const updated = await regenerator(selected.id);
      setState((prev) => deskApplyInviteUpdate(prev, updated, { rememberShowOnce: true }));
      setCopyState(createInitialCopyState());
    } catch (error) {
      setState((prev) => ({
        ...prev,
        actionBusyId: null,
        actionError: toErrorMessage(error, 'Regenerate failed.'),
      }));
    }
  };

  const onCopy = async (target: InvitePromptCopyTarget) => {
    if (!promptBuild) {
      setCopyState({ lastCopied: null, error: 'Show-once URLs are not available in memory.' });
      return;
    }
    const text = textForCopyTarget(promptBuild, target);
    setCopyState(await copyInviteText(text, target));
  };

  const urlReason = selected
    ? urlsUnavailableReason(selected, state.showOnceById)
    : null;

  return (
    <section
      className={`entity-ops-panel-strong px-4 py-3 ${className}`}
      data-testid="agent-invite-desk"
      data-invite-desk-status={state.uiStatus}
      data-invite-desk-count={String(state.invites.length)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="entity-ops-section-title">Invite desk</div>
          <div className="mt-1 text-sm text-[var(--text-secondary)]">
            Durable invite setup, verification, expiry, and rotation state from{' '}
            <code className="text-[11px]">/api/agents/invites</code>.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="text-xs font-medium text-[var(--text-secondary)]"
            data-testid="invite-desk-status-label"
          >
            {state.uiStatus === 'empty' && 'No invites'}
            {state.uiStatus === 'loading' && 'Loading…'}
            {state.uiStatus === 'error' && 'Error'}
            {state.uiStatus === 'ready' && `${state.invites.length} invite${state.invites.length === 1 ? '' : 's'}`}
          </span>
          <button
            type="button"
            className="entity-ops-chip px-3 py-1.5 text-xs"
            data-testid="invite-desk-refresh"
            onClick={() => void load()}
            disabled={state.uiStatus === 'loading'}
          >
            Refresh
          </button>
        </div>
      </div>

      {state.uiStatus === 'loading' && (
        <div
          className="mt-3 text-sm text-[var(--text-secondary)]"
          data-testid="invite-desk-loading"
          role="status"
        >
          Loading durable invites…
        </div>
      )}

      {state.uiStatus === 'error' && (
        <div
          className="mt-3 entity-ops-panel border-[var(--error)] bg-[var(--surface-error)] px-3 py-3 text-sm text-[var(--error)]"
          data-testid="invite-desk-error"
          role="alert"
        >
          {state.error ?? 'Failed to load invites.'}
        </div>
      )}

      {state.uiStatus === 'empty' && (
        <div
          className="entity-ops-empty mt-3 px-3 py-4 text-sm"
          data-testid="invite-desk-empty"
        >
          No durable invites yet. Use <span className="font-medium">Add Agent</span> to create one,
          then refresh this desk.
        </div>
      )}

      {state.uiStatus === 'ready' && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="space-y-2" data-testid="invite-desk-list">
            {state.invites.map((invite) => {
              const active = invite.id === state.selectedInviteId;
              return (
                <button
                  key={invite.id}
                  type="button"
                  data-testid={`invite-desk-row-${invite.id}`}
                  data-invite-status={invite.status}
                  data-invite-rotated={invite.rotated ? '1' : '0'}
                  className={`w-full rounded border px-3 py-2 text-left text-sm transition-colors ${
                    active
                      ? 'border-[var(--accent)] bg-[var(--bg-primary)]'
                      : 'border-[var(--border-primary)] bg-[var(--bg-primary)]/40 hover:border-[var(--accent)]'
                  }`}
                  onClick={() => setState((prev) => deskSelectInvite(prev, invite.id))}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-[var(--text-primary)]">{invite.agentName}</span>
                    <span className={`text-[11px] font-medium ${statusTone(invite.status)}`}>
                      {deskStatusDisplay(invite)}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                    {invite.role} · expires {formatWhen(invite.expiresAt)}
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
                    {verificationSummary(invite)}
                  </div>
                </button>
              );
            })}
          </div>

          {selected && (
            <div
              className="space-y-3 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)]/50 p-3"
              data-testid="invite-desk-detail"
              data-invite-id={selected.id}
              data-invite-status={selected.status}
              data-invite-generation={String(selected.generation)}
              data-has-show-once={canCopyInviteSecrets(selected.id, state.showOnceById) ? '1' : '0'}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-[var(--text-primary)]">
                    {selected.agentName}
                  </div>
                  <div className={`mt-1 text-xs font-medium ${statusTone(selected.status)}`}>
                    {deskStatusDisplay(selected)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="entity-ops-chip px-3 py-1.5 text-xs"
                    data-testid="invite-desk-revoke"
                    disabled={!canRevokeInvite(selected) || state.actionBusyId === selected.id}
                    onClick={() => void onRevoke()}
                    title={
                      canRevokeInvite(selected)
                        ? 'Revoke this invite'
                        : 'Already revoked — affordance fail-closed'
                    }
                  >
                    Revoke
                  </button>
                  <button
                    type="button"
                    className="entity-ops-chip entity-ops-chip-blue px-3 py-1.5 text-xs"
                    data-testid="invite-desk-regenerate"
                    disabled={!canRegenerateInvite(selected) || state.actionBusyId === selected.id}
                    onClick={() => void onRegenerate()}
                  >
                    Regenerate
                  </button>
                </div>
              </div>

              {state.actionError && (
                <div
                  className="text-xs text-[var(--error)]"
                  data-testid="invite-desk-action-error"
                  role="alert"
                >
                  {state.actionError}
                </div>
              )}

              <AgentIdentityCapabilityCard
                invite={{
                  id: selected.id,
                  agentName: selected.agentName,
                  role: selected.role,
                  status: selected.status,
                  selectedBundle: selected.selectedBundle,
                  selectedModules: selected.selectedModules,
                  permissionsScope: selected.permissionsScope,
                  workplaneId: selected.workplaneId,
                  taskId: selected.taskId,
                  progress: selected.progress,
                }}
              />

              <WorkplaneAttachedAgentsPanel
                workplaneId={selected.workplaneId}
                inviteId={selected.id}
                taskId={selected.taskId}
                agentName={selected.agentName}
                refreshToken={refreshToken + presenceRefresh}
              />

              <WorkplanePresencePanel
                workplaneId={selected.workplaneId}
                refreshToken={refreshToken + presenceRefresh}
              />

              <WorkplaneChiefRoutingPanel
                workplaneId={selected.workplaneId}
                taskId={selected.taskId}
                preferredAgentId={`invite:${selected.id}`}
                preferredAgentName={selected.agentName}
                refreshToken={refreshToken + presenceRefresh}
              />

              <dl className="grid gap-2 text-xs sm:grid-cols-2" data-testid="invite-desk-meta">
                <div>
                  <dt className="text-[var(--text-muted)]">Status</dt>
                  <dd className="text-[var(--text-primary)]">{inviteStatusLabel(selected.status)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--text-muted)]">Generation</dt>
                  <dd className="text-[var(--text-primary)]">
                    {selected.generation}
                    {selected.rotated ? ' (rotated)' : ''}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--text-muted)]">Created</dt>
                  <dd className="text-[var(--text-primary)]">{formatWhen(selected.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--text-muted)]">Expires</dt>
                  <dd className="text-[var(--text-primary)]">{formatWhen(selected.expiresAt)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--text-muted)]">Opened</dt>
                  <dd className="text-[var(--text-primary)]">{formatWhen(selected.openedAt)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--text-muted)]">Completed</dt>
                  <dd className="text-[var(--text-primary)]">{formatWhen(selected.completedAt)}</dd>
                </div>
                {selected.revokedAt && (
                  <div className="sm:col-span-2">
                    <dt className="text-[var(--text-muted)]">Revoked</dt>
                    <dd className="text-[var(--error)]">
                      {formatWhen(selected.revokedAt)}
                      {selected.revokedBy ? ` · ${selected.revokedBy}` : ''}
                    </dd>
                  </div>
                )}
                <div className="sm:col-span-2">
                  <dt className="text-[var(--text-muted)]">Invite id</dt>
                  <dd className="font-mono text-[11px] text-[var(--text-secondary)]">{selected.id}</dd>
                </div>
              </dl>

              <div data-testid="invite-desk-progress">
                <div className="entity-ops-section-title mb-2">Verification / progress</div>
                <div className="mb-2 text-xs text-[var(--text-secondary)]">
                  {verificationSummary(selected)}
                </div>
                {selected.progress.length === 0 ? (
                  <div className="text-xs text-[var(--text-muted)]">No progress steps recorded.</div>
                ) : (
                  <ul className="space-y-1.5">
                    {selected.progress.map((step) => (
                      <li
                        key={step.stepId}
                        className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--border-primary)] px-2 py-1.5 text-xs"
                        data-testid={`invite-desk-step-${step.stepId}`}
                        data-step-status={step.status}
                      >
                        <span className="text-[var(--text-primary)]">{step.label}</span>
                        <span
                          className={
                            step.status === 'error'
                              ? 'text-[var(--error)]'
                              : step.status === 'done'
                                ? 'text-[var(--success)]'
                                : 'text-[var(--text-secondary)]'
                          }
                        >
                          {progressStepLabel(step.status)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div data-testid="invite-desk-urls">
                <div className="entity-ops-section-title mb-2">Setup URL bundle</div>
                {urlReason ? (
                  <div
                    className="rounded border border-[var(--border-primary)] px-3 py-2 text-xs text-[var(--text-secondary)]"
                    data-testid="invite-desk-urls-unavailable"
                  >
                    {urlReason}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="entity-ops-chip entity-ops-chip-blue px-3 py-1.5 text-xs"
                        data-testid="invite-desk-copy-prompt"
                        onClick={() => void onCopy('prompt')}
                      >
                        {copyState.lastCopied === 'prompt' ? 'Copied' : 'Copy full prompt'}
                      </button>
                      {INVITE_URL_KEYS.map((key) => (
                        <button
                          key={key}
                          type="button"
                          className="entity-ops-chip px-2 py-1 text-[11px]"
                          data-testid={`invite-desk-copy-${key}`}
                          onClick={() => void onCopy(key)}
                        >
                          {copyState.lastCopied === key ? 'Copied' : inviteUrlLabel(key)}
                        </button>
                      ))}
                    </div>
                    {copyState.error && (
                      <div className="text-xs text-[var(--error)]" role="alert">
                        {copyState.error}
                      </div>
                    )}
                    <ul className="space-y-1 font-mono text-[11px] text-[var(--text-muted)]">
                      <li data-testid="invite-desk-setup-path">{selected.setupPath}</li>
                      <li>{selected.manifestPath}</li>
                      <li>{selected.bundlePath}</li>
                      <li>{selected.skillPath}</li>
                      <li>{selected.progressPath}</li>
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

    </section>
  );
}
