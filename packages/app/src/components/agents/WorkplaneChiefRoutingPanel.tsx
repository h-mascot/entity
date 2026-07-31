import { useCallback, useEffect, useState } from 'react';
import { toErrorMessage } from '../../lib/http';
import {
  assignWorkplaneChief,
  assignWorkplaneRouting,
  clearWorkplaneChief,
  fetchWorkplaneRoutingPanel,
} from '../../lib/workplaneChiefRoutingApi';
import {
  chiefPresenceToneClass,
  createInitialRoutingLoadState,
  routingBeginLoad,
  routingFromError,
  routingFromSuccess,
  routingGateLabel,
  routingSummary,
  type WorkplaneRoutingLoadState,
  type WorkplaneRoutingPanel as PanelModel,
} from '../../lib/workplaneChiefRouting';

export interface WorkplaneChiefRoutingPanelProps {
  workplaneId: string | null | undefined;
  taskId?: number | null;
  /** Prefill agent id for chief assign / operator assign (selected invite agent). */
  preferredAgentId?: string | null;
  preferredAgentName?: string | null;
  className?: string;
  refreshToken?: number;
  loader?: (workplaneId: string, taskId?: number | null) => Promise<PanelModel>;
  title?: string;
}

/**
 * WP2-B-04 — Chief-of-Staff routing policy surface (claim/assign).
 * Shows chief assignment, priority gate, and operator assign/clear controls.
 * Does not invent live chief presence or expose secrets/runtime controls.
 */
export default function WorkplaneChiefRoutingPanel({
  workplaneId,
  taskId = null,
  preferredAgentId = null,
  preferredAgentName = null,
  className = '',
  refreshToken = 0,
  loader = fetchWorkplaneRoutingPanel,
  title = 'Chief routing',
}: WorkplaneChiefRoutingPanelProps) {
  const [state, setState] = useState<WorkplaneRoutingLoadState>(() => createInitialRoutingLoadState());
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (id: string) => {
    setState((prev) => routingBeginLoad(prev, id));
    try {
      const panel = await loader(id, taskId);
      setState(routingFromSuccess(panel));
      setActionError(null);
    } catch (error) {
      setState(routingFromError(id, toErrorMessage(error, 'Unable to load routing policy.')));
    }
  }, [loader, taskId]);

  useEffect(() => {
    const id = typeof workplaneId === 'string' ? workplaneId.trim() : '';
    if (!id) {
      setState(createInitialRoutingLoadState());
      return;
    }
    void load(id);
  }, [workplaneId, refreshToken, load]);

  const onAssignChief = async () => {
    const id = typeof workplaneId === 'string' ? workplaneId.trim() : '';
    const agentId = typeof preferredAgentId === 'string' ? preferredAgentId.trim() : '';
    if (!id || !agentId) return;
    setBusy(true);
    setActionError(null);
    try {
      await assignWorkplaneChief({
        workplaneId: id,
        agentId,
        assignedBy: 'operator',
      });
      await load(id);
    } catch (error) {
      setActionError(toErrorMessage(error, 'Unable to assign chief.'));
    } finally {
      setBusy(false);
    }
  };

  const onClearChief = async () => {
    const id = typeof workplaneId === 'string' ? workplaneId.trim() : '';
    if (!id) return;
    setBusy(true);
    setActionError(null);
    try {
      await clearWorkplaneChief(id);
      await load(id);
    } catch (error) {
      setActionError(toErrorMessage(error, 'Unable to clear chief.'));
    } finally {
      setBusy(false);
    }
  };

  const onOperatorAssign = async () => {
    const id = typeof workplaneId === 'string' ? workplaneId.trim() : '';
    const agentId = typeof preferredAgentId === 'string' ? preferredAgentId.trim() : '';
    if (!id || !agentId) return;
    setBusy(true);
    setActionError(null);
    try {
      await assignWorkplaneRouting({
        workplaneId: id,
        agentId,
        assignedBy: 'operator',
        asOperator: true,
        taskId,
      });
      await load(id);
    } catch (error) {
      setActionError(toErrorMessage(error, 'Unable to assign routing slot.'));
    } finally {
      setBusy(false);
    }
  };

  if (!workplaneId || !String(workplaneId).trim()) {
    return (
      <section
        className={`rounded border border-[var(--border-primary)] bg-[var(--bg-primary)]/40 px-3 py-3 ${className}`}
        data-testid="workplane-routing-panel"
        data-routing-panel-status="no-workplane"
      >
        <div className="entity-ops-section-title">{title}</div>
        <p className="mt-2 text-xs text-[var(--text-muted)]" data-testid="workplane-routing-empty-workplane">
          No workplane selected — chief routing stays unbound (not assumed assigned).
        </p>
      </section>
    );
  }

  const panel = state.status === 'ready' ? state.panel : null;
  const canActOnPreferred = Boolean(preferredAgentId && String(preferredAgentId).trim()) && !busy;

  return (
    <section
      className={`rounded border border-[var(--border-primary)] bg-[var(--bg-primary)]/40 px-3 py-3 ${className}`}
      data-testid="workplane-routing-panel"
      data-routing-panel-status={state.status}
      data-workplane-id={workplaneId}
      data-claim-gate={panel?.policy.claimGate ?? 'unknown'}
      data-chief-available={panel?.chiefPresence?.available ? '1' : '0'}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="entity-ops-section-title">{title}</div>
          <div
            className="mt-1 font-mono text-[11px] text-[var(--text-muted)]"
            data-testid="workplane-routing-id"
          >
            {workplaneId}
          </div>
        </div>
        {panel && (
          <span
            className="entity-ops-chip px-2 py-1 text-[11px]"
            data-testid="workplane-routing-summary"
          >
            {routingSummary(panel)}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="entity-ops-chip entity-ops-chip-blue px-2 py-1 text-[11px]"
          data-testid="workplane-routing-assign-chief"
          disabled={!canActOnPreferred}
          onClick={() => void onAssignChief()}
          title={preferredAgentName ? `Assign ${preferredAgentName} as chief` : 'Assign preferred agent as chief'}
        >
          {busy ? 'Working…' : 'Assign as chief'}
        </button>
        <button
          type="button"
          className="entity-ops-chip px-2 py-1 text-[11px]"
          data-testid="workplane-routing-clear-chief"
          disabled={busy || !panel?.chief}
          onClick={() => void onClearChief()}
        >
          Clear chief
        </button>
        <button
          type="button"
          className="entity-ops-chip px-2 py-1 text-[11px]"
          data-testid="workplane-routing-operator-assign"
          disabled={!canActOnPreferred}
          onClick={() => void onOperatorAssign()}
        >
          Operator assign
        </button>
      </div>

      {actionError && (
        <p
          className="mt-2 text-xs text-[var(--error)]"
          data-testid="workplane-routing-action-error"
          role="alert"
        >
          {actionError}
        </p>
      )}

      {state.status === 'loading' && (
        <p className="mt-2 text-xs text-[var(--text-secondary)]" data-testid="workplane-routing-loading">
          Loading routing policy…
        </p>
      )}

      {state.status === 'error' && (
        <p
          className="mt-2 text-xs text-[var(--error)]"
          data-testid="workplane-routing-error"
          role="alert"
        >
          {state.error}
        </p>
      )}

      {panel && (
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2" data-testid="workplane-routing-details">
          <div>
            <dt className="text-[var(--text-muted)]">Claim gate</dt>
            <dd data-testid="workplane-routing-gate">{routingGateLabel(panel.policy.claimGate)}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Workers may claim</dt>
            <dd data-testid="workplane-routing-workers-may-claim">
              {panel.policy.workersMayClaim ? 'yes' : 'no'}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Chief</dt>
            <dd data-testid="workplane-routing-chief">
              {panel.chief ? panel.chief.chiefAgentName : 'None'}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Chief presence</dt>
            <dd
              className={chiefPresenceToneClass(panel.chiefPresence?.presenceStatus)}
              data-testid="workplane-routing-chief-presence"
            >
              {panel.chiefPresence
                ? `${panel.chiefPresence.presenceStatus} · ${panel.chiefPresence.heartbeatFreshnessLabel}`
                : 'n/a'}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[var(--text-muted)]">Policy</dt>
            <dd data-testid="workplane-routing-policy-summary">{panel.policy.summary}</dd>
          </div>
          {panel.activeClaim && (
            <div className="sm:col-span-2">
              <dt className="text-[var(--text-muted)]">Active claim</dt>
              <dd data-testid="workplane-routing-active-claim">
                {panel.activeClaim.claimMode} · {panel.activeClaim.agentName} · {panel.activeClaim.policyCode}
              </dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}
