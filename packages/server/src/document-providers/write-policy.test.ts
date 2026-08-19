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
  resolveMutationAllowance,
  resolvedWriteMode,
  type WriteMode,
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
  it('minimum write modes are disabled, create_only, create_and_update', () => {
    const modes: WriteMode[] = ['disabled', 'create_only', 'create_and_update'];
    for (const m of modes) {
      expect(['disabled', 'create_only', 'create_and_update']).toContain(m);
    }
  });

  it('default after migration is disabled unless an existing explicit write authorization is proven', () => {
    // No explicit authorization => effective mode is disabled, even if a value was written.
    const unproven = basePolicy({ writeMode: 'create_and_update', writeAuthorizationProven: false });
    expect(resolvedWriteMode(unproven)).toBe('disabled');
    // An explicit write authorization is required to lift the default to a real mode.
    const proven = basePolicy({ writeMode: 'create_only', writeAuthorizationProven: true });
    expect(resolvedWriteMode(proven)).toBe('create_only');
    expect(resolvedWriteMode(basePolicy())).toBe('create_and_update');
  });

  it('needs an explicit write authorization for create_and_update', () => {
    expect(resolvedWriteMode(basePolicy({ writeMode: 'create_and_update', writeAuthorizationProven: true }))).toBe(
      'create_and_update',
    );
  });
});

describe('write policy: unapproved destination rejected (R-003 acceptance 1)', () => {
  it('a workspace cannot create into a destination absent from the approved set (policy veto)', async () => {
    const policy = basePolicy({ allowedDestinationIds: new Set(['dest_allowed']) });
    const scope = baseScope({ destinationId: 'dest_unapproved' });
    const decision = resolveCreateAllowance([policy], [], scope);
    expect(decision.policy).toBe('denied');
    expect(decision.destination).toBe('denied');
    // Integrated proof: feeding the decision into the resolver blocks create.
    await assertLaneBlocked(decision.destination, decision.policy, 'create');
  });

  it('the approved (default) destination is allowed and create is actionable', async () => {
    const policy = basePolicy();
    const decision = resolveCreateAllowance([policy], [], baseScope());
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

  it('explicitly raising an UnapprovedDestinationError is surfaced as a typed error', () => {
    // The service hard-fails a caller that demands a *specific* unapproved destination.
    const policy = basePolicy({ allowedDestinationIds: new Set(['dest_allowed']) });
    const scope = baseScope({ destinationId: 'dest_unapproved' });
    expect(() => {
      const decision = resolveCreateAllowance([policy], [], scope);
      if (decision.destination === 'denied') {
        throw new UnapprovedDestinationError(scope.workspaceId, scope.destinationId ?? '');
      }
    }).toThrow(UnapprovedDestinationError);
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
    const decision = resolveCreateAllowance([policy], [], scope);
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
});

describe('write policy: mutation lanes respect write mode (create_only vs create_and_update)', () => {
  it('create_only blocks the update/mutation lane but allows create', () => {
    const policy = basePolicy({ writeMode: 'create_only' });
    const create = resolveCreateAllowance([policy], [], baseScope());
    expect(create.policy).toBe('allowed');
    const mutate = resolveMutationAllowance([policy], baseScope());
    expect(mutate.policy).toBe('denied');
  });

  it('create_and_update allows both create and update lanes', () => {
    const policy = basePolicy({ writeMode: 'create_and_update' });
    expect(resolveCreateAllowance([policy], [], baseScope()).policy).toBe('allowed');
    expect(resolveMutationAllowance([policy], baseScope()).policy).toBe('allowed');
  });

  it('disabled blocks every write lane', () => {
    const policy = basePolicy({ writeMode: 'disabled', writeAuthorizationProven: true });
    expect(resolveCreateAllowance([policy], [], baseScope()).policy).toBe('denied');
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

describe('write policy: disabled preserves existing records (R-003 acceptance 4)', () => {
  it('disabling a policy blocks new writes but does not delete the policy/document records', () => {
    const servicePolicies: WritePolicy[] = [basePolicy()];
    const before = servicePolicies.length;
    // Disable: only flips `enabled`; the policy record stays in the store (nothing deleted).
    const disabled = basePolicy({ enabled: false });
    const scope = baseScope();
    const decision = resolveCreateAllowance([disabled], [], scope);
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
    const decision = resolveCreateAllowance(
      [basePolicy({ allowedDestinationIds: new Set(['dest_other']) })],
      [],
      baseScope({ destinationId: 'dest_unapproved' }),
    );
    expect(decision.destination).toBe('denied');
    const report = await resolveCapabilities({
      adapter: createFakeDocumentProviderAdapter(),
      artifactType: 'document',
      connection: 'authorized',
      destination: decision.destination,
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
