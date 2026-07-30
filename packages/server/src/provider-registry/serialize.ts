import type {
  AuthMode,
  ConfigurationState,
  HealthSummaryState,
  InferenceProviderHealthCheckRecord,
  InferenceProviderModelRecord,
  InferenceProviderProfileRecord,
  SafeAuthDto,
  SafeBindingDto,
  SafeHealthCheckDto,
  SafeHealthSummaryDto,
  SafeModelDto,
  SafeProviderProfileDto,
  InferenceProviderBindingRecord,
} from './types';
import { authSourceLabel } from './types';

const SECRET_KEYS = new Set([
  'apiKey',
  'api_key',
  'apiKeys',
  'secret',
  'secretRef',
  'secret_ref',
  'authorization',
  'Authorization',
  'token',
  'password',
  'rawKey',
  'raw_key',
]);

/**
 * Mask a non-secret reference hint for display.
 * Env var names may be shown mostly intact; long opaque strings are truncated.
 */
export function maskReferenceHint(
  reference: string | null | undefined,
  authMode?: AuthMode,
): string | null {
  if (!reference) return null;
  const value = reference.trim();
  if (!value) return null;
  if (authMode === 'env_ref' && /^[A-Z][A-Z0-9_]{2,}$/.test(value)) {
    // Env-style name — safe to show
    return value;
  }
  if (
    authMode === 'legacy_setting_ref' &&
    /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(value)
  ) {
    // Legacy setting path — safe to show path, never values
    return value;
  }
  if (!authMode && /^[A-Z][A-Z0-9_]{2,}$/.test(value)) return value;
  if (!authMode && /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(value)) {
    return value;
  }
  if (value.length <= 8 && !/[./]/.test(value)) return value;
  return `${value.slice(0, 4)}…${value.slice(-3)}`;
}

export function buildSafeAuthDto(profile: InferenceProviderProfileRecord): SafeAuthDto {
  const configured =
    profile.authMode === 'none' ? true : Boolean(profile.secretRef && profile.secretRef.trim());

  return {
    mode: profile.authMode,
    configured,
    sourceLabel: authSourceLabel(profile.authMode),
    referenceHint: maskReferenceHint(profile.secretRef, profile.authMode),
  };
}

/**
 * Local configuration-state projection without resolving secrets against env.
 * Phase C secret resolver will refine missing_secret vs configured.
 */
export function deriveConfigurationState(
  profile: InferenceProviderProfileRecord,
  options?: { secretResolves?: boolean | null },
): ConfigurationState {
  if (!profile.enabled) return 'disabled';
  if (profile.authMode === 'managed_secret_ref') {
    // OQ-005: managed store unavailable
    return 'error';
  }
  if (profile.authMode !== 'none') {
    if (!profile.secretRef?.trim()) return 'missing_secret';
    if (options?.secretResolves === false) return 'missing_secret';
  }
  if (profile.providerKind === 'openai_compatible' || profile.providerKind === 'azure_openai') {
    if (profile.baseUrl !== null && profile.baseUrl !== undefined) {
      try {
        const url = new URL(profile.baseUrl);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          return 'error';
        }
      } catch {
        return 'error';
      }
    }
  }
  return 'configured';
}

export function deriveHealthSummary(
  latest: InferenceProviderHealthCheckRecord | null,
): SafeHealthSummaryDto {
  if (!latest) {
    return { state: 'never_tested' };
  }
  let state: HealthSummaryState;
  switch (latest.status) {
    case 'queued':
    case 'running':
      state = 'testing';
      break;
    case 'healthy':
      state = 'healthy';
      break;
    case 'unhealthy':
    case 'cancelled':
      state = 'unhealthy';
      break;
    default:
      state = 'never_tested';
  }
  return {
    state,
    lastTestKind: latest.testKind,
    lastTestAt: latest.completedAt ?? latest.startedAt,
    lastErrorCode: latest.errorCode,
    lastSafeMessage: latest.safeMessage,
  };
}

export function serializeModel(model: InferenceProviderModelRecord): SafeModelDto {
  return {
    id: model.modelId,
    displayLabel: model.displayLabel,
    enabled: model.enabled,
    capabilities: [...model.capabilities],
  };
}

export function serializeBinding(binding: InferenceProviderBindingRecord): SafeBindingDto {
  return {
    id: binding.id,
    consumerKey: binding.consumerKey,
    scopeKind: binding.scopeKind,
    scopeId: binding.scopeId,
    capability: binding.capability,
    profileId: binding.profileId,
    modelId: binding.modelId,
    enabled: binding.enabled,
    version: binding.version,
    source: 'registry',
  };
}

export function serializeHealthCheck(
  record: InferenceProviderHealthCheckRecord,
): SafeHealthCheckDto {
  return {
    id: record.id,
    profileId: record.profileId,
    modelId: record.modelId,
    testKind: record.testKind,
    capability: record.capability,
    status: record.status,
    errorCode: record.errorCode,
    safeMessage: record.safeMessage,
    latencyMs: record.latencyMs,
    initiatedBy: record.initiatedBy,
    requestId: record.requestId,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
  };
}

export interface SerializeProfileOptions {
  models?: InferenceProviderModelRecord[];
  latestHealth?: InferenceProviderHealthCheckRecord | null;
  secretResolves?: boolean | null;
}

/**
 * Safe profile serializer — never emits secret values, secret_ref raw credentials,
 * apiKeys, Authorization headers, prompts, or provider response bodies.
 */
export function serializeProfile(
  profile: InferenceProviderProfileRecord,
  options: SerializeProfileOptions = {},
): SafeProviderProfileDto {
  const auth = buildSafeAuthDto(profile);
  const configurationState = deriveConfigurationState(profile, {
    secretResolves: options.secretResolves,
  });

  const dto: SafeProviderProfileDto = {
    id: profile.id,
    name: profile.name,
    displayLabel: profile.displayLabel,
    providerKind: profile.providerKind,
    baseUrl: profile.baseUrl,
    enabled: profile.enabled,
    configurationState,
    auth,
    health: deriveHealthSummary(options.latestHealth ?? null),
    models: (options.models ?? []).map(serializeModel),
    lastUsedAt: profile.lastUsedAt,
    migrationSource: profile.migrationSource,
    version: profile.version,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };

  assertNoSecretsInDto(dto);
  return dto;
}

export function assertNoSecretsInDto(value: unknown, path = '$'): void {
  if (value == null) return;
  if (typeof value === 'string') {
    if (/(sk-|rk-|xai-|AIza)[A-Za-z0-9._\-]{8,}/i.test(value)) {
      throw new Error(`Secret-like value leaked at ${path}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretsInDto(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.has(key)) {
        throw new Error(`Forbidden secret key "${key}" at ${path}`);
      }
      if (key === 'secretRef' || key === 'secret_ref') {
        throw new Error(`secret_ref must not appear in safe DTOs at ${path}`);
      }
      assertNoSecretsInDto(child, `${path}.${key}`);
    }
  }
}

export function authModeSupportsResolution(mode: AuthMode): boolean {
  return mode === 'none' || mode === 'env_ref' || mode === 'legacy_setting_ref';
}
