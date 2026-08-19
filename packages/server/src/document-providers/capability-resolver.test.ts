/**
 * T-002 Capability resolver test plan (automated proof).
 *
 * Locks down the capability vocabulary and state/fail-closed semantics that the Capability
 * Resolver (T-006) must satisfy, per R-002 / D-003:
 *   - R-002 minimum 15-name capability vocabulary, CapabilityState, ResolvedCapability.
 *   - "unknown must fail closed for mutation and embedding."
 *   - "No write action is enabled solely because provider === 'google_workspace' or equivalent."
 *   - A degraded connection can suppress a normally supported capability.
 *   - A missing local bridge changes local human_edit readiness without changing the
 *     canonical provider type.
 *
 * The concrete resolution algorithm (precedence folding of adapter/connection/destination/
 * runtime/policy evidence) is implemented and proven in T-006's capability-resolver tests.
 * This file is the sanctioned test plan named in the T-002 contract.
 */
import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_NAMES,
  type CapabilityReport,
  type CapabilityType,
  capabilityAllowsAction,
  capabilityAllowsActionForKey,
  FAIL_CLOSED_CAPABILITIES,
  isWriteCapability,
  providerKindEnablesWrite,
  REQUIRES_SUPPORTED_CAPABILITIES,
  type ResolvedCapability,
} from './types';
import { resolveCapabilities, type CapabilityResolutionInput } from './capability-resolver';
import { createFakeDocumentProviderAdapter } from './fake-adapter';
import { UnsupportedAdapterMutationError, type DocumentProviderAdapter } from './types';
import type { DocumentAuthState } from '../../../db/src/document-integrations';

const VOCABULARY: readonly CapabilityType[] = [
  'create',
  'read',
  'preview',
  'thumbnail',
  'open_external',
  'human_edit',
  'agent_text_mutation',
  'agent_range_mutation',
  'agent_slide_mutation',
  'version_history',
  'change_tracking',
  'permission_read',
  'permission_write',
  'embed_editor',
  'export',
];

function cap(name: CapabilityType, state: ResolvedCapability['state'], source: ResolvedCapability['source'] = 'adapter'): ResolvedCapability {
  return { name, state, source };
}

describe('capability vocabulary (R-002)', () => {
  it('exposes the full 15-name minimum vocabulary, no more no less', () => {
    expect([...CAPABILITY_NAMES].sort()).toEqual([...VOCABULARY].sort());
    expect(CAPABILITY_NAMES).toHaveLength(15);
    // compile-time: a CapabilityReport keyed by CapabilityType covers every vocabulary member
    expect(VOCABULARY.length).toBeGreaterThanOrEqual(15);
  });

  it('all three provider kinds exist without implying any capability (D-003)', () => {
    // Provider name is never write-authoritative.
    expect(providerKindEnablesWrite('google_workspace')).toBe(false);
    expect(providerKindEnablesWrite('microsoft_365')).toBe(false);
    expect(providerKindEnablesWrite('local_office')).toBe(false);
  });
});

describe('capability state semantics (R-002)', () => {
  it('accepts all four states per capability with preserved state value', () => {
    for (const state of ['supported', 'unsupported', 'degraded', 'unknown'] as const) {
      const capability = cap('read', state);
      expect(capability.name).toBe('read');
      expect(capability.state).toBe(state);
    }
  });

  it('accepts all five resolution sources with preserved source value', () => {
    for (const source of ['adapter', 'connection', 'destination', 'runtime', 'policy'] as const) {
      const capability = cap('read', 'supported', source);
      expect(capability.name).toBe('read');
      expect(capability.source).toBe(source);
    }
  });

  it('unknown fails closed for every write/embedding capability (R-002)', () => {
    for (const name of ['create', 'agent_text_mutation', 'agent_range_mutation',
      'agent_slide_mutation', 'permission_write', 'embed_editor'] as const) {
      expect(capabilityAllowsAction(cap(name, 'unknown'))).toBe(false);
    }
  });

  it('unknown fails closed for mutation (agent_text_mutation)', () => {
    expect(capabilityAllowsAction(cap('agent_text_mutation', 'unknown'))).toBe(false);
  });

  it('unknown fails closed for embedding (embed_editor)', () => {
    expect(capabilityAllowsAction(cap('embed_editor', 'unknown'))).toBe(false);
  });

  it('degraded suppresses an otherwise-supported mutation (connection degradation)', () => {
    // Adapter reports support but the connection is degraded => action is suppressed.
    expect(capabilityAllowsAction(cap('agent_text_mutation', 'degraded'))).toBe(false);
    expect(capabilityAllowsAction(cap('agent_text_mutation', 'supported'))).toBe(true);
  });

  it('unsupported / degraded write and permission_write never enable a side effect', () => {
    for (const state of ['unsupported', 'degraded'] as const) {
      expect(capabilityAllowsAction(cap('create', state))).toBe(false);
      expect(capabilityAllowsAction(cap('permission_write', state))).toBe(false);
      expect(capabilityAllowsAction(cap('agent_text_mutation', state))).toBe(false);
      expect(capabilityAllowsAction(cap('agent_range_mutation', state))).toBe(false);
      expect(capabilityAllowsAction(cap('agent_slide_mutation', state))).toBe(false);
    }
  });

  it('classifies mutation/embedding/write capabilities as write capabilities', () => {
    expect(isWriteCapability(cap('agent_text_mutation', 'supported'))).toBe(true);
    expect(isWriteCapability(cap('embed_editor', 'supported'))).toBe(true);
    expect(isWriteCapability(cap('create', 'supported'))).toBe(true);
    expect(isWriteCapability(cap('permission_write', 'supported'))).toBe(true);
    expect(isWriteCapability(cap('read', 'supported'))).toBe(false);
  });

  it('read-like capabilities remain usable when supported or degraded, but fail closed on unknown', () => {
    expect(capabilityAllowsAction(cap('read', 'supported'))).toBe(true);
    expect(capabilityAllowsAction(cap('read', 'degraded'))).toBe(true);
    expect(capabilityAllowsAction(cap('read', 'unknown'))).toBe(false);
    expect(capabilityAllowsAction(cap('preview', 'supported'))).toBe(true);
  });

  it('R-002 regression: unsupported read-like and human-editing capabilities are non-actionable', () => {
    // R-002: "Unsupported capabilities result in a typed unsupported-capability response."
    // An unsupported read-like capability must never be exposed as actionable.
    for (const name of ['read', 'preview', 'thumbnail', 'open_external', 'human_edit',
      'version_history', 'change_tracking', 'permission_read', 'export'] as const) {
      expect(capabilityAllowsAction(cap(name, 'unsupported'))).toBe(false);
    }
    expect(capabilityAllowsAction(cap('human_edit', 'unsupported'))).toBe(false);
  });

  it('R-019 regression: degraded/unknown local human_edit is non-actionable (no false-functional Edit)', () => {
    // R-019: "No local Edit action appears functional when the runtime cannot complete it."
    // A missing or unhealthy local bridge reads `human_edit: degraded|unknown`; it must not
    // expose a functional Edit/Open-local action.
    expect(capabilityAllowsAction(cap('human_edit', 'degraded'))).toBe(false);
    expect(capabilityAllowsAction(cap('human_edit', 'unknown'))).toBe(false);
    expect(capabilityAllowsAction(cap('human_edit', 'unsupported'))).toBe(false);
    expect(capabilityAllowsAction(cap('human_edit', 'supported'))).toBe(true);
  });

  it('exhaustive fail-closed matrix: every supported-required capability across every non-supported state (incl. embed_editor)', () => {
    // Table-drive every capability in REQUIRES_SUPPORTED_CAPABILITIES (writes + embedding +
    // human_edit) through EVERY non-`supported` state. Each must be non-actionable; only
    // `supported` is actionable. This closes the P2 gap where `embed_editor` degraded/
    // unsupported were not directly asserted.
    const required: CapabilityType[] = [
      'create',
      'human_edit',
      'agent_text_mutation',
      'agent_range_mutation',
      'agent_slide_mutation',
      'permission_write',
      'embed_editor',
    ];
    for (const name of required) {
      for (const state of ['unsupported', 'degraded', 'unknown'] as const) {
        expect(capabilityAllowsAction(cap(name, state))).toBe(false);
      }
      expect(capabilityAllowsAction(cap(name, 'supported'))).toBe(true);
    }
  });
});

describe('capability report covers the full vocabulary (R-002 / D-003)', () => {
  it('a complete CapabilityReport resolves every vocabulary member', () => {
    const report: CapabilityReport = Object.fromEntries(
      VOCABULARY.map((name) => [name, cap(name, 'supported')]),
    ) as CapabilityReport;
    for (const name of VOCABULARY) {
      expect(report[name].name).toBe(name);
      expect(report[name].state).toBe('supported');
      expect(capabilityAllowsActionForKey(report, name)).toBe(true);
    }
  });

  it('P1 regression: a write lookup whose value name does not match its key fails closed', () => {
    // THE-943/R-002 fail-closed invariant: a caller must never enable a write by reading a
    // report key whose value is a mismatched (e.g. degraded read) capability. Defense-in-depth
    // rejects the mismatch even when the report originates from untyped adapter data.
    const mismatched = Object.fromEntries(
      VOCABULARY.map((name) => [name, cap(name, 'supported')]),
    ) as unknown as CapabilityReport;
    // Simulate untyped/tampered data: the value under `create` claims to be a degraded `read`.
    (mismatched as Record<string, ResolvedCapability>).create = cap('read', 'degraded');
    expect(capabilityAllowsActionForKey(mismatched, 'create')).toBe(false);
    expect(capabilityAllowsActionForKey(mismatched, 'read')).toBe(true); // key matches value name
  });

  it('malformed report: a missing requested key fails closed instead of throwing', () => {
    // F2 / THE-943 fail-closed invariant: the docstring declares the untrusted/untyped threat
    // model, so a report built from untyped adapter data that is missing the requested key must
    // return `false`, never throw `TypeError` on `resolved.name`.
    const report = Object.fromEntries(
      VOCABULARY.map((name) => [name, cap(name, 'supported')]),
    ) as unknown as CapabilityReport;
    // Simulate untrusted data that dropped the `create` entry entirely.
    delete (report as Record<string, ResolvedCapability>)['create'];
    expect(capabilityAllowsActionForKey(report, 'create')).toBe(false);
  });

  it('malformed report: a null value at the requested key fails closed instead of throwing', () => {
    // F2 / THE-943 fail-closed invariant: a report holding `null` at the requested key (from
    // untrusted adapter data) must return `false`, never throw `TypeError` on `resolved.name`.
    const report = Object.fromEntries(
      VOCABULARY.map((name) => [name, cap(name, 'supported')]),
    ) as unknown as CapabilityReport;
    // Simulate untrusted data that holds null under the `create` key.
    (report as Record<string, unknown>)['create'] = null;
    expect(capabilityAllowsActionForKey(report, 'create')).toBe(false);
  });
});

/* ============================================================================
 * T-006 — Capability Resolver behaviour (automated proof).
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md
 *   - T-006 "Goal/value: Make API/UI actions truthful.",
 *     "Acceptance: provider + connection + destination + policy + runtime resolution works.",
 *     "Not done until: unknown mutation is rejected."
 *   - Capability Resolver component spec (§~line 2085): "Combines: provider baseline;
 *     artifact type; authenticated connection; destination; policy; runtime; degraded state."
 *   - R-002 "unknown must fail closed for mutation and embedding."
 *   - PRD gate table R-002 => "Capability Resolver capability matrix tests".
 *   - Capability ADR §5: resolution precedence `adapter < connection < destination <
 *     runtime < policy`; a higher-precedence source can only DEMOTE a supported lane, never
 *     promote an unsupported one; `unknown` fails closed for write/embedding.
 *
 * The resolver COMPOSES the T-002 capability model (REQUIRES_SUPPORTED_CAPABILITIES,
 * FAIL_CLOSED_CAPABILITIES, capabilityAllowsActionForKey) and the T-005 adapter contract
 * (DocumentProviderAdapter.resolveCapabilities) — it invents no second capability namespace.
 * Destination/policy are MINIMAL pass-through allowances here; the real Destination Policy
 * Service is owned by T-007 (documented boundary in T-006 EVIDENCE).
 * ============================================================================ */

/** Deterministic resolver input over the fake adapter, baseline = healthy everything. */
function baseInput(overrides: Partial<CapabilityResolutionInput> = {}): CapabilityResolutionInput {
  return {
    adapter: createFakeDocumentProviderAdapter(),
    artifactType: 'document',
    connection: 'authorized',
    destination: 'allowed',
    policy: 'allowed',
    runtime: {},
    ...overrides,
  };
}

/** Adapter baseline (healthy connection) for the same fake — the pre-fold starting point. */
async function adapterBaseline(input: CapabilityResolutionInput): Promise<CapabilityReport> {
  return input.adapter.resolveCapabilities({
    provider: input.adapter.provider,
    artifact_type: input.artifactType,
    connectionState: 'authorized',
    destinationId: null,
    runtime: {},
  });
}

describe('Capability Resolver (T-006 precedence fold)', () => {
  it('acceptance: provider + connection + destination + policy + runtime resolution works', async () => {
    const report = await resolveCapabilities(baseInput());
    // Provider baseline + artifact type (via the T-005 adapter) drive the truthful baseline.
    expect(report['agent_text_mutation'].state).toBe('supported');
    expect(report['create'].state).toBe('supported');
    // Artifact type is honored through the adapter baseline (baseline is artifact-aware).
    const sheet = await resolveCapabilities(baseInput({ artifactType: 'spreadsheet' }));
    expect(sheet['agent_text_mutation'].state).toBe('supported');
  });

  it('matrix: connection state folds every capability per R-002 classification', async () => {
    for (const connection of ['authorized', 'degraded', 'unauthorized', 'unknown'] as const) {
      const baseline = await adapterBaseline(baseInput());
      const report = await resolveCapabilities(baseInput({ connection }));
      for (const name of [...CAPABILITY_NAMES]) {
        if (connection === 'authorized') {
          // no demotion: the resolved report equals the honest adapter baseline
          expect(report[name].state).toBe(baseline[name].state);
        } else if (connection === 'unknown') {
          // R-002: unknown fails closed for mutation AND reading — every lane is non-actionable
          expect(report[name].state).toBe('unknown');
          expect(capabilityAllowsActionForKey(report, name)).toBe(false);
        } else {
          // degraded / unauthorized: write+embed+human_edit fail closed, read-like degrade but stay actionable
          if (REQUIRES_SUPPORTED_CAPABILITIES.has(name)) {
            expect(report[name].state !== 'supported').toBe(true);
            expect(capabilityAllowsActionForKey(report, name)).toBe(false);
          } else {
            expect(report[name].state).toBe('degraded');
            expect(capabilityAllowsActionForKey(report, name)).toBe(true);
          }
        }
      }
    }
  });

  it('not-done-until: unknown connection never resolves any mutation lane to supported', async () => {
    const report = await resolveCapabilities(baseInput({ connection: 'unknown' }));
    for (const name of [...FAIL_CLOSED_CAPABILITIES]) {
      expect(report[name].state).toBe('unknown');
      expect(capabilityAllowsActionForKey(report, name)).toBe(false);
    }
  });

  it('unknown connection is rejected through the adapter lane as well (end-to-end fail closed)', async () => {
    const adapter = createFakeDocumentProviderAdapter();
    const created = await adapter.create({
      artifact_type: 'document',
      title: 'Unknown Connection Doc',
      idempotencyKey: 'idem:resolver-unknown-lane',
    });
    (adapter as { setConnectionState(s: DocumentAuthState): void }).setConnectionState('unknown');
    await expect(
      adapter.mutate({
        external_id: created.descriptor.external_id,
        expectedRevision: created.descriptor.current_revision ?? '',
        mutation: { kind: 'text', text: 'x' },
      }),
    ).rejects.toBeInstanceOf(UnsupportedAdapterMutationError);
  });

  it('destination denied fails closed for create + every write lane; unknown is even more conservative', async () => {
    for (const destination of ['denied', 'unknown'] as const) {
      const report = await resolveCapabilities(baseInput({ destination }));
      for (const name of [...FAIL_CLOSED_CAPABILITIES]) {
        const expected: ResolvedCapability['state'] = destination === 'denied' ? 'unsupported' : 'unknown';
        expect(report[name].state).toBe(expected);
        expect(capabilityAllowsActionForKey(report, name)).toBe(false);
      }
      // destination policy does not gate read-only lanes
      expect(report['read'].state).toBe('supported');
      expect(capabilityAllowsActionForKey(report, 'read')).toBe(true);
    }
  });

  it('policy denied vetoes every REQUIRES_SUPPORTED lane even when the adapter supports it (highest authority)', async () => {
    const report = await resolveCapabilities(baseInput({ policy: 'denied' }));
    for (const name of [...REQUIRES_SUPPORTED_CAPABILITIES]) {
      expect(report[name].state).toBe('unsupported');
      expect(capabilityAllowsActionForKey(report, name)).toBe(false);
    }
  });

  it('precedence: a failing connection demotes an optimistic adapter-supported lane and policy outranks all', async () => {
    const degraded = await resolveCapabilities(baseInput({ connection: 'degraded' }));
    expect(degraded['agent_text_mutation'].state).toBe('degraded');
    expect(degraded['agent_text_mutation'].source).toBe('connection');
    expect(capabilityAllowsActionForKey(degraded, 'agent_text_mutation')).toBe(false);

    // Full context even worse: degraded connection AND policy denied => policy wins (source policy).
    const vetoed = await resolveCapabilities(baseInput({ connection: 'degraded', policy: 'denied' }));
    expect(vetoed['agent_text_mutation'].state).toBe('unsupported');
    expect(vetoed['agent_text_mutation'].source).toBe('policy');
  });

  it('runtime evidence folds: unhealthy reaches all lanes; a closed mutation gate vetoes writes', async () => {
    const unhealthy = await resolveCapabilities(baseInput({ runtime: { healthy: false } }));
    expect(unhealthy['agent_text_mutation'].state).toBe('degraded');
    expect(capabilityAllowsActionForKey(unhealthy, 'agent_text_mutation')).toBe(false);
    expect(capabilityAllowsActionForKey(unhealthy, 'read')).toBe(true); // read-like degraded actionable

    const gate = await resolveCapabilities(baseInput({ runtime: { mutationGateOpen: false } }));
    expect(gate['agent_text_mutation'].state).toBe('unsupported');
    expect(gate['agent_text_mutation'].source).toBe('runtime');
    expect(capabilityAllowsActionForKey(gate, 'agent_text_mutation')).toBe(false);
  });

  it('fold never promotes: an adapter-unsupported lane stays unsupported regardless of downstream folds', async () => {
    const report = await resolveCapabilities(baseInput({ destination: 'allowed', policy: 'allowed', runtime: {} }));
    // Fake baseline is honestly unsupported for these lanes (T-005 "lying about support is not").
    const lanes: CapabilityType[] = ['agent_range_mutation', 'agent_slide_mutation', 'permission_write', 'embed_editor'];
    for (const name of lanes) {
      expect(report[name].state).toBe('unsupported');
      expect(capabilityAllowsActionForKey(report, name)).toBe(false);
    }
  });

  it('partition-exhaustion: every capability obeys its REQUIRES_SUPPORTED classification across all fold states', async () => {
    // 4 connection × 3 destination × 3 policy = 36 full-report rows × 15 capabilities.
    for (const connection of ['authorized', 'degraded', 'unauthorized', 'unknown'] as const) {
      for (const destination of ['allowed', 'denied', 'unknown'] as const) {
        for (const policy of ['allowed', 'denied', 'unknown'] as const) {
          const report = await resolveCapabilities(baseInput({ connection, destination, policy }));
          for (const name of [...CAPABILITY_NAMES]) {
            const state = report[name].state;
            expect(report[name].name).toBe(name);
            if (REQUIRES_SUPPORTED_CAPABILITIES.has(name)) {
              // writes/embed/human_edit actionable ONLY when fully supported
              expect(capabilityAllowsActionForKey(report, name)).toBe(state === 'supported');
            } else {
              // read-like actionable when supported or degraded; fail closed on unknown/unsupported
              expect(capabilityAllowsActionForKey(report, name)).toBe(
                state === 'supported' || state === 'degraded',
              );
            }
          }
        }
      }
    }
  });

  it('F3a: a closed mutation gate vetoes ALL six fail-closed lanes (exhaustive)', async () => {
    // THE-947 r1 F3a: previously only `agent_text_mutation` was explicitly asserted for the
    // `mutationGateOpen:false` runtime fold. Every FAIL_CLOSED_CAPABILITIES lane must be vetoed.
    const six: CapabilityType[] = [
      'create',
      'agent_text_mutation',
      'agent_range_mutation',
      'agent_slide_mutation',
      'permission_write',
      'embed_editor',
    ];
    // The mutually exclusive classes must be exhaustive of the fail-closed set.
    expect([...FAIL_CLOSED_CAPABILITIES].sort()).toEqual([...six].sort());
    const gate = await resolveCapabilities(baseInput({ runtime: { mutationGateOpen: false } }));
    for (const name of six) {
      expect(gate[name].state).toBe('unsupported');
      expect(gate[name].source).toBe('runtime');
      expect(capabilityAllowsActionForKey(gate, name)).toBe(false);
    }
  });

  it('F3a: healthy:false demotes every supported lane to degraded and keeps every write lane fail-closed (exhaustive)', async () => {
    // THE-947 r1 F3a: complete the `healthy:false` coverage across every capability. Fold
    // semantics: the runtime emitters `degraded` for ALL lanes, so a lane whose adapter
    // baseline is `supported` resolves to `degraded` (source runtime, read-like still
    // actionable); a lane the adapter honestly reports as `unsupported` stays `unsupported`
    // (worse severity wins — never promoted). Every write/embed/human_edit lane is
    // non-actionable under an unhealthy runtime, exhaustively.
    const unhealthy = await resolveCapabilities(baseInput({ runtime: { healthy: false } }));
    const baselineReport = await adapterBaseline(baseInput());
    for (const name of CAPABILITY_NAMES) {
      if (baselineReport[name].state === 'unsupported') {
        // A worse baseline state wins; runtime cannot resurrect it.
        expect(unhealthy[name].state).toBe('unsupported');
        expect(capabilityAllowsActionForKey(unhealthy, name)).toBe(false);
      } else {
        // Supported read-like lanes degrade but stay actionable; write/embed/human_edit fail closed.
        expect(unhealthy[name].state).toBe('degraded');
        expect(unhealthy[name].source).toBe('runtime');
        expect(capabilityAllowsActionForKey(unhealthy, name)).toBe(
          !REQUIRES_SUPPORTED_CAPABILITIES.has(name),
        );
      }
    }
    // Spot-sanity: the fake's agent_text_mutation and read lanes are both supported at baseline,
    // so both demote to degraded; mutation fails closed while read stays actionable.
    expect(unhealthy['agent_text_mutation'].state).toBe('degraded');
    expect(capabilityAllowsActionForKey(unhealthy, 'agent_text_mutation')).toBe(false);
    expect(unhealthy['read'].state).toBe('degraded');
    expect(capabilityAllowsActionForKey(unhealthy, 'read')).toBe(true);
  });

  it('F3a: open mutation gate + healthy runtime leave the adapter baseline intact', async () => {
    const open = await resolveCapabilities(baseInput({ runtime: { healthy: true, mutationGateOpen: true } }));
    expect(open['agent_text_mutation'].state).toBe('supported');
    expect(open['read'].state).toBe('supported');
    expect(capabilityAllowsActionForKey(open, 'agent_text_mutation')).toBe(true);
  });

  it('F2 RED: a malformed/partial baseline report resolves to typed unknown, never throws', async () => {
    // THE-947 r1 F2: a baseline report from an adapter that omits capability entries (or holds
    // nulls) must fold as fail-closed `unknown` — it must NEVER throw TypeError on a missing
    // `.state`. The resolveCapabilities baseline fold must default missing entries to `unknown`.
    const malformedAdapter: DocumentProviderAdapter = {
      provider: 'google_workspace',
      async resolveCapabilities(): Promise<CapabilityReport> {
        // A partial/hostile report: only `read` is present; every other entry is missing.
        return {
          read: { name: 'read', state: 'supported', source: 'adapter' },
        } as unknown as CapabilityReport;
      },
      async discover() {
        return { items: [], truncated: false };
      },
      async getMetadata() {
        return null;
      },
      async create() {
        throw new Error('unsupported');
      },
      async read() {
        return { descriptor: {} as never, contentPlaceholder: '' };
      },
      async mutate() {
        throw new Error('unsupported');
      },
      async getOpenTarget() {
        return { provider: 'google_workspace', artifact_type: 'document', url: null };
      },
      async reconcileChanges() {
        return { reconciled: [], dropped: [] };
      },
    };
    const report = await resolveCapabilities(baseInput({ adapter: malformedAdapter }));
    // A missing capability entry is treated as `unknown` (fail closed), not a TypeError.
    expect(report['agent_text_mutation'].state).toBe('unknown');
    expect(capabilityAllowsActionForKey(report, 'agent_text_mutation')).toBe(false);
    expect(report['create'].state).toBe('unknown');
    expect(capabilityAllowsActionForKey(report, 'create')).toBe(false);
    // The present read entry is honored.
    expect(report['read'].state).toBe('supported');
  });

  it('F2 RED: malformed baseline hostile `null` entries follow the same fail-closed default', async () => {
    const nullAdapter: DocumentProviderAdapter = {
      provider: 'microsoft_365',
      async resolveCapabilities(): Promise<CapabilityReport> {
        return {
          read: { name: 'read', state: 'supported', source: 'adapter' },
          create: null as unknown as ResolvedCapability,
        } as unknown as CapabilityReport;
      },
      async discover() {
        return { items: [], truncated: false };
      },
      async getMetadata() {
        return null;
      },
      async create() {
        throw new Error('unsupported');
      },
      async read() {
        return { descriptor: {} as never, contentPlaceholder: '' };
      },
      async mutate() {
        throw new Error('unsupported');
      },
      async getOpenTarget() {
        return { provider: 'microsoft_365', artifact_type: 'document', url: null };
      },
      async reconcileChanges() {
        return { reconciled: [], dropped: [] };
      },
    };
    const report = await resolveCapabilities(baseInput({ adapter: nullAdapter }));
    expect(report['create'].state).toBe('unknown');
    expect(capabilityAllowsActionForKey(report, 'create')).toBe(false);
  });

  it('F3c: unknown-connection mutation is rejected with the typed unsupported error (not generic Error)', async () => {
    // THE-947 r1 F3c: tighten the end-to-end unknown-connection rejection from a generic Error
    // to the typed UnsupportedAdapterMutationError so the fail-closed path is explicit.
    const adapter = createFakeDocumentProviderAdapter();
    const created = await adapter.create({
      artifact_type: 'document',
      title: 'F3c Doc',
      idempotencyKey: 'idem:f3c',
    });
    (adapter as { setConnectionState(s: DocumentAuthState): void }).setConnectionState('unknown');
    await expect(
      adapter.mutate({
        external_id: created.descriptor.external_id,
        expectedRevision: created.descriptor.current_revision ?? '',
        mutation: { kind: 'text', text: 'x' },
      }),
    ).rejects.toBeInstanceOf(UnsupportedAdapterMutationError);
  });
});
