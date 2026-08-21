/**
 * THE-961 (T-020) — Microsoft OneDrive/SharePoint destination discovery and policy.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md
 *   - R-011 "Microsoft OneDrive/SharePoint destination model" (acceptance verbatim):
 *       1. "Creation always identifies an allowed destination."
 *       2. "SharePoint site/library identity is retained sufficiently for rediscovery."
 *       3. "An artifact moved or renamed does not automatically become a new Entity
 *          document if provider identity remains stable."
 *   - T-020 scope: "OneDrive/SharePoint destination identities." Dependencies T-019 (this
 *     module reuses the connection module's tenant-binding conventions and typed errors)
 *     and T-007 (the provider-generic destination/write-policy contracts).
 *
 * Conventions mirrored from the T-019 Microsoft connection module:
 *   - DISCOVERY/RESOLUTION TRANSPORT IS INJECTED (`MicrosoftDestinationTransport`). No
 *     network I/O, no credentials, no tenant data, no operator paths anywhere in this
 *     module; constructing without a transport is a compile-time impossibility. Tests use
 *     hand-rolled fakes with recorded fixture sequences only.
 *   - NO INVENTED PROVIDER IDENTIFIERS: Graph endpoint URL forms, site IDs, drive IDs,
 *     item IDs, and scope GUIDs are represented as OPAQUE injectable strings whose exact
 *     live semantics must be verified against current provider documentation in the
 *     wiring/sandbox lane (T-038/T-039). This module defines only the SHAPE of identity.
 *   - FAIL CLOSED: creation resolves to EXACTLY ONE allowed destination per the injected
 *     workspace policy. Unknown/unresolvable/policy-denied destinations REJECT with typed
 *     errors — never silently coerced, never a fallback default destination.
 *   - TENANT ISOLATION: every destination binds to exactly one tenant via the T-019
 *     binding conventions; an observed tenant that mismatches the binding rejects with
 *     the shared TenantMismatchError and never resolves the destination.
 *   - CAPABILITY HONESTY: revoked / degraded / unauthorized / admin-consent-pending /
 *     write-scope-ungranted connection states NEVER resolve or lift any destination
 *     capability (reuse of the connection module's typed errors).
 *   - NO RAW SECRETS: opaque identifiers only; typed errors carry reason codes and
 *     lengths, never raw values.
 *
 * Persistence boundary: this module adds NO db table, NO migration, NO route, NO receipt
 * store, NO provider registry, NO event table. The retained record is a pure serializable
 * shape for later lanes to persist.
 */

import type { DocumentArtifactType } from '../../../../db/src/document-integrations';
import {
  AdminConsentRequiredError,
  DegradedConnectionError,
  InsufficientScopeError,
  RevokedConnectionError,
  TenantMismatchError,
  type MicrosoftConnectionSnapshot,
  type MicrosoftTenantBinding,
} from './connection';

/* =============================================================================
 * Data contracts (identity shapes only — all values are opaque caller data).
 * ============================================================================= */

/** The two destination kinds R-011 covers (subset of the T-007 DestinationKind vocabulary). */
export type MicrosoftDestinationKind = 'onedrive' | 'sharepoint_library';

/**
 * Opaque provider-side identity of one storage location. Exactly which fields are
 * required depends on `kind`:
 *   - `onedrive`:           `driveId` (+ optional `ownerUserId`); site/library fields null.
 *   - `sharepoint_library`: `siteId` + `libraryId` (+ `driveId` when the library exposes a
 *                           drive identity); owner field null.
 * No field here is a secret; none is invented by this module — every value arrives from
 * injected configuration or the injected transport's observation.
 */
export interface MicrosoftDestinationIdentity {
  kind: MicrosoftDestinationKind;
  /** Opaque drive identity (present for both kinds in practice; null when not exposed). */
  driveId: string | null;
  /** Opaque owning-user identity (OneDrive only). */
  ownerUserId: string | null;
  /** Opaque SharePoint site identity (sharepoint_library only). */
  siteId: string | null;
  /** Opaque SharePoint document-library identity (sharepoint_library only). */
  libraryId: string | null;
}

/** One permitted destination configured into a workspace's injected policy. */
export interface MicrosoftPermittedDestination {
  destinationId: string;
  workspaceId: string;
  /** Exactly one tenant per permitted destination (T-019 binding conventions). */
  tenantId: string;
  connectionId: string;
  artifactTypes: ReadonlySet<DocumentArtifactType>;
  identity: MicrosoftDestinationIdentity;
  displayName: string;
  enabled: boolean;
}

/**
 * Workspace destination policy — an INJECTED DATA CONTRACT (R-003/R-011). No defaults are
 * invented here; a workspace with no configured permitted destinations simply has no
 * resolvable destination and creation fails closed.
 */
export interface MicrosoftWorkspaceDestinationPolicy {
  workspaceId: string;
  tenantId: string;
  connectionId: string;
  permittedDestinations: readonly MicrosoftPermittedDestination[];
}

/** What the injected transport observed when resolving a destination identity. */
export type MicrosoftObservedDestination =
  | {
      requestedDestinationId: string;
      outcome: 'resolved';
      observedIdentity: MicrosoftDestinationIdentity;
      /** Observed tenant claims from the resolution — enforced against the binding here. */
      observedTenantId: string;
      observedIssuer: string;
    }
  | {
      requestedDestinationId: string;
      outcome: 'unresolvable';
      observedTenantId: string;
      observedIssuer: string;
    };

/**
 * Injected discovery/resolution boundary. A real implementation wraps the provider's
 * drive/site APIs; tests inject deterministic recorded fakes. Endpoint URL forms stay out
 * of this module entirely (wiring-lane concern).
 */
export interface MicrosoftDestinationTransport {
  resolveDestination(input: {
    requestedDestinationId: string;
    identity: MicrosoftDestinationIdentity;
  }): MicrosoftObservedDestination;
}

/** The single allowed destination result of a successful creation resolution. */
export interface ResolvedMicrosoftDestination {
  workspaceId: string;
  tenantId: string;
  connectionId: string;
  destination: MicrosoftPermittedDestination;
  observed: Extract<MicrosoftObservedDestination, { outcome: 'resolved' }>;
}

/* =============================================================================
 * Typed errors (reason codes / lengths only — never raw provider or tenant values).
 * ============================================================================= */

/** R-011.1: no usable workspace destination policy is configured. Fail closed. */
export class DestinationPolicyMissingError extends Error {
  readonly workspaceId: string;
  constructor(workspaceId: string) {
    super(
      `DESTINATION_POLICY_MISSING: workspace ${workspaceId} has no configured permitted ` +
        `Microsoft destinations; creation blocked (fail closed)`,
    );
    this.name = 'DestinationPolicyMissingError';
    this.workspaceId = workspaceId;
  }
}

/** R-011.1: no permitted destination serves the request (denied/disabled/type mismatch/scope). */
export class DestinationNotPermittedError extends Error {
  readonly reasonCode:
    | 'policy_scope_mismatch'
    | 'no_enabled_candidate'
    | 'artifact_type_not_served';
  readonly workspaceId: string;
  constructor(
    reasonCode: 'policy_scope_mismatch' | 'no_enabled_candidate' | 'artifact_type_not_served',
    workspaceId: string,
  ) {
    super(
      `DESTINATION_NOT_PERMITTED: no permitted Microsoft destination serves this creation ` +
        `(reason=${reasonCode}, workspaceLength=${workspaceId.length}); blocked (fail closed)`,
    );
    this.name = 'DestinationNotPermittedError';
    this.reasonCode = reasonCode;
    this.workspaceId = workspaceId;
  }
}

/** More than one enabled candidate serves the scope — creation must identify EXACTLY ONE. */
export class AmbiguousDestinationError extends Error {
  readonly candidateCount: number;
  readonly workspaceId: string;
  constructor(candidateCount: number, workspaceId: string) {
    super(
      `AMBIGUOUS_DESTINATION: ${candidateCount} enabled permitted destinations serve this ` +
        `creation in workspaceLength=${workspaceId.length}; creation requires exactly one ` +
        `explicitly identified destination`,
    );
    this.name = 'AmbiguousDestinationError';
    this.candidateCount = candidateCount;
    this.workspaceId = workspaceId;
  }
}

/** The injected transport could not resolve the permitted destination identity. */
export class DestinationUnresolvableError extends Error {
  readonly destinationId: string;
  constructor(destinationId: string) {
    super(
      `DESTINATION_UNRESOLVABLE: the injected transport could not resolve permitted ` +
        `destination ${destinationId}; blocked (fail closed)`,
    );
    this.name = 'DestinationUnresolvableError';
    this.destinationId = destinationId;
  }
}

/** A retained destination record failed structural validation (rediscovery path). */
export class InvalidDestinationRecordError extends Error {
  readonly field: string;
  constructor(field: string) {
    super(`INVALID_DESTINATION_RECORD: field "${field}" failed record validation`);
    this.name = 'InvalidDestinationRecordError';
    this.field = field;
  }
}

const NON_EMPTY = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/* =============================================================================
 * Connection gating (capability honesty — mirrors connection.ts writeLaneLifted).
 * ============================================================================= */

/**
 * Gate destination RESOLUTION on the connection posture (T-019 conventions): revoked,
 * degraded/unauthorized, admin-consent-pending, consent-unknown, or write-scope-ungranted
 * connections never resolve any destination capability. Throws the SHARED typed errors so
 * callers see one error vocabulary across the Microsoft lane.
 */
function assertConnectionMayResolveDestinations(connection: MicrosoftConnectionSnapshot): void {
  if (connection.revoked) throw new RevokedConnectionError();
  if (connection.consentState === 'admin_consent_required') {
    throw new AdminConsentRequiredError();
  }
  if (connection.authState !== 'authorized') {
    throw new DegradedConnectionError(connection.authState);
  }
  if (connection.consentState === 'unknown') {
    throw new DegradedConnectionError(connection.authState);
  }
  const writeGranted = connection.scopes.some((s) => s.kind === 'write' && s.granted);
  if (!writeGranted) throw new InsufficientScopeError('write');
}

/** Structural + binding checks on one permitted destination entry (fail closed). */
function validatePermittedDestination(
  entry: MicrosoftPermittedDestination,
  policy: MicrosoftWorkspaceDestinationPolicy,
  binding: MicrosoftTenantBinding,
): void {
  if (!NON_EMPTY(entry.destinationId)) {
    throw new InvalidDestinationRecordError('destinationId');
  }
  if (entry.workspaceId !== policy.workspaceId || entry.tenantId !== policy.tenantId) {
    throw new DestinationNotPermittedError('policy_scope_mismatch', policy.workspaceId);
  }
  // Every destination binds to exactly one tenant; a policy/binding mismatch can never serve.
  if (entry.tenantId !== binding.tenantId) {
    throw new TenantMismatchError(binding.tenantId, entry.tenantId);
  }
  if (!entry.enabled) return; // filtered later; structurally valid but not servable
  if (entry.identity.kind === 'onedrive') {
    if (!NON_EMPTY(entry.identity.driveId ?? '')) {
      throw new InvalidDestinationRecordError('identity.driveId');
    }
  } else if (
    !NON_EMPTY(entry.identity.siteId ?? '') ||
    !NON_EMPTY(entry.identity.libraryId ?? '')
  ) {
    throw new InvalidDestinationRecordError('identity.siteId/libraryId');
  }
}

/* =============================================================================
 * Creation-time destination resolution (R-011 acceptance 1).
 * ============================================================================= */

/**
 * Resolve THE single allowed destination for a creation in the workspace.
 *
 * Fail-closed order of operations:
 *   1. connection posture gate (never resolves on revoked/degraded/unauthorized/
 *      consent-pending/write-scope-ungranted connections);
 *   2. policy existence gate (no permitted destinations at all => typed config error);
 *   3. per-entry validation incl. exactly-one-tenant binding vs the caller-presented
 *      connection tenant binding (mismatch => TenantMismatchError, fail closed);
 *   4. scope filter: workspace/tenant/connection equality AND artifact type served AND
 *      enabled — zero survivors => typed denial, NEVER a default destination;
 *   5. uniqueness: more than one survivor => AmbiguousDestinationError (creation must
 *      identify an allowed destination, not guess among several);
 *   6. transport resolution of the single survivor with OBSERVED tenant claims enforced
 *      against the same binding (cross-tenant observation => TenantMismatchError);
 *      unresolvable => DestinationUnresolvableError.
 */
export function resolveCreationDestination(input: {
  transport: MicrosoftDestinationTransport;
  policy: MicrosoftWorkspaceDestinationPolicy;
  connection: MicrosoftConnectionSnapshot;
  artifactType: DocumentArtifactType;
  /** The caller-presented connection tenant binding (T-019 conventions). */
  tenantBinding: MicrosoftTenantBinding;
}): ResolvedMicrosoftDestination {
  assertConnectionMayResolveDestinations(input.connection);

  const { policy } = input;
  if (policy.permittedDestinations.length === 0) {
    throw new DestinationPolicyMissingError(policy.workspaceId);
  }

  for (const entry of policy.permittedDestinations) {
    validatePermittedDestination(entry, policy, input.tenantBinding);
  }

  // Scope filter — every axis must match exactly (T-007 isolation conventions).
  const candidates = policy.permittedDestinations.filter(
    (entry) =>
      entry.enabled &&
      entry.connectionId === policy.connectionId &&
      entry.artifactTypes.has(input.artifactType),
  );
  if (candidates.length === 0) {
    // Distinguish "types never served" from "enabled candidates existed but mismatched".
    const anyTypeServed = policy.permittedDestinations.some((e) =>
      e.artifactTypes.has(input.artifactType),
    );
    throw new DestinationNotPermittedError(
      anyTypeServed ? 'policy_scope_mismatch' : 'artifact_type_not_served',
      policy.workspaceId,
    );
  }
  if (candidates.length > 1) {
    throw new AmbiguousDestinationError(candidates.length, policy.workspaceId);
  }

  const destination = candidates[0]!;
  const observed = input.transport.resolveDestination({
    requestedDestinationId: destination.destinationId,
    identity: destination.identity,
  });
  if (observed.outcome !== 'resolved') {
    throw new DestinationUnresolvableError(destination.destinationId);
  }
  // Observed tenant claims MUST match the binding — never trusted from the transport's
  // own claim of success (same doctrine as connection.completeAuthorization).
  if (
    observed.observedTenantId !== input.tenantBinding.tenantId ||
    observed.observedIssuer !== input.tenantBinding.issuerForm
  ) {
    throw new TenantMismatchError(input.tenantBinding.tenantId, observed.observedTenantId);
  }
  return {
    workspaceId: policy.workspaceId,
    tenantId: policy.tenantId,
    connectionId: policy.connectionId,
    destination,
    observed,
  };
}

/* =============================================================================
 * Identity retention & rediscovery (R-011 acceptance 2).
 * ============================================================================= */

/**
 * A durable, serializable record of WHERE an Entity document lives on the provider —
 * retained precisely so a destination can be rediscovered later through the injected
 * seam. Pure data: persisting it is a later lane's concern.
 */
export interface MicrosoftRetainedDestinationRecord {
  destinationId: string;
  workspaceId: string;
  tenantId: string;
  connectionId: string;
  kind: MicrosoftDestinationKind;
  displayName: string;
  // Opaque stable provider identifiers (R-011 acceptance 2):
  driveId: string | null;
  ownerUserId: string | null;
  siteId: string | null;
  libraryId: string | null;
}

/** Retain the resolved destination's identity for later rediscovery. */
export function retainDestinationRecord(
  resolved: ResolvedMicrosoftDestination,
): MicrosoftRetainedDestinationRecord {
  return {
    destinationId: resolved.destination.destinationId,
    workspaceId: resolved.destination.workspaceId,
    tenantId: resolved.destination.tenantId,
    connectionId: resolved.destination.connectionId,
    kind: resolved.destination.identity.kind,
    displayName: resolved.destination.displayName,
    driveId: resolved.observed.observedIdentity.driveId,
    ownerUserId: resolved.observed.observedIdentity.ownerUserId,
    siteId: resolved.observed.observedIdentity.siteId,
    libraryId: resolved.observed.observedIdentity.libraryId,
  };
}

/**
 * Re-resolve a previously retained destination through the SAME injected seam (R-011.2
 * "retained sufficiently for rediscovery"). Validates the retained record structurally
 * (fail closed), then enforces the caller-presented tenant binding against the fresh
 * observation exactly like creation time.
 */
export function rediscoverDestination(input: {
  transport: MicrosoftDestinationTransport;
  record: MicrosoftRetainedDestinationRecord;
  tenantBinding?: MicrosoftTenantBinding;
}): Extract<MicrosoftObservedDestination, { outcome: 'resolved' }> {
  const { record } = input;
  if (!NON_EMPTY(record.destinationId)) {
    throw new InvalidDestinationRecordError('destinationId');
  }
  if (!NON_EMPTY(record.tenantId)) {
    throw new InvalidDestinationRecordError('tenantId');
  }
  if (record.kind === 'onedrive') {
    if (!NON_EMPTY(record.driveId ?? '')) {
      throw new InvalidDestinationRecordError('driveId');
    }
  } else if (!NON_EMPTY(record.siteId ?? '') || !NON_EMPTY(record.libraryId ?? '')) {
    throw new InvalidDestinationRecordError('siteId/libraryId');
  }
  if (input.tenantBinding && input.tenantBinding.tenantId !== record.tenantId) {
    throw new TenantMismatchError(input.tenantBinding.tenantId, record.tenantId);
  }
  const observed = input.transport.resolveDestination({
    requestedDestinationId: record.destinationId,
    identity: {
      kind: record.kind,
      driveId: record.driveId,
      ownerUserId: record.ownerUserId,
      siteId: record.siteId,
      libraryId: record.libraryId,
    },
  });
  if (observed.outcome !== 'resolved') {
    throw new DestinationUnresolvableError(record.destinationId);
  }
  if (input.tenantBinding) {
    if (
      observed.observedTenantId !== input.tenantBinding.tenantId ||
      observed.observedIssuer !== input.tenantBinding.issuerForm
    ) {
      throw new TenantMismatchError(input.tenantBinding.tenantId, observed.observedTenantId);
    }
  }
  return observed;
}

/* =============================================================================
 * Rename/move identity stability (R-011 acceptance 3).
 * ============================================================================= */

/**
 * The provider identity of one stored artifact. In the drive model an item keeps its
 * `itemId` when it is renamed or moved between folders within accessible scope; the id
 * pair below is therefore the stability key — NOT the path or display name (which are
 * deliberately absent from this contract).
 */
export interface MicrosoftArtifactProviderIdentity {
  /** Opaque drive containing the item (stable across rename/move within the drive). */
  driveId: string;
  /** Opaque provider item id — the identity that persists across rename/move. */
  itemId: string;
}

/**
 * Whether two observations describe the SAME Entity document (R-011 acceptance 3): an
 * artifact moved or renamed does NOT become a new Entity document when its provider
 * identity (driveId + itemId) remains stable. Path/name/display changes are invisible to
 * this predicate by construction; a changed itemId or driveId means a genuinely different
 * provider artifact and a new-Entity-document decision belongs to the reconciliation lane.
 */
export function sameEntityDocumentIdentity(
  before: MicrosoftArtifactProviderIdentity,
  after: MicrosoftArtifactProviderIdentity,
): boolean {
  return before.driveId === after.driveId && before.itemId === after.itemId;
}
