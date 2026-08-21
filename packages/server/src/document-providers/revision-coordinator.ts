/**
 * THE-950 (T-009) — Revision Coordinator.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md
 *   - §10.1 "Revision Coordinator — Owns mutation preconditions and stale-write rejection."
 *   - R-024 "Revision-aware mutation": all mutations participate in the Revision Coordinator; a
 *     provider-specific concurrency token may be a revision ID, ETag, change token, content
 *     hash/local revision, or another provider-documented token; expected vs current are compared
 *     BEFORE any adapter write and on mismatch NO mutation occurs; "If the adapter cannot
 *     establish a safe current revision, write capability must degrade or require a separately
 *     proven safe strategy."
 *   - R-025 "Standard conflict response": the provider-neutral 409 STALE_REVISION envelope
 *     (`code`, `message`, `documentId`, `expectedRevision`, `currentRevision`, `retryable:true`);
 *     no document secrets or provider credentials; no automatic blind retry.
 *   - T-009 acceptance: "known stale write never succeeds silently" (two independent writers per
 *     mutation lane); "expected/current revisions sanitized"; "unsafe provider with no concurrency
 *     evidence fails closed".
 *
 * This module is the single enforcement point for mutation preconditions. The route composes it
 * against the R-023 adapter mutation lane: the coordinator reads the authoritative provider
 * current revision, fails closed when a safe current revision cannot be established, and rejects a
 * stale expected revision BEFORE the adapter write. Defense-in-depth: the adapter itself re-checks
 * the revision atomically inside `mutate`, so even the race between the coordinator's read and the
 * adapter write can never commit a stale write silently.
 *
 * The coordinator introduces no receipt store, no event table, no new namespace, and no competing
 * provider registry (§13 events and T-010 receipts are explicitly out of scope for T-009).
 *
 * Privacy/security: revision tokens are UNTRUSTED strings. Any token surfaced in an error, log, or
 * response is passed through `sanitizeRevisionToken` — bounded length, control characters, HTML
 * injection metacharacters, and Unicode bidi/format controls stripped — so no provider credentials
 * or tenant secrets leak and no HTML injection or hidden-direction surface is opened. Document
 * contents are never read or logged.
 */

import type { DocumentProviderAdapter, AdapterMutation, CapabilityType } from './types';
import { AdapterArtifactNotFoundError, StaleRevisionError, mutationCapability } from './types';

/** R-025 fixed conflict message — does NOT embed raw (possibly hostile) revision tokens. */
export const STALE_REVISION_MESSAGE = 'The document changed after this operation was prepared.';

const DEFAULT_MAX_REVISION_TOKEN_LENGTH = 64;

/**
 * Characters stripped from an untrusted revision token before it is placed in any response or log:
 * C0/C1 control characters (including newlines/NUL), HTML/XML metacharacters, and Unicode
 * bidi/format controls (zero-width space/joiner/non-joiner U+200B–U+200F, bidi embeddings
 * U+202A–U+202E, bidi ISOLATES U+2066–U+2069, Arabic Letter Mark U+061C) plus invisible/
 * spoofing format characters (BOM/ZWNBSP U+FEFF, Word Joiner U+2060, Soft Hyphen U+00AD).
 * THE-950 r2 F2 (core half, landed T-015/THE-956): this set now matches the extended set the
 * real adapters enforce at their boundary. Removes the HTML injection surface and
 * hidden-direction/spoofing controls while preserving ordinary opaque tokens (e.g. `rev-17`,
 * `etag_v1`).
 */
const UNSAFE_TOKEN_CHARS = /[\u0000-\u001f\u007f\u0080-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\u061c\ufeff\u2060\u00ad<>"'&\\]/g;

/**
 * Sanitize an untrusted provider revision token for error/log/response inclusion. Never treated as
 * trustworthy data: coerced to a bounded string, control/HTML metacharacters stripped, length
 * capped. Revised tokens remain untrusted even after sanitization — they are labels for the
 * conflict envelope, never executed or concatenated into HTML.
 */
export function sanitizeRevisionToken(raw: unknown, maxLength = DEFAULT_MAX_REVISION_TOKEN_LENGTH): string {
  if (raw == null) return '';
  const scrubbed = String(raw).replace(UNSAFE_TOKEN_CHARS, '');
  return scrubbed.slice(0, maxLength);
}

/**
 * The revision/concurrency evidence the coordinator establishes for a mutation lane BEFORE any
 * adapter write. `concurrencyProven` is true only when the adapter exposed an authoritative
 * current revision token; otherwise the lane FAILS CLOSED (R-024 "if the adapter cannot establish
 * a safe current revision… must degrade") rather than writing on unverifiable state.
 */
export interface MutationPrecondition {
  /** The T-002 write capability that gates this lane (text/range/slide). */
  lane: CapabilityType;
  /** Authoritative provider current revision. `null` when the provider exposes no token. */
  currentRevision: string | null;
  /** Whether a safe current revision was established. When false the lane must fail closed. */
  concurrencyProven: boolean;
}

export interface ReadPreconditionInput {
  adapter: DocumentProviderAdapter;
  externalId: string;
  providerConnectionId?: string | null;
  mutation: AdapterMutation;
}

/**
 * Read the authoritative provider current revision for a mutation lane. The provider's own
 * concurrency token (revision ID, ETag, change token, content hash, or provider-documented token)
 * is the R-024 source of truth.
 *
 * Typed-error distinction (THE-950 r2 F1): a **null descriptor** (`getMetadata → null`, i.e. the
 * artifact is not found / has vanished at the provider) is NOT the same as a present artifact that
 * merely exposes no concurrency token. A vanished artifact is a read/metadata target miss and is
 * rethrown as `AdapterArtifactNotFoundError` so the route surfaces the existing typed
 * `DOCUMENT_NOT_FOUND` (404) — never a misleading "provider exposes no revision token" capability
 * error. Only a PRESENT descriptor whose `current_revision` is null/empty is the R-024
 * fail-closed no-token case (`concurrencyProven:false`).
 *
 * The coordinator never fabricates a revision from the registry hint or any secondary source,
 * because a fabricated revision would let a stale write proceed on unverifiable state.
 */
export async function readMutationPrecondition(
  input: ReadPreconditionInput,
): Promise<MutationPrecondition> {
  const lane = mutationCapability(input.mutation);
  const metadata = await input.adapter.getMetadata({
    external_id: input.externalId,
    provider_connection_id: input.providerConnectionId ?? null,
  });
  // A null descriptor means the provider artifact does not exist (or vanished) — propagate the
  // artifact-not-found semantics so the route can map it to 404 DOCUMENT_NOT_FOUND (the adapter
  // contract types AdapterArtifactNotFoundError as covering read/metadata targets). This is
  // distinct from a present descriptor exposing no concurrency token, which fails closed below.
  if (metadata === null) {
    throw new AdapterArtifactNotFoundError(input.externalId);
  }
  const currentRevision = metadata?.current_revision ?? null;
  const concurrencyProven = currentRevision != null && currentRevision !== '';
  return { lane, currentRevision, concurrencyProven };
}

export interface AssertPreconditionInput {
  precondition: MutationPrecondition;
  expectedRevision: string;
  documentId: string;
}

/**
 * Fail-closed typed error raised when a lane cannot establish a safe current revision. It is the
 * "unsafe provider with no concurrency evidence fails closed" guard (R-024 / T-009 "Not done
 * until"). Never a silent optimistic write. The route maps it to a typed capability error.
 */
export class UnsafeMutationError extends Error {
  readonly lane: CapabilityType;
  constructor(lane: CapabilityType, documentId: string) {
    super(
      `cannot establish a safe current revision for ${lane} on ${documentId}; mutation FAILS CLOSED ` +
        `because the provider exposes no revision/concurrency token (R-024).`,
    );
    this.name = 'UnsafeMutationError';
    this.lane = lane;
  }
}

/**
 * Enforce the R-024 precondition: fail closed when no safe current revision exists; reject a stale
 * expected revision with the typed StaleRevisionError (R-025) BEFORE any adapter write. On a stale
 * mismatch NO mutation occurs. No automatic blind retry (the caller surfaces the 409 once).
 */
export function assertMutationPrecondition(input: AssertPreconditionInput): void {
  const { precondition, expectedRevision, documentId } = input;
  if (!precondition.concurrencyProven) {
    throw new UnsafeMutationError(precondition.lane, documentId);
  }
  if (expectedRevision !== precondition.currentRevision) {
    throw new StaleRevisionError(expectedRevision, precondition.currentRevision ?? '');
  }
}

export interface PreflightMutationInput extends ReadPreconditionInput {
  expectedRevision: string;
  documentId: string;
}

/**
 * One-step mutation precondition: read the authoritative current revision and assert it. Returns
 * the established precondition on success (for the route to reflect/observe); throws
 * UnsafeMutationError (fail closed) or StaleRevisionError (R-025) otherwise. The route then submits
 * the adapter write, which re-checks the revision atomically (defense in depth).
 */
export async function preflightMutation(
  input: PreflightMutationInput,
): Promise<MutationPrecondition> {
  const precondition = await readMutationPrecondition(input);
  assertMutationPrecondition({
    precondition,
    expectedRevision: input.expectedRevision,
    documentId: input.documentId,
  });
  return precondition;
}

/**
 * Build the provider-neutral R-025 conflict envelope from a StaleRevisionError. The shape is the
 * exact §12.3/§12.5/§12.6 contract (`code`, `message`, optional `documentId`, `expectedRevision`,
 * `currentRevision`, `retryable:true`); expected/current revisions are SANITIZED (bounded, no HTML
 * injection surface, no secrets/credentials). The fixed message never embeds raw tokens. No
 * document secrets or provider credentials are included.
 */
export function staleRevisionBody(
  err: StaleRevisionError,
  documentId?: string,
): {
  code: 'STALE_REVISION';
  message: string;
  documentId?: string;
  expectedRevision: string;
  currentRevision: string;
  retryable: boolean;
} {
  return {
    code: 'STALE_REVISION',
    message: STALE_REVISION_MESSAGE,
    ...(documentId !== undefined ? { documentId } : {}),
    expectedRevision: sanitizeRevisionToken(err.expectedRevision),
    currentRevision: sanitizeRevisionToken(err.currentRevision),
    retryable: true,
  };
}
