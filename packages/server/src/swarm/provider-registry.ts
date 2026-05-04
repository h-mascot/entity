/**
 * Geordi Swarm — Provider Registry (Singleton)
 * Providers call swarmProviderRegistry.register(provider) in their registerPlugin() hook.
 * The dispatcher reads from this registry instead of hardcoding provider imports.
 */
import type { SwarmProvider } from './providers/interface';

class SwarmProviderRegistry {
  private providers: Map<string, SwarmProvider> = new Map();

  register(provider: SwarmProvider): void {
    if (this.providers.has(provider.name)) {
      console.warn(`[swarm:registry] Provider "${provider.name}" already registered, skipping`);
      return;
    }
    this.providers.set(provider.name, provider);
    console.log(`[swarm:registry] Registered provider: ${provider.name}`);
  }

  get(name: string): SwarmProvider | undefined {
    return this.providers.get(name);
  }

  list(): SwarmProvider[] {
    return Array.from(this.providers.values());
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  get size(): number {
    return this.providers.size;
  }
}

export const swarmProviderRegistry = new SwarmProviderRegistry();
