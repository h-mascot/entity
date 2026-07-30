/**
 * THE-864 / WP1-B-03 — Workplane proof bundle load helpers.
 *
 * Wraps THE-863 `normalizeProofBundle` with empty/loading/error/ready envelopes
 * for the ProofBundlePanel. Does not invent Engineering import data.
 */

import {
  normalizeProofBundle,
  type ProofBundle,
  type ProofBundleItem,
  type ProofBundleItemKind,
} from './proofBundle.ts';
import { HttpRequestError, buildApiCandidates, requestJsonWithFallback, toErrorMessage } from './http.ts';

export type WorkplaneProofBundleLoadStatus = 'empty' | 'loading' | 'error' | 'ready';

export interface WorkplaneProofBundleLoadState {
  status: WorkplaneProofBundleLoadStatus;
  taskId: number | null;
  bundle: ProofBundle | null;
  errorMessage: string | null;
}

export const PROOF_BUNDLE_KIND_ORDER: ProofBundleItemKind[] = [
  'raw',
  'curated',
  'external',
  'unknown',
];

export const PROOF_BUNDLE_KIND_LABELS: Record<ProofBundleItemKind, string> = {
  raw: 'Raw',
  curated: 'Curated',
  external: 'External',
  unknown: 'Unknown',
};

const SAFE_SELECTION_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isSafeSelectionToken(value: string): boolean {
  return SAFE_SELECTION_TOKEN.test(value) && !value.includes('..') && !value.includes('//');
}

/** Kind counts for chip strip; preserves stable kind order. */
export function countProofBundleKinds(
  bundle: ProofBundle | null | undefined,
): Record<ProofBundleItemKind, number> {
  const counts: Record<ProofBundleItemKind, number> = {
    raw: 0,
    curated: 0,
    external: 0,
    unknown: 0,
  };
  if (!bundle) return counts;
  for (const item of bundle.items) {
    counts[item.kind] += 1;
  }
  return counts;
}

/**
 * Derive a URL-safe selectedProof token for an item.
 * Full item ids often contain `/` and cannot live in Workplane URL state.
 */
export function toProofBundleSelectionToken(item: ProofBundleItem): string | null {
  if (isSafeSelectionToken(item.id)) {
    return item.id;
  }

  const baseSource = item.href ?? item.path ?? item.title ?? item.id;
  const base =
    baseSource
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean)
      .pop()
      ?.trim() ?? item.kind;
  const raw = `${item.kind}:${base}`
    .replace(/[^A-Za-z0-9._:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 128);

  return raw && isSafeSelectionToken(raw) ? raw : null;
}

export function isProofBundleItemSelected(
  item: ProofBundleItem,
  selectedProof: string | null | undefined,
): boolean {
  if (!selectedProof) return false;
  if (item.id === selectedProof) return true;
  const token = toProofBundleSelectionToken(item);
  return token !== null && token === selectedProof;
}

/** Explicit empty/loading/error/ready load envelope for the proof bundle panel. */
export function createWorkplaneProofBundleLoadState(
  input: {
    taskId?: number | null;
    status?: WorkplaneProofBundleLoadStatus;
    bundle?: ProofBundle | null;
    errorMessage?: string | null;
  } = {},
): WorkplaneProofBundleLoadState {
  const taskId =
    typeof input.taskId === 'number' && Number.isInteger(input.taskId) && input.taskId >= 1
      ? input.taskId
      : null;

  if (input.status === 'loading') {
    return {
      status: 'loading',
      taskId,
      bundle: null,
      errorMessage: null,
    };
  }

  if (input.status === 'error') {
    return {
      status: 'error',
      taskId,
      bundle: null,
      errorMessage: readNonEmptyString(input.errorMessage) ?? 'Unable to load proof bundle.',
    };
  }

  if (input.status === 'ready' && input.bundle) {
    return {
      status: 'ready',
      taskId: input.bundle.taskId ?? taskId,
      bundle: input.bundle,
      errorMessage: null,
    };
  }

  return {
    status: 'empty',
    taskId,
    bundle: null,
    errorMessage: null,
  };
}

/**
 * Fetch task detail and normalize into a ProofBundle.
 * Returns null for missing task (404 / invalid payload) — caller maps to empty.
 * Throws for transport / server failures — caller maps to error.
 * Empty proof on a valid task is still a ready bundle (bundle.empty === true).
 */
export async function fetchWorkplaneProofBundle(
  taskId: number,
  apiBase = '',
): Promise<ProofBundle | null> {
  if (!Number.isInteger(taskId) || taskId < 1) {
    return null;
  }

  try {
    const payload = await requestJsonWithFallback({
      urls: buildApiCandidates(`/tasks/${taskId}`, apiBase),
      init: { method: 'GET' },
      continueOnStatuses: [],
      fallbackError: 'Unable to load proof bundle.',
    });
    const bundle = normalizeProofBundle(payload);
    if (bundle.taskId === null) {
      return null;
    }
    return bundle;
  } catch (error) {
    if (error instanceof HttpRequestError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export function workplaneProofBundleErrorMessage(error: unknown): string {
  return toErrorMessage(error, 'Unable to load proof bundle.');
}
