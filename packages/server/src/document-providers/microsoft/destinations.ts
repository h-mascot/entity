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
 *     consent-unknown / write-scope-ungranted connection states NEVER resolve or lift
 *     any destination capability — on CREATION and on REDISCOVERY alike (reuse of the
 *     connection module's typed errors, plus this module's consent-unknown error).
 *   - NO RAW SECRETS: opaque identifiers only; typed errors carry reason codes and
 *     lengths, never raw values.
 *
 * Persistence boundary: this module adds NO db table, NO migration, NO route, NO receipt
 * store, NO provider registry, NO event table. The retained record is a pure serializable
 * shape for later lanes to persist.
 */

import type { DocumentArtifactType, DocumentAuthState } from '../../../../db/src/document-integrations';
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
      `DESTINATION_POLICY_MISSING: workspaceLength=${workspaceId.length} has no configured ` +
        `permitted Microsoft destinations; creation blocked (fail closed)`,
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
        `destinationLength=${destinationId.length}; blocked (fail closed)`,
    );
    this.name = 'DestinationUnresolvableError';
    this.destinationId = destinationId;
  }
}

/**
 * F6: consent state unresolved (unknown) with an otherwise-authorized connection. Distinct
 * from DegradedConnectionError so the thrown error is truthful about WHY resolution is
 * blocked — the message carries the consent state, never a misleading
 * "CONNECTION_NOT_AUTHORIZED (authState=authorized)".
 */
export class DestinationConsentUnknownError extends Error {
  readonly authState: DocumentAuthState;
  constructor(authState: DocumentAuthState) {
    super(
      `DESTINATION_CONSENT_UNKNOWN: consent state is unresolved (consentState=unknown, ` +
        `authState=${authState}); destination resolution blocked (fail closed)`,
    );
    this.name = 'DestinationConsentUnknownError';
    this.authState = authState;
  }
}

/**
 * F2: the transport's OBSERVED identity (or echoed requestedDestinationId) diverges from
 * the permitted/retained identity this seam asked it to resolve. The transport is untrusted;
 * a redirect-following or buggy resolver must never relocate the allowed destination.
 */
export class ObservedIdentityMismatchError extends Error {
  readonly field: string;
  constructor(field: string) {
    super(
      `OBSERVED_IDENTITY_MISMATCH: observed "${field}" diverges from the permitted ` +
        `destination identity; blocked (fail closed)`,
    );
    this.name = 'ObservedIdentityMismatchError';
    this.field = field;
  }
}

/**
 * F3: two caller-presented authority sources disagree (policy.connectionId vs the
 * connection snapshot, or the tenant binding vs the connection's own binding). A
 * mis-wired caller must never gate on connection A and receive a result attributed to B.
 */
export class DestinationAuthorityMismatchError extends Error {
  readonly axis:
    | 'policy_connection_vs_connection'
    | 'record_connection_vs_connection'
    | 'binding_vs_connection';
  constructor(
    axis:
      | 'policy_connection_vs_connection'
      | 'record_connection_vs_connection'
      | 'binding_vs_connection',
  ) {
    super(
      `DESTINATION_AUTHORITY_MISMATCH: authority sources disagree (${axis}); ` +
        `blocked (fail closed)`,
    );
    this.name = 'DestinationAuthorityMismatchError';
    this.axis = axis;
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

/**
 * F2: the transport's observed identity must match the identity this seam asked it to
 * resolve, on every REQUIRED field for the kind (plus kind itself, plus driveId for a
 * SharePoint library when one was configured, plus ownerUserId whenever one is expected).
 * The transport is untrusted; drift rejects BEFORE any retention so a wrong identity never
 * becomes the durable rediscovery key, and every axis persisted by retainDestinationRecord
 * is verified here (r3 Finding 2, option a).
 */
function assertObservedIdentityMatches(
  expected: MicrosoftDestinationIdentity,
  observed: MicrosoftDestinationIdentity,
): void {
  if (expected.kind !== observed.kind) throw new ObservedIdentityMismatchError('identity.kind');
  if (expected.ownerUserId !== observed.ownerUserId) {
    throw new ObservedIdentityMismatchError('identity.ownerUserId');
  }
  if (expected.siteId !== observed.siteId) {
    throw new ObservedIdentityMismatchError('identity.siteId');
  }
  if (expected.libraryId !== observed.libraryId) {
    throw new ObservedIdentityMismatchError('identity.libraryId');
  }
  if (expected.driveId !== observed.driveId) {
    throw new ObservedIdentityMismatchError('identity.driveId');
  }
}

/** F2: the transport's echoed requestedDestinationId must match what was requested. */
function assertEchoedDestinationIdMatches(requested: string, echoed: string): void {
  if (requested !== echoed) throw new ObservedIdentityMismatchError('requestedDestinationId');
}

/** F3: the caller-presented authority sources must agree before anything resolves. */
function assertAuthoritiesAgree(input: {
  policy: MicrosoftWorkspaceDestinationPolicy;
  connection: MicrosoftConnectionSnapshot;
  tenantBinding: MicrosoftTenantBinding;
}): void {
  if (input.policy.connectionId !== input.connection.connectionId) {
    throw new DestinationAuthorityMismatchError('policy_connection_vs_connection');
  }
  const connBinding = input.connection.tenantBinding;
  if (
    input.tenantBinding.tenantId !== connBinding.tenantId ||
    input.tenantBinding.issuerForm !== connBinding.issuerForm
  ) {
    throw new DestinationAuthorityMismatchError('binding_vs_connection');
  }
}

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
  // F6: an authorized connection with unresolved consent is NOT "not authorized" — throw
  // the truthful consent-specific error instead of a misleading DegradedConnectionError.
  if (connection.consentState === 'unknown') {
    throw new DestinationConsentUnknownError(connection.authState);
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
 *      against the same binding (cross-tenant observation => TenantMismatchError), the
 *      OBSERVED IDENTITY enforced against the permitted entry's identity per required
 *      fields, and the echoed requestedDestinationId verified (any drift => typed
 *      rejection BEFORE retention); unresolvable => DestinationUnresolvableError.
 *
 * F3: the three caller-presented authority sources (policy, connection, tenantBinding)
 * are cross-checked at entry — a mis-wired caller is rejected, never served a result
 * attributed to a different connection.
 * F7: an optional `requestedDestinationId` narrows the enabled candidate set to one
 * explicitly chosen ALLOWED destination; an id outside the permitted set fails closed.
 */
export function resolveCreationDestination(input: {
  transport: MicrosoftDestinationTransport;
  policy: MicrosoftWorkspaceDestinationPolicy;
  connection: MicrosoftConnectionSnapshot;
  artifactType: DocumentArtifactType;
  /** The caller-presented connection tenant binding (T-019 conventions). */
  tenantBinding: MicrosoftTenantBinding;
  /** F7: optional explicit choice among the ALLOWED destinations; never bypasses policy. */
  requestedDestinationId?: string;
}): ResolvedMicrosoftDestination {
  assertConnectionMayResolveDestinations(input.connection);
  assertAuthoritiesAgree(input);

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
  // F7: an explicit choice narrows the ALREADY-PERMITTED candidate set — it can only
  // select, never widen. An id outside the permitted set fails closed.
  let scoped = candidates;
  if (input.requestedDestinationId !== undefined) {
    scoped = candidates.filter((e) => e.destinationId === input.requestedDestinationId);
    if (scoped.length === 0) {
      throw new DestinationNotPermittedError('policy_scope_mismatch', policy.workspaceId);
    }
  }
  if (scoped.length === 0) {
    // F4: honest diagnostics — distinguish a disabled-only configuration (no enabled
    // candidate exists at all) from scope/type mismatches among enabled entries.
    const anyEnabled = policy.permittedDestinations.some(
      (e) => e.enabled && e.connectionId === policy.connectionId,
    );
    const anyTypeServed = policy.permittedDestinations.some((e) =>
      e.artifactTypes.has(input.artifactType),
    );
    throw new DestinationNotPermittedError(
      !anyEnabled ? 'no_enabled_candidate' : anyTypeServed ? 'policy_scope_mismatch' : 'artifact_type_not_served',
      policy.workspaceId,
    );
  }
  if (scoped.length > 1) {
    throw new AmbiguousDestinationError(scoped.length, policy.workspaceId);
  }

  const destination = scoped[0]!;
  const observed = input.transport.resolveDestination({
    requestedDestinationId: destination.destinationId,
    identity: destination.identity,
  });
  if (observed.outcome !== 'resolved') {
    throw new DestinationUnresolvableError(destination.destinationId);
  }
  assertEchoedDestinationIdMatches(destination.destinationId, observed.requestedDestinationId);
  // Observed tenant claims MUST match the binding — never trusted from the transport's
  // own claim of success (same doctrine as connection.completeAuthorization).
  if (
    observed.observedTenantId !== input.tenantBinding.tenantId ||
    observed.observedIssuer !== input.tenantBinding.issuerForm
  ) {
    throw new TenantMismatchError(input.tenantBinding.tenantId, observed.observedTenantId);
  }
  // F2: the observed identity must be the permitted entry's identity — a buggy or
  // redirect-following resolver must never relocate the allowed destination.
  assertObservedIdentityMatches(destination.identity, observed.observedIdentity);
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
 * "retained sufficiently for rediscovery"). F1: rediscovery is gated and bound exactly
 * like creation — the connection posture gate applies (revoked/degraded/unauthorized/
 * consent-pending/write-scope-ungranted connections never rediscover), the tenant
 * binding is MANDATORY (unbound rediscovery fails closed), and the fresh observation's
 * tenant claims, echoed requestedDestinationId, and observed identity are all enforced
 * against the retained record before the observation is returned.
 */
export function rediscoverDestination(input: {
  transport: MicrosoftDestinationTransport;
  record: MicrosoftRetainedDestinationRecord;
  connection: MicrosoftConnectionSnapshot;
  tenantBinding: MicrosoftTenantBinding;
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
  // F1: mandatory authority — unbound rediscovery fails closed at runtime too (the type
  // makes it a compile-time impossibility for TS callers; this guards JS callers).
  if (!input.connection || !input.tenantBinding) {
    throw new InvalidDestinationRecordError('authority');
  }
  // F1: same posture gate as creation — revoked/degraded/consent-pending/unscoped
  // connections never resolve any destination capability, including rediscovery.
  assertConnectionMayResolveDestinations(input.connection);
  // F1 (r3): authority parity with creation — the retained record must belong to THIS
  // connection (re-authorization preserves connectionId, so a divergent id is always
  // mis-wiring), and the caller's binding must agree with the connection's own binding
  // (both tenantId and issuerForm). A mis-wired caller must never re-resolve connection
  // A's destination under connection B's posture.
  if (record.connectionId !== input.connection.connectionId) {
    throw new DestinationAuthorityMismatchError('record_connection_vs_connection');
  }
  // Record-tenant mismatch is the most specific diagnosis — report it before parity axes.
  if (input.tenantBinding.tenantId !== record.tenantId) {
    throw new TenantMismatchError(input.tenantBinding.tenantId, record.tenantId);
  }
  const connBinding = input.connection.tenantBinding;
  if (
    input.tenantBinding.tenantId !== connBinding.tenantId ||
    input.tenantBinding.issuerForm !== connBinding.issuerForm
  ) {
    throw new DestinationAuthorityMismatchError('binding_vs_connection');
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
  assertEchoedDestinationIdMatches(record.destinationId, observed.requestedDestinationId);
  if (
    observed.observedTenantId !== input.tenantBinding.tenantId ||
    observed.observedIssuer !== input.tenantBinding.issuerForm
  ) {
    throw new TenantMismatchError(input.tenantBinding.tenantId, observed.observedTenantId);
  }
  // F2: the fresh observation must match the retained identity on required fields —
  // drift rejects before the observation escapes the seam.
  assertObservedIdentityMatches(
    {
      kind: record.kind,
      driveId: record.driveId,
      ownerUserId: record.ownerUserId,
      siteId: record.siteId,
      libraryId: record.libraryId,
    },
    observed.observedIdentity,
  );
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
