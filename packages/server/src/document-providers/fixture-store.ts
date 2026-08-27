/**
 * GQR-004 — Authoritative sandbox fixture persistence for document providers.
 *
 * Persists and loads the sandbox runtime's authoritative connection state, write policies,
 * and destinations (ACTIVE_PLAN GQR-004 item 3). Tables follow the PRD §2083 naming
 * constraint (`document_provider_` prefix) and are created idempotently (IF NOT EXISTS) by
 * this store. The store is ONLY constructed by the test/sandbox provider bootstrap
 * (sandbox-runtime.ts), which refuses production startup — production schemas never gain
 * these tables through normal startup.
 *
 * Fail closed: invalid fixture values (unknown provider, artifact type, write mode, …) are
 * rejected with a typed error instead of being silently coerced or dropped.
 *
 * Privacy: the fixture shape carries leaf policy/destination metadata only — no credentials,
 * raw tokens, tenant secrets, or operator-specific absolute paths. There is deliberately no
 * column that could hold a secret.
 */

import Database from 'better-sqlite3';
import {
  DOCUMENT_ARTIFACT_TYPES,
  DOCUMENT_AUTH_STATES,
  DOCUMENT_PROVIDERS,
  type DocumentArtifactType,
  type DocumentAuthState,
  type DocumentProvider,
} from '../../../db/src/document-integrations';
import type { DestinationKind } from './destinations';
import type { ConfirmationPolicy, WriteMode } from './write-policy';

/** Typed rejection of an invalid fixture (fail closed, never a silent coercion). */
export class InvalidProviderFixtureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidProviderFixtureError';
  }
}

/** A persisted provider connection fixture (R-001 auth state for a workspace scope). */
export interface ProviderConnectionFixture {
  id: string;
  workspaceId: string;
  tenantId: string | null;
  provider: DocumentProvider;
  authState: DocumentAuthState;
  enabled: boolean;
}

/** A persisted write-policy fixture (R-003/T-007 logical policy row). */
export interface ProviderPolicyFixture {
  id: string;
  workspaceId: string;
  tenantId: string | null;
  connectionId: string | null;
  provider: DocumentProvider;
  artifactType: DocumentArtifactType | '*';
  allowedDestinationIds: readonly string[];
  defaultDestinationId: string | null;
  writeMode: WriteMode;
  confirmationPolicy: ConfirmationPolicy | null;
  writeAuthorizationProven: boolean;
  adminWriteAuthorized: boolean;
  enabled: boolean;
}

/** A persisted destination fixture (R-003/T-007 destination record row). */
export interface ProviderDestinationFixture {
  id: string;
  workspaceId: string;
  tenantId: string | null;
  connectionId: string | null;
  provider: DocumentProvider;
  artifactTypes: readonly DocumentArtifactType[];
  destinationKind: DestinationKind;
  externalId: string | null;
  displayName: string;
  enabled: boolean;
}

const DESTINATION_KINDS: readonly DestinationKind[] = [
  'folder',
  'shared_drive',
  'onedrive',
  'sharepoint_library',
  'local_managed_storage',
];
const WRITE_MODES: readonly WriteMode[] = ['disabled', 'create_only', 'create_and_update'];
const CONFIRMATION_POLICIES: readonly ConfirmationPolicy[] = ['required', 'auto_approve', 'not_required'];

function requireNonEmpty(value: string, field: string): string {
  if (!value || !value.trim()) {
    throw new InvalidProviderFixtureError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function requireProvider(value: string, field: string): DocumentProvider {
  const v = requireNonEmpty(value, field);
  if (!(DOCUMENT_PROVIDERS as readonly string[]).includes(v)) {
    throw new InvalidProviderFixtureError(`${field} must be one of ${DOCUMENT_PROVIDERS.join(', ')}; got ${v}`);
  }
  return v as DocumentProvider;
}

function requireArtifactType(value: string, field: string): DocumentArtifactType {
  const v = requireNonEmpty(value, field);
  if (!(DOCUMENT_ARTIFACT_TYPES as readonly string[]).includes(v)) {
    throw new InvalidProviderFixtureError(`${field} must be one of ${DOCUMENT_ARTIFACT_TYPES.join(', ')}; got ${v}`);
  }
  return v as DocumentArtifactType;
}

function parseJsonArray(raw: string, field: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.some((v) => typeof v !== 'string')) {
      throw new Error('not a string array');
    }
    return parsed as string[];
  } catch {
    throw new InvalidProviderFixtureError(`${field} stored value is not a JSON string array: ${raw}`);
  }
}

export interface ProviderFixtureStore {
  upsertConnection(fixture: ProviderConnectionFixture): void;
  listConnections(): ProviderConnectionFixture[];
  upsertPolicy(fixture: ProviderPolicyFixture): void;
  listPolicies(): ProviderPolicyFixture[];
  upsertDestination(fixture: ProviderDestinationFixture): void;
  listDestinations(): ProviderDestinationFixture[];
}

/** Create (or open) the fixture store, ensuring its additive tables exist idempotently. */
export function createProviderFixtureStore(db: Database.Database): ProviderFixtureStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS document_provider_connections (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      tenant_id TEXT,
      provider TEXT NOT NULL,
      auth_state TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS document_provider_policies (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      tenant_id TEXT,
      connection_id TEXT,
      provider TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      allowed_destination_ids TEXT NOT NULL,
      default_destination_id TEXT,
      write_mode TEXT NOT NULL,
      confirmation_policy TEXT,
      write_authorization_proven INTEGER NOT NULL DEFAULT 0,
      admin_write_authorized INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS document_provider_destinations (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      tenant_id TEXT,
      connection_id TEXT,
      provider TEXT NOT NULL,
      artifact_types TEXT NOT NULL,
      destination_kind TEXT NOT NULL,
      external_id TEXT,
      display_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
    );
  `);

  const upsertConnectionSql = db.prepare(`
    INSERT INTO document_provider_connections (id, workspace_id, tenant_id, provider, auth_state, enabled)
    VALUES (@id, @workspace_id, @tenant_id, @provider, @auth_state, @enabled)
    ON CONFLICT(id) DO UPDATE SET
      workspace_id = excluded.workspace_id,
      tenant_id = excluded.tenant_id,
      provider = excluded.provider,
      auth_state = excluded.auth_state,
      enabled = excluded.enabled
  `);
  const listConnectionsSql = db.prepare(
    'SELECT id, workspace_id, tenant_id, provider, auth_state, enabled FROM document_provider_connections ORDER BY id',
  );
  const upsertPolicySql = db.prepare(`
    INSERT INTO document_provider_policies (
      id, workspace_id, tenant_id, connection_id, provider, artifact_type, allowed_destination_ids,
      default_destination_id, write_mode, confirmation_policy, write_authorization_proven,
      admin_write_authorized, enabled
    ) VALUES (
      @id, @workspace_id, @tenant_id, @connection_id, @provider, @artifact_type, @allowed_destination_ids,
      @default_destination_id, @write_mode, @confirmation_policy, @write_authorization_proven,
      @admin_write_authorized, @enabled
    )
    ON CONFLICT(id) DO UPDATE SET
      workspace_id = excluded.workspace_id,
      tenant_id = excluded.tenant_id,
      connection_id = excluded.connection_id,
      provider = excluded.provider,
      artifact_type = excluded.artifact_type,
      allowed_destination_ids = excluded.allowed_destination_ids,
      default_destination_id = excluded.default_destination_id,
      write_mode = excluded.write_mode,
      confirmation_policy = excluded.confirmation_policy,
      write_authorization_proven = excluded.write_authorization_proven,
      admin_write_authorized = excluded.admin_write_authorized,
      enabled = excluded.enabled
  `);
  const listPoliciesSql = db.prepare(
    'SELECT id, workspace_id, tenant_id, connection_id, provider, artifact_type, allowed_destination_ids, ' +
      'default_destination_id, write_mode, confirmation_policy, write_authorization_proven, ' +
      'admin_write_authorized, enabled FROM document_provider_policies ORDER BY id',
  );
  const upsertDestinationSql = db.prepare(`
    INSERT INTO document_provider_destinations (
      id, workspace_id, tenant_id, connection_id, provider, artifact_types, destination_kind,
      external_id, display_name, enabled
    ) VALUES (
      @id, @workspace_id, @tenant_id, @connection_id, @provider, @artifact_types, @destination_kind,
      @external_id, @display_name, @enabled
    )
    ON CONFLICT(id) DO UPDATE SET
      workspace_id = excluded.workspace_id,
      tenant_id = excluded.tenant_id,
      connection_id = excluded.connection_id,
      provider = excluded.provider,
      artifact_types = excluded.artifact_types,
      destination_kind = excluded.destination_kind,
      external_id = excluded.external_id,
      display_name = excluded.display_name,
      enabled = excluded.enabled
  `);
  const listDestinationsSql = db.prepare(
    'SELECT id, workspace_id, tenant_id, connection_id, provider, artifact_types, destination_kind, ' +
      'external_id, display_name, enabled FROM document_provider_destinations ORDER BY id',
  );

  return {
    upsertConnection(fixture): void {
      const provider = requireProvider(fixture.provider, 'connection.provider');
      const authState = fixture.authState;
      if (!(DOCUMENT_AUTH_STATES as readonly string[]).includes(authState)) {
        throw new InvalidProviderFixtureError(
          `connection.authState must be one of ${DOCUMENT_AUTH_STATES.join(', ')}; got ${String(authState)}`,
        );
      }
      upsertConnectionSql.run({
        id: requireNonEmpty(fixture.id, 'connection.id'),
        workspace_id: requireNonEmpty(fixture.workspaceId, 'connection.workspaceId'),
        tenant_id: fixture.tenantId ?? null,
        provider,
        auth_state: authState,
        enabled: fixture.enabled ? 1 : 0,
      });
    },
    listConnections(): ProviderConnectionFixture[] {
      return listConnectionsSql.all().map((row: any) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        tenantId: row.tenant_id ?? null,
        provider: row.provider,
        authState: row.auth_state,
        enabled: row.enabled === 1,
      }));
    },
    upsertPolicy(fixture): void {
      const provider = requireProvider(fixture.provider, 'policy.provider');
      const artifactType =
        fixture.artifactType === '*'
          ? '*'
          : requireArtifactType(fixture.artifactType, 'policy.artifactType');
      if (!(WRITE_MODES as readonly string[]).includes(fixture.writeMode)) {
        throw new InvalidProviderFixtureError(
          `policy.writeMode must be one of ${WRITE_MODES.join(', ')}; got ${String(fixture.writeMode)}`,
        );
      }
      if (
        fixture.confirmationPolicy !== null &&
        !(CONFIRMATION_POLICIES as readonly string[]).includes(fixture.confirmationPolicy)
      ) {
        throw new InvalidProviderFixtureError(
          `policy.confirmationPolicy must be one of ${CONFIRMATION_POLICIES.join(', ')} or null; ` +
            `got ${String(fixture.confirmationPolicy)}`,
        );
      }
      for (const id of fixture.allowedDestinationIds) {
        requireNonEmpty(id, 'policy.allowedDestinationIds[]');
      }
      upsertPolicySql.run({
        id: requireNonEmpty(fixture.id, 'policy.id'),
        workspace_id: requireNonEmpty(fixture.workspaceId, 'policy.workspaceId'),
        tenant_id: fixture.tenantId ?? null,
        connection_id: fixture.connectionId ?? null,
        provider,
        artifact_type: artifactType,
        allowed_destination_ids: JSON.stringify([...fixture.allowedDestinationIds]),
        default_destination_id: fixture.defaultDestinationId ?? null,
        write_mode: fixture.writeMode,
        confirmation_policy: fixture.confirmationPolicy ?? null,
        write_authorization_proven: fixture.writeAuthorizationProven ? 1 : 0,
        admin_write_authorized: fixture.adminWriteAuthorized ? 1 : 0,
        enabled: fixture.enabled ? 1 : 0,
      });
    },
    listPolicies(): ProviderPolicyFixture[] {
      return listPoliciesSql.all().map((row: any) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        tenantId: row.tenant_id ?? null,
        connectionId: row.connection_id ?? null,
        provider: row.provider,
        artifactType: row.artifact_type === '*' ? '*' : (row.artifact_type as DocumentArtifactType),
        allowedDestinationIds: parseJsonArray(row.allowed_destination_ids, 'policy.allowedDestinationIds'),
        defaultDestinationId: row.default_destination_id ?? null,
        writeMode: row.write_mode as WriteMode,
        confirmationPolicy: (row.confirmation_policy ?? null) as ConfirmationPolicy | null,
        writeAuthorizationProven: row.write_authorization_proven === 1,
        adminWriteAuthorized: row.admin_write_authorized === 1,
        enabled: row.enabled === 1,
      }));
    },
    upsertDestination(fixture): void {
      const provider = requireProvider(fixture.provider, 'destination.provider');
      if (fixture.artifactTypes.length === 0) {
        throw new InvalidProviderFixtureError('destination.artifactTypes must not be empty');
      }
      const artifactTypes = fixture.artifactTypes.map((t) =>
        requireArtifactType(t, 'destination.artifactTypes[]'),
      );
      if (!(DESTINATION_KINDS as readonly string[]).includes(fixture.destinationKind)) {
        throw new InvalidProviderFixtureError(
          `destination.destinationKind must be one of ${DESTINATION_KINDS.join(', ')}; ` +
            `got ${String(fixture.destinationKind)}`,
        );
      }
      upsertDestinationSql.run({
        id: requireNonEmpty(fixture.id, 'destination.id'),
        workspace_id: requireNonEmpty(fixture.workspaceId, 'destination.workspaceId'),
        tenant_id: fixture.tenantId ?? null,
        connection_id: fixture.connectionId ?? null,
        provider,
        artifact_types: JSON.stringify(artifactTypes),
        destination_kind: fixture.destinationKind,
        external_id: fixture.externalId ?? null,
        display_name: requireNonEmpty(fixture.displayName, 'destination.displayName'),
        enabled: fixture.enabled ? 1 : 0,
      });
    },
    listDestinations(): ProviderDestinationFixture[] {
      return listDestinationsSql.all().map((row: any) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        tenantId: row.tenant_id ?? null,
        connectionId: row.connection_id ?? null,
        provider: row.provider,
        artifactTypes: parseJsonArray(row.artifact_types, 'destination.artifactTypes').map(
          (t) => t as DocumentArtifactType,
        ),
        destinationKind: row.destination_kind as DestinationKind,
        externalId: row.external_id ?? null,
        displayName: row.display_name,
        enabled: row.enabled === 1,
      }));
    },
  };
}
