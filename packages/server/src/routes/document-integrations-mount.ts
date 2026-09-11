/**
 * GQR-004 — Real mounted `/api/document-integrations` composition.
 *
 * Single composition helper used BOTH by the server entry point and by the integration
 * suite, so the tested mount is literally the production mount:
 *   - applies the additive T-003 document-integrations schema (idempotent),
 *   - composes the provider runtime (fail closed in production/plain dev; deterministic
 *     sandbox bootstrap only in test or explicitly opted-in sandbox runs),
 *   - mounts the redacted provider-admin status router, then the T-008 router.
 *
 * Namespace (PRD §12, option (a)): `/api/document-integrations` — sibling routes are NOT
 * added to the agent-native editor's `/api/documents` router.
 *
 * Fail closed: when no provider adapter is registered (production, plain development, or a
 * provider without fixtures), every provider-bearing route returns a typed
 * PROVIDER_UNAVAILABLE and write gates deny — never an invented provider.
 */

import type { Router, Request } from 'express';
import type Database from 'better-sqlite3';
import type { Phase2FlagSnapshot } from '../phase2-flags';
import { createDocumentRegistry } from '../document-providers/registry';
import { applyDocumentIntegrationsMigration } from '../document-providers/migrations';
import { createDocumentIntegrationsRepository } from '../../../db/src/document-integrations';
import { composeDocumentProviderRuntime, type ProviderRuntimeEnv } from '../document-providers/sandbox-runtime';
import { createDocumentIntegrationsRouter } from './document-integrations';
import { createProviderAdminStatusRouter } from './provider-admin-status';

export interface MountTarget {
  use: (path: string, router: Router) => void;
}

export interface MountDocumentIntegrationsOptions {
  db: Database.Database;
  env: ProviderRuntimeEnv;
  flags: Phase2FlagSnapshot;
  /** Workspace/tenant scope resolver; null fails closed at every route boundary. */
  resolveWorkspace: (req: Request) => string | null;
  logger?: Pick<Console, 'error' | 'log'>;
}

/**
 * Mount the provider-neutral document-integration API and its redacted admin status route.
 * Returns the composed provider runtime (for callers that surface runtime posture).
 *
 * Fail closed on migration failure (Bugbot 3847563963): when the additive T-003 schema cannot
 * be applied (table-name collision with an incompatible pre-existing table, or an ensure
 * failure), the routers are NOT mounted — no route may run against a missing or wrong schema
 * and surface opaque runtime failures. The rest of the server stays healthy; the feature is
 * dark and the failure is logged loudly for the operator. Crashing the whole server at boot
 * would be disproportionate for an additive, staged, flag-gated surface (R-036/R-037).
 */
export function mountDocumentIntegrations(
  app: MountTarget,
  options: MountDocumentIntegrationsOptions,
) {
  // Additive unified document schema (T-003). Safe to run repeatedly; a collision or ensure
  // failure fails the feature closed (unmounted) rather than running against a wrong schema.
  const migration = applyDocumentIntegrationsMigration(options.db);
  if (!migration.success) {
    options.logger?.error(
      '[document-integrations] T-003 additive schema not applied — /api/document-integrations ' +
        'is NOT mounted (fail closed; no route runs against a wrong schema):',
      migration.collisionCheck,
    );
    return composeDocumentProviderRuntime({
      db: options.db,
      env: options.env,
      logger: options.logger,
    });
  }
  const repository = createDocumentIntegrationsRepository(options.db);
  const registry = createDocumentRegistry(options.db);
  const runtime = composeDocumentProviderRuntime({
    db: options.db,
    env: options.env,
    logger: options.logger,
  });

  app.use(
    '/api/document-integrations/admin',
    createProviderAdminStatusRouter({
      runtime,
      db: options.db,
      resolveWorkspace: options.resolveWorkspace,
    }),
  );
  app.use(
    '/api/document-integrations',
    createDocumentIntegrationsRouter({
      registry,
      // R-026: the create path persists idempotency keys through this operation store before
      // the provider dispatch (F-001/F-002 reconciliation reads from it).
      operations: repository,
      adapters: runtime.adapters,
      policies: runtime.policies,
      destinations: runtime.destinations,
      connectionStateFor: runtime.connectionStateFor,
      flags: options.flags,
      resolveWorkspace: options.resolveWorkspace,
    }),
  );
  return runtime;
}
