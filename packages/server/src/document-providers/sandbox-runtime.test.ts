/**
 * GQR-004 — Test/sandbox-only deterministic provider bootstrap.
 *
 * Contract under test (ACTIVE_PLAN GQR-004 item 1 + 3):
 *   - The deterministic fake provider bootstrap is bootable ONLY in test/sandbox run modes.
 *   - It REFUSES production startup with a typed error (fail closed, never silently inactive).
 *   - Connection state, write policies, and destinations are PERSISTED and LOADED as the
 *     authoritative sandbox fixture source (no hardcoded in-test composition arrays).
 *
 * Determinism: no network, no wall clock, no uncontrolled randomness. Every fixture is written
 * through the fixture store and read back through the bootstrap.
 *
 * Privacy: no credentials, raw tokens, tenant secrets, or operator-specific paths in fixtures.
 */

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import {
  activateSandboxDocumentProviders,
  composeDocumentProviderRuntime,
  resolveProviderRuntimeMode,
  SandboxProviderRuntimeRefusedError,
} from './sandbox-runtime';
import { createProviderFixtureStore } from './fixture-store';

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

/** Seed the authoritative sandbox fixtures for workspace ws_A: connection + destination + policy. */
function seedGoogleWorkspaceFixtures(db: Database.Database): void {
  const store = createProviderFixtureStore(db);
  store.upsertConnection({
    id: 'conn-google-a',
    workspaceId: 'ws_A',
    tenantId: null,
    provider: 'google_workspace',
    authState: 'authorized',
    enabled: true,
  });
  store.upsertDestination({
    id: 'dest_1',
    workspaceId: 'ws_A',
    tenantId: null,
    connectionId: 'conn-google-a',
    provider: 'google_workspace',
    artifactTypes: ['document'],
    destinationKind: 'folder',
    externalId: 'folder-q3',
    displayName: 'Q3 Plans folder',
    enabled: true,
  });
  store.upsertPolicy({
    id: 'pol-google-a',
    workspaceId: 'ws_A',
    tenantId: null,
    connectionId: 'conn-google-a',
    provider: 'google_workspace',
    artifactType: '*',
    allowedDestinationIds: ['dest_1'],
    defaultDestinationId: 'dest_1',
    writeMode: 'create_and_update',
    confirmationPolicy: null,
    writeAuthorizationProven: true,
    adminWriteAuthorized: true,
    enabled: true,
  });
}

describe('provider runtime mode resolution', () => {
  it('classifies production, test, sandbox-opted dev, and plain dev deterministically', () => {
    expect(resolveProviderRuntimeMode({ NODE_ENV: 'production' })).toMatchObject({ kind: 'production' });
    expect(resolveProviderRuntimeMode({ NODE_ENV: 'test' })).toMatchObject({ kind: 'sandbox-active' });
    expect(
      resolveProviderRuntimeMode({ NODE_ENV: 'development', ENTITY_DOCUMENT_PROVIDER_SANDBOX: '1' }),
    ).toMatchObject({ kind: 'sandbox-active' });
    expect(resolveProviderRuntimeMode({ NODE_ENV: 'development' })).toMatchObject({ kind: 'inactive' });
    expect(resolveProviderRuntimeMode({})).toMatchObject({ kind: 'inactive' });
  });

  it('never lets the sandbox flag promote production', () => {
    expect(
      resolveProviderRuntimeMode({ NODE_ENV: 'production', ENTITY_DOCUMENT_PROVIDER_SANDBOX: '1' }),
    ).toMatchObject({ kind: 'production' });
  });
});

describe('sandbox bootstrap production refusal', () => {
  it('refuses production startup with a typed error even when the sandbox flag is set', () => {
    const db = openFreshDb();
    seedGoogleWorkspaceFixtures(db);
    expect(() =>
      activateSandboxDocumentProviders({ db, env: { NODE_ENV: 'production' } }),
    ).toThrow(SandboxProviderRuntimeRefusedError);
    expect(() =>
      activateSandboxDocumentProviders({
        db,
        env: { NODE_ENV: 'production', ENTITY_DOCUMENT_PROVIDER_SANDBOX: '1' },
      }),
    ).toThrow(/production/);
  });

  it('refuses plain development without the explicit sandbox opt-in', () => {
    const db = openFreshDb();
    seedGoogleWorkspaceFixtures(db);
    expect(() =>
      activateSandboxDocumentProviders({ db, env: { NODE_ENV: 'development' } }),
    ).toThrow(SandboxProviderRuntimeRefusedError);
  });
});

describe('sandbox bootstrap in test mode', () => {
  it('boots the fake provider from persisted fixtures as the authoritative composition source', () => {
    const db = openFreshDb();
    seedGoogleWorkspaceFixtures(db);
    const runtime = activateSandboxDocumentProviders({ db, env: { NODE_ENV: 'test' } });

    expect(runtime.mode).toBe('sandbox');
    expect(runtime.sandboxBootstrap).toBe('active');

    const adapter = runtime.adapters('google_workspace');
    expect(adapter).toBeDefined();
    expect(adapter?.provider).toBe('google_workspace');

    // Policies load from the store with set semantics intact.
    expect(runtime.policies).toHaveLength(1);
    expect(runtime.policies[0].workspaceId).toBe('ws_A');
    expect(runtime.policies[0].allowedDestinationIds.has('dest_1')).toBe(true);
    expect(runtime.policies[0].writeMode).toBe('create_and_update');
    expect(runtime.policies[0].writeAuthorizationProven).toBe(true);
    expect(runtime.policies[0].adminWriteAuthorized).toBe(true);

    // Destinations load from the store with set semantics intact.
    expect(runtime.destinations).toHaveLength(1);
    expect(runtime.destinations[0].artifactTypes.has('document')).toBe(true);
    expect(runtime.destinations[0].displayName).toBe('Q3 Plans folder');

    // Connection state is derived from the persisted fixture, fail closed for other scopes.
    expect(
      runtime.connectionStateFor({
        workspaceId: 'ws_A',
        tenantId: null,
        provider: 'google_workspace',
        artifactType: 'document',
        connectionId: null,
        destinationId: 'dest_1',
      }),
    ).toBe('authorized');
    expect(
      runtime.connectionStateFor({
        workspaceId: 'ws_B',
        tenantId: null,
        provider: 'google_workspace',
        artifactType: 'document',
        connectionId: null,
        destinationId: null,
      }),
    ).toBeUndefined();
  });

  it('fails closed for providers without a persisted connection fixture', () => {
    const db = openFreshDb();
    seedGoogleWorkspaceFixtures(db);
    const runtime = activateSandboxDocumentProviders({ db, env: { NODE_ENV: 'test' } });
    expect(runtime.adapters('microsoft_365')).toBeUndefined();
    expect(runtime.adapters('local_office')).toBeUndefined();
    expect(runtime.adapters('not-a-provider')).toBeUndefined();
  });

  it('reloads fixtures from the store on each activation (persisted state is authoritative)', () => {
    const db = openFreshDb();
    seedGoogleWorkspaceFixtures(db);
    const first = activateSandboxDocumentProviders({ db, env: { NODE_ENV: 'test' } });
    expect(first.adapters('microsoft_365')).toBeUndefined();

    const store = createProviderFixtureStore(db);
    store.upsertConnection({
      id: 'conn-msft-a',
      workspaceId: 'ws_A',
      tenantId: null,
      provider: 'microsoft_365',
      authState: 'degraded',
      enabled: true,
    });

    const second = activateSandboxDocumentProviders({ db, env: { NODE_ENV: 'test' } });
    expect(second.adapters('microsoft_365')).toBeDefined();
    expect(second.adapters('microsoft_365')?.provider).toBe('microsoft_365');
  });

  it('boots in sandbox-opted development exactly like test mode', () => {
    const db = openFreshDb();
    seedGoogleWorkspaceFixtures(db);
    const runtime = activateSandboxDocumentProviders({
      db,
      env: { NODE_ENV: 'development', ENTITY_DOCUMENT_PROVIDER_SANDBOX: '1' },
    });
    expect(runtime.mode).toBe('sandbox');
    expect(runtime.adapters('google_workspace')).toBeDefined();
  });
});

describe('composed runtime fail-closed modes', () => {
  it('stays fail closed in plain development and reports the bootstrap as inactive', () => {
    const db = openFreshDb();
    seedGoogleWorkspaceFixtures(db);
    const runtime = composeDocumentProviderRuntime({ db, env: { NODE_ENV: 'development' } });
    expect(runtime.mode).toBe('inactive');
    expect(runtime.sandboxBootstrap).toBe('inactive');
    expect(runtime.adapters('google_workspace')).toBeUndefined();
    expect(runtime.policies).toHaveLength(0);
    expect(runtime.destinations).toHaveLength(0);
  });

  it('refuses (fail closed, typed status) when the sandbox flag is set in production', () => {
    const db = openFreshDb();
    seedGoogleWorkspaceFixtures(db);
    const runtime = composeDocumentProviderRuntime({
      db,
      env: { NODE_ENV: 'production', ENTITY_DOCUMENT_PROVIDER_SANDBOX: '1' },
    });
    expect(runtime.mode).toBe('production');
    expect(runtime.sandboxBootstrap).toBe('refused');
    expect(runtime.adapters('google_workspace')).toBeUndefined();
    expect(runtime.policies).toHaveLength(0);
    expect(runtime.destinations).toHaveLength(0);
  });
});
