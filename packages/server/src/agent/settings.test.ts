import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanguageModel } from 'ai';
import {
  getTaskAgentLanguageModel,
  getTaskAgentSettings,
  updateTaskAgentSettings,
} from './settings';

const storedSettings = new Map<string, unknown>();

vi.mock('../../../db/src/entity-db', () => ({
  getEntityDatabase: vi.fn(() => ({})),
}));

vi.mock('../config/settings-store', () => ({
  ensureAppSettingsTable: vi.fn(),
  getSettingJson: vi.fn((_db: unknown, key: string) => storedSettings.get(key) ?? null),
  setSettingJson: vi.fn((_db: unknown, key: string, value: unknown) => {
    storedSettings.set(key, value);
  }),
}));

const mocks = vi.hoisted(() => {
  const googleModel = { provider: 'google-test' } as unknown as LanguageModel;
  const gatewayModel = { provider: 'gateway-test' } as unknown as LanguageModel;
  const openaiModel = { provider: 'openai-test' } as unknown as LanguageModel;
  const anthropicModel = { provider: 'anthropic-test' } as unknown as LanguageModel;
  const xaiModel = { provider: 'xai-test' } as unknown as LanguageModel;
  const googleFactory = vi.fn(() => googleModel);
  const gatewayFactory = vi.fn(() => gatewayModel);
  const openaiFactory = vi.fn(() => openaiModel);
  const anthropicFactory = vi.fn(() => anthropicModel);
  const xaiFactory = vi.fn(() => xaiModel);
  return {
    googleModel,
    gatewayModel,
    openaiModel,
    anthropicModel,
    xaiModel,
    googleFactory,
    gatewayFactory,
    openaiFactory,
    anthropicFactory,
    xaiFactory,
    createGoogleGenerativeAI: vi.fn(() => googleFactory),
    createGateway: vi.fn(() => gatewayFactory),
    createOpenAI: vi.fn(() => openaiFactory),
    createAnthropic: vi.fn(() => anthropicFactory),
    createXai: vi.fn(() => xaiFactory),
  };
});

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: mocks.createGoogleGenerativeAI,
}));

vi.mock('@ai-sdk/gateway', () => ({
  createGateway: mocks.createGateway,
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: mocks.createOpenAI,
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: mocks.createAnthropic,
}));

vi.mock('@ai-sdk/xai', () => ({
  createXai: mocks.createXai,
}));

describe('task agent settings', () => {
  beforeEach(() => {
    storedSettings.clear();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('returns default Gemini settings without exposing secrets', () => {
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'env-google-key');

    const settings = getTaskAgentSettings();

    expect(settings.provider).toBe('google');
    expect(settings.model).toBe('gemini-3-flash-preview');
    expect(settings.apiKeyConfigured).toBe(true);
    expect(settings.apiKeySource).toBe('env');
    expect(JSON.stringify(settings)).not.toContain('env-google-key');
    expect(settings.staleThresholdHours).toEqual({ doing: 24, review: 48 });
    expect(settings.maxActionsPerScan).toBe(10);
    expect(settings.providers.map((provider) => provider.id)).toEqual([
      'google',
      'openai',
      'anthropic',
      'xai',
      'vercel-gateway',
    ]);
  });

  it('persists provider, model, thresholds, and database-backed key without returning the key', () => {
    const settings = updateTaskAgentSettings({
      provider: 'openai',
      model: 'gpt-5.5',
      apiKey: 'stored-openai-key',
      staleThresholdHours: { doing: 12, review: 36 },
      maxActionsPerScan: 7,
    });

    expect(settings.provider).toBe('openai');
    expect(settings.model).toBe('gpt-5.5');
    expect(settings.apiKeyConfigured).toBe(true);
    expect(settings.apiKeySource).toBe('database');
    expect(settings.staleThresholdHours).toEqual({ doing: 12, review: 36 });
    expect(settings.maxActionsPerScan).toBe(7);
    expect(JSON.stringify(settings)).not.toContain('stored-openai-key');

    const reloaded = getTaskAgentSettings();
    expect(reloaded.provider).toBe('openai');
    expect(reloaded.model).toBe('gpt-5.5');
    expect(reloaded.apiKeySource).toBe('database');
    expect(reloaded.staleThresholdHours).toEqual({ doing: 12, review: 36 });
    expect(reloaded.maxActionsPerScan).toBe(7);
  });

  it('clears only the selected provider key and falls back to env when available', () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'env-gateway-key');
    updateTaskAgentSettings({
      provider: 'vercel-gateway',
      model: 'anthropic/claude-opus-4.6',
      apiKey: 'stored-gateway-key',
    });

    const cleared = updateTaskAgentSettings({
      provider: 'vercel-gateway',
      model: 'anthropic/claude-opus-4.6',
      clearApiKey: true,
    });

    expect(cleared.apiKeyConfigured).toBe(true);
    expect(cleared.apiKeySource).toBe('env');
    expect(JSON.stringify(cleared)).not.toContain('stored-gateway-key');
    expect(JSON.stringify(cleared)).not.toContain('env-gateway-key');
  });

  it('rejects unsupported providers instead of silently saving Google', () => {
    expect(() => updateTaskAgentSettings({ provider: 'openrouter' })).toThrow('Unsupported Task Master provider');
  });

  it('defaults to the new provider model when provider changes without an explicit model', () => {
    updateTaskAgentSettings({ provider: 'openai', model: 'gpt-5.5' });

    const settings = updateTaskAgentSettings({ provider: 'anthropic' });

    expect(settings.provider).toBe('anthropic');
    expect(settings.model).toBe('claude-opus-4.6');
  });

  it('clamps invalid threshold and scan limit values to safe ranges', () => {
    const settings = updateTaskAgentSettings({
      provider: 'anthropic',
      model: 'claude-opus-4.6',
      staleThresholdHours: { doing: 0, review: 9999 },
      maxActionsPerScan: 0,
    });

    expect(settings.staleThresholdHours).toEqual({ doing: 1, review: 720 });
    expect(settings.maxActionsPerScan).toBe(1);
  });

  it('builds the selected language model from saved settings', () => {
    updateTaskAgentSettings({
      provider: 'anthropic',
      model: 'claude-opus-4.6',
      apiKey: 'stored-anthropic-key',
    });

    const model = getTaskAgentLanguageModel();

    expect(model).toBe(mocks.anthropicModel);
    expect(mocks.createAnthropic).toHaveBeenCalledWith({ apiKey: 'stored-anthropic-key' });
    expect(mocks.anthropicFactory).toHaveBeenCalledWith('claude-opus-4.6');
    expect(mocks.createGateway).not.toHaveBeenCalled();
    expect(mocks.createGoogleGenerativeAI).not.toHaveBeenCalled();
  });
});
