/**
 * EEPC-B-01 — Public list of registered execution engines with health.
 *
 * Operator-facing surfaces must use projectPublicHealth (contract adapters)
 * and never echo raw healthCheck diagnostics (URLs, paths, secrets).
 */

import type { ProviderHealth, SwarmProvider } from './providers/interface';
import { isSwarmContractAdapter } from './providers/contract-bootstrap';
import {
  projectProviderHealth,
  redactPublicHealthMessage,
  type SwarmContractAdapter,
} from './providers/contract-adapter';
import type { ExecutionEnginePluginManifest } from './manifest/types';
import { getValidatedManifestByProvider } from './callback-intake/manifest-catalog';
import { ensureProvidersRegistered, getProvider } from './dispatcher';
import { swarmProviderRegistry } from './provider-registry';

/** Strict redaction when no validated manifest is available. */
const STRICT_PUBLIC_MANIFEST = {
  health: {
    publicFields: ['available', 'message'] as Array<'available' | 'message'>,
    privateFields: [] as string[],
    allowUrlsInPublicMessage: false,
    allowPathsInPublicMessage: false,
  },
} as unknown as ExecutionEnginePluginManifest;

/** Fail-closed public health when a provider is not contract-bound. */
export function projectLegacyPublicHealth(health: ProviderHealth): ProviderHealth {
  const projected: ProviderHealth = { available: Boolean(health.available) };
  if (typeof health.message === 'string' && health.message.trim()) {
    projected.message = redactPublicHealthMessage(health.message, STRICT_PUBLIC_MANIFEST);
  }
  return projected;
}

export async function projectPublicProviderHealth(
  provider: SwarmProvider,
): Promise<ProviderHealth> {
  if (isSwarmContractAdapter(provider)) {
    return provider.projectPublicHealth();
  }
  const raw = await provider.healthCheck();
  const manifest = getValidatedManifestByProvider(provider.name);
  if (manifest) {
    return projectProviderHealth(raw, manifest);
  }
  return projectLegacyPublicHealth(raw);
}

export interface PublicExecutionEngine {
  id: string;
  name: string;
  label: string;
  kind: 'execution-engine';
  category?: string;
  description?: string;
  capabilities?: string[];
  acceptsDispatch?: boolean;
  executionMode?: string;
  mode?: string;
  health: ProviderHealth;
}

function toPublicEngine(
  provider: SwarmProvider,
  health: ProviderHealth,
): PublicExecutionEngine {
  if (isSwarmContractAdapter(provider)) {
    const adapter = provider as SwarmContractAdapter;
    const mode = adapter.manifest.execution.mode;
    return {
      id: adapter.engineId,
      name: adapter.name,
      label: adapter.label,
      kind: 'execution-engine',
      category: adapter.manifest.identity.category,
      description: adapter.manifest.identity.description,
      capabilities: adapter.meta?.capabilities,
      acceptsDispatch: adapter.manifest.execution.acceptsDispatch,
      ...(typeof mode === 'string' ? { executionMode: mode, mode } : {}),
      health,
    };
  }

  return {
    id: `swarm.${provider.name}`,
    name: provider.name,
    label: provider.label,
    kind: 'execution-engine',
    category: provider.meta?.category,
    description: provider.meta?.description,
    capabilities: provider.meta?.capabilities,
    acceptsDispatch: provider.meta?.acceptsDispatch,
    ...(provider.meta?.executionMode
      ? { executionMode: provider.meta.executionMode, mode: provider.meta.executionMode }
      : {}),
    health,
  };
}

const LIST_HEALTH_TIMEOUT_MS = 1500;

async function projectPublicProviderHealthBounded(
  provider: SwarmProvider,
  timeoutMs = LIST_HEALTH_TIMEOUT_MS,
): Promise<ProviderHealth> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      projectPublicProviderHealth(provider),
      new Promise<ProviderHealth>((resolve) => {
        timer = setTimeout(
          () => resolve({ available: false, message: 'Health check timed out' }),
          timeoutMs,
        );
      }),
    ]);
  } catch {
    return { available: false, message: 'Health check unavailable' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * List registered execution engines with public-safe health snapshots.
 * Does not include secrets, provider config, env values, or private paths/URLs.
 */
export async function listRegisteredExecutionEngines(): Promise<PublicExecutionEngine[]> {
  ensureProvidersRegistered();
  const providers = swarmProviderRegistry.list();
  return Promise.all(
    providers.map(async (provider) => {
      const health = await projectPublicProviderHealthBounded(provider);
      return toPublicEngine(provider, health);
    }),
  );
}

/**
 * Public health for a single registered engine. Unknown names stay fail-closed.
 */
export async function getRegisteredExecutionEngineHealth(
  name: string,
): Promise<{ found: boolean; health: ProviderHealth }> {
  const provider = getProvider(name);
  if (!provider) {
    return { found: false, health: { available: false, message: `Unknown provider: ${name}` } };
  }
  try {
    return { found: true, health: await projectPublicProviderHealth(provider) };
  } catch {
    return { found: true, health: { available: false, message: 'Health check unavailable' } };
  }
}

/** Back-compat shape used by existing Swarm UI (`providers` array). */
export function toLegacyProviderListEntry(engine: PublicExecutionEngine): {
  name: string;
  label: string;
  category?: string;
  description?: string;
  capabilities?: string[];
  acceptsDispatch?: boolean;
  executionMode?: string;
  id: string;
  kind: 'execution-engine';
  mode?: string;
  health: ProviderHealth;
  meta?: {
    category?: string;
    description?: string;
    capabilities?: string[];
    acceptsDispatch?: boolean;
    executionMode?: string;
  };
} {
  return {
    id: engine.id,
    name: engine.name,
    label: engine.label,
    kind: engine.kind,
    category: engine.category,
    description: engine.description,
    capabilities: engine.capabilities,
    acceptsDispatch: engine.acceptsDispatch,
    executionMode: engine.executionMode,
    mode: engine.mode,
    health: engine.health,
    meta: {
      category: engine.category,
      description: engine.description,
      capabilities: engine.capabilities,
      acceptsDispatch: engine.acceptsDispatch,
      executionMode: engine.executionMode,
    },
  };
}
