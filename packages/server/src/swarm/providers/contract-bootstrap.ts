/**
 * EEPC-A-04 — Manifest-driven registration of built-in Swarm providers.
 *
 * Wraps concrete adapters with createSwarmContractAdapter using EEPC-A-02
 * valid fixtures. Fail-closed: providers without a matching validated
 * manifest are not registered.
 */

import { swarmProviderRegistry } from '../provider-registry';
import { getValidatedManifestByProvider } from '../callback-intake/manifest-catalog';
import { AcpProvider } from './acp';
import { SymphonyProvider } from './symphony';
import { EforgeProvider } from './eforge';
import { CodexProvider } from './codex';
import { CcpProvider } from './ccp';
import { FlywheelProvider } from './flywheel';
import {
  createSwarmContractAdapter,
  type SwarmContractAdapter,
} from './contract-adapter';
import type { SwarmProvider } from './interface';

/** Canonical bootstrap order locked by EEPC-A-01 inventory. */
export const BUILTIN_SWARM_PROVIDER_ORDER = [
  'acp',
  'symphony',
  'eforge',
  'codex',
  'ccp',
  'flywheel',
] as const;

export type BuiltinSwarmProviderName = (typeof BUILTIN_SWARM_PROVIDER_ORDER)[number];

export interface ContractBootstrapResult {
  registered: string[];
  skipped: Array<{ name: string; reason: string }>;
  adapters: SwarmContractAdapter[];
}

function createBuiltinInner(name: BuiltinSwarmProviderName): SwarmProvider {
  switch (name) {
    case 'acp':
      return new AcpProvider();
    case 'symphony':
      return new SymphonyProvider();
    case 'eforge':
      return new EforgeProvider();
    case 'codex':
      return new CodexProvider();
    case 'ccp':
      return new CcpProvider();
    case 'flywheel':
      return new FlywheelProvider();
  }
}

/**
 * Bind and register built-in Swarm providers against validated manifests.
 * Idempotent with respect to the shared registry's duplicate-name skip.
 */
export function registerBuiltinContractProviders(
  registry: { register(provider: SwarmProvider): void } = swarmProviderRegistry,
): ContractBootstrapResult {
  const registered: string[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  const adapters: SwarmContractAdapter[] = [];

  for (const name of BUILTIN_SWARM_PROVIDER_ORDER) {
    const inner = createBuiltinInner(name);
    const manifest = getValidatedManifestByProvider(name);
    const bound = createSwarmContractAdapter(inner, manifest);
    if (!bound.ok) {
      const reason = bound.issues.map((i) => `${i.code}: ${i.message}`).join('; ');
      console.warn(`[swarm:contract] Skipping provider "${name}" — ${reason}`);
      skipped.push({ name, reason });
      continue;
    }
    registry.register(bound.adapter);
    registered.push(name);
    adapters.push(bound.adapter);
  }

  return { registered, skipped, adapters };
}

export function isSwarmContractAdapter(
  provider: SwarmProvider | undefined,
): provider is SwarmContractAdapter {
  return Boolean(
    provider &&
      typeof provider === 'object' &&
      'manifest' in provider &&
      'engineId' in provider &&
      typeof (provider as SwarmContractAdapter).projectPublicHealth === 'function',
  );
}
