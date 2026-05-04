export const PLUGIN_KINDS = ['behavior', 'integration', 'product', 'runtime', 'data-source', 'ui'] as const;

export type PluginKind = (typeof PLUGIN_KINDS)[number];

export type PluginJsonValue =
  | string
  | number
  | boolean
  | null
  | PluginJsonValue[]
  | { [key: string]: PluginJsonValue };

export type PluginSettingsRecord = Record<string, PluginJsonValue>;

export type PluginMountPoint =
  | { type: 'top-level-tab' }
  | { type: 'module-sub-view'; module: string }
  | { type: 'detail-panel-section'; module: string }
  | { type: 'admin-section' }
  | { type: 'none' };

export interface PluginUiManifest {
  mountPoint: PluginMountPoint;
  component: string;
  label: string;
  icon?: string;
}

export interface PluginRouteManifest {
  basePath: string;
  entry?: string;
}

export interface PluginStorageManifest {
  tables?: string[];
  migrationsDir?: string;
}

export interface PluginEntrypoints {
  server?: string;
  ui?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  kind: PluginKind;
  description: string;
  capabilities: string[];
  hooks: string[];
  ui?: PluginUiManifest;
  routes?: PluginRouteManifest[];
  settings?: PluginSettingsRecord;
  storage?: PluginStorageManifest;
  entrypoints?: PluginEntrypoints;
}

export interface PluginStatus {
  loaded: boolean;
  lastError?: string;
  registeredAt: string;
  routesMounted: string[];
}

export interface LoadedPlugin extends PluginManifest {
  enabled: boolean;
  settings: PluginSettingsRecord;
  manifestPath: string;
  directory: string;
  status: PluginStatus;
}

export interface PluginApiRecord extends Omit<LoadedPlugin, 'manifestPath' | 'directory'> {}
