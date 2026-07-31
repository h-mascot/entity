/**
 * Geordi Swarm — Module Entry Point
 *
 * Soft plugin: co-located module within Entity server.
 * Register with: app.use('/api/swarm', createSwarmRouter())
 */

export { createSwarmRouter } from './routes';
export { dispatchJob, checkJobStatus, acceptJob, rejectJob, cancelJob, listProviders, checkProviderHealth, ensureProvidersRegistered } from './dispatcher';
export {
  listRegisteredExecutionEngines,
  getRegisteredExecutionEngineHealth,
  projectPublicProviderHealth,
  projectLegacyPublicHealth,
  toLegacyProviderListEntry,
} from './execution-engines';
export type { PublicExecutionEngine } from './execution-engines';
export { startEforgePoller, stopEforgePoller, syncEforgeRuns, getEforgePollerStatus } from './providers/eforge-poller';
export type { SwarmJob, SwarmProof, CreateSwarmJobInput, UpdateSwarmJobInput, SwarmJobStatus, SwarmPriority } from './types';
// EEPC-A-02: schema/validation only — does not register providers.
export {
  validateExecutionEngineManifest,
  parseExecutionEngineManifest,
  EXECUTION_ENGINE_MANIFEST_SCHEMA_VERSION,
  EXECUTION_ENGINE_KIND,
} from './manifest';
export type {
  ExecutionEnginePluginManifest,
  ManifestValidationResult,
  ManifestValidationIssue,
} from './manifest';
// EEPC-A-03: callback intake → ActivityEvents (scaffolding; no production provider OAuth).
// EEPC-A-07: authRequired negative path + public-safe errors.
export {
  createExecutionCallbackIntakeService,
  createExecutionCallbackIntakeRouter,
  validateExecutionCallback,
  mapValidatedCallbackToActivityRecord,
  authorizeExecutionCallback,
  resolveCallbackAuthSecretFromEnv,
  toPublicCallbackErrorBody,
  INTAKE_CALLBACK_EVENTS,
} from './callback-intake';
export type {
  ExecutionCallbackPayload,
  MappedCallbackActivityRecord,
  CallbackIntakeResult,
  CallbackAuthContext,
} from './callback-intake';
// EEPC-A-04: Swarm provider adapter against execution-engine contract.
export {
  createSwarmContractAdapter,
  tryCreateSwarmContractAdapter,
  projectProviderHealth,
  redactPublicHealthMessage,
} from './providers/contract-adapter';
export type { SwarmContractAdapter, AdapterBindResult } from './providers/contract-adapter';
export {
  registerBuiltinContractProviders,
  isSwarmContractAdapter,
  BUILTIN_SWARM_PROVIDER_ORDER,
} from './providers/contract-bootstrap';

import { startEforgePoller } from './providers/eforge-poller';

if (process.env.EFORGE_API_URL?.trim()) {
  startEforgePoller();
}
