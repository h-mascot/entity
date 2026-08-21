/**
 * T-020 (THE-961) — Microsoft destination discovery/policy tests (R-011).
 *
 * Deterministic only: hand-rolled fakes with recorded fixture sequences. No network,
 * no credentials, no tenant data — every provider identifier below is an OPAQUE FIXTURE
 * STRING with no real-world meaning.
 *
 * RED coverage map (R-011 acceptance):
 *   1. "Creation always identifies an allowed destination."
 *      -> resolves exactly one allowed OneDrive fixture destination;
 *      -> resolves exactly one allowed SharePoint library fixture destination;
 *      -> rejects a policy-denied destination (typed error);
 *      -> rejects an unknown/unresolvable destination (typed error);
 *      -> rejects ambiguity (two permitted candidates) rather than guessing.
 *   2. "SharePoint site/library identity is retained sufficiently for rediscovery."
 *      -> retained record carries site/library identity; rediscovery through the injected
 *         seam re-resolves to the same identity.
 *   3. "An artifact moved or renamed does not automatically become a new Entity document
 *      if provider identity remains stable."
 *      -> rename/move synchronization test: stable driveId+itemId => same Entity document.
 *
 * Negative paths: cross-tenant destination rejection; degraded/unauthorized connection
 * never lifts destination resolution (capability honesty, fail closed).
 */

import { describe, expect, it } from 'vitest';

import type {
  DocumentArtifactType,
} from '../../../../db/src/document-integrations';
import {
  AdminConsentRequiredError,
  DegradedConnectionError,
  RevokedConnectionError,
  TenantMismatchError,
  type MicrosoftConnectionSnapshot,
  type MicrosoftScopeEntry,
} from './connection';
import {
  AmbiguousDestinationError,
  DestinationNotPermittedError,
  DestinationPolicyMissingError,
  DestinationUnresolvableError,
  InvalidDestinationRecordError,
  type MicrosoftDestinationIdentity,
  type MicrosoftDestinationTransport,
  type MicrosoftObservedDestination,
  type MicrosoftWorkspaceDestinationPolicy,
  rediscoverDestination,
  resolveCreationDestination,
  retainDestinationRecord,
  sameEntityDocumentIdentity,
  type MicrosoftArtifactProviderIdentity,
} from './destinations';

/* ------------------------- opaque fixtures (no real IDs) ------------------------- */

const WORKSPACE = 'ws-fixture-1';
const TENANT = 'tenant-fixture-a';
const OTHER_TENANT = 'tenant-fixture-b';
const ISSUER = 'issuer-form-fixture/a';
const CONNECTION = 'conn-fixture-1';

const onedriveIdentity: MicrosoftDestinationIdentity = {
  kind: 'onedrive',
  driveId: 'drive-fixture-1',
  ownerUserId: 'user-fixture-1',
  siteId: null,
  libraryId: null,
};

const sharepointIdentity: MicrosoftDestinationIdentity = {
  kind: 'sharepoint_library',
  driveId: 'drive-fixture-2',
  ownerUserId: null,
  siteId: 'site-fixture-1',
  libraryId: 'library-fixture-1',
};

function scope(kind: 'read' | 'write', granted: boolean): MicrosoftScopeEntry {
  return { name: `scope-fixture-${kind}`, kind, granted };
}

function authorizedSnapshot(
  overrides: Partial<MicrosoftConnectionSnapshot> = {},
): MicrosoftConnectionSnapshot {
  return {
    connectionId: CONNECTION,
    provider: 'microsoft_365',
    tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
    secretReferences: { tokenRef: 'ref-token', clientSecretRef: 'ref-client' },
    scopes: [scope('read', true), scope('write', true)],
    authState: 'authorized',
    readinessState: 'ready',
    consentState: 'user_consented',
    entityMetadataJson: '{"fixture":true}',
    revoked: false,
    requiresAdminConsent: false,
    ...overrides,
  };
}

function policyWith(
  entries: Array<{
    id: string;
    identity: MicrosoftDestinationIdentity;
    artifactTypes?: ReadonlySet<DocumentArtifactType>;
    enabled?: boolean;
    tenantId?: string;
  }>,
): MicrosoftWorkspaceDestinationPolicy {
  return {
    workspaceId: WORKSPACE,
    tenantId: TENANT,
    connectionId: CONNECTION,
    permittedDestinations: entries.map((e) => ({
      destinationId: e.id,
      workspaceId: WORKSPACE,
      tenantId: e.tenantId ?? TENANT,
      connectionId: CONNECTION,
      artifactTypes: e.artifactTypes ?? new Set<DocumentArtifactType>(['document']),
      identity: e.identity,
      displayName: `display-${e.id}`,
      enabled: e.enabled ?? true,
    })),
  };
}

/** Recorded fake transport: maps requested identity key -> scripted observation. */
function fakeTransport(
  script: Record<string, MicrosoftObservedDestination | 'unresolvable'>,
  calls: Array<{ requestedDriveId: string | null }> = [],
): MicrosoftDestinationTransport {
  return {
    resolveDestination(input) {
      calls.push({ requestedDriveId: input.identity.driveId });
      const key = input.identity.driveId ?? '';
      const outcome = script[key];
      if (outcome === 'unresolvable' || outcome === undefined) {
        return {
          requestedDestinationId: input.identity.driveId ?? '',
          outcome: 'unresolvable' as const,
          observedTenantId: '',
          observedIssuer: '',
        };
      }
      return outcome;
    },
  };
}

function observedFor(
  requestedDestinationId: string,
  identity: MicrosoftDestinationIdentity,
  tenantId: string = TENANT,
): MicrosoftObservedDestination {
  return {
    requestedDestinationId,
    outcome: 'resolved',
    observedIdentity: identity,
    observedTenantId: tenantId,
    observedIssuer: ISSUER,
  };
}

/* ------------------------------- tests ----------------------------------- */

describe('T-020 microsoft destinations (R-011)', () => {
  it('RED acceptance 1a: resolves exactly one allowed OneDrive destination', () => {
    const calls: Array<{ requestedDriveId: string | null }> = [];
    const transport = fakeTransport(
      { 'drive-fixture-1': observedFor('od-1', onedriveIdentity) },
      calls,
    );
    const policy = policyWith([{ id: 'od-1', identity: onedriveIdentity }]);
    const resolved = resolveCreationDestination({
      transport,
      policy,
      connection: authorizedSnapshot(),
      artifactType: 'document',
      tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
    });
    expect(resolved.destination.destinationId).toBe('od-1');
    expect(resolved.observed.observedIdentity.kind).toBe('onedrive');
    expect(calls).toEqual([{ requestedDriveId: 'drive-fixture-1' }]);
  });

  it('RED acceptance 1b: resolves an allowed SharePoint library destination', () => {
    const transport = fakeTransport({
      'drive-fixture-2': observedFor('sp-1', sharepointIdentity),
    });
    const policy = policyWith([
      { id: 'sp-1', identity: sharepointIdentity, artifactTypes: new Set(['spreadsheet']) },
    ]);
    const resolved = resolveCreationDestination({
      transport,
      policy,
      connection: authorizedSnapshot(),
      artifactType: 'spreadsheet',
      tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
    });
    expect(resolved.destination.identity.siteId).toBe('site-fixture-1');
    expect(resolved.observed.observedIdentity.libraryId).toBe('library-fixture-1');
  });

  it('RED acceptance 1c: policy-denied destination rejects with a typed error (fail closed)', () => {
    const transport = fakeTransport({});
    // The requested artifact type is not served by any permitted destination.
    const policy = policyWith([
      { id: 'od-1', identity: onedriveIdentity, artifactTypes: new Set(['presentation']) },
    ]);
    expect(() =>
      resolveCreationDestination({
        transport,
        policy,
        connection: authorizedSnapshot(),
        artifactType: 'document',
        tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
      }),
    ).toThrow(DestinationNotPermittedError);
  });

  it('RED acceptance 1d: missing workspace policy rejects with a typed configuration error', () => {
    const transport = fakeTransport({});
    const empty: MicrosoftWorkspaceDestinationPolicy = {
      workspaceId: WORKSPACE,
      tenantId: TENANT,
      connectionId: CONNECTION,
      permittedDestinations: [],
    };
    expect(() =>
      resolveCreationDestination({
        transport,
        policy: empty,
        connection: authorizedSnapshot(),
        artifactType: 'document',
        tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
      }),
    ).toThrow(DestinationPolicyMissingError);
  });

  it('RED acceptance 1e: unresolvable destination rejects and never coerces to a default', () => {
    const transport = fakeTransport({ 'drive-fixture-1': 'unresolvable' });
    const policy = policyWith([{ id: 'od-1', identity: onedriveIdentity }]);
    expect(() =>
      resolveCreationDestination({
        transport,
        policy,
        connection: authorizedSnapshot(),
        artifactType: 'document',
        tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
      }),
    ).toThrow(DestinationUnresolvableError);
  });

  it('RED acceptance 1f: ambiguous permitted set rejects instead of guessing a destination', () => {
    const transport = fakeTransport({
      'drive-fixture-1': observedFor('od-1', onedriveIdentity),
      'drive-fixture-3': observedFor('od-2', onedriveIdentity),
    });
    const policy = policyWith([
      { id: 'od-1', identity: onedriveIdentity },
      { id: 'od-2', identity: { ...onedriveIdentity, driveId: 'drive-fixture-3' } },
    ]);
    expect(() =>
      resolveCreationDestination({
        transport,
        policy,
        connection: authorizedSnapshot(),
        artifactType: 'document',
        tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
      }),
    ).toThrow(AmbiguousDestinationError);
  });

  it('RED acceptance 2: retains SharePoint site/library identity sufficient for rediscovery', () => {
    const transport = fakeTransport({
      'drive-fixture-2': observedFor('sp-1', sharepointIdentity),
    });
    const policy = policyWith([
      { id: 'sp-1', identity: sharepointIdentity, artifactTypes: new Set(['document']) },
    ]);
    const resolved = resolveCreationDestination({
      transport,
      policy,
      connection: authorizedSnapshot(),
      artifactType: 'document',
      tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
    });
    const record = retainDestinationRecord(resolved);
    expect(record.siteId).toBe('site-fixture-1');
    expect(record.libraryId).toBe('library-fixture-1');
    expect(record.driveId).toBe('drive-fixture-2');

    // Rediscovery through the SAME injected seam re-resolves to the same identity
    // (r2: rediscovery is gated and bound exactly like creation).
    const rediscovered = rediscoverDestination({
      transport,
      record,
      connection: authorizedSnapshot(),
      tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
    });
    expect(rediscovered.observedIdentity).toEqual(sharepointIdentity);
  });

  it('RED acceptance 3: rename/move keeps provider identity — NOT a new Entity document', () => {
    const before: MicrosoftArtifactProviderIdentity = {
      driveId: 'drive-fixture-1',
      itemId: 'item-fixture-1',
    };
    // Renamed AND moved to another folder within the same drive: item id unchanged.
    const afterRenameMove: MicrosoftArtifactProviderIdentity = {
      driveId: 'drive-fixture-1',
      itemId: 'item-fixture-1',
    };
    expect(sameEntityDocumentIdentity(before, afterRenameMove)).toBe(true);

    // A genuinely different provider item IS a different Entity document candidate.
    const differentItem: MicrosoftArtifactProviderIdentity = {
      driveId: 'drive-fixture-1',
      itemId: 'item-fixture-9',
    };
    expect(sameEntityDocumentIdentity(before, differentItem)).toBe(false);
  });

  it('RED negative: cross-tenant observed destination rejects (fail closed)', () => {
    const transport = fakeTransport({
      'drive-fixture-1': observedFor('od-1', onedriveIdentity, OTHER_TENANT),
    });
    const policy = policyWith([{ id: 'od-1', identity: onedriveIdentity }]);
    let caught: unknown;
    try {
      resolveCreationDestination({
        transport,
        policy,
        connection: authorizedSnapshot(),
        artifactType: 'document',
        tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TenantMismatchError);
  });

  it('RED negative: degraded connection never resolves any destination capability', () => {
    const transport = fakeTransport({
      'drive-fixture-1': observedFor('od-1', onedriveIdentity),
    });
    const policy = policyWith([{ id: 'od-1', identity: onedriveIdentity }]);
    expect(() =>
      resolveCreationDestination({
        transport,
        policy,
        connection: authorizedSnapshot({ authState: 'degraded', readinessState: 'degraded' }),
        artifactType: 'document',
        tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
      }),
    ).toThrow(DegradedConnectionError);
  });

  it('RED negative: unauthorized connection never resolves any destination', () => {
    const transport = fakeTransport({});
    const policy = policyWith([{ id: 'od-1', identity: onedriveIdentity }]);
    expect(() =>
      resolveCreationDestination({
        transport,
        policy,
        connection: authorizedSnapshot({ authState: 'unauthorized' }),
        artifactType: 'document',
        tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
      }),
    ).toThrow(DegradedConnectionError);
  });

  it('RED negative: admin-consent-pending connection blocks destination resolution', () => {
    const transport = fakeTransport({});
    const policy = policyWith([{ id: 'od-1', identity: onedriveIdentity }]);
    expect(() =>
      resolveCreationDestination({
        transport,
        policy,
        connection: authorizedSnapshot({
          consentState: 'admin_consent_required',
          requiresAdminConsent: true,
          authState: 'unauthorized',
          readinessState: 'degraded',
        }),
        artifactType: 'document',
        tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
      }),
    ).toThrow(AdminConsentRequiredError);
  });

  it('RED negative: revoked connection blocks destination resolution', () => {
    const transport = fakeTransport({});
    const policy = policyWith([{ id: 'od-1', identity: onedriveIdentity }]);
    expect(() =>
      resolveCreationDestination({
        transport,
        policy,
        connection: authorizedSnapshot({
          revoked: true,
          authState: 'unauthorized',
          readinessState: 'degraded',
        }),
        artifactType: 'document',
        tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
      }),
    ).toThrow(RevokedConnectionError);
  });

  it('RED negative: no granted write scope never lifts destination resolution', () => {
    const transport = fakeTransport({});
    const policy = policyWith([{ id: 'od-1', identity: onedriveIdentity }]);
    const conn = authorizedSnapshot();
    conn.scopes = [scope('read', true)];
    expect(() =>
      resolveCreationDestination({
        transport,
        policy,
        connection: conn,
        artifactType: 'document',
        tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
      }),
    ).toThrow(/INSUFFICIENT_SCOPE|write/);
  });

  it('RED: malformed retained record (missing both identities) fails closed', () => {
    const bad = {
      destinationId: 'x',
      workspaceId: WORKSPACE,
      tenantId: TENANT,
      connectionId: CONNECTION,
      kind: 'sharepoint_library' as const,
      driveId: null,
      ownerUserId: null,
      siteId: null,
      libraryId: null,
      displayName: 'broken',
    };
    expect(() =>
      rediscoverDestination({
        transport: fakeTransport({}),
        record: bad,
        connection: authorizedSnapshot(),
        tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
      }),
    ).toThrow(InvalidDestinationRecordError);
  });

  /* =====================================================================
   * r2 (THE-961 round 2) — GLM 5.3 review fixes F1–F8.
   * Assertions use error name/message (not class imports) so each RED test
   * fails at base for the STATED reason (missing enforcement), not a missing
   * symbol.
   * ===================================================================== */

  function retainedOnedriveRecord() {
    return {
      destinationId: 'od-1',
      workspaceId: WORKSPACE,
      tenantId: TENANT,
      connectionId: CONNECTION,
      kind: 'onedrive' as const,
      displayName: 'display-od-1',
      driveId: 'drive-fixture-1',
      ownerUserId: 'user-fixture-1',
      siteId: null,
      libraryId: null,
    };
  }

  function catchName(fn: () => unknown): string {
    try {
      fn();
    } catch (e) {
      return (e as Error).name;
    }
    return 'NO_THROW';
  }

  describe('F1: rediscovery is gated and bound like creation', () => {
    const transport = fakeTransport({
      'drive-fixture-1': observedFor('od-1', onedriveIdentity),
    });

    it('RED F1a: revoked connection blocks rediscovery (typed, fail closed)', () => {
      expect(
        catchName(() =>
          rediscoverDestination({
            transport,
            record: retainedOnedriveRecord(),
            connection: authorizedSnapshot({ revoked: true, authState: 'unauthorized' }),
            tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
          }),
        ),
      ).toBe('RevokedConnectionError');
    });

    it('RED F1b: degraded connection blocks rediscovery (typed, fail closed)', () => {
      expect(
        catchName(() =>
          rediscoverDestination({
            transport,
            record: retainedOnedriveRecord(),
            connection: authorizedSnapshot({ authState: 'degraded' }),
            tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
          }),
        ),
      ).toBe('DegradedConnectionError');
    });

    it('RED F1c: unbound rediscovery fails closed at runtime (tenant binding mandatory)', () => {
      expect(
        catchName(() =>
          rediscoverDestination({
            transport,
            record: retainedOnedriveRecord(),
            connection: authorizedSnapshot(),
            tenantBinding: undefined,
          } as unknown as Parameters<typeof rediscoverDestination>[0]),
        ),
      ).toBe('InvalidDestinationRecordError');
    });

    it('RED F1d: rediscovery binding diverging from the record rejects (TenantMismatchError)', () => {
      expect(
        catchName(() =>
          rediscoverDestination({
            transport,
            record: retainedOnedriveRecord(),
            connection: authorizedSnapshot(),
            tenantBinding: { tenantId: OTHER_TENANT, issuerForm: ISSUER },
          }),
        ),
      ).toBe('TenantMismatchError');
    });

    it('RED F1e: rediscovery observed ISSUER mismatch rejects (TenantMismatchError)', () => {
      const wrongIssuerTransport = fakeTransport({
        'drive-fixture-1': {
          requestedDestinationId: 'od-1',
          outcome: 'resolved' as const,
          observedIdentity: onedriveIdentity,
          observedTenantId: TENANT,
          observedIssuer: 'issuer-form-fixture/other',
        },
      });
      expect(
        catchName(() =>
          rediscoverDestination({
            transport: wrongIssuerTransport,
            record: retainedOnedriveRecord(),
            connection: authorizedSnapshot(),
            tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
          }),
        ),
      ).toBe('TenantMismatchError');
    });
  });

  describe('F2: policy allowlist constrains the RESULT, not just the request', () => {
    it('RED F2a: resolver returning a different well-formed identity rejects; nothing retained', () => {
      const driftTransport = fakeTransport({
        'drive-fixture-1': observedFor('od-1', {
          ...onedriveIdentity,
          driveId: 'drive-fixture-999',
        }),
      });
      const policy = policyWith([{ id: 'od-1', identity: onedriveIdentity }]);
      let retained: unknown = 'not-called';
      expect(
        catchName(() => {
          const resolved = resolveCreationDestination({
            transport: driftTransport,
            policy,
            connection: authorizedSnapshot(),
            artifactType: 'document',
            tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
          });
          retained = retainDestinationRecord(resolved);
        }),
      ).toBe('ObservedIdentityMismatchError');
      expect(retained).toBe('not-called');
    });

    it('RED F2b: echoed requestedDestinationId mismatch on creation rejects', () => {
      const echoTransport = fakeTransport({
        // Transport echoes a DIFFERENT requestedDestinationId than was requested.
        'drive-fixture-1': observedFor('od-wrong', onedriveIdentity),
      });
      const policy = policyWith([{ id: 'od-1', identity: onedriveIdentity }]);
      expect(
        catchName(() =>
          resolveCreationDestination({
            transport: echoTransport,
            policy,
            connection: authorizedSnapshot(),
            artifactType: 'document',
            tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
          }),
        ),
      ).toBe('ObservedIdentityMismatchError');
    });

    it('RED F2c: observed identity drift on rediscovery rejects', () => {
      const driftTransport = fakeTransport({
        'drive-fixture-1': observedFor('od-1', {
          ...onedriveIdentity,
          driveId: 'drive-fixture-999',
        }),
      });
      expect(
        catchName(() =>
          rediscoverDestination({
            transport: driftTransport,
            record: retainedOnedriveRecord(),
            connection: authorizedSnapshot(),
            tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
          }),
        ),
      ).toBe('ObservedIdentityMismatchError');
    });

    it('RED F2d: echoed requestedDestinationId mismatch on rediscovery rejects', () => {
      const echoTransport = fakeTransport({
        'drive-fixture-1': observedFor('od-wrong', onedriveIdentity),
      });
      expect(
        catchName(() =>
          rediscoverDestination({
            transport: echoTransport,
            record: retainedOnedriveRecord(),
            connection: authorizedSnapshot(),
            tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
          }),
        ),
      ).toBe('ObservedIdentityMismatchError');
    });
  });

  describe('F3: authority sources are cross-checked at entry', () => {
    it('RED F3a: policy.connectionId != connection.connectionId rejects (typed)', () => {
      const transport = fakeTransport({
        'drive-fixture-1': observedFor('od-1', onedriveIdentity),
      });
      const policy = policyWith([{ id: 'od-1', identity: onedriveIdentity }]);
      expect(
        catchName(() =>
          resolveCreationDestination({
            transport,
            policy,
            connection: authorizedSnapshot({ connectionId: 'conn-fixture-OTHER' }),
            artifactType: 'document',
            tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
          }),
        ),
      ).toBe('DestinationAuthorityMismatchError');
    });

    it('RED F3b: tenantBinding diverging from connection.tenantBinding rejects (TenantMismatchError)', () => {
      const transport = fakeTransport({
        'drive-fixture-1': observedFor('od-1', onedriveIdentity),
      });
      const policy = policyWith([{ id: 'od-1', identity: onedriveIdentity }]);
      expect(
        catchName(() =>
          resolveCreationDestination({
            transport,
            policy,
            connection: authorizedSnapshot(),
            artifactType: 'document',
            tenantBinding: { tenantId: OTHER_TENANT, issuerForm: ISSUER },
          }),
        ),
      ).toBe('TenantMismatchError');
    });
  });

  it('RED F4: disabled-only configuration reports no_enabled_candidate (honest diagnostics)', () => {
    const transport = fakeTransport({});
    const policy = policyWith([{ id: 'od-1', identity: onedriveIdentity, enabled: false }]);
    try {
      resolveCreationDestination({
        transport,
        policy,
        connection: authorizedSnapshot(),
        artifactType: 'document',
        tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
      });
      throw new Error('NO_THROW');
    } catch (e) {
      expect(e).toBeInstanceOf(DestinationNotPermittedError);
      expect((e as DestinationNotPermittedError).reasonCode).toBe('no_enabled_candidate');
    }
  });

  it('RED F5: typed config errors carry lengths, never raw values, in messages', () => {
    const missing = new DestinationPolicyMissingError('ws-raw-secret-ish');
    expect(missing.message).not.toContain('ws-raw-secret-ish');
    expect(missing.message).toMatch(/workspaceLength=17/);

    const unresolvable = new DestinationUnresolvableError('dest-raw-id');
    expect(unresolvable.message).not.toContain('dest-raw-id');
    expect(unresolvable.message).toMatch(/destinationLength=11/);
  });

  it('RED F6: consent unknown with authorized auth reports consent, not CONNECTION_NOT_AUTHORIZED', () => {
    const transport = fakeTransport({});
    const policy = policyWith([{ id: 'od-1', identity: onedriveIdentity }]);
    try {
      resolveCreationDestination({
        transport,
        policy,
        connection: authorizedSnapshot({ consentState: 'unknown' }),
        artifactType: 'document',
        tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
      });
      throw new Error('NO_THROW');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/CONSENT/i);
      expect(msg).toContain('consentState=unknown');
      expect(msg).not.toContain('CONNECTION_NOT_AUTHORIZED');
    }
  });

  describe('F7: explicit destination choice among allowed candidates', () => {
    const twoDestinations = () => {
      const transport = fakeTransport({
        'drive-fixture-1': observedFor('od-1', onedriveIdentity),
        'drive-fixture-3': observedFor('od-2', { ...onedriveIdentity, driveId: 'drive-fixture-3' }),
      });
      const policy = policyWith([
        { id: 'od-1', identity: onedriveIdentity },
        { id: 'od-2', identity: { ...onedriveIdentity, driveId: 'drive-fixture-3' } },
      ]);
      return { transport, policy };
    };

    it('RED F7a: explicit requestedDestinationId selects the allowed destination (no ambiguity)', () => {
      const { transport, policy } = twoDestinations();
      const resolved = resolveCreationDestination({
        transport,
        policy,
        connection: authorizedSnapshot(),
        artifactType: 'document',
        tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
        requestedDestinationId: 'od-2',
      });
      expect(resolved.destination.destinationId).toBe('od-2');
    });

    it('RED F7b: explicit destination outside the permitted set fails closed (typed)', () => {
      const { transport, policy } = twoDestinations();
      expect(
        catchName(() =>
          resolveCreationDestination({
            transport,
            policy,
            connection: authorizedSnapshot(),
            artifactType: 'document',
            tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
            requestedDestinationId: 'od-not-in-policy',
          }),
        ),
      ).toBe('DestinationNotPermittedError');
    });
  });

  describe('F8: previously untested enforcement sites', () => {
    it('RED F8a: permitted entry tenant != binding tenant rejects with TenantMismatchError', () => {
      const transport = fakeTransport({});
      const policy: MicrosoftWorkspaceDestinationPolicy = {
        workspaceId: WORKSPACE,
        tenantId: OTHER_TENANT,
        connectionId: CONNECTION,
        permittedDestinations: [
          {
            destinationId: 'od-1',
            workspaceId: WORKSPACE,
            tenantId: OTHER_TENANT,
            connectionId: CONNECTION,
            artifactTypes: new Set<DocumentArtifactType>(['document']),
            identity: onedriveIdentity,
            displayName: 'display-od-1',
            enabled: true,
          },
        ],
      };
      expect(
        catchName(() =>
          resolveCreationDestination({
            transport,
            policy,
            connection: authorizedSnapshot(),
            artifactType: 'document',
            tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
          }),
        ),
      ).toBe('TenantMismatchError');
    });

    it('RED F8b: onedrive entry without driveId rejects InvalidDestinationRecordError(identity.driveId)', () => {
      const transport = fakeTransport({});
      const policy = policyWith([
        { id: 'od-1', identity: { ...onedriveIdentity, driveId: null } },
      ]);
      try {
        resolveCreationDestination({
          transport,
          policy,
          connection: authorizedSnapshot(),
          artifactType: 'document',
          tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
        });
        throw new Error('NO_THROW');
      } catch (e) {
        expect(e).toBeInstanceOf(InvalidDestinationRecordError);
        expect((e as InvalidDestinationRecordError).field).toBe('identity.driveId');
      }
    });

    it('RED F8c: sharepoint entry without site/library rejects InvalidDestinationRecordError', () => {
      const transport = fakeTransport({});
      const policy = policyWith([
        {
          id: 'sp-1',
          identity: { ...sharepointIdentity, siteId: null, libraryId: null },
        },
      ]);
      try {
        resolveCreationDestination({
          transport,
          policy,
          connection: authorizedSnapshot(),
          artifactType: 'document',
          tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
        });
        throw new Error('NO_THROW');
      } catch (e) {
        expect(e).toBeInstanceOf(InvalidDestinationRecordError);
        expect((e as InvalidDestinationRecordError).field).toBe('identity.siteId/libraryId');
      }
    });

    it('RED F8d: creation-path observed ISSUER mismatch rejects (TenantMismatchError)', () => {
      const transport = fakeTransport({
        'drive-fixture-1': {
          requestedDestinationId: 'od-1',
          outcome: 'resolved' as const,
          observedIdentity: onedriveIdentity,
          observedTenantId: TENANT,
          observedIssuer: 'issuer-form-fixture/other',
        },
      });
      const policy = policyWith([{ id: 'od-1', identity: onedriveIdentity }]);
      expect(
        catchName(() =>
          resolveCreationDestination({
            transport,
            policy,
            connection: authorizedSnapshot(),
            artifactType: 'document',
            tenantBinding: { tenantId: TENANT, issuerForm: ISSUER },
          }),
        ),
      ).toBe('TenantMismatchError');
    });
  });
});
