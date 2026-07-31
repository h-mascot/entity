/**
 * THE-878 / WP2-A-03 — Add Agent invite-creation UI model.
 *
 * Hosts Agents → Add Agent creation state using the THE-877 invite-kit product
 * statuses. Durable POST /api/agents/invites is intentionally absent (WP2-A-05);
 * createInviteKit uses a bounded local_preview seam and never claims production
 * persistence. Full copyable prompt shape is WP2-A-04.
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

export const ADD_AGENT_ROLES = [
  'worker',
  'reviewer',
  'chief',
  'specialist',
] as const;

export type AddAgentRole = (typeof ADD_AGENT_ROLES)[number];

export const ADD_AGENT_BUNDLES = ['minimal', 'default', 'custom'] as const;
export type AddAgentBundle = (typeof ADD_AGENT_BUNDLES)[number];

export const ADD_AGENT_UI_STATUSES = [
  'empty',
  'editing',
  'loading',
  'error',
  'ready',
] as const;

export type AddAgentUiStatus = (typeof ADD_AGENT_UI_STATUSES)[number];

/** Explicit seam until durable invite HTTP lands in WP2-A-05. */
export const INVITE_CREATION_SEAMS = [
  'local_preview',
  'agents_invites_api',
  'unavailable',
] as const;

export type InviteCreationSeam = (typeof INVITE_CREATION_SEAMS)[number];

export const DEFAULT_INVITE_TTL_MS = 30 * 60 * 1000;

export const BASIC_FIELDS = ['agentName', 'role'] as const;
export const ADVANCED_FIELDS = [
  'projectId',
  'selectedBundle',
  'permissionsScope',
  'ttlMs',
  'safeStopConditions',
  'workplaneId',
  'taskId',
] as const;

export interface AddAgentDraft {
  agentName: string;
  role: AddAgentRole;
  projectId: string;
  selectedBundle: AddAgentBundle;
  permissionsScope: string[];
  ttlMs: number;
  safeStopConditions: string[];
  workplaneId: string;
  taskId: string;
  showAdvanced: boolean;
}

export interface InviteKitPreview {
  id: string;
  status: AgentInviteStatus;
  agentName: string;
  role: AddAgentRole;
  creationSource: 'agents_invite';
  createdAt: string;
  expiresAt: string;
  selectedBundle: AddAgentBundle;
  selectedModules: string[];
  permissionsScope: string[];
  safeStopConditions: string[];
  projectId: string | null;
  workplaneId: string | null;
  taskId: number | null;
  /** Route-compatible shapes only; not a durable token until WP2-A-05. */
  setupPath: string;
  manifestPath: string;
  bundlePath: string;
  skillPath: string;
  progressPath: string;
  seam: InviteCreationSeam;
  persistence: 'local_preview_not_durable';
  nextStep: string;
}

export interface AddAgentCreationState {
  uiStatus: AddAgentUiStatus;
  draft: AddAgentDraft;
  invite: InviteKitPreview | null;
  error: string | null;
  seam: InviteCreationSeam;
}

export interface CreateInviteKitOptions {
  now?: Date;
  /** Injected failure for tests / browser error proof. */
  forceError?: string | null;
  /**
   * Optional probe for durable API. When it returns a ready invite, seam is
   * agents_invites_api. 404/unimplemented falls back to local_preview.
   */
  probeDurableCreate?: (draft: AddAgentDraft) => Promise<InviteKitPreview | null>;
  randomId?: () => string;
}

const DEFAULT_SAFE_STOPS = [
  'Stop if manifest token is invalid/expired/revoked.',
  'Stop if requested permissions exceed manifest scope.',
  'Do not overwrite secrets, DB files, or production runtime unless manifest allows it.',
];

const BUNDLE_MODULES: Record<AddAgentBundle, string[]> = {
  minimal: ['entity-agent-contracts', 'entity-mc'],
  default: ['entity-agent-contracts', 'entity-fs', 'entity-mc', 'entity-linker'],
  custom: ['entity-agent-contracts', 'entity-mc'],
};

export function createEmptyDraft(overrides: Partial<AddAgentDraft> = {}): AddAgentDraft {
  return {
    agentName: '',
    role: 'worker',
    projectId: '',
    selectedBundle: 'default',
    permissionsScope: ['workspace_read', 'task_comment'],
    ttlMs: DEFAULT_INVITE_TTL_MS,
    safeStopConditions: [...DEFAULT_SAFE_STOPS],
    workplaneId: '',
    taskId: '',
    showAdvanced: false,
    ...overrides,
  };
}

export function createInitialCreationState(
  overrides: Partial<AddAgentCreationState> = {},
): AddAgentCreationState {
  return {
    uiStatus: 'empty',
    draft: createEmptyDraft(),
    invite: null,
    error: null,
    seam: 'local_preview',
    ...overrides,
  };
}

export function visibleFields(draft: Pick<AddAgentDraft, 'showAdvanced'>): string[] {
  if (draft.showAdvanced) {
    return [...BASIC_FIELDS, ...ADVANCED_FIELDS];
  }
  return [...BASIC_FIELDS];
}

export function validateDraft(draft: AddAgentDraft): { ok: true } | { ok: false; error: string } {
  const name = draft.agentName.trim();
  if (!name) {
    return { ok: false, error: 'Agent name is required.' };
  }
  if (!ADD_AGENT_ROLES.includes(draft.role)) {
    return { ok: false, error: 'Select a valid agent role.' };
  }
  if (!ADD_AGENT_BUNDLES.includes(draft.selectedBundle)) {
    return { ok: false, error: 'Select a valid module bundle.' };
  }
  if (!Number.isFinite(draft.ttlMs) || draft.ttlMs < 60_000) {
    return { ok: false, error: 'TTL must be at least 1 minute.' };
  }
  if (draft.ttlMs > 24 * 60 * 60 * 1000) {
    return { ok: false, error: 'TTL must be 24 hours or less.' };
  }
  return { ok: true };
}

export function inviteStatusLabel(status: AgentInviteStatus): string {
  switch (status) {
    case 'created':
      return 'Created';
    case 'opened':
      return 'Opened';
    case 'in_progress':
      return 'In progress';
    case 'completed':
      return 'Completed';
    case 'expired':
      return 'Expired';
    case 'revoked':
      return 'Revoked';
    default:
      return 'Unknown';
  }
}

export function roleLabel(role: AddAgentRole): string {
  switch (role) {
    case 'worker':
      return 'Worker';
    case 'reviewer':
      return 'Reviewer';
    case 'chief':
      return 'Chief / coordinator';
    case 'specialist':
      return 'Specialist';
    default:
      return role;
  }
}

function normalizeOptional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseOptionalTaskId(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function defaultRandomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  }
  return `preview${Date.now().toString(16)}`;
}

/** Build a clearly non-durable preview kit with route-compatible URL shapes. */
export function buildLocalPreviewInvite(
  draft: AddAgentDraft,
  options: { now?: Date; randomId?: () => string } = {},
): InviteKitPreview {
  const now = options.now ?? new Date();
  const token = (options.randomId ?? defaultRandomId)();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + draft.ttlMs).toISOString();
  const setupPath = `/onboard/agent/${token}`;
  const apiPrefix = `/api/onboarding/agent-session/${encodeURIComponent(token)}`;

  return {
    id: `local-preview-${token}`,
    status: 'created',
    agentName: draft.agentName.trim(),
    role: draft.role,
    creationSource: 'agents_invite',
    createdAt,
    expiresAt,
    selectedBundle: draft.selectedBundle,
    selectedModules: [...BUNDLE_MODULES[draft.selectedBundle]],
    permissionsScope: [...draft.permissionsScope],
    safeStopConditions: [...draft.safeStopConditions],
    projectId: normalizeOptional(draft.projectId),
    workplaneId: normalizeOptional(draft.workplaneId),
    taskId: parseOptionalTaskId(draft.taskId),
    setupPath,
    manifestPath: `${apiPrefix}/manifest`,
    bundlePath: `${apiPrefix}/bundle`,
    skillPath: `${apiPrefix}/skill`,
    progressPath: `${apiPrefix}/progress`,
    seam: 'local_preview',
    persistence: 'local_preview_not_durable',
    nextStep:
      'Copy setup details for the agent next (WP2-A-04). Durable invite persistence and revoke/regenerate land in WP2-A-05.',
  };
}

export function beginEditing(state: AddAgentCreationState): AddAgentCreationState {
  return {
    ...state,
    uiStatus: 'editing',
    error: null,
  };
}

export function toggleAdvanced(state: AddAgentCreationState): AddAgentCreationState {
  return {
    ...state,
    uiStatus: state.uiStatus === 'empty' ? 'editing' : state.uiStatus,
    draft: {
      ...state.draft,
      showAdvanced: !state.draft.showAdvanced,
    },
  };
}

export function updateDraft(
  state: AddAgentCreationState,
  patch: Partial<AddAgentDraft>,
): AddAgentCreationState {
  return {
    ...state,
    uiStatus: state.uiStatus === 'empty' || state.uiStatus === 'ready' ? 'editing' : state.uiStatus,
    draft: { ...state.draft, ...patch },
    error: null,
    invite: state.uiStatus === 'ready' ? null : state.invite,
  };
}

export function resetCreation(state: AddAgentCreationState = createInitialCreationState()): AddAgentCreationState {
  return createInitialCreationState({
    seam: state.seam === 'agents_invites_api' ? 'local_preview' : state.seam,
  });
}

export async function createInviteKit(
  state: AddAgentCreationState,
  options: CreateInviteKitOptions = {},
): Promise<AddAgentCreationState> {
  const validation = validateDraft(state.draft);
  if (!validation.ok) {
    return {
      ...state,
      uiStatus: 'error',
      error: validation.error,
      invite: null,
      seam: 'unavailable',
    };
  }

  if (options.forceError) {
    return {
      ...state,
      uiStatus: 'error',
      error: options.forceError,
      invite: null,
      seam: 'unavailable',
    };
  }

  if (options.probeDurableCreate) {
    try {
      const durable = await options.probeDurableCreate(state.draft);
      if (durable) {
        return {
          ...state,
          uiStatus: 'ready',
          invite: { ...durable, seam: 'agents_invites_api' },
          error: null,
          seam: 'agents_invites_api',
        };
      }
    } catch (err) {
      // Fall through to local preview; durable API is a later ticket.
      const message = err instanceof Error ? err.message : 'Durable invite API unavailable';
      if (/force|hard fail/i.test(message)) {
        return {
          ...state,
          uiStatus: 'error',
          error: message,
          invite: null,
          seam: 'unavailable',
        };
      }
    }
  }

  const invite = buildLocalPreviewInvite(state.draft, {
    now: options.now,
    randomId: options.randomId,
  });

  return {
    ...state,
    uiStatus: 'ready',
    invite,
    error: null,
    seam: 'local_preview',
  };
}

export function creationSummary(invite: InviteKitPreview): string {
  return `${invite.agentName} · ${roleLabel(invite.role)} · ${inviteStatusLabel(invite.status)}`;
}
