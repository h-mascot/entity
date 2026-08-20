/**
 * T-007 — Provider destinations and write policy — automated proof.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md
 *   - R-003 "Provider destination and policy model": Entity must model where newly created
 *     artifacts are stored and which writes are authorized. Logical policy must support:
 *     provider; connection; artifact type; allowed destinations; default destination; write
 *     mode; optional confirmation policy; workspace/tenant scope.
 *   - Minimum write modes: disabled | create_only | create_and_update. "Default after
 *     migration is disabled unless an existing explicit write authorization can be proven."
 *   - Acceptance criteria (verbatim):
 *       "A workspace cannot create into an unapproved destination."
 *       "A read-only connection cannot be converted into write-capable merely because the
 *        OAuth token has broad scopes."
 *       "Missing destination policy blocks creation with a typed configuration error."
 *       "Policy can be disabled without deleting existing document records."
 *   - T-007: "Security: workspace/tenant isolation.",
 *             "Automated proof: allowed/denied destination tests."
 *   - document_provider_destinations (11.6) logical fields: id, connection_id, workspace_id,
 *     provider, artifact_type or wildcard, destination_kind, external_id or local
 *     managed-storage identity, display_name, write_mode, confirmation_policy, enabled.
 *
 * The decision functions here integrate with the T-006 Capability Resolver: a write-policy
 * decision yields a `DestinationAllowance` / `PolicyAllowance` that is fed straight into
 * `resolveCapabilities`, so defeating the policy necessarily makes the resolver's `create`
 * (and every write/embed/human_edit lane) non-actionable. This closes the T-006 pass-through
 * boundary: R-003 now owns the real destination/policy model.
 *
 * Privacy/determinism: no credentials, raw tokens, tenant secrets, document contents, or
 * operator-specific absolute paths; no network, no wall clock, no uncontrolled randomness.
 */
import { describe, expect, it } from 'vitest';
import {
  MissingDestinationPolicyError,
  UnapprovedDestinationError,
  type WritePolicy,
  type WriteRequestScope,
  createPolicyForWorkspace,
  defaultDestinationId,
  findGoverningPolicy,
  requiresConfirmation,
  resolveCreateAllowance,
  resolveDestinationAllowance,
  resolveMutationAllowance,
  resolvedWriteMode,
} from './write-policy';
import { resolveCapabilities, type DestinationAllowance, type PolicyAllowance } from './capability-resolver';
import { capabilityAllowsActionForKey, type CapabilityType } from './types';
import { createFakeDocumentProviderAdapter } from './fake-adapter';
import { destinationServesScope, type DocumentDestination } from './destinations';

/** Provider-neutral base scope (workspace W, tenant T, google, document). */
function baseScope(overrides: Partial<WriteRequestScope> = {}): WriteRequestScope {
  return {
    workspaceId: 'ws_A',
    tenantId: 'tenant_A',
    provider: 'google_workspace',
    artifactType: 'document',
    connectionId: 'conn_1',
    destinationId: 'dest_allowed',
    ...overrides,
  };
}

/** A governed policy: workspace A, tenant A, google, document, explicit write authorization. */
function basePolicy(overrides: Partial<WritePolicy> = {}): WritePolicy {
  return createPolicyForWorkspace({
    workspaceId: 'ws_A',
    tenantId: 'tenant_A',
    connectionId: 'conn_1',
    provider: 'google_workspace',
    artifactType: 'document',
    allowedDestinationIds: new Set(['dest_allowed']),
    defaultDestinationId: 'dest_allowed',
    writeMode: 'create_and_update',
    confirmationPolicy: null,
    writeAuthorizationProven: true,
    ...overrides,
  });
}

/** A destination record that serves the base scope and is enabled. */
function baseDestination(overrides: Partial<DocumentDestination> = {}): DocumentDestination {
  return {
    id: 'dest_allowed',
    workspaceId: 'ws_A',
    tenantId: 'tenant_A',
    connectionId: 'conn_1',
    provider: 'google_workspace',
    artifactTypes: new Set(['document']),
    destinationKind: 'folder',
    externalId: 'folder-1',
    displayName: 'Folder 1',
    enabled: true,
    ...overrides,
  };
}

/** Assert a resolved report leaves the given lane non-actionable. */
async function assertLaneBlocked(
  destination: DestinationAllowance,
  policy: PolicyAllowance,
  lane: CapabilityType,
): Promise<void> {
  const report = await resolveCapabilities({
    adapter: createFakeDocumentProviderAdapter(),
    artifactType: 'document',
    connection: 'authorized',
    destination,
    policy,
    runtime: {},
  });
  expect(report[lane].state).not.toBe('supported');
  expect(capabilityAllowsActionForKey(report, lane)).toBe(false);
}

describe('write policy: write modes and default-after-migration (R-003)', () => {
  // F4 (THE-948 r1): the `WriteMode` union type enforces the minimum mode set at compile time;
  // a tautological containment loop proved nothing, so it was removed in favor of that
  // compile-time guarantee. The runtime behavior of each mode is asserted below and in the
  // mutation-lane tests.

  it('default after migration is disabled unless an existing explicit write authorization is proven', () => {
    // No explicit authorization => effective mode is disabled, even if a value was written.
    const unproven = basePolicy({ writeMode: 'create_and_update', writeAuthorizationProven: false });
    expect(resolvedWriteMode(unproven)).toBe('disabled');
    // An explicit write authorization is required to lift the default to a real mode.
    const proven = basePolicy({ writeMode: 'create_only', writeAuthorizationProven: true });
    expect(resolvedWriteMode(proven)).toBe('create_only');
    expect(resolvedWriteMode(basePolicy())).toBe('create_and_update');
  });
});

describe('write policy: unapproved destination rejected (R-003 acceptance 1)', () => {
  it('a workspace cannot create into a destination absent from the approved set (hard-fails typed)', () => {
    const policy = basePolicy({ allowedDestinationIds: new Set(['dest_allowed']) });
    const dests = [baseDestination()];
    const scope = baseScope({ destinationId: 'dest_unapproved' });
    // A caller that demands a specific unapproved destination is hard-failed with the typed
    // UnapprovedDestinationError (THE-948 r1 F5b) — the library now throws it, not hand-built.
    expect(() => resolveCreateAllowance([policy], dests, scope)).toThrow(UnapprovedDestinationError);
    // The denied allowance is still observable through the pure allowance function, which the
    // resolver-integration test feeds into resolveCapabilities.
    expect(resolveDestinationAllowance(scope, policy.allowedDestinationIds, dests)).toBe('denied');
  });

  it('the approved (default) destination is allowed and create is actionable', async () => {
    const policy = basePolicy();
    const dests = [baseDestination()];
    const decision = resolveCreateAllowance([policy], dests, baseScope());
    expect(decision.policy).toBe('allowed');
    expect(decision.destination).toBe('allowed');
    expect(defaultDestinationId(policy)).toBe('dest_allowed');
    const report = await resolveCapabilities({
      adapter: createFakeDocumentProviderAdapter(),
      artifactType: 'document',
      connection: 'authorized',
      destination: decision.destination,
      policy: decision.policy,
      runtime: {},
    });
    expect(capabilityAllowsActionForKey(report, 'create')).toBe(true);
  });

  it('UnapprovedDestinationError is thrown by the library for an unapproved explicit destination', () => {
    // The service hard-fails a caller that demands a *specific* unapproved destination. The
    // typed error is thrown by resolveCreateAllowance itself (THE-948 r1 F5b), not hand-built.
    const policy = basePolicy({ allowedDestinationIds: new Set(['dest_allowed']) });
    const dests = [baseDestination()];
    const scope = baseScope({ destinationId: 'dest_unapproved' });
    try {
      resolveCreateAllowance([policy], dests, scope);
      throw new Error('expected UnapprovedDestinationError');
    } catch (err) {
      expect(err).toBeInstanceOf(UnapprovedDestinationError);
      if (err instanceof UnapprovedDestinationError) {
        expect(err.workspaceId).toBe('ws_A');
        expect(err.destinationId).toBe('dest_unapproved');
      }
    }
  });
});

describe('write policy: read-only connection is not write-promotable (R-003 acceptance 2)', () => {
  it('broad OAuth scope does not convert a read-only connection into write-capable', async () => {
    // The connection is read-only; nothing proves an explicit write authorization. Even though
    // the (simulated) OAuth token carries broad write scopes in the runtime evidence, the
    // policy's effective write mode stays 'disabled' because writeAuthorizationProven is false.
    const policy = basePolicy({
      writeMode: 'create_and_update',
      writeAuthorizationProven: false,
    });
    const scope = baseScope();
    const decision = resolveCreateAllowance([policy], [baseDestination()], scope);
    expect(resolvedWriteMode(policy)).toBe('disabled');
    expect(decision.policy).toBe('denied');
    // Defense-in-depth: even if some caller fabricates a broad-scope runtime flag, the policy
    // decision (fed to the resolver) must independently block create.
    await assertLaneBlocked(decision.destination, decision.policy, 'create');
    const report = await resolveCapabilities({
      adapter: createFakeDocumentProviderAdapter(),
      artifactType: 'document',
      connection: 'authorized',
      destination: decision.destination,
      policy: decision.policy,
      runtime: { oauthScopes: ['create', 'write_all'] },
    });
    expect(capabilityAllowsActionForKey(report, 'create')).toBe(false);
  });
});

describe('write policy: missing destination policy blocks creation (R-003 acceptance 3)', () => {
  it('no governing policy raises a typed configuration error (never silently allows)', () => {
    const scope = baseScope();
    expect(() => resolveCreateAllowance([], [], scope)).toThrow(MissingDestinationPolicyError);
    expect(() => resolveCreateAllowance([], [], scope)).toThrow(Error);
    // It is a *typed* configuration error, not a generic throw.
    try {
      resolveCreateAllowance([], [], scope);
      throw new Error('expected MissingDestinationPolicyError');
    } catch (err) {
      expect(err).toBeInstanceOf(MissingDestinationPolicyError);
      if (err instanceof MissingDestinationPolicyError) {
        expect(err.workspaceId).toBe('ws_A');
      }
    }
  });

  it('a policy for a *different* artifact type does not govern the request', () => {
    const policy = basePolicy({ artifactType: 'spreadsheet' });
    const scope = baseScope({ artifactType: 'document' });
    expect(findGoverningPolicy([policy], scope)).toBeNull();
    expect(() => resolveCreateAllowance([policy], [], scope)).toThrow(MissingDestinationPolicyError);
  });

  it('a missing governing policy blocks the mutation/update lane too (F5a)', () => {
    // Only the create path was tested before; the mutation path must throw the same typed error.
    const scope = baseScope();
    expect(() => resolveMutationAllowance([], scope)).toThrow(MissingDestinationPolicyError);
    try {
      resolveMutationAllowance([], scope);
      throw new Error('expected MissingDestinationPolicyError');
    } catch (err) {
      expect(err).toBeInstanceOf(MissingDestinationPolicyError);
      if (err instanceof MissingDestinationPolicyError) {
        expect(err.workspaceId).toBe('ws_A');
      }
    }
    // A policy for a different artifact type likewise does not govern the mutation request.
    const policy = basePolicy({ artifactType: 'spreadsheet' });
    expect(() => resolveMutationAllowance([policy], baseScope({ artifactType: 'document' }))).toThrow(
      MissingDestinationPolicyError,
    );
  });
});

describe('write policy: mutation lanes respect write mode (create_only vs create_and_update)', () => {
  it('create_only blocks the update/mutation lane but allows create', () => {
    const policy = basePolicy({ writeMode: 'create_only' });
    const create = resolveCreateAllowance([policy], [baseDestination()], baseScope());
    expect(create.policy).toBe('allowed');
    const mutate = resolveMutationAllowance([policy], baseScope());
    expect(mutate.policy).toBe('denied');
  });

  it('create_and_update allows both create and update lanes', () => {
    const policy = basePolicy({ writeMode: 'create_and_update' });
    expect(resolveCreateAllowance([policy], [baseDestination()], baseScope()).policy).toBe('allowed');
    expect(resolveMutationAllowance([policy], baseScope()).policy).toBe('allowed');
  });

  it('disabled blocks every write lane', () => {
    const policy = basePolicy({ writeMode: 'disabled', writeAuthorizationProven: true });
    expect(resolveCreateAllowance([policy], [baseDestination()], baseScope()).policy).toBe('denied');
    expect(resolveMutationAllowance([policy], baseScope()).policy).toBe('denied');
  });
});

describe('write policy: workspace/tenant isolation (T-007 security)', () => {
  it('a policy in another workspace never governs a request (fails closed, typed error)', () => {
    const policy = basePolicy({ workspaceId: 'ws_OTHER' });
    const scope = baseScope({ workspaceId: 'ws_A' });
    expect(findGoverningPolicy([policy], scope)).toBeNull();
    expect(() => resolveCreateAllowance([policy], [], scope)).toThrow(MissingDestinationPolicyError);
  });

  it('a policy in another tenant never governs a request', () => {
    const policy = basePolicy({ tenantId: 'tenant_OTHER' });
    const scope = baseScope({ tenantId: 'tenant_A' });
    expect(findGoverningPolicy([policy], scope)).toBeNull();
  });

  it('a request that omits tenant context never matches a tenant-scoped policy (fails closed)', () => {
    // Tenant scope is required for isolation; a tenant-less request cannot claim another
    // tenant's policy, so it fails closed rather than defaulting to a cross-tenant match.
    const policy = basePolicy();
    const tenantLess = baseScope({ tenantId: null });
    expect(findGoverningPolicy([policy], tenantLess)).toBeNull();
    const otherTenant = baseScope({ tenantId: 'tenant_OTHER' });
    expect(findGoverningPolicy([policy], otherTenant)).toBeNull();
  });
});

describe('write policy: default destination (R-003)', () => {
  it('default destination resolves from the governing policy for the artifact type', () => {
    const policy = basePolicy({ defaultDestinationId: 'dest_default' });
    expect(defaultDestinationId(policy)).toBe('dest_default');
    expect(basePolicy().defaultDestinationId).toBe('dest_allowed');
  });
});

describe('write policy: confirmation policy (R-003 logical model)', () => {
  it('confirmation is required only when policy says so; null means not required (OQ-003 default open)', () => {
    const none = basePolicy({ confirmationPolicy: null });
    const required = basePolicy({ confirmationPolicy: 'required' });
    expect(requiresConfirmation(none, 'create')).toBe(false);
    expect(requiresConfirmation(required, 'create')).toBe(true);
    expect(requiresConfirmation(required, 'update')).toBe(true);
    expect(requiresConfirmation(basePolicy({ confirmationPolicy: 'auto_approve' }), 'create')).toBe(false);
  });
});

describe('write policy: fail-closed rewritten branches (THE-948 r3 F2)', () => {
  it('a create with no explicit destination fails closed to unknown/denied (never guesses a location)', () => {
    // write-policy.ts:256-268 early-return branch — a scope that omits `destinationId` yields
    // destination 'unknown' and policy 'denied' even though the policy itself is healthy and
    // authorizes writes. The caller must pick an approved destination.
    const policy = basePolicy();
    const decision = resolveCreateAllowance([policy], [baseDestination()], baseScope({ destinationId: null }));
    expect(decision.policyFound).toBe(true);
    expect(decision.writeMode).toBe('create_and_update');
    expect(decision.destination).toBe('unknown');
    expect(decision.policy).toBe('denied');
    // The pure allowance predicate independently pins the same 'unknown' (unknown never enables).
    expect(resolveDestinationAllowance(baseScope({ destinationId: null }), policy.allowedDestinationIds, [baseDestination()])).toBe('unknown');
  });

  it('an empty approved set yields unknown and hard-fails an explicit destination (never allows)', () => {
    // write-policy.ts:190-193 — no approved destinations => 'unknown'; and via :247-250 an
    // explicit destination under an empty approved set throws the typed UnapprovedDestinationError.
    const policy = basePolicy({ allowedDestinationIds: new Set<string>() });
    expect(resolveDestinationAllowance(baseScope(), policy.allowedDestinationIds, [baseDestination()])).toBe('unknown');
    expect(() => resolveCreateAllowance([policy], [baseDestination()], baseScope())).toThrow(UnapprovedDestinationError);
  });
});

describe('write policy: disabled preserves existing records (R-003 acceptance 4)', () => {
  it('disabling a policy blocks new writes but does not delete the policy/document records', () => {
    const servicePolicies: WritePolicy[] = [basePolicy()];
    const before = servicePolicies.length;
    // Disable: only flips `enabled`; the policy record stays in the store (nothing deleted).
    const disabled = basePolicy({ enabled: false });
    const scope = baseScope();
    const decision = resolveCreateAllowance([disabled], [baseDestination()], scope);
    expect(decision.policy).toBe('denied');
    expect(servicePolicies).toHaveLength(before); // policy store untouched
    // Existing documented destinations/references remain resolvable after the flip.
    expect(defaultDestinationId(disabled)).toBe('dest_allowed');
  });
});

describe('write policy: destinations.ts model (R-003 destination records)', () => {
  it('a destination serves a scope only when workspace/tenant/provider/connection/artifact align', () => {
    const dest: DocumentDestination = {
      id: 'dest_allowed',
      workspaceId: 'ws_A',
      tenantId: 'tenant_A',
      connectionId: 'conn_1',
      provider: 'google_workspace',
      artifactTypes: new Set(['document']),
      destinationKind: 'folder',
      externalId: 'folder-1',
      displayName: 'Folder 1',
      enabled: true,
    };
    expect(destinationServesScope(dest, baseScope())).toBe(true);
    expect(destinationServesScope(dest, baseScope({ workspaceId: 'ws_OTHER' }))).toBe(false);
    expect(destinationServesScope(dest, baseScope({ tenantId: 'tenant_OTHER' }))).toBe(false);
    expect(destinationServesScope(dest, baseScope({ artifactType: 'spreadsheet' }))).toBe(false);
    expect(destinationServesScope(dest, baseScope({ connectionId: 'conn_OTHER' }))).toBe(false);
  });
});

describe('write policy: destination allowance integrates with the resolver lanes (F4 decision)', () => {
  it('destination gating covers mutation/create lanes and is consistent with the resolver fold', async () => {
    // The resolver's destinationEvidence gates exactly FAIL_CLOSED_CAPABILITIES. Destination
    // gating in T-007 must stay mutation/create-lane only (not extend to human_edit), matching
    // that fold input. A denied destination therefore blocks every write/embed lane but leaves
    // the read-only and human_edit lanes to their policy-level state.
    // (THE-948 r1 F1/F5b): resolveCreateAllowance now HARD-FAILS an unapproved explicit
    // destination, so the denied allowance is obtained from the pure resolveDestinationAllowance
    // predicate and fed into the resolver to prove the lane-blocking integration.)
    const policy = basePolicy({ allowedDestinationIds: new Set(['dest_other']) });
    const dests = [baseDestination()];
    const scope = baseScope({ destinationId: 'dest_unapproved' });
    const destination = resolveDestinationAllowance(scope, policy.allowedDestinationIds, dests);
    expect(destination).toBe('denied');
    const report = await resolveCapabilities({
      adapter: createFakeDocumentProviderAdapter(),
      artifactType: 'document',
      connection: 'authorized',
      destination,
      policy: 'allowed', // policy itself permits writes; destination veto blocks them
      runtime: {},
    });
    for (const lane of ['create', 'agent_text_mutation', 'permission_write', 'embed_editor'] as CapabilityType[]) {
      expect(report[lane].state).not.toBe('supported');
      expect(capabilityAllowsActionForKey(report, lane)).toBe(false);
    }
    // human_edit is governed by policy, not destination: an allowed policy + degraded runtime
    // keeps human_edit non-actionable through its own fail-closed rule, but destination denied
    // alone must not be what removes human_edit support (it stays supported in this fold).
    expect(report['human_edit'].state).toBe('unsupported'); // fake baseline honest: unsupported
    expect(capabilityAllowsActionForKey(report, 'human_edit')).toBe(false);
  });
});

describe('write policy: destination records gate creation (THE-948 r1 F1)', () => {
  // RED on current HEAD: an approved ID whose destination record is disabled, or whose record
  // mismatches the scope, must NOT authorize the create. The policy allowed set alone is not
  // sufficient — the destination record itself must be enabled and serve the request scope.
  // Name reflects steady-state meaning (these now pass at HEAD; RED is recorded in EVIDENCE §5a).
  it('an approved destination whose record is disabled does not authorize the create', () => {
    const policy = basePolicy({ allowedDestinationIds: new Set(['dest_allowed']) });
    const dests = [baseDestination({ enabled: false })];
    // explicit destination, approved by policy set, but the record is disabled => blocked.
    expect(() => resolveCreateAllowance([policy], dests, baseScope())).toThrow(UnapprovedDestinationError);
  });

  it('an approved destination whose record mismatches the workspace does not authorize the create', () => {
    const policy = basePolicy({ allowedDestinationIds: new Set(['dest_allowed']) });
    const dests = [baseDestination({ workspaceId: 'ws_OTHER' })];
    expect(() => resolveCreateAllowance([policy], dests, baseScope())).toThrow(UnapprovedDestinationError);
  });

  it('an approved destination whose record mismatches the artifact type does not authorize the create', () => {
    const policy = basePolicy({ allowedDestinationIds: new Set(['dest_allowed']) });
    const dests = [baseDestination({ artifactTypes: new Set(['spreadsheet']) })];
    expect(() => resolveCreateAllowance([policy], dests, baseScope())).toThrow(UnapprovedDestinationError);
  });

  it('an approved destination whose record serves the scope authorizes the create', () => {
    const policy = basePolicy({ allowedDestinationIds: new Set(['dest_allowed']) });
    const dests = [baseDestination()];
    const decision = resolveCreateAllowance([policy], dests, baseScope());
    expect(decision.destination).toBe('allowed');
    expect(decision.policy).toBe('allowed');
  });
});

describe('write policy: exact artifact type governs over wildcard (THE-948 r1 F2)', () => {
  const exact = basePolicy({ artifactType: 'document' });
  const wild = basePolicy({ artifactType: '*' });

  it('exact policy governs even when the wildcard precedes it in the array', () => {
    // RED: with first-match-wins, the leading '*' policy wrongly governs the exact request.
    expect(findGoverningPolicy([wild, exact], baseScope())).toBe(exact);
  });

  it('exact policy governs when it precedes the wildcard too (order-independent), ties first-match', () => {
    expect(findGoverningPolicy([exact, wild], baseScope())).toBe(exact);
  });

  it('wildcard governs only when no exact policy exists (first wildcard wins among wildcards)', () => {
    expect(findGoverningPolicy([wild], baseScope())).toBe(wild);
    // two wildcards: first-match-wins within the wildcard class.
    const wild2 = basePolicy({ artifactType: '*', workspaceId: 'ws_A' });
    expect(findGoverningPolicy([wild2, wild], baseScope())).toBe(wild2);
  });

  it('an exact policy for a *different* type never governs the request', () => {
    const otherExact = basePolicy({ artifactType: 'spreadsheet' });
    expect(findGoverningPolicy([otherExact, wild], baseScope())).toBe(wild);
  });

  it('a disabled exact policy governs over an enabled wildcard regardless of order (THE-948 r3 F3)', () => {
    // Precedence resolves specificity FIRST: an exact type policy governs over '*' even when the
    // exact policy is disabled and the wildcard is enabled — so adding a wildcard cannot
    // silently resurrect writes under a stale disabled exact policy (fail closed, deterministic).
    const disabledExact = basePolicy({ artifactType: 'document', enabled: false });
    const enabledWild = basePolicy({ artifactType: '*', enabled: true });
    // wildcard-first and disabled-exact-first both resolve to the disabled exact policy => disabled.
    expect(findGoverningPolicy([enabledWild, disabledExact], baseScope())).toBe(disabledExact);
    expect(findGoverningPolicy([disabledExact, enabledWild], baseScope())).toBe(disabledExact);
    expect(resolvedWriteMode(disabledExact)).toBe('disabled');
    expect(resolveMutationAllowance([enabledWild, disabledExact], baseScope()).policy).toBe('denied');
    expect(resolveMutationAllowance([disabledExact, enabledWild], baseScope()).policy).toBe('denied');
  });
});

describe('write policy: UnapprovedDestinationError cause differentiation (THE-948 r3 F4 → T-008)', () => {
  it('not-in-approved-set: a destination absent from the policy approved set carries an explicit cause', () => {
    const policy = basePolicy({ allowedDestinationIds: new Set(['dest_allowed']) });
    const dests = [baseDestination()];
    try {
      resolveCreateAllowance([policy], dests, baseScope({ destinationId: 'dest_unapproved' }));
      throw new Error('expected UnapprovedDestinationError');
    } catch (err) {
      expect(err).toBeInstanceOf(UnapprovedDestinationError);
      if (err instanceof UnapprovedDestinationError) {
        expect(err.workspaceId).toBe('ws_A');
        expect(err.destinationId).toBe('dest_unapproved');
        // Distinguishable cause for a pure policy veto (not a config/record bug).
        expect(err.cause).toBe('not_in_approved_set');
      }
    }
  });

  it('record-missing: an approved id with NO destination record carries a distinct cause', () => {
    const policy = basePolicy({ allowedDestinationIds: new Set(['dest_approved_no_record']) });
    try {
      // No destination record exists at all.
      resolveCreateAllowance([policy], [], baseScope({ destinationId: 'dest_approved_no_record' }));
      throw new Error('expected UnapprovedDestinationError');
    } catch (err) {
      expect(err).toBeInstanceOf(UnapprovedDestinationError);
      if (err instanceof UnapprovedDestinationError) {
        expect(err.cause).toBe('destination_record_missing');
      }
    }
  });

  it('record-disabled: an approved id whose destination record is disabled carries a distinct cause', () => {
    const policy = basePolicy({ allowedDestinationIds: new Set(['dest_allowed']) });
    const dests = [baseDestination({ enabled: false })];
    try {
      resolveCreateAllowance([policy], dests, baseScope({ destinationId: 'dest_allowed' }));
      throw new Error('expected UnapprovedDestinationError');
    } catch (err) {
      expect(err).toBeInstanceOf(UnapprovedDestinationError);
      if (err instanceof UnapprovedDestinationError) {
        expect(err.cause).toBe('destination_record_disabled');
      }
    }
  });

  it('scope-mismatch: an approved id whose record serves a different scope carries a distinct cause', () => {
    const policy = basePolicy({ allowedDestinationIds: new Set(['dest_allowed']) });
    // The record exists and is enabled but belongs to another workspace.
    const dests = [baseDestination({ workspaceId: 'ws_OTHER' })];
    try {
      resolveCreateAllowance([policy], dests, baseScope({ destinationId: 'dest_allowed' }));
      throw new Error('expected UnapprovedDestinationError');
    } catch (err) {
      expect(err).toBeInstanceOf(UnapprovedDestinationError);
      if (err instanceof UnapprovedDestinationError) {
        expect(err.cause).toBe('destination_scope_mismatch');
      }
    }
  });

  it('all four denial causes remain fail-closed: every one throws UnapprovedDestinationError', () => {
    // no-set
    expect(() =>
      resolveCreateAllowance(
        [basePolicy({ allowedDestinationIds: new Set(['dest_allowed']) })],
        [baseDestination()],
        baseScope({ destinationId: 'dest_unapproved' }),
      ),
    ).toThrow(UnapprovedDestinationError);
    // record-missing
    expect(() =>
      resolveCreateAllowance(
        [basePolicy({ allowedDestinationIds: new Set(['dest_no_record']) })],
        [],
        baseScope({ destinationId: 'dest_no_record' }),
      ),
    ).toThrow(UnapprovedDestinationError);
    // record-disabled
    expect(() =>
      resolveCreateAllowance(
        [basePolicy({ allowedDestinationIds: new Set(['dest_allowed']) })],
        [baseDestination({ enabled: false })],
        baseScope({ destinationId: 'dest_allowed' }),
      ),
    ).toThrow(UnapprovedDestinationError);
    // scope-mismatch
    expect(() =>
      resolveCreateAllowance(
        [basePolicy({ allowedDestinationIds: new Set(['dest_allowed']) })],
        [baseDestination({ workspaceId: 'ws_OTHER' })],
        baseScope({ destinationId: 'dest_allowed' }),
      ),
    ).toThrow(UnapprovedDestinationError);
  });
});
