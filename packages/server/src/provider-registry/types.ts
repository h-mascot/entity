/**
 * Provider Registry Phase B — domain kinds, capabilities, errors, and safe DTOs.
 *
 * SuperSpec §9 / §10 / §12.6. Secrets never appear in safe DTOs.
 */

export const PROVIDER_KINDS = [
  'openai',
  'azure_openai',
  'openai_compatible',
  'anthropic',
  'google',
  'xai',
  'vercel_gateway',
  'local_openai_compatible',
] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** Legacy Task Agent provider ids (hyphenated) → registry kinds (snake_case). */
export const LEGACY_PROVIDER_ID_TO_KIND: Record<string, ProviderKind> = {
  openai: 'openai',
  'openai-compatible': 'openai_compatible',
  anthropic: 'anthropic',
  google: 'google',
  xai: 'xai',
  'vercel-gateway': 'vercel_gateway',
};

export const PROVIDER_CAPABILITIES = [
  'chat',
  'reasoning',
  'embeddings',
  'tools',
  'structured_output',
  'vision',
  'audio_input',
  'audio_output',
] as const;

export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

/** Consumers that currently call getTaskAgentLanguageModel (OQ-009). */
export const PROVIDER_CONSUMER_KEYS = [
  'task_master',
  'doc_intelligence',
] as const;

export type ProviderConsumerKey = (typeof PROVIDER_CONSUMER_KEYS)[number];

export function isProviderConsumerKey(value: string): value is ProviderConsumerKey {
  return (PROVIDER_CONSUMER_KEYS as readonly string[]).includes(value);
}

/**
 * Comment responders share consumer bindings (Phase A default):
 * - task @mention responder → task_master
 * - document comment responder → doc_intelligence
 */
export const COMMENT_RESPONDER_CONSUMER_MAP = {
  task_comment_responder: 'task_master',
  document_comment_responder: 'doc_intelligence',
} as const satisfies Record<string, ProviderConsumerKey>;

export const AUTH_MODES = [
  'none',
  'env_ref',
  'managed_secret_ref',
  'legacy_setting_ref',
] as const;

export type AuthMode = (typeof AUTH_MODES)[number];

/** Phase B/C: managed secrets are not available (OQ-005). */
export const SUPPORTED_AUTH_MODES: readonly AuthMode[] = [
  'none',
  'env_ref',
  'legacy_setting_ref',
];

export const BINDING_SCOPE_KINDS = ['global', 'workspace', 'user'] as const;
export type BindingScopeKind = (typeof BINDING_SCOPE_KINDS)[number];

/** Phase B starts global-only (OQ-003). */
export const DEFAULT_BINDING_SCOPE_KIND: BindingScopeKind = 'global';
export const DEFAULT_BINDING_SCOPE_ID = '';

export const HEALTH_TEST_KINDS = [
  'configuration',
  'connectivity',
  'capability',
  'consumer_smoke',
] as const;

export type HealthTestKind = (typeof HEALTH_TEST_KINDS)[number];

export const HEALTH_CHECK_STATUSES = [
  'queued',
  'running',
  'healthy',
  'unhealthy',
  'cancelled',
] as const;

export type HealthCheckStatus = (typeof HEALTH_CHECK_STATUSES)[number];

export const CONFIGURATION_STATES = [
  'disabled',
  'missing_secret',
  'error',
  'configured',
] as const;

export type ConfigurationState = (typeof CONFIGURATION_STATES)[number];

export const HEALTH_SUMMARY_STATES = [
  'never_tested',
  'testing',
  'healthy',
  'unhealthy',
] as const;

export type HealthSummaryState = (typeof HEALTH_SUMMARY_STATES)[number];

export const PROVIDER_ERROR_CODES = [
  'PROVIDER_SECRET_MISSING',
  'PROVIDER_AUTH_REJECTED',
  'PROVIDER_ENDPOINT_BLOCKED',
  'PROVIDER_DNS_FAILED',
  'PROVIDER_TLS_FAILED',
  'PROVIDER_TIMEOUT',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_MODEL_NOT_FOUND',
  'PROVIDER_CAPABILITY_UNSUPPORTED',
  'PROVIDER_CONFIGURATION_INVALID',
  'PROVIDER_REMOTE_ERROR',
  'PROVIDER_RESPONSE_INVALID',
  'PROVIDER_UNKNOWN_ERROR',
  'PROVIDER_REQUEST_INVALID',
  'PROVIDER_NAME_EXISTS',
  'PROVIDER_NOT_FOUND',
  'PROVIDER_VERSION_CONFLICT',
  'PROVIDER_IN_USE',
  'PROVIDER_HEALTH_TEST_RATE_LIMITED',
  'PROVIDER_MODEL_INVALID',
] as const;

export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

export const PROVIDER_ERROR_MESSAGES: Record<ProviderErrorCode, string> = {
  PROVIDER_SECRET_MISSING: 'Required credentials are missing or unresolved.',
  PROVIDER_AUTH_REJECTED: 'The provider rejected the configured credentials.',
  PROVIDER_ENDPOINT_BLOCKED: 'The provider endpoint is blocked by network policy.',
  PROVIDER_DNS_FAILED: 'The provider endpoint hostname could not be resolved.',
  PROVIDER_TLS_FAILED: 'TLS negotiation with the provider endpoint failed.',
  PROVIDER_TIMEOUT: 'The provider request timed out.',
  PROVIDER_RATE_LIMITED: 'The provider rate-limited the request.',
  PROVIDER_MODEL_NOT_FOUND: 'The configured model was not found.',
  PROVIDER_CAPABILITY_UNSUPPORTED: 'The model does not support the requested capability.',
  PROVIDER_CONFIGURATION_INVALID: 'Provider configuration is invalid.',
  PROVIDER_REMOTE_ERROR: 'The provider returned an error.',
  PROVIDER_RESPONSE_INVALID: 'The provider response could not be validated.',
  PROVIDER_UNKNOWN_ERROR: 'An unknown provider error occurred.',
  PROVIDER_REQUEST_INVALID: 'The request is invalid.',
  PROVIDER_NAME_EXISTS: 'A provider profile with this name already exists.',
  PROVIDER_NOT_FOUND: 'The provider profile was not found.',
  PROVIDER_VERSION_CONFLICT: 'The provider profile was modified by another request.',
  PROVIDER_IN_USE: 'The provider profile is referenced by consumer bindings.',
  PROVIDER_HEALTH_TEST_RATE_LIMITED: 'A provider test was run too recently. Try again later.',
  PROVIDER_MODEL_INVALID: 'The model configuration is invalid.',
};

/**
 * SSRF policy surface for Phase C (OQ-016). Recorded here so Admin custom-URL
 * expansion cannot proceed without implementing these checks.
 */
export interface EndpointNetworkPolicySurface {
  allowedSchemes: readonly ['http:', 'https:'];
  blockPrivateIpLiteral: true;
  blockMetadataEndpoints: true;
  requireDnsResolutionCheck: true;
  localNetworkExceptionRequiresExplicitKind: 'local_openai_compatible';
  status: 'policy_surface_only';
  phase: 'C-07';
}

export const ENDPOINT_NETWORK_POLICY_SURFACE: EndpointNetworkPolicySurface = {
  allowedSchemes: ['http:', 'https:'],
  blockPrivateIpLiteral: true,
  blockMetadataEndpoints: true,
  requireDnsResolutionCheck: true,
  localNetworkExceptionRequiresExplicitKind: 'local_openai_compatible',
  status: 'policy_surface_only',
  phase: 'C-07',
};

/**
 * Health persistence decision (Phase A follow-up):
 * Sandbox lineage may contain swarm `provider_health_samples` /
 * `provider_recovery_receipts`. Inference registry uses a SEPARATE table
 * `inference_provider_health_checks` so execution-engine health is never
 * conflated with inference provider registry health.
 */
export const INFERENCE_HEALTH_TABLE = 'inference_provider_health_checks' as const;
export const SWARM_HEALTH_TABLES_EXPLICITLY_SEPARATE = [
  'provider_health_samples',
  'provider_recovery_receipts',
] as const;

export interface InferenceProviderProfileRecord {
  id: string;
  name: string;
  displayLabel: string;
  providerKind: ProviderKind;
  baseUrl: string | null;
  authMode: AuthMode;
  /** Opaque reference only — never a raw secret. Server-internal. */
  secretRef: string | null;
  providerConfig: Record<string, unknown>;
  enabled: boolean;
  migrationSource: string | null;
  migrationFingerprint: string | null;
  lastUsedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface InferenceProviderModelRecord {
  profileId: string;
  modelId: string;
  displayLabel: string | null;
  enabled: boolean;
  capabilities: ProviderCapability[];
  createdAt: string;
  updatedAt: string;
}

export interface InferenceProviderBindingRecord {
  id: string;
  consumerKey: string;
  scopeKind: BindingScopeKind;
  scopeId: string;
  capability: ProviderCapability;
  profileId: string;
  modelId: string;
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface InferenceProviderHealthCheckRecord {
  id: string;
  profileId: string;
  modelId: string | null;
  testKind: HealthTestKind;
  capability: ProviderCapability | null;
  status: HealthCheckStatus;
  errorCode: ProviderErrorCode | null;
  safeMessage: string | null;
  latencyMs: number | null;
  initiatedBy: string | null;
  requestId: string | null;
  details: Record<string, unknown>;
  startedAt: string;
  completedAt: string | null;
}

/** Browser/API-safe auth projection — never includes secret values or full refs that encode secrets. */
export interface SafeAuthDto {
  mode: AuthMode;
  configured: boolean;
  sourceLabel: string;
  /** Non-secret hint only (env name or setting path). Never a credential value. */
  referenceHint: string | null;
}

export interface SafeHealthSummaryDto {
  state: HealthSummaryState;
  lastTestKind?: HealthTestKind;
  lastTestAt?: string | null;
  lastErrorCode?: ProviderErrorCode | null;
  lastSafeMessage?: string | null;
}

export interface SafeModelDto {
  id: string;
  displayLabel: string | null;
  enabled: boolean;
  capabilities: ProviderCapability[];
}

/** Safe profile DTO for Admin/API — no raw keys, no secret_ref values. */
export interface SafeProviderProfileDto {
  id: string;
  name: string;
  displayLabel: string;
  providerKind: ProviderKind;
  baseUrl: string | null;
  enabled: boolean;
  configurationState: ConfigurationState;
  auth: SafeAuthDto;
  health: SafeHealthSummaryDto;
  models: SafeModelDto[];
  lastUsedAt: string | null;
  migrationSource: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SafeBindingDto {
  id: string;
  consumerKey: string;
  scopeKind: BindingScopeKind;
  scopeId: string;
  capability: ProviderCapability;
  profileId: string;
  modelId: string;
  enabled: boolean;
  version: number;
  source: 'registry';
}

export interface SafeHealthCheckDto {
  id: string;
  profileId: string;
  modelId: string | null;
  testKind: HealthTestKind;
  capability: ProviderCapability | null;
  status: HealthCheckStatus;
  errorCode: ProviderErrorCode | null;
  safeMessage: string | null;
  latencyMs: number | null;
  initiatedBy: string | null;
  requestId: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface SafeProviderErrorDto {
  code: ProviderErrorCode;
  message: string;
  requestId?: string;
}

export function isProviderKind(value: unknown): value is ProviderKind {
  return typeof value === 'string' && (PROVIDER_KINDS as readonly string[]).includes(value);
}

export function isProviderCapability(value: unknown): value is ProviderCapability {
  return typeof value === 'string' && (PROVIDER_CAPABILITIES as readonly string[]).includes(value);
}

export function isAuthMode(value: unknown): value is AuthMode {
  return typeof value === 'string' && (AUTH_MODES as readonly string[]).includes(value);
}

export function isProviderErrorCode(value: unknown): value is ProviderErrorCode {
  return typeof value === 'string' && (PROVIDER_ERROR_CODES as readonly string[]).includes(value);
}

export function mapLegacyProviderIdToKind(legacyId: string): ProviderKind | null {
  return LEGACY_PROVIDER_ID_TO_KIND[legacyId] ?? null;
}

export function authSourceLabel(mode: AuthMode): string {
  switch (mode) {
    case 'none':
      return 'No authentication';
    case 'env_ref':
      return 'Environment variable';
    case 'managed_secret_ref':
      return 'Managed secret (unavailable)';
    case 'legacy_setting_ref':
      return 'Legacy settings reference';
    default:
      return 'Unknown';
  }
}
