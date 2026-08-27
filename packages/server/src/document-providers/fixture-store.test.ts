/**
 * GQR-004 — Provider fixture store boundary and error-path coverage.
 *
 * The store is the authoritative persistence for sandbox fixtures (connection state,
 * policies, destinations). Boundary focus per repo test conventions: empty/invalid values,
 * typed rejections (never silent coercion), round-trip fidelity, and upsert-overwrite.
 */

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { createProviderFixtureStore, InvalidProviderFixtureError } from './fixture-store';

const openDatabases: Database.Database[] = [];

afterEach(() => {
  for (const db of openDatabases.splice(0)) db.close();
});

function openFreshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  openDatabases.push(db);
  return db;
}

function seedMinimalConnection(store: ReturnType<typeof createProviderFixtureStore>) {
  store.upsertConnection({
    id: 'conn-1',
    workspaceId: 'ws_A',
    tenantId: null,
    provider: 'google_workspace',
    authState: 'authorized',
    enabled: true,
  });
}

describe('connection fixtures', () => {
  it('round-trips a connection fixture and upserts by id', () => {
    const store = createProviderFixtureStore(openFreshDb());
    seedMinimalConnection(store);
    store.upsertConnection({
      id: 'conn-1',
      workspaceId: 'ws_A',
      tenantId: 'tenant_x',
      provider: 'microsoft_365',
      authState: 'degraded',
      enabled: false,
    });
    expect(store.listConnections()).toEqual([
      {
        id: 'conn-1',
        workspaceId: 'ws_A',
        tenantId: 'tenant_x',
        provider: 'microsoft_365',
        authState: 'degraded',
        enabled: false,
      },
    ]);
  });

  it('rejects an unknown provider and an invalid auth state (fail closed)', () => {
    const store = createProviderFixtureStore(openFreshDb());
    expect(() =>
      store.upsertConnection({
        id: 'conn-x',
        workspaceId: 'ws_A',
        tenantId: null,
        provider: 'dropbox' as never,
        authState: 'authorized',
        enabled: true,
      }),
    ).toThrow(InvalidProviderFixtureError);
    expect(() =>
      store.upsertConnection({
        id: 'conn-x',
        workspaceId: 'ws_A',
        tenantId: null,
        provider: 'google_workspace',
        authState: 'superuser' as never,
        enabled: true,
      }),
    ).toThrow(InvalidProviderFixtureError);
    expect(store.listConnections()).toHaveLength(0);
  });

  it('rejects an empty id or workspaceId', () => {
    const store = createProviderFixtureStore(openFreshDb());
    expect(() =>
      store.upsertConnection({
        id: '  ',
        workspaceId: 'ws_A',
        tenantId: null,
        provider: 'google_workspace',
        authState: 'authorized',
        enabled: true,
      }),
    ).toThrow(InvalidProviderFixtureError);
    expect(() =>
      store.upsertConnection({
        id: 'conn-1',
        workspaceId: '',
        tenantId: null,
        provider: 'google_workspace',
        authState: 'authorized',
        enabled: true,
      }),
    ).toThrow(InvalidProviderFixtureError);
  });
});

describe('policy fixtures', () => {
  it('round-trips a policy fixture preserving set semantics inputs and flags', () => {
    const store = createProviderFixtureStore(openFreshDb());
    seedMinimalConnection(store);
    store.upsertPolicy({
      id: 'pol-1',
      workspaceId: 'ws_A',
      tenantId: null,
      connectionId: 'conn-1',
      provider: 'google_workspace',
      artifactType: 'spreadsheet',
      allowedDestinationIds: ['dest_a', 'dest_b'],
      defaultDestinationId: 'dest_a',
      writeMode: 'create_only',
      confirmationPolicy: 'required',
      writeAuthorizationProven: true,
      adminWriteAuthorized: true,
      enabled: false,
    });
    const [policy] = store.listPolicies();
    expect(policy).toEqual({
      id: 'pol-1',
      workspaceId: 'ws_A',
      tenantId: null,
      connectionId: 'conn-1',
      provider: 'google_workspace',
      artifactType: 'spreadsheet',
      allowedDestinationIds: ['dest_a', 'dest_b'],
      defaultDestinationId: 'dest_a',
      writeMode: 'create_only',
      confirmationPolicy: 'required',
      writeAuthorizationProven: true,
      adminWriteAuthorized: true,
      enabled: false,
    });
  });

  it('rejects invalid write mode, confirmation policy, and artifact type', () => {
    const store = createProviderFixtureStore(openFreshDb());
    const base = {
      id: 'pol-x',
      workspaceId: 'ws_A',
      tenantId: null,
      connectionId: null,
      provider: 'google_workspace' as const,
      artifactType: '*' as const,
      allowedDestinationIds: ['dest_a'],
      defaultDestinationId: null,
      confirmationPolicy: null,
      writeAuthorizationProven: false,
      adminWriteAuthorized: false,
      enabled: true,
    };
    expect(() => store.upsertPolicy({ ...base, writeMode: 'delete_everything' as never })).toThrow(
      InvalidProviderFixtureError,
    );
    expect(() => store.upsertPolicy({ ...base, writeMode: 'disabled', confirmationPolicy: 'yes' as never })).toThrow(
      InvalidProviderFixtureError,
    );
    expect(() => store.upsertPolicy({ ...base, writeMode: 'disabled', artifactType: 'pdf' as never })).toThrow(
      InvalidProviderFixtureError,
    );
    expect(() => store.upsertPolicy({ ...base, writeMode: 'disabled', allowedDestinationIds: ['', 'dest_a'] })).toThrow(
      InvalidProviderFixtureError,
    );
    expect(store.listPolicies()).toHaveLength(0);
  });

  it('preserves the "*" wildcard artifact type through a round trip', () => {
    const store = createProviderFixtureStore(openFreshDb());
    store.upsertPolicy({
      id: 'pol-w',
      workspaceId: 'ws_A',
      tenantId: null,
      connectionId: null,
      provider: 'local_office',
      artifactType: '*',
      allowedDestinationIds: [],
      defaultDestinationId: null,
      writeMode: 'disabled',
      confirmationPolicy: null,
      writeAuthorizationProven: false,
      adminWriteAuthorized: false,
      enabled: true,
    });
    expect(store.listPolicies()[0].artifactType).toBe('*');
  });
});

describe('destination fixtures', () => {
  it('round-trips a destination fixture with multi-artifact types and null external id', () => {
    const store = createProviderFixtureStore(openFreshDb());
    store.upsertDestination({
      id: 'dest_a',
      workspaceId: 'ws_A',
      tenantId: null,
      connectionId: null,
      provider: 'local_office',
      artifactTypes: ['document', 'spreadsheet'],
      destinationKind: 'local_managed_storage',
      externalId: null,
      displayName: 'Managed local storage',
      enabled: true,
    });
    expect(store.listDestinations()).toEqual([
      {
        id: 'dest_a',
        workspaceId: 'ws_A',
        tenantId: null,
        connectionId: null,
        provider: 'local_office',
        artifactTypes: ['document', 'spreadsheet'],
        destinationKind: 'local_managed_storage',
        externalId: null,
        displayName: 'Managed local storage',
        enabled: true,
      },
    ]);
  });

  it('rejects empty artifact types, invalid kind, and empty display name', () => {
    const store = createProviderFixtureStore(openFreshDb());
    const base = {
      id: 'dest_x',
      workspaceId: 'ws_A',
      tenantId: null,
      connectionId: null,
      provider: 'google_workspace' as const,
      artifactTypes: ['document'] as const,
      destinationKind: 'folder' as const,
      externalId: 'folder-1',
      displayName: 'Somewhere',
      enabled: true,
    };
    expect(() => store.upsertDestination({ ...base, artifactTypes: [] })).toThrow(InvalidProviderFixtureError);
    expect(() => store.upsertDestination({ ...base, artifactTypes: ['drawing' as never] })).toThrow(
      InvalidProviderFixtureError,
    );
    expect(() => store.upsertDestination({ ...base, destinationKind: 'usb_stick' as never })).toThrow(
      InvalidProviderFixtureError,
    );
    expect(() => store.upsertDestination({ ...base, displayName: '' })).toThrow(InvalidProviderFixtureError);
    expect(store.listDestinations()).toHaveLength(0);
  });
});

describe('table creation', () => {
  it('is idempotent (constructing the store twice on one db succeeds)', () => {
    const db = openFreshDb();
    expect(() => {
      createProviderFixtureStore(db);
      createProviderFixtureStore(db);
    }).not.toThrow();
  });
});
