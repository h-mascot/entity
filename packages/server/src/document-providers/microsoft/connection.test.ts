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
  CsrfStateMismatchError,
  InsufficientScopeError,
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

class FakeIdentityTransport implements MicrosoftIdentityTransport {
  readonly calls: CapturedIdentityCall[] = [];
  private pendingStates = new Map<string, string>();
  /** Recorded redeem outcomes consumed in FIFO order. */
  redeemQueue: RedeemFixture[] = [];
  /** When set, beginAuthorization returns this attacker-supplied state instead. */
  tamperedStateOverride: string | null = null;

  beginAuthorization(input: { connectionId: string }): { stateParameter: string } {
    this.calls.push({ kind: 'beginAuthorization', connectionId: input.connectionId });
    const state =
      this.tamperedStateOverride ?? `state-${input.connectionId}-${this.calls.length}`;
    this.pendingStates.set(input.connectionId, state);
    return { stateParameter: state };
  }

  issuedState(connectionId: string): string | undefined {
    return this.pendingStates.get(connectionId);
  }

  redeemAuthorizationCode(input: { stateParameter: string }): RedeemFixture {
    this.calls.push({ kind: 'redeemAuthorizationCode', stateParameter: input.stateParameter });
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
});
