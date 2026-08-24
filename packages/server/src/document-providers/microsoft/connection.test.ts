/**
 * T-019 (THE-960) — Microsoft Entra connection and tenant binding — module tests.
 *
 * Deterministic only: hand-rolled fakes with recorded fixture sequences. No network,
 * no credentials, no tenant data (all ids below are synthetic fixture strings).
 * Covers R-010 acceptance 1–4 and R-032 revocation/least-privilege bullets.
 */

import { describe, expect, it } from 'vitest';

import {
  AdminConsentRequiredError,
  AuthorizationRedemptionError,
  CsrfStateMismatchError,
  InsufficientScopeError,
  InvalidConnectionRecordError,
  MicrosoftEntraConnection,
  RevokedConnectionError,
  SecretReferenceUnresolvableError,
  TenantMismatchError,
  type CapturedIdentityCall,
  type MicrosoftIdentityTransport,
  type MicrosoftSecretStore,
} from './connection';

/* =============================================================================
 * Deterministic fakes (recorded fixture sequences; no network, no secrets).
 * ============================================================================= */

const BOUND_TENANT = 'tenant-fixture-a';
const OTHER_TENANT = 'tenant-fixture-b';
const ISSUER_FORM_BOUND = `https://login.example.invalid/${BOUND_TENANT}/v2.0`;
const ISSUER_FORM_OTHER = `https://login.example.invalid/${OTHER_TENANT}/v2.0`;

interface RedeemFixture {
  observedTenantId: string;
  observedIssuer: string;
  outcome: 'consented' | 'admin_consent_required' | 'revoked' | 'error';
}

class FakeSecretStore implements MicrosoftSecretStore {
  readonly handles = new Set<string>();
  revoked: string[] = [];
  put(): string {
    const handle = `secret-ref-${this.handles.size + 1}`;
    this.handles.add(handle);
    return handle;
  }
  exists(handle: string): boolean {
    return this.handles.has(handle);
  }
  revoke(handle: string): void {
    this.revoked.push(handle);
  }
}

interface CapturedRedeemInput {
  stateParameter: string;
  code: string;
  codeVerifier: string;
}

class FakeIdentityTransport implements MicrosoftIdentityTransport {
  readonly calls: CapturedIdentityCall[] = [];
  /** Captured full redeem inputs — proves the seam delivers code (+ PKCE verifier). */
  readonly redeemInputs: CapturedRedeemInput[] = [];
  private pendingStates = new Map<string, string>();
  /** Recorded redeem outcomes consumed in FIFO order. */
  redeemQueue: RedeemFixture[] = [];
  /** When set, beginAuthorization returns this attacker-supplied state instead. */
  tamperedStateOverride: string | null = null;

  beginAuthorization(input: {
    connectionId: string;
  }): { stateParameter: string; codeVerifier: string } {
    this.calls.push({ kind: 'beginAuthorization', connectionId: input.connectionId });
    const state =
      this.tamperedStateOverride ?? `state-${input.connectionId}-${this.calls.length}`;
    const codeVerifier = `verifier-${input.connectionId}-${this.calls.length}`;
    this.pendingStates.set(input.connectionId, state);
    return { stateParameter: state, codeVerifier };
  }

  issuedState(connectionId: string): string | undefined {
    return this.pendingStates.get(connectionId);
  }

  redeemAuthorizationCode(input: CapturedRedeemInput): RedeemFixture {
    this.calls.push({ kind: 'redeemAuthorizationCode', stateParameter: input.stateParameter });
    this.redeemInputs.push({ ...input });
    const next = this.redeemQueue.shift();
    if (!next) throw new Error('fixture queue empty');
    return next;
  }
}

const READ_ONLY_SCOPES = [
  { name: 'fixture.read.scope', kind: 'read' as const, granted: true },
];
const READ_WRITE_SCOPES = [
  { name: 'fixture.read.scope', kind: 'read' as const, granted: true },
  { name: 'fixture.write.scope', kind: 'write' as const, granted: true },
];

function makeConnection(options?: {
  transport?: FakeIdentityTransport;
  secrets?: FakeSecretStore;
  scopes?: typeof READ_ONLY_SCOPES | typeof READ_WRITE_SCOPES;
}) {
  const transport = options?.transport ?? new FakeIdentityTransport();
  const secrets = options?.secrets ?? new FakeSecretStore();
  const tokenRef = secrets.put();
  const clientSecretRef = secrets.put();
  const connection = new MicrosoftEntraConnection({
    transport,
    secretStore: secrets,
    record: {
      connectionId: 'conn-t019',
      provider: 'microsoft_365',
      tenantBinding: { tenantId: BOUND_TENANT, issuerForm: ISSUER_FORM_BOUND },
      secretReferences: { tokenRef, clientSecretRef },
      scopes: options?.scopes ?? READ_WRITE_SCOPES,
      authState: 'unauthorized',
      readinessState: 'unknown',
      consentState: 'not_required',
      entityMetadataJson: '{"artifact":"fixture-metadata"}',
    },
  });
  return { connection, transport, secrets };
}

describe('T-019 Microsoft Entra connection', () => {
  it('RED R-010.1: connection record carries tenant binding + secret REFERENCES only (no raw credentials)', () => {
    const { connection } = makeConnection();
    const snapshot = connection.snapshot();
    expect(snapshot.tenantBinding).toEqual({
      tenantId: BOUND_TENANT,
      issuerForm: ISSUER_FORM_BOUND,
    });
    // Secret references are opaque handles; the module never exposes raw values.
    expect(snapshot.secretReferences.tokenRef).toMatch(/^secret-ref-/);
    expect(snapshot.secretReferences.clientSecretRef).toMatch(/^secret-ref-/);
    // No raw credential material anywhere in the snapshot (JWTs, bearer values, secrets).
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toMatch(/eyJ/i); // JWT prefix
    expect(serialized).not.toMatch(/"accessToken"|"refreshToken"|"clientSecretValue"|password/i);
  });

  it('RED R-010.1: fails closed when a secret reference is not resolvable in the injected store', () => {
    const secrets = new FakeSecretStore();
    const tokenRef = secrets.put();
    expect(
      () =>
        new MicrosoftEntraConnection({
          transport: new FakeIdentityTransport(),
          secretStore: secrets,
          record: {
            connectionId: 'conn-badref',
            provider: 'microsoft_365',
            tenantBinding: { tenantId: BOUND_TENANT, issuerForm: ISSUER_FORM_BOUND },
            secretReferences: { tokenRef, clientSecretRef: 'secret-ref-missing' },
            scopes: READ_WRITE_SCOPES,
            authState: 'unauthorized',
            readinessState: 'unknown',
            consentState: 'not_required',
            entityMetadataJson: '{}',
          },
        }),
    ).toThrow(SecretReferenceUnresolvableError);
  });

  it('RED R-010.4: admin-consent-required is a distinct visible, actionable state with a reauthorization path', () => {
    const { connection, transport } = makeConnection();
    const begun = connection.beginAuthorization();
    expect(begun.stateParameter).toBe(transport.issuedState('conn-t019'));
    transport.redeemQueue.push({
      observedTenantId: BOUND_TENANT,
      observedIssuer: ISSUER_FORM_BOUND,
      outcome: 'admin_consent_required',
    });

    expect(() =>
      connection.completeAuthorization({
        stateParameter: transport.issuedState('conn-t019')!,
        code: 'code-fixture',
      }),
    ).toThrow(AdminConsentRequiredError);

    const snapshot = connection.snapshot();
    expect(snapshot.consentState).toBe('admin_consent_required');
    expect(snapshot.requiresAdminConsent).toBe(true);
    expect(snapshot.authState).toBe('unauthorized');

    // Actionable: reauthorization path is available and completes the transition.
    const begunAgain = connection.beginAuthorization();
    transport.redeemQueue.push({
      observedTenantId: BOUND_TENANT,
      observedIssuer: ISSUER_FORM_BOUND,
      outcome: 'consented',
    });
    connection.completeAuthorization({
      stateParameter: begunAgain.stateParameter,
      code: 'code-fixture-2',
    });
    expect(connection.snapshot().requiresAdminConsent).toBe(false);
    expect(connection.snapshot().authState).toBe('authorized');
  });

  it('RED R-010.3/R-032: revocation transitions to degraded/reauthorization state, prevents future writes, preserves Entity metadata', () => {
    const { connection, transport } = makeConnection();
    const begun = connection.beginAuthorization();
    transport.redeemQueue.push({
      observedTenantId: BOUND_TENANT,
      observedIssuer: ISSUER_FORM_BOUND,
      outcome: 'consented',
    });
    connection.completeAuthorization({ stateParameter: begun.stateParameter, code: 'code' });
    expect(connection.snapshot().authState).toBe('authorized');

    const metadataBefore = connection.snapshot().entityMetadataJson;
    connection.revoke();

    const after = connection.snapshot();
    expect(after.authState).toBe('unauthorized');
    expect(after.readinessState).toBe('degraded');
    expect(after.revoked).toBe(true);
    // Entity metadata preserved verbatim (no deletion on disconnect/revocation).
    expect(after.entityMetadataJson).toBe(metadataBefore);
    // Future writes rejected.
    expect(() =>
      connection.assertArtifactOperationAllowed({
        operation: 'write',
        observedTenantId: BOUND_TENANT,
        observedIssuer: ISSUER_FORM_BOUND,
      }),
    ).toThrow(RevokedConnectionError);
    // Reads also fail closed post-revocation.
    expect(() =>
      connection.assertArtifactOperationAllowed({
        operation: 'read',
        observedTenantId: BOUND_TENANT,
        observedIssuer: ISSUER_FORM_BOUND,
      }),
    ).toThrow(RevokedConnectionError);
  });

  it('RED R-010.2: cross-tenant artifact operations are REJECTED (fail-closed, typed error)', () => {
    const { connection, transport } = makeConnection();
    const begun = connection.beginAuthorization();
    transport.redeemQueue.push({
      observedTenantId: BOUND_TENANT,
      observedIssuer: ISSUER_FORM_BOUND,
      outcome: 'consented',
    });
    connection.completeAuthorization({ stateParameter: begun.stateParameter, code: 'code' });

    let caught: unknown;
    try {
      connection.assertArtifactOperationAllowed({
        operation: 'read',
        observedTenantId: OTHER_TENANT,
        observedIssuer: ISSUER_FORM_OTHER,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TenantMismatchError);
    // Typed errors carry hex code points, never raw tenant values.
    const err = caught as TenantMismatchError;
    expect(err.firstDivergentCodePointHex).toMatch(/^U\+[0-9A-F]{4}$/i);
    expect(err.message).not.toContain(BOUND_TENANT);
    expect(err.message).not.toContain(OTHER_TENANT);
    // The mismatch must degrade the connection (fail-closed), not be silently coerced.
    expect(connection.snapshot().authState).toBe('degraded');
  });

  it('RED callback/CSRF: state mismatch and replay are both rejected', () => {
    const { connection, transport } = makeConnection();
    connection.beginAuthorization();

    // Mismatch: attacker-supplied state value.
    transport.redeemQueue.push({
      observedTenantId: BOUND_TENANT,
      observedIssuer: ISSUER_FORM_BOUND,
      outcome: 'consented',
    });
    expect(() =>
      connection.completeAuthorization({ stateParameter: 'state-attacker', code: 'code' }),
    ).toThrow(CsrfStateMismatchError);
    expect((connection.snapshot() as { lastCsrfFailure?: string }).lastCsrfFailure).toBe('mismatch');

    // Replay: reuse of an already-consumed valid state.
    const valid = connection.beginAuthorization();
    transport.redeemQueue.push({
      observedTenantId: BOUND_TENANT,
      observedIssuer: ISSUER_FORM_BOUND,
      outcome: 'consented',
    });
    connection.completeAuthorization({ stateParameter: valid.stateParameter, code: 'code-1' });
    transport.redeemQueue.push({
      observedTenantId: BOUND_TENANT,
      observedIssuer: ISSUER_FORM_BOUND,
      outcome: 'consented',
    });
    expect(() =>
      connection.completeAuthorization({ stateParameter: valid.stateParameter, code: 'code-2' }),
    ).toThrow(CsrfStateMismatchError);
    expect((connection.snapshot() as { lastCsrfFailure?: string }).lastCsrfFailure).toBe('replay');
  });

  it('RED R-032: read-only scope configuration requires no write authorization to read, and cannot write', () => {
    const { connection, transport } = makeConnection({ scopes: READ_ONLY_SCOPES });
    const begun = connection.beginAuthorization();
    transport.redeemQueue.push({
      observedTenantId: BOUND_TENANT,
      observedIssuer: ISSUER_FORM_BOUND,
      outcome: 'consented',
    });
    connection.completeAuthorization({ stateParameter: begun.stateParameter, code: 'code' });

    // Reads allowed with read-scope grant only.
    expect(() =>
      connection.assertArtifactOperationAllowed({
        operation: 'read',
        observedTenantId: BOUND_TENANT,
        observedIssuer: ISSUER_FORM_BOUND,
      }),
    ).not.toThrow();
    // Writes fail closed even though the connection itself is authorized.
    expect(() =>
      connection.assertArtifactOperationAllowed({
        operation: 'write',
        observedTenantId: BOUND_TENANT,
        observedIssuer: ISSUER_FORM_BOUND,
      }),
    ).toThrow(InsufficientScopeError);
  });

  it('RED capability honesty: degraded / consent-pending / unauthorized states never lift a write lane', () => {
    const { connection, transport } = makeConnection();
    // Unauthorized at construction.
    expect(connection.writeLaneLifted()).toBe(false);

    // Admin-consent-pending.
    const begun = connection.beginAuthorization();
    transport.redeemQueue.push({
      observedTenantId: BOUND_TENANT,
      observedIssuer: ISSUER_FORM_BOUND,
      outcome: 'admin_consent_required',
    });
    try {
      connection.completeAuthorization({
        stateParameter: begun.stateParameter,
        code: 'code',
      });
    } catch {
      /* expected typed error */
    }
    expect(connection.writeLaneLifted()).toBe(false);

    // Degraded via tenant mismatch.
    const begun2 = connection.beginAuthorization();
    transport.redeemQueue.push({
      observedTenantId: BOUND_TENANT,
      observedIssuer: ISSUER_FORM_BOUND,
      outcome: 'consented',
    });
    connection.completeAuthorization({ stateParameter: begun2.stateParameter, code: 'code' });
    try {
      connection.assertArtifactOperationAllowed({
        operation: 'read',
        observedTenantId: OTHER_TENANT,
        observedIssuer: ISSUER_FORM_OTHER,
      });
    } catch {
      /* expected */
    }
    expect(connection.writeLaneLifted()).toBe(false);
  });

  /* =========================================================================
   * Round 2 review fixes (THE-960 r1 verdict, F1–F8).
   * ======================================================================= */

  function authorize(connection: MicrosoftEntraConnection, transport: FakeIdentityTransport): void {
    const begun = connection.beginAuthorization();
    transport.redeemQueue.push({
      observedTenantId: BOUND_TENANT,
      observedIssuer: ISSUER_FORM_BOUND,
      outcome: 'consented',
    });
    connection.completeAuthorization({
      stateParameter: begun.stateParameter,
      code: 'code-fixture',
    });
  }

  it('RED F1: authorized + not_required + granted write scope lifts the write lane (direct/app grants can write)', () => {
    // A DB-loaded direct/app-grant connection: already authorized, consent not_required.
    const secrets = new FakeSecretStore();
    const tokenRef = secrets.put();
    const clientSecretRef = secrets.put();
    const connection = new MicrosoftEntraConnection({
      transport: new FakeIdentityTransport(),
      secretStore: secrets,
      record: {
        connectionId: 'conn-direct-grant',
        provider: 'microsoft_365',
        tenantBinding: { tenantId: BOUND_TENANT, issuerForm: ISSUER_FORM_BOUND },
        secretReferences: { tokenRef, clientSecretRef },
        scopes: READ_WRITE_SCOPES,
        authState: 'authorized',
        readinessState: 'ready',
        consentState: 'not_required',
        entityMetadataJson: '{}',
      },
    });
    expect(connection.writeLaneLifted()).toBe(true);
    expect(() =>
      connection.assertArtifactOperationAllowed({
        operation: 'write',
        observedTenantId: BOUND_TENANT,
        observedIssuer: ISSUER_FORM_BOUND,
      }),
    ).not.toThrow();
  });

  it('RED F1: consentState=unknown fails closed — never lifts a write lane even when authorized with write scope', () => {
    const { connection, transport } = makeConnection();
    authorize(connection, transport);
    // Force the unknown consent state (e.g. loaded from DB without consent telemetry).
    (connection as unknown as { consentState: string }).consentState = 'unknown';
    expect(connection.writeLaneLifted()).toBe(false);
    expect(() =>
      connection.assertArtifactOperationAllowed({
        operation: 'write',
        observedTenantId: BOUND_TENANT,
        observedIssuer: ISSUER_FORM_BOUND,
      }),
    ).toThrow(InsufficientScopeError);
  });

  it('RED F2: the transport seam receives the authorization code AND PKCE verifier on redemption', () => {
    const { connection, transport } = makeConnection();
    const begun = connection.beginAuthorization();
    transport.redeemQueue.push({
      observedTenantId: BOUND_TENANT,
      observedIssuer: ISSUER_FORM_BOUND,
      outcome: 'consented',
    });
    connection.completeAuthorization({
      stateParameter: begun.stateParameter,
      code: 'auth-code-fixture-123',
    });

    expect(transport.redeemInputs).toHaveLength(1);
    const redeemInput = transport.redeemInputs[0]!;
    expect(redeemInput.stateParameter).toBe(begun.stateParameter);
    // The authorization code MUST reach the transport — a real Entra transport cannot
    // perform the exchange without it.
    expect(redeemInput.code).toBe('auth-code-fixture-123');
    // PKCE: the verifier generated at beginAuthorization is threaded to redemption.
    expect(redeemInput.codeVerifier).toMatch(/^verifier-/);
  });

  it('RED F3: reauthorization on a revoked connection is rejected with a typed error (terminal revocation)', () => {
    const { connection, transport } = makeConnection();
    authorize(connection, transport);
    connection.revoke();

    // Both halves of a fresh authorization transaction reject on a revoked connection.
    expect(() => connection.beginAuthorization()).toThrow(RevokedConnectionError);
    expect(() =>
      connection.completeAuthorization({
        stateParameter: 'state-anything',
        code: 'code-fixture',
      }),
    ).toThrow(RevokedConnectionError);
    // No contradictory authorized/ready/revoked snapshot is reachable.
    const snapshot = connection.snapshot();
    expect(snapshot.revoked).toBe(true);
    expect(snapshot.authState).not.toBe('authorized');
    expect(snapshot.readinessState).not.toBe('ready');
  });

  it('RED F4: reads on a degraded-but-never-revoked connection do NOT throw RevokedConnectionError', () => {
    const { connection } = makeConnection();
    // Degrade via a cross-tenant operation attempt (no revocation involved).
    try {
      connection.assertArtifactOperationAllowed({
        operation: 'read',
        observedTenantId: OTHER_TENANT,
        observedIssuer: ISSUER_FORM_OTHER,
      });
    } catch {
      /* the mismatch itself is expected */
    }
    expect(connection.snapshot().revoked).toBe(false);
    expect(connection.snapshot().authState).toBe('degraded');

    let caught: unknown;
    try {
      connection.assertArtifactOperationAllowed({
        operation: 'read',
        observedTenantId: BOUND_TENANT,
        observedIssuer: ISSUER_FORM_BOUND,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught).not.toBeInstanceOf(RevokedConnectionError);
    expect((caught as Error).name).toBe('DegradedConnectionError');
  });

  it('RED F4: reads on a revoked connection still throw RevokedConnectionError', () => {
    const { connection } = makeConnection();
    connection.revoke();
    expect(() =>
      connection.assertArtifactOperationAllowed({
        operation: 'read',
        observedTenantId: BOUND_TENANT,
        observedIssuer: ISSUER_FORM_BOUND,
      }),
    ).toThrow(RevokedConnectionError);
  });

  it('RED F5: issuer-only mismatch reports the OBSERVED TENANT in the tenant diagnostic, never the issuer string', () => {
    const { connection, transport } = makeConnection();
    const begun = connection.beginAuthorization();
    transport.redeemQueue.push({
      observedTenantId: BOUND_TENANT,
      observedIssuer: ISSUER_FORM_OTHER, // tenant matches; ONLY the issuer differs
      outcome: 'consented',
    });
    let caught: unknown;
    try {
      connection.completeAuthorization({
        stateParameter: begun.stateParameter,
        code: 'code-fixture',
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TenantMismatchError);
    const err = caught as TenantMismatchError;
    // The observed-TENANT field carries the observed tenant (same length as the binding),
    // never the issuer URL (length 50-ish vs 16).
    expect(err.observedTenantLength).toBe(BOUND_TENANT.length);
    expect(err.firstDivergentCodePointHex).toBeNull();
    expect(err.message).not.toContain('https://');
  });

  it('RED F6: a record whose provider does not match the module constant is rejected at construction', () => {
    const secrets = new FakeSecretStore();
    const tokenRef = secrets.put();
    const clientSecretRef = secrets.put();
    expect(
      () =>
        new MicrosoftEntraConnection({
          transport: new FakeIdentityTransport(),
          secretStore: secrets,
          record: {
            connectionId: 'conn-wrong-provider',
            provider: 'google_workspace' as never,
            tenantBinding: { tenantId: BOUND_TENANT, issuerForm: ISSUER_FORM_BOUND },
            secretReferences: { tokenRef, clientSecretRef },
            scopes: READ_WRITE_SCOPES,
            authState: 'unauthorized',
            readinessState: 'unknown',
            consentState: 'not_required',
            entityMetadataJson: '{}',
          },
        }),
    ).toThrow(InvalidConnectionRecordError);
  });

  it('RED F7: mutating a scope entry after construction cannot flip the security gate externally', () => {
    const scopes: Array<{ name: string; kind: 'read' | 'write'; granted: boolean }> = [
      { name: 'fixture.read.scope', kind: 'read', granted: true },
      { name: 'fixture.write.scope', kind: 'write', granted: false },
    ];
    const { connection, transport } = makeConnection({ scopes });
    authorize(connection, transport);
    expect(connection.writeLaneLifted()).toBe(false);

    // External aliasing attack: flip the granted flag through the retained caller reference...
    scopes[1]!.granted = true;
    // ...and also through the snapshot copy.
    const snapshot = connection.snapshot();
    const snapWrite = snapshot.scopes.find((s) => s.kind === 'write');
    if (snapWrite) snapWrite.granted = true;

    // The gate must NOT flip through either path.
    expect(connection.writeLaneLifted()).toBe(false);
    expect(() =>
      connection.assertArtifactOperationAllowed({
        operation: 'write',
        observedTenantId: BOUND_TENANT,
        observedIssuer: ISSUER_FORM_BOUND,
      }),
    ).toThrow(InsufficientScopeError);
  });

  it("RED F8: the 'error' redemption outcome produces a typed error, not a silent degradation", () => {
    const { connection, transport } = makeConnection();
    const begun = connection.beginAuthorization();
    transport.redeemQueue.push({
      observedTenantId: BOUND_TENANT,
      observedIssuer: ISSUER_FORM_BOUND,
      outcome: 'error',
    });
    let caught: unknown;
    try {
      connection.completeAuthorization({
        stateParameter: begun.stateParameter,
        code: 'code-fixture',
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AuthorizationRedemptionError);
    // State degrades (fail-closed) but the failure is surfaced, not swallowed.
    expect(connection.snapshot().authState).toBe('degraded');
    expect(connection.snapshot().readinessState).toBe('error');
  });

  it('RED CSRF gap: the missing-state callback path is rejected with reasonCode missing', () => {
    const { connection } = makeConnection();
    connection.beginAuthorization();
    let caught: unknown;
    try {
      connection.completeAuthorization({ stateParameter: '', code: 'code-fixture' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CsrfStateMismatchError);
    expect((caught as CsrfStateMismatchError).reasonCode).toBe('missing');
    expect((connection.snapshot() as { lastCsrfFailure?: string }).lastCsrfFailure).toBe(
      'missing',
    );
  });
});
