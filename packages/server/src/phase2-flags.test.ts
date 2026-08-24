import { describe, expect, it } from 'vitest';
import {
  phase2FlagEnabled,
  resolvePhase2Flags,
  serializePhase2FlagDiagnostics,
} from './phase2-flags';
import { capabilityResolutionEnabled } from './document-providers/capability-resolver';

describe('Phase 2 feature flags', () => {
  it('uses conservative staged defaults for strict enforcement and migration rollout', () => {
    const flags = resolvePhase2Flags({});

    expect(phase2FlagEnabled(flags, 'receipt_completion_enforcement')).toBe(true);
    expect(phase2FlagEnabled(flags, 'review_gate_policy_enforcement')).toBe(true);
    expect(phase2FlagEnabled(flags, 'worktype_registry_surface')).toBe(true);
    expect(phase2FlagEnabled(flags, 'search_permission_strictness')).toBe(true);
    expect(phase2FlagEnabled(flags, 'migration_enforcement')).toBe(false);
    expect(flags.migration_enforcement.stage).toBe('observation_only');
  });

  it('supports enable/disable lists with per-flag env overrides taking precedence', () => {
    const flags = resolvePhase2Flags({
      ENTITY_PHASE2_DISABLE_FLAGS: 'receipt-completion-enforcement, worktypeRegistrySurface',
      ENTITY_PHASE2_ENABLE_FLAGS: 'migration_enforcement',
      ENTITY_PHASE2_WORKTYPE_REGISTRY_SURFACE: 'on',
    });

    expect(flags.receipt_completion_enforcement).toMatchObject({
      enabled: false,
      source: 'disable_list',
    });
    expect(flags.migration_enforcement).toMatchObject({
      enabled: true,
      source: 'enable_list',
    });
    expect(flags.worktype_registry_surface).toMatchObject({
      enabled: true,
      source: 'env',
    });
  });

  it('serializes diagnostics with explicit THE-91 coverage and legacy compatibility state', () => {
    const diagnostics = serializePhase2FlagDiagnostics(
      resolvePhase2Flags({
        ENTITY_PHASE2_RECEIPT_COMPLETION_ENFORCEMENT: 'false',
      }),
      new Date('2026-06-24T16:45:00.000Z'),
    );

    expect(diagnostics).toMatchObject({
      profile: 'phase2-staged-rollout',
      generated_at: '2026-06-24T16:45:00.000Z',
      coverage: {
        receipt_completion: 'receipt_completion_enforcement',
        review_gate_policy: 'review_gate_policy_enforcement',
        worktype_registry: 'worktype_registry_surface',
        migration_enforcement: 'migration_enforcement',
        search_permission_strictness: 'search_permission_strictness',
      },
      legacy_compatibility: {
        old_tasks_remain_visible: true,
        disabled_flags_preserve_data: true,
        migration_enforcement_default: false,
      },
    });
    expect(diagnostics.flags.find((flag) => flag.key === 'receipt_completion_enforcement')).toMatchObject({
      enabled: false,
      source: 'env',
    });
    expect(diagnostics.groups.enforcement).toEqual(
      expect.arrayContaining([
        'receipt_completion_enforcement',
        'review_gate_policy_enforcement',
        'migration_enforcement',
        'search_permission_strictness',
      ]),
    );
  });

  it('F3b: capability_resolver_enforcement is default-enabled and surfaces in coverage + groups', () => {
    const flags = resolvePhase2Flags({});
    expect(phase2FlagEnabled(flags, 'capability_resolver_enforcement')).toBe(true);
    expect(flags.capability_resolver_enforcement).toMatchObject({
      key: 'capability_resolver_enforcement',
      envVar: 'ENTITY_PHASE2_CAPABILITY_RESOLVER_ENFORCEMENT',
      defaultEnabled: true,
      enabled: true,
      source: 'default',
      category: 'enforcement',
    });
    const diagnostics = serializePhase2FlagDiagnostics(flags, new Date('2026-08-18T00:00:00.000Z'));
    expect(diagnostics.coverage.capability_resolver).toBe('capability_resolver_enforcement');
    expect(diagnostics.groups.enforcement).toEqual(
      expect.arrayContaining(['capability_resolver_enforcement']),
    );
  });

  it('F3b: ENTITY_PHASE2_CAPABILITY_RESOLVER_ENFORCEMENT env override flips the resolved flag', () => {
    const on = resolvePhase2Flags({ ENTITY_PHASE2_CAPABILITY_RESOLVER_ENFORCEMENT: 'on' });
    expect(on.capability_resolver_enforcement).toMatchObject({ enabled: true, source: 'env' });
    const off = resolvePhase2Flags({ ENTITY_PHASE2_CAPABILITY_RESOLVER_ENFORCEMENT: '0' });
    expect(off.capability_resolver_enforcement).toMatchObject({ enabled: false, source: 'env' });
  });

  it('F3b: capabilityResolutionEnabled rollback switch follows the audited flag (single reversible point)', () => {
    // The documented fallback (disable-list) rolls the resolver *enforcement* back with no code
    // change; the resolver module itself stays pure.
    expect(capabilityResolutionEnabled(resolvePhase2Flags({}))).toBe(true);
    expect(
      capabilityResolutionEnabled(resolvePhase2Flags({ ENTITY_PHASE2_DISABLE_FLAGS: 'capability_resolver_enforcement' })),
    ).toBe(false);
    expect(
      capabilityResolutionEnabled(resolvePhase2Flags({ ENTITY_PHASE2_CAPABILITY_RESOLVER_ENFORCEMENT: 'off' })),
    ).toBe(false);
  });
});
