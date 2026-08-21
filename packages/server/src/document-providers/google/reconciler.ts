/**
 * THE-958 (T-017) — Google change tracking and reconciliation.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md
 *   - R-008 "Google change tracking": Entity must update provider metadata after
 *     changes made outside Entity; preferred mechanism is provider change
 *     notification/watch with a polling reconciliation fallback; the implementation
 *     must tolerate duplicate and delayed notifications.
 *   - T-017 acceptance: R-008. Automated proof: duplicate, delayed, missing
 *     notification tests.
 *
 * Acceptance semantics implemented here:
 *   1. External edit advances Entity's known revision — through the EXISTING T-004
 *      registry surface only (never a parallel revision store or new event table).
 *   2. Duplicate notification does not duplicate versions/activity — an event whose
 *      revision equals the known revision is ignored WITHOUT any registry write
 *      (zero-double-write, asserted by test).
 *   3. Delayed/out-of-order notification never regresses state — an older revision
 *      is detected via the injected revision comparator and discarded with an
 *      auditable typed outcome.
 *   4. Lost notification is recovered by polling/reconciliation — the poll snapshot
 *      of current provider revisions reconciles forward past missed events.
 *   5. Watch/webhook expiration falls back to polling and exposes DEGRADED health;
 *   6. Change-tracking failure exposes degraded health and FAILS CLOSED: it never
 *      lifts a write lane and never marks capabilities supported.
 *
 * Determinism / security posture:
 *   - THE CHANGE SOURCE IS INJECTED. This module performs no network I/O, holds no
 *     credentials, touches no tenant data, and has no default source (mirrors the
 *     T-014/15/16 injected-transport convention). Tests supply hand-rolled fake
 *     sources with recorded fixture sequences.
 *   - REVISION-TOKEN STRICTNESS: every inbound revision token (event or poll
 *     snapshot) is checked against the shared canonical UNSAFE_REVISION_TOKEN_CHARACTERS
 *     exported from ../revision-coordinator (THE-956 r2 / THE-950 r2 F2 doctrine).
 *     A violation raises the typed UnsafeReconcileRevisionTokenError carrying ONLY the
 *     code point and field name — raw tokens never appear in messages or logs.
 *   - WORKSPACE ISOLATION (THE-944 r2 INFO precedent): every registry lookup and
 *     write is scoped by workspaceId through the registry's own isolated get /
 *     findByProviderIdentity / update methods; a foreign-workspace document is
 *     simply unknown from this lane's point of view.
 *   - NO PRODUCTION WIRING: nothing here mounts into index.ts or routes; receipts
 *     stay deferred (receiptId: null pending Henry t010-wiring-deferral-signoff).
 */

import { UNSAFE_REVISION_TOKEN_CHARACTERS } from '../revision-coordinator';
import type { CapabilityType, CapabilityState } from '../types';

/* =============================================================================
 * Injected change-source contract (no default, no network).
 * ============================================================================= */

/** One provider change notification (watch push or polled feed entry). */
export interface GoogleChangeEvent {
  /** Provider-delivered dedupe id for the notification itself. */
  eventId: string;
  /** Durable Google document id (= registry external_id). */
  externalId: string;
  /** Provider revision token after the external edit. */
  revision: string;
}

/** Current provider-side revisions observed by a polling pass. */
export interface GoogleChangeSnapshotEntry {
  externalId: string;
  revision: string;
}

export interface GoogleChangePollResult {
  events: GoogleChangeEvent[];
  snapshot: GoogleChangeSnapshotEntry[];
  /**
   * False simulates webhook/watch expiration (R-008 validation bullet 4): the
   * reconciler then runs in polling mode and reports degraded health.
   */
  watchActive: boolean;
}

/**
 * The injected dependency replacing all real Google watch/poll transport. No default
 * implementation exists in this module — construction without one is a type error,
 * exactly like the adapters' injected transports.
 */
export interface GoogleChangeSource {
  poll(): Promise<GoogleChangePollResult>;
}

/* =============================================================================
 * Registry surface actually consumed (structural subset of DocumentRegistry).
 * Declared structurally so tests can supply hand-rolled fakes while production
 * callers pass the T-004 registry directly.
 * ============================================================================= */

export interface ReconcilerRegistryView {
  findByProviderIdentity(
    providerConnectionId: string | null,
    externalId: string,
    workspaceId: string,
  ):
    | { id: string; current_revision: string | null }
    | undefined;
  update(
    documentId: string,
    workspaceId: string,
    patch: { current_revision?: string | null },
  ): unknown;
}

/* =============================================================================
 * Typed outcomes (auditable) + health + fail-closed capability fold.
 * ============================================================================= */

export type ReconcileEventOutcome =
  | { kind: 'applied'; eventId: string; externalId: string }
  | { kind: 'duplicate-ignored'; eventId: string; externalId: string }
  | { kind: 'stale-discarded'; eventId: string; externalId: string }
  | { kind: 'unknown-document'; eventId: string; externalId: string }
  | { kind: 'poll-reconciled'; externalId: string }
  | { kind: 'watch-expired-poll-applied'; eventId: string; externalId: string };

export type DuplicateEventOutcome = Extract<ReconcileEventOutcome, { kind: 'duplicate-ignored' }>;
export type OutOfOrderEventOutcome = Extract<ReconcileEventOutcome, { kind: 'stale-discarded' }>;
export type PollReconciliationOutcome = Extract<ReconcileEventOutcome, { kind: 'poll-reconciled' }>;
export type SimulatedWatchExpirationOutcome = Extract<
  ReconcileEventOutcome,
  { kind: 'watch-expired-poll-applied' }
>;

export interface ChangeTrackingHealth {
  state: 'healthy' | 'degraded';
  mode: 'watch' | 'polling';
  reason: 'none' | 'watch_expired' | 'change_tracking_failed';
}

/**
 * Fail-closed capability fold for the change_tracking capability (R-002 vocabulary).
 * `actionable` is true ONLY for a healthy watch-mode run; degraded/unknown NEVER
 * lifts a write lane or marks the capability supported.
 */
export interface ChangeTrackingCapabilityFold {
  name: Extract<CapabilityType, 'change_tracking'>;
  state: CapabilityState;
  actionable: boolean;
  reasonCode: string;
}

export interface ReconcileInput {
  workspaceId: string;
}

export interface ReconcileResult {
  health: ChangeTrackingHealth;
  changeTrackingCapability: ChangeTrackingCapabilityFold;
  outcomes: ReconcileEventOutcome[];
  applied: number;
  duplicatesIgnored: number;
  staleDiscarded: number;
  unknownDocuments: number;
}

/* =============================================================================
 * Revision-token strictness at the reconciler boundary.
 * ============================================================================= */

/**
 * Typed boundary violation: an inbound revision token contained a character from the
 * shared canonical UNSAFE_REVISION_TOKEN_CHARACTERS class. Mirrors the adapter
 * doctrine (THE-950 r2 F2 / THE-956 r2): the message carries the FIELD name and the
 * offending CODE POINT only — the raw token is never embedded, logged, or propagated.
 */
export class UnsafeReconcileRevisionTokenError extends Error {
  readonly codePoint: number;
  readonly field: 'eventRevision' | 'snapshotRevision';
  constructor(field: 'eventRevision' | 'snapshotRevision', codePoint: number) {
    super(
      `UNSAFE_REVISION_TOKEN: ${field} contained a forbidden character ` +
        `(code point U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}); ` +
        `the raw token is rejected at the reconciler boundary and never surfaced`,
    );
    this.name = 'UnsafeReconcileRevisionTokenError';
    this.codePoint = codePoint;
    this.field = field;
  }
}

function assertSafeRevisionToken(
  raw: string,
  field: 'eventRevision' | 'snapshotRevision',
): void {
  const match = UNSAFE_REVISION_TOKEN_CHARACTERS.exec(raw);
  if (match) {
    // Reset lastIndex safety: the shared regex has no /g flag, but be explicit.
    UNSAFE_REVISION_TOKEN_CHARACTERS.lastIndex = 0;
    throw new UnsafeReconcileRevisionTokenError(field, match[0].codePointAt(0) as number);
  }
}

/* =============================================================================
 * The reconciler.
 * ============================================================================= */

export interface GoogleChangeReconcilerDeps {
  /** The T-004 document registry (or structural equivalent in tests). */
  registry: ReconcilerRegistryView;
  /** Injected change source — REQUIRED, no default, no network. */
  changeSource: GoogleChangeSource;
  /**
   * Deterministic revision ordering over opaque provider tokens. Required (not
   * defaulted) so ordering policy is always explicit at the composition root.
   */
  compareRevisions: (a: string, b: string) => number;
  /** Provider connection scope for registry identity lookups. */
  providerConnectionId?: string | null;
}

export interface GoogleChangeReconciler {
  reconcile(input: ReconcileInput): Promise<ReconcileResult>;
}

const HEALTHY_CAPABILITY: ChangeTrackingCapabilityFold = {
  name: 'change_tracking',
  state: 'supported',
  actionable: true,
  reasonCode: 'change_tracking_healthy',
};

function degradedCapability(reasonCode: string): ChangeTrackingCapabilityFold {
  return {
    name: 'change_tracking',
    state: 'degraded',
    actionable: false,
    reasonCode,
  };
}

export function createGoogleChangeReconciler(
  deps: GoogleChangeReconcilerDeps,
): GoogleChangeReconciler {
  const { registry, changeSource, compareRevisions } = deps;
  const providerConnectionId = deps.providerConnectionId ?? null;

  return {
    async reconcile(input: ReconcileInput): Promise<ReconcileResult> {
      const workspaceId = input.workspaceId;
      const outcomes: ReconcileEventOutcome[] = [];

      let poll: GoogleChangePollResult;
      try {
        poll = await changeSource.poll();
      } catch {
        // R-008.4 fail-closed: a change-tracking failure exposes degraded health,
        // performs NO writes, and never crashes the lane or lifts a write capability.
        return {
          health: { state: 'degraded', mode: 'polling', reason: 'change_tracking_failed' },
          changeTrackingCapability: degradedCapability('change_tracking_failed'),
          outcomes: [],
          applied: 0,
          duplicatesIgnored: 0,
          staleDiscarded: 0,
          unknownDocuments: 0,
        };
      }

      const watchExpired = !poll.watchActive;

      // Track documents already advanced by THIS pass so the poll snapshot never
      // double-writes behind an event that already moved them forward.
      const advancedExternals = new Set<string>();

      for (const evt of poll.events) {
        assertSafeRevisionToken(evt.revision, 'eventRevision');
        const known = registry.findByProviderIdentity(providerConnectionId, evt.externalId, workspaceId);
        if (!known) {
          // Unknown OR foreign-workspace document: never read across the boundary,
          // never written — auditable as unknown-document from this lane's view.
          outcomes.push({ kind: 'unknown-document', eventId: evt.eventId, externalId: evt.externalId });
          continue;
        }
        if (known.current_revision != null) {
          const order = compareRevisions(evt.revision, known.current_revision);
          if (order === 0) {
            // R-008.2 duplicate: identical revision ⇒ NO write at all (zero double-write).
            outcomes.push({ kind: 'duplicate-ignored', eventId: evt.eventId, externalId: evt.externalId });
            continue;
          }
          if (order < 0) {
            // Delayed/out-of-order: discard auditably, NEVER apply backwards.
            outcomes.push({ kind: 'stale-discarded', eventId: evt.eventId, externalId: evt.externalId });
            continue;
          }
        }
        registry.update(known.id, workspaceId, { current_revision: evt.revision });
        advancedExternals.add(evt.externalId);
        outcomes.push(
          watchExpired
            ? { kind: 'watch-expired-poll-applied', eventId: evt.eventId, externalId: evt.externalId }
            : { kind: 'applied', eventId: evt.eventId, externalId: evt.externalId },
        );
      }

      // Polling reconciliation fallback: recover LOST notifications by comparing the
      // observed provider snapshot against Entity's known revisions.
      for (const entry of poll.snapshot) {
        assertSafeRevisionToken(entry.revision, 'snapshotRevision');
        if (advancedExternals.has(entry.externalId)) continue;
        const known = registry.findByProviderIdentity(providerConnectionId, entry.externalId, workspaceId);
        if (!known) {
          continue; // snapshot entries for unknown/foreign documents are out of scope here
        }
        if (known.current_revision != null && compareRevisions(entry.revision, known.current_revision) <= 0) {
          continue; // already current (duplicate) or ahead of the snapshot — never regress
        }
        registry.update(known.id, workspaceId, { current_revision: entry.revision });
        outcomes.push({ kind: 'poll-reconciled', externalId: entry.externalId });
      }

      const health: ChangeTrackingHealth = watchExpired
        ? { state: 'degraded', mode: 'polling', reason: 'watch_expired' }
        : { state: 'healthy', mode: 'watch', reason: 'none' };

      return {
        health,
        changeTrackingCapability: watchExpired
          ? degradedCapability('watch_expired')
          : HEALTHY_CAPABILITY,
        outcomes,
        applied: outcomes.filter((o) => o.kind === 'applied').length,
        duplicatesIgnored: outcomes.filter((o) => o.kind === 'duplicate-ignored').length,
        staleDiscarded: outcomes.filter((o) => o.kind === 'stale-discarded').length,
        unknownDocuments: outcomes.filter((o) => o.kind === 'unknown-document').length,
      };
    },
  };
}
