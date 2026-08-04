/**
 * EEPC-A-02 — Execution-engine plugin manifest (schema only).
 *
 * Export surface for types + validation. No provider registration.
 */

export {
  EXECUTION_ENGINE_KIND,
  EXECUTION_ENGINE_MANIFEST_SCHEMA_VERSION,
  EXECUTION_MODES,
  PROVIDER_CATEGORIES,
  LIFECYCLE_CAPABILITIES,
  CALLBACK_EVENTS,
  ACTIVITY_EVENT_KINDS,
  CONFIG_SOURCES,
  PUBLIC_HEALTH_FIELDS,
} from './types';

export type {
  ExecutionMode,
  ProviderCategory,
  LifecycleCapability,
  CallbackEvent,
  ActivityEventKind,
  ConfigSource,
  PublicHealthField,
  ExecutionEngineIdentity,
  ExecutionContract,
  LifecycleCapabilities,
  CallbackIntakeMapping,
  StatusMapping,
  HealthContract,
  ConfigBinding,
  DangerousActionDeclaration,
  ActivityEventPlaceholder,
  ExecutionEnginePluginManifest,
  ManifestValidationIssue,
  ManifestValidationResult,
} from './types';

export {
  ExecutionEnginePluginManifestSchema,
  validateExecutionEngineManifest,
  parseExecutionEngineManifest,
  applyManifestSemantics,
} from './schema';
