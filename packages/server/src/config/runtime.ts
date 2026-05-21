import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';
import { createAgentRegistryRepository, type AgentRegistryRecord } from '../../../db/src';
import { createFileSourceRepository, type FileSourceRecord, type FileSourceRepository } from '../../../db/src/file-sources';
import { loadFileConfigSources, resolveConfigPath } from './load';
import { deepMerge } from './effective';
import { EntityConfigSchema, type EntityConfig } from './schema';
import { setSettingJson } from './settings-store';
import type { PluginJsonValue, PluginSettingsRecord } from '../plugins/types';

function expandPathTokens(value: string, config: EntityConfig, cwd = process.cwd()): string {
  let out = value
    .replace(/\$\{HOME\}/g, process.env.HOME || os.homedir())
    .replace(/\$\{server\.workspaceRoot\}/g, config.server.workspaceRoot);
  if (out === '~') out = process.env.HOME || os.homedir();
  else if (out.startsWith('~/')) out = path.join(process.env.HOME || os.homedir(), out.slice(2));
  return path.isAbsolute(out) ? out : path.resolve(cwd, out);
}

export function loadRuntimeFileConfig(cwd = process.cwd()): EntityConfig {
  const loaded = loadFileConfigSources(cwd);
  const merged = deepMerge(deepMerge(loaded.defaults, loaded.profile ?? {}), loaded.config ?? {});
  return EntityConfigSchema.parse(merged);
}

export function applyBootstrapRuntimeEnv(cwd = process.cwd()): EntityConfig {
  const config = loadRuntimeFileConfig(cwd);
  const configPath = resolveConfigPath(cwd);
  const configBaseDir = path.dirname(configPath);
  const databasePath = expandPathTokens(config.server.databasePath, config, configBaseDir);
  const workspaceRoot = expandPathTokens(config.server.workspaceRoot, config, configBaseDir);
  const logPath = expandPathTokens(config.server.logPath, config, configBaseDir);

  process.env.ENTITY_CONFIG = process.env.ENTITY_CONFIG || configPath;
  process.env.ENTITY_TASK_DB_PATH = process.env.ENTITY_TASK_DB_PATH || databasePath;
  process.env.WORKSPACE = process.env.WORKSPACE || workspaceRoot;
  process.env.PORT = process.env.PORT || String(config.server.port);
  process.env.ENTITY_PUBLIC_BASE_URL = process.env.ENTITY_PUBLIC_BASE_URL || config.server.publicBaseUrl;
  process.env.ENTITY_CLOUD_API_BASE = process.env.ENTITY_CLOUD_API_BASE || config.server.apiBaseUrl || config.server.publicBaseUrl;
  process.env.VITE_ENTITY_API_BASE = process.env.VITE_ENTITY_API_BASE || config.server.apiBaseUrl || config.server.publicBaseUrl;
  process.env.VITE_MC_ORIGIN = process.env.VITE_MC_ORIGIN || config.server.apiBaseUrl || config.server.publicBaseUrl;
  process.env.VITE_ENTITY_WS_URL = process.env.VITE_ENTITY_WS_URL || config.server.wsBaseUrl;
  process.env.ENTITY_SERVER_LOG_PATH = process.env.ENTITY_SERVER_LOG_PATH || logPath;

  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  return config;
}

function normalizeAgentId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'assistant';
}

function toAgentRecord(agent: EntityConfig['agents'][number]): Parameters<ReturnType<typeof createAgentRegistryRepository>['createAgent']>[0] {
  const id = normalizeAgentId(agent.id);
  return {
    id,
    slug: id,
    name: agent.name,
    emoji: agent.emoji || '🤖',
    avatar_url: agent.avatar || undefined,
    description: agent.role || 'general',
    adapter_type: agent.gateway.type || 'none',
    runtime_type: agent.gateway.type || 'none',
    status: agent.enabled === false ? 'disabled' : 'active',
    metadata_json: JSON.stringify({
      source: 'entity.config.yaml',
      fileSources: agent.fileSources,
      gateway: agent.gateway,
      healthUrls: agent.healthUrls,
      workspaceRoot: agent.workspaceRoot ?? null,
    }),
  };
}

function seedAgentsFromConfig(config: EntityConfig): AgentRegistryRecord[] {
  const repo = createAgentRegistryRepository();
  for (const agent of config.agents) {
    const record = toAgentRecord(agent);
    const id = record.id ?? normalizeAgentId(agent.id);
    const existing = repo.getAgent(id) ?? repo.getAgentBySlug(record.slug ?? id);
    if (existing) {
      repo.updateAgent(existing.id, {
        name: record.name,
        emoji: record.emoji,
        avatar_url: record.avatar_url ?? null,
        description: record.description ?? null,
        adapter_type: record.adapter_type ?? null,
        runtime_type: record.runtime_type ?? null,
        status: record.status,
        metadata_json: record.metadata_json,
      });
    } else {
      repo.createAgent(record);
    }
  }
  return repo.listAgents();
}

function toCapabilities(source: EntityConfig['fileSources'][number]): string {
  return JSON.stringify({
    source: 'entity.config.yaml',
    agentBindings: source.agentBindings,
  });
}

function seedFileSourcesFromConfig(config: EntityConfig, repo: FileSourceRepository = createFileSourceRepository(), baseDir = process.cwd()): FileSourceRecord[] {
  for (const source of config.fileSources) {
    const id = source.id.trim();
    if (!id) continue;
    const basePath = source.basePath ? expandPathTokens(source.basePath, config, baseDir) : undefined;
    const existing = repo.getSource(id);
    const payload = {
      display_name: source.displayName,
      type: source.type,
      base_url: source.baseUrl ?? undefined,
      base_path: basePath,
      auth_type: 'none' as const,
      enabled: source.enabled,
      icon: source.icon ?? undefined,
      capabilities: toCapabilities(source),
      health: 'ok' as const,
    };
    if (existing) repo.updateSource(id, payload);
    else repo.createSource({ id, ...payload });
  }
  return repo.listSources(true);
}

function clonePluginSettings(value: unknown): PluginSettingsRecord {
  return JSON.parse(JSON.stringify(value ?? {})) as PluginSettingsRecord;
}

function configuredServicesAsPluginSettings(config: EntityConfig): PluginJsonValue[] {
  return config.services.map((service) => ({
    id: service.id,
    name: service.name,
    url: service.url,
    healthUrl: service.healthUrl,
    enabled: service.enabled,
  }));
}

export function buildConfigPluginSettings(configInput: unknown): Record<string, PluginSettingsRecord> {
  const config = EntityConfigSchema.parse(configInput);
  const out: Record<string, PluginSettingsRecord> = {};

  for (const [pluginId, rawPluginConfig] of Object.entries(config.plugins)) {
    if (!rawPluginConfig || typeof rawPluginConfig !== 'object' || Array.isArray(rawPluginConfig)) continue;
    const rawSettings = (rawPluginConfig as { settings?: unknown }).settings;
    if (rawSettings && typeof rawSettings === 'object' && !Array.isArray(rawSettings)) {
      out[pluginId] = clonePluginSettings(rawSettings);
    }
  }

  const services = configuredServicesAsPluginSettings(config);
  if (services.length > 0) {
    const current = out['entity-services'] ?? {};
    const currentServices = Array.isArray(current.services) ? current.services : [];
    out['entity-services'] = {
      ...current,
      services: [...services, ...currentServices],
    };
  }

  return out;
}

function seedPluginSettingsFromConfig(db: Database.Database, config: EntityConfig): void {
  for (const [pluginId, settings] of Object.entries(buildConfigPluginSettings(config))) {
    setSettingJson(db, `plugin.${pluginId}.configDefaults`, settings, 'entity.config.yaml');
  }
}

export function applyRuntimeConfigSeeds(options: { db: Database.Database; fileSourceRepository?: FileSourceRepository; cwd?: string }): EntityConfig {
  const cwd = options.cwd ?? process.cwd();
  const config = loadRuntimeFileConfig(cwd);
  const configBaseDir = path.dirname(resolveConfigPath(cwd));
  seedAgentsFromConfig(config);
  seedFileSourcesFromConfig(config, options.fileSourceRepository, configBaseDir);
  seedPluginSettingsFromConfig(options.db, config);
  return config;
}

export function buildConfiguredAgentHealthEndpoints(config: EntityConfig): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const agent of config.agents) {
    if (agent.enabled === false) continue;
    const id = normalizeAgentId(agent.id);
    const urls = new Set<string>();
    for (const url of agent.healthUrls ?? []) {
      if (url.trim()) urls.add(url.trim());
    }
    const gatewayUrl = agent.gateway?.url?.trim();
    if (gatewayUrl) {
      urls.add(gatewayUrl.replace(/\/+$/, '') + '/health');
    }
    out[id] = [...urls];
  }
  return out;
}

export function buildConfiguredAgentWorkspaces(config: EntityConfig, baseDir = process.cwd()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const agent of config.agents) {
    if (agent.enabled === false) continue;
    const id = normalizeAgentId(agent.id);
    const explicit = agent.workspaceRoot?.trim();
    const source = explicit
      ? { basePath: explicit }
      : config.fileSources.find((candidate) => candidate.agentBindings.includes(agent.id) && candidate.basePath);
    const root = source?.basePath ?? config.server.workspaceRoot;
    out[id] = expandPathTokens(root, config, baseDir);
  }
  return out;
}
