/**
 * EEPC-A-03 — Execution-engine callback intake → ActivityEvents.
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
} from './types';

export { parseCallbackPayloadShape, validateExecutionCallback } from './validate';
export { mapValidatedCallbackToActivityRecord } from './map';
export {
  createExecutionCallbackIntakeService,
  type ExecutionCallbackIntakeService,
} from './service';
export { createExecutionCallbackIntakeRouter } from './routes';
export {
  loadValidatedManifestCatalog,
  getValidatedManifestByProvider,
  resetValidatedManifestCatalogForTests,
} from './manifest-catalog';
