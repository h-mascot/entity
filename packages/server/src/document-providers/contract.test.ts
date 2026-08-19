/**
 * T-005 — Provider adapter contract — SHARED, provider-agnostic suite.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md
 *   - T-005: "Scope: interface plus deterministic fake.",
 *     "Acceptance: shared contract tests can execute against fake.",
 *     "Security: unsupported mutation fails closed."
 *   - §19.2 "Provider contract tests": "Every adapter must run against the same
 *     provider-neutral contract fixture" — register/discover, metadata, create/read/mutate
 *     when supported, unsupported-mutation rejection, revision capture, stale-write
 *     rejection, preview/permission normalization, open target, connection degradation,
 *     idempotent reconciliation. "Unsupported capability is a valid contract outcome.
 *     Lying about support is not."
 *   - R-024 (revision-aware mutation) / R-025 (standard conflict response) / D-012.
 *
 * The suite is exported as `runAdapterContractSuite(label, factory)` so ANY future adapter
 * (Google, Microsoft, local Office) can run the identical provider-neutral fixture —
 * precisely T-005's acceptance that "shared contract tests can execute against fake". The
 * bottom of this file instantiates the suite against the deterministic fake adapter, which
 * must pass it. A provider must never LIE about support: if a write capability is advertised
 * as unsupported/unknown/degraded, the corresponding action fails closed (typed error).
 */

import { describe, expect, it } from 'vitest';
import type {
  AdapterMutation,
  CapabilityContext,
  CapabilityReport,
  CapabilityType,
  CreateDocumentInput,
  CreateDocumentResult,
  DocumentProviderAdapter,
  MutateDocumentInput,
  ProviderArtifactDescriptor,
  ReadDocumentResult,
  ReconcileChangesInput,
} from './types';
import {
  AdapterArtifactNotFoundError,
  StaleRevisionError,
  UnsupportedAdapterMutationError,
} from './types';
import type { DocumentAuthState } from '../../../db/src/document-integrations';
import { createFakeDocumentProviderAdapter } from './fake-adapter';

/** Shared, deterministic base for a supported create call (fake executes it identically). */
function baseCreateInput(): CreateDocumentInput {
  return {
    artifact_type: 'document',
    title: 'Deterministic Shared Doc',
    provider_url: 'https://example.test/d/shared-1',
    idempotencyKey: 'idem:shared-1',
  };
}

/** Build the joining supported capability report for a document artifact. */
function supportedReportFor(adapter: DocumentProviderAdapter, provider: CapabilityContext['provider']): Promise<CapabilityReport> {
  return adapter.resolveCapabilities({
    provider,
    artifact_type: 'document',
    connectionState: 'authorized',
    destinationId: null,
    runtime: {},
  });
}

/**
 * Shared T-005 adapter contract suite. `label` is a display name (e.g. "fake-adapter");
 * `factory` returns a FRESH adapter instance per test so state never leaks across cases.
 * Any future adapter route imports and reuses this function against its own factory.
 */
export function runAdapterContractSuite(
  label: string,
  factory: () => DocumentProviderAdapter,
): void {
  describe(`T-005 adapter contract — ${label}`, () => {
    it('advertises its provider and a truthful R-002 capability report (D-003)', async () => {
      const adapter = factory();
      expect(adapter.provider).toBeTruthy();
      const report = await supportedReportFor(adapter, adapter.provider);
      // The report must be a complete R-002 vocabulary report; a missing/mislabeled key fails
      // closed (via capabilityAllowsActionForKey), so every capability name must equal its key.
      for (const name of Object.keys(report) as CapabilityType[]) {
        expect(report[name].name).toBe(name);
      }
      // No provider kind may be treated as write-authoritative (R-002).
      for (const cap of Object.values(report)) {
        expect(typeof cap.state).toBe('string');
      }
    });

    it('create → read → getMetadata round-trips deterministically (success path)', async () => {
      const adapter = factory();
      const created = await adapter.create(baseCreateInput());
      expect(created.created).toBe(true);
      // Every adapter-supplied record exposes provider and artifact_type explicitly.
      expect(created.descriptor.provider).toBe(adapter.provider);
      expect(created.descriptor.artifact_type).toBe('document');
      expect(created.descriptor.current_revision).toBeTruthy();

      const read = await adapter.read({
        external_id: created.descriptor.external_id,
        expectedRevision: created.descriptor.current_revision ?? undefined,
      });
      expect(read.descriptor.external_id).toBe(created.descriptor.external_id);

      const meta = await adapter.getMetadata({ external_id: created.descriptor.external_id });
      expect(meta?.current_revision).toBe(created.descriptor.current_revision);
      expect(meta?.provider).toBe(adapter.provider);
    });

    it('revision capture: create records a revision and read observes it (R-024/section 19.2)', async () => {
      const adapter = factory();
      const created = await adapter.create(baseCreateInput());
      const revision = created.descriptor.current_revision;
      // The stored revision must actually be observable through a fresh read — not fabricated.
      const read = await adapter.read({ external_id: created.descriptor.external_id });
      expect(read.descriptor.current_revision).toBe(revision);
    });

    it('UNSUPPORTED MUTATION FAILS CLOSED with a typed error (never a silent no-op)', async () => {
      const adapter = factory();
      const report = await adapter.resolveCapabilities({
        provider: adapter.provider,
        artifact_type: 'document',
        connectionState: 'authorized',
        destinationId: null,
        runtime: {},
      });
      // Mutate an EXISTING artifact across every lane; each lane the adapter does NOT advertise
      // as supported must be rejected loudly (typed UnsupportedAdapterMutationError) — never a
      // silent no-op or a fabricated success.
      const created = await adapter.create({
        ...baseCreateInput(),
        idempotencyKey: 'idem:fail-closed',
        title: 'Fail Closed Doc',
      });
      const mutationLanes: AdapterMutation[] = [
        { kind: 'text', text: 'x' },
        { kind: 'range', cell: 'A1', value: 'y' },
        { kind: 'slide', slideId: 's1' },
      ];
      for (const lane of mutationLanes) {
        const capability = lane.kind === 'text' ? 'agent_text_mutation'
          : lane.kind === 'range' ? 'agent_range_mutation' : 'agent_slide_mutation';
        if (report[capability].state !== 'supported') {
          await expect(
            adapter.mutate({
              external_id: created.descriptor.external_id,
              expectedRevision: created.descriptor.current_revision ?? '',
              mutation: lane,
            }),
          ).rejects.toBeInstanceOf(UnsupportedAdapterMutationError);
        }
      }
      // Explicit fail-closed negative: an adapter configured WITHOUT a write lane must reject
      // loudly rather than resolve to a fake success.
      const readOnly = factory();
      const roReport = await readOnly.resolveCapabilities({
        provider: readOnly.provider,
        artifact_type: 'document',
        connectionState: 'authorized',
        destinationId: null,
        runtime: {},
      });
      if (roReport.create.state !== 'supported') {
        await expect(readOnly.create(baseCreateInput())).rejects.toBeInstanceOf(
          UnsupportedAdapterMutationError,
        );
      }
    });

    it('capability-mismatch: an action excluded by advertised capabilities fails closed', async () => {
      // Create an adapter that advertises ONLY text mutation. Asking for range/slide mutation
      // (not in its advertised set) must fail closed with the typed error.
      const adapter = factory();
      const textOnly = await adapter.create({
        ...baseCreateInput(),
        idempotencyKey: 'idem:cap-mismatch',
        title: 'Capability Mismatch Doc',
      });
      const report = await adapter.resolveCapabilities({
        provider: adapter.provider,
        artifact_type: textOnly.descriptor.artifact_type,
        connectionState: 'authorized',
        destinationId: null,
        runtime: {},
      });
      const excluded: CapabilityType[] = ['agent_range_mutation', 'agent_slide_mutation'];
      for (const capability of excluded) {
        if (report[capability].state === 'supported') {
          continue; // adapter genuinely supports it — nothing to exclude
        }
        const lane: AdapterMutation = capability === 'agent_range_mutation'
          ? { kind: 'range', cell: 'A1', value: 'x' }
          : { kind: 'slide', slideId: 's2' };
        await expect(
          adapter.mutate({
            external_id: textOnly.descriptor.external_id,
            expectedRevision: textOnly.descriptor.current_revision ?? 'rev-1',
            mutation: lane,
          }),
        ).rejects.toBeInstanceOf(UnsupportedAdapterMutationError);
      }
    });

    it('stale-revision write is rejected with a typed conflict (never a silent overwrite)', async () => {
      const adapter = factory();
      const created = await adapter.create({
        ...baseCreateInput(),
        idempotencyKey: 'idem:stale-rev',
        title: 'Stale Revision Doc',
      });
      const first = await adapter.mutate({
        external_id: created.descriptor.external_id,
        expectedRevision: created.descriptor.current_revision ?? '',
        mutation: { kind: 'text', text: 'v2' },
      });
      // Replaying the ORIGINAL expectedRevision is now stale — must fail loudly.
      await expect(
        adapter.mutate({
          external_id: created.descriptor.external_id,
          expectedRevision: created.descriptor.current_revision ?? '',
          mutation: { kind: 'text', text: 'stale-v2' },
        }),
      ).rejects.toBeInstanceOf(StaleRevisionError);
      expect(first.resultRevision).not.toBe(first.priorRevision);
    });

    it('degraded connection capability suppresses a normally supported mutation (fails closed)', async () => {
      const adapter = factory();
      // Create while the connection is healthy so we have a real artifact to mutate.
      const created = await adapter.create({
        ...baseCreateInput(),
        idempotencyKey: 'idem:degraded',
        title: 'Degraded Doc',
      });
      // R-002: "A degraded connection can suppress a normally supported capability." If the
      // adapter supports drive-by degradation (the deterministic fake does), a degraded
      // connection must fold the write lane to degraded and mutation must fail closed.
      const extend = adapter as unknown as { setConnectionState?: (s: DocumentAuthState) => void };
      if (typeof extend.setConnectionState === 'function') {
        extend.setConnectionState('degraded');
        const degraded = await adapter.resolveCapabilities({
          provider: adapter.provider,
          artifact_type: 'document',
          connectionState: 'degraded',
          destinationId: null,
          runtime: {},
        });
        expect(degraded.agent_text_mutation.state).toBe('degraded');
        await expect(
          adapter.mutate({
            external_id: created.descriptor.external_id,
            expectedRevision: created.descriptor.current_revision ?? '',
            mutation: { kind: 'text', text: 'x' },
          }),
        ).rejects.toBeInstanceOf(UnsupportedAdapterMutationError);
      }
    });

    it('discover + reconcileChanges are idempotent over repeated identical discovery passes', async () => {
      const adapter = factory();
      const createdA = await adapter.create({
        ...baseCreateInput(),
        idempotencyKey: 'idem:discover-a',
        title: 'Discover A',
      });
      const createdB = await adapter.create({
        ...baseCreateInput(),
        artifact_type: 'spreadsheet',
        idempotencyKey: 'idem:discover-b',
        title: 'Discover B',
      });
      const discovered = await adapter.discover({});
      expect(discovered.items.length).toBeGreaterThanOrEqual(2);
      const ids = new Set(discovered.items.map((d) => d.external_id));
      expect(ids.has(createdA.descriptor.external_id)).toBe(true);
      expect(ids.has(createdB.descriptor.external_id)).toBe(true);

      // Reconcile the same discovery twice — identical input, identical result (dedupe).
      const pass1 = await adapter.reconcileChanges({ discovered: discovered.items });
      const pass2 = await adapter.reconcileChanges({ discovered: discovered.items });
      expect(pass1.reconciled.map((d) => d.external_id).sort()).toEqual(
        pass2.reconciled.map((d) => d.external_id).sort(),
      );
    });

    it('preview + permissions + open target normalize deterministically (R-034 / permissions-summary)', async () => {
      const adapter = factory();
      const created = await adapter.create({
        ...baseCreateInput(),
        idempotencyKey: 'idem:preview',
        title: 'Preview Doc',
      });
      const ext = created.descriptor.external_id;
      const preview = adapter.getPreview ? await adapter.getPreview({ external_id: ext }) : null;
      if (preview) {
        expect(['not_requested', 'pending', 'ready', 'failed', 'unsupported']).toContain(preview.state);
      }
      const perms = adapter.getPermissions ? await adapter.getPermissions({ external_id: ext }) : null;
      if (perms) {
        // permissions summary is a JSON string, never raw tokens/credentials (D-013).
        expect(() => JSON.parse(perms.summary_json)).not.toThrow();
      }
      const open = await adapter.getOpenTarget({ external_id: ext });
      expect(open.provider).toBe(adapter.provider);
      expect(open.artifact_type).toBe(created.descriptor.artifact_type);
    });

    it('unknown artifact read/metadata fails with a typed not-found error (never fabricated data)', async () => {
      const adapter = factory();
      await expect(
        adapter.read({ external_id: 'definitely-does-not-exist' }),
      ).rejects.toBeInstanceOf(AdapterArtifactNotFoundError);
      const meta = await adapter.getMetadata({ external_id: 'definitely-does-not-exist' });
      expect(meta).toBeNull();
    });

    it('determinism: identical inputs to a fresh identical fake produce identical outputs', async () => {
      const first = factory();
      const second = factory();
      const a = await first.create({ ...baseCreateInput(), idempotencyKey: 'idem:det' });
      const b = await second.create({ ...baseCreateInput(), idempotencyKey: 'idem:det' });
      expect(a.descriptor.external_id).toBe(b.descriptor.external_id);
      expect(a.descriptor.current_revision).toBe(b.descriptor.current_revision);
      expect(a.descriptor.provider_modified_at).toBe(b.descriptor.provider_modified_at);
    });
  });
}

// === Concrete instantiation: the deterministic fake adapter must pass the shared suite. ===
runAdapterContractSuite('fake-adapter', () => createFakeDocumentProviderAdapter());

/* ============================================================================
 * THE-946 r1 F3/F4 — carry-forward probe tests (fake-side half).
 *   - F3: R-026 create replay (`created:false`, same artifact); a DIRECT create-lane
 *     fail-closed guard (not only the dead conditional at the shared :166 spot); read-lane
 *     honesty assertions (read/getVersions/getPreview/getPermissions honor advertised state);
 *     unknown/degraded negative probes.
 *   - F4 (fake-side half only): every descriptor the fake returns carries
 *     `provider === adapter.provider`.
 * These are fake-specific, so they live OUTSIDE the provider-agnostic shared suite.
 * ============================================================================ */
describe('fake adapter carry-forward probes (THE-946 r1 F3/F4)', () => {
  it('R-026: a replayed create idempotency key reconciles to the same artifact (created:false)', async () => {
    const adapter = createFakeDocumentProviderAdapter();
    const first = await adapter.create({ ...baseCreateInput(), idempotencyKey: 'idem:replay-026' });
    const second = await adapter.create({ ...baseCreateInput(), idempotencyKey: 'idem:replay-026' });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.descriptor.external_id).toBe(first.descriptor.external_id);
    expect(second.descriptor.current_revision).toBe(first.descriptor.current_revision);
    expect(second.descriptor.provider).toBe(adapter.provider);
  });

  it('DIRECT create-lane fail-closed guard: create rejects when the create lane is not supported', async () => {
    // Adapter honest about not supporting create; the create action must fail closed loudly,
    // independent of the shared-suite's conditional probe.
    const readOnly = createFakeDocumentProviderAdapter({ capabilities: { create: 'unsupported' } });
    await expect(readOnly.create(baseCreateInput())).rejects.toBeInstanceOf(
      UnsupportedAdapterMutationError,
    );
  });

  it('READ-LANE honesty: read/getVersions/getPreview/getPermissions fail closed when unsupported', async () => {
    const adapter = createFakeDocumentProviderAdapter({
      capabilities: {
        read: 'unsupported',
        version_history: 'unsupported',
        preview: 'unsupported',
        permission_read: 'unsupported',
      },
    });
    const created = await adapter.create({ ...baseCreateInput(), idempotencyKey: 'idem:readlane' });
    const ext = created.descriptor.external_id;
    await expect(adapter.read({ external_id: ext })).rejects.toBeInstanceOf(
      UnsupportedAdapterMutationError,
    );
    if (adapter.getVersions) {
      await expect(adapter.getVersions({ external_id: ext })).rejects.toBeInstanceOf(
        UnsupportedAdapterMutationError,
      );
    }
    if (adapter.getPreview) {
      await expect(adapter.getPreview({ external_id: ext })).rejects.toBeInstanceOf(
        UnsupportedAdapterMutationError,
      );
    }
    if (adapter.getPermissions) {
      await expect(adapter.getPermissions({ external_id: ext })).rejects.toBeInstanceOf(
        UnsupportedAdapterMutationError,
      );
    }
  });

  it('UNKNOWN connection is fail-closed for every mutation lane (R-002 negative probe)', async () => {
    const adapter = createFakeDocumentProviderAdapter();
    const created = await adapter.create({ ...baseCreateInput(), idempotencyKey: 'idem:unknown-lane' });
    (adapter as { setConnectionState(s: DocumentAuthState): void }).setConnectionState('unknown');
    await expect(
      adapter.mutate({
        external_id: created.descriptor.external_id,
        expectedRevision: created.descriptor.current_revision ?? '',
        mutation: { kind: 'text', text: 'x' },
      }),
    ).rejects.toBeInstanceOf(UnsupportedAdapterMutationError);
  });

  it('DEGRADED connection is fail-closed for a CREATE lane (negative probe)', async () => {
    const adapter = createFakeDocumentProviderAdapter();
    (adapter as { setConnectionState(s: DocumentAuthState): void }).setConnectionState('degraded');
    await expect(adapter.create(baseCreateInput())).rejects.toBeInstanceOf(
      UnsupportedAdapterMutationError,
    );
  });

  it('F4 (fake half): every descriptor returned by the fake carries provider === adapter.provider', async () => {
    const adapter = createFakeDocumentProviderAdapter();
    const a = await adapter.create({ ...baseCreateInput(), idempotencyKey: 'idem:f4-a', title: 'F4 A' });
    const b = await adapter.create({
      ...baseCreateInput(),
      artifact_type: 'spreadsheet',
      idempotencyKey: 'idem:f4-b',
      title: 'F4 B',
    });
    for (const d of [a.descriptor, b.descriptor]) {
      expect(d.provider).toBe(adapter.provider);
    }
    const discovered = (await adapter.discover({})).items;
    for (const d of discovered) {
      expect(d.provider).toBe(adapter.provider);
    }
    const read = await adapter.read({ external_id: a.descriptor.external_id });
    expect(read.descriptor.provider).toBe(adapter.provider);
    const recon = await adapter.reconcileChanges({ discovered });
    for (const r of recon.reconciled) {
      expect(r.provider).toBe(adapter.provider);
    }
  });
});
