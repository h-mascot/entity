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
 */
export function mountDocumentIntegrations(
  app: MountTarget,
  options: MountDocumentIntegrationsOptions,
) {
  // Additive unified document schema (T-003). Safe to run repeatedly; collisions are logged
  // loudly and the routers still surface typed errors at the route boundary.
  const migration = applyDocumentIntegrationsMigration(options.db);
  if (!migration.success) {
    options.logger?.error(
      '[document-integrations] T-003 additive schema not applied:',
      migration.collisionCheck,
    );
  }
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
