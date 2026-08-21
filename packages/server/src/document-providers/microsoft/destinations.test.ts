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

    // Rediscovery through the SAME injected seam re-resolves to the same identity.
    const rediscovered = rediscoverDestination({ transport, record });
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
    expect(() => rediscoverDestination({ transport: fakeTransport({}), record: bad })).toThrow(
      InvalidDestinationRecordError,
    );
  });
});
