/**
 * Geordi Swarm — Module Entry Point
 *
 * Soft plugin: co-located module within Entity server.
 * Register with: app.use('/api/swarm', createSwarmRouter())
 */

export { createSwarmRouter } from './routes';
export { dispatchJob, checkJobStatus, acceptJob, rejectJob, cancelJob, listProviders, checkProviderHealth } from './dispatcher';
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

import { startEforgePoller } from './providers/eforge-poller';

if (process.env.EFORGE_API_URL?.trim()) {
  startEforgePoller();
}
