/**
 * Invite-kit domain types for Agents productization (THE-877 / WP2-A-02).
 *
 * Spec statuses are the durable product enum. Legacy onboarding agent-session
 * statuses remain for compatibility mapping only — see compatibility.ts.
 */

export const AGENT_INVITE_STATUSES = [
  'created',
  'opened',
  'in_progress',
  'completed',
  'expired',
  'revoked',
] as const;

export type AgentInviteStatus = (typeof AGENT_INVITE_STATUSES)[number];

/** Terminal product statuses — no further progress transitions. */
export const TERMINAL_INVITE_STATUSES = ['completed', 'expired', 'revoked'] as const;
export type TerminalInviteStatus = (typeof TERMINAL_INVITE_STATUSES)[number];

/** Legacy OnboardingAgentSessionSchema.status values (schema.ts). */
export const ONBOARDING_AGENT_SESSION_STATUSES = [
  'created',
  'opened',
  'installing',
  'configured',
  'verified',
  'expired',
] as const;

export type OnboardingAgentSessionStatus = (typeof ONBOARDING_AGENT_SESSION_STATUSES)[number];

export const INVITE_PROGRESS_STEP_STATUSES = ['pending', 'running', 'done', 'error'] as const;
export type InviteProgressStepStatus = (typeof INVITE_PROGRESS_STEP_STATUSES)[number];

export const INVITE_CREATION_SOURCES = ['onboarding_first_run', 'agents_invite'] as const;
export type InviteCreationSource = (typeof INVITE_CREATION_SOURCES)[number];

export const CHIEF_ROUTING_MODES = ['none', 'chief', 'worker'] as const;
export type ChiefRoutingMode = (typeof CHIEF_ROUTING_MODES)[number];

export type InviteTransitionEvent =
  | 'open_manifest'
  | 'report_progress'
  | 'complete'
  | 'expire'
  | 'revoke'
  | 'regenerate';

export interface AgentInviteProgressItem {
  stepId: string;
  label: string;
  moduleId?: string;
  status: InviteProgressStepStatus;
  message?: string;
  updatedAt: string;
  evidenceUrl?: string | null;
}

/**
 * Durable invite-kit domain record (API/domain shape).
 * Persistence uses snake_case columns in packages/db/src/agent-invites.ts.
 */
export interface AgentInviteDomain {
  id: string;
  tokenHash: string;
  /** Prior token hash after regenerate; null until first rotation. */
  previousTokenHash: string | null;
  generation: number;
  status: AgentInviteStatus;
  agentId: string | null;
  agentName: string;
  role: string;
  createdAt: string;
  openedAt: string | null;
  completedAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  createdBy: string | null;
  creationSource: InviteCreationSource;
  workspaceId: string | null;
  projectId: string | null;
  workplaneId: string | null;
  taskId: number | null;
  selectedBundle: string;
  selectedModules: string[];
  selectedModuleConfig: Record<string, unknown>;
  permissionsScope: string[];
  safeStopConditions: string[];
  providerProfileId: string | null;
  chiefRoutingMode: ChiefRoutingMode;
  progress: AgentInviteProgressItem[];
}

export interface InviteTransitionSuccess {
  ok: true;
  invite: AgentInviteDomain;
  from: AgentInviteStatus;
  to: AgentInviteStatus;
  event: InviteTransitionEvent;
}

export interface InviteTransitionFailure {
  ok: false;
  error: string;
  code:
    | 'forbidden_transition'
    | 'terminal_status'
    | 'missing_completion_evidence'
    | 'already_terminal'
    | 'invalid_clock';
  from: AgentInviteStatus;
  event: InviteTransitionEvent;
  to?: AgentInviteStatus;
}

export type InviteTransitionResult = InviteTransitionSuccess | InviteTransitionFailure;

export interface RegeneratePlan {
  nextStatus: 'created';
  previousStatus: AgentInviteStatus;
  previousTokenHash: string;
  revokePreviousToken: true;
  clearOpenedAt: true;
  clearCompletedAt: true;
  clearRevokedAt: true;
  incrementGeneration: true;
  /** Caller must mint a new raw token and supply its hash. */
  requiresNewTokenHash: true;
}

export const DEFAULT_AGENT_INVITE_TTL_MS = 30 * 60 * 1000;
