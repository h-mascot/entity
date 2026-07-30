import { describe, expect, it } from 'vitest';
import type { InferenceProviderProfileRecord } from './types';
import {
  assertNoSecretsInDto,
  buildSafeAuthDto,
  deriveConfigurationState,
  deriveHealthSummary,
  maskReferenceHint,
  serializeProfile,
} from './serialize';

function sampleProfile(
  overrides: Partial<InferenceProviderProfileRecord> = {},
): InferenceProviderProfileRecord {
  return {
    id: 'profile_test',
    name: 'primary',
    displayLabel: 'Primary',
    providerKind: 'openai',
    baseUrl: null,
    authMode: 'env_ref',
    secretRef: 'OPENAI_API_KEY',
    providerConfig: {},
    enabled: true,
    migrationSource: null,
    migrationFingerprint: null,
    lastUsedAt: null,
    version: 1,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('safe profile serializer (PR-B-07)', () => {
  it('never emits secret_ref or raw api keys', () => {
    const dto = serializeProfile(sampleProfile(), {
      models: [
        {
          profileId: 'profile_test',
          modelId: 'gpt-5.4',
          displayLabel: 'GPT',
          enabled: true,
          capabilities: ['chat'],
          createdAt: '2026-07-30T00:00:00.000Z',
          updatedAt: '2026-07-30T00:00:00.000Z',
        },
      ],
    });

    const json = JSON.stringify(dto);
    expect(json).not.toContain('secretRef');
    expect(json).not.toContain('secret_ref');
    expect(json).not.toContain('apiKey');
    expect(json).not.toContain('apiKeys');
    expect(dto.auth.mode).toBe('env_ref');
    expect(dto.auth.configured).toBe(true);
    expect(dto.auth.referenceHint).toBe('OPENAI_API_KEY');
    expect(dto.configurationState).toBe('configured');
    expect(dto.models[0]?.id).toBe('gpt-5.4');
    assertNoSecretsInDto(dto);
  });

  it('masks opaque reference hints and keeps env names', () => {
    expect(maskReferenceHint('OPENAI_API_KEY')).toBe('OPENAI_API_KEY');
    expect(maskReferenceHint('taskAgent.settings.apiKeys.openai')).toBe(
      'taskAgent.settings.apiKeys.openai',
    );
    expect(maskReferenceHint('abcdefghijklmnop')).toMatch(/…/);
  });


  it('masks dotted unknown references instead of exposing pasted credentials', () => {
    expect(
      maskReferenceHint('eyJhbGciOiJIUzI1NiJ9.payload.signature', 'env_ref'),
    ).toMatch(/…/);
    expect(maskReferenceHint('taskAgent.settings.apiKeys.openai', 'legacy_setting_ref')).toBe(
      'taskAgent.settings.apiKeys.openai',
    );
  });

  it('derives configuration and health states', () => {
    expect(deriveConfigurationState(sampleProfile({ enabled: false }))).toBe('disabled');
    expect(
      deriveConfigurationState(
        sampleProfile({ authMode: 'env_ref', secretRef: null }),
      ),
    ).toBe('missing_secret');
    expect(
      deriveConfigurationState(sampleProfile({ authMode: 'managed_secret_ref', secretRef: 'ms/1' })),
    ).toBe('error');

    expect(deriveHealthSummary(null).state).toBe('never_tested');
    expect(
      deriveHealthSummary({
        id: 'h1',
        profileId: 'p',
        modelId: null,
        testKind: 'connectivity',
        capability: null,
        status: 'running',
        errorCode: null,
        safeMessage: null,
        latencyMs: null,
        initiatedBy: null,
        requestId: null,
        details: {},
        startedAt: '2026-07-30T00:00:00.000Z',
        completedAt: null,
      }).state,
    ).toBe('testing');
  });

  it('rejects DTO objects that contain forbidden secret keys', () => {
    expect(() =>
      assertNoSecretsInDto({ auth: { apiKey: 'sk-abcdefghijklmnopqrstuv' } }),
    ).toThrow(/Forbidden secret key/);
  });


  it('asserts against secret-like substrings in safe DTO strings', () => {
    expect(() =>
      assertNoSecretsInDto({ baseUrl: 'https://example.test/v1/sk-reviewerfound1234567890' }),
    ).toThrow(/Secret-like value/);
  });

  it('builds safe auth DTO without leaking credential values', () => {
    const auth = buildSafeAuthDto(
      sampleProfile({
        authMode: 'legacy_setting_ref',
        secretRef: 'taskAgent.settings.apiKeys.google',
      }),
    );
    expect(auth.sourceLabel).toContain('Legacy');
    expect(JSON.stringify(auth)).not.toMatch(/AIza|sk-/);
  });
});
