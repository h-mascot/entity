import { describe, expect, it } from 'vitest';
import {
  COMMENT_RESPONDER_CONSUMER_MAP,
  ENDPOINT_NETWORK_POLICY_SURFACE,
  INFERENCE_HEALTH_TABLE,
  LEGACY_PROVIDER_ID_TO_KIND,
  PROVIDER_CAPABILITIES,
  PROVIDER_ERROR_CODES,
  PROVIDER_KINDS,
  SWARM_HEALTH_TABLES_EXPLICITLY_SEPARATE,
  isAuthMode,
  isProviderCapability,
  isProviderKind,
  mapLegacyProviderIdToKind,
} from './types';
import { ProviderRegistryError, redactUnsafeMessage, toSafeProviderError } from './errors';

describe('provider registry domain types (PR-B-01)', () => {
  it('defines SuperSpec provider kinds', () => {
    expect(PROVIDER_KINDS).toContain('openai');
    expect(PROVIDER_KINDS).toContain('azure_openai');
    expect(PROVIDER_KINDS).toContain('openai_compatible');
    expect(PROVIDER_KINDS).toContain('local_openai_compatible');
    expect(PROVIDER_KINDS).toHaveLength(8);
  });

  it('defines canonical capabilities including chat', () => {
    expect(PROVIDER_CAPABILITIES).toContain('chat');
    expect(isProviderCapability('chat')).toBe(true);
    expect(isProviderCapability('tts')).toBe(false);
  });

  it('maps legacy hyphenated provider ids', () => {
    expect(mapLegacyProviderIdToKind('openai-compatible')).toBe('openai_compatible');
    expect(mapLegacyProviderIdToKind('vercel-gateway')).toBe('vercel_gateway');
    expect(LEGACY_PROVIDER_ID_TO_KIND.google).toBe('google');
    expect(mapLegacyProviderIdToKind('unknown')).toBeNull();
  });

  it('maps comment responders to consumer keys', () => {
    expect(COMMENT_RESPONDER_CONSUMER_MAP.task_comment_responder).toBe('task_master');
    expect(COMMENT_RESPONDER_CONSUMER_MAP.document_comment_responder).toBe(
      'doc_intelligence',
    );
  });

  it('records SSRF policy surface without implementing enforcement', () => {
    expect(ENDPOINT_NETWORK_POLICY_SURFACE.status).toBe('policy_surface_only');
    expect(ENDPOINT_NETWORK_POLICY_SURFACE.phase).toBe('C-07');
    expect(ENDPOINT_NETWORK_POLICY_SURFACE.allowedSchemes).toEqual(['http:', 'https:']);
  });

  it('keeps inference health table separate from swarm lineage', () => {
    expect(INFERENCE_HEALTH_TABLE).toBe('inference_provider_health_checks');
    expect(SWARM_HEALTH_TABLES_EXPLICITLY_SEPARATE).toContain('provider_health_samples');
    expect(SWARM_HEALTH_TABLES_EXPLICITLY_SEPARATE).toContain('provider_recovery_receipts');
  });

  it('validates enums', () => {
    expect(isProviderKind('anthropic')).toBe(true);
    expect(isProviderKind('Anthropic')).toBe(false);
    expect(isAuthMode('env_ref')).toBe(true);
    expect(isAuthMode('raw')).toBe(false);
  });

  it('exposes controlled error taxonomy', () => {
    expect(PROVIDER_ERROR_CODES).toContain('PROVIDER_SECRET_MISSING');
    expect(PROVIDER_ERROR_CODES).toContain('PROVIDER_VERSION_CONFLICT');
    const err = new ProviderRegistryError('PROVIDER_NAME_EXISTS');
    expect(err.toSafeDto()).toEqual({
      code: 'PROVIDER_NAME_EXISTS',
      message: 'A provider profile with this name already exists.',
    });
    expect(err.httpStatus).toBe(409);
  });

  it('redacts credential fragments from unsafe messages', () => {
    const redacted = redactUnsafeMessage(
      'Authorization Bearer sk-abc1234567890xyz failed api_key=supersecretvalue',
    );
    expect(redacted).not.toContain('sk-abc');
    expect(redacted).not.toContain('supersecretvalue');
    expect(redacted).toContain('[REDACTED]');
  });

  it('maps unknown errors to safe DTO without leaking internals', () => {
    const dto = toSafeProviderError(new Error('apiKey=sk-leaked-value-here'), 'req_1');
    expect(dto.code).toBe('PROVIDER_UNKNOWN_ERROR');
    expect(dto.requestId).toBe('req_1');
    expect(JSON.stringify(dto)).not.toContain('sk-leaked');
  });
});
