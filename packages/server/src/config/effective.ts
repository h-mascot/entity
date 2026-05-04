import type Database from 'better-sqlite3';
import { EntityConfigSchema, isSecretPath, type ConfigSource, type EntityConfig, type SourceMetadata } from './schema';
import { loadFileConfigSources, type LoadedConfigSources } from './load';
import { getSettingJson } from './settings-store';

const SETTINGS_KEY = 'config.runtime';
const BOOTSTRAP_PATHS = new Set([
  'server.host',
  'server.port',
  'server.databasePath',
  'server.logPath',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isEntityArray(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.every((item) => isPlainObject(item) && typeof item.id === 'string');
}

function mergeEntityArrays(base: unknown[], override: unknown[]): unknown[] {
  if (!isEntityArray(base) || !isEntityArray(override)) return override;
  const byId = new Map<string, Record<string, unknown>>();
  for (const item of base) byId.set(String(item.id), { ...item });
  for (const item of override) {
    const existing = byId.get(String(item.id));
    byId.set(String(item.id), existing ? deepMerge(existing, item) as Record<string, unknown> : { ...item });
  }
  return [...byId.values()];
}

export function deepMerge(base: unknown, override: unknown): unknown {
  if (override === undefined) return base;
  if (override === null) return null;
  if (Array.isArray(base) && Array.isArray(override)) return mergeEntityArrays(base, override);
  if (isPlainObject(base) && isPlainObject(override)) {
    const out: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(override)) {
      out[key] = deepMerge(out[key], value);
    }
    return out;
  }
  return override;
}

function assignSource(sources: Record<string, SourceMetadata>, value: unknown, source: ConfigSource, prefix = ''): void {
  if (Array.isArray(value)) {
    sources[prefix] = metadataFor(prefix, source);
    value.forEach((item, index) => assignSource(sources, item, source, `${prefix}[${index}]`));
    return;
  }
  if (isPlainObject(value)) {
    if (prefix) sources[prefix] = metadataFor(prefix, source);
    for (const [key, child] of Object.entries(value)) {
      assignSource(sources, child, source, prefix ? `${prefix}.${key}` : key);
    }
    return;
  }
  if (prefix) sources[prefix] = metadataFor(prefix, source);
}

function metadataFor(path: string, source: ConfigSource): SourceMetadata {
  const secret = isSecretPath(path);
  const bootstrap = BOOTSTRAP_PATHS.has(path);
  return {
    source,
    editableInUi: source !== 'env' && !bootstrap,
    secret,
    sensitive: secret || path.includes('Path') || path.includes('url') || path.includes('Url'),
    adminOnly: true,
    advanced: bootstrap || path.startsWith('deploy') || path.startsWith('terminal'),
    requiresRestart: bootstrap,
    overriddenBy: null,
  };
}


function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { name?: string } | undefined;
  return row?.name === name;
}


function loadDbAgents(db: Database.Database): Array<Record<string, unknown>> {
  if (!tableExists(db, 'entity_agents')) return [];
  const rows = db
    .prepare(`
      SELECT id, slug, name, emoji, avatar_url, description, adapter_type, runtime_type, status
      FROM entity_agents
      ORDER BY name COLLATE NOCASE ASC
    `)
    .all() as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: String(row.slug ?? row.id ?? ''),
    name: String(row.name ?? ''),
    role: String(row.description ?? 'general'),
    avatar: row.avatar_url === null ? null : String(row.avatar_url ?? ''),
    emoji: row.emoji === null ? null : String(row.emoji ?? ''),
    enabled: String(row.status ?? 'active') !== 'disabled',
    fileSources: [],
    gateway: {
      type: String(row.adapter_type ?? 'none') || 'none',
      url: null,
      tokenRef: null,
    },
    runtimeType: row.runtime_type === null ? null : String(row.runtime_type ?? ''),
  }));
}

function loadDbFileSources(db: Database.Database): Array<Record<string, unknown>> {
  if (!tableExists(db, 'file_sources')) return [];
  const rows = db
    .prepare(`
      SELECT id, display_name, type, base_url, base_path, enabled, icon
      FROM file_sources
      ORDER BY datetime(updated_at) DESC, id DESC
    `)
    .all() as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: String(row.id ?? ''),
    displayName: String(row.display_name ?? ''),
    type: String(row.type ?? 'local'),
    basePath: row.base_path === null ? null : String(row.base_path ?? ''),
    baseUrl: row.base_url === null ? null : String(row.base_url ?? ''),
    enabled: row.enabled === 1 || row.enabled === true,
    icon: row.icon === null ? null : String(row.icon ?? ''),
    agentBindings: [],
  }));
}

function applyEnvOverrides(_config: EntityConfig): Partial<EntityConfig> {
  const server: Record<string, unknown> = {};
  if (process.env.PORT) server.port = Number(process.env.PORT);
  if (process.env.WORKSPACE) server.workspaceRoot = process.env.WORKSPACE;
  if (process.env.ENTITY_PUBLIC_BASE_URL) server.publicBaseUrl = process.env.ENTITY_PUBLIC_BASE_URL;
  const out: Record<string, unknown> = {};
  if (Object.keys(server).length > 0) out.server = server;
  return out as Partial<EntityConfig>;
}

function redactSecrets(value: unknown, prefix = ''): unknown {
  if (Array.isArray(value)) return value.map((item, index) => redactSecrets(item, `${prefix}[${index}]`));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const childPath = prefix ? `${prefix}.${key}` : key;
      out[key] = isSecretPath(childPath) ? '[REDACTED]' : redactSecrets(child, childPath);
    }
    return out;
  }
  return value;
}

export interface EffectiveConfigResult {
  version: 1;
  settings: unknown;
  sources: Record<string, SourceMetadata>;
  warnings: string[];
  files: {
    configPath: string;
    profilePath: string | null;
  };
}

export function buildEffectiveConfig(options: { db?: Database.Database; cwd?: string; loaded?: LoadedConfigSources } = {}): EffectiveConfigResult {
  const loaded = options.loaded ?? loadFileConfigSources(options.cwd);
  const warnings = [...loaded.warnings];
  let merged: unknown = loaded.defaults;
  const sources: Record<string, SourceMetadata> = {};
  assignSource(sources, loaded.defaults, 'default');

  for (const [source, value] of [
    ['profile', loaded.profile],
    ['config', loaded.config],
  ] as Array<[ConfigSource, unknown | null]>) {
    if (value) {
      merged = deepMerge(merged, value);
      assignSource(sources, value, source);
    }
  }

  if (options.db) {
    const dbValue = getSettingJson(options.db, SETTINGS_KEY);
    if (dbValue) {
      merged = deepMerge(merged, EntityConfigSchema.partial().parse(dbValue));
      assignSource(sources, dbValue, 'database');
    }

    const dbAgents = loadDbAgents(options.db);
    if (dbAgents.length > 0) {
      const agentValue = { agents: dbAgents };
      merged = { ...(isPlainObject(merged) ? merged : {}), ...agentValue };
      assignSource(sources, agentValue, 'database');
    }

    const dbFileSources = loadDbFileSources(options.db);
    if (dbFileSources.length > 0) {
      const fileSourceValue = { fileSources: dbFileSources };
      merged = deepMerge(merged, fileSourceValue);
      assignSource(sources, fileSourceValue, 'database');
    }
  }

  const parsedBeforeEnv = EntityConfigSchema.parse(merged);
  const envOverrides = applyEnvOverrides(parsedBeforeEnv);
  if (Object.keys(envOverrides).length > 0) {
    merged = deepMerge(parsedBeforeEnv, envOverrides);
    assignSource(sources, envOverrides, 'env');
  }

  const settings = EntityConfigSchema.parse(merged);
  return {
    version: 1,
    settings: redactSecrets(settings),
    sources,
    warnings,
    files: {
      configPath: loaded.configPath,
      profilePath: loaded.profilePath,
    },
  };
}
