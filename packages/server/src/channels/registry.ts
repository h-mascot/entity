/**
 * CH-A-02 — In-memory channel adapter registry.
 *
 * Hosts may register adapters. Boot must not auto-register production
 * Slack/Telegram/Discord/email adapters. CH-A-03's Slack reference adapter
 * registers only when ENTITY_CHANNEL_SLACK_ADAPTER=1 (offline transport default).
 */

import { isChannelAdapter, type ChannelAdapter } from './adapter';
import type { ChannelAdapterAvailability, ChannelAdapterKind } from './types';

export interface ChannelAdapterRegistryEntry {
  adapter: ChannelAdapter;
  registeredAt: string;
}

export interface ChannelAdapterRegistrySnapshot {
  version: 'entity.channel-adapter.v1';
  count: number;
  adapters: Array<{
    id: string;
    kind: ChannelAdapterKind;
    displayName: string;
    enabled: boolean;
    availability: ChannelAdapterAvailability;
  }>;
}

export interface ChannelAdapterRegistry {
  register: (adapter: ChannelAdapter) => void;
  unregister: (adapterId: string) => boolean;
  get: (adapterId: string) => ChannelAdapter | undefined;
  list: () => ChannelAdapter[];
  listByKind: (kind: ChannelAdapterKind) => ChannelAdapter[];
  snapshot: () => Promise<ChannelAdapterRegistrySnapshot>;
}

export function createChannelAdapterRegistry(
  initial: ChannelAdapter[] = [],
): ChannelAdapterRegistry {
  const byId = new Map<string, ChannelAdapterRegistryEntry>();

  function register(adapter: ChannelAdapter): void {
    if (!isChannelAdapter(adapter)) {
      throw new Error('channel_adapter_invalid');
    }
    const id = adapter.id.trim();
    if (!id) {
      throw new Error('channel_adapter_id_required');
    }
    byId.set(id, {
      adapter,
      registeredAt: new Date().toISOString(),
    });
  }

  for (const adapter of initial) {
    register(adapter);
  }

  return {
    register,
    unregister(adapterId: string): boolean {
      return byId.delete(adapterId.trim());
    },
    get(adapterId: string): ChannelAdapter | undefined {
      return byId.get(adapterId.trim())?.adapter;
    },
    list(): ChannelAdapter[] {
      return [...byId.values()].map((entry) => entry.adapter);
    },
    listByKind(kind: ChannelAdapterKind): ChannelAdapter[] {
      return [...byId.values()]
        .map((entry) => entry.adapter)
        .filter((adapter) => adapter.kind === kind);
    },
    async snapshot(): Promise<ChannelAdapterRegistrySnapshot> {
      const adapters = [];
      for (const { adapter } of byId.values()) {
        adapters.push({
          id: adapter.id,
          kind: adapter.kind,
          displayName: adapter.displayName,
          enabled: adapter.enabled,
          availability: await adapter.getAvailability(),
        });
      }
      return {
        version: 'entity.channel-adapter.v1',
        count: adapters.length,
        adapters,
      };
    },
  };
}
