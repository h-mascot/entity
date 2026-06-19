import { createAnthropic } from '@ai-sdk/anthropic';
import { createGateway } from '@ai-sdk/gateway';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import type { LanguageModel } from 'ai';
import { getEntityDatabase } from '../../../db/src/entity-db';
import { AGENT_CONFIG } from './config';
import { ensureAppSettingsTable, getSettingJson, setSettingJson } from '../config/settings-store';

export type TaskAgentProviderId =
  | 'google'
  | 'openai'
  | 'openai-compatible'
  | 'anthropic'
  | 'xai'
  | 'vercel-gateway';

export interface TaskAgentProviderOption {
  id: TaskAgentProviderId;
  label: string;
  keyLabel: string;
  envKeys: string[];
  models: Array<{ id: string; label: string }>;
  /** Providers that talk to a configurable OpenAI-compatible base URL (Azure, local, proxies). */
  supportsBaseUrl?: boolean;
  /** Hint shown in the base URL field. */
  baseUrlPlaceholder?: string;
}

export interface StoredTaskAgentSettings {
  provider?: string;
  model?: string;
  apiKeys?: Record<string, string>;
  baseUrls?: Record<string, string>;
  staleThresholdHours?: {
    doing?: number;
    review?: number;
  };
  maxActionsPerScan?: number;
}

export interface TaskAgentSettingsView {
  provider: TaskAgentProviderId;
  model: string;
  apiKeyConfigured: boolean;
  apiKeySource: 'database' | 'env' | 'none';
  baseUrl: string | null;
  baseUrlSource: 'database' | 'env' | 'default' | 'none';
  supportsBaseUrl: boolean;
  staleThresholdHours: {
    doing: number;
    review: number;
  };
  maxActionsPerScan: number;
  providers: TaskAgentProviderOption[];
}

export interface UpdateTaskAgentSettingsInput {
  provider?: string;
  model?: string;
  apiKey?: string;
  clearApiKey?: boolean;
  baseUrl?: string;
  clearBaseUrl?: boolean;
  staleThresholdHours?: {
    doing?: number;
    review?: number;
  };
  maxActionsPerScan?: number;
}

const SETTINGS_KEY = 'taskAgent.settings';

export const TASK_AGENT_PROVIDERS: TaskAgentProviderOption[] = [
  {
    id: 'google',
    label: 'Google Gemini',
    keyLabel: 'Google API key',
    envKeys: ['GOOGLE_GENERATIVE_AI_API_KEY'],
    models: [
      { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    keyLabel: 'OpenAI API key',
    envKeys: ['OPENAI_API_KEY'],
    supportsBaseUrl: true,
    baseUrlPlaceholder: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-5.5', label: 'GPT-5.5' },
      { id: 'gpt-5.4', label: 'GPT-5.4' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
      { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
    ],
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI-compatible (Azure / custom)',
    keyLabel: 'API key',
    envKeys: ['AZURE_OPENAI_API_KEY', 'OPENAI_API_KEY'],
    supportsBaseUrl: true,
    baseUrlPlaceholder: 'https://NAME.openai.azure.com/openai/v1',
    models: [
      { id: 'gpt-4o', label: 'gpt-4o (or your Azure deployment name)' },
      { id: 'gpt-4.1', label: 'gpt-4.1' },
      { id: 'gpt-4o-mini', label: 'gpt-4o-mini' },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    keyLabel: 'Anthropic API key',
    envKeys: ['ANTHROPIC_API_KEY'],
    models: [
      { id: 'claude-opus-4.6', label: 'Claude Opus 4.6' },
      { id: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
      { id: 'claude-haiku-4.5', label: 'Claude Haiku 4.5' },
    ],
  },
  {
    id: 'xai',
    label: 'xAI',
    keyLabel: 'xAI API key',
    envKeys: ['XAI_API_KEY'],
    models: [
      { id: 'grok-4.3', label: 'Grok 4.3' },
      { id: 'grok-4.3-fast', label: 'Grok 4.3 Fast' },
      { id: 'grok-4.2', label: 'Grok 4.2' },
    ],
  },
  {
    id: 'vercel-gateway',
    label: 'Vercel AI Gateway',
    keyLabel: 'Vercel AI Gateway key',
    envKeys: ['AI_GATEWAY_API_KEY', 'VERCEL_AI_GATEWAY_API_KEY'],
    models: [
      { id: 'openai/gpt-5.5', label: 'OpenAI GPT-5.5' },
      { id: 'openai/gpt-5.4', label: 'OpenAI GPT-5.4' },
      { id: 'anthropic/claude-opus-4.6', label: 'Claude Opus 4.6' },
      { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
      { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'xai/grok-4.3', label: 'Grok 4.3' },
    ],
  },
];

function normalizeProvider(provider: unknown): TaskAgentProviderId {
  return TASK_AGENT_PROVIDERS.some((option) => option.id === provider)
    ? (provider as TaskAgentProviderId)
    : 'google';
}

function assertProvider(provider: unknown): TaskAgentProviderId {
  if (TASK_AGENT_PROVIDERS.some((option) => option.id === provider)) {
    return provider as TaskAgentProviderId;
  }
  throw new Error('Unsupported Task Master provider');
}

function providerOption(provider: TaskAgentProviderId): TaskAgentProviderOption {
  return TASK_AGENT_PROVIDERS.find((option) => option.id === provider) ?? TASK_AGENT_PROVIDERS[0]!;
}

function normalizeModel(provider: TaskAgentProviderId, model: unknown): string {
  const option = providerOption(provider);
  if (typeof model === 'string' && model.trim()) {
    return model.trim();
  }
  return option.models[0]?.id ?? 'gemini-3-flash-preview';
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function normalizeStaleThresholdHours(stored: StoredTaskAgentSettings['staleThresholdHours'] | undefined) {
  return {
    doing: normalizeNumber(stored?.doing, AGENT_CONFIG.staleThresholdHours.doing, 1, 24 * 30),
    review: normalizeNumber(stored?.review, AGENT_CONFIG.staleThresholdHours.review, 1, 24 * 30),
  };
}

function normalizeMaxActionsPerScan(value: unknown): number {
  return normalizeNumber(value, AGENT_CONFIG.maxActionsPerScan, 1, 100);
}

function envApiKeyFor(provider: TaskAgentProviderId): string | null {
  for (const envKey of providerOption(provider).envKeys) {
    const value = process.env[envKey]?.trim();
    if (value) return value;
  }
  return null;
}

const DEFAULT_BASE_URLS: Partial<Record<TaskAgentProviderId, string>> = {
  openai: 'https://api.openai.com/v1',
};

function supportsBaseUrl(provider: TaskAgentProviderId): boolean {
  return Boolean(providerOption(provider).supportsBaseUrl);
}

function normalizeBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

function envBaseUrlFor(provider: TaskAgentProviderId): string | null {
  if (!supportsBaseUrl(provider)) return null;
  const candidates =
    provider === 'openai-compatible'
      ? ['OPENAI_BASE_URL', 'AZURE_OPENAI_BASE_URL', 'AZURE_OPENAI_ENDPOINT']
      : ['OPENAI_BASE_URL'];
  for (const key of candidates) {
    const normalized = normalizeBaseUrl(process.env[key]);
    if (normalized) return normalized;
  }
  return null;
}

interface ResolvedBaseUrl {
  url: string | null;
  source: 'database' | 'env' | 'default' | 'none';
}

function resolveBaseUrl(provider: TaskAgentProviderId, stored: StoredTaskAgentSettings): ResolvedBaseUrl {
  if (!supportsBaseUrl(provider)) {
    return { url: null, source: 'none' };
  }
  const fromDb = normalizeBaseUrl(stored.baseUrls?.[provider]);
  if (fromDb) return { url: fromDb, source: 'database' };
  const fromEnv = envBaseUrlFor(provider);
  if (fromEnv) return { url: fromEnv, source: 'env' };
  const fallback = DEFAULT_BASE_URLS[provider];
  if (fallback) return { url: fallback, source: 'default' };
  return { url: null, source: 'none' };
}

function readStoredSettings(): StoredTaskAgentSettings {
  try {
    const db = getEntityDatabase(ensureAppSettingsTable);
    const stored = getSettingJson(db, SETTINGS_KEY);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      return {};
    }
    return stored as StoredTaskAgentSettings;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown settings read error';
    console.warn('[TaskAgent] Failed to read settings:', message);
    return {};
  }
}

function writeStoredSettings(next: StoredTaskAgentSettings): void {
  const db = getEntityDatabase(ensureAppSettingsTable);
  setSettingJson(db, SETTINGS_KEY, next, 'admin-ui');
}

export function getTaskAgentSettings(): TaskAgentSettingsView {
  const stored = readStoredSettings();
  const provider = normalizeProvider(stored.provider);
  const model = normalizeModel(provider, stored.model);
  const databaseKey = stored.apiKeys?.[provider]?.trim() ?? '';
  const envKey = envApiKeyFor(provider);
  const staleThresholdHours = normalizeStaleThresholdHours(stored.staleThresholdHours);
  const baseUrl = resolveBaseUrl(provider, stored);

  return {
    provider,
    model,
    apiKeyConfigured: Boolean(databaseKey || envKey),
    apiKeySource: databaseKey ? 'database' : envKey ? 'env' : 'none',
    baseUrl: baseUrl.url,
    baseUrlSource: baseUrl.source,
    supportsBaseUrl: supportsBaseUrl(provider),
    staleThresholdHours,
    maxActionsPerScan: normalizeMaxActionsPerScan(stored.maxActionsPerScan),
    providers: TASK_AGENT_PROVIDERS,
  };
}

export function updateTaskAgentSettings(input: UpdateTaskAgentSettingsInput): TaskAgentSettingsView {
  const current = readStoredSettings();
  const provider = input.provider === undefined
    ? normalizeProvider(current.provider)
    : assertProvider(input.provider);
  const providerChanged = input.provider !== undefined && input.provider !== current.provider;
  const model = normalizeModel(provider, input.model ?? (providerChanged ? undefined : current.model));
  const apiKeys = { ...(current.apiKeys ?? {}) };
  const baseUrls = { ...(current.baseUrls ?? {}) };
  const staleThresholdHours = normalizeStaleThresholdHours({
    doing: input.staleThresholdHours?.doing ?? current.staleThresholdHours?.doing,
    review: input.staleThresholdHours?.review ?? current.staleThresholdHours?.review,
  });

  if (input.clearApiKey) {
    delete apiKeys[provider];
  }

  if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
    apiKeys[provider] = input.apiKey.trim();
  }

  if (input.clearBaseUrl) {
    delete baseUrls[provider];
  }

  if (typeof input.baseUrl === 'string' && input.baseUrl.trim()) {
    const normalized = normalizeBaseUrl(input.baseUrl);
    if (!normalized) {
      throw new Error('Base URL must be a valid http(s) URL');
    }
    baseUrls[provider] = normalized;
  }

  writeStoredSettings({
    ...current,
    provider,
    model,
    apiKeys,
    baseUrls,
    staleThresholdHours,
    maxActionsPerScan: normalizeMaxActionsPerScan(input.maxActionsPerScan ?? current.maxActionsPerScan),
  });

  return getTaskAgentSettings();
}

export function getTaskAgentLanguageModel(): LanguageModel | null {
  const settings = getTaskAgentSettings();
  const stored = readStoredSettings();
  const apiKey = stored.apiKeys?.[settings.provider]?.trim() || envApiKeyFor(settings.provider);
  if (!apiKey) return null;

  if (settings.provider === 'vercel-gateway') {
    return createGateway({ apiKey })(settings.model);
  }

  if (settings.provider === 'openai' || settings.provider === 'openai-compatible') {
    const baseURL = resolveBaseUrl(settings.provider, stored).url ?? undefined;
    // For Azure/custom OpenAI-compatible endpoints, also send the `api-key` header
    // (Azure auth) alongside the SDK's default Bearer auth for broad compatibility.
    const headers =
      settings.provider === 'openai-compatible' ? { 'api-key': apiKey } : undefined;
    return createOpenAI({ apiKey, baseURL, headers })(settings.model);
  }

  if (settings.provider === 'anthropic') {
    return createAnthropic({ apiKey })(settings.model);
  }

  if (settings.provider === 'xai') {
    return createXai({ apiKey })(settings.model);
  }

  return createGoogleGenerativeAI({ apiKey })(settings.model);
}
