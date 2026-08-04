import { useCallback, useEffect, useState } from 'react';
import { toErrorMessage } from '../../lib/http';
import {
  attachAgentToWorkplane,
  detachAgentFromWorkplane,
  fetchWorkplaneAttachedAgents,
} from '../../lib/workplaneAttachedAgentsApi';
import {
  attachedBeginLoad,
  attachedFromError,
  attachedFromSuccess,
  attachedPresenceLabel,
  attachedPresenceToneClass,
  attachedSummary,
  createInitialAttachedLoadState,
  type WorkplaneAttachedAgentsPanel as PanelModel,
  type WorkplaneAttachedLoadState,
} from '../../lib/workplaneAttachedAgents';

export interface WorkplaneAttachedAgentsPanelProps {
  workplaneId: string | null | undefined;
  /** Prefill invite attach from Agent Desk selection. */
  inviteId?: string | null;
  taskId?: number | null;
  agentName?: string | null;
  className?: string;
  refreshToken?: number;
  loader?: (workplaneId: string) => Promise<PanelModel>;
  attacher?: typeof attachAgentToWorkplane;
  detacher?: typeof detachAgentFromWorkplane;
  title?: string;
}

/**
 * WP2-B-03 — Attached agents on a task Workplane.
 * Attach/detach controls + truthful presence overlay (never invents live).
 */
export default function WorkplaneAttachedAgentsPanel({
  workplaneId,
  inviteId = null,
  taskId = null,
  agentName = null,
  className = '',
  refreshToken = 0,
  loader = fetchWorkplaneAttachedAgents,
  attacher = attachAgentToWorkplane,
  detacher = detachAgentFromWorkplane,
  title = 'Attached agents',
}: WorkplaneAttachedAgentsPanelProps) {
  const [state, setState] = useState<WorkplaneAttachedLoadState>(() => createInitialAttachedLoadState());
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (id: string) => {
    setState((prev) => attachedBeginLoad(prev, id));
    try {
      const panel = await loader(id);
      setState(attachedFromSuccess(panel));
      setActionError(null);
    } catch (error) {
      setState(attachedFromError(id, toErrorMessage(error, 'Unable to load attached agents.')));
    }
  }, [loader]);

  useEffect(() => {
    const id = typeof workplaneId === 'string' ? workplaneId.trim() : '';
    if (!id) {
      setState(createInitialAttachedLoadState());
      return;
    }
    void load(id);
  }, [workplaneId, refreshToken, load]);

  const onAttachInvite = async () => {
    const id = typeof workplaneId === 'string' ? workplaneId.trim() : '';
    const invite = typeof inviteId === 'string' ? inviteId.trim() : '';
    if (!id || !invite) return;
    setBusy(true);
    setActionError(null);
    try {
      await attacher({
        workplaneId: id,
        inviteId: invite,
        taskId,
        agentName,
      });
      await load(id);
    } catch (error) {
      setActionError(toErrorMessage(error, 'Unable to attach agent.'));
    } finally {
      setBusy(false);
    }
  };

  const onDetach = async (agentId: string) => {
    const id = typeof workplaneId === 'string' ? workplaneId.trim() : '';
    if (!id) return;
    setBusy(true);
    setActionError(null);
    try {
      await detacher(id, agentId);
      await load(id);
    } catch (error) {
      setActionError(toErrorMessage(error, 'Unable to detach agent.'));
    } finally {
      setBusy(false);
    }
  };

  if (!workplaneId || !String(workplaneId).trim()) {
    return (
      <section
        className={`rounded border border-[var(--border-primary)] bg-[var(--bg-primary)]/40 px-3 py-3 ${className}`}
        data-testid="workplane-attached-panel"
        data-attached-panel-status="no-workplane"
      >
        <div className="entity-ops-section-title">{title}</div>
        <p className="mt-2 text-xs text-[var(--text-muted)]" data-testid="workplane-attached-empty-workplane">
          No workplane selected — attach stays unbound (not assumed assigned).
        </p>
      </section>
    );
  }

  const canAttachInvite = Boolean(inviteId && String(inviteId).trim()) && !busy;
  const statusAttr =
    state.status === 'ready' || state.status === 'empty'
      ? state.status
      : state.status;

  return (
    <section
      className={`rounded border border-[var(--border-primary)] bg-[var(--bg-primary)]/40 px-3 py-3 ${className}`}
      data-testid="workplane-attached-panel"
      data-attached-panel-status={statusAttr}
      data-workplane-id={workplaneId}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="entity-ops-section-title">{title}</div>
          <div
            className="mt-1 font-mono text-[11px] text-[var(--text-muted)]"
            data-testid="workplane-attached-id"
          >
            {workplaneId}
          </div>
        </div>
        {(state.status === 'ready' || state.status === 'empty') && (
          <span
            className="entity-ops-chip px-2 py-1 text-[11px]"
            data-testid="workplane-attached-summary"
          >
            {attachedSummary(state.panel)}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="entity-ops-chip px-2 py-1 text-[11px]"
          data-testid="workplane-attached-attach-invite"
          disabled={!canAttachInvite}
          onClick={() => void onAttachInvite()}
        >
          {busy ? 'Working…' : 'Attach selected invite'}
        </button>
      </div>

      {actionError && (
        <p
          className="mt-2 text-xs text-[var(--error)]"
          data-testid="workplane-attached-action-error"
          role="alert"
        >
          {actionError}
        </p>
      )}

      {state.status === 'loading' && (
        <p className="mt-2 text-xs text-[var(--text-secondary)]" data-testid="workplane-attached-loading">
          Loading attached agents…
        </p>
      )}

      {state.status === 'error' && (
        <p
          className="mt-2 text-xs text-[var(--error)]"
          data-testid="workplane-attached-error"
          role="alert"
        >
          {state.error}
        </p>
      )}

      {state.status === 'empty' && (
        <p className="mt-2 text-xs text-[var(--text-muted)]" data-testid="workplane-attached-empty">
          No agents attached yet. Attach an invite/agent explicitly — presence stays missing until a
          real heartbeat arrives.
        </p>
      )}

      {(state.status === 'ready' || state.status === 'empty') && state.panel.agents.length > 0 && (
        <ul className="mt-3 space-y-2" data-testid="workplane-attached-list">
          {state.panel.agents.map((agent) => (
            <li
              key={agent.attachmentId}
              className="rounded border border-[var(--border-primary)] px-2 py-2 text-xs"
              data-testid={`workplane-attached-row-${agent.agentId}`}
              data-presence-status={agent.presenceStatus}
              data-attach-source={agent.source}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div
                    className="font-semibold text-[var(--text-primary)]"
                    data-testid="workplane-attached-agent-name"
                  >
                    {agent.agentName}
                  </div>
                  <div className="text-[var(--text-secondary)]">{agent.role}</div>
                </div>
                <span
                  className={attachedPresenceToneClass(agent.presenceStatus)}
                  data-testid="workplane-attached-status"
                >
                  {attachedPresenceLabel(agent.presenceStatus)}
                </span>
              </div>
              <dl className="mt-2 grid gap-1 sm:grid-cols-2">
                <div>
                  <dt className="text-[var(--text-muted)]">Agent id</dt>
                  <dd className="font-mono" data-testid="workplane-attached-agent-id">{agent.agentId}</dd>
                </div>
                <div>
                  <dt className="text-[var(--text-muted)]">Heartbeat</dt>
                  <dd data-testid="workplane-attached-heartbeat">{agent.heartbeatFreshnessLabel}</dd>
                </div>
              </dl>
              <div className="mt-2">
                <button
                  type="button"
                  className="entity-ops-chip px-2 py-1 text-[11px]"
                  data-testid={`workplane-attached-detach-${agent.agentId}`}
                  disabled={busy}
                  onClick={() => void onDetach(agent.agentId)}
                >
                  Detach
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
