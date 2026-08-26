/**
 * GQR-004 — Test/sandbox-only deterministic provider runtime composition.
 *
 * The bootstrap composes the deterministic fake provider adapter (T-005) into the real
 * `/api/document-integrations` dependency shape (registry adapters / R-003 policies /
 * destinations / connection state), loading every input from the authoritative fixture
 * store (fixture-store.ts). It is bootable ONLY in test or explicitly opted-in sandbox
 * runs and REFUSES production startup with a typed error (fail closed — a fake provider
 * must never silently serve a production deployment, even if the sandbox flag is set).
 *
 * Run modes (resolveProviderRuntimeMode):
 *   - production: NODE_ENV === 'production'. Never sandbox-active. Explicit sandbox flag
 *     => the composed runtime reports `sandboxBootstrap: 'refused'` and stays fail closed.
 *   - sandbox-active: NODE_ENV === 'test' (the deterministic test runner mode) OR
 *     NODE_ENV !== 'production' with ENTITY_DOCUMENT_PROVIDER_SANDBOX === '1'.
 *   - inactive: everything else (plain development default — fail closed, no fake providers).
 *
 * Determinism: the fake adapter's clock defaults to its fixed constant; no network, no
 * wall-clock dependence, no uncontrolled randomness.
 *
 * Privacy: fixtures carry leaf policy/destination metadata only; no credentials, raw
 * tokens, tenant secrets, or operator-specific absolute paths anywhere in this module.
 */

import type Database from 'better-sqlite3';
import type { DocumentAuthState, DocumentProvider } from '../../../db/src/document-integrations';
import { createFakeDocumentProviderAdapter } from './fake-adapter';
import { createProviderFixtureStore } from './fixture-store';
import type { DocumentDestination } from './destinations';
import type { DocumentProviderAdapter } from './types';
import type { WritePolicy, WriteRequestScope } from './write-policy';

export type ProviderRuntimeEnv = Record<string, string | undefined>;

/** Typed refusal: the sandbox bootstrap may not run outside test/sandbox modes. */
export class SandboxProviderRuntimeRefusedError extends Error {
  readonly reason: 'production_startup_refused' | 'sandbox_not_enabled';

  constructor(reason: ProviderRuntimeRefusalReason, detail: string) {
    super(`SANDBOX_PROVIDER_RUNTIME_REFUSED (${reason}): ${detail}`);
    this.name = 'SandboxProviderRuntimeRefusedError';
    this.reason = reason;
  }
}

export type ProviderRuntimeRefusalReason = 'production_startup_refused' | 'sandbox_not_enabled';

export type ProviderRuntimeMode =
  | { kind: 'production'; sandboxRequested: boolean }
  | { kind: 'sandbox-active'; via: 'node_env_test' | 'sandbox_flag' }
  | { kind: 'inactive' };

/** Resolve the provider runtime mode from the environment (pure; no I/O). */
export function resolveProviderRuntimeMode(env: ProviderRuntimeEnv): ProviderRuntimeMode {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const sandboxRequested = env.ENTITY_DOCUMENT_PROVIDER_SANDBOX === '1';
  if (nodeEnv === 'production') {
    return { kind: 'production', sandboxRequested };
  }
  if (nodeEnv === 'test') {
    return { kind: 'sandbox-active', via: 'node_env_test' };
  }
  if (sandboxRequested) {
    return { kind: 'sandbox-active', via: 'sandbox_flag' };
  }
  return { kind: 'inactive' };
}

/** The composed provider runtime dependency shape consumed by the T-008 router mount. */
export interface DocumentProviderRuntime {
  /** 'sandbox' when fake providers are booted; otherwise the fail-closed run mode. */
  readonly mode: 'sandbox' | 'production' | 'inactive';
  /**
   * Truthful bootstrap posture: 'active' (fakes booted), 'inactive' (not requested /
   * not eligible), or 'refused' (explicitly requested in production — fail closed).
   */
  readonly sandboxBootstrap: 'active' | 'inactive' | 'refused';
  /** Provider adapter selector; undefined for every provider when fail closed. */
  adapters(provider: string): DocumentProviderAdapter | undefined;
  /** R-003 write policies (empty when fail closed). */
  readonly policies: readonly WritePolicy[];
  /** R-003 destination records (empty when fail closed). */
  readonly destinations: readonly DocumentDestination[];
  /** Authenticated connection state from authoritative fixtures; undefined = unknown (fail closed). */
  connectionStateFor(scope: WriteRequestScope): DocumentAuthState | undefined;
}

function mapPolicyFixture(store: ReturnType<typeof createProviderFixtureStore>): WritePolicy[] {
  return store.listPolicies().map((row) => ({
    workspaceId: row.workspaceId,
    tenantId: row.tenantId,
    connectionId: row.connectionId,
    provider: row.provider,
    artifactType: row.artifactType,
    allowedDestinationIds: new Set(row.allowedDestinationIds),
    defaultDestinationId: row.defaultDestinationId,
    writeMode: row.writeMode,
    confirmationPolicy: row.confirmationPolicy,
    writeAuthorizationProven: row.writeAuthorizationProven,
    adminWriteAuthorized: row.adminWriteAuthorized,
    enabled: row.enabled,
  }));
}

function mapDestinationFixtures(
  store: ReturnType<typeof createProviderFixtureStore>,
): DocumentDestination[] {
  return store.listDestinations().map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    tenantId: row.tenantId,
    connectionId: row.connectionId,
    provider: row.provider,
    artifactTypes: new Set(row.artifactTypes),
    destinationKind: row.destinationKind,
    externalId: row.externalId,
    displayName: row.displayName,
    enabled: row.enabled,
  }));
}

export interface SandboxDocumentProvidersOptions {
  db: Database.Database;
  env: ProviderRuntimeEnv;
  /** Optional logger; the bootstrap never throws on logging, only on mode refusal. */
  logger?: Pick<Console, 'error' | 'log'>;
}

/**
 * The test/sandbox-only deterministic provider bootstrap.
 *
 * Loads the authoritative fixtures (connections, policies, destinations) from the store and
 * composes the fake adapter per provider WITH an enabled connection fixture. Throws
 * SandboxProviderRuntimeRefusedError for production (always) and for runs that have not
 * opted into the sandbox — the fake provider is never quietly active.
 */
export function activateSandboxDocumentProviders(
  options: SandboxDocumentProvidersOptions,
): DocumentProviderRuntime {
  const mode = resolveProviderRuntimeMode(options.env);
  if (mode.kind === 'production') {
    throw new SandboxProviderRuntimeRefusedError(
      'production_startup_refused',
      'the deterministic sandbox provider bootstrap refuses production startup; ' +
        'fake providers are test/sandbox-only (fail closed).',
    );
  }
  if (mode.kind === 'inactive') {
    throw new SandboxProviderRuntimeRefusedError(
      'sandbox_not_enabled',
      'the deterministic provider bootstrap only runs in test mode or with ' +
        'ENTITY_DOCUMENT_PROVIDER_SANDBOX=1 in a non-production run (fail closed).',
    );
  }

  const store = createProviderFixtureStore(options.db);
  const connections = store.listConnections();
  const policies = mapPolicyFixture(store);
  const destinations = mapDestinationFixtures(store);

  // One fake adapter per provider that has at least one ENABLED connection fixture. When
  // several enabled fixtures exist for a provider, the lowest id wins deterministically
  // (stable ORDER BY id in the store) and its auth state seeds the adapter.
  const adapters = new Map<DocumentProvider, DocumentProviderAdapter>();
  for (const provider of new Set(connections.filter((c) => c.enabled).map((c) => c.provider))) {
    const governing = connections
      .filter((c) => c.enabled && c.provider === provider)
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    adapters.set(
      provider,
      createFakeDocumentProviderAdapter({ provider, connectionState: governing.authState }),
    );
  }

  const connectionFixtures = connections.filter((c) => c.enabled);

  return {
    mode: 'sandbox',
    sandboxBootstrap: 'active',
    adapters: (provider: string) => adapters.get(provider as DocumentProvider),
    policies,
    destinations,
    connectionStateFor(scope: WriteRequestScope): DocumentAuthState | undefined {
      // Authoritative connection state for the exact workspace/tenant/provider scope. A
      // fixture matches when its connection id equals the scope's, or when the scope carries
      // no connection id (the fake adapter's descriptors use null). Deterministic lowest-id
      // match; no match => undefined => 'unknown' upstream (fail closed).
      const matches = connectionFixtures.filter(
        (c) =>
          c.workspaceId === scope.workspaceId &&
          c.tenantId === scope.tenantId &&
          c.provider === scope.provider &&
          (scope.connectionId == null || scope.connectionId === c.id),
      );
      if (matches.length === 0) {
        return undefined;
      }
      return matches.sort((a, b) => a.id.localeCompare(b.id))[0].authState;
    },
  };
}

function failClosedRuntime(
  mode: 'production' | 'inactive',
  sandboxBootstrap: 'inactive' | 'refused',
): DocumentProviderRuntime {
  return {
    mode,
    sandboxBootstrap,
    adapters: () => undefined,
    policies: [],
    destinations: [],
    connectionStateFor: () => undefined,
  };
}

/**
 * Compose the provider runtime for a server process. NEVER activates the fake providers in
 * production: an explicit sandbox request in production is reported as `refused` (and logged
 * loudly) while the runtime stays fail closed; plain development defaults to fail-closed
 * `inactive`; test/sandbox runs activate the deterministic bootstrap.
 */
export function composeDocumentProviderRuntime(
  options: SandboxDocumentProvidersOptions,
): DocumentProviderRuntime {
  const mode = resolveProviderRuntimeMode(options.env);
  if (mode.kind === 'production') {
    if (mode.sandboxRequested) {
      options.logger?.error(
        '[document-providers] refusing sandbox bootstrap in production; staying fail closed ' +
          '(typed status: sandboxBootstrap=refused).',
      );
      return failClosedRuntime('production', 'refused');
    }
    return failClosedRuntime('production', 'inactive');
  }
  if (mode.kind === 'inactive') {
    return failClosedRuntime('inactive', 'inactive');
  }
  return activateSandboxDocumentProviders(options);
}
