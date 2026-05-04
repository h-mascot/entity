import fs from 'fs';
import path from 'path';
import express from 'express';
import type Database from 'better-sqlite3';
import type { PluginHookEmitter } from './hooks';
import {
  PLUGIN_KINDS,
  type LoadedPlugin,
  type PluginApiRecord,
  type PluginEntrypoints,
  type PluginJsonValue,
  type PluginManifest,
  type PluginMountPoint,
  type PluginRouteManifest,
  type PluginSettingsRecord,
  type PluginStorageManifest,
  type PluginUiManifest,
} from './types';

const PLUGIN_KIND_SET = new Set<string>(PLUGIN_KINDS);

export interface PluginRegistryOptions {
  db: Database.Database;
  pluginsDir?: string;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  configPluginSettings?: Record<string, PluginSettingsRecord>;
}

export interface PluginRuntimeContext {
  app: express.Express;
  db: Database.Database;
  hooks: PluginHookEmitter;
  logger: Pick<Console, 'info' | 'warn' | 'error'>;
  plugin: LoadedPlugin;
  registry: PluginRegistry;
  workspaceRoot: string;
}

export interface PluginRouteContext extends PluginRuntimeContext {
  router: express.Router;
}

interface PluginServerModule {
  registerPlugin?: (context: PluginRuntimeContext) => void | Promise<void>;
  default?: (context: PluginRuntimeContext) => void | Promise<void>;
}

interface PluginRouteModule {
  registerPluginRoutes?: (router: express.Router, context: PluginRouteContext) => void | Promise<void>;
  default?: (router: express.Router, context: PluginRouteContext) => void | Promise<void>;
}

interface PluginSettingsRow {
  enabled: boolean;
  settings: PluginSettingsRecord;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asPlainObject(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} cannot be empty`);
  }

  return trimmed;
}

function readOptionalString(value: unknown, label: string): string | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }

  return readRequiredString(value, label);
}

function readStringArray(value: unknown, label: string, allowEmpty = true): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }

  const items = value.map((entry, index) => readRequiredString(entry, `${label}[${index}]`));
  if (!allowEmpty && items.length === 0) {
    throw new Error(`${label} cannot be empty`);
  }

  return items;
}

function toPluginJsonValue(value: unknown, label: string): PluginJsonValue {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => toPluginJsonValue(entry, `${label}[${index}]`));
  }

  if (isPlainObject(value)) {
    const record: Record<string, PluginJsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      record[key] = toPluginJsonValue(entry, `${label}.${key}`);
    }
    return record;
  }

  throw new Error(`${label} must be valid JSON data`);
}

function toSettingsRecord(value: unknown, label: string): PluginSettingsRecord {
  if (typeof value === 'undefined') {
    return {};
  }

  const record = asPlainObject(value, label);
  const normalized: PluginSettingsRecord = {};
  for (const [key, entry] of Object.entries(record)) {
    normalized[key] = toPluginJsonValue(entry, `${label}.${key}`);
  }
  return normalized;
}

function cloneSettingsRecord(value: PluginSettingsRecord | undefined): PluginSettingsRecord {
  if (!value) {
    return {};
  }

  return JSON.parse(JSON.stringify(value)) as PluginSettingsRecord;
}

function normalizeMountPoint(value: unknown): PluginMountPoint {
  const mountPoint = asPlainObject(value, 'ui.mountPoint');
  const type = readRequiredString(mountPoint.type, 'ui.mountPoint.type');

  if (type === 'module-sub-view' || type === 'detail-panel-section') {
    return {
      type,
      module: readRequiredString(mountPoint.module, 'ui.mountPoint.module'),
    };
  }

  if (type === 'top-level-tab' || type === 'admin-section' || type === 'none') {
    return { type };
  }

  throw new Error(`ui.mountPoint.type "${type}" is not supported`);
}

function normalizeUiManifest(value: unknown): PluginUiManifest | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }

  const ui = asPlainObject(value, 'ui');
  return {
    mountPoint: normalizeMountPoint(ui.mountPoint),
    component: readRequiredString(ui.component, 'ui.component'),
    label: readRequiredString(ui.label, 'ui.label'),
    icon: readOptionalString(ui.icon, 'ui.icon'),
  };
}

function normalizeRouteManifest(value: unknown, index: number): PluginRouteManifest {
  const route = asPlainObject(value, `routes[${index}]`);
  const basePath = readRequiredString(route.basePath, `routes[${index}].basePath`);
  if (!basePath.startsWith('/api/')) {
    throw new Error(`routes[${index}].basePath must start with "/api/"`);
  }

  return {
    basePath,
    entry: readOptionalString(route.entry, `routes[${index}].entry`),
  };
}

function normalizeStorageManifest(value: unknown): PluginStorageManifest | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }

  const storage = asPlainObject(value, 'storage');
  const tables = typeof storage.tables === 'undefined'
    ? undefined
    : readStringArray(storage.tables, 'storage.tables');
  const migrationsDir = readOptionalString(storage.migrationsDir, 'storage.migrationsDir');

  return {
    tables,
    migrationsDir,
  };
}

function normalizeEntrypoints(value: unknown): PluginEntrypoints | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }

  const entrypoints = asPlainObject(value, 'entrypoints');
  return {
    server: readOptionalString(entrypoints.server, 'entrypoints.server'),
    ui: readOptionalString(entrypoints.ui, 'entrypoints.ui'),
  };
}

function mergeSettings(defaults: PluginSettingsRecord, overrides: PluginSettingsRecord): PluginSettingsRecord {
  return {
    ...cloneSettingsRecord(defaults),
    ...cloneSettingsRecord(overrides),
  };
}

function parseStoredSettings(value: unknown): PluginSettingsRecord {
  if (typeof value !== 'string' || !value.trim()) {
    return {};
  }

  try {
    return toSettingsRecord(JSON.parse(value) as unknown, 'plugin_settings.settings_json');
  } catch {
    return {};
  }
}

function modulePathToDistCandidate(modulePath: string): string | null {
  const normalized = modulePath.split(path.sep).join('/');
  const sourceMarker = '/packages/server/src/';
  if (!normalized.includes(sourceMarker)) {
    return null;
  }

  const distPath = normalized.replace(sourceMarker, '/packages/server/dist/server/src/').replace(/\.(ts|tsx)$/, '.js');
  return path.normalize(distPath);
}

function uniqueCandidates(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function directoryHasPluginManifest(directory: string): boolean {
  try {
    return fs.readdirSync(directory, { withFileTypes: true }).some((entry) => {
      if (!entry.isDirectory()) {
        return false;
      }
      return fs.existsSync(path.join(directory, entry.name, 'plugin.json'));
    });
  } catch {
    return false;
  }
}

export function resolvePluginsDirectory(explicitDir?: string): string {
  const candidates = uniqueCandidates([
    explicitDir ? path.resolve(explicitDir) : null,
    path.resolve(process.cwd(), 'packages/server/src/plugins'),
    path.resolve(process.cwd(), 'src/plugins'),
    path.resolve(__dirname, '../../../../src/plugins'),
    __dirname,
  ]);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && directoryHasPluginManifest(candidate)) {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0] ?? path.resolve(process.cwd(), 'packages/server/src/plugins');
}

export function parsePluginManifest(raw: unknown, options: { directory: string; manifestPath: string }): PluginManifest {
  const record = asPlainObject(raw, options.manifestPath);
  const kind = readRequiredString(record.kind, 'kind');
  if (!PLUGIN_KIND_SET.has(kind)) {
    throw new Error(`kind "${kind}" is not supported`);
  }

  return {
    id: readRequiredString(record.id, 'id'),
    name: readRequiredString(record.name, 'name'),
    version: readRequiredString(record.version, 'version'),
    kind: kind as PluginManifest['kind'],
    description: readRequiredString(record.description, 'description'),
    capabilities: readStringArray(record.capabilities, 'capabilities'),
    hooks: typeof record.hooks === 'undefined' ? [] : readStringArray(record.hooks, 'hooks'),
    ui: normalizeUiManifest(record.ui),
    routes: Array.isArray(record.routes)
      ? record.routes.map((entry, index) => normalizeRouteManifest(entry, index))
      : undefined,
    settings: toSettingsRecord(record.settings, 'settings'),
    storage: normalizeStorageManifest(record.storage),
    entrypoints: normalizeEntrypoints(record.entrypoints),
  };
}

export function ensurePluginSettingsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_settings (
      plugin_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      settings_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function toPluginApiRecord(plugin: LoadedPlugin): PluginApiRecord {
  return {
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    kind: plugin.kind,
    description: plugin.description,
    capabilities: [...plugin.capabilities],
    hooks: [...plugin.hooks],
    ui: plugin.ui
      ? {
          mountPoint: plugin.ui.mountPoint.type === 'module-sub-view' || plugin.ui.mountPoint.type === 'detail-panel-section'
            ? { type: plugin.ui.mountPoint.type, module: plugin.ui.mountPoint.module }
            : { type: plugin.ui.mountPoint.type },
          component: plugin.ui.component,
          label: plugin.ui.label,
          icon: plugin.ui.icon,
        }
      : undefined,
    routes: plugin.routes?.map((route) => ({ basePath: route.basePath, entry: route.entry })),
    settings: cloneSettingsRecord(plugin.settings),
    storage: plugin.storage
      ? {
          tables: plugin.storage.tables ? [...plugin.storage.tables] : undefined,
          migrationsDir: plugin.storage.migrationsDir,
        }
      : undefined,
    entrypoints: plugin.entrypoints
      ? {
          server: plugin.entrypoints.server,
          ui: plugin.entrypoints.ui,
        }
      : undefined,
    enabled: plugin.enabled,
    status: {
      loaded: plugin.status.loaded,
      lastError: plugin.status.lastError,
      registeredAt: plugin.status.registeredAt,
      routesMounted: [...plugin.status.routesMounted],
    },
  };
}

export class PluginRegistry {
  private readonly db: Database.Database;
  private readonly logger: Pick<Console, 'info' | 'warn' | 'error'>;
  private readonly pluginsDir: string;
  private readonly configPluginSettings: Record<string, PluginSettingsRecord>;
  private readonly plugins = new Map<string, LoadedPlugin>();

  constructor(options: PluginRegistryOptions) {
    this.db = options.db;
    this.logger = options.logger ?? console;
    this.pluginsDir = resolvePluginsDirectory(options.pluginsDir);
    this.configPluginSettings = options.configPluginSettings ?? {};
  }

  private readPluginSettings(pluginId: string, defaults: PluginSettingsRecord): PluginSettingsRow {
    const settingsJson = JSON.stringify(cloneSettingsRecord(defaults));
    this.db
      .prepare(`
        INSERT OR IGNORE INTO plugin_settings (plugin_id, enabled, settings_json, updated_at)
        VALUES (?, 1, ?, datetime('now'))
      `)
      .run(pluginId, settingsJson);

    const row = this.db
      .prepare('SELECT enabled, settings_json FROM plugin_settings WHERE plugin_id = ? LIMIT 1')
      .get(pluginId) as { enabled?: unknown; settings_json?: unknown } | undefined;

    const storedSettings = parseStoredSettings(row?.settings_json);
    const mergedSettings = mergeSettings(defaults, storedSettings);
    if (JSON.stringify(mergedSettings) !== JSON.stringify(storedSettings)) {
      this.db
        .prepare(`
          UPDATE plugin_settings
          SET settings_json = ?, updated_at = datetime('now')
          WHERE plugin_id = ?
        `)
        .run(JSON.stringify(mergedSettings), pluginId);
    }

    return {
      enabled: row?.enabled === 0 ? false : true,
      settings: mergedSettings,
    };
  }

  load(): LoadedPlugin[] {
    this.plugins.clear();

    if (!fs.existsSync(this.pluginsDir)) {
      this.logger.warn(`[Plugins] Plugin directory not found: ${this.pluginsDir}`);
      return [];
    }

    const directories = fs
      .readdirSync(this.pluginsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(this.pluginsDir, entry.name));

    for (const pluginDir of directories) {
      const manifestPath = path.join(pluginDir, 'plugin.json');
      if (!fs.existsSync(manifestPath)) {
        continue;
      }

      try {
        const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as unknown;
        const manifest = parsePluginManifest(raw, { directory: pluginDir, manifestPath });
        if (this.plugins.has(manifest.id)) {
          throw new Error(`duplicate plugin id "${manifest.id}"`);
        }

        const persisted = this.readPluginSettings(manifest.id, manifest.settings ?? {});
        const loadedPlugin: LoadedPlugin = {
          ...manifest,
          enabled: persisted.enabled,
          settings: persisted.settings,
          directory: pluginDir,
          manifestPath,
          status: {
            loaded: true,
            registeredAt: new Date().toISOString(),
            routesMounted: [],
          },
        };

        this.plugins.set(loadedPlugin.id, loadedPlugin);
        this.logger.info(`[Plugins] Loaded ${loadedPlugin.id} from ${manifestPath}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`[Plugins] Failed to load ${manifestPath}: ${message}`);
      }
    }

    return this.list();
  }

  list(): LoadedPlugin[] {
    return [...this.plugins.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  listPublic(): PluginApiRecord[] {
    return this.list().map((plugin) => toPluginApiRecord(plugin));
  }

  get(id: string): LoadedPlugin | undefined {
    return this.plugins.get(id);
  }

  getPublic(id: string): PluginApiRecord | undefined {
    const plugin = this.get(id);
    return plugin ? toPluginApiRecord(plugin) : undefined;
  }

  setEnabled(id: string, enabled: boolean): PluginApiRecord {
    const plugin = this.plugins.get(id);
    if (!plugin) {
      throw new Error(`Plugin "${id}" not found`);
    }

    plugin.enabled = enabled;
    this.db
      .prepare(`
        UPDATE plugin_settings
        SET enabled = ?, settings_json = ?, updated_at = datetime('now')
        WHERE plugin_id = ?
      `)
      .run(enabled ? 1 : 0, JSON.stringify(plugin.settings), id);

    return toPluginApiRecord(plugin);
  }

  updateSettings(id: string, patch: PluginSettingsRecord): PluginApiRecord {
    const plugin = this.plugins.get(id);
    if (!plugin) {
      throw new Error(`Plugin "${id}" not found`);
    }

    plugin.settings = mergeSettings(plugin.settings, patch);
    this.db
      .prepare(`
        UPDATE plugin_settings
        SET settings_json = ?, updated_at = datetime('now')
        WHERE plugin_id = ?
      `)
      .run(JSON.stringify(plugin.settings), id);

    return toPluginApiRecord(plugin);
  }

  markRouteMounted(id: string, basePath: string): void {
    const plugin = this.plugins.get(id);
    if (!plugin) {
      return;
    }

    if (!plugin.status.routesMounted.includes(basePath)) {
      plugin.status.routesMounted.push(basePath);
    }
  }

  markError(id: string, message: string): void {
    const plugin = this.plugins.get(id);
    if (!plugin) {
      return;
    }

    plugin.status.loaded = false;
    plugin.status.lastError = message;
  }

  clearError(id: string): void {
    const plugin = this.plugins.get(id);
    if (!plugin) {
      return;
    }

    plugin.status.loaded = true;
    delete plugin.status.lastError;
  }
}

export function resolvePluginModulePath(entryPath: string): string {
  const extensionless = entryPath.replace(/\.(c|m)?(t|j)sx?$/, '');
  const candidates = uniqueCandidates([
    modulePathToDistCandidate(entryPath),
    entryPath,
    `${extensionless}.ts`,
    `${extensionless}.js`,
    modulePathToDistCandidate(`${extensionless}.ts`),
    modulePathToDistCandidate(`${extensionless}.js`),
  ]);

  const resolved = candidates.find((candidate) => fs.existsSync(candidate));
  if (!resolved) {
    throw new Error(`Plugin module "${entryPath}" was not found`);
  }

  return resolved;
}

function requirePluginModule(modulePath: string): unknown {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(modulePath);
}

function handleAsyncPluginResult(
  result: void | Promise<void>,
  onError: (message: string) => void,
): void {
  if (!result || typeof (result as Promise<void>).then !== 'function') {
    return;
  }

  void (result as Promise<void>).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    onError(message);
  });
}

export function registerPluginRuntimeModules(options: {
  app: express.Express;
  db: Database.Database;
  hooks: PluginHookEmitter;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  registry: PluginRegistry;
  workspaceRoot: string;
}): void {
  const logger = options.logger ?? console;

  for (const plugin of options.registry.list()) {
    options.hooks.remove(plugin.id);

    const serverEntry = plugin.entrypoints?.server;
    if (!serverEntry) {
      continue;
    }

    try {
      const modulePath = resolvePluginModulePath(path.resolve(plugin.directory, serverEntry));
      const loadedModule = requirePluginModule(modulePath) as PluginServerModule;
      const register = loadedModule.registerPlugin ?? loadedModule.default;
      if (typeof register !== 'function') {
        throw new Error(`Plugin server entry "${serverEntry}" does not export registerPlugin`);
      }

      const result = register({
        app: options.app,
        db: options.db,
        hooks: options.hooks,
        logger,
        plugin,
        registry: options.registry,
        workspaceRoot: options.workspaceRoot,
      });
      handleAsyncPluginResult(result, (message) => {
        options.registry.markError(plugin.id, message);
        logger.error(`[Plugins] Failed to register ${plugin.id}: ${message}`);
      });
      options.registry.clearError(plugin.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.registry.markError(plugin.id, message);
      logger.error(`[Plugins] Failed to register ${plugin.id}: ${message}`);
    }
  }
}

export function mountPluginRoutes(options: {
  app: express.Express;
  db: Database.Database;
  hooks: PluginHookEmitter;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  registry: PluginRegistry;
  workspaceRoot: string;
}): void {
  const logger = options.logger ?? console;

  for (const plugin of options.registry.list()) {
    for (const route of plugin.routes ?? []) {
      if (!route.entry) {
        logger.warn(`[Plugins] Skipping ${plugin.id} route "${route.basePath}" because no entry module was declared`);
        continue;
      }

      try {
        const modulePath = resolvePluginModulePath(path.resolve(plugin.directory, route.entry));
        const loadedModule = requirePluginModule(modulePath) as PluginRouteModule;
        const register = loadedModule.registerPluginRoutes ?? loadedModule.default;
        if (typeof register !== 'function') {
          throw new Error(`Plugin route entry "${route.entry}" does not export registerPluginRoutes`);
        }

        const router = express.Router();
        const result = register(router, {
          app: options.app,
          db: options.db,
          hooks: options.hooks,
          logger,
          plugin,
          registry: options.registry,
          router,
          workspaceRoot: options.workspaceRoot,
        });
        handleAsyncPluginResult(result, (message) => {
          options.registry.markError(plugin.id, message);
          logger.error(`[Plugins] Failed to mount routes for ${plugin.id}: ${message}`);
        });

        const guardedRouter = express.Router();
        guardedRouter.use((_req, res, next) => {
          const currentPlugin = options.registry.get(plugin.id);
          if (!currentPlugin?.enabled) {
            return res.status(503).json({ error: `Plugin "${plugin.id}" is disabled` });
          }
          return next();
        });
        guardedRouter.use(router);

        options.app.use(route.basePath, guardedRouter);
        options.registry.markRouteMounted(plugin.id, route.basePath);
        options.registry.clearError(plugin.id);
        logger.info(`[Plugins] Mounted ${plugin.id} routes at ${route.basePath}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        options.registry.markError(plugin.id, message);
        logger.error(`[Plugins] Failed to mount routes for ${plugin.id}: ${message}`);
      }
    }
  }
}
