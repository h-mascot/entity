/**
 * EEPC-A-03 — Execution-engine callback intake → ActivityEvents.
 * EEPC-A-07 — Unauthorized/malformed negative path + authRequired enforcement.
 */

export { INTAKE_CALLBACK_EVENTS } from './types';
export type {
  IntakeCallbackEvent,
  ExecutionCallbackJobRef,
  ExecutionCallbackPayload,
  CallbackValidationIssue,
  CallbackValidationResult,
  MappedCallbackActivityRecord,
  CallbackIntakeResult,
  CallbackIntakeDependencies,
  CallbackAuthContext,
} from './types';

export { parseCallbackPayloadShape, validateExecutionCallback } from './validate';
export { mapValidatedCallbackToActivityRecord } from './map';
export {
  createExecutionCallbackIntakeService,
  type ExecutionCallbackIntakeService,
} from './service';
export { createExecutionCallbackIntakeRouter } from './routes';
export {
  authorizeExecutionCallback,
  extractCallbackCredential,
  isCallbackAuthRequired,
  resolveCallbackAuthSecretFromEnv,
} from './auth';
export { toPublicCallbackErrorBody, scrubPublicSafeText } from './public-safe';
export {
  loadValidatedManifestCatalog,
  getValidatedManifestByProvider,
  resetValidatedManifestCatalogForTests,
} from './manifest-catalog';
