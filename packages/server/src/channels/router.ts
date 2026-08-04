/**
 * THE-932 (blocker 2 + 3) — production route for the channel adapter registry.
 *
 * The runtime registry registers:
 *  - the Slack reference adapter, only behind its feature flag (offline transport
 *    by default — no production credentials); and
 *  - an email/SMTP adapter, ONLY when explicitly configured via env, constructed
 *    through `createEmailChannelAdapter` which FAILS CLOSED on plaintext SMTP
 *    AUTH at construction. An unsafe/invalid config is refused entry (never
 *    registered, never usable) before the route can serve it.
 *
 * The snapshot is public-safe (id/kind/displayName/enabled/availability) and
 * never includes credentials. Router errors are sanitized: raw exception detail
 * is logged server-side but never returned to clients.
 *
 * AUTHORITATIVE BOUNDARY: this codebase has no SMTP send client. Registration is
 * the only supported boundary; a registered email adapter honestly reports it
 * cannot deliver. Do not interpret registration as SMTP delivery capability.
 */
import { Router } from 'express';
import { createChannelAdapterRegistry, type ChannelAdapterRegistry } from './registry';
import { registerSlackReferenceAdapterIfEnabled } from './slack-reference-adapter';
import { loadEmailAdapterFromEnv, type EmailEnv } from './email-config';

export interface ChannelAdapterRouterOptions {
  /** Inject a registry (tests). Defaults to a fresh runtime registry. */
  registry?: ChannelAdapterRegistry;
}

/**
 * Build the runtime channel-adapter registry from configuration. The email
 * adapter is registered only when explicitly configured; plaintext SMTP AUTH is
 * rejected at construction and therefore never registered.
 */
export function createChannelAdapterRegistryForRuntime(
  options: { env?: EmailEnv } = {},
): ChannelAdapterRegistry {
  const env: EmailEnv = options.env ?? process.env;
  const registry = createChannelAdapterRegistry();
  // Register the Slack reference adapter only behind its feature flag (offline
  // transport by default — no production credentials).
  registerSlackReferenceAdapterIfEnabled(registry);
  // Register an email adapter ONLY when explicitly configured. Fail closed at
  // construction: a plaintext-AUTH config returns null and is never registered.
  const emailAdapter = loadEmailAdapterFromEnv(env);
  if (emailAdapter) {
    registry.register(emailAdapter);
  }
  return registry;
}

export function createChannelAdapterRouter(options: ChannelAdapterRouterOptions = {}): Router {
  const router = Router();
  const registry = options.registry ?? createChannelAdapterRegistryForRuntime();

  router.get('/', async (_req, res) => {
    try {
      const snapshot = await registry.snapshot();
      res.json(snapshot);
    } catch (error) {
      // Sanitized: log the raw detail server-side, return only a generic message
      // so internal configuration/exception detail cannot leak to clients.
      const detail = error instanceof Error ? error.message : String(error);
      console.error('[channels] failed to read channel adapters:', detail);
      res.status(500).json({ error: 'Failed to read channel adapters' });
    }
  });

  return router;
}
