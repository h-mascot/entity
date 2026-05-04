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

import { startEforgePoller } from './providers/eforge-poller';

if (process.env.EFORGE_API_URL?.trim()) {
  startEforgePoller();
}
