import type { ComponentType } from 'react';
import type { PluginUIEntry } from '../../stores/pluginStore';
import EntityServicesBoard from '../EntityServicesBoard';
import SwarmBoard from '../SwarmBoard';

export interface PluginComponentProps {
  plugin: PluginUIEntry;
  apiBase?: string;
  entity?: unknown;
}

const COMPONENT_REGISTRY: Record<string, ComponentType<PluginComponentProps>> = {
  EntityServicesBoard,
  SwarmBoard,
};

export function resolvePluginComponent(name?: string): ComponentType<PluginComponentProps> | null {
  if (!name) {
    return null;
  }

  return COMPONENT_REGISTRY[name] ?? null;
}
