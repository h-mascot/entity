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

let cachedRegistry: { key: string; payload: ServiceRegistryPayload; createdAt: number } | null = null;
let refreshInFlight: Promise<ServiceRegistryPayload> | null = null;

interface ListenerProbeSnapshot {
  title?: string;
  serverHeader?: string;
  contentType?: string;
  redirectTarget?: string;
  hint?: string;
}

const KNOWN_SERVICE_MAP: Record<string, Partial<DiscoveredListener> & { name: string }> = {
  'gateway:3000': {
    name: 'Entity',
    category: 'Operations',
    description: 'Entity production app and API.',
    tags: ['entity', 'prod'],
    publicUrl: 'http://100.106.69.9:3000',
    healthUrls: ['http://100.106.69.9:3000/api/tasks'],
  },
  'gateway:3002': {
    name: 'Enterprise Crew Admin',
    category: 'Operations',
    description: 'Crew administration surface embedded inside Entity workflows.',
    tags: ['enterprise', 'ops', 'crew-admin'],
    publicUrl: 'http://100.106.69.9:3002',
    healthUrls: ['http://100.106.69.9:3002/api/health', 'http://100.106.69.9:3002/health'],
  },
  'gateway:5678': {
    name: 'n8n',
    category: 'Automation',
    description: 'Workflow automation engine used for service orchestration.',
    tags: ['automation', 'workflows'],
    publicUrl: 'http://100.106.69.9:5678',
    healthUrls: ['http://100.106.69.9:5678/healthz', 'http://100.106.69.9:5678/healthz/readiness'],
  },
  'gateway:8222': {
    name: 'Vaultwarden',
    category: 'Security',
    description: 'Credential vault backing shared secrets and operator access.',
    tags: ['secrets', 'security'],
    localUrl: 'http://127.0.0.1:8222',
    healthUrls: ['http://127.0.0.1:8222/alive', 'http://127.0.0.1:8222/health', 'http://127.0.0.1:8222'],
  },
  'gateway:18789': {
    name: 'OpenClaw Gateway',
    category: 'Agent Runtime',
    description: 'Primary OpenClaw gateway runtime.',
    tags: ['openclaw', 'gateway'],
    localUrl: 'http://127.0.0.1:18789',
    healthUrls: ['http://127.0.0.1:18789/health', 'http://127.0.0.1:18789'],
  },
  'gateway:9377': {
    name: 'Camofox Browser Server',
    category: 'Automation',
    description: 'Browser automation server for anti-detection flows.',
    localUrl: 'http://127.0.0.1:9377',
    tags: ['browser', 'automation'],
    healthUrls: ['http://127.0.0.1:9377'],
  },
  'gateway:3004': {
    name: 'Kokoro Voice Server',
    category: 'Media',
    description: 'Streaming TTS runtime.',
    localUrl: 'http://127.0.0.1:3004',
    tags: ['tts', 'voice'],
    healthUrls: ['http://127.0.0.1:3004'],
  },
  'gateway:3030': {
    name: 'Ada Workspace Web Server',
    category: 'Operations',
    description: 'Workspace web server on gateway.',
    publicUrl: 'http://100.106.69.9:3030',
    tags: ['workspace', 'web'],
    healthUrls: ['http://100.106.69.9:3030'],
  },
  'gateway:8788': {
    name: 'Entity Services Helper 8788',
    category: 'Operations',
    description: 'Hosted Python service on gateway.',
    publicUrl: 'http://100.106.69.9:8788',
    tags: ['python', 'gateway'],
    healthUrls: ['http://100.106.69.9:8788'],
  },
  'gateway:8789': {
    name: 'Entity Services Helper 8789',
    category: 'Operations',
    description: 'Hosted Python service on gateway.',
    publicUrl: 'http://100.106.69.9:8789',
    tags: ['python', 'gateway'],
    healthUrls: ['http://100.106.69.9:8789'],
  },
  'gateway:7777': {
    name: 'Gateway Bun Service',
    category: 'Operations',
    description: 'Hosted Bun service on gateway.',
    publicUrl: 'http://100.106.69.9:7777',
    tags: ['bun', 'gateway'],
    healthUrls: ['http://100.106.69.9:7777'],
  },
  'mac:8100': {
    name: 'Geordi ACP Adapter',
    category: 'Agent Runtime',
    description: 'ACP adapter for Geordi on the Mac.',
    publicUrl: 'http://100.86.150.96:8100',
    tags: ['acp', 'geordi', 'agent'],
    healthUrls: ['http://100.86.150.96:8100'],
  },
  'mac:3001': {
    name: 'Mac App Server',
    category: 'Operations',
    description: 'Hosted Node service on MascotM3.',
    publicUrl: 'http://100.86.150.96:3001',
    tags: ['node', 'mac'],
    healthUrls: ['http://100.86.150.96:3001'],
  },
  'mac:4747': {
    name: 'Mac Dev Server',
    category: 'Development',
    description: 'Hosted Node development server on MascotM3.',
    publicUrl: 'http://100.86.150.96:4747',
    tags: ['node', 'dev', 'mac'],
    healthUrls: ['http://100.86.150.96:4747'],
  },
  'mac:8765': {
    name: 'Mac Python Service',
    category: 'Development',
    description: 'Hosted Python service on MascotM3.',
    publicUrl: 'http://100.86.150.96:8765',
    tags: ['python', 'mac'],
    healthUrls: ['http://100.86.150.96:8765'],
  },
  'mac:8881': {
    name: 'Mac Python Service 8881',
    category: 'Development',
    description: 'Hosted Python service on MascotM3.',
    publicUrl: 'http://100.86.150.96:8881',
    tags: ['python', 'mac'],
    healthUrls: ['http://100.86.150.96:8881'],
  },
  'mac:7000': {
    name: 'Control Center 7000',
    category: 'Operations',
    description: 'Hosted desktop control service on MascotM3.',
    publicUrl: 'http://100.86.150.96:7000',
    tags: ['control-center', 'mac'],
    healthUrls: ['http://100.86.150.96:7000'],
  },
  'mac:5000': {
    name: 'Control Center 5000',
    category: 'Operations',
    description: 'Hosted desktop control service on MascotM3.',
    publicUrl: 'http://100.86.150.96:5000',
    tags: ['control-center', 'mac'],
    healthUrls: ['http://100.86.150.96:5000'],
  },
  'mac:11434': {
    name: 'Ollama',
    category: 'AI Runtime',
    description: 'Local model runtime on MascotM3.',
    localUrl: 'http://127.0.0.1:11434',
    tags: ['llm', 'ollama', 'mac'],
    healthUrls: ['http://127.0.0.1:11434/api/tags', 'http://127.0.0.1:11434'],
  },
};

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

  if (source === 'curated') {
    return { visibility: 'managed', relevanceScore: 95, relevanceReason: 'Curated service definition' };
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

function isFreshCache(key: string, now: number): boolean {
  return Boolean(cachedRegistry && cachedRegistry.key === key && now - cachedRegistry.createdAt < SERVICE_REGISTRY_CACHE_TTL_MS);
}

function isUsableStaleCache(key: string, now: number): boolean {
  return Boolean(cachedRegistry && cachedRegistry.key === key && now - cachedRegistry.createdAt < SERVICE_REGISTRY_CACHE_STALE_MS);
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
  const configuredEnterpriseAdminUrl = readStringSetting(
    settings,
    'enterpriseAdminUrl',
    entityBaseUrl ? `${getUrlProtocol(entityBaseUrl)}//${getUrlHostname(entityBaseUrl)}:3002` : 'http://127.0.0.1:3002',
  );
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
    {
      kind: 'external-http',
      id: 'enterprise-crew-admin',
      name: 'Enterprise Crew Admin',
      description: 'Standalone crew admin app linked from Entity services instead of embedded app-shell wiring.',
      category: 'Operations',
      appUrl: enterpriseAdminUrl,
      healthUrls: [
        joinUrl(enterpriseAdminUrl, '/api/health'),
        joinUrl(enterpriseAdminUrl, '/health'),
        enterpriseAdminUrl,
      ],
      tags: ['enterprise', 'ops', 'crew-admin', 'external-app'],
      host: 'Enterprise',
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
      host: 'Ada Gateway',
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
      host: definition.host ?? 'Ada Gateway',
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
      ? await execFileAsync('ssh', ['-o', 'ConnectTimeout=10', config.sshTarget, command], { timeout: 20000, maxBuffer: 1024 * 1024 })
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

  const hosts: HostDiscoveryConfig[] = [
    {
      id: 'gateway',
      label: 'Ada Gateway',
      publicHost: runtimeHost || '127.0.0.1',
      enabled: readBooleanSetting(currentPlugin.settings, 'discoverGatewayServices', true),
    },
    {
      id: 'mac',
      label: 'MascotM3',
      sshTarget: readStringSetting(currentPlugin.settings, 'macDiscoverySshTarget', 'henrymascot@100.86.150.96'),
      publicHost: '100.86.150.96',
      enabled: readBooleanSetting(currentPlugin.settings, 'discoverMacServices', true),
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
  };
}

async function getCachedServicesRegistry(context: PluginRouteContext, runtimeBaseUrl: string): Promise<ServiceRegistryPayload> {
  const currentPlugin = context.registry.get(context.plugin.id) ?? context.plugin;
  const key = createCacheKey(currentPlugin, normalizeRuntimeBaseUrl(runtimeBaseUrl));
  const now = Date.now();

  if (isFreshCache(key, now) && cachedRegistry) {
    return cachedRegistry.payload;
  }

  if (!refreshInFlight) {
    refreshInFlight = buildServicesRegistry(context, fetch, runtimeBaseUrl)
      .then((payload) => {
        cachedRegistry = { key, payload, createdAt: Date.now() };
        return payload;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }

  if (isUsableStaleCache(key, now) && cachedRegistry) {
    return cachedRegistry.payload;
  }

  return refreshInFlight;
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
