import { readdir, readFile } from 'fs/promises';
import { homedir } from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface ChatModelOption {
  id: string;
  name: string;
  provider: string;
  isLocal: boolean;
  local?: boolean;
  available?: boolean;
  allowed?: boolean;
  source?: string;
}

export interface AgentModelSet {
  agent: string;
  defaultModel?: string;
  models: ChatModelOption[];
  source: string;
  checkedAt: string;
  stale: boolean;
  error?: string;
}

export interface ChatModelsResponse {
  agent?: string;
  agents?: Record<string, AgentModelSet>;
  defaultModel?: string;
  models?: ChatModelOption[];
  cloud: ChatModelOption[];
  local: ChatModelOption[];
  localInventory: ChatModelOption[];
  checkedAt: string;
  cacheTtlMs: number;
  source: string;
  stale: boolean;
}

export interface ChatModelRegistryOptions {
  openClawBaseUrl?: string;
  openClawCommand?: string;
  localInventory: () => Promise<ChatModelOption[]>;
  now?: () => Date;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

interface CachedAgentModels {
  value: AgentModelSet;
  checkedAtMs: number;
}

const AGENT_MODEL_CACHE_TTL_MS = 60_000;
const AGENT_MODEL_FETCH_TIMEOUT_MS = 750;
const HERMES_AGENT_IDS = new Set(['book', 'hermes']);
const OPENCLAW_AGENT_IDS = new Set(['ada', 'zora', 'spock', 'scotty', 'geordi', 'midas', 'uhura']);
const OPENCLAW_LOCAL_PROVIDERS = new Set([
  'ollama',
  'mlx',
  'mlxstudio',
  'enterprise-local',
  'enterprise-vmlx',
  'openai-local-minimax',
  'omlx',
  'omlx-udq4',
  'llamacpp',
  'vmlx',
]);

const FALLBACK_AGENT_MODELS: Record<string, Array<Omit<ChatModelOption, 'allowed' | 'available' | 'source'>>> = {
  assistant: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeAgentId(agent: string): string {
  return agent.trim().toLowerCase();
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim().replace(/\/+$/, '');
  return trimmed || undefined;
}

function providerFromModelId(id: string): string {
  const [provider] = id.split('/');
  return provider || 'unknown';
}

function prettifyModelName(id: string): string {
  const raw = id.split('/').slice(1).join('/') || id;
  return raw
    .replace(/:latest$/, '')
    .split(/[-_:.\/]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function normalizeChatModel(value: unknown, source: string): ChatModelOption | null {
  if (typeof value === 'string') {
    const id = value.trim();
    if (!id) return null;
    const provider = providerFromModelId(id);
    const isLocal = provider === 'ollama' || provider === 'mlx' || provider === 'local';
    return { id, name: prettifyModelName(id), provider, isLocal, local: isLocal, allowed: true, available: !isLocal, source };
  }

  if (!isRecord(value)) return null;
  const rawId = value.id ?? value.model ?? value.name;
  if (typeof rawId !== 'string' || !rawId.trim()) return null;
  const id = rawId.trim();
  const provider = typeof value.provider === 'string' && value.provider.trim() ? value.provider.trim() : providerFromModelId(id);
  const isLocal = Boolean(value.isLocal ?? value.local ?? (provider === 'ollama' || provider === 'mlx' || provider === 'local'));
  return {
    id,
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : prettifyModelName(id),
    provider,
    isLocal,
    local: isLocal,
    available: typeof value.available === 'boolean' ? value.available : !isLocal,
    allowed: true,
    source,
  };
}

function uniqueModels(models: ChatModelOption[]): ChatModelOption[] {
  const seen = new Set<string>();
  const out: ChatModelOption[] = [];
  for (const model of models) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    out.push(model);
  }
  return out;
}

function parseModelPayload(payload: unknown, source: string): { models: ChatModelOption[]; defaultModel?: string } {
  const candidates: unknown[] = [];
  let defaultModel: string | undefined;

  if (Array.isArray(payload)) {
    candidates.push(...payload);
  } else if (isRecord(payload)) {
    if (typeof payload.defaultModel === 'string') defaultModel = payload.defaultModel;
    if (typeof payload.model === 'string') defaultModel = defaultModel ?? payload.model;
    for (const key of ['models', 'data', 'availableModels', 'modelOptions', 'cloud', 'local']) {
      const value = payload[key];
      if (Array.isArray(value)) candidates.push(...value);
    }
    if (isRecord(payload.agent) && Array.isArray(payload.agent.models)) candidates.push(...payload.agent.models);
  }

  return { models: uniqueModels(candidates.map((entry) => normalizeChatModel(entry, source)).filter(Boolean) as ChatModelOption[]), defaultModel };
}

function openClawAuthHeaders(env: NodeJS.ProcessEnv | undefined): Record<string, string> {
  const token = env?.OPENCLAW_GATEWAY_TOKEN ?? env?.OPENCLAW_TOKEN ?? env?.ENTITY_OPENCLAW_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchJson(fetchImpl: typeof fetch, url: string, headers?: Record<string, string>): Promise<unknown | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AGENT_MODEL_FETCH_TIMEOUT_MS);
  timeout.unref?.();
  try {
    const res = await fetchImpl(url, { signal: controller.signal, headers });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadOpenClawModels(agent: string, options: ChatModelRegistryOptions): Promise<{ models: ChatModelOption[]; defaultModel?: string; source: string } | null> {
  const configModels = await loadOpenClawConfigModels(agent, options);
  if (configModels) return configModels;

  const cliModels = await loadOpenClawCliModels(agent, options);
  if (cliModels) return cliModels;

  const bases = Array.from(new Set([
    options.openClawBaseUrl,
    options.env?.OPENCLAW,
    options.env?.OPENCLAW_BASE_URL,
    options.env?.ENTITY_OPENCLAW_BASE_URL,
    'http://127.0.0.1:18789',
  ].map(normalizeBaseUrl).filter(Boolean) as string[]));
  if (bases.length === 0) return null;
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = openClawAuthHeaders(options.env);
  const encoded = encodeURIComponent(agent);
  for (const base of bases) {
    const endpoints = [
      `${base}/api/agents/${encoded}/models`,
      `${base}/api/chat/models?agent=${encoded}`,
      `${base}/agents/${encoded}/models`,
      `${base}/models?agent=${encoded}`,
      `${base}/v1/models?agent=${encoded}`,
      `${base}/v1/models`,
    ];
    for (const endpoint of endpoints) {
      const payload = await fetchJson(fetchImpl, endpoint, headers);
      if (!payload) continue;
      const parsed = parseModelPayload(payload, 'openclaw');
      if (parsed.models.length > 0) return { ...parsed, source: 'openclaw' };
    }
  }
  return null;
}

function modelFromOpenClawProviderConfig(provider: string, entry: unknown, source: string): ChatModelOption | null {
  if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id.trim()) return null;
  const providerId = provider.trim();
  const modelId = entry.id.trim();
  const id = modelId.startsWith(`${providerId}/`) ? modelId : `${providerId}/${modelId}`;
  const isLocal = OPENCLAW_LOCAL_PROVIDERS.has(providerId) || providerId.includes('local') || providerId.startsWith('omlx');
  return normalizeChatModel({
    id,
    name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : prettifyModelName(id),
    provider: providerId,
    local: isLocal,
    available: true,
  }, source);
}

function collectOpenClawProviderModels(config: unknown, source: string): ChatModelOption[] {
  if (!isRecord(config) || !isRecord(config.providers)) return [];
  const out: ChatModelOption[] = [];
  for (const [provider, providerConfig] of Object.entries(config.providers)) {
    if (!isRecord(providerConfig) || !Array.isArray(providerConfig.models)) continue;
    for (const entry of providerConfig.models) {
      const model = modelFromOpenClawProviderConfig(provider, entry, source);
      if (model) out.push(model);
    }
  }
  return out;
}

function collectConfiguredProviders(config: unknown): Set<string> {
  const providers = new Set<string>();
  if (!isRecord(config) || !isRecord(config.providers)) return providers;
  for (const provider of Object.keys(config.providers)) {
    providers.add(provider);
    if (provider === 'codex') providers.add('openai-codex');
  }
  return providers;
}

function collectDefaultModelPolicyModels(config: unknown): ChatModelOption[] {
  if (!isRecord(config) || !isRecord(config.agents) || !isRecord(config.agents.defaults)) return [];
  const modelConfig = config.agents.defaults.model;
  const ids: string[] = [];
  if (typeof modelConfig === 'string' && modelConfig.trim()) {
    ids.push(modelConfig.trim());
  } else if (isRecord(modelConfig)) {
    if (typeof modelConfig.primary === 'string' && modelConfig.primary.trim()) {
      ids.push(modelConfig.primary.trim());
    }
    if (Array.isArray(modelConfig.fallbacks)) {
      ids.push(...modelConfig.fallbacks.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())).map((entry) => entry.trim()));
    }
  }
  return uniqueModels(ids.map((id) => normalizeChatModel(id, 'openclaw-config')).filter(Boolean) as ChatModelOption[]);
}

function collectAuthProfileProviders(config: unknown): Set<string> {
  const providers = new Set<string>();
  if (!isRecord(config)) return providers;
  for (const sectionName of ['current', 'lastGood']) {
    const section = config[sectionName];
    if (!isRecord(section)) continue;
    for (const provider of Object.keys(section)) {
      providers.add(provider);
      if (provider === 'codex') providers.add('openai-codex');
    }
  }
  const profiles = config.profiles;
  if (isRecord(profiles)) {
    for (const profile of Object.values(profiles)) {
      if (!isRecord(profile) || typeof profile.provider !== 'string' || !profile.provider.trim()) continue;
      providers.add(profile.provider.trim());
      if (profile.provider.trim() === 'codex') providers.add('openai-codex');
    }
  }
  return providers;
}

function modelFromOpenClawCatalog(provider: string, entry: unknown): ChatModelOption | null {
  if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id.trim()) return null;
  const providerId = provider.trim();
  const modelId = entry.id.trim();
  const id = modelId.startsWith(`${providerId}/`) ? modelId : `${providerId}/${modelId}`;
  const isLocal = OPENCLAW_LOCAL_PROVIDERS.has(providerId) || providerId.includes('local') || providerId.startsWith('omlx');
  return normalizeChatModel({
    id,
    name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : prettifyModelName(id),
    provider: providerId,
    local: isLocal,
    available: !isLocal,
  }, 'openclaw-catalog');
}

async function findOpenClawModelCatalogPath(root: string): Promise<string | null> {
  const runtimeRoot = path.join(root, 'plugin-runtime-deps');
  let entries: string[];
  try {
    entries = await readdir(runtimeRoot);
  } catch {
    return null;
  }
  const candidates = entries
    .filter((entry) => entry.startsWith('openclaw-'))
    .sort()
    .reverse()
    .map((entry) => path.join(runtimeRoot, entry, 'node_modules', '@mariozechner', 'pi-ai', 'dist', 'models.generated.js'));
  for (const candidate of candidates) {
    try {
      await readFile(candidate, 'utf8');
      return candidate;
    } catch {
      // try next runtime bundle
    }
  }
  return null;
}

async function loadOpenClawCatalogModels(root: string, providers: Set<string>): Promise<ChatModelOption[]> {
  const requested = Array.from(providers).filter((provider) => provider && provider !== 'openrouter');
  if (requested.length === 0) return [];
  const catalogPath = await findOpenClawModelCatalogPath(root);
  if (!catalogPath) return [];
  try {
    const source = await readFile(catalogPath, 'utf8');
    const transformed = source
      .replace(/export\s+const\s+MODELS\s*=\s*/, 'exports.MODELS = ')
      .replace(/\/\/#[^\n]*sourceMappingURL=.*$/m, '');
    const exportsObject: { MODELS?: Record<string, Record<string, unknown>> } = {};
    // Trusted local OpenClaw dependency artifact. This avoids spawning the slow OpenClaw CLI on the request path.
    new Function('exports', transformed)(exportsObject);
    const out: ChatModelOption[] = [];
    for (const provider of requested) {
      const models = exportsObject.MODELS?.[provider];
      if (!models) continue;
      for (const entry of Object.values(models)) {
        const model = modelFromOpenClawCatalog(provider, entry);
        if (model) out.push(model);
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function readOptionalJson(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function defaultModelFromOpenClawConfig(config: unknown): string | undefined {
  if (!isRecord(config) || !isRecord(config.agents) || !isRecord(config.agents.defaults)) return undefined;
  const modelConfig = config.agents.defaults.model;
  if (typeof modelConfig === 'string' && modelConfig.trim()) return modelConfig.trim();
  if (isRecord(modelConfig) && typeof modelConfig.primary === 'string' && modelConfig.primary.trim()) return modelConfig.primary.trim();
  return undefined;
}

async function loadOpenClawConfigModels(agent: string, options: ChatModelRegistryOptions): Promise<{ models: ChatModelOption[]; defaultModel?: string; source: string } | null> {
  const root = options.env?.OPENCLAW_HOME || path.join(homedir(), '.openclaw');
  const globalConfigPath = options.env?.OPENCLAW_CONFIG_PATH || path.join(root, 'openclaw.json');
  const agentRoots = agent === 'ada'
    ? [path.join(root, 'agents', agent, 'agent'), path.join(root, 'agents', 'main', 'agent')]
    : [path.join(root, 'agents', agent, 'agent')];
  const agentModelsPaths = options.env?.OPENCLAW_AGENT_MODELS_PATH
    ? [options.env.OPENCLAW_AGENT_MODELS_PATH]
    : agentRoots.map((agentRoot) => path.join(agentRoot, 'models.json'));
  const agentAuthProfilesPaths = options.env?.OPENCLAW_AGENT_AUTH_PROFILES_PATH
    ? [options.env.OPENCLAW_AGENT_AUTH_PROFILES_PATH]
    : agentRoots.map((agentRoot) => path.join(agentRoot, 'auth-profiles.json'));

  const [globalConfig, agentModelConfigs, agentAuthProfilesConfigs] = await Promise.all([
    readOptionalJson(globalConfigPath),
    Promise.all(agentModelsPaths.map((filePath) => readOptionalJson(filePath))),
    Promise.all(agentAuthProfilesPaths.map((filePath) => readOptionalJson(filePath))),
  ]);

  const globalModels = isRecord(globalConfig) && isRecord(globalConfig.models)
    ? collectOpenClawProviderModels(globalConfig.models, 'openclaw-config')
    : [];
  const defaultPolicyModels = collectDefaultModelPolicyModels(globalConfig);
  const agentModels = agentModelConfigs.flatMap((agentModelConfig) => collectOpenClawProviderModels(agentModelConfig, 'openclaw-agent-config'));
  const catalogProviders = new Set<string>([
    ...Array.from(defaultPolicyModels.map((model) => model.provider)),
    ...Array.from(isRecord(globalConfig) && isRecord(globalConfig.models) ? collectConfiguredProviders(globalConfig.models) : new Set<string>()),
    ...Array.from(isRecord(globalConfig) && isRecord(globalConfig.auth) ? collectAuthProfileProviders(globalConfig.auth) : new Set<string>()),
    ...agentModelConfigs.flatMap((agentModelConfig) => Array.from(collectConfiguredProviders(agentModelConfig))),
    ...agentAuthProfilesConfigs.flatMap((agentAuthProfiles) => Array.from(collectAuthProfileProviders(agentAuthProfiles))),
  ]);
  const catalogModels = await loadOpenClawCatalogModels(root, catalogProviders);
  const models = uniqueModels([...agentModels, ...globalModels, ...defaultPolicyModels, ...catalogModels]);
  if (models.length === 0) return null;

  return {
    models,
    defaultModel: defaultModelFromOpenClawConfig(globalConfig) ?? models[0]?.id,
    source: 'openclaw-config',
  };
}

async function runOpenClawJson(command: string, args: string[], env: NodeJS.ProcessEnv | undefined): Promise<unknown | null> {
  try {
    const result = await execFileAsync(command, args, {
      env: { ...process.env, ...env },
      timeout: 45_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return JSON.parse(result.stdout) as unknown;
  } catch {
    return null;
  }
}

async function loadOpenClawCliModels(agent: string, options: ChatModelRegistryOptions): Promise<{ models: ChatModelOption[]; defaultModel?: string; source: string } | null> {
  const command = options.openClawCommand ?? options.env?.OPENCLAW_CLI ?? 'openclaw';
  const modelPayload = await runOpenClawJson(command, ['models', '--agent', agent, 'list', '--json'], options.env);
  if (!isRecord(modelPayload) || !Array.isArray(modelPayload.models)) return null;

  const models = uniqueModels(modelPayload.models
    .map((entry) => {
      if (!isRecord(entry)) return null;
      const key = typeof entry.key === 'string' ? entry.key : typeof entry.id === 'string' ? entry.id : undefined;
      if (!key) return null;
      const model = normalizeChatModel({
        id: key,
        name: typeof entry.name === 'string' ? entry.name : key,
        provider: providerFromModelId(key),
        local: Boolean(entry.local),
        available: typeof entry.available === 'boolean' ? entry.available : !entry.local,
      }, 'openclaw-cli');
      return model;
    })
    .filter(Boolean) as ChatModelOption[]);
  if (models.length === 0) return null;

  const statusPayload = await runOpenClawJson(command, ['models', '--agent', agent, 'status', '--json'], options.env);
  const defaultFromStatus = isRecord(statusPayload) && typeof statusPayload.resolvedDefault === 'string'
    ? statusPayload.resolvedDefault
    : isRecord(statusPayload) && typeof statusPayload.defaultModel === 'string'
      ? statusPayload.defaultModel
      : undefined;
  const defaultFromTags = modelPayload.models.find((entry) => isRecord(entry)
    && Array.isArray(entry.tags)
    && entry.tags.includes('default'));
  const defaultFromList = isRecord(defaultFromTags) && typeof defaultFromTags.key === 'string' ? defaultFromTags.key : undefined;

  return { models, defaultModel: defaultFromStatus ?? defaultFromList ?? models[0]?.id, source: 'openclaw-cli' };
}

function parseEnvAgentModels(agent: string, env: NodeJS.ProcessEnv | undefined): { models: ChatModelOption[]; defaultModel?: string; source: string } | null {
  const raw = env?.ENTITY_CHAT_AGENT_MODELS_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    const entry = parsed[agent];
    const payload = entry ?? parsed[agent.toUpperCase()];
    if (!payload) return null;
    const out = parseModelPayload(payload, 'config');
    return out.models.length > 0 ? { ...out, source: 'config' } : null;
  } catch {
    return null;
  }
}

function isHermesLocalProvider(provider: string): boolean {
  const normalized = provider.trim().toLowerCase();
  return normalized === 'ollama'
    || normalized === 'vmlx'
    || normalized.startsWith('llamacpp')
    || normalized.includes('local');
}

function normalizeProviderModel(provider: string, model: string, source: string, isLocal: boolean): ChatModelOption | null {
  const providerId = provider.trim();
  const modelId = model.trim();
  if (!providerId || !modelId) return null;
  const id = modelId.startsWith(`${providerId}/`) ? modelId : `${providerId}/${modelId}`;
  return normalizeChatModel({
    id,
    name: prettifyModelName(modelId),
    provider: providerId,
    local: isLocal,
    available: true,
  }, source);
}

function parseHermesConfigModels(text: string): { models: ChatModelOption[]; defaultModel?: string } {
  const providerFromDefault = text.match(/^\s*provider\s*:\s*['"]?([^'"#\n]+)['"]?/m)?.[1]?.trim();
  const defaultValue = text.match(/^\s*default\s*:\s*['"]?([^'"#\n]+)['"]?/m)?.[1]?.trim();
  const models: ChatModelOption[] = [];

  let inProviders = false;
  let currentProvider = '';
  let inModels = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inProviders = line.trim() === 'providers:';
      currentProvider = '';
      inModels = false;
      continue;
    }
    if (!inProviders) continue;

    const providerMatch = line.match(/^  ([A-Za-z0-9_.-]+):\s*$/);
    if (providerMatch) {
      currentProvider = providerMatch[1].trim();
      inModels = false;
      continue;
    }
    if (!currentProvider) continue;
    if (/^\s+models\s*:\s*$/.test(line)) {
      inModels = true;
      continue;
    }
    if (inModels) {
      const modelValue = line.match(/^\s*-\s*['"]?([^'"#\n]+)['"]?/)?.[1]?.trim();
      if (!modelValue) {
        if (/^\s+\S/.test(line)) inModels = false;
        continue;
      }
      const model = normalizeProviderModel(currentProvider, modelValue, 'hermes-config', isHermesLocalProvider(currentProvider));
      if (model) models.push(model);
    }
  }

  const defaultModel = defaultValue
    ? defaultValue.includes('/') || !providerFromDefault
      ? defaultValue
      : `${providerFromDefault}/${defaultValue}`
    : undefined;

  return { models: uniqueModels(models), defaultModel };
}

async function loadHermesModels(agent: string, options: ChatModelRegistryOptions): Promise<{ models: ChatModelOption[]; defaultModel?: string; source: string } | null> {
  const envConfigured = parseEnvAgentModels(agent, options.env);
  if (envConfigured) return envConfigured;

  const rawList = options.env?.HERMES_MODEL_LIST ?? options.env?.HERMES_MODELS;
  if (rawList) {
    const models = uniqueModels(rawList.split(',').map((entry) => normalizeChatModel(entry.trim(), 'hermes')).filter(Boolean) as ChatModelOption[]);
    if (models.length > 0) return { models, defaultModel: options.env?.HERMES_MODEL ?? models[0]?.id, source: 'hermes' };
  }

  const configPath = options.env?.HERMES_CONFIG_PATH || path.join(homedir(), '.hermes', 'config.yaml');
  try {
    const text = await readFile(configPath, 'utf8');
    const parsedConfig = parseHermesConfigModels(text);
    if (parsedConfig.models.length > 0) return { ...parsedConfig, source: 'hermes-config' };

    const matches = Array.from(text.matchAll(/^\s*model\s*:\s*['"]?([^'"#\n]+)['"]?/gm))
      .map((match) => match[1]?.trim())
      .filter(Boolean) as string[];
    const models = uniqueModels(matches.map((entry) => normalizeChatModel(entry, 'hermes')).filter(Boolean) as ChatModelOption[]);
    if (models.length > 0) return { models, defaultModel: models[0].id, source: 'hermes' };
  } catch {
    // Hermes config is optional for non-Hermes runtimes.
  }

  return null;
}

function fallbackModelsFor(agent: string): { models: ChatModelOption[]; defaultModel?: string; source: string } {
  const raw = FALLBACK_AGENT_MODELS[agent] ?? FALLBACK_AGENT_MODELS.assistant ?? [];
  const models = raw.map((model) => ({ ...model, local: model.isLocal, available: !model.isLocal, allowed: true, source: 'fallback' }));
  return { models, defaultModel: models[0]?.id, source: 'fallback' };
}

export class ChatModelRegistry {
  private cache = new Map<string, CachedAgentModels>();

  constructor(private readonly options: ChatModelRegistryOptions) {}

  async getAgentModels(agentInput: string): Promise<AgentModelSet> {
    const agent = normalizeAgentId(agentInput || 'assistant');
    const nowDate = this.options.now?.() ?? new Date();
    const now = nowDate.getTime();
    const cached = this.cache.get(agent);
    if (cached && now - cached.checkedAtMs < AGENT_MODEL_CACHE_TTL_MS) {
      return cached.value;
    }

    let loaded: { models: ChatModelOption[]; defaultModel?: string; source: string } | null = parseEnvAgentModels(agent, this.options.env);
    if (!loaded && HERMES_AGENT_IDS.has(agent)) loaded = await loadHermesModels(agent, this.options);
    if (!loaded && OPENCLAW_AGENT_IDS.has(agent)) loaded = await loadOpenClawModels(agent, this.options);
    if (!loaded) loaded = fallbackModelsFor(agent);

    const localInventory = await this.options.localInventory();
    const availableLocalIds = new Set(localInventory.map((model) => model.id));
    const models = uniqueModels(loaded.models).map((model) => ({
      ...model,
      allowed: true,
      available: loaded.source === 'openclaw-cli' || loaded.source === 'openclaw-config'
        ? model.available
        : model.isLocal ? availableLocalIds.has(model.id) : true,
      source: loaded.source,
    }));

    const value: AgentModelSet = {
      agent,
      defaultModel: loaded.defaultModel && models.some((model) => model.id === loaded.defaultModel) ? loaded.defaultModel : models[0]?.id,
      models,
      source: loaded.source,
      checkedAt: nowDate.toISOString(),
      stale: false,
    };
    this.cache.set(agent, { value, checkedAtMs: now });
    return value;
  }

  async buildResponse(agentInputs: string[]): Promise<ChatModelsResponse> {
    const agents = Array.from(new Set(agentInputs.map(normalizeAgentId).filter(Boolean)));
    const localInventory = await this.options.localInventory();
    const checkedAt = (this.options.now?.() ?? new Date()).toISOString();

    if (agents.length === 1) {
      const set = await this.getAgentModels(agents[0]);
      return {
        agent: set.agent,
        defaultModel: set.defaultModel,
        models: set.models,
        cloud: set.models.filter((model) => !model.isLocal),
        local: set.models.filter((model) => model.isLocal && model.available),
        localInventory,
        checkedAt,
        cacheTtlMs: AGENT_MODEL_CACHE_TTL_MS,
        source: set.source,
        stale: set.stale,
      };
    }

    const perAgent: Record<string, AgentModelSet> = {};
    for (const agent of agents.length > 0 ? agents : ['assistant']) {
      perAgent[agent] = await this.getAgentModels(agent);
    }

    return {
      agents: perAgent,
      cloud: [],
      local: [],
      localInventory,
      checkedAt,
      cacheTtlMs: AGENT_MODEL_CACHE_TTL_MS,
      source: 'per-agent',
      stale: false,
    };
  }

  async resolveModelForAgent(agentInput: string, requestedModel?: string): Promise<{ ok: true; modelId?: string; isLocal: boolean } | { ok: false; message: string }> {
    const agent = normalizeAgentId(agentInput || 'assistant');
    const set = await this.getAgentModels(agent);
    const normalized = requestedModel?.trim();
    const target = normalized && normalized !== 'auto' ? normalized : set.defaultModel;
    if (!target) return { ok: true, modelId: undefined, isLocal: false };
    const model = set.models.find((entry) => entry.id === target);
    if (!model) {
      return { ok: false, message: `${agent} cannot use model ${target}.` };
    }
    if (model.isLocal && !model.available) {
      return { ok: false, message: `${agent} can use ${target}, but that local model is not available on this runtime.` };
    }
    return { ok: true, modelId: model.id, isLocal: model.isLocal };
  }
}
