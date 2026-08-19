/**
 * T-006 — Capability Resolver.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md
 *   - T-006: "Goal/value: Make API/UI actions truthful.",
 *     "Acceptance: provider + connection + destination + policy + runtime resolution works.",
 *     "Not done until: unknown mutation is rejected."
 *   - Capability Resolver component spec (§~line 2085): "Combines: provider baseline;
 *     artifact type; authenticated connection; destination; policy; runtime; degraded state."
 *   - R-002 "Provider-neutral capability negotiation": "unknown must fail closed for mutation
 *     and embedding."
 *   - PRD gate table R-002 => "Capability Resolver capability matrix tests".
 * Capability ADR (docs/adr/2026-08-entity-document-capability-architecture.md §5):
 *   resolution precedence `adapter < connection < destination < runtime < policy`; a
 *   higher-precedence source can only DEMOTE a lane, never promote an unsupported one; an
 *   `unknown` from any source fails closed for write/embedding.
 *
 * This resolver COMPOSES then folds the T-002 capability model (CapabilityReport /
 * capabilityAllowsActionForKey / REQUIRES_SUPPORTED_CAPABILITIES / FAIL_CLOSED_CAPABILITIES)
 * and the T-005 adapter contract (DocumentProviderAdapter.resolveCapabilities). It introduces
 * no second capability namespace, no receipt store, no provider registry, and no event table.
 *
 * Destination and policy are MINIMAL pass-through allowances here. The real Destination
 * Policy Service (R-003) is owned by T-007; until then the resolver treats "denied" as a
 * hard veto and "unknown" as fail-closed, and it never fabricates an allowance from a
 * provider name. See T-006 EVIDENCE for the boundary.
 *
 * Reversibility: the resolution rollout is registered behind an audited Phase 2 flag
 * (`capability_resolver_enforcement` in packages/server/src/phase2-flags.ts). This module is
 * pure and always computes a correct report; the gate helper `capabilityResolutionEnabled`
 * is the single reversible switch a caller (T-008 wiring) must consult before routing
 * through it, so behavior can be observed and rolled back without code changes.
 */

import type {
  CapabilityContext,
  CapabilityReport,
  CapabilitySource,
  CapabilityState,
  CapabilityType,
  DocumentProviderAdapter,
  ResolvedCapability,
} from './types';
import { CAPABILITY_NAMES, FAIL_CLOSED_CAPABILITIES, REQUIRES_SUPPORTED_CAPABILITIES } from './types';
import type { DocumentArtifactType, DocumentAuthState } from '../../../db/src/document-integrations';
import { type Phase2FlagSnapshot, phase2FlagEnabled } from '../phase2-flags';

/** Minimal destination allowance pass-through — T-007 owns the real Destination Policy Service (R-003). */
export type DestinationAllowance = 'allowed' | 'denied' | 'unknown';

/** Minimal policy allowance pass-through — T-007 owns the real write policy (R-003). */
export type PolicyAllowance = 'allowed' | 'denied' | 'unknown';

/** Full evidence set the resolver folds into a single verdict. */
export interface CapabilityResolutionInput {
  adapter: DocumentProviderAdapter;
  artifactType: DocumentArtifactType;
  /** Authenticated connection state (R-001 domain). */
  connection: DocumentAuthState;
  destination: DestinationAllowance;
  policy: PolicyAllowance;
  /** Provider-neutral runtime evidence (bridge health, mutation gate, …). */
  runtime: Readonly<Record<string, unknown>>;
}

/** Reversible rollout gate for the capability resolution (T-006 / phase2-flags). */
export function capabilityResolutionEnabled(flags: Phase2FlagSnapshot): boolean {
  return phase2FlagEnabled(flags, 'capability_resolver_enforcement');
}

/*
 * Fold mechanics.
 *
 * Each evidence source maps to a per-capability `CapabilityState` (a higher-precedence source
 * with nothing to say contributes nothing). States are folded by increasing severity:
 *   supported(0) < degraded(1) < unsupported(2) < unknown(3)
 * so a worse state always wins and a better state can never override a worse one (a
 * higher-precedence "allowed" cannot resurrect an adapter-unsupported lane — R-002 honesty).
 * On a severity tie the highest-precedence contributor claims the `source` tag, so the report
 * says which authority actually drove the final state.
 */
const SEVERITY: Record<CapabilityState, number> = {
  supported: 0,
  degraded: 1,
  unsupported: 2,
  unknown: 3,
};

interface EvidenceLayer {
  source: CapabilitySource;
  states: Partial<Record<CapabilityType, CapabilityState>>;
  reasonCode?: string;
}

/** Connection evidence: an unhealthy auth/connectivity state impairs every lane. */
function connectionEvidence(conn: DocumentAuthState): EvidenceLayer {
  const states: Partial<Record<CapabilityType, CapabilityState>> = {};
  if (conn === 'authorized') {
    return { source: 'connection', states };
  }
  for (const name of CAPABILITY_NAMES) {
    if (conn === 'unknown') {
      // R-002: unknown fails closed for mutation AND reading — nothing is actionable.
      states[name] = 'unknown';
    } else {
      // degraded / unauthorized: demote everything; write/embed/human_edit then fail closed,
      // read-like become degraded (still actionable per capabilityAllowsAction).
      states[name] = 'degraded';
    }
  }
  return { source: 'connection', states };
}

/** Destination evidence: a denied/unknown destination vetoes side-effecting lanes (R-003 pass-through). */
function destinationEvidence(allowance: DestinationAllowance): EvidenceLayer {
  const states: Partial<Record<CapabilityType, CapabilityState>> = {};
  if (allowance === 'allowed') {
    return { source: 'destination', states };
  }
  const state: CapabilityState = allowance === 'denied' ? 'unsupported' : 'unknown';
  for (const name of FAIL_CLOSED_CAPABILITIES) {
    states[name] = state;
  }
  return { source: 'destination', states, reasonCode: `destination_${allowance}` };
}

/** Runtime evidence: unhealthy runtime or a closed mutation gate demote/veto lanes. */
function runtimeEvidence(runtime: Readonly<Record<string, unknown>>): EvidenceLayer {
  const states: Partial<Record<CapabilityType, CapabilityState>> = {};
  if (runtime.healthy === false) {
    for (const name of CAPABILITY_NAMES) {
      states[name] = 'degraded';
    }
  }
  if (runtime.mutationGateOpen === false) {
    for (const name of FAIL_CLOSED_CAPABILITIES) {
      states[name] = 'unsupported';
    }
  }
  return { source: 'runtime', states };
}

/** Policy evidence: a policy veto/unknown is the highest authority over side-effecting lanes (R-003). */
function policyEvidence(allowance: PolicyAllowance): EvidenceLayer {
  const states: Partial<Record<CapabilityType, CapabilityState>> = {};
  if (allowance === 'allowed') {
    return { source: 'policy', states };
  }
  const state: CapabilityState = allowance === 'denied' ? 'unsupported' : 'unknown';
  for (const name of REQUIRES_SUPPORTED_CAPABILITIES) {
    states[name] = state;
  }
  return { source: 'policy', states, reasonCode: `policy_${allowance}` };
}

/** Fold evidence layers (ascending precedence) into the final report. */
export function foldCapabilityReport(layers: readonly EvidenceLayer[]): CapabilityReport {
  const out: Record<CapabilityType, ResolvedCapability> = {} as Record<
    CapabilityType,
    ResolvedCapability
  >;
  for (const name of CAPABILITY_NAMES) {
    // Default = unsupported (fail closed when nothing reports); `bestSeverity = -1` means "no
    // real evidence yet", so the first real evidence always overrides the default and a worse
    // (or equal-precedence) later evidence can still win (R-002: a better state never promotes).
    let state: CapabilityState = 'unsupported';
    let bestSeverity = -1;
    let source: CapabilitySource = 'adapter';
    let reasonCode: string | undefined;
    for (const layer of layers) {
      const s = layer.states[name];
      if (s === undefined) {
        continue;
      }
      const sev = SEVERITY[s];
      if (sev >= bestSeverity) {
        bestSeverity = sev;
        state = s;
        source = layer.source;
        // F1 (THE-947 r1): assign unconditionally so a winning layer that carries no
        // `reasonCode` clears a stale one from an earlier (tied/lower) layer, instead of
        // inheriting a code that no longer applies to the resolved state.
        reasonCode = layer.reasonCode;
      }
    }
    out[name] = { name, state, source, ...(reasonCode ? { reasonCode } : {}) };
  }
  return out as CapabilityReport;
}

/**
 * Resolve a single truthful capability verdict by folding provider baseline + artifact type
 * (via the T-005 adapter), authenticated connection, destination, runtime, and policy evidence
 * in the fixed precedence `adapter < connection < destination < runtime < policy`.
 *
 * The adapter's own `resolveCapabilities` supplies the provider baseline + artifact type and
 * any connection-awareness it is honest about; the resolver then re-asserts connection and
 * applies destination/runtime/policy folds on top, so even a non-connection-aware adapter
 * fails closed correctly (defense-in-depth).
 */
export async function resolveCapabilities(input: CapabilityResolutionInput): Promise<CapabilityReport> {
  const ctx: CapabilityContext = {
    provider: input.adapter.provider,
    artifact_type: input.artifactType,
    connectionState: input.connection,
    destinationId: null,
    runtime: input.runtime,
    policy: null,
  };
  // Step 1: provider baseline + artifact type from the adapter (T-005 contract).
  const baseline = await input.adapter.resolveCapabilities(ctx);
  const baselineLayer: EvidenceLayer = {
    source: 'adapter',
    states: Object.fromEntries(
      // F2 (THE-947 r1): a malformed/partial baseline report that omits a capability entry (or
      // holds a null value) must fold as fail-closed `unknown` — never throw `TypeError` on a
      // missing `.state`. The adapter contract is honest, but defense-in-depth keeps resolution
      // from crashing on a hostile/partial report; `unknown` fails closed downstream.
      CAPABILITY_NAMES.map((name) => {
        const resolved = (baseline as Partial<CapabilityReport>)[name];
        return [name, (resolved?.state ?? 'unknown') as CapabilityState];
      }),
    ) as Partial<Record<CapabilityType, CapabilityState>>,
  };

  // Step 2: fold ascending precedence — adapter < connection < destination < runtime < policy.
  const layers: EvidenceLayer[] = [
    baselineLayer,
    connectionEvidence(input.connection),
    destinationEvidence(input.destination),
    runtimeEvidence(input.runtime),
    policyEvidence(input.policy),
  ];
  return foldCapabilityReport(layers);
}
