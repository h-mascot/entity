/**
 * THE-875 / WP1-C-07 — Workplanes slice 1 end-to-end proof pack contract.
 *
 * Durable scenario definitions for the integrated user-facing slice:
 * with-proof, without-proof/missing-proof, raw proof, linked doc, refresh.
 * Browser harnesses and focused tests share this contract so the pack stays
 * accurate as panel internals evolve.
 */

import { normalizeProofBundle } from './proofBundle.ts';
import { normalizeWorkplaneFilesDocs } from './workplaneFilesDocs.ts';
import { buildMissingProofWarningView } from './workplaneMissingProof.ts';
import {
  countProofBundleKinds,
  createWorkplaneProofBundleLoadState,
  toProofBundleSelectionToken,
} from './workplaneProofBundle.ts';
import { restoreWorkplaneAfterRefresh } from './workplaneRefreshRestore.ts';
import { serializeWorkplaneUrlState, type WorkplaneUrlState } from './workplaneUrlState.ts';
import type { WorkplanePanelId } from '../components/mission-control/taskDetailWorkplaneSeams.ts';

export const WORKPLANE_SLICE1_E2E_ISSUE = 'THE-875';
export const WORKPLANE_SLICE1_E2E_CODE = 'WP1-C-07';

export type WorkplaneSlice1E2EScenarioId =
  | 'with_proof'
  | 'without_proof'
  | 'raw_proof'
  | 'linked_doc'
  | 'refresh';

export interface WorkplaneSlice1E2EScenario {
  id: WorkplaneSlice1E2EScenarioId;
  title: string;
  panel: WorkplanePanelId;
  /** Fixture key used by pack fixtures / browser seed. */
  fixture: 'with_proof' | 'without_proof';
  requiresSelectedProof?: boolean;
  requiresRefreshRoundTrip?: boolean;
  expect: {
    shellStatus: 'ready';
    proofEmpty: boolean;
    missingProofWarningVisible: boolean;
    hasRawProofKind: boolean;
    hasLinkedDocOpener: boolean;
    restoredFromUrl?: boolean;
  };
}

/** Canonical Slice-1 E2E scenarios required by WP1-C-07 / source packet Q33+Q36+Q37. */
export const WORKPLANE_SLICE1_E2E_SCENARIOS: readonly WorkplaneSlice1E2EScenario[] = [
  {
    id: 'with_proof',
    title: 'Task with proof bundle present',
    panel: 'proof_bundle',
    fixture: 'with_proof',
    expect: {
      shellStatus: 'ready',
      proofEmpty: false,
      missingProofWarningVisible: false,
      hasRawProofKind: true,
      hasLinkedDocOpener: true,
    },
  },
  {
    id: 'without_proof',
    title: 'Task without proof shows missing-proof warning',
    panel: 'missing_proof_warnings',
    fixture: 'without_proof',
    expect: {
      shellStatus: 'ready',
      proofEmpty: true,
      missingProofWarningVisible: true,
      hasRawProofKind: false,
      hasLinkedDocOpener: false,
    },
  },
  {
    id: 'raw_proof',
    title: 'Raw proof artifact selectable in proof bundle',
    panel: 'proof_bundle',
    fixture: 'with_proof',
    requiresSelectedProof: true,
    expect: {
      shellStatus: 'ready',
      proofEmpty: false,
      missingProofWarningVisible: false,
      hasRawProofKind: true,
      hasLinkedDocOpener: true,
    },
  },
  {
    id: 'linked_doc',
    title: 'Linked native doc opens via Doc Hub pattern',
    panel: 'files_docs',
    fixture: 'with_proof',
    expect: {
      shellStatus: 'ready',
      proofEmpty: false,
      missingProofWarningVisible: false,
      hasRawProofKind: true,
      hasLinkedDocOpener: true,
    },
  },
  {
    id: 'refresh',
    title: 'Deep-link refresh restores task, panel, and selected proof',
    panel: 'proof_bundle',
    fixture: 'with_proof',
    requiresSelectedProof: true,
    requiresRefreshRoundTrip: true,
    expect: {
      shellStatus: 'ready',
      proofEmpty: false,
      missingProofWarningVisible: false,
      hasRawProofKind: true,
      hasLinkedDocOpener: true,
      restoredFromUrl: true,
    },
  },
] as const;

/**
 * Clear with-proof fixture: usable raw receipt + curated/native linked doc.
 * Intentionally omits unknown-only artifacts so missing-proof stays clear
 * (contrast without_proof). Raw + linked-doc scenarios still pass.
 */
export const WORKPLANE_SLICE1_E2E_WITH_PROOF_TASK = {
  id: 8751,
  name: 'THE-875 with proof / raw / linked doc',
  column: 'review',
  output: [
    '[raw proof](/docs/output/entity/wp1-c-07/raw.md)',
    '[curated doc](/docs/workspace/docs/notes/plan.md)',
  ].join('\n'),
  metadata: {
    evidence_summary: 'Slice-1 E2E clear proof for THE-875.',
    phase2_receipt: {
      artifact_id: 'receipt_wp1_c_07',
      artifact_kind: 'raw_task_receipt',
      human_path_alias: '/docs/output/entity/wp1-c-07/receipt.md',
      status: 'present',
      integrity_state: 'valid',
      availability_state: 'available',
      receipt_status: 'created',
    },
    native_documents: [
      {
        id: 'native_plan',
        title: 'Plan note',
        object_type: 'native_document',
        path: '/docs/workspace/docs/notes/plan.md',
      },
    ],
    review_decision: 'accepted',
    review_type: 'peer',
    reviewed_by: 'henry',
    reviewed_at: '2026-07-31T03:19:00.000Z',
  },
} as const;

/** Empty fixture: no output/evidence → missing-proof warning. */
export const WORKPLANE_SLICE1_E2E_WITHOUT_PROOF_TASK = {
  id: 8750,
  name: 'THE-875 without proof / missing proof',
  column: 'review',
  output: '',
  metadata: {
    review_decision: 'accepted',
    review_type: 'peer',
    reviewed_by: 'henry',
    reviewed_at: '2026-07-31T03:19:00.000Z',
  },
} as const;

export function getWorkplaneSlice1E2EScenario(
  id: WorkplaneSlice1E2EScenarioId,
): WorkplaneSlice1E2EScenario {
  const scenario = WORKPLANE_SLICE1_E2E_SCENARIOS.find((entry) => entry.id === id);
  if (!scenario) {
    throw new Error(`Unknown Workplane Slice-1 E2E scenario: ${id}`);
  }
  return scenario;
}

export function workplaneSlice1E2EFixtureTask(fixture: 'with_proof' | 'without_proof') {
  return fixture === 'with_proof'
    ? WORKPLANE_SLICE1_E2E_WITH_PROOF_TASK
    : WORKPLANE_SLICE1_E2E_WITHOUT_PROOF_TASK;
}

/** First URL-safe raw proof selection token from the with-proof fixture. */
export function workplaneSlice1E2ERawProofToken(): string {
  const bundle = normalizeProofBundle(WORKPLANE_SLICE1_E2E_WITH_PROOF_TASK);
  const raw = bundle.items.find((item) => item.kind === 'raw');
  if (!raw) {
    throw new Error('with-proof fixture missing raw proof item');
  }
  const token = toProofBundleSelectionToken(raw);
  if (!token) {
    throw new Error(`raw proof item ${raw.id} has no URL-safe selection token`);
  }
  return token;
}

export function buildWorkplaneSlice1E2EHref(input: {
  taskId: number;
  panel: WorkplanePanelId;
  selectedProof?: string | null;
  returnPath?: string | null;
}): string {
  const state: WorkplaneUrlState = {
    taskId: input.taskId,
    activePanel: input.panel,
    selectedProof: input.selectedProof ?? null,
    returnContext: input.returnPath
      ? {
          surface: 'detail',
          taskId: input.taskId,
          path: input.returnPath,
        }
      : null,
  };
  return serializeWorkplaneUrlState(state);
}

export interface WorkplaneSlice1E2EEval {
  scenarioId: WorkplaneSlice1E2EScenarioId;
  pass: boolean;
  proofEmpty: boolean;
  missingProofWarningVisible: boolean;
  hasRawProofKind: boolean;
  hasLinkedDocOpener: boolean;
  rawProofToken: string | null;
  linkedDocHref: string | null;
  restoredFromUrl: boolean | null;
  failures: string[];
}

/** Pure evaluation of a scenario against fixture-derived models (no DOM). */
export function evaluateWorkplaneSlice1E2EScenario(
  scenarioId: WorkplaneSlice1E2EScenarioId,
  options?: { taskIdOverride?: number },
): WorkplaneSlice1E2EEval {
  const scenario = getWorkplaneSlice1E2EScenario(scenarioId);
  const task = workplaneSlice1E2EFixtureTask(scenario.fixture);
  const taskId = options?.taskIdOverride ?? task.id;
  const proofBundle = normalizeProofBundle({ ...task, id: taskId });
  const proofLoad = createWorkplaneProofBundleLoadState({
    status: 'ready',
    bundle: proofBundle,
  });
  const missing = buildMissingProofWarningView(proofLoad);
  const filesDocs = normalizeWorkplaneFilesDocs({ ...task, id: taskId });
  const kindCounts = countProofBundleKinds(proofBundle);
  const linked = filesDocs.items.find(
    (item) => item.opener.kind === 'doc_hub' && (item.opener.href ?? '').startsWith('/docs/source/'),
  );
  const rawToken =
    scenario.fixture === 'with_proof'
      ? (() => {
          try {
            return workplaneSlice1E2ERawProofToken();
          } catch {
            return null;
          }
        })()
      : null;

  let restoredFromUrl: boolean | null = null;
  if (scenario.requiresRefreshRoundTrip) {
    const href = buildWorkplaneSlice1E2EHref({
      taskId,
      panel: scenario.panel,
      selectedProof: rawToken,
      returnPath: `/task/${taskId}`,
    });
    const url = new URL(href, 'http://localhost');
    const restored = restoreWorkplaneAfterRefresh(url.pathname, url.search);
    restoredFromUrl =
      restored.restored === true &&
      restored.model.status === 'ready' &&
      restored.model.taskId === taskId &&
      restored.model.activePanel === scenario.panel &&
      restored.model.selectedProof === rawToken;
  }

  const failures: string[] = [];
  const proofEmpty = proofBundle.empty;
  const missingProofWarningVisible = missing.warningVisible === true;
  const hasRawProofKind = kindCounts.raw >= 1;
  const hasLinkedDocOpener = Boolean(linked);

  if (proofEmpty !== scenario.expect.proofEmpty) {
    failures.push(`proofEmpty expected ${scenario.expect.proofEmpty}, got ${proofEmpty}`);
  }
  if (missingProofWarningVisible !== scenario.expect.missingProofWarningVisible) {
    failures.push(
      `missingProofWarningVisible expected ${scenario.expect.missingProofWarningVisible}, got ${missingProofWarningVisible}`,
    );
  }
  if (hasRawProofKind !== scenario.expect.hasRawProofKind) {
    failures.push(`hasRawProofKind expected ${scenario.expect.hasRawProofKind}, got ${hasRawProofKind}`);
  }
  if (hasLinkedDocOpener !== scenario.expect.hasLinkedDocOpener) {
    failures.push(
      `hasLinkedDocOpener expected ${scenario.expect.hasLinkedDocOpener}, got ${hasLinkedDocOpener}`,
    );
  }
  if (scenario.requiresSelectedProof && !rawToken) {
    failures.push('requiresSelectedProof but raw proof token missing');
  }
  if (scenario.expect.restoredFromUrl === true && restoredFromUrl !== true) {
    failures.push('refresh round-trip did not restore task/panel/selectedProof');
  }

  return {
    scenarioId,
    pass: failures.length === 0,
    proofEmpty,
    missingProofWarningVisible,
    hasRawProofKind,
    hasLinkedDocOpener,
    rawProofToken: rawToken,
    linkedDocHref: linked?.opener.href ?? null,
    restoredFromUrl,
    failures,
  };
}

export function evaluateAllWorkplaneSlice1E2EScenarios(): WorkplaneSlice1E2EEval[] {
  return WORKPLANE_SLICE1_E2E_SCENARIOS.map((scenario) =>
    evaluateWorkplaneSlice1E2EScenario(scenario.id),
  );
}
