/**
 * GQR-004 — Redacted provider-admin status endpoint.
 *
 * GET /api/document-integrations/admin/status returns a workspace-scoped, structurally
 * REDACTED per-provider runtime status for the DocsSettings administration surface:
 * adapter registration, connection state, effective (fail-closed) write gates, approved
 * destinations (display metadata only), and capability-honest mutation lanes.
 *
 * Redaction (structural, tested by allowlist):
 *   - Every response key belongs to a fixed vocabulary; no free-form echo of fixture rows.
 *   - Opaque provider identities (destination `externalId`) are omitted — the admin surface
 *     needs display metadata, not provider-internal identifiers.
 *   - There is no field anywhere in this response that could carry a credential: fixtures
 *     have no secret columns and the builder copies only the allowlisted leaf values.
 *
 * Honesty:
 *   - A provider without an adapter/fixture reports `unknown` connection and mutation lanes
 *     and a `disabled` effective write mode — health is never fabricated.
 *   - `effectiveWriteMode` is the fail-closed resolution (enabled + proven + admin
 *     authorized), never the stored desired mode. This is a COARSE per-provider readout for
 *     administration; the route-level resolver (write-policy.ts findGoverningPolicy with
 *     artifact-type specificity) remains authoritative per request scope.
 *   - Production/fail-closed runtimes report their truthful posture (`sandboxBootstrap:
 *     'refused'`/`'inactive'`) without touching the fixture store (no production schema reads).
 *
 * Privacy: no credentials, raw tokens, tenant secrets, document contents, or
 * operator-specific absolute paths.
 */

import { Router, type Request } from 'express';
import type Database from 'better-sqlite3';
import {
  DOCUMENT_PROVIDERS,
  type DocumentAuthState,
  type DocumentProvider,
} from '../../../db/src/document-integrations';
import type { DocumentProviderRuntime } from '../document-providers/sandbox-runtime';
import { createProviderFixtureStore } from '../document-providers/fixture-store';
import type { DocumentDestination } from '../document-providers/destinations';
import type { CapabilityState } from '../document-providers/types';
import type { ConfirmationPolicy, WriteMode } from '../document-providers/write-policy';
import { resolvedWriteMode } from '../document-providers/write-policy';

/** Mutation lanes surfaced to administration (capability-honest, from the active adapter). */
export interface ProviderAdminMutationSupport {
  agent_text_mutation: CapabilityState;
  agent_range_mutation: CapabilityState;
  agent_slide_mutation: CapabilityState;
}

/** A redacted destination record: display metadata only, never the opaque provider identity. */
export interface ProviderAdminDestinationStatus {
  id: string;
  displayName: string;
  kind: DocumentDestination['destinationKind'];
  enabled: boolean;
  artifactTypes: string[];
}

export interface ProviderAdminProviderStatus {
  adapterRegistered: boolean;
  connectionState: DocumentAuthState;
  /** Whether any policy fixture governs the workspace+provider (coarse admin readout). */
  policyConfigured: boolean;
  /** Fail-closed effective write mode — never the stored desired mode. */
  effectiveWriteMode: WriteMode;
  adminWriteAuthorized: boolean;
  writeAuthorizationProven: boolean;
  confirmationPolicy: ConfirmationPolicy | null;
  destinations: ProviderAdminDestinationStatus[];
  mutationSupport: ProviderAdminMutationSupport;
}

export interface ProviderAdminStatus {
  runtime: {
    mode: DocumentProviderRuntime['mode'];
    sandboxBootstrap: DocumentProviderRuntime['sandboxBootstrap'];
  };
  providers: Record<DocumentProvider, ProviderAdminProviderStatus>;
}

export interface ProviderAdminStatusRouterDeps {
  runtime: DocumentProviderRuntime;
  db: Database.Database;
  /** Resolve the request workspace; null fails closed with a typed WORKSPACE_REQUIRED. */
  resolveWorkspace: (req: Request) => string | null;
}

function failClosedMutationSupport(): ProviderAdminMutationSupport {
  // No adapter => no capability evidence => unknown (fail closed), never fabricated support.
  return {
    agent_text_mutation: 'unknown',
    agent_range_mutation: 'unknown',
    agent_slide_mutation: 'unknown',
  };
}

function failClosedProviderStatus(): ProviderAdminProviderStatus {
  return {
    adapterRegistered: false,
    connectionState: 'unknown',
    policyConfigured: false,
    effectiveWriteMode: 'disabled',
    adminWriteAuthorized: false,
    writeAuthorizationProven: false,
    confirmationPolicy: null,
    destinations: [],
    mutationSupport: failClosedMutationSupport(),
  };
}

/**
 * Build the redacted, workspace-scoped provider-admin status (async: adapter capability
 * reports are awaited so mutation lanes are the adapter's truthful answer, never a race).
 *
 * In sandbox mode the fixture store is read live (the activation created the tables, so the
 * read is schema-safe); fail-closed modes never touch the store and report pure defaults.
 */
export async function buildProviderAdminStatus(deps: {
  runtime: DocumentProviderRuntime;
  db: Database.Database;
  workspaceId: string;
}): Promise<ProviderAdminStatus> {
  const { runtime, db, workspaceId } = deps;
  const providers = {} as Record<DocumentProvider, ProviderAdminProviderStatus>;
  // Sandbox reads share one store handle (idempotent DDL once, not per provider).
  const store = runtime.mode === 'sandbox' ? createProviderFixtureStore(db) : null;

  for (const provider of DOCUMENT_PROVIDERS) {
    const adapter = runtime.adapters(provider);
    if (!store || !adapter) {
      // Fail-closed modes (and fixture-less providers in sandbox) report pure defaults.
      // adapterRegistered reflects the runtime truth even in fail-closed modes (always false
      // there by construction).
      providers[provider] = failClosedProviderStatus();
      continue;
    }

    // Sandbox: read this provider's authoritative fixtures for the requesting workspace.
    const connections = store!
      .listConnections()
      .filter((c) => c.enabled && c.workspaceId === workspaceId && c.provider === provider);
    const policies = store
      .listPolicies()
      .filter((p) => p.workspaceId === workspaceId && p.provider === provider);
    const destinations = store
      .listDestinations()
      .filter((d) => d.workspaceId === workspaceId && d.provider === provider);

    // Deterministic coarse readout: lowest-id rows govern (store lists are ORDER BY id).
    const connection = connections[0];
    const policy = policies[0];
    const connectionState: DocumentAuthState = connection?.authState ?? 'unknown';

    let mutationSupport = failClosedMutationSupport();
    try {
      // Capability-honest lanes from the ACTIVE adapter, under the fixture connection state.
      const report = await adapter.resolveCapabilities({
        provider,
        artifact_type: 'document',
        connectionState,
        destinationId: null,
        runtime: {},
      });
      mutationSupport = {
        agent_text_mutation: report.agent_text_mutation?.state ?? 'unknown',
        agent_range_mutation: report.agent_range_mutation?.state ?? 'unknown',
        agent_slide_mutation: report.agent_slide_mutation?.state ?? 'unknown',
      };
    } catch {
      // An adapter that cannot report capabilities leaves the lanes unknown (fail closed).
    }

    // Map the fixture row to the R-003 policy model so the fail-closed resolution is the
    // exact production predicate (enabled + proven + admin-authorized), not a lookalike.
    const effectiveWriteMode = policy
      ? resolvedWriteMode({
          workspaceId: policy.workspaceId,
          tenantId: policy.tenantId,
          connectionId: policy.connectionId,
          provider: policy.provider,
          artifactType: policy.artifactType,
          allowedDestinationIds: new Set(policy.allowedDestinationIds),
          defaultDestinationId: policy.defaultDestinationId,
          writeMode: policy.writeMode,
          confirmationPolicy: policy.confirmationPolicy,
          writeAuthorizationProven: policy.writeAuthorizationProven,
          adminWriteAuthorized: policy.adminWriteAuthorized,
          enabled: policy.enabled,
        })
      : 'disabled';

    providers[provider] = {
      adapterRegistered: true,
      connectionState,
      policyConfigured: policies.length > 0,
      effectiveWriteMode,
      adminWriteAuthorized: policy?.adminWriteAuthorized ?? false,
      writeAuthorizationProven: policy?.writeAuthorizationProven ?? false,
      confirmationPolicy: policy?.confirmationPolicy ?? null,
      destinations: destinations.map((d) => ({
        id: d.id,
        displayName: d.displayName,
        kind: d.destinationKind,
        enabled: d.enabled,
        // Redacted: externalId (opaque provider identity) is deliberately omitted.
        artifactTypes: [...d.artifactTypes].sort(),
      })),
      mutationSupport,
    };
  }

  return {
    runtime: { mode: runtime.mode, sandboxBootstrap: runtime.sandboxBootstrap },
    providers,
  };
}

export function createProviderAdminStatusRouter(deps: ProviderAdminStatusRouterDeps): Router {
  const router = Router();
  router.get('/status', (req, res) => {
    const workspaceId = deps.resolveWorkspace(req);
    if (!workspaceId) {
      return res.status(403).json({
        error: {
          code: 'WORKSPACE_REQUIRED',
          message:
            'unable to determine the request workspace; failing closed (workspace isolation).',
        },
      });
    }
    void buildProviderAdminStatus({ runtime: deps.runtime, db: deps.db, workspaceId })
      .then((status) => res.json(status))
      .catch(() =>
        res.status(500).json({
          error: { code: 'PROVIDER_UNAVAILABLE', message: 'internal provider-admin error' },
        }),
      );
    return res;
  });
  return router;
}
