import { useMemo, useState } from 'react';
import {
  ADD_AGENT_BUNDLES,
  ADD_AGENT_ROLES,
  beginEditing,
  createInitialCreationState,
  createInviteKit,
  creationSummary,
  inviteStatusLabel,
  resetCreation,
  roleLabel,
  toggleAdvanced,
  updateDraft,
  type AddAgentBundle,
  type AddAgentCreationState,
  type AddAgentRole,
  type CreateInviteKitOptions,
} from '../../lib/addAgentInviteCreation';

export interface AddAgentCreationPanelProps {
  /** Optional override for tests / browser proof error injection. */
  createOptions?: CreateInviteKitOptions;
  className?: string;
}

function statusTone(uiStatus: AddAgentCreationState['uiStatus']): string {
  switch (uiStatus) {
    case 'loading':
      return 'text-[var(--accent)]';
    case 'error':
      return 'text-[var(--error)]';
    case 'ready':
      return 'text-[var(--success)]';
    default:
      return 'text-[var(--text-secondary)]';
  }
}

export default function AddAgentCreationPanel({
  createOptions,
  className = '',
}: AddAgentCreationPanelProps) {
  const [state, setState] = useState<AddAgentCreationState>(() => createInitialCreationState());
  const [open, setOpen] = useState(false);

  const forceErrorFromQuery = useMemo(() => {
    if (typeof window === 'undefined') return null;
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('addAgentForceError');
    } catch {
      return null;
    }
  }, []);

  const openPanel = () => {
    setOpen(true);
    setState((prev) => (prev.uiStatus === 'empty' ? beginEditing(prev) : prev));
  };

  const closePanel = () => {
    setOpen(false);
  };

  const onCreate = async () => {
    let snapshot: AddAgentCreationState = {
      ...state,
      uiStatus: 'loading',
      error: null,
    };
    setState(snapshot);
    const next = await createInviteKit(snapshot, {
      ...createOptions,
      forceError: createOptions?.forceError ?? forceErrorFromQuery,
    });
    setState(next);
  };

  return (
    <section
      className={`entity-ops-panel-strong px-4 py-3 ${className}`}
      data-testid="add-agent-creation"
      data-add-agent-status={state.uiStatus}
      data-add-agent-seam={state.seam}
      data-add-agent-open={open ? '1' : '0'}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="entity-ops-section-title">Add Agent</div>
          <div className="mt-1 text-sm text-[var(--text-secondary)]">
            Create an invite kit for a new agent. Uses the invite-kit status model
            (`created` → …); durable invite API is a later ticket.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`text-xs font-medium ${statusTone(state.uiStatus)}`}
            data-testid="add-agent-status-label"
          >
            {state.uiStatus === 'empty' && 'Ready to start'}
            {state.uiStatus === 'editing' && 'Editing'}
            {state.uiStatus === 'loading' && 'Creating…'}
            {state.uiStatus === 'error' && 'Error'}
            {state.uiStatus === 'ready' && 'Invite created'}
          </span>
          {!open ? (
            <button
              type="button"
              className="entity-ops-chip entity-ops-chip-blue px-3 py-1.5 text-xs font-medium"
              data-testid="add-agent-open"
              onClick={openPanel}
            >
              Add Agent
            </button>
          ) : (
            <button
              type="button"
              className="entity-ops-chip px-3 py-1.5 text-xs"
              data-testid="add-agent-close"
              onClick={closePanel}
            >
              Close
            </button>
          )}
        </div>
      </div>

      {!open && state.uiStatus === 'empty' && (
        <div
          className="entity-ops-empty mt-3 px-3 py-4 text-sm"
          data-testid="add-agent-empty"
        >
          No invite in progress. Click <span className="font-medium">Add Agent</span> to start
          invite creation.
        </div>
      )}

      {open && (
        <div className="mt-4 space-y-4" data-testid="add-agent-form">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-[var(--text-muted)]">
              Agent name
              <input
                data-testid="add-agent-name"
                className="mt-1 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                value={state.draft.agentName}
                onChange={(event) =>
                  setState((prev) => updateDraft(prev, { agentName: event.target.value }))
                }
                placeholder="e.g. Scout"
                autoComplete="off"
              />
            </label>
            <label className="block text-xs text-[var(--text-muted)]">
              Role
              <select
                data-testid="add-agent-role"
                className="mt-1 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                value={state.draft.role}
                onChange={(event) =>
                  setState((prev) =>
                    updateDraft(prev, { role: event.target.value as AddAgentRole }),
                  )
                }
              >
                {ADD_AGENT_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(role)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="text-xs text-[var(--accent)] underline-offset-2 hover:underline"
              data-testid="add-agent-toggle-advanced"
              onClick={() => setState((prev) => toggleAdvanced(prev))}
            >
              {state.draft.showAdvanced ? 'Hide advanced options' : 'Show advanced options'}
            </button>
            <span className="text-[11px] text-[var(--text-muted)]">
              Progressive disclosure — bundle, project, permissions, TTL
            </span>
          </div>

          {state.draft.showAdvanced && (
            <div
              className="grid gap-3 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)]/40 p-3 sm:grid-cols-2"
              data-testid="add-agent-advanced"
            >
              <label className="block text-xs text-[var(--text-muted)]">
                Work domain / project
                <input
                  data-testid="add-agent-project"
                  className="mt-1 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  value={state.draft.projectId}
                  onChange={(event) =>
                    setState((prev) => updateDraft(prev, { projectId: event.target.value }))
                  }
                  placeholder="optional"
                />
              </label>
              <label className="block text-xs text-[var(--text-muted)]">
                Module bundle
                <select
                  data-testid="add-agent-bundle"
                  className="mt-1 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  value={state.draft.selectedBundle}
                  onChange={(event) =>
                    setState((prev) =>
                      updateDraft(prev, {
                        selectedBundle: event.target.value as AddAgentBundle,
                      }),
                    )
                  }
                >
                  {ADD_AGENT_BUNDLES.map((bundle) => (
                    <option key={bundle} value={bundle}>
                      {bundle}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-[var(--text-muted)] sm:col-span-2">
                Permissions scope (comma-separated)
                <input
                  data-testid="add-agent-permissions"
                  className="mt-1 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  value={state.draft.permissionsScope.join(', ')}
                  onChange={(event) =>
                    setState((prev) =>
                      updateDraft(prev, {
                        permissionsScope: event.target.value
                          .split(',')
                          .map((part) => part.trim())
                          .filter(Boolean),
                      }),
                    )
                  }
                />
              </label>
              <label className="block text-xs text-[var(--text-muted)]">
                TTL (minutes)
                <input
                  data-testid="add-agent-ttl"
                  type="number"
                  min={1}
                  max={1440}
                  className="mt-1 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  value={Math.round(state.draft.ttlMs / 60_000)}
                  onChange={(event) => {
                    const minutes = Number(event.target.value);
                    setState((prev) =>
                      updateDraft(prev, {
                        ttlMs: Number.isFinite(minutes) ? minutes * 60_000 : prev.draft.ttlMs,
                      }),
                    );
                  }}
                />
              </label>
              <label className="block text-xs text-[var(--text-muted)]">
                Optional task id
                <input
                  data-testid="add-agent-task-id"
                  className="mt-1 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  value={state.draft.taskId}
                  onChange={(event) =>
                    setState((prev) => updateDraft(prev, { taskId: event.target.value }))
                  }
                  placeholder="optional"
                />
              </label>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded bg-[var(--accent)] px-3 py-2 text-xs font-medium text-[var(--bg-primary)] disabled:opacity-50"
              data-testid="add-agent-create"
              onClick={() => void onCreate()}
              disabled={state.uiStatus === 'loading'}
            >
              {state.uiStatus === 'loading' ? 'Creating invite…' : 'Create invite kit'}
            </button>
            {(state.uiStatus === 'ready' || state.uiStatus === 'error') && (
              <button
                type="button"
                className="rounded border border-[var(--border-primary)] px-3 py-2 text-xs text-[var(--text-secondary)]"
                data-testid="add-agent-reset"
                onClick={() => setState(resetCreation(state))}
              >
                Start over
              </button>
            )}
          </div>

          {state.uiStatus === 'loading' && (
            <div
              className="rounded border border-[var(--border-primary)] px-3 py-3 text-sm text-[var(--accent)]"
              data-testid="add-agent-loading"
              role="status"
            >
              Creating invite kit…
            </div>
          )}

          {state.uiStatus === 'error' && state.error && (
            <div
              className="rounded border border-[var(--error)] bg-[var(--surface-error)] px-3 py-3 text-sm text-[var(--error)]"
              data-testid="add-agent-error"
              role="alert"
            >
              <div className="font-medium">Invite creation failed</div>
              <div className="mt-1">{state.error}</div>
              <button
                type="button"
                className="mt-2 text-xs underline"
                data-testid="add-agent-retry"
                onClick={() => void onCreate()}
              >
                Retry
              </button>
            </div>
          )}

          {state.uiStatus === 'ready' && state.invite && (
            <div
              className="space-y-3 rounded border border-[var(--success)]/40 bg-[var(--bg-primary)]/50 px-3 py-3"
              data-testid="add-agent-ready"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div
                    className="text-sm font-semibold text-[var(--text-primary)]"
                    data-testid="add-agent-ready-summary"
                  >
                    {creationSummary(state.invite)}
                  </div>
                  <div className="mt-1 text-xs text-[var(--text-muted)]">
                    Status{' '}
                    <span data-testid="add-agent-invite-status">
                      {inviteStatusLabel(state.invite.status)}
                    </span>
                    <span className="mx-1">·</span>
                    Expires {new Date(state.invite.expiresAt).toLocaleString()}
                  </div>
                </div>
                <span
                  className="entity-ops-chip entity-ops-chip-green"
                  data-testid="add-agent-persistence"
                >
                  Local preview — not durable
                </span>
              </div>

              <div className="grid gap-2 text-xs text-[var(--text-secondary)] sm:grid-cols-2">
                <div>
                  <div className="text-[var(--text-muted)]">Setup path</div>
                  <code
                    className="mt-0.5 block break-all text-[var(--text-primary)]"
                    data-testid="add-agent-setup-path"
                  >
                    {state.invite.setupPath}
                  </code>
                </div>
                <div>
                  <div className="text-[var(--text-muted)]">Manifest path</div>
                  <code
                    className="mt-0.5 block break-all text-[var(--text-primary)]"
                    data-testid="add-agent-manifest-path"
                  >
                    {state.invite.manifestPath}
                  </code>
                </div>
              </div>

              <div
                className="rounded border border-[var(--border-primary)] px-3 py-2 text-xs text-[var(--text-secondary)]"
                data-testid="add-agent-next-step"
              >
                <div className="font-medium text-[var(--text-primary)]">Next step</div>
                <p className="mt-1">{state.invite.nextStep}</p>
                <p className="mt-2 text-[var(--text-muted)]">
                  Seam: <code>{state.invite.seam}</code>. Does not call{' '}
                  <code>POST /api/onboarding/agent-session</code> (would mutate global onboarding
                  state). Durable <code>/api/agents/invites</code> arrives in WP2-A-05.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
