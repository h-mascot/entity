/**
 * THE-932 (blocker 3) — production route for the channel adapter registry.
 *
 * Exposes a public-safe snapshot of registered notification channel adapters
 * (id/kind/displayName/enabled/availability). Email/SMTP adapters register via
 * `createEmailChannelAdapter`, which fails closed on plaintext SMTP AUTH at
 * construction, so an unsafe backend config can never be accepted or used. The
 * snapshot never includes credentials.
 */
import { Router } from 'express';
import { createChannelAdapterRegistry, type ChannelAdapterRegistry } from './registry';
import { registerSlackReferenceAdapterIfEnabled } from './slack-reference-adapter';

export interface ChannelAdapterRouterOptions {
  /** Inject a registry (tests). Defaults to a fresh registry with Slack-if-enabled. */
  registry?: ChannelAdapterRegistry;
}

export function createChannelAdapterRegistryForRuntime(): ChannelAdapterRegistry {
  const registry = createChannelAdapterRegistry();
  // Register the Slack reference adapter only behind its feature flag (offline
  // transport by default — no production credentials).
  registerSlackReferenceAdapterIfEnabled(registry);
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
      res.status(500).json({
        error: 'Failed to read channel adapters',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
