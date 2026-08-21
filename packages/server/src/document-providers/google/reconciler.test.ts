/**
 * THE-958 (T-017) — Google change tracking and reconciliation tests.
 *
 * R-008 acceptance (PRD ~:927-952):
 *   1. External edit advances Entity's known revision.
 *   2. Duplicate notification does not duplicate versions/activity.
 *   3. Lost notification is recovered by polling/reconciliation.
 *   4. Change-tracking failure exposes degraded health rather than silently
 *      freezing metadata indefinitely.
 * R-008 validation (all four REQUIRED): Duplicate event test / Out-of-order
 * event test / Poll reconciliation test / Simulated webhook/watch expiration test.
 *
 * Deterministic only: the change source and registry are hand-rolled fakes with
 * recorded fixture sequences; no network, no timers, no randomness, no real DB.
 */

import { describe, expect, it } from 'vitest';

import {
  createGoogleChangeReconciler,
  UnsafeReconcileRevisionTokenError,
} from './reconciler';
import type {
  GoogleChangeEvent,
  GoogleChangeReconciler,
  GoogleChangeSource,
} from './reconciler';

/* =============================================================================
 * Hand-rolled deterministic fakes (recorded fixture sequences only).
 * ============================================================================= */

interface RegistryRecord {
  id: string;
  workspace_id: string;
  provider_connection_id: string | null;
  external_id: string;
  current_revision: string | null;
  updateCalls: number;
}

class FakeRegistry {
  readonly records = new Map<string, RegistryRecord>();
  totalUpdateCalls = 0;
  constructor(initial: RegistryRecord[]) {
    for (const rec of initial) this.records.set(rec.id, { ...rec });
  }
  /** Mirrors DocumentRegistry.get(documentId, workspaceId) isolation semantics. */
  get(documentId: string, workspaceId: string): RegistryRecord | undefined {
    const rec = this.records.get(documentId);
    return rec && rec.workspace_id === workspaceId ? rec : undefined;
  }
  /** Mirrors DocumentRegistry.findByProviderIdentity isolation semantics. */
  findByProviderIdentity(
    providerConnectionId: string | null,
    externalId: string,
    workspaceId: string,
  ): RegistryRecord | undefined {
    for (const rec of this.records.values()) {
      if (
        rec.external_id === externalId &&
        (rec.provider_connection_id ?? null) === (providerConnectionId ?? null) &&
        rec.workspace_id === workspaceId
      ) {
        return rec;
      }
    }
    return undefined;
  }
  /** Mirrors DocumentRegistry.update(documentId, workspaceId, patch). */
  update(
    documentId: string,
    workspaceId: string,
    patch: { current_revision?: string | null },
  ): RegistryRecord | undefined {
    const rec = this.get(documentId, workspaceId);
    if (!rec) return undefined;
    this.totalUpdateCalls += 1;
    rec.updateCalls += 1;
    if (patch.current_revision !== undefined) rec.current_revision = patch.current_revision;
    return { ...rec };
  }
}

interface FakeSourceState {
  events: GoogleChangeEvent[];
  snapshot: { externalId: string; revision: string }[];
  watchActive: boolean;
}

function fakeSource(state: FakeSourceState): GoogleChangeSource & { state: FakeSourceState } {
  return {
    state,
    async poll() {
      if (!state.watchActive && state.events.length > 0) {
        // After watch expiration events still arrive through the polling fallback feed.
        return { events: [...state.events], snapshot: [...state.snapshot], watchActive: false };
      }
      return { events: [...state.events], snapshot: [...state.snapshot], watchActive: state.watchActive };
    },
  };
}

function failingSource(): GoogleChangeSource {
  return {
    async poll() {
      throw new Error('simulated change-tracking backend failure');
    },
  };
}

const WORKSPACE = 'ws-1';
const CONNECTION = 'conn-google-1';

function record(overrides: Partial<RegistryRecord> = {}): RegistryRecord {
  return {
    id: 'doc-entity-1',
    workspace_id: WORKSPACE,
    provider_connection_id: CONNECTION,
    external_id: 'ext-doc-1',
    current_revision: '10',
    updateCalls: 0,
    ...overrides,
  };
}

function event(overrides: Partial<GoogleChangeEvent> = {}): GoogleChangeEvent {
  return {
    eventId: 'evt-1',
    externalId: 'ext-doc-1',
    revision: '11',
    ...overrides,
  };
}

/** Ascending numeric-string revision order (deterministic fixture comparator). */
function compareRevisions(a: string, b: string): number {
  const na = Number.parseInt(a, 10);
  const nb = Number.parseInt(b, 10);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return a < b ? -1 : a > b ? 1 : 0;
  return na === nb ? 0 : na < nb ? -1 : 1;
}

function makeReconciler(registry: FakeRegistry, source: GoogleChangeSource): GoogleChangeReconciler {
  return createGoogleChangeReconciler({
    registry: registry as never,
    changeSource: source,
    compareRevisions,
    providerConnectionId: CONNECTION,
  });
}

/* =============================================================================
 * R-008 acceptance + REQUIRED validation coverage.
 * ============================================================================= */

describe('T-017 Google change reconciliation (R-008)', () => {
  it('R-008.1 external edit advances Entity known revision', async () => {
    const registry = new FakeRegistry([record()]);
    const source = fakeSource({ events: [event({ revision: '12' })], snapshot: [], watchActive: true });
    const result = await makeReconciler(registry, source).reconcile({ workspaceId: WORKSPACE });
    expect(result.outcomes).toEqual([
      { kind: 'applied', eventId: 'evt-1', externalId: 'ext-doc-1' },
    ]);
    expect(registry.records.get('doc-entity-1')?.current_revision).toBe('12');
    expect(registry.records.get('doc-entity-1')?.updateCalls).toBe(1);
    expect(result.health.state).toBe('healthy');
  });

  it('R-008 validation: duplicate event test — zero double-write', async () => {
    const registry = new FakeRegistry([record({ current_revision: '11' })]);
    // The same notification arrives twice (provider redelivery).
    const source = fakeSource({
      events: [
        event({ eventId: 'evt-dup', revision: '11' }),
        event({ eventId: 'evt-dup', revision: '11' }),
      ],
      snapshot: [],
      watchActive: true,
    });
    const result = await makeReconciler(registry, source).reconcile({ workspaceId: WORKSPACE });
    expect(result.outcomes.every((o) => o.kind === 'duplicate-ignored')).toBe(true);
    // Zero double-write asserted, not just "no crash": NO registry write happens at all
    // because the notification revision equals the already-known revision.
    expect(registry.totalUpdateCalls).toBe(0);
    expect(registry.records.get('doc-entity-1')?.current_revision).toBe('11');
    expect(result.duplicatesIgnored).toBe(2);
  });

  it('R-008 validation: out-of-order event test — older event discarded, never applied backwards', async () => {
    const registry = new FakeRegistry([record({ current_revision: '15' })]);
    // A delayed notification carrying an OLDER revision arrives after Entity already
    // observed the newer one.
    const source = fakeSource({
      events: [event({ eventId: 'evt-late', revision: '12' })],
      snapshot: [],
      watchActive: true,
    });
    const result = await makeReconciler(registry, source).reconcile({ workspaceId: WORKSPACE });
    expect(result.outcomes).toEqual([
      { kind: 'stale-discarded', eventId: 'evt-late', externalId: 'ext-doc-1' },
    ]);
    expect(registry.totalUpdateCalls).toBe(0);
    expect(registry.records.get('doc-entity-1')?.current_revision).toBe('15');
    expect(result.staleDiscarded).toBe(1);
  });

  it('R-008 validation: poll reconciliation test — lost notification recovered forward', async () => {
    const registry = new FakeRegistry([record({ current_revision: '10' })]);
    // The watch notification for rev 20 was LOST: the event feed is empty, but the
    // polling snapshot observes the newer provider revision.
    const source = fakeSource({
      events: [],
      snapshot: [{ externalId: 'ext-doc-1', revision: '20' }],
      watchActive: true,
    });
    const result = await makeReconciler(registry, source).reconcile({ workspaceId: WORKSPACE });
    expect(result.outcomes).toContainEqual({ kind: 'poll-reconciled', externalId: 'ext-doc-1' });
    expect(registry.records.get('doc-entity-1')?.current_revision).toBe('20');
    expect(registry.records.get('doc-entity-1')?.updateCalls).toBe(1);
  });

  it('R-008 validation: simulated webhook/watch expiration test — falls back to polling with degraded health', async () => {
    const registry = new FakeRegistry([record({ current_revision: '10' })]);
    const source = fakeSource({
      events: [event({ eventId: 'evt-post-expiry', revision: '13' })],
      snapshot: [],
      watchActive: false, // simulated watch/channel expiration
    });
    const result = await makeReconciler(registry, source).reconcile({ workspaceId: WORKSPACE });
    expect(result.health).toMatchObject({ state: 'degraded', mode: 'polling', reason: 'watch_expired' });
    // Metadata does NOT silently freeze: the polled event still advances state.
    expect(registry.records.get('doc-entity-1')?.current_revision).toBe('13');
    expect(result.outcomes).toContainEqual({
      kind: 'watch-expired-poll-applied',
      eventId: 'evt-post-expiry',
      externalId: 'ext-doc-1',
    });
  });

  it('R-008.4 change-tracking failure exposes degraded health, never freezes or crashes', async () => {
    const registry = new FakeRegistry([record()]);
    const result = await makeReconciler(registry, failingSource()).reconcile({ workspaceId: WORKSPACE });
    expect(result.health.state).toBe('degraded');
    expect(result.health.reason).toBe('change_tracking_failed');
    expect(result.health.mode).toBe('polling');
    expect(registry.totalUpdateCalls).toBe(0);
  });

  it('fail-closed: degraded change tracking never lifts a write lane / never marks capabilities supported', async () => {
    const registry = new FakeRegistry([record()]);
    const degraded = await makeReconciler(registry, failingSource()).reconcile({ workspaceId: WORKSPACE });
    expect(degraded.changeTrackingCapability).toMatchObject({
      name: 'change_tracking',
      state: 'degraded',
      actionable: false,
    });
    const expired = await makeReconciler(registry, fakeSource({ events: [], snapshot: [], watchActive: false }))
      .reconcile({ workspaceId: WORKSPACE });
    expect(expired.changeTrackingCapability.actionable).toBe(false);
    expect(expired.changeTrackingCapability.state).not.toBe('supported');
  });

  it('revision-token strictness: unsafe token at the boundary raises typed error, raw token never surfaced', async () => {
    const registry = new FakeRegistry([record()]);
    const evil = '12\u202E';
    const source = fakeSource({
      events: [event({ eventId: 'evt-evil', revision: evil })],
      snapshot: [],
      watchActive: true,
    });
    let caught: unknown;
    try {
      await makeReconciler(registry, source).reconcile({ workspaceId: WORKSPACE });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnsafeReconcileRevisionTokenError);
    const typed = caught as UnsafeReconcileRevisionTokenError;
    expect(typed.field).toBe('eventRevision');
    expect(typed.codePoint).toBe(0x202e);
    expect(typed.message).not.toContain(evil);
    expect(typed.message).not.toContain('\u202E');
    expect(registry.totalUpdateCalls).toBe(0);
  });

  it('workspace isolation: another workspace\'s documents are never read or written', async () => {
    const registry = new FakeRegistry([
      record(),
      record({ id: 'doc-other-ws', workspace_id: 'ws-2', external_id: 'ext-other' }),
    ]);
    const source = fakeSource({
      events: [event({ eventId: 'evt-cross', externalId: 'ext-other', revision: '30' })],
      snapshot: [{ externalId: 'ext-other', revision: '31' }],
      watchActive: true,
    });
    const result = await makeReconciler(registry, source).reconcile({ workspaceId: WORKSPACE });
    // From ws-1's view the foreign document is simply unknown — never read, never written.
    expect(result.outcomes.every((o) => o.kind === 'unknown-document')).toBe(true);
    expect(registry.records.get('doc-other-ws')?.updateCalls).toBe(0);
    expect(registry.totalUpdateCalls).toBe(0);
  });

  it('idempotent re-reconcile: replaying the same applied batch performs no second write', async () => {
    const registry = new FakeRegistry([record({ current_revision: '10' })]);
    const source = fakeSource({
      events: [event({ eventId: 'evt-a', revision: '14' })],
      snapshot: [],
      watchActive: true,
    });
    const first = await makeReconciler(registry, source).reconcile({ workspaceId: WORKSPACE });
    expect(first.applied).toBe(1);
    // Redelivery of the SAME batch after success: all duplicates, zero further writes.
    const second = await makeReconciler(registry, source).reconcile({ workspaceId: WORKSPACE });
    expect(second.outcomes.every((o) => o.kind === 'duplicate-ignored')).toBe(true);
    expect(registry.totalUpdateCalls).toBe(1);
    expect(registry.records.get('doc-entity-1')?.current_revision).toBe('14');
  });

  it('typed outcomes are auditable: duplicate, stale, and applied carry discriminated kinds', async () => {
    const registry = new FakeRegistry([record({ current_revision: '11' })]);
    const source = fakeSource({
      events: [
        event({ eventId: 'evt-dup', revision: '11' }),
        event({ eventId: 'evt-old', revision: '5' }),
        event({ eventId: 'evt-new', revision: '16' }),
      ],
      snapshot: [],
      watchActive: true,
    });
    const result = await makeReconciler(registry, source).reconcile({ workspaceId: WORKSPACE });
    expect(result.outcomes).toEqual([
      { kind: 'duplicate-ignored', eventId: 'evt-dup', externalId: 'ext-doc-1' },
      { kind: 'stale-discarded', eventId: 'evt-old', externalId: 'ext-doc-1' },
      { kind: 'applied', eventId: 'evt-new', externalId: 'ext-doc-1' },
    ]);
  });
});
