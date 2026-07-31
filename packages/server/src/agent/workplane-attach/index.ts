export {
  createWorkplaneAttachService,
  getWorkplaneAttachService,
  resetWorkplaneAttachServiceForTests,
  type AttachFailure,
  type AttachFailureCode,
  type AttachResult,
  type AttachSuccess,
  type WorkplaneAttachService,
  type WorkplaneAttachServiceDeps,
} from './service';
export {
  createWorkplaneAttachStore,
  ensureWorkplaneAttachSchema,
  type WorkplaneAttachStore,
} from './store';
export type {
  AttachAgentInput,
  AttachmentPresenceSource,
  WorkplaneAgentAttachment,
  WorkplaneAttachedAgentView,
  WorkplaneAttachedAgentsPanel,
} from './types';
