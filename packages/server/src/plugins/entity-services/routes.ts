import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Request, Response, Router } from 'express';
import type { LoadedPlugin, PluginSettingsRecord } from '../types';
import type { PluginRouteContext } from '../registry';

const execFileAsync = promisify(execFile);

export type ServiceStatus = 'operational' | 'degraded' | 'offline' | 'unknown';
export type ServiceVisibility = 'managed' | 'related' | 'ambient';

export interface ServiceFamilyRecord {
  key: string;
  name: string;
  memberCount: number;
}

export interface ServiceLinkRecord {
  label: string;
  url: string;
  external: boolean;
}

export interface ServiceHealthRecord {
  status: ServiceStatus;
  message: string;
  checkedAt: string;
  endpoint?: string;
  latencyMs?: number;
  statusCode?: number;
}

export interface ServiceRegistryEntry {
  id: string;
  name: string;
  serviceType: 'internal-plugin' | 'external-http' | 'host-process';
  category: string;
  description: string;
  status: ServiceStatus;
  visibility: ServiceVisibility;
  relevanceScore: number;
  relevanceReason: string;
  family: ServiceFamilyRecord;
  health: ServiceHealthRecord;
  link: ServiceLinkRecord;
  healthLink?: ServiceLinkRecord;
  tags: string[];
  meta: Record<string, unknown>;
}

export type ServiceRegistryState = 'refreshing' | 'ready' | 'error';

export interface ServiceRegistryPayload {
  plugin: {
    id: string;
    name: string;
    enabled: boolean;
    kind: string;
    settings: PluginSettingsRecord;
  };
  summary: Record<ServiceStatus, number>;
  checkedAt: string;
  services: ServiceRegistryEntry[];
  state: ServiceRegistryState;
  partial: boolean;
  refreshError?: string;
}

interface InternalPluginDefinition {
  kind: 'internal-plugin';
  id: string;
  name: string;
  description: string;
  pluginId: string;
  category: string;
  statusPath: string;
  tags: string[];
}

interface ExternalServiceDefinition {
  kind: 'external-http';
  id: string;
  name: string;
  description: string;
  category: string;
  appUrl: string;
  healthUrls: string[];
  tags: string[];
  host?: string;
  meta?: Record<string, unknown>;
}

interface HostDiscoveryConfig {
  id: string;
  label: string;
  sshTarget?: string;
  publicHost?: string;
  enabled: boolean;
}

interface DiscoveredListener {
  hostId: string;
  hostLabel: string;
  name: string;
  processName: string;
  pid?: number;
  port: number;
  bindAddress: string;
  publicUrl?: string;
  localUrl: string;
  category: string;
  tags: string[];
  description: string;
  healthUrls: string[];
  detectedTitle?: string;
  detectedServerHeader?: string;
  detectedContentType?: string;
  detectedRedirectTarget?: string;
  detectedHint?: string;
}

type ServiceDefinition = InternalPluginDefinition | ExternalServiceDefinition;
type FetchLike = typeof fetch;

const DEFAULT_REQUEST_TIMEOUT_MS = 1000;
const SERVICE_REGISTRY_CACHE_TTL_MS = 15_000;
const SERVICE_REGISTRY_CACHE_STALE_MS = 5 * 60_000;
const SERVICE_PROBE_CONCURRENCY = 16;
const MAX_REGISTRY_CACHE_KEYS = 16;
const SSH_TARGET_PATTERN = /^(?:[A-Za-z0-9._-]+@)?(?:[A-Za-z0-9._-]+|\[[0-9A-Fa-f:.]+\])$/;

interface RegistryCacheEntry {
  payload: ServiceRegistryPayload;
  createdAt: number;
}

const registryCache = new Map<string, RegistryCacheEntry>();
const refreshesInFlight = new Map<string, Promise<ServiceRegistryPayload>>();

function setRegistryCache(key: string, entry: RegistryCacheEntry): void {
  registryCache.delete(key);
  registryCache.set(key, entry);
  while (registryCache.size > MAX_REGISTRY_CACHE_KEYS) {
    const oldestKey = registryCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    registryCache.delete(oldestKey);
  }
}

interface ListenerProbeSnapshot {
  title?: string;
  serverHeader?: string;
  contentType?: string;
  redirectTarget?: string;
  hint?: string;
}

// Curated service metadata loaded from config; empty by default.
const KNOWN_SERVICE_MAP: Record<string, Partial<DiscoveredListener> & { name: string }> = {};

function readStringSetting(settings: PluginSettingsRecord, key: string, fallback = ''): string {
  const value = settings[key];
  return typeof value === 'string' ? value.trim() : fallback;
}

function readBooleanSetting(settings: PluginSettingsRecord, key: string, fallback: boolean): boolean {
  const value = settings[key];
  return typeof value === 'boolean' ? value : fallback;
}

function readNumberSetting(settings: PluginSettingsRecord, key: string, fallback: number): number {
  const value = settings[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function validateSshTarget(rawTarget: string): string {
  const target = rawTarget.trim();
  if (!target) {
    throw new Error('SSH target is required.');
  }
  if (target.startsWith('-')) {
    throw new Error('SSH target must not start with "-".');
  }
  if (!SSH_TARGET_PATTERN.test(target)) {
    throw new Error('SSH target must be a hostname, host alias, or user@host value.');
  }
  return target;
}

export function buildSshExecArgs(sshTarget: string, command: string): string[] {
  return ['-o', 'ConnectTimeout=10', '--', validateSshTarget(sshTarget), command];
}

function readConfiguredServices(settings: PluginSettingsRecord): ExternalServiceDefinition[] {
  const raw = settings.services;
  if (!Array.isArray(raw)) return [];
  const services: ExternalServiceDefinition[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const service = item as Record<string, unknown>;
    const id = typeof service.id === 'string' ? service.id.trim() : '';
    const name = typeof service.name === 'string' ? service.name.trim() : '';
    const appUrl = typeof service.url === 'string'
      ? service.url.trim()
      : typeof service.appUrl === 'string'
        ? service.appUrl.trim()
        : '';
    const enabled = typeof service.enabled === 'boolean' ? service.enabled : true;
    if (!enabled || !id || !name || !appUrl) continue;
    const healthUrls = Array.isArray(service.healthUrls)
      ? service.healthUrls.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())).map((entry) => entry.trim())
      : typeof service.healthUrl === 'string' && service.healthUrl.trim()
        ? [service.healthUrl.trim()]
        : [appUrl];
    const tags = Array.isArray(service.tags)
      ? service.tags.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())).map((entry) => entry.trim())
      : ['configured'];
    services.push({
      kind: 'external-http',
      id,
      name,
      description: typeof service.description === 'string' && service.description.trim() ? service.description.trim() : 'User-configured service.',
      category: typeof service.category === 'string' && service.category.trim() ? service.category.trim() : 'Configured services',
      appUrl,
      healthUrls,
      tags,
      host: typeof service.host === 'string' && service.host.trim() ? service.host.trim() : undefined,
      meta: { source: 'config' },
    });
  }
  return services;
}

function normalizeRuntimeBaseUrl(value = ''): string {
  return normalizeBaseUrl(value || process.env.ENTITY_BASE_URL || process.env.PUBLIC_ENTITY_BASE_URL || '');
}

function getUrlHostname(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return '';
  }
}

function getUrlProtocol(value: string): string {
  try {
    return new URL(value).protocol || 'http:';
  } catch {
    return 'http:';
  }
}

function isTailnetHost(hostname: string): boolean {
  return /^100\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

function preferRuntimeTailnetUrl(configuredUrl: string, runtimeBaseUrl: string, port?: number): string {
  const normalizedConfigured = normalizeBaseUrl(configuredUrl);
  const normalizedRuntime = normalizeRuntimeBaseUrl(runtimeBaseUrl);
  if (!normalizedRuntime) {
    return normalizedConfigured;
  }

  const runtimeHost = getUrlHostname(normalizedRuntime);
  const configuredHost = getUrlHostname(normalizedConfigured);
  if (!isTailnetHost(runtimeHost) || !isTailnetHost(configuredHost) || runtimeHost === configuredHost) {
    return normalizedConfigured;
  }

  const protocol = getUrlProtocol(normalizedRuntime);
  const runtimePort = (() => {
    try {
      return new URL(normalizedRuntime).port;
    } catch {
      return '';
    }
  })();
  const selectedPort = port ? String(port) : runtimePort;
  return normalizeBaseUrl(`${protocol}//${runtimeHost}${selectedPort ? `:${selectedPort}` : ''}`);
}

function deriveRuntimeOrigin(req: { protocol?: string; get?: (name: string) => string | undefined }): string {
  const host = req.get?.('host');
  if (!host) {
    return normalizeRuntimeBaseUrl();
  }
  const forwardedProto = req.get?.('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = forwardedProto || req.protocol || 'http';
  return normalizeRuntimeBaseUrl(`${protocol}://${host}`);
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function joinUrl(baseUrl: string, pathname: string): string {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${normalizedBase}${normalizedPath}`;
}

function createLink(label: string, url: string, external: boolean): ServiceLinkRecord {
  return { label, url, external };
}

function createSummary(): Record<ServiceStatus, number> {
  return {
    operational: 0,
    degraded: 0,
    offline: 0,
    unknown: 0,
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'service';
}

function guessCategory(processName: string, port: number): string {
  const lower = processName.toLowerCase();
  if (lower.includes('openclaw') || port === 18789 || port === 8100) return 'Agent Runtime';
  if (lower.includes('python') || lower.includes('bun') || lower.includes('node')) return 'Operations';
  return 'Infrastructure';
}

function safeTrim(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function deriveHintFromProbe(snapshot: ListenerProbeSnapshot): string | undefined {
  const title = safeTrim(snapshot.title);
  if (title && !/^\d+$/.test(title)) return title;

  const redirect = safeTrim(snapshot.redirectTarget);
  if (redirect) {
    try {
      const url = new URL(redirect, 'http://placeholder.local');
      const segment = url.pathname.split('/').filter(Boolean)[0];
      if (segment) return segment.replace(/[-_]+/g, ' ');
    } catch {
      return redirect;
    }
  }

  const server = safeTrim(snapshot.serverHeader);
  if (server) return server;

  const contentType = safeTrim(snapshot.contentType);
  if (contentType) return contentType;

  return safeTrim(snapshot.hint);
}

function prettifyDiscoveredName(processName: string, port: number, probe?: ListenerProbeSnapshot): string {
  const normalizedProcess = processName.trim() || 'service';
  if (!/^node$/i.test(normalizedProcess) && !/^service$/i.test(normalizedProcess)) {
    return `${normalizedProcess} :${port}`;
  }

  const hint = deriveHintFromProbe(probe ?? {});
  if (hint) {
    const cleaned = hint
      .replace(/\s+/g, ' ')
      .replace(/\b(home|index|welcome)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned) return `${cleaned} (${normalizedProcess} :${port})`;
  }

  return `${normalizedProcess} :${port}`;
}

function buildDiscoveredDescription(listener: DiscoveredListener): string {
  const base = `Auto-discovered listener on ${listener.hostLabel} (${listener.processName} on port ${listener.port}).`;
  const details = [listener.detectedTitle, listener.detectedServerHeader, listener.detectedContentType]
    .map((value) => safeTrim(value))
    .filter(Boolean) as string[];
  return details.length > 0 ? `${base} Detected: ${details.join(' • ')}.` : base;
}


const DOMAIN_SIGNAL_PATTERN = /\b(entity|enterprise|crew|openclaw|vaultwarden|vault|n8n|ollama|postgres|redis|qdrant|chroma|llama|mlx|tts|voice|eforge|symphony|helm)\b/i;
const RUNTIME_PROCESS_PATTERN = /\b(node|python|python3|bun|postgres|ollama|redis|docker|orbstack)\b/i;

function readMetaValue(meta: Record<string, unknown>, key: string): string {
  const value = meta[key];
  return typeof value === 'string' ? value.trim() : '';
}

function buildSignalText(entry: Pick<ServiceRegistryEntry, 'name' | 'category' | 'description' | 'tags' | 'serviceType' | 'meta'>): string {
  return [
    entry.name,
    entry.category,
    entry.description,
    entry.serviceType,
    ...entry.tags,
    readMetaValue(entry.meta, 'source'),
    readMetaValue(entry.meta, 'processName'),
    readMetaValue(entry.meta, 'detectedTitle'),
    readMetaValue(entry.meta, 'detectedHint'),
    readMetaValue(entry.meta, 'detectedContentType'),
  ].filter(Boolean).join(' ');
}

function inferServiceFamily(entry: Pick<ServiceRegistryEntry, 'name' | 'serviceType' | 'tags' | 'meta'>): ServiceFamilyRecord {
  const processName = readMetaValue(entry.meta, 'processName');
  const detectedTitle = readMetaValue(entry.meta, 'detectedTitle') || readMetaValue(entry.meta, 'detectedHint');
  const source = readMetaValue(entry.meta, 'source');
  let familyName = entry.name.replace(/\s*:\d+\b/g, '').replace(/\s*\([^)]*:\d+\)\s*$/g, '').trim();

  if (source === 'auto-discovered' && processName && !/^node|python3?|bun|service$/i.test(processName)) {
    familyName = processName;
  } else if (source === 'auto-discovered' && detectedTitle) {
    familyName = detectedTitle.replace(/\s*\([^)]*:\d+\)\s*$/g, '').trim();
  }

  familyName = familyName || processName || 'Service';
  return { key: slugify(familyName), name: familyName, memberCount: 1 };
}

function inferServiceVisibility(entry: Pick<ServiceRegistryEntry, 'name' | 'serviceType' | 'category' | 'description' | 'tags' | 'meta'>): {
  visibility: ServiceVisibility;
  relevanceScore: number;
  relevanceReason: string;
} {
  const source = readMetaValue(entry.meta, 'source');
  const processName = readMetaValue(entry.meta, 'processName');
  const signalText = buildSignalText(entry);

  if (entry.serviceType === 'internal-plugin') {
    return { visibility: 'managed', relevanceScore: 100, relevanceReason: 'Entity-managed plugin' };
  }

  if (source === 'curated' || source === 'config') {
    return { visibility: 'managed', relevanceScore: 95, relevanceReason: source === 'config' ? 'Configured service definition' : 'Curated service definition' };
  }

  if (DOMAIN_SIGNAL_PATTERN.test(signalText)) {
    return { visibility: 'related', relevanceScore: 70, relevanceReason: 'Matched Entity/platform service signals' };
  }

  if (RUNTIME_PROCESS_PATTERN.test(processName) && entry.category !== 'Infrastructure') {
    return { visibility: 'related', relevanceScore: 55, relevanceReason: 'Runtime listener with operational category' };
  }

  return { visibility: 'ambient', relevanceScore: 15, relevanceReason: 'Ambient host listener; grouped but hidden from focus view' };
}

function applyServiceClassification(service: ServiceRegistryEntry): ServiceRegistryEntry {
  const classification = inferServiceVisibility(service);
  return {
    ...service,
    ...classification,
    family: inferServiceFamily(service),
  };
}

function applyFamilyCounts(services: ServiceRegistryEntry[]): ServiceRegistryEntry[] {
  const counts = new Map<string, number>();
  for (const service of services) {
    counts.set(service.family.key, (counts.get(service.family.key) ?? 0) + 1);
  }
  return services.map((service) => ({
    ...service,
    family: {
      ...service.family,
      memberCount: counts.get(service.family.key) ?? 1,
    },
  }));
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    }),
  );

  return results;
}

function createCacheKey(plugin: LoadedPlugin, runtimeBaseUrl: string): string {
  return JSON.stringify({
    pluginId: plugin.id,
    runtimeBaseUrl,
    settings: plugin.settings,
  });
}

function isFreshCache(entry: RegistryCacheEntry | undefined, now: number): boolean {
  return Boolean(entry && entry.payload.state === 'ready' && now - entry.createdAt < SERVICE_REGISTRY_CACHE_TTL_MS);
}

function isUsableStaleCache(entry: RegistryCacheEntry | undefined, now: number): boolean {
  return Boolean(entry && now - entry.createdAt < SERVICE_REGISTRY_CACHE_STALE_MS);
}

async function probeListenerIdentity(url: string, timeoutMs: number, fetchImpl: FetchLike): Promise<ListenerProbeSnapshot> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 2500));

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    });

    const contentType = response.headers.get('content-type') ?? undefined;
    const serverHeader = response.headers.get('server') ?? undefined;
    const redirectTarget = response.headers.get('location') ?? undefined;
    let title: string | undefined;
    let hint: string | undefined;

    if (contentType?.includes('text/html')) {
      const body = await response.text();
      const match = body.match(/<title>([\s\S]*?)<\/title>/i);
      title = safeTrim(match?.[1]?.replace(/\s+/g, ' '));
    } else if (contentType?.includes('application/json')) {
      const body = await response.text();
      try {
        const json = JSON.parse(body) as Record<string, unknown>;
        const candidates = [json.name, json.service, json.title, json.app, json.message]
          .map((value) => (typeof value === 'string' ? value : undefined))
          .filter(Boolean) as string[];
        hint = safeTrim(candidates[0]);
      } catch {
        // ignore malformed JSON hints
      }
    }

    return {
      title,
      serverHeader,
      contentType,
      redirectTarget,
      hint,
    };
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

function buildServiceDefinitions(settings: PluginSettingsRecord, runtimeBaseUrl = ''): ServiceDefinition[] {
  const runtimeEntityBaseUrl = normalizeRuntimeBaseUrl(runtimeBaseUrl);
  const configuredEntityBaseUrl = readStringSetting(settings, 'entityBaseUrl', runtimeEntityBaseUrl || 'http://127.0.0.1:3000');
  const entityBaseUrl = preferRuntimeTailnetUrl(configuredEntityBaseUrl, runtimeEntityBaseUrl);
  const defaultEnterpriseAdminUrl = entityBaseUrl ? `${getUrlProtocol(entityBaseUrl)}//${getUrlHostname(entityBaseUrl)}:3002` : 'http://127.0.0.1:3002';
  const legacyEnterpriseAdminUrl = readStringSetting(settings, 'externalAdminUrl', '') || defaultEnterpriseAdminUrl;
  const configuredEnterpriseAdminUrl = readStringSetting(settings, 'enterpriseAdminUrl', legacyEnterpriseAdminUrl) || legacyEnterpriseAdminUrl;
  const enterpriseAdminName = readStringSetting(settings, 'enterpriseAdminName', readStringSetting(settings, 'externalAdminName', 'Enterprise Crew Admin')) || 'Enterprise Crew Admin';
  const enterpriseAdminUrl = preferRuntimeTailnetUrl(configuredEnterpriseAdminUrl, entityBaseUrl, 3002);

  return [
    {
      kind: 'internal-plugin',
      id: 'entity-linker',
      name: 'Entity Linker',
      description: 'Entity-native linker runtime that tracks linkable task activity.',
      pluginId: 'entity-linker',
      category: 'Entity runtime',
      statusPath: joinUrl(entityBaseUrl, '/api/entity-linker/status'),
      tags: ['plugin', 'entity', 'linking'],
    },
    ...readConfiguredServices(settings),
    {
      kind: 'external-http',
      id: 'enterprise-crew-admin',
      name: enterpriseAdminName,
      description: 'Standalone crew admin app linked from Entity services instead of embedded app-shell wiring.',
      category: 'Operations',
      appUrl: enterpriseAdminUrl,
      healthUrls: [
        joinUrl(enterpriseAdminUrl, '/api/health'),
        joinUrl(enterpriseAdminUrl, '/health'),
        enterpriseAdminUrl,
      ],
      tags: ['enterprise', 'ops', 'crew-admin', 'external-app'],
      host: 'Entity',
      meta: {
        launchMode: 'new-tab',
        integrationMode: 'linked-service',
      },
    },
  ];
}

function describeInternalPluginStatus(plugin: LoadedPlugin | undefined): ServiceHealthRecord {
  const checkedAt = new Date().toISOString();
  if (!plugin) {
    return {
      status: 'offline',
      message: 'Plugin is not registered in the current runtime.',
      checkedAt,
    };
  }

  if (!plugin.enabled) {
    return {
      status: 'offline',
      message: 'Plugin is installed but disabled.',
      checkedAt,
    };
  }

  if (!plugin.status.loaded || plugin.status.lastError) {
    return {
      status: 'degraded',
      message: plugin.status.lastError?.trim() || 'Plugin reported a runtime error.',
      checkedAt,
    };
  }

  return {
    status: 'operational',
    message:
      plugin.status.routesMounted.length > 0
        ? `Operational with ${plugin.status.routesMounted.length} mounted route${plugin.status.routesMounted.length === 1 ? '' : 's'}.`
        : 'Operational with no extra routes mounted.',
    checkedAt,
  };
}

async function probeExternalService(
  definition: ExternalServiceDefinition,
  timeoutMs: number,
  fetchImpl: FetchLike,
): Promise<ServiceHealthRecord> {
  const checkedAt = new Date().toISOString();
  let lastFailure: ServiceHealthRecord | null = null;

  for (const endpoint of definition.healthUrls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetchImpl(endpoint, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
      });
      const latencyMs = Date.now() - startedAt;

      if (response.status >= 200 && response.status < 400) {
        clearTimeout(timer);
        return {
          status: 'operational',
          message: `${definition.name} reachable`,
          checkedAt,
          endpoint,
          latencyMs,
          statusCode: response.status,
        };
      }

      lastFailure = {
        status: response.status >= 500 ? 'degraded' : 'unknown',
        message: `${definition.name} returned HTTP ${response.status}`,
        checkedAt,
        endpoint,
        latencyMs,
        statusCode: response.status,
      };
    } catch (error) {
      lastFailure = {
        status: 'offline',
        message: `${definition.name} unreachable: ${error instanceof Error ? error.message : 'unknown error'}`,
        checkedAt,
        endpoint,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return (
    lastFailure ?? {
      status: 'unknown',
      message: 'No health endpoints configured.',
      checkedAt,
    }
  );
}

function toInternalRegistryEntry(definition: InternalPluginDefinition, plugin: LoadedPlugin | undefined): ServiceRegistryEntry {
  const health = describeInternalPluginStatus(plugin);

  return {
    id: definition.id,
    name: definition.name,
    serviceType: 'internal-plugin',
    category: definition.category,
    description: definition.description,
    status: health.status,
    visibility: 'managed',
    relevanceScore: 100,
    relevanceReason: 'Entity-managed plugin',
    family: { key: slugify(definition.name), name: definition.name, memberCount: 1 },
    health,
    link: createLink('Open status', definition.statusPath, true),
    healthLink: createLink('Health JSON', definition.statusPath, true),
    tags: definition.tags,
    meta: {
      pluginId: definition.pluginId,
      enabled: plugin?.enabled ?? false,
      loaded: plugin?.status.loaded ?? false,
      routesMounted: plugin?.status.routesMounted ?? [],
      host: 'Agent Gateway',
      source: 'internal-plugin',
    },
  };
}

async function toExternalRegistryEntry(
  definition: ExternalServiceDefinition,
  timeoutMs: number,
  fetchImpl: FetchLike,
): Promise<ServiceRegistryEntry> {
  const health = await probeExternalService(definition, timeoutMs, fetchImpl);

  return applyServiceClassification({
    id: definition.id,
    name: definition.name,
    serviceType: 'external-http',
    category: definition.category,
    description: definition.description,
    status: health.status,
    visibility: 'ambient',
    relevanceScore: 0,
    relevanceReason: '',
    family: { key: slugify(definition.name), name: definition.name, memberCount: 1 },
    health,
    link: createLink('Open service', definition.appUrl, true),
    healthLink: health.endpoint ? createLink('Health endpoint', health.endpoint, true) : undefined,
    tags: definition.tags,
    meta: {
      appUrl: definition.appUrl,
      healthUrls: definition.healthUrls,
      host: definition.host ?? 'Agent Gateway',
      source: 'curated',
      ...(definition.meta ?? {}),
    },
  });
}

async function parseListenerSnapshot(raw: string, config: HostDiscoveryConfig, fetchImpl: FetchLike): Promise<DiscoveredListener[]> {
  const listenerRows = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split('|').map((part) => part.trim()))
    .map(([bindAddress = '', portText = '', processName = '', pidText = '']) => ({ bindAddress, portText, processName, pidText }))
    .filter(({ portText }) => {
      const port = Number.parseInt(portText, 10);
      return Number.isFinite(port) && port > 0;
    });

  const listeners = await mapWithConcurrency(listenerRows, SERVICE_PROBE_CONCURRENCY, async ({ bindAddress, portText, processName, pidText }) => {
    const port = Number.parseInt(portText, 10);
    const normalizedBind = bindAddress || '127.0.0.1';
    const localHost = normalizedBind === '*' || normalizedBind === '0.0.0.0' || normalizedBind === '[::]' ? '127.0.0.1' : normalizedBind.replace(/^\[|\]$/g, '');
    const preferredPublicHost = config.publicHost && !normalizedBind.startsWith('127.') && !normalizedBind.startsWith('::1') ? config.publicHost : undefined;
    const publicUrl = preferredPublicHost ? `http://${preferredPublicHost}:${port}` : undefined;
    const localUrl = `http://${localHost}:${port}`;
    const processLabel = processName || 'service';
    const known = KNOWN_SERVICE_MAP[`${config.id}:${port}`];
    const knownPublicUrl = known?.publicUrl
      ? preferRuntimeTailnetUrl(known.publicUrl, publicUrl ?? localUrl, port)
      : undefined;
    const knownLocalUrl = known?.localUrl ?? localUrl;
    const knownHealthUrls = known?.healthUrls?.map((url) => preferRuntimeTailnetUrl(url, publicUrl ?? localUrl));
    const probeUrl = knownPublicUrl ?? publicUrl ?? knownLocalUrl;
    const probe = known ? {} : await probeListenerIdentity(probeUrl, 750, fetchImpl);
    const name = known?.name ?? prettifyDiscoveredName(processLabel, port, probe);

    return {
      hostId: config.id,
      hostLabel: config.label,
      name,
      processName: processLabel,
      pid: Number.isFinite(Number.parseInt(pidText, 10)) ? Number.parseInt(pidText, 10) : undefined,
      port,
      bindAddress: normalizedBind,
      publicUrl: knownPublicUrl ?? publicUrl,
      localUrl: knownLocalUrl,
      category: known?.category ?? guessCategory(processLabel, port),
      tags: Array.from(new Set(['auto-discovered', config.id, processLabel.toLowerCase(), ...(known?.tags ?? [])])).filter(Boolean),
      description: known?.description ?? '',
      healthUrls: knownHealthUrls ?? [knownPublicUrl ?? publicUrl ?? localUrl],
      detectedTitle: probe.title,
      detectedServerHeader: probe.serverHeader,
      detectedContentType: probe.contentType,
      detectedRedirectTarget: probe.redirectTarget,
      detectedHint: probe.hint,
    };
  });

  return listeners.map((listener) => ({
    ...listener,
    description: listener.description || buildDiscoveredDescription(listener),
  }));
}

async function discoverHostListeners(config: HostDiscoveryConfig, fetchImpl: FetchLike): Promise<DiscoveredListener[]> {
  if (!config.enabled) {
    return [];
  }

  const command = `python3 - <<'PY'\nimport shutil\nimport subprocess\n\ndef emit(bind, port, name='', pid=''):\n    if bind and port:\n        print(f"{bind}|{port}|{name}|{pid}")\n\ndef parse_host_port(local):\n    local = local.strip()\n    if local.endswith(' (LISTEN)'):\n        local = local[:-9].strip()\n    if local.startswith('[') and ']:' in local:\n        bind, port = local.rsplit(']:', 1)\n        return bind + ']', port\n    if ':' not in local:\n        return '', ''\n    return local.rsplit(':', 1)\n\nif shutil.which('ss'):\n    out = subprocess.check_output(['ss', '-ltnpH'], text=True, stderr=subprocess.DEVNULL)\n    for raw in out.splitlines():\n        parts = raw.split()\n        if len(parts) < 5:\n            continue\n        bind, port = parse_host_port(parts[3])\n        proc = parts[-1] if len(parts) >= 6 else ''\n        name = ''\n        pid = ''\n        if 'users:(("' in proc:\n            try:\n                frag = proc.split('users:(("', 1)[1]\n                name = frag.split('"', 1)[0]\n                if 'pid=' in frag:\n                    pid = frag.split('pid=', 1)[1].split(',', 1)[0].split(')', 1)[0]\n            except Exception:\n                pass\n        emit(bind, port, name, pid)\nelif shutil.which('lsof'):\n    out = subprocess.check_output(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN'], text=True, stderr=subprocess.DEVNULL)\n    for raw in out.splitlines()[1:]:\n        parts = raw.split(None, 8)\n        if len(parts) < 9:\n            continue\n        name = parts[0]\n        pid = parts[1]\n        bind, port = parse_host_port(parts[8])\n        emit(bind, port, name, pid)\nPY`;

  try {
    const result = config.sshTarget
      ? await execFileAsync('ssh', buildSshExecArgs(config.sshTarget, command), { timeout: 20000, maxBuffer: 1024 * 1024 })
      : await execFileAsync('bash', ['-lc', command], { timeout: 20000, maxBuffer: 1024 * 1024 });

    return parseListenerSnapshot(result.stdout, config, fetchImpl);
  } catch {
    return [];
  }
}

function mergeCuratedAndDiscoveredServices(discovered: DiscoveredListener[]): ExternalServiceDefinition[] {
  const byId = new Map<string, ExternalServiceDefinition>();

  for (const listener of discovered) {
    const appUrl = listener.publicUrl ?? listener.localUrl;
    byId.set(`${listener.hostId}-${listener.port}`, {
      kind: 'external-http',
      id: `${listener.hostId}-${slugify(listener.processName || 'service')}-${listener.port}`,
      name: KNOWN_SERVICE_MAP[`${listener.hostId}:${listener.port}`]?.name ?? listener.name,
      description: listener.description,
      category: listener.category,
      appUrl,
      healthUrls: listener.healthUrls.filter(Boolean),
      tags: listener.tags,
      host: listener.hostLabel,
      meta: {
        processName: listener.processName,
        pid: listener.pid,
        bindAddress: listener.bindAddress,
        localUrl: listener.localUrl,
        publicUrl: listener.publicUrl,
        detectedTitle: listener.detectedTitle,
        detectedServerHeader: listener.detectedServerHeader,
        detectedContentType: listener.detectedContentType,
        detectedRedirectTarget: listener.detectedRedirectTarget,
        detectedHint: listener.detectedHint,
        source: 'auto-discovered',
      },
    });
  }

  return Array.from(byId.values()).sort((left, right) => left.name.localeCompare(right.name));
}

export async function buildServicesRegistry(
  context: Pick<PluginRouteContext, 'plugin' | 'registry'>,
  fetchImpl: FetchLike = fetch,
  runtimeBaseUrl = '',
): Promise<ServiceRegistryPayload> {
  const currentPlugin = context.registry.get(context.plugin.id) ?? context.plugin;
  const timeoutMs = readNumberSetting(currentPlugin.settings, 'requestTimeoutMs', DEFAULT_REQUEST_TIMEOUT_MS);
  const runtimeEntityBaseUrl = normalizeRuntimeBaseUrl(runtimeBaseUrl);
  const runtimeHost = getUrlHostname(runtimeEntityBaseUrl);
  const definitions = buildServiceDefinitions(currentPlugin.settings, runtimeEntityBaseUrl);

  const macDiscoverySshTarget = readStringSetting(currentPlugin.settings, 'macDiscoverySshTarget', undefined);
  const hosts: HostDiscoveryConfig[] = [
    {
      id: 'gateway',
      label: 'Agent Gateway',
      publicHost: runtimeHost || '127.0.0.1',
      enabled: readBooleanSetting(currentPlugin.settings, 'discoverGatewayServices', true),
    },
    {
      id: 'mac',
      label: 'Mac',
      sshTarget: macDiscoverySshTarget,
      publicHost: readStringSetting(currentPlugin.settings, 'macDiscoveryPublicHost', undefined) || '',
      enabled: Boolean(macDiscoverySshTarget) && readBooleanSetting(currentPlugin.settings, 'discoverMacServices', true),
    },
  ];

  const discoveredGroups = await Promise.all(hosts.map((host) => discoverHostListeners(host, fetchImpl)));
  const discoveredServices = mergeCuratedAndDiscoveredServices(discoveredGroups.flat());

  const internalServices = definitions
    .filter((definition): definition is InternalPluginDefinition => definition.kind === 'internal-plugin')
    .map((definition) => toInternalRegistryEntry(definition, context.registry.get(definition.pluginId)));
  const externalDefinitions = definitions.filter((definition): definition is ExternalServiceDefinition => definition.kind === 'external-http');
  const externalServices = await mapWithConcurrency(
    [...externalDefinitions, ...discoveredServices],
    SERVICE_PROBE_CONCURRENCY,
    (definition) => toExternalRegistryEntry(definition, timeoutMs, fetchImpl),
  );
  const services: ServiceRegistryEntry[] = [...internalServices, ...externalServices];

  const classifiedServices = applyFamilyCounts(services);
  classifiedServices.sort((left, right) =>
    right.relevanceScore - left.relevanceScore ||
    left.family.name.localeCompare(right.family.name) ||
    left.name.localeCompare(right.name),
  );

  const summary = createSummary();
  for (const service of classifiedServices) {
    summary[service.status] += 1;
  }

  return {
    plugin: {
      id: currentPlugin.id,
      name: currentPlugin.name,
      enabled: currentPlugin.enabled,
      kind: currentPlugin.kind,
      settings: currentPlugin.settings,
    },
    summary,
    checkedAt: new Date().toISOString(),
    services: classifiedServices,
    state: 'ready',
    partial: false,
  };
}

function buildServicesRegistrySkeleton(
  context: Pick<PluginRouteContext, 'plugin' | 'registry'>,
  runtimeBaseUrl: string,
): ServiceRegistryPayload {
  const currentPlugin = context.registry.get(context.plugin.id) ?? context.plugin;
  const definitions = buildServiceDefinitions(currentPlugin.settings, normalizeRuntimeBaseUrl(runtimeBaseUrl));
  const services = applyFamilyCounts(
    definitions
      .filter((definition): definition is InternalPluginDefinition => definition.kind === 'internal-plugin')
      .map((definition) => toInternalRegistryEntry(definition, context.registry.get(definition.pluginId))),
  );
  const summary = createSummary();
  for (const service of services) summary[service.status] += 1;
  return {
    plugin: {
      id: currentPlugin.id,
      name: currentPlugin.name,
      enabled: currentPlugin.enabled,
      kind: currentPlugin.kind,
      settings: currentPlugin.settings,
    },
    summary,
    checkedAt: new Date().toISOString(),
    services,
    state: 'refreshing',
    partial: true,
  };
}

export async function getCachedServicesRegistry(
  context: PluginRouteContext,
  runtimeBaseUrl: string,
  buildRegistry: typeof buildServicesRegistry = buildServicesRegistry,
): Promise<ServiceRegistryPayload> {
  const currentPlugin = context.registry.get(context.plugin.id) ?? context.plugin;
  const key = createCacheKey(currentPlugin, normalizeRuntimeBaseUrl(runtimeBaseUrl));
  const now = Date.now();
  const cached = registryCache.get(key);

  if (isFreshCache(cached, now)) {
    return cached!.payload;
  }

  const skeleton = buildServicesRegistrySkeleton(context, runtimeBaseUrl);
  if (!refreshesInFlight.has(key) && refreshesInFlight.size >= MAX_REGISTRY_CACHE_KEYS && isUsableStaleCache(cached, now)) {
    return cached!.payload;
  }
  if (!refreshesInFlight.has(key) && refreshesInFlight.size >= MAX_REGISTRY_CACHE_KEYS) {
    return {
      ...skeleton,
      state: 'error',
      refreshError: 'Services discovery is at capacity; retry shortly.',
    };
  }
  if (!refreshesInFlight.has(key)) {
    const refresh = buildRegistry(context, fetch, runtimeBaseUrl)
      .then((payload) => {
        setRegistryCache(key, { payload, createdAt: Date.now() });
        return payload;
      })
      .catch((error: unknown) => {
        const previous = registryCache.get(key)?.payload ?? skeleton;
        const failed: ServiceRegistryPayload = {
          ...previous,
          state: 'error',
          refreshError: error instanceof Error ? error.message : String(error),
        };
        setRegistryCache(key, {
          payload: failed,
          createdAt: Date.now() - SERVICE_REGISTRY_CACHE_TTL_MS - 1,
        });
        return failed;
      })
      .finally(() => {
        if (refreshesInFlight.get(key) === refresh) {
          refreshesInFlight.delete(key);
        }
      });
    refreshesInFlight.set(key, refresh);
  }

  if (isUsableStaleCache(cached, now)) {
    return cached!.payload;
  }

  setRegistryCache(key, {
    payload: skeleton,
    createdAt: now - SERVICE_REGISTRY_CACHE_TTL_MS - 1,
  });
  return skeleton;
}

export function registerPluginRoutes(router: Router, context: PluginRouteContext): void {
  const handler = async (req: Request, res: Response) => {
    return res.json(await getCachedServicesRegistry(context, deriveRuntimeOrigin(req)));
  };

  router.get('/', handler);
  router.get('/status', handler);
  router.get('/registry', handler);
}

export default registerPluginRoutes;
