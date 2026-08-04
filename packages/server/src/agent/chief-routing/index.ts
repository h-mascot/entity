/**
 * THE-885 / WP2-B-04 — Chief-of-Staff routing policy surface.
 */

export {
  DEFAULT_CHIEF_PRIORITY_WINDOW_MS,
  ROUTING_ALLOW_CODES,
  ROUTING_CLAIM_MODES,
  ROUTING_CLAIM_STATUSES,
  ROUTING_DENY_CODES,
} from './types';
export type {
  AssignChiefInput,
  AssignRoutingInput,
  ChiefPresenceOverlay,
  ClaimRoutingInput,
  PolicyEvaluation,
  RoutingAllowCode,
  RoutingClaimMode,
  RoutingClaimStatus,
  RoutingDenyCode,
  RoutingReason,
  WorkplaneChiefAssignment,
  WorkplaneRoutingClaim,
  WorkplaneRoutingPanel,
  WorkplaneRoutingWindow,
} from './types';

export {
  evaluateAssignPolicy,
  evaluateClaimPolicy,
  isChiefPresenceAvailable,
  isPriorityWindowOpen,
} from './policy';
export type {
  EvaluateAssignPolicyInput,
  EvaluateClaimPolicyInput,
  PolicyActor,
  PolicyChiefContext,
} from './policy';

export {
  createChiefRoutingStore,
  ensureChiefRoutingSchema,
} from './store';
export type { ChiefRoutingStore } from './store';

export {
  createChiefRoutingService,
  getChiefRoutingService,
  resetChiefRoutingServiceForTests,
} from './service';
export type {
  ChiefRoutingService,
  ChiefRoutingServiceDeps,
  RoutingFailure,
  RoutingFailureCode,
  RoutingResult,
  RoutingSuccess,
} from './service';
