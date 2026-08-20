/**
 * T-007 — Provider write policy (R-003): which writes are authorized and where.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md
 *   - R-003 "Provider destination and policy model":
 *       "Entity must model where newly created artifacts are stored and which writes are
 *        authorized."
 *     Logical policy must support: provider; connection; artifact type; allowed destinations;
 *     default destination; write mode; optional confirmation policy; workspace/tenant scope.
 *     Minimum write modes: disabled | create_only | create_and_update.
 *     "Default after migration is disabled unless an existing explicit write authorization can
 *      be proven."
 *     Acceptance criteria (verbatim):
 *       "A workspace cannot create into an unapproved destination."
 *       "A read-only connection cannot be converted into write-capable merely because the
 *        OAuth token has broad scopes."
 *       "Missing destination policy blocks creation with a typed configuration error."
 *       "Policy can be disabled without deleting existing document records."
 *   - T-007: "Security: workspace/tenant isolation.",
 *             "Automated proof: allowed/denied destination tests."
 *   - Destination Policy Service component (§2103): "Resolves where creation is allowed."
 *
 * Design (F4 decision, see T-007 EVIDENCE §F4):
 *   write-policy.ts produces a `DestinationAllowance` (where creation may go) and a
 *   `PolicyAllowance` (whether the write mode authorizes the operation). These are consumed
 *   directly by the T-006 Capability Resolver's destination/policy folds. Consistent with the
 *   resolver's `destinationEvidence` (which gates exactly `FAIL_CLOSED_CAPABILITIES`),
 *   destination gating stays mutation/create-lane only and does NOT extend to `human_edit`;
 *   `human_edit` fail-closure is governed by policy + runtime (R-019), not destination.
 *
 * Persistence boundary: ISSUE-MAP names no db/migration path for T-007. The model here is a
 * pure, serializable shape so T-013/T-034 can persist it later. This module performs NO DB
 * writes, NO deletion of document records, and adds NO routes/registry/receipt store.
 *
 * Privacy: no credentials, raw tokens, tenant secrets, document contents, or operator-specific
 * absolute paths.
 */

import type { DocumentArtifactType, DocumentProvider } from '../../../db/src/document-integrations';
import { type DestinationAllowance, type PolicyAllowance } from './capability-resolver';
import {
  type DestinationApprovalScope,
  type DocumentDestination,
  destinationsServingScope,
} from './destinations';

/** R-003 minimum write modes. Default after migration is `disabled` unless proven otherwise. */
export type WriteMode = 'disabled' | 'create_only' | 'create_and_update';

/** R-003 optional confirmation policy (OQ-003 exact default is open downstream; null = not required). */
export type ConfirmationPolicy = 'required' | 'auto_approve' | 'not_required';

/** The write operation a caller is requesting against a policy. */
export type WriteOperation = 'create' | 'update';

/**
 * A scoped write authorization (R-003 logical policy).
 *
 * Scoped by `workspaceId` (REQUIRED) and `tenantId` (exact matched). Every decision is made
 * only against policies whose scope equals the request scope — a policy from another
 * workspace/tenant never governs a request (fail closed).
 *
 * `writeMode` is the DESIRED mode; `resolvedWriteMode()` returns the effect of R-003's
 * "disabled unless an existing explicit write authorization can be proven" rule via
 * `writeAuthorizationProven`. Broad OAuth scopes are never treated as a proof of write
 * authorization (acceptance 2).
 */
export interface WritePolicy {
  workspaceId: string;
  tenantId: string | null;
  connectionId: string | null;
  provider: DocumentProvider;
  /** A concrete artifact type or `'*'` wildcard governing every type. */
  artifactType: DocumentArtifactType | '*';
  /** The approved (allowed) destinations for this policy scope. */
  allowedDestinationIds: ReadonlySet<string>;
  /** The default destination for this scope, if configured. */
  defaultDestinationId: string | null;
  writeMode: WriteMode;
  confirmationPolicy: ConfirmationPolicy | null;
  /** False => effective write mode is `disabled` regardless of `writeMode` (R-003 default). */
  writeAuthorizationProven: boolean;
  /** False => policy is disabled but its record is preserved (never auto-deleted). */
  enabled: boolean;
}

/** The scope a create/mutation request is evaluated against. */
export interface WriteRequestScope extends DestinationApprovalScope {
  /** The exact destination requested; null when the caller defers to the default destination. */
  destinationId: string | null;
}

/** Input shape for `createPolicyForWorkspace` with safe defaults. */
export interface WritePolicyInput {
  workspaceId: string;
  tenantId?: string | null;
  connectionId?: string | null;
  provider: DocumentProvider;
  artifactType: DocumentArtifactType | '*';
  allowedDestinationIds: ReadonlySet<string>;
  defaultDestinationId?: string | null;
  writeMode?: WriteMode;
  confirmationPolicy?: ConfirmationPolicy | null;
  writeAuthorizationProven?: boolean;
  enabled?: boolean;
}

/** Build a policy record with R-003's conservative defaults (no implicit write authorization). */
export function createPolicyForWorkspace(input: WritePolicyInput): WritePolicy {
  return {
    workspaceId: input.workspaceId,
    tenantId: input.tenantId ?? null,
    connectionId: input.connectionId ?? null,
    provider: input.provider,
    artifactType: input.artifactType,
    allowedDestinationIds: input.allowedDestinationIds,
    defaultDestinationId: input.defaultDestinationId ?? null,
    // R-003: default write mode is disabled; only an explicit proven authorization lifts it.
    writeMode: input.writeMode ?? 'disabled',
    confirmationPolicy: input.confirmationPolicy ?? null,
    writeAuthorizationProven: input.writeAuthorizationProven ?? false,
    enabled: input.enabled ?? true,
  };
}

/** The configured default destination for a policy, or null. */
export function defaultDestinationId(policy: WritePolicy): string | null {
  return policy.defaultDestinationId ?? null;
}

/**
 * Effective write mode.
 *
 * R-003: "Default after migration is disabled unless an existing explicit write authorization
 * can be proven." A disabled policy, or a policy without a proven explicit write authorization,
 * resolves to `disabled` — even if a `writeMode` value was stored — so a read-only connection
 * can NEVER be promoted to write-capable by stored mode alone or by broad OAuth scopes.
 */
export function resolvedWriteMode(policy: WritePolicy): WriteMode {
  if (!policy.enabled) {
    return 'disabled';
  }
  if (!policy.writeAuthorizationProven) {
    return 'disabled';
  }
  return policy.writeMode;
}

/**
 * Find the single policy governing a request scope.
 *
 * Workspace + tenant + provider + connection all must equal exactly; artifact type may be an
 * exact match or a `'*'` wildcard. A policy from another workspace/tenant never matches
 * (T-007 isolation). Returns null on no match (callers fail closed with a typed error).
 *
 * Precedence (THE-948 r1 F2): an exact `artifactType` match governs over a `'*'` wildcard,
 * regardless of array order. Within the same specificity class, the first matching policy in
 * the array wins. A wildcard governs only when no exact policy exists for the scope.
 *
 * Enabled/disabled interplay (THE-948 r3 F3): specificity is resolved first — an exact
 * `artifactType` match always governs over a `'*'` wildcard no matter the array order or enabled
 * state. Consequently a DISABLED exact policy still governs (and, through `resolvedWriteMode`,
 * resolves to `disabled`) over an ENABLED wildcard: adding a wildcard to re-enable writes under
 * a stale disabled exact policy does not silently resurrect them — fail closed and deterministic.
 */
export function findGoverningPolicy(
  policies: readonly WritePolicy[],
  scope: WriteRequestScope,
): WritePolicy | null {
  const matchesScope = (policy: WritePolicy): boolean =>
    policy.workspaceId === scope.workspaceId &&
    policy.tenantId === scope.tenantId &&
    policy.provider === scope.provider &&
    policy.connectionId === scope.connectionId &&
    (policy.artifactType === '*' || policy.artifactType === scope.artifactType);

  // Exact artifact-type match always governs over a wildcard (most specific wins, any order).
  const exact = policies.find((p) => matchesScope(p) && p.artifactType === scope.artifactType);
  if (exact) {
    return exact;
  }
  // First-match-wins within the wildcard class, only when no exact policy exists.
  return policies.find((p) => matchesScope(p) && p.artifactType === '*') ?? null;
}

/**
 * Destination allowance for a request: `allowed` only for an explicitly approved destination
 * whose record ALSO exists, is `enabled`, and serves the request scope exactly (THE-948 r1 F1);
 * `denied` for a destination outside the approved set or whose record is missing/disabled/
 * scope-mismatched; `unknown` when there is no approved set or no explicit destination requested
 * (fail closed — the resolver never lets an unknown destination enable a write).
 */
export function resolveDestinationAllowance(
  scope: WriteRequestScope,
  allowedDestinationIds: ReadonlySet<string>,
  destinations: readonly DocumentDestination[],
): DestinationAllowance {
  if (allowedDestinationIds.size === 0) {
    // No approved destination => unknown, never an implicit allowance.
    return 'unknown';
  }
  if (scope.destinationId == null) {
    // No explicit destination chosen; do not guess an arbitrary location (fail closed).
    return 'unknown';
  }
  if (!allowedDestinationIds.has(scope.destinationId)) {
    return 'denied';
  }
  // The approved ID must also resolve to an enabled destination record serving this exact
  // scope; otherwise disabling the record (or a scope mismatch) never blocks creation.
  const serving = destinationsServingScope(destinations, scope);
  if (!serving.some((d) => d.id === scope.destinationId)) {
    return 'denied';
  }
  return 'allowed';
}

/** A fully resolved create decision for one request. */
export interface CreateDecision {
  policyFound: boolean;
  writeMode: WriteMode;
  destination: DestinationAllowance;
  /** Whether the specific create is authorized: requires a create-capable mode AND an approved destination. */
  policy: PolicyAllowance;
  defaultDestinationId: string | null;
}

/**
 * Resolve whether a create into `scope.destinationId` is authorized.
 *
 * Throws `MissingDestinationPolicyError` (a TYPED configuration error) when no governing policy
 * exists — a missing policy NEVER silently allows creation (acceptance 3). Throws
 * `UnapprovedDestinationError` (a TYPED configuration error) when the caller demands a specific
 * explicit destination that is NOT approvable — either absent from the policy's approved set, or
 * whose destination record is missing/`enabled:false`/serves a different scope (THE-948 r1 F1,
 * acceptances 1 and the destination-record integration). Otherwise the create is authorized ONLY
 * when the effective write mode permits creation (`create_only` / `create_and_update`) AND the
 * requested destination is approved with an enabled, scope-serving record; a disabled/read-only
 * connection yields `policy: 'denied'` (acceptance 2).
 */
export function resolveCreateAllowance(
  policies: readonly WritePolicy[],
  destinations: readonly DocumentDestination[],
  scope: WriteRequestScope,
): CreateDecision {
  const policy = findGoverningPolicy(policies, scope);
  if (!policy) {
    throw new MissingDestinationPolicyError(scope);
  }
  if (scope.destinationId != null) {
    // A caller that demands a specific destination is hard-failed unless it is approvable:
    // approved by the policy set AND backed by an enabled, scope-serving destination record.
    const dest = resolveDestinationAllowance(scope, policy.allowedDestinationIds, destinations);
    if (dest !== 'allowed') {
      throw new UnapprovedDestinationError(scope.workspaceId, scope.destinationId);
    }
    const mode = resolvedWriteMode(policy);
    const createModePermits = mode === 'create_only' || mode === 'create_and_update';
    return {
      policyFound: true,
      writeMode: mode,
      destination: 'allowed',
      policy: createModePermits ? 'allowed' : 'denied',
      defaultDestinationId: defaultDestinationId(policy),
    };
  }
  // No explicit destination chosen: fail closed (never guess a location). The policy/mode still
  // resolve so the caller sees the effective write mode, but the create allowance is denied.
  const mode = resolvedWriteMode(policy);
  return {
    policyFound: true,
    writeMode: mode,
    destination: 'unknown',
    policy: 'denied',
    defaultDestinationId: defaultDestinationId(policy),
  };
}

/** A resolved mutation/update authorization for one request. */
export interface MutationDecision {
  policyFound: boolean;
  writeMode: WriteMode;
  policy: PolicyAllowance;
}

/**
 * Resolve whether an update/mutation against an existing artifact is authorized.
 *
 * Only `create_and_update` authorizes mutations. `disabled` and `create_only` deny them.
 * Throws `MissingDestinationPolicyError` when no governing policy exists.
 */
export function resolveMutationAllowance(
  policies: readonly WritePolicy[],
  scope: WriteRequestScope,
): MutationDecision {
  const policy = findGoverningPolicy(policies, scope);
  if (!policy) {
    throw new MissingDestinationPolicyError(scope);
  }
  const mode = resolvedWriteMode(policy);
  return {
    policyFound: true,
    writeMode: mode,
    policy: mode === 'create_and_update' ? 'allowed' : 'denied',
  };
}

/**
 * Whether a write operation requires explicit human confirmation.
 *
 * R-003 logical model supports an optional confirmation policy. The exact default (OQ-003) is
 * open downstream; here `null`/`auto_approve`/`not_required` mean no confirmation is demanded
 * and only `required` gates the operation on human confirmation (wired in T-008).
 */
export function requiresConfirmation(policy: WritePolicy, _operation: WriteOperation): boolean {
  return policy.confirmationPolicy === 'required';
}

/** Typed configuration error: no write destination policy governs the request scope (acceptance 3). */
export class MissingDestinationPolicyError extends Error {
  readonly workspaceId: string;
  readonly tenantId: string | null;
  readonly provider: DocumentProvider;
  readonly artifactType: DocumentArtifactType;
  readonly connectionId: string | null;
  readonly destinationId: string | null;

  constructor(scope: WriteRequestScope) {
    super(
      `MISSING_DESTINATION_POLICY: no write destination policy governs ` +
        `workspace=${scope.workspaceId} tenant=${scope.tenantId} provider=${scope.provider} ` +
        `artifactType=${scope.artifactType} connection=${scope.connectionId} ` +
        `destination=${scope.destinationId ?? '(none)'}; creation blocked (fail closed).`,
    );
    this.name = 'MissingDestinationPolicyError';
    this.workspaceId = scope.workspaceId;
    this.tenantId = scope.tenantId;
    this.provider = scope.provider;
    this.artifactType = scope.artifactType;
    this.connectionId = scope.connectionId;
    this.destinationId = scope.destinationId;
  }
}

/** Typed error: the request named a specific destination the workspace is not approved to write into. */
export class UnapprovedDestinationError extends Error {
  readonly workspaceId: string;
  readonly destinationId: string;

  constructor(workspaceId: string, destinationId: string) {
    super(
      `UNAPPROVED_DESTINATION: workspace ${workspaceId} is not authorized to write into ` +
        `destination ${destinationId}; blocked (fail closed).`,
    );
    this.name = 'UnapprovedDestinationError';
    this.workspaceId = workspaceId;
    this.destinationId = destinationId;
  }
}
