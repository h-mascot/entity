/**
 * THE-866 / WP1-B-05 — Missing-proof warning detection for Workplane.
 *
 * Derives an explicit warning view from the existing ProofBundle load envelope
 * (THE-863/THE-864). Fail-closed: never invents Engineering data and never
 * claims a task is review-ready when proof is absent or degraded.
 */

import type { ProofBundle, ProofBundleItem } from './proofBundle.ts';
import type {
  WorkplaneProofBundleLoadState,
  WorkplaneProofBundleLoadStatus,
} from './workplaneProofBundle.ts';

export type MissingProofPanelStatus =
  | 'loading'
  | 'empty'
  | 'error'
  | 'warning'
  | 'degraded'
  | 'clear';

export type MissingProofWarningKind =
  | 'no_proof'
  | 'missing_evidence'
  | 'unknown_artifacts'
  | 'unavailable_links'
  | 'unavailable_metadata'
  | 'load_error'
  | 'load_empty';

export type MissingProofWarningSeverity = 'warning' | 'degraded' | 'unavailable';

export interface MissingProofWarning {
  id: string;
  kind: MissingProofWarningKind;
  severity: MissingProofWarningSeverity;
  title: string;
  message: string;
}

export interface MissingProofWarningView {
  taskId: number | null;
  status: MissingProofPanelStatus;
  /** True when the dedicated missing-proof warning should be shown. */
  warningVisible: boolean;
  /** Always false — this panel never asserts review-ready. */
  reviewReady: false;
  proofPresent: boolean;
  proofItemCount: number;
  unknownItemCount: number;
  unavailableLinkCount: number;
  missingEvidence: boolean;
  missingEvidenceReason: string | null;
  evidenceSummary: string | null;
  warnings: MissingProofWarning[];
  errorMessage: string | null;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function countUnknown(items: ProofBundleItem[]): number {
  return items.filter((item) => item.kind === 'unknown').length;
}

function countUnavailableLinks(items: ProofBundleItem[]): number {
  return items.filter((item) => !item.href && !item.path).length;
}

function hasUsableProofItem(items: ProofBundleItem[]): boolean {
  return items.some(
    (item) =>
      (item.kind === 'raw' || item.kind === 'curated' || item.kind === 'external') &&
      Boolean(item.href || item.path),
  );
}

/**
 * Build the missing-proof warning view from a ProofBundle load state.
 * Consumes THE-863/THE-864 normalization — no separate task fetch.
 */
export function buildMissingProofWarningView(
  proofLoad: WorkplaneProofBundleLoadState,
): MissingProofWarningView {
  const taskId = proofLoad.taskId;
  const base = {
    taskId,
    reviewReady: false as const,
    proofPresent: false,
    proofItemCount: 0,
    unknownItemCount: 0,
    unavailableLinkCount: 0,
    missingEvidence: false,
    missingEvidenceReason: null as string | null,
    evidenceSummary: null as string | null,
    errorMessage: null as string | null,
  };

  if (proofLoad.status === 'loading') {
    return {
      ...base,
      status: 'loading',
      warningVisible: false,
      warnings: [],
    };
  }

  if (proofLoad.status === 'error') {
    return {
      ...base,
      status: 'error',
      warningVisible: true,
      errorMessage:
        readNonEmptyString(proofLoad.errorMessage) ?? 'Unable to load proof metadata.',
      warnings: [
        {
          id: 'load_error',
          kind: 'load_error',
          severity: 'unavailable',
          title: 'Proof metadata unavailable',
          message:
            readNonEmptyString(proofLoad.errorMessage) ??
            'Proof/evidence metadata could not be loaded. Do not treat this task as review-ready.',
        },
      ],
    };
  }

  if (proofLoad.status === 'empty' || !proofLoad.bundle) {
    return {
      ...base,
      status: 'empty',
      warningVisible: true,
      warnings: [
        {
          id: 'load_empty',
          kind: 'load_empty',
          severity: 'unavailable',
          title: 'No proof payload',
          message: taskId
            ? `Task ${taskId} was not found or has no proof payload. Missing proof — not review-ready.`
            : 'Open a Workplane with a valid task id to inspect missing-proof warnings.',
        },
      ],
    };
  }

  const bundle: ProofBundle = proofLoad.bundle;
  const proofItemCount = bundle.items.length;
  const unknownItemCount = countUnknown(bundle.items);
  const unavailableLinkCount = countUnavailableLinks(bundle.items);
  const proofPresent = proofItemCount > 0 && hasUsableProofItem(bundle.items);
  const missingEvidence = bundle.missingEvidence;
  const missingEvidenceReason = bundle.missingEvidenceReason;
  const evidenceSummary = bundle.evidenceSummary;
  const warnings: MissingProofWarning[] = [];

  if (proofItemCount === 0) {
    warnings.push({
      id: 'no_proof',
      kind: 'no_proof',
      severity: 'warning',
      title: 'Missing proof',
      message:
        'This task has no required proof, evidence, or output links. Do not treat it as review-ready.',
    });
  }

  if (missingEvidence) {
    warnings.push({
      id: 'missing_evidence',
      kind: 'missing_evidence',
      severity: 'warning',
      title: 'Missing evidence',
      message:
        missingEvidenceReason ??
        'Proof/evidence appears missing for this task. Do not treat it as review-ready.',
    });
  }

  if (unknownItemCount > 0) {
    warnings.push({
      id: 'unknown_artifacts',
      kind: 'unknown_artifacts',
      severity: 'degraded',
      title: 'Unknown proof artifacts',
      message: `${unknownItemCount} proof item${unknownItemCount === 1 ? '' : 's'} could not be classified (unknown). Treat as degraded until resolved.`,
    });
  }

  if (unavailableLinkCount > 0) {
    warnings.push({
      id: 'unavailable_links',
      kind: 'unavailable_links',
      severity: 'degraded',
      title: 'Unavailable proof links',
      message: `${unavailableLinkCount} proof item${unavailableLinkCount === 1 ? '' : 's'} have no openable href/path.`,
    });
  }

  // Primary missing-proof warning: no usable proof or explicit missing evidence.
  const missingProof =
    proofItemCount === 0 || missingEvidence || !proofPresent;
  const hasDegradedOnly =
    !missingProof && warnings.some((w) => w.severity === 'degraded');

  if (missingProof) {
    return {
      taskId: bundle.taskId ?? taskId,
      status: 'warning',
      warningVisible: true,
      reviewReady: false,
      proofPresent,
      proofItemCount,
      unknownItemCount,
      unavailableLinkCount,
      missingEvidence,
      missingEvidenceReason,
      evidenceSummary,
      warnings:
        warnings.length > 0
          ? warnings
          : [
              {
                id: 'no_proof',
                kind: 'no_proof',
                severity: 'warning',
                title: 'Missing proof',
                message:
                  'This task lacks required proof/evidence/output links. Do not treat it as review-ready.',
              },
            ],
      errorMessage: null,
    };
  }

  if (hasDegradedOnly) {
    return {
      taskId: bundle.taskId ?? taskId,
      status: 'degraded',
      warningVisible: true,
      reviewReady: false,
      proofPresent,
      proofItemCount,
      unknownItemCount,
      unavailableLinkCount,
      missingEvidence,
      missingEvidenceReason,
      evidenceSummary,
      warnings,
      errorMessage: null,
    };
  }

  return {
    taskId: bundle.taskId ?? taskId,
    status: 'clear',
    warningVisible: false,
    reviewReady: false,
    proofPresent: true,
    proofItemCount,
    unknownItemCount,
    unavailableLinkCount,
    missingEvidence: false,
    missingEvidenceReason: null,
    evidenceSummary,
    warnings: [],
    errorMessage: null,
  };
}

/** Convenience: build view from status + optional bundle (tests / controlled state). */
export function createMissingProofWarningView(input: {
  taskId?: number | null;
  status?: WorkplaneProofBundleLoadStatus;
  bundle?: ProofBundle | null;
  errorMessage?: string | null;
}): MissingProofWarningView {
  const taskId =
    typeof input.taskId === 'number' && Number.isInteger(input.taskId) && input.taskId >= 1
      ? input.taskId
      : null;

  if (input.status === 'loading') {
    return buildMissingProofWarningView({
      status: 'loading',
      taskId,
      bundle: null,
      errorMessage: null,
    });
  }

  if (input.status === 'error') {
    return buildMissingProofWarningView({
      status: 'error',
      taskId,
      bundle: null,
      errorMessage: input.errorMessage ?? 'Unable to load proof metadata.',
    });
  }

  if (input.status === 'ready' && input.bundle) {
    return buildMissingProofWarningView({
      status: 'ready',
      taskId: input.bundle.taskId ?? taskId,
      bundle: input.bundle,
      errorMessage: null,
    });
  }

  return buildMissingProofWarningView({
    status: 'empty',
    taskId,
    bundle: null,
    errorMessage: null,
  });
}
