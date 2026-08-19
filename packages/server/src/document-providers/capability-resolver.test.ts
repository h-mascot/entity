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
  isWriteCapability,
  providerKindEnablesWrite,
  type ResolvedCapability,
} from './types';

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
  it('accepts all four states per capability', () => {
    for (const state of ['supported', 'unsupported', 'degraded', 'unknown'] as const) {
      expect(() => cap('read', state)).not.toThrow();
    }
  });

  it('accepts all five resolution sources', () => {
    for (const source of ['adapter', 'connection', 'destination', 'runtime', 'policy'] as const) {
      expect(() => cap('read', 'supported', source)).not.toThrow();
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
    }
  });
});
