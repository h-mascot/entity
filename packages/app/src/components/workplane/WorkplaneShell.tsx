/**
 * THE-858 / WP1-A-03 — Minimal Workplane route shell.
 * THE-860 / WP1-A-05 — Return-to-board/detail navigation (never strand on shell).
 *
 * Parses/serializes THE-857 URL state. Panel bodies are placeholders until WP1-B/C.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WorkplanePanelId } from '../mission-control/taskDetailWorkplaneSeams.ts';
import { navigateWorkplaneReturn } from '../../lib/workplaneReturnNavigation.ts';
import {
  buildWorkplanePanelHref,
  resolveWorkplaneShellModel,
  type WorkplaneShellModel,
} from '../../lib/workplaneShellModel.ts';

export interface WorkplaneShellProps {
  /** Optional location override for tests; defaults to window.location. */
  pathname?: string;
  search?: string;
  /** Called when the shell navigates (panel change / return). Defaults to history API. */
  onNavigate?: (href: string, options?: { replace?: boolean; state?: unknown }) => void;
}

function readLocation(pathname?: string, search?: string): { pathname: string; search: string } {
  if (pathname !== undefined) {
    return { pathname, search: search ?? '' };
  }
  if (typeof window === 'undefined') {
    return { pathname: '/', search: '' };
  }
  return { pathname: window.location.pathname, search: window.location.search };
}

function defaultNavigate(href: string, options?: { replace?: boolean; state?: unknown }): void {
  if (typeof window === 'undefined') {
    return;
  }
  const nextUrl = new URL(href, window.location.origin);
  const method = options?.replace ? 'replaceState' : 'pushState';
  const state = options?.state ?? { mode: 'workplane' };
  window.history[method](state, '', nextUrl.pathname + nextUrl.search);
  window.dispatchEvent(new PopStateEvent('popstate', { state }));
}

export default function WorkplaneShell({
  pathname: pathnameProp,
  search: searchProp,
  onNavigate,
}: WorkplaneShellProps) {
  const [location, setLocation] = useState(() => readLocation(pathnameProp, searchProp));

  useEffect(() => {
    if (pathnameProp !== undefined) {
      setLocation({ pathname: pathnameProp, search: searchProp ?? '' });
      return;
    }

    const sync = () => {
      setLocation({
        pathname: window.location.pathname,
        search: window.location.search,
      });
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [pathnameProp, searchProp]);

  const model: WorkplaneShellModel = useMemo(
    () => resolveWorkplaneShellModel(location.pathname, location.search),
    [location.pathname, location.search],
  );

  const navigate = onNavigate ?? defaultNavigate;

  const selectPanel = useCallback(
    (panel: WorkplanePanelId) => {
      if (!model.state) {
        return;
      }
      const href = buildWorkplanePanelHref(model.state, panel);
      navigate(href, { replace: true, state: { mode: 'workplane', returnHref: model.returnContext.href } });
      if (pathnameProp === undefined) {
        setLocation({
          pathname: new URL(href, 'https://entity.local').pathname,
          search: new URL(href, 'https://entity.local').search,
        });
      }
    },
    [model.state, model.returnContext.href, navigate, pathnameProp],
  );

  const handleReturn = useCallback(() => {
    navigateWorkplaneReturn({
      returnContext: model.state?.returnContext ?? null,
      taskId: model.taskId,
      navigate,
      preferHistoryBack: pathnameProp === undefined,
    });
  }, [model.state?.returnContext, model.taskId, navigate, pathnameProp]);

  if (model.status === 'invalid_route') {
    return (
      <div
        className="entity-shell flex h-screen flex-col bg-[var(--bg-primary)] text-[var(--text-secondary)]"
        data-testid="workplane-shell"
        data-workplane-status="invalid_route"
        data-workplane-route={model.isWorkplaneRoute ? 'true' : 'false'}
      >
        <header className="flex items-center justify-between border-b border-[var(--border-primary)] px-4 py-3">
          <h1 className="text-sm font-semibold text-[var(--text-primary)]">Workplane</h1>
          <button
            type="button"
            className="mc-shell-btn rounded border border-[var(--border-primary)] px-2 py-1 text-[var(--text-primary)]"
            data-testid="workplane-return"
            data-return-surface="fallback"
            onClick={() =>
              navigateWorkplaneReturn({
                returnContext: null,
                taskId: null,
                navigate,
                preferHistoryBack: false,
              })
            }
          >
            Return to tasks
          </button>
        </header>
        <main className="flex flex-1 items-center justify-center p-6">
          <div
            className="mc-shell-card max-w-md rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-3 text-sm"
            role="alert"
            data-testid="workplane-invalid"
          >
            <p className="font-medium text-[var(--text-primary)]">Workplane unavailable</p>
            <p className="mt-1 text-[var(--text-muted)]">{model.invalidReason}</p>
          </div>
        </main>
      </div>
    );
  }

  const activePanelMeta = model.panels.find((panel) => panel.id === model.activePanel);

  return (
    <div
      className="entity-shell flex h-screen flex-col bg-[var(--bg-primary)] text-[var(--text-secondary)]"
      data-testid="workplane-shell"
      data-workplane-status="ready"
      data-workplane-task-id={String(model.taskId)}
      data-workplane-active-panel={model.activePanel ?? undefined}
      data-workplane-selected-proof={model.selectedProof ?? undefined}
      data-workplane-return-present={model.returnContext.present ? 'true' : 'false'}
      data-workplane-return-href={model.returnContext.href ?? undefined}
      data-workplane-href={model.serializedHref ?? undefined}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-primary)] px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Workplane</p>
          <h1 className="truncate text-sm font-semibold text-[var(--text-primary)]">
            Task {model.taskId}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
          {model.selectedProof ? (
            <span
              className="mc-shell-pill rounded border border-[var(--border-primary)] px-2 py-0.5"
              data-testid="workplane-selected-proof"
            >
              Proof: {model.selectedProof}
            </span>
          ) : (
            <span data-testid="workplane-selected-proof-empty">No proof selected</span>
          )}
          <button
            type="button"
            className="mc-shell-btn rounded border border-[var(--border-primary)] px-2 py-1 text-[var(--text-primary)]"
            data-testid="workplane-return"
            data-return-surface={model.returnContext.surface ?? 'fallback'}
            data-return-board={model.returnContext.board ?? undefined}
            data-return-board-tab={model.returnContext.boardTab ?? undefined}
            data-return-task={
              model.returnContext.taskId !== null ? String(model.returnContext.taskId) : undefined
            }
            data-return-path={model.returnContext.path ?? undefined}
            data-return-href={model.returnContext.href ?? undefined}
            aria-label={model.returnContext.label}
            onClick={handleReturn}
          >
            {model.returnContext.label}
          </button>
        </div>
      </header>

      <nav
        className="flex flex-wrap gap-1 border-b border-[var(--border-primary)] px-3 py-2"
        aria-label="Workplane panels"
        data-testid="workplane-panel-nav"
      >
        {model.panels.map((panel) => {
          const active = panel.id === model.activePanel;
          return (
            <button
              key={panel.id}
              type="button"
              className={`mc-shell-btn rounded px-2 py-1 text-[11px] ${
                active
                  ? 'mc-shell-btn-active text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)]'
              }`}
              aria-current={active ? 'page' : undefined}
              data-testid={`workplane-panel-tab-${panel.id}`}
              data-panel-id={panel.id}
              onClick={() => selectPanel(panel.id)}
            >
              {panel.label}
            </button>
          );
        })}
      </nav>

      <main className="flex-1 overflow-auto p-4" data-testid="workplane-panel-body">
        <div className="mc-shell-card rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-3">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            {activePanelMeta?.label ?? 'Panel'}
          </p>
          <p className="mt-1 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
            Placeholder — full panel ships in later Workplanes issues
          </p>
          <p className="mt-2 text-xs text-[var(--text-muted)]">{activePanelMeta?.notes}</p>
        </div>
      </main>
    </div>
  );
}
