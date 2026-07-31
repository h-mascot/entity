import { useCallback, useEffect, useState } from 'react';
import { toErrorMessage } from '../../lib/http';
import { fetchWorkplanePresence } from '../../lib/workplanePresenceApi';
import {
  createInitialPresenceLoadState,
  formatLastSeen,
  panelSummary,
  presenceBeginLoad,
  presenceFromError,
  presenceFromSuccess,
  presenceStatusLabel,
  presenceToneClass,
  type WorkplanePresenceLoadState,
  type WorkplanePresencePanel as PanelModel,
} from '../../lib/workplanePresence';

export interface WorkplanePresencePanelProps {
  workplaneId: string | null | undefined;
  className?: string;
  /** Optional refresh bump from parent. */
  refreshToken?: number;
  /** Test / proof injector */
  loader?: (workplaneId: string) => Promise<PanelModel>;
  title?: string;
}

/**
 * WP2-B-02 — Workplane presence panel.
 * Shows live / last-seen / stale / missing / degraded; never invents activity.
 */
export default function WorkplanePresencePanel({
  workplaneId,
  className = '',
  refreshToken = 0,
  loader = fetchWorkplanePresence,
  title = 'Workplane presence',
}: WorkplanePresencePanelProps) {
  const [state, setState] = useState<WorkplanePresenceLoadState>(() => createInitialPresenceLoadState());

  const load = useCallback(async (id: string) => {
    setState((prev) => presenceBeginLoad(prev, id));
    try {
      const panel = await loader(id);
      setState(presenceFromSuccess(panel));
    } catch (error) {
      setState(presenceFromError(id, toErrorMessage(error, 'Unable to load presence.')));
    }
  }, [loader]);

  useEffect(() => {
    const id = typeof workplaneId === 'string' ? workplaneId.trim() : '';
    if (!id) {
      setState(createInitialPresenceLoadState());
      return;
    }
    void load(id);
  }, [workplaneId, refreshToken, load]);

  if (!workplaneId || !String(workplaneId).trim()) {
    return (
      <section
        className={`rounded border border-[var(--border-primary)] bg-[var(--bg-primary)]/40 px-3 py-3 ${className}`}
        data-testid="workplane-presence-panel"
        data-presence-panel-status="no-workplane"
      >
        <div className="entity-ops-section-title">{title}</div>
        <p className="mt-2 text-xs text-[var(--text-muted)]" data-testid="workplane-presence-empty-workplane">
          No workplane selected — presence stays unbound (not assumed live).
        </p>
      </section>
    );
  }

  const statusAttr =
    state.status === 'ready' || state.status === 'empty'
      ? state.status
      : state.status;

  return (
    <section
      className={`rounded border border-[var(--border-primary)] bg-[var(--bg-primary)]/40 px-3 py-3 ${className}`}
      data-testid="workplane-presence-panel"
      data-presence-panel-status={statusAttr}
      data-workplane-id={workplaneId}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="entity-ops-section-title">{title}</div>
          <div
            className="mt-1 font-mono text-[11px] text-[var(--text-muted)]"
            data-testid="workplane-presence-id"
          >
            {workplaneId}
          </div>
        </div>
        {(state.status === 'ready' || state.status === 'empty') && (
          <span
            className="entity-ops-chip px-2 py-1 text-[11px]"
            data-testid="workplane-presence-summary"
          >
            {panelSummary(state.panel)}
          </span>
        )}
      </div>

      {state.status === 'loading' && (
        <p className="mt-2 text-xs text-[var(--text-secondary)]" data-testid="workplane-presence-loading">
          Loading presence…
        </p>
      )}

      {state.status === 'error' && (
        <p
          className="mt-2 text-xs text-[var(--error)]"
          data-testid="workplane-presence-error"
          role="alert"
        >
          {state.error}
        </p>
      )}

      {state.status === 'empty' && (
        <p className="mt-2 text-xs text-[var(--text-muted)]" data-testid="workplane-presence-empty">
          No agents bound to this workplane yet. Invite-only bindings appear as missing until a
          heartbeat arrives — activity is never invented.
        </p>
      )}

      {(state.status === 'ready' || state.status === 'empty') && state.panel.agents.length > 0 && (
        <ul className="mt-3 space-y-2" data-testid="workplane-presence-list">
          {state.panel.agents.map((agent) => (
            <li
              key={`${agent.agentId}:${agent.inviteId ?? ''}`}
              className="rounded border border-[var(--border-primary)] px-2 py-2 text-xs"
              data-testid={`workplane-presence-row-${agent.agentId}`}
              data-presence-status={agent.presenceStatus}
              data-presence-source={agent.source}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div
                    className="font-semibold text-[var(--text-primary)]"
                    data-testid="workplane-presence-agent-name"
                  >
                    {agent.agentName}
                  </div>
                  <div className="text-[var(--text-secondary)]">{agent.role}</div>
                </div>
                <span
                  className={presenceToneClass(agent.presenceStatus)}
                  data-testid="workplane-presence-status"
                >
                  {presenceStatusLabel(agent.presenceStatus)}
                </span>
              </div>
              <dl className="mt-2 grid gap-1 sm:grid-cols-2">
                <div>
                  <dt className="text-[var(--text-muted)]">Last seen</dt>
                  <dd data-testid="workplane-presence-last-seen">
                    {formatLastSeen(agent.lastSeenAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--text-muted)]">Heartbeat</dt>
                  <dd data-testid="workplane-presence-heartbeat">
                    {agent.heartbeatFreshnessLabel}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-[var(--text-muted)]">Current work</dt>
                  <dd data-testid="workplane-presence-current-work">{agent.currentWorkLabel}</dd>
                </div>
              </dl>
              {agent.degradedReasons.length > 0 && (
                <div
                  className="mt-2 text-[11px] text-[var(--text-secondary)]"
                  data-testid="workplane-presence-degraded"
                  role="status"
                >
                  Degraded: {agent.degradedReasons.join(', ')}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
