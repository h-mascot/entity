import { create } from 'zustand';
import { buildApiCandidates, requestJsonWithFallback, toErrorMessage } from '../lib/http';
import {
  normalizeExecutionEngineListItem,
  projectExecutionEngineHealthForUi,
  type PublicExecutionEngineListItem,
} from '../lib/executionEnginePublicHealth';

export type PluginMountPoint =
  | { type: 'top-level-tab' }
  | { type: 'module-sub-view'; module: string }
  | { type: 'detail-panel-section'; module: string }
  | { type: 'admin-section' }
  | { type: 'none' };

export interface PluginStatus {
  loaded: boolean;
  lastError?: string;
  registeredAt: string;
  routesMounted: string[];
}

export interface PluginRouteRecord {
  basePath: string;
  entry?: string;
}

export interface PluginUIEntry {
  id: string;
  name: string;
  version: string;
  kind: string;
  description: string;
  capabilities: string[];
  hooks: string[];
  enabled: boolean;
  mountPoint: PluginMountPoint;
  label: string;
  icon?: string;
  component?: string;
  settings: Record<string, unknown>;
  routes: PluginRouteRecord[];
  status: PluginStatus;
}

export interface SwarmProviderUIEntry {
  id?: string;
  name: string;
  label: string;
  kind?: 'execution-engine';
  category?: string;
  description?: string;
  capabilities?: string[];
  acceptsDispatch?: boolean;
  executionMode?: string;
  status: {
    installed: boolean;
    available: boolean;
    message?: string;
    latencyMs?: number;
  };
  repo?: {
    url: string;
    label: string;
  };
}

interface PluginStore {
  plugins: PluginUIEntry[];
  swarmProviders: SwarmProviderUIEntry[];
  loading: boolean;
  error: string | null;
  initialized: boolean;
  fetchPlugins: (apiBase?: string) => Promise<void>;
  fetchSwarmProviders: (apiBase?: string) => Promise<void>;
  togglePlugin: (id: string, apiBase?: string, enabled?: boolean) => Promise<PluginUIEntry>;
  restartPlugin: (id: string, apiBase?: string) => Promise<void>;
  restartProvider: (name: string, apiBase?: string) => Promise<void>;
  installFromGitHub: (url: string, apiBase?: string) => Promise<{ success: boolean; error?: string }>;
  getPluginsForMount: (mountType: PluginMountPoint['type'], module?: string) => PluginUIEntry[];
}

const DEFAULT_MOUNT_POINT: PluginMountPoint = { type: 'none' };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

function readObject(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) {
    return {};
  }

  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function normalizeMountPoint(value: unknown): PluginMountPoint {
  if (!isPlainObject(value)) {
    return DEFAULT_MOUNT_POINT;
  }

  const type = readString(value.type);
  if (type === 'module-sub-view' || type === 'detail-panel-section') {
    const module = readString(value.module);
    return module ? { type, module } : DEFAULT_MOUNT_POINT;
  }

  if (type === 'top-level-tab' || type === 'admin-section' || type === 'none') {
    return { type };
  }

  return DEFAULT_MOUNT_POINT;
}

function normalizeRoutes(value: unknown): PluginRouteRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!isPlainObject(entry)) {
        return null;
      }

      const basePath = readString(entry.basePath);
      if (!basePath) {
        return null;
      }

      const route: PluginRouteRecord = { basePath };
      const entryPath = readString(entry.entry);
      if (entryPath) {
        route.entry = entryPath;
      }
      return route;
    })
    .filter((entry): entry is PluginRouteRecord => entry !== null);
}

function normalizeStatus(value: unknown): PluginStatus {
  if (!isPlainObject(value)) {
    return {
      loaded: false,
      registeredAt: '',
      routesMounted: [],
    };
  }

  return {
    loaded: Boolean(value.loaded),
    lastError: readString(value.lastError) || undefined,
    registeredAt: readString(value.registeredAt),
    routesMounted: readStringArray(value.routesMounted),
  };
}

function normalizePlugin(value: unknown): PluginUIEntry | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const id = readString(value.id);
  const name = readString(value.name);
  if (!id || !name) {
    return null;
  }

  const ui = isPlainObject(value.ui) ? value.ui : null;
  const mountPoint = normalizeMountPoint(ui?.mountPoint);
  const label = readString(ui?.label) || name;
  const icon = readString(ui?.icon) || undefined;
  const component = readString(ui?.component) || undefined;

  return {
    id,
    name,
    version: readString(value.version),
    kind: readString(value.kind),
    description: readString(value.description),
    capabilities: readStringArray(value.capabilities),
    hooks: readStringArray(value.hooks),
    enabled: value.enabled !== false,
    mountPoint,
    label,
    icon,
    component,
    settings: readObject(value.settings),
    routes: normalizeRoutes(value.routes),
    status: normalizeStatus(value.status),
  };
}

function normalizePluginList(payload: unknown): PluginUIEntry[] {
  if (Array.isArray(payload)) {
    return payload.map(normalizePlugin).filter((plugin): plugin is PluginUIEntry => plugin !== null);
  }

  if (isPlainObject(payload) && Array.isArray(payload.plugins)) {
    return payload.plugins
      .map(normalizePlugin)
      .filter((plugin): plugin is PluginUIEntry => plugin !== null);
  }

  return [];
}

export function describePluginMountPoint(mountPoint: PluginMountPoint): string {
  if (mountPoint.type === 'module-sub-view') {
    return `Module sub-view · ${mountPoint.module}`;
  }

  if (mountPoint.type === 'detail-panel-section') {
    return `Detail panel section · ${mountPoint.module}`;
  }

  if (mountPoint.type === 'top-level-tab') {
    return 'Top-level tab';
  }

  if (mountPoint.type === 'admin-section') {
    return 'Admin section';
  }

  return 'Backend only';
}

export const usePluginStore = create<PluginStore>((set, get) => ({
  plugins: [],
  swarmProviders: [],
  loading: false,
  error: null,
  initialized: false,
  fetchPlugins: async (apiBase = '') => {
    set({ loading: true, error: null });
    try {
      const payload = await requestJsonWithFallback<unknown>({
        urls: buildApiCandidates('/plugins', apiBase),
        fallbackError: 'Unable to load plugins.',
      });

      set({
        plugins: normalizePluginList(payload),
        loading: false,
        error: null,
        initialized: true,
      });
    } catch (error) {
      set({
        plugins: [],
        loading: false,
        error: toErrorMessage(error, 'Unable to load plugins.'),
        initialized: true,
      });
    }
  },
  fetchSwarmProviders: async (apiBase = '') => {
    try {
      // Prefer EEPC-B-01 execution-engines list (health already public-projected).
      let engines: PublicExecutionEngineListItem[] = [];
      try {
        const enginePayload = await requestJsonWithFallback<{
          engines?: PublicExecutionEngineListItem[];
        }>({
          urls: buildApiCandidates('/swarm/execution-engines', apiBase),
          fallbackError: 'Unable to load execution engines.',
        });
        engines = enginePayload?.engines ?? [];
      } catch {
        const payload = await requestJsonWithFallback<{
          providers?: PublicExecutionEngineListItem[];
          engines?: PublicExecutionEngineListItem[];
        }>({
          urls: buildApiCandidates('/swarm/providers', apiBase),
          fallbackError: 'Unable to load swarm providers.',
        });
        engines = payload?.engines ?? payload?.providers ?? [];
      }

      // Known public repo mappings (URLs are intentional product links, not health diagnostics).
      const knownRepos: Record<string, { url: string; label: string }> = {
        'entity-plugins': { url: 'https://github.com/h-mascot/entity-plugins', label: 'entity-plugins' },
        eforge: { url: 'https://github.com/h-mascot/eforge', label: 'eforge' },
        symphony: { url: 'https://github.com/h-mascot/entity-plugin-symphony', label: 'symphony' },
        acp: { url: 'https://github.com/h-mascot/geordi', label: 'Geordi/ACP' },
      };

      const providersWithStatus: SwarmProviderUIEntry[] = engines.map((raw) => {
        const engine = normalizeExecutionEngineListItem(raw);
        const health = projectExecutionEngineHealthForUi(engine.health);
        return {
          id: engine.id,
          name: engine.name,
          label: engine.label,
          kind: 'execution-engine',
          category: engine.category,
          description: engine.description,
          capabilities: engine.capabilities,
          acceptsDispatch: engine.acceptsDispatch,
          executionMode: engine.executionMode,
          status: {
            installed: true,
            available: health.available,
            message: health.message,
            latencyMs: health.latencyMs,
          },
          repo: knownRepos[engine.name],
        };
      });

      // Add eforge binary check if not in providers
      const hasEforge = providersWithStatus.some((p) => p.name === 'eforge');
      if (!hasEforge) {
        providersWithStatus.unshift({
          name: 'eforge',
          label: 'Eforge',
          kind: 'execution-engine',
          category: 'build-system',
          description: 'Binary build system provider (eforge CLI)',
          capabilities: ['build', 'test', 'deploy'],
          status: {
            installed: false,
            available: false,
            message: 'eforge binary not found',
          },
          repo: knownRepos.eforge,
        });
      }

      set({ swarmProviders: providersWithStatus });
    } catch (error) {
      // Non-fatal: just log, don't break the store
      console.warn('Failed to fetch swarm providers:', error);
      set({ swarmProviders: [] });
    }
  },
  togglePlugin: async (id, apiBase = '', enabled) => {
    const existing = get().plugins.find((plugin) => plugin.id === id);
    if (!existing) {
      throw new Error(`Plugin "${id}" was not found`);
    }

    const payload = await requestJsonWithFallback<unknown>({
      urls: buildApiCandidates(`/plugins/${encodeURIComponent(id)}/toggle`, apiBase),
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: typeof enabled === 'boolean' ? enabled : !existing.enabled,
        }),
      },
      fallbackError: `Unable to update ${existing.name}.`,
    });

    const updated = normalizePlugin(payload);
    if (!updated) {
      throw new Error(`Server returned an invalid payload for ${existing.name}.`);
    }

    set((state) => ({
      plugins: state.plugins.map((plugin) => (plugin.id === updated.id ? updated : plugin)),
    }));

    return updated;
  },
  restartPlugin: async (id, apiBase = '') => {
    await requestJsonWithFallback<unknown>({
      urls: buildApiCandidates(`/plugins/${encodeURIComponent(id)}/restart`, apiBase),
      init: { method: 'PATCH' },
      fallbackError: `Unable to restart plugin "${id}".`,
    });
  },
  restartProvider: async (name, apiBase = '') => {
    // EEPC-B-01: "Check Health" refreshes public health only — no live mutation/restart.
    const rawHealth = await requestJsonWithFallback<{
      available?: boolean;
      message?: string;
      latencyMs?: number;
    }>({
      urls: buildApiCandidates(`/swarm/providers/${encodeURIComponent(name)}/health`, apiBase),
      fallbackError: `Unable to check health for "${name}".`,
    });
    const health = projectExecutionEngineHealthForUi({
      available: Boolean(rawHealth?.available),
      message: rawHealth?.message,
      latencyMs: rawHealth?.latencyMs,
    });
    set((state) => ({
      swarmProviders: state.swarmProviders.map((provider) =>
        provider.name === name
          ? {
              ...provider,
              status: {
                ...provider.status,
                installed: true,
                available: health.available,
                message: health.message,
                latencyMs: health.latencyMs,
              },
            }
          : provider,
      ),
    }));
  },
  installFromGitHub: async (url, apiBase = '') => {
    try {
      await requestJsonWithFallback<{ success: boolean; error?: string }>({
        urls: buildApiCandidates('/plugins/install', apiBase),
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        },
        fallbackError: 'Install from GitHub failed.',
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: toErrorMessage(error, 'Install failed') };
    }
  },
  getPluginsForMount: (mountType, module) =>
    get().plugins.filter((plugin) => {
      if (!plugin.enabled || plugin.mountPoint.type !== mountType) {
        return false;
      }

      if (plugin.mountPoint.type === 'module-sub-view' || plugin.mountPoint.type === 'detail-panel-section') {
        return plugin.mountPoint.module === module;
      }

      return true;
    }),
}));
