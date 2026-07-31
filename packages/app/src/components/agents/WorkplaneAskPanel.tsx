import { useCallback, useEffect, useState } from 'react';
import { toErrorMessage } from '../../lib/http';
import {
  claimWorkplaneAsk,
  createWorkplaneAsk,
  fetchWorkplaneAskPanel,
  resolveWorkplaneAsk,
} from '../../lib/workplaneAskFlowApi';
import {
  askBeginLoad,
  askFromError,
  askFromSuccess,
  askPanelSummary,
  askStatusLabel,
  askStatusToneClass,
  createInitialAskLoadState,
  type WorkplaneAskLoadState,
  type WorkplaneAskPanel as PanelModel,
} from '../../lib/workplaneAskFlow';

export interface WorkplaneAskPanelProps {
  workplaneId: string | null | undefined;
  taskId?: number | null;
  /** Prefill agent id for claim/resolve (selected invite agent). */
  preferredAgentId?: string | null;
  preferredAgentName?: string | null;
  className?: string;
  refreshToken?: number;
  loader?: (workplaneId: string) => Promise<PanelModel>;
  title?: string;
}

/**
 * WP2-B-05 — Workplane ASK claim/resolve surface.
 * Create / claim / resolve with CAS versions. Does not invent live chief
 * presence or expose secrets/runtime controls.
 */
export default function WorkplaneAskPanel({
  workplaneId,
  taskId = null,
  preferredAgentId = null,
  preferredAgentName = null,
  className = '',
  refreshToken = 0,
  loader = fetchWorkplaneAskPanel,
  title = 'ASK flow',
}: WorkplaneAskPanelProps) {
  const [state, setState] = useState<WorkplaneAskLoadState>(() => createInitialAskLoadState());
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftTitle, setDraftTitle] = useState('Need review');

  const load = useCallback(async (id: string) => {
    setState((prev) => askBeginLoad(prev, id));
    try {
      const panel = await loader(id);
      setState(askFromSuccess(panel));
      setActionError(null);
    } catch (error) {
      setState(askFromError(id, toErrorMessage(error, 'Unable to load ASK panel.')));
    }
  }, [loader]);

  useEffect(() => {
    const id = typeof workplaneId === 'string' ? workplaneId.trim() : '';
    if (!id) {
      setState(createInitialAskLoadState());
      return;
    }
    void load(id);
  }, [workplaneId, refreshToken, load]);

  const onCreate = async () => {
    const id = typeof workplaneId === 'string' ? workplaneId.trim() : '';
    const titleText = draftTitle.trim();
    if (!id || !titleText) return;
    setBusy(true);
    setActionError(null);
    try {
      await createWorkplaneAsk({
        workplaneId: id,
        title: titleText,
        taskId,
        createdBy: 'operator',
      });
      await load(id);
    } catch (error) {
      setActionError(toErrorMessage(error, 'Unable to create ASK.'));
    } finally {
      setBusy(false);
    }
  };

  const onClaim = async (askId: string, expectedVersion: number) => {
    const id = typeof workplaneId === 'string' ? workplaneId.trim() : '';
    const agentId = typeof preferredAgentId === 'string' ? preferredAgentId.trim() : '';
    if (!id || !agentId) return;
    setBusy(true);
    setActionError(null);
    try {
      await claimWorkplaneAsk({
        workplaneId: id,
        askId,
        agentId,
        expectedVersion,
      });
      await load(id);
    } catch (error) {
      setActionError(toErrorMessage(error, 'Unable to claim ASK.'));
    } finally {
      setBusy(false);
    }
  };

  const onResolve = async (askId: string, expectedVersion: number) => {
    const id = typeof workplaneId === 'string' ? workplaneId.trim() : '';
    const agentId = typeof preferredAgentId === 'string' ? preferredAgentId.trim() : '';
    if (!id || !agentId) return;
    setBusy(true);
    setActionError(null);
    try {
      await resolveWorkplaneAsk({
        workplaneId: id,
        askId,
        resolvedBy: agentId,
        expectedVersion,
        asOperator: false,
        note: 'Resolved from Agent Desk',
      });
      await load(id);
    } catch (error) {
      setActionError(toErrorMessage(error, 'Unable to resolve ASK.'));
    } finally {
      setBusy(false);
    }
  };

  if (!workplaneId || !String(workplaneId).trim()) {
    return (
      <section
        className={`rounded border border-[var(--border-primary)] bg-[var(--bg-primary)]/40 px-3 py-3 ${className}`}
        data-testid="workplane-ask-panel"
        data-ask-panel-status="no-workplane"
      >
        <div className="entity-ops-section-title">{title}</div>
        <p className="mt-2 text-xs text-[var(--text-muted)]" data-testid="workplane-ask-empty-workplane">
          No workplane selected — ASK claim/resolve stays unbound.
        </p>
      </section>
    );
  }

  const panel = state.status === 'ready' ? state.panel : null;
  const canActOnPreferred = Boolean(preferredAgentId && String(preferredAgentId).trim()) && !busy;

  return (
    <section
      className={`rounded border border-[var(--border-primary)] bg-[var(--bg-primary)]/40 px-3 py-3 ${className}`}
      data-testid="workplane-ask-panel"
      data-ask-panel-status={state.status}
      data-workplane-id={workplaneId}
      data-ask-open-count={panel?.openCount ?? 0}
      data-ask-claimed-count={panel?.claimedCount ?? 0}
      data-ask-resolved-count={panel?.resolvedCount ?? 0}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="entity-ops-section-title">{title}</div>
          <div
            className="mt-1 font-mono text-[11px] text-[var(--text-muted)]"
            data-testid="workplane-ask-id"
          >
            {workplaneId}
          </div>
        </div>
        {panel && (
          <span
            className="entity-ops-chip px-2 py-1 text-[11px]"
            data-testid="workplane-ask-summary"
          >
            {askPanelSummary(panel)}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          className="min-w-[10rem] flex-1 rounded border border-[var(--border-primary)] bg-transparent px-2 py-1 text-[11px]"
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          data-testid="workplane-ask-title-input"
          disabled={busy}
          aria-label="ASK title"
        />
        <button
          type="button"
          className="entity-ops-chip entity-ops-chip-blue px-2 py-1 text-[11px]"
          data-testid="workplane-ask-create"
          disabled={busy || !draftTitle.trim()}
          onClick={() => void onCreate()}
        >
          {busy ? 'Working…' : 'Create ASK'}
        </button>
      </div>

      {preferredAgentName && (
        <p className="mt-2 text-[11px] text-[var(--text-muted)]" data-testid="workplane-ask-preferred-agent">
          Claim/resolve actor: {preferredAgentName}
        </p>
      )}

      {actionError && (
        <p
          className="mt-2 text-xs text-[var(--error)]"
          data-testid="workplane-ask-action-error"
          role="alert"
        >
          {actionError}
        </p>
      )}

      {state.status === 'loading' && (
        <p className="mt-2 text-xs text-[var(--text-secondary)]" data-testid="workplane-ask-loading">
          Loading ASK flow…
        </p>
      )}

      {state.status === 'error' && (
        <p
          className="mt-2 text-xs text-[var(--error)]"
          data-testid="workplane-ask-error"
          role="alert"
        >
          {state.error}
        </p>
      )}

      {panel && panel.asks.length === 0 && (
        <p className="mt-2 text-xs text-[var(--text-muted)]" data-testid="workplane-ask-empty">
          No ASKs yet — create one to start claim/resolve.
        </p>
      )}

      {panel && panel.asks.length > 0 && (
        <ul className="mt-3 space-y-2" data-testid="workplane-ask-list">
          {panel.asks.map((ask) => (
            <li
              key={ask.id}
              className="rounded border border-[var(--border-primary)]/70 px-2 py-2 text-xs"
              data-testid="workplane-ask-item"
              data-ask-id={ask.id}
              data-ask-status={ask.status}
              data-ask-version={ask.version}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-[var(--text-primary)]" data-testid="workplane-ask-item-title">
                    {ask.title}
                  </div>
                  <div className={`${askStatusToneClass(ask.status)} mt-0.5`} data-testid="workplane-ask-item-status">
                    {askStatusLabel(ask.status)} · v{ask.version}
                    {ask.claimantAgentName ? ` · ${ask.claimantAgentName}` : ''}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {(ask.status === 'open' || ask.status === 'chief_review' || ask.status === 'stale') && (
                    <button
                      type="button"
                      className="entity-ops-chip px-2 py-1 text-[11px]"
                      data-testid="workplane-ask-claim"
                      disabled={!canActOnPreferred}
                      onClick={() => void onClaim(ask.id, ask.version)}
                    >
                      Claim
                    </button>
                  )}
                  {(ask.status === 'claimed' || ask.status === 'stale') && (
                    <button
                      type="button"
                      className="entity-ops-chip px-2 py-1 text-[11px]"
                      data-testid="workplane-ask-resolve"
                      disabled={!canActOnPreferred}
                      onClick={() => void onResolve(ask.id, ask.version)}
                    >
                      Resolve
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
