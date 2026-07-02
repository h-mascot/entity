import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { PluginUIEntry } from '../../stores/pluginStore';

export interface PluginComponentProps {
  plugin: PluginUIEntry;
  apiBase?: string;
  entity?: unknown;
}

type PluginComponent = ComponentType<PluginComponentProps> | LazyExoticComponent<ComponentType<PluginComponentProps>>;

const COMPONENT_REGISTRY: Record<string, PluginComponent> = {
  EntityServicesBoard: lazy(() => import('../EntityServicesBoard')),
  SwarmBoard: lazy(() => import('../SwarmBoard')),
};

export function resolvePluginComponent(name?: string): PluginComponent | null {
  if (!name) {
    return null;
  }

  return COMPONENT_REGISTRY[name] ?? null;
}
