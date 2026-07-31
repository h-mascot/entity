/**
 * THE-858 / WP1-A-03 — Minimal Workplane route shell.
 * THE-860 / WP1-A-05 — Return-to-board/detail navigation (never strand on shell).
 * THE-861 / WP1-A-06 — Cold load / refresh restores task + active panel from URL.
 * THE-862 / WP1-B-01 — Task summary panel with empty/loading/error/ready states.
 * THE-864 / WP1-B-03 — Proof bundle panel with raw/curated/external/unknown kinds.
 * THE-865 / WP1-B-04 — Files/docs panel linked to Doc Hub openers.
 * THE-866 / WP1-B-05 — Missing-proof warning panel (derived from proof bundle).
 * THE-867 / WP1-B-06 — Layout lock: humans own panel nav; agents cannot mutate layout.
 * THE-868 / WP1-B-07 — Narrow/mobile viewport smoke for Workplane panels.
 * THE-871 / WP1-C-03 — Activity/progress panel (THE-869 spine via THE-870 API).
 * THE-873 / WP1-C-05 — Comments/review checklist panel via existing reviewActions.
 * THE-874 / WP1-C-06 — Review gate: missing proof cannot present as review-ready.
 * THE-875 / WP1-C-07 — Slice-1 E2E proof pack (with/without/raw/linked/refresh).
 *
 * Parses/serializes THE-857 URL state. All Q33 Slice-1 panel bodies are implemented.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WorkplanePanelId } from '../mission-control/taskDetailWorkplaneSeams.ts';
import { navigateWorkplaneReturn } from '../../lib/workplaneReturnNavigation.ts';
import { restoreWorkplaneAfterRefresh } from '../../lib/workplaneRefreshRestore.ts';
import {
  resolveLockedWorkplaneLayout,
  selectWorkplanePanelAsHuman,
} from '../../lib/workplaneLayoutLock.ts';
import {
  buildWorkplanePanelHref,
  buildWorkplaneProofHref,
  resolveWorkplaneShellModel,
  type WorkplaneShellModel,
} from '../../lib/workplaneShellModel.ts';
import {
  createWorkplaneProofBundleLoadState,
  fetchWorkplaneProofBundle,
  workplaneProofBundleErrorMessage,
  type WorkplaneProofBundleLoadState,
} from '../../lib/workplaneProofBundle.ts';
import type { ProofBundle } from '../../lib/proofBundle.ts';
import {
  createWorkplaneFilesDocsLoadState,
  fetchWorkplaneFilesDocs,
  workplaneFilesDocsErrorMessage,
  type WorkplaneFilesDocsBundle,
  type WorkplaneFilesDocsLoadState,
} from '../../lib/workplaneFilesDocs.ts';
import {
  createWorkplaneTaskSummaryLoadState,
  fetchWorkplaneTaskSummary,
  workplaneTaskSummaryErrorMessage,
  type WorkplaneTaskSummaryLoadState,
  type WorkplaneTaskSummaryView,
} from '../../lib/workplaneTaskSummary.ts';
import {
  createWorkplaneActivityProgressLoadState,
  fetchWorkplaneActivityProgress,
  workplaneActivityProgressErrorMessage,
  type ActivityProgressBundle,
  type WorkplaneActivityProgressLoadState,
} from '../../lib/workplaneActivityProgress.ts';
import {
  createWorkplaneCommentsReviewLoadState,
  fetchWorkplaneCommentsReview,
  workplaneCommentsReviewErrorMessage,
  type CommentsReviewBundle,
  type WorkplaneCommentsReviewLoadState,
} from '../../lib/workplaneCommentsReview.ts';
import { buildMissingProofWarningView } from '../../lib/workplaneMissingProof.ts';
import {
  applyReviewGateToCommentsReviewLoadState,
  evaluateWorkplaneReviewGate,
} from '../../lib/workplaneReviewGate.ts';
import {
  workplaneNarrowDomAttrs,
  workplanePanelBodyNarrowClassNames,
  workplanePanelNavNarrowClassNames,
  workplaneShellNarrowClassNames,
} from '../../lib/workplaneNarrowViewport.ts';
import ActivityProgressPanel from './ActivityProgressPanel.tsx';
import CommentsReviewChecklistPanel from './CommentsReviewChecklistPanel.tsx';
import FilesDocsPanel from './FilesDocsPanel.tsx';
import MissingProofWarningPanel from './MissingProofWarningPanel.tsx';
import ProofBundlePanel from './ProofBundlePanel.tsx';
import TaskSummaryPanel from './TaskSummaryPanel.tsx';

export interface WorkplaneShellProps {
  /** Optional location override for tests; defaults to window.location. */
  pathname?: string;
  search?: string;
  /** Called when the shell navigates (panel change / return). Defaults to history API. */
  onNavigate?: (href: string, options?: { replace?: boolean; state?: unknown }) => void;
  /** Optional API base for task summary / proof bundle / files-docs fetch. */
  apiBase?: string;
  /**
   * Optional summary loader override (tests / Storybook).
   * Return null → empty; throw → error; summary → ready.
   */
  loadTaskSummary?: (taskId: number) => Promise<WorkplaneTaskSummaryView | null>;
  /** Optional controlled summary state (skips fetch when provided). */
  taskSummaryState?: WorkplaneTaskSummaryLoadState;
  /**
   * Optional proof-bundle loader override (tests / Storybook).
   * Return null → empty; throw → error; bundle → ready.
   */
  loadProofBundle?: (taskId: number) => Promise<ProofBundle | null>;
  /** Optional controlled proof bundle state (skips fetch when provided). */
  proofBundleState?: WorkplaneProofBundleLoadState;
  /**
   * Optional files/docs loader override (tests / Storybook).
   * Return null → empty; throw → error; bundle → ready.
   */
  loadFilesDocs?: (taskId: number) => Promise<WorkplaneFilesDocsBundle | null>;
  /** Optional controlled files/docs state (skips fetch when provided). */
  filesDocsState?: WorkplaneFilesDocsLoadState;
  /**
   * Optional activity/progress loader override (tests / Storybook).
   * Return null → empty; throw → error; bundle → ready.
   */
  loadActivityProgress?: (taskId: number) => Promise<ActivityProgressBundle | null>;
  /** Optional controlled activity/progress state (skips fetch when provided). */
  activityProgressState?: WorkplaneActivityProgressLoadState;
  /**
   * Optional comments/review loader override (tests / Storybook).
   * Return null → empty; throw → error; bundle → ready.
   */
  loadCommentsReview?: (taskId: number) => Promise<CommentsReviewBundle | null>;
  /** Optional controlled comments/review state (skips fetch when provided). */
  commentsReviewState?: WorkplaneCommentsReviewLoadState;
  /**
   * Optional agent/task payload that may attempt layout mutation (THE-867).
   * Always fail-closed: canonical panels + human/URL active panel win.
   */
  agentLayoutPayload?: unknown;
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
  apiBase = '',
  loadTaskSummary,
  taskSummaryState: controlledSummary,
  loadProofBundle,
  proofBundleState: controlledProof,
  loadFilesDocs,
  filesDocsState: controlledFilesDocs,
  loadActivityProgress,
  activityProgressState: controlledActivity,
  loadCommentsReview,
  commentsReviewState: controlledCommentsReview,
  agentLayoutPayload,
}: WorkplaneShellProps) {
  const [location, setLocation] = useState(() => readLocation(pathnameProp, searchProp));
  const [summaryLoad, setSummaryLoad] = useState<WorkplaneTaskSummaryLoadState>(() =>
    createWorkplaneTaskSummaryLoadState({ status: 'loading' }),
  );
  const [summaryReloadToken, setSummaryReloadToken] = useState(0);
  const [proofLoad, setProofLoad] = useState<WorkplaneProofBundleLoadState>(() =>
    createWorkplaneProofBundleLoadState({ status: 'loading' }),
  );
  const [proofReloadToken, setProofReloadToken] = useState(0);
  const [filesDocsLoad, setFilesDocsLoad] = useState<WorkplaneFilesDocsLoadState>(() =>
    createWorkplaneFilesDocsLoadState({ status: 'loading' }),
  );
  const [filesDocsReloadToken, setFilesDocsReloadToken] = useState(0);
  const [activityLoad, setActivityLoad] = useState<WorkplaneActivityProgressLoadState>(() =>
    createWorkplaneActivityProgressLoadState({ status: 'loading' }),
  );
  const [activityReloadToken, setActivityReloadToken] = useState(0);
  const [commentsReviewLoad, setCommentsReviewLoad] = useState<WorkplaneCommentsReviewLoadState>(
    () => createWorkplaneCommentsReviewLoadState({ status: 'loading' }),
  );
  const [commentsReviewReloadToken, setCommentsReviewReloadToken] = useState(0);
  /** Browser-proof / test fixture for agent layout attacks (never trusted). */
  const [fixtureAgentLayoutPayload, setFixtureAgentLayoutPayload] = useState<unknown>(null);

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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const readFixture = () => {
      const w = window as Window & {
        __ENTITY_WORKPLANE_AGENT_LAYOUT_PAYLOAD__?: unknown;
      };
      if ('__ENTITY_WORKPLANE_AGENT_LAYOUT_PAYLOAD__' in w) {
        setFixtureAgentLayoutPayload(w.__ENTITY_WORKPLANE_AGENT_LAYOUT_PAYLOAD__ ?? null);
      }
    };
    const onAttack = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      setFixtureAgentLayoutPayload(detail ?? null);
    };
    readFixture();
    window.addEventListener('entity:workplane-agent-layout-attack', onAttack as EventListener);
    return () => {
      window.removeEventListener('entity:workplane-agent-layout-attack', onAttack as EventListener);
    };
  }, []);

  const effectiveAgentLayoutPayload = agentLayoutPayload ?? fixtureAgentLayoutPayload;

  // THE-861: restore from pathname+search; THE-867: reject agent layout payloads.
  const model: WorkplaneShellModel = useMemo(() => {
    const restored = restoreWorkplaneAfterRefresh(location.pathname, location.search).model;
    if (!effectiveAgentLayoutPayload) {
      return restored;
    }
    // Re-resolve with agent payload so layout lock rejects smuggled mutations.
    return resolveWorkplaneShellModel(location.pathname, location.search, {
      agentLayoutPayload: effectiveAgentLayoutPayload,
    });
  }, [location.pathname, location.search, effectiveAgentLayoutPayload]);
  const restoredFromUrl = model.status === 'ready';

  const layoutLockView = useMemo(
    () =>
      resolveLockedWorkplaneLayout({
        activePanel: model.activePanel,
        agentPayload: effectiveAgentLayoutPayload,
      }),
    [model.activePanel, effectiveAgentLayoutPayload],
  );

  const navigate = onNavigate ?? defaultNavigate;

  const selectPanel = useCallback(
    (panel: WorkplanePanelId) => {
      if (!model.state) {
        return;
      }
      // THE-867: human panel navigation only; structural/agent mutations never apply here.
      const nav = selectWorkplanePanelAsHuman(model.activePanel, panel);
      if (!nav.accepted) {
        return;
      }
      const href = buildWorkplanePanelHref(model.state, nav.activePanel);
      navigate(href, { replace: true, state: { mode: 'workplane', returnHref: model.returnContext.href } });
      if (pathnameProp === undefined) {
        setLocation({
          pathname: new URL(href, 'https://entity.local').pathname,
          search: new URL(href, 'https://entity.local').search,
        });
      }
    },
    [model.state, model.activePanel, model.returnContext.href, navigate, pathnameProp],
  );

  const handleReturn = useCallback(() => {
    navigateWorkplaneReturn({
      returnContext: model.state?.returnContext ?? null,
      taskId: model.taskId,
      navigate,
      preferHistoryBack: pathnameProp === undefined,
    });
  }, [model.state?.returnContext, model.taskId, navigate, pathnameProp]);

  const retrySummary = useCallback(() => {
    setSummaryReloadToken((token) => token + 1);
  }, []);

  const retryProof = useCallback(() => {
    setProofReloadToken((token) => token + 1);
  }, []);

  const retryFilesDocs = useCallback(() => {
    setFilesDocsReloadToken((token) => token + 1);
  }, []);

  const retryActivity = useCallback(() => {
    setActivityReloadToken((token) => token + 1);
  }, []);

  const retryCommentsReview = useCallback(() => {
    setCommentsReviewReloadToken((token) => token + 1);
  }, []);

  const selectProof = useCallback(
    (proofToken: string | null) => {
      if (!model.state) {
        return;
      }
      const href = buildWorkplaneProofHref(model.state, proofToken);
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

  useEffect(() => {
    if (controlledSummary) {
      return;
    }

    const taskId = model.status === 'ready' ? model.taskId : null;
    if (taskId === null) {
      setSummaryLoad(createWorkplaneTaskSummaryLoadState({ status: 'empty', taskId: null }));
      return;
    }

    let cancelled = false;
    setSummaryLoad(createWorkplaneTaskSummaryLoadState({ status: 'loading', taskId }));

    const loader = loadTaskSummary ?? ((id: number) => fetchWorkplaneTaskSummary(id, apiBase));

    void loader(taskId)
      .then((summary) => {
        if (cancelled) return;
        if (!summary) {
          setSummaryLoad(createWorkplaneTaskSummaryLoadState({ status: 'empty', taskId }));
          return;
        }
        setSummaryLoad(
          createWorkplaneTaskSummaryLoadState({
            status: 'ready',
            taskId: summary.taskId,
            summary,
          }),
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSummaryLoad(
          createWorkplaneTaskSummaryLoadState({
            status: 'error',
            taskId,
            errorMessage: workplaneTaskSummaryErrorMessage(error),
          }),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    apiBase,
    controlledSummary,
    loadTaskSummary,
    model.status,
    model.taskId,
    summaryReloadToken,
  ]);

  useEffect(() => {
    if (controlledProof) {
      return;
    }

    const taskId = model.status === 'ready' ? model.taskId : null;
    if (taskId === null) {
      setProofLoad(createWorkplaneProofBundleLoadState({ status: 'empty', taskId: null }));
      return;
    }

    let cancelled = false;
    setProofLoad(createWorkplaneProofBundleLoadState({ status: 'loading', taskId }));

    const loader = loadProofBundle ?? ((id: number) => fetchWorkplaneProofBundle(id, apiBase));

    void loader(taskId)
      .then((bundle) => {
        if (cancelled) return;
        if (!bundle) {
          setProofLoad(createWorkplaneProofBundleLoadState({ status: 'empty', taskId }));
          return;
        }
        setProofLoad(
          createWorkplaneProofBundleLoadState({
            status: 'ready',
            taskId: bundle.taskId ?? taskId,
            bundle,
          }),
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setProofLoad(
          createWorkplaneProofBundleLoadState({
            status: 'error',
            taskId,
            errorMessage: workplaneProofBundleErrorMessage(error),
          }),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    apiBase,
    controlledProof,
    loadProofBundle,
    model.status,
    model.taskId,
    proofReloadToken,
  ]);

  useEffect(() => {
    if (controlledFilesDocs) {
      return;
    }

    const taskId = model.status === 'ready' ? model.taskId : null;
    if (taskId === null) {
      setFilesDocsLoad(createWorkplaneFilesDocsLoadState({ status: 'empty', taskId: null }));
      return;
    }

    let cancelled = false;
    setFilesDocsLoad(createWorkplaneFilesDocsLoadState({ status: 'loading', taskId }));

    const loader = loadFilesDocs ?? ((id: number) => fetchWorkplaneFilesDocs(id, apiBase));

    void loader(taskId)
      .then((bundle) => {
        if (cancelled) return;
        if (!bundle) {
          setFilesDocsLoad(createWorkplaneFilesDocsLoadState({ status: 'empty', taskId }));
          return;
        }
        setFilesDocsLoad(
          createWorkplaneFilesDocsLoadState({
            status: 'ready',
            taskId: bundle.taskId ?? taskId,
            bundle,
          }),
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFilesDocsLoad(
          createWorkplaneFilesDocsLoadState({
            status: 'error',
            taskId,
            errorMessage: workplaneFilesDocsErrorMessage(error),
          }),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    apiBase,
    controlledFilesDocs,
    loadFilesDocs,
    model.status,
    model.taskId,
    filesDocsReloadToken,
  ]);

  useEffect(() => {
    if (controlledActivity) {
      return;
    }

    const taskId = model.status === 'ready' ? model.taskId : null;
    if (taskId === null) {
      setActivityLoad(createWorkplaneActivityProgressLoadState({ status: 'empty', taskId: null }));
      return;
    }

    let cancelled = false;
    setActivityLoad(createWorkplaneActivityProgressLoadState({ status: 'loading', taskId }));

    const loader =
      loadActivityProgress ?? ((id: number) => fetchWorkplaneActivityProgress(id, apiBase));

    void loader(taskId)
      .then((bundle) => {
        if (cancelled) return;
        if (!bundle) {
          setActivityLoad(createWorkplaneActivityProgressLoadState({ status: 'empty', taskId }));
          return;
        }
        setActivityLoad(
          createWorkplaneActivityProgressLoadState({
            status: 'ready',
            taskId: bundle.taskId ?? taskId,
            bundle,
          }),
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setActivityLoad(
          createWorkplaneActivityProgressLoadState({
            status: 'error',
            taskId,
            errorMessage: workplaneActivityProgressErrorMessage(error),
          }),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    apiBase,
    controlledActivity,
    loadActivityProgress,
    model.status,
    model.taskId,
    activityReloadToken,
  ]);

  useEffect(() => {
    if (controlledCommentsReview) {
      return;
    }

    const taskId = model.status === 'ready' ? model.taskId : null;
    if (taskId === null) {
      setCommentsReviewLoad(
        createWorkplaneCommentsReviewLoadState({ status: 'empty', taskId: null }),
      );
      return;
    }

    let cancelled = false;
    setCommentsReviewLoad(
      createWorkplaneCommentsReviewLoadState({ status: 'loading', taskId }),
    );

    const loader =
      loadCommentsReview ?? ((id: number) => fetchWorkplaneCommentsReview(id, apiBase));

    void loader(taskId)
      .then((bundle) => {
        if (cancelled) return;
        if (!bundle) {
          setCommentsReviewLoad(
            createWorkplaneCommentsReviewLoadState({ status: 'empty', taskId }),
          );
          return;
        }
        setCommentsReviewLoad(
          createWorkplaneCommentsReviewLoadState({
            status: 'ready',
            taskId: bundle.taskId ?? taskId,
            bundle,
          }),
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setCommentsReviewLoad(
          createWorkplaneCommentsReviewLoadState({
            status: 'error',
            taskId,
            errorMessage: workplaneCommentsReviewErrorMessage(error),
          }),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    apiBase,
    controlledCommentsReview,
    loadCommentsReview,
    model.status,
    model.taskId,
    commentsReviewReloadToken,
  ]);

  const summaryState = controlledSummary ?? summaryLoad;
  const proofState = controlledProof ?? proofLoad;
  const filesDocsState = controlledFilesDocs ?? filesDocsLoad;
  const activityState = controlledActivity ?? activityLoad;
  const commentsReviewState = controlledCommentsReview ?? commentsReviewLoad;
  const missingProofView = buildMissingProofWarningView(proofState);
  const reviewGate = evaluateWorkplaneReviewGate({
    missingProof: missingProofView,
    commentsReview: commentsReviewState,
  });
  const gatedCommentsReviewState = applyReviewGateToCommentsReviewLoadState(
    commentsReviewState,
    reviewGate,
  );

  const narrowAttrs = workplaneNarrowDomAttrs();

  if (model.status === 'invalid_route') {
    return (
      <div
        className={workplaneShellNarrowClassNames()}
        data-testid="workplane-shell"
        data-workplane-status="invalid_route"
        data-workplane-restored-from-url="false"
        data-workplane-route={model.isWorkplaneRoute ? 'true' : 'false'}
        data-workplane-layout-locked={narrowAttrs['data-workplane-layout-locked']}
        data-workplane-layout-version={model.layoutVersion}
        data-workplane-layout-owner="human"
        data-workplane-panel-order={model.panelOrder}
        data-workplane-layout-intact="true"
        data-workplane-agent-layout-rejected={
          layoutLockView.rejectedAttempts.length > 0 ? 'true' : 'false'
        }
        data-workplane-narrow-ready={narrowAttrs['data-workplane-narrow-ready']}
        data-workplane-viewport-smoke={narrowAttrs['data-workplane-viewport-smoke']}
        data-workplane-overflow-policy={narrowAttrs['data-workplane-overflow-policy']}
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
        <main className="flex flex-1 flex-col gap-4 overflow-auto p-6">
          <div
            className="mc-shell-card mx-auto max-w-md rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-3 text-sm"
            role="alert"
            data-testid="workplane-invalid"
          >
            <p className="font-medium text-[var(--text-primary)]">Workplane unavailable</p>
            <p className="mt-1 text-[var(--text-muted)]">{model.invalidReason}</p>
          </div>
          <div className="mx-auto flex w-full max-w-md flex-col gap-3">
            <TaskSummaryPanel
              loadState={createWorkplaneTaskSummaryLoadState({ status: 'empty', taskId: null })}
            />
            <ProofBundlePanel
              loadState={createWorkplaneProofBundleLoadState({ status: 'empty', taskId: null })}
            />
            <FilesDocsPanel
              loadState={createWorkplaneFilesDocsLoadState({ status: 'empty', taskId: null })}
            />
            <ActivityProgressPanel
              loadState={createWorkplaneActivityProgressLoadState({
                status: 'empty',
                taskId: null,
              })}
            />
            <CommentsReviewChecklistPanel
              loadState={createWorkplaneCommentsReviewLoadState({
                status: 'empty',
                taskId: null,
              })}
              reviewGate={evaluateWorkplaneReviewGate({
                missingProof: buildMissingProofWarningView(
                  createWorkplaneProofBundleLoadState({ status: 'empty', taskId: null }),
                ),
                commentsReview: createWorkplaneCommentsReviewLoadState({
                  status: 'empty',
                  taskId: null,
                }),
              })}
            />
            <MissingProofWarningPanel
              proofLoadState={createWorkplaneProofBundleLoadState({
                status: 'empty',
                taskId: null,
              })}
            />
          </div>
        </main>
      </div>
    );
  }

  const activePanelMeta = model.panels.find((panel) => panel.id === model.activePanel);
  const showTaskSummary =
    model.activePanel === 'task_summary' || model.activePanel === null;
  const showProofBundle = model.activePanel === 'proof_bundle';
  const showFilesDocs = model.activePanel === 'files_docs';
  const showActivityProgress = model.activePanel === 'activity_progress';
  const showCommentsReview = model.activePanel === 'comments_review_checklist';
  const showMissingProof = model.activePanel === 'missing_proof_warnings';

  const headerTitle =
    summaryState.status === 'ready' && summaryState.summary
      ? summaryState.summary.title
      : `Task ${model.taskId}`;

  return (
    <div
      className={workplaneShellNarrowClassNames()}
      data-testid="workplane-shell"
      data-workplane-status="ready"
      data-workplane-restored-from-url={restoredFromUrl ? 'true' : 'false'}
      data-workplane-task-id={String(model.taskId)}
      data-workplane-active-panel={model.activePanel ?? undefined}
      data-workplane-selected-proof={model.selectedProof ?? undefined}
      data-workplane-return-present={model.returnContext.present ? 'true' : 'false'}
      data-workplane-return-href={model.returnContext.href ?? undefined}
      data-workplane-href={model.serializedHref ?? undefined}
      data-workplane-summary-status={summaryState.status}
      data-workplane-proof-status={proofState.status}
      data-workplane-files-docs-status={filesDocsState.status}
      data-workplane-activity-status={activityState.status}
      data-workplane-comments-review-status={commentsReviewState.status}
      data-workplane-missing-proof-status={missingProofView.status}
      data-workplane-missing-proof-warning-visible={
        missingProofView.warningVisible ? 'true' : 'false'
      }
      data-workplane-review-ready={reviewGate.reviewReady ? 'true' : 'false'}
      data-workplane-review-gate-blocked={reviewGate.blocked ? 'true' : 'false'}
      data-workplane-missing-proof-blocks={reviewGate.missingProofBlocks ? 'true' : 'false'}
      data-workplane-layout-locked={narrowAttrs['data-workplane-layout-locked']}
      data-workplane-layout-version={model.layoutVersion}
      data-workplane-layout-owner="human"
      data-workplane-panel-order={model.panelOrder}
      data-workplane-layout-intact="true"
      data-workplane-agent-layout-rejected={
        layoutLockView.rejectedAttempts.length > 0 ? 'true' : 'false'
      }
      data-workplane-narrow-ready={narrowAttrs['data-workplane-narrow-ready']}
      data-workplane-viewport-smoke={narrowAttrs['data-workplane-viewport-smoke']}
      data-workplane-overflow-policy={narrowAttrs['data-workplane-overflow-policy']}
    >
      <header className="workplane-shell-header flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-primary)] px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Workplane</p>
          <h1 className="truncate text-sm font-semibold text-[var(--text-primary)]">
            {headerTitle}
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
        className={workplanePanelNavNarrowClassNames()}
        aria-label="Workplane panels"
        data-testid="workplane-panel-nav"
      >
        {model.panels.map((panel) => {
          const active = panel.id === model.activePanel;
          return (
            <button
              key={panel.id}
              type="button"
              className={`mc-shell-btn workplane-panel-tab rounded px-2 py-1 text-[11px] ${
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

      <main className={workplanePanelBodyNarrowClassNames()} data-testid="workplane-panel-body">
        {showTaskSummary ? (
          <TaskSummaryPanel loadState={summaryState} onRetry={retrySummary} />
        ) : null}
        {showProofBundle ? (
          <ProofBundlePanel
            loadState={proofState}
            selectedProof={model.selectedProof}
            onSelectProof={selectProof}
            onRetry={retryProof}
          />
        ) : null}
        {showFilesDocs ? (
          <FilesDocsPanel loadState={filesDocsState} onRetry={retryFilesDocs} />
        ) : null}
        {showActivityProgress ? (
          <ActivityProgressPanel loadState={activityState} onRetry={retryActivity} />
        ) : null}
        {showCommentsReview ? (
          <CommentsReviewChecklistPanel
            loadState={gatedCommentsReviewState}
            reviewGate={reviewGate}
            onRetry={retryCommentsReview}
          />
        ) : null}
        {showMissingProof ? (
          <MissingProofWarningPanel
            proofLoadState={proofState}
            view={missingProofView}
            onRetry={retryProof}
          />
        ) : null}
        {!showTaskSummary &&
        !showProofBundle &&
        !showFilesDocs &&
        !showActivityProgress &&
        !showCommentsReview &&
        !showMissingProof ? (
          <div className="mc-shell-card rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-3">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {activePanelMeta?.label ?? 'Panel'}
            </p>
            <p className="mt-1 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
              Placeholder — full panel ships in later Workplanes issues
            </p>
            <p className="mt-2 text-xs text-[var(--text-muted)]">{activePanelMeta?.notes}</p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
