/**
 * THE-960 (T-019) — Microsoft Entra connection and tenant binding.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md
 *   - R-010 "Microsoft tenant-aware authentication": tenant binding without raw
 *     credentials; cross-tenant rejection; revoked → degraded/reauthorization;
 *     admin-consent-required visible and actionable.
 *   - R-032 "Least privilege and revocation": revocation must prevent future writes,
 *     preserve Entity metadata, update readiness, and avoid silently deleting business
 *     records; read-only configurations require no write authorization.
 *   - T-019 scope: auth, admin consent state, tenant validation, secret references.
 *
 * Determinism / security posture (mirrors the Google lane conventions):
 *   - IDENTITY TRANSPORT IS INJECTED. No network I/O, no credentials, no tenant data,
 *     no operator paths anywhere in this module. No default transport — constructing
 *     without one is a compile-time impossibility. Tests use recorded fakes.
 *   - NO RAW SECRETS: the connection record stores opaque secret REFERENCES only
 *     (handles minted by the injected secret store). Tokens/client secrets never enter
 *     this module; typed errors carry hex code points and lengths, never raw values.
 *   - TENANT BINDING IS EXACTLY ONE TENANT per record. Every artifact operation presents
 *     its observed tenant/issuer claims (via the injected transport at callback time and
 *     via caller-attested observed claims at operation-gate time); any mismatch with the
 *     binding is a typed fail-closed TenantMismatchError that degrades the connection —
 *     it is never silently coerced to the binding.
 *   - CSRF/STATE VALIDATION: authorization callbacks validate the state parameter issued
 *     by beginAuthorization against a single-use pending binding; mismatch and replay are
 *     both typed rejections. Route mounting is a later wiring lane — this module exposes
 *     only module-level functions.
 *   - CAPABILITY HONESTY / FAIL CLOSED: unauthorized / degraded / admin-consent-pending /
 *     revoked states never lift a write lane (writeLaneLifted() is false for all of them).
 *     Scope sets are DATA (name + read/write kind + granted flag) supplied by the caller;
 *     this module invents no scope names, GUIDs, or endpoint URLs. Exact Microsoft scope
 *     identifiers and endpoint forms remain injectable configuration whose SEMANTICS are
 *     documented in EVIDENCE against current Microsoft Learn documentation.
 *
 * Microsoft identity semantics implemented here (doc citations live in T-019 EVIDENCE):
 *   - OAuth 2.0 authorization-code flow with PKCE and an anti-CSRF `state` parameter that
 *     must be validated on callback and bound to a single authorization transaction
 *     ("OAuth 2.0 authorization code flow", Microsoft identity platform docs).
 *   - Admin consent: delegated permissions can require administrator consent before any
 *     user grant is effective; that state must be surfaced distinctly and retried through
 *     a new authorization transaction ("Admin consent workflow", "Application consent
 *     experience", Microsoft Entra ID docs).
 *   - Multi-tenant token validation: tokens carry tenant identifiers (`tid`) and an issuer;
 *     validating that these match the expected (bound) tenant is required best practice
 *     ("Validate tokens", Microsoft identity platform docs).
 */

import type {
  DocumentAuthState,
  DocumentProvider,
  DocumentReadinessState,
} from '../../../../db/src/document-integrations';

/* =============================================================================
 * Typed errors — hex code points / lengths only, never raw secret or tenant values.
 * ============================================================================= */

/** First code point where an observed tenant string diverges from the binding, as hex. */
function firstDivergentCodePointHex(bound: string, observed: string): string | null {
  const len = Math.min(bound.length, observed.length);
  for (let i = 0; i < len; i += 1) {
    if (bound[i] !== observed[i]) {
      return `U+${observed.codePointAt(i)!.toString(16).toUpperCase().padStart(4, '0')}`;
    }
  }
  if (bound.length !== observed.length) {
    const longer = bound.length > observed.length ? bound : observed;
    return `U+${longer.codePointAt(len)!.toString(16).toUpperCase().padStart(4, '0')}`;
  }
  return null;
}

/** R-010.2: observed tenant/issuer claims do not match the bound tenant. Fail closed. */
export class TenantMismatchError extends Error {
  readonly firstDivergentCodePointHex: string | null;
  readonly boundTenantLength: number;
  readonly observedTenantLength: number;
  constructor(boundTenantId: string, observedTenantId: string) {
    super(
      `TENANT_MISMATCH: observed tenant claims do not match the bound tenant ` +
        `(boundLength=${boundTenantId.length}, observedLength=${observedTenantId.length}` +
        `${firstDivergentCodePointHex(boundTenantId, observedTenantId) ? `, divergence=${firstDivergentCodePointHex(boundTenantId, observedTenantId)}` : ''}); failing closed`,
    );
    this.name = 'TenantMismatchError';
    this.firstDivergentCodePointHex = firstDivergentCodePointHex(boundTenantId, observedTenantId);
    this.boundTenantLength = boundTenantId.length;
    this.observedTenantLength = observedTenantId.length;
  }
}

/** R-010 callback hardening: state parameter missing, mismatched, or replayed. */
export class CsrfStateMismatchError extends Error {
  readonly reasonCode: 'missing' | 'mismatch' | 'replay';
  constructor(reasonCode: 'missing' | 'mismatch' | 'replay') {
    super(`CSRF_STATE_MISMATCH: authorization state parameter failed validation (${reasonCode})`);
    this.name = 'CsrfStateMismatchError';
    this.reasonCode = reasonCode;
  }
}

/** R-010.4: provider requires administrator consent before the grant becomes effective. */
export class AdminConsentRequiredError extends Error {
  constructor() {
    super('ADMIN_CONSENT_REQUIRED: this connection requires administrator consent before use');
    this.name = 'AdminConsentRequiredError';
  }
}

/** R-032: revocation prevents every future artifact operation until reauthorization. */
export class RevokedConnectionError extends Error {
  constructor() {
    super('CONNECTION_REVOKED: authorization was revoked; operations are rejected until reauthorization');
    this.name = 'RevokedConnectionError';
  }
}

/** R-032 least privilege: the requested lane's scope kind was not granted. */
export class InsufficientScopeError extends Error {
  readonly requestedKind: 'read' | 'write';
  constructor(requestedKind: 'read' | 'write') {
    super(
      `INSUFFICIENT_SCOPE: the connection has not granted a ${requestedKind} scope for this operation`,
    );
    this.name = 'InsufficientScopeError';
    this.requestedKind = requestedKind;
  }
}

/** The record references a handle the injected secret store cannot resolve. */
export class SecretReferenceUnresolvableError extends Error {
  readonly referenceKind: keyof MicrosoftSecretReferences;
  readonly handleLength: number;
  constructor(referenceKind: keyof MicrosoftSecretReferences, handleLength: number) {
    super(
      `SECRET_REFERENCE_UNRESOLVABLE: the injected secret store cannot resolve the ` +
        `${referenceKind} reference (handleLength=${handleLength})`,
    );
    this.name = 'SecretReferenceUnresolvableError';
    this.referenceKind = referenceKind;
    this.handleLength = handleLength;
  }
}

/** A required field of the connection record was empty. */
export class InvalidConnectionRecordError extends Error {
  readonly field: string;
  constructor(field: string) {
    super(`INVALID_CONNECTION_RECORD: field "${field}" must be a non-empty string`);
    this.name = 'InvalidConnectionRecordError';
    this.field = field;
  }
}

/* =============================================================================
 * Data contracts (no invented defaults; all provider-specific values are caller data).
 * ============================================================================= */

/**
 * Tenant binding: exactly one tenant per connection. `issuerForm` is the full expected
 * issuer string form (e.g. `<authority-root>/<tenant-id>/<version-segment>`); both fields
 * are caller-supplied configuration so exact endpoint shapes stay injectable.
 */
export interface MicrosoftTenantBinding {
  tenantId: string;
  issuerForm: string;
}

/** Opaque handles minted by the injected secret store. NEVER raw credential material. */
export interface MicrosoftSecretReferences {
  tokenRef: string;
  clientSecretRef: string;
}

/** One scope entry in the connection's consent/scope set (data contract, R-032). */
export interface MicrosoftScopeEntry {
  /** Provider-specific scope identifier — injectable configuration, never invented here. */
  name: string;
  kind: 'read' | 'write';
  granted: boolean;
}

/** Consent lifecycle distinct from the neutral DocumentAuthState. */
export type MicrosoftConsentState =
  | 'not_required'
  | 'user_consented'
  | 'admin_consent_required'
  | 'unknown';

/** Durable connection record (R-010.1): binding + state + secret REFERENCES, no secrets. */
export interface MicrosoftConnectionRecord {
  connectionId: string;
  provider: DocumentProvider;
  tenantBinding: MicrosoftTenantBinding;
  secretReferences: MicrosoftSecretReferences;
  scopes: readonly MicrosoftScopeEntry[];
  authState: DocumentAuthState;
  readinessState: DocumentReadinessState;
  consentState: MicrosoftConsentState;
  /**
   * Entity metadata preserved across revocation/disconnect per R-032 retention policy.
   * This module NEVER deletes or mutates it on revoke().
   */
  entityMetadataJson: string;
}

/** Read-only view exposed by snapshot(). */
export interface MicrosoftConnectionSnapshot extends MicrosoftConnectionRecord {
  revoked: boolean;
  requiresAdminConsent: boolean;
  lastCsrfFailure?: 'missing' | 'mismatch' | 'replay';
}

/** Diagnostic capture of calls made against the injected transport (test evidence). */
export interface CapturedIdentityCall {
  kind: 'beginAuthorization' | 'redeemAuthorizationCode';
  connectionId?: string;
  stateParameter?: string;
}

/* =============================================================================
 * Injected dependencies (the ONLY I/O boundaries; no defaults exist).
 * ============================================================================= */

/**
 * Identity/transport boundary. Real implementations wrap the Microsoft identity platform
 * endpoints; tests inject deterministic recorded fakes. State-parameter generation is
 * owned by the transport (so randomness stays out of this module); the module validates
 * the returned value against what it dispatched.
 */
export interface MicrosoftIdentityTransport {
  /**
   * Start one authorization transaction (authorization-code + PKCE + state). Returns the
   * state parameter the provider will echo back on the redirect.
   */
  beginAuthorization(input: { connectionId: string }): { stateParameter: string };
  /**
   * Redeem the authorization code for the given state. Returns the OBSERVED tenant claims
   * from the redeemed token plus the consent outcome — the module then enforces the
   * tenant binding itself (fail-closed; the transport's claim of a matching tenant is
   * never trusted as authorization).
   */
  redeemAuthorizationCode(input: { stateParameter: string }): {
    observedTenantId: string;
    observedIssuer: string;
    outcome: 'consented' | 'admin_consent_required' | 'revoked' | 'error';
  };
}

/** Secret store boundary. Handles only — raw credential values never cross this seam. */
export interface MicrosoftSecretStore {
  put(): string;
  exists(handle: string): boolean;
  revoke(handle: string): void;
}

export interface MicrosoftEntraConnectionOptions {
  transport: MicrosoftIdentityTransport;
  secretStore: MicrosoftSecretStore;
  record: MicrosoftConnectionRecord;
}

interface PendingAuthorization {
  stateParameter: string;
  consumed: boolean;
}

/* =============================================================================
 * Connection state machine.
 * ============================================================================= */

const NON_EMPTY = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

export class MicrosoftEntraConnection {
  private readonly transport: MicrosoftIdentityTransport;
  private readonly secretStore: MicrosoftSecretStore;
  private readonly connectionId: string;
  private readonly tenantBinding: MicrosoftTenantBinding;
  private readonly secretReferences: MicrosoftSecretReferences;
  private readonly entityMetadataJson: string;

  private scopes: readonly MicrosoftScopeEntry[];
  private authState: DocumentAuthState;
  private readinessState: DocumentReadinessState;
  private consentState: MicrosoftConsentState;
  private revoked = false;
  private lastCsrfFailure: 'missing' | 'mismatch' | 'replay' | undefined;
  private pending: PendingAuthorization | null = null;

  constructor(options: MicrosoftEntraConnectionOptions) {
    this.transport = options.transport;
    this.secretStore = options.secretStore;
    const record = options.record;

    // Fail-closed record validation: a connection cannot exist without a concrete tenant
    // binding and resolvable secret REFERENCES (never the underlying values).
    if (!NON_EMPTY(record.connectionId)) throw new InvalidConnectionRecordError('connectionId');
    if (!NON_EMPTY(record.tenantBinding?.tenantId)) {
      throw new InvalidConnectionRecordError('tenantBinding.tenantId');
    }
    if (!NON_EMPTY(record.tenantBinding?.issuerForm)) {
      throw new InvalidConnectionRecordError('tenantBinding.issuerForm');
    }
    if (!NON_EMPTY(record.secretReferences?.tokenRef)) {
      throw new InvalidConnectionRecordError('secretReferences.tokenRef');
    }
    if (!NON_EMPTY(record.secretReferences?.clientSecretRef)) {
      throw new InvalidConnectionRecordError('secretReferences.clientSecretRef');
    }
    if (!NON_EMPTY(record.entityMetadataJson)) {
      throw new InvalidConnectionRecordError('entityMetadataJson');
    }

    this.connectionId = record.connectionId;
    this.tenantBinding = { ...record.tenantBinding };
    this.secretReferences = { ...record.secretReferences };
    this.entityMetadataJson = record.entityMetadataJson;
    this.scopes = [...record.scopes];
    this.authState = record.authState;
    this.readinessState = record.readinessState;
    this.consentState = record.consentState;

    // Secret-reference honesty: both handles must resolve in the injected store BEFORE the
    // connection is usable; otherwise construction fails closed.
    if (!this.secretStore.exists(this.secretReferences.tokenRef)) {
      throw new SecretReferenceUnresolvableError(
        'tokenRef',
        this.secretReferences.tokenRef.length,
      );
    }
    if (!this.secretStore.exists(this.secretReferences.clientSecretRef)) {
      throw new SecretReferenceUnresolvableError(
        'clientSecretRef',
        this.secretReferences.clientSecretRef.length,
      );
    }
  }

  /* ------------------------------ reads ---------------------------------- */

  snapshot(): MicrosoftConnectionSnapshot {
    return {
      connectionId: this.connectionId,
      provider: 'microsoft_365',
      tenantBinding: { ...this.tenantBinding },
      secretReferences: { ...this.secretReferences },
      scopes: [...this.scopes],
      authState: this.authState,
      readinessState: this.readinessState,
      consentState: this.consentState,
      entityMetadataJson: this.entityMetadataJson,
      revoked: this.revoked,
      requiresAdminConsent: this.consentState === 'admin_consent_required',
      ...(this.lastCsrfFailure ? { lastCsrfFailure: this.lastCsrfFailure } : {}),
    };
  }

  /**
   * Capability honesty (R-002/D-003 fold convention): the write lane is lifted ONLY when
   * the connection is authorized, not revoked, not degraded, not admin-consent-pending,
   * AND a write scope is actually granted. Every other state returns false — degraded,
   * unknown, and consent-pending states never lift a write.
   */
  writeLaneLifted(): boolean {
    if (this.revoked || this.authState !== 'authorized') return false;
    if (this.consentState === 'admin_consent_required' || this.consentState === 'not_required') {
      return false;
    }
    return this.scopes.some((s) => s.kind === 'write' && s.granted);
  }

  /* -------------------- authorization transactions ----------------------- */

  /** Begin one authorization transaction; the returned state binds the callback. */
  beginAuthorization(): { stateParameter: string } {
    if (this.pending && !this.pending.consumed) {
      // Supersede an outstanding transaction (single outstanding binding).
      this.pending = null;
    }
    const { stateParameter } = this.transport.beginAuthorization({
      connectionId: this.connectionId,
    });
    if (!NON_EMPTY(stateParameter)) {
      throw new CsrfStateMismatchError('missing');
    }
    this.pending = { stateParameter, consumed: false };
    return { stateParameter };
  }

  /**
   * Complete an authorization callback: CSRF-validate the echoed state (single use), let
   * the injected transport redeem the code, then enforce the tenant binding on the
   * observed claims BEFORE any transition to authorized.
   */
  completeAuthorization(input: { stateParameter: string; code: string }): void {
    // CSRF/state validation — missing, mismatched, or replayed states all reject.
    if (!input || !NON_EMPTY(input.stateParameter) || !this.pending) {
      this.lastCsrfFailure = input?.stateParameter ? 'replay' : 'missing';
      throw new CsrfStateMismatchError(this.lastCsrfFailure);
    }
    if (input.stateParameter !== this.pending.stateParameter) {
      this.lastCsrfFailure = 'mismatch';
      throw new CsrfStateMismatchError('mismatch');
    }
    if (this.pending.consumed) {
      this.lastCsrfFailure = 'replay';
      throw new CsrfStateMismatchError('replay');
    }
    this.pending.consumed = true;

    const redemption = this.transport.redeemAuthorizationCode({
      stateParameter: input.stateParameter,
    });

    // Tenant binding enforcement (R-010.2): the observed tenant claims from the redeemed
    // token MUST match the binding; anything else fails closed and degrades.
    if (
      redemption.observedTenantId !== this.tenantBinding.tenantId ||
      redemption.observedIssuer !== this.tenantBinding.issuerForm
    ) {
      this.authState = 'degraded';
      this.readinessState = 'degraded';
      throw new TenantMismatchError(
        this.tenantBinding.tenantId,
        redemption.observedIssuer === this.tenantBinding.issuerForm
          ? redemption.observedTenantId
          : redemption.observedIssuer,
      );
    }

    switch (redemption.outcome) {
      case 'consented':
        this.authState = 'authorized';
        this.readinessState = 'ready';
        this.consentState = 'user_consented';
        break;
      case 'admin_consent_required':
        // R-010.4: distinct, visible, actionable state; reauthorization remains available.
        this.consentState = 'admin_consent_required';
        this.authState = 'unauthorized';
        this.readinessState = 'degraded';
        throw new AdminConsentRequiredError();
      case 'revoked':
        this.applyRevocation();
        break;
      case 'error':
      default:
        this.authState = 'degraded';
        this.readinessState = 'error';
        break;
    }
  }

  /* ------------------------- operation gating ---------------------------- */

  /**
   * Gate any artifact operation (R-010.2 / R-032). Callers present the OBSERVED tenant
   * claims for the operation (from the token presented with it); mismatching tenants are
   * rejected and degrade the connection. Revoked connections reject everything until
   * reauthorization. Reads need only a granted read scope; writes additionally require
   * an authorized, non-revoked connection with a granted write scope (R-032 least
   * privilege: read-only configurations never require write authorization).
   */
  assertArtifactOperationAllowed(input: {
    operation: 'read' | 'write';
    observedTenantId: string;
    observedIssuer: string;
  }): void {
    if (this.revoked) throw new RevokedConnectionError();

    if (
      input.observedTenantId !== this.tenantBinding.tenantId ||
      input.observedIssuer !== this.tenantBinding.issuerForm
    ) {
      // Cross-tenant attempt degrades the connection (fail-closed, never coerced).
      this.authState = 'degraded';
      this.readinessState = 'degraded';
      throw new TenantMismatchError(
        this.tenantBinding.tenantId,
        input.observedIssuer === this.tenantBinding.issuerForm
          ? input.observedTenantId
          : input.observedIssuer,
      );
    }

    const scopeGranted = this.scopes.some((s) => s.kind === input.operation && s.granted);
    if (!scopeGranted) throw new InsufficientScopeError(input.operation);

    if (input.operation === 'read') {
      // Reads act on the neutral auth state but still fail closed unless authorized.
      if (this.authState !== 'authorized') {
        this.lastCsrfFailure = undefined;
        throw new RevokedConnectionError();
      }
      return;
    }

    // Writes additionally require the full authorized posture (capability honesty).
    if (!this.writeLaneLifted()) {
      if (this.consentState === 'admin_consent_required') throw new AdminConsentRequiredError();
      throw new InsufficientScopeError('write');
    }
  }

  /* --------------------------- revocation -------------------------------- */

  /**
   * R-032 disconnect/revocation: prevent future writes (and reads), preserve Entity
   * metadata verbatim, update readiness to degraded. Never deletes business records.
   */
  revoke(): void {
    this.applyRevocation();
    // Rotate the secret REFERENCES in the injected store so previously issued material
    // stops resolving (references only — raw credentials never appear here).
    this.secretStore.revoke(this.secretReferences.tokenRef);
    this.secretStore.revoke(this.secretReferences.clientSecretRef);
  }

  private applyRevocation(): void {
    this.revoked = true;
    this.authState = 'unauthorized';
    this.readinessState = 'degraded';
    this.pending = null;
    // Entity metadata (entityMetadataJson) intentionally untouched — retention policy.
  }
}
