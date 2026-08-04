/**
 * THE-881 / WP2-A-06 — Agent Desk invite/setup/verification state model.
 *
 * Pure UI/state helpers over durable invite views from /api/agents/invites*.
 * Raw tokens stay in memory only (show-once from create/regenerate); never
 * persist them. Fail closed for revoke/copy when status or secrets disallow it.
 */

export const DESK_UI_STATUSES = [
  'empty',
  'loading',
  'error',
  'ready',
] as const;

export type DeskUiStatus = (typeof DESK_UI_STATUSES)[number];

export const AGENT_INVITE_STATUSES = [
  'created',
  'opened',
  'in_progress',
  'completed',
  'expired',
  'revoked',
] as const;

export type AgentInviteStatus = (typeof AGENT_INVITE_STATUSES)[number];

export const INVITE_PROGRESS_STEP_STATUSES = [
  'pending',
  'running',
  'done',
  'error',
] as const;

export type InviteProgressStepStatus = (typeof INVITE_PROGRESS_STEP_STATUSES)[number];

export interface InviteProgressStep {
  stepId: string;
  label: string;
  moduleId?: string;
  status: InviteProgressStepStatus;
  message?: string;
  updatedAt: string;
  evidenceUrl?: string | null;
}

/** Audit-safe durable invite row (GET/list). Token/URLs only when show-once held. */
export interface DeskInviteView {
  id: string;
  status: AgentInviteStatus;
  agentName: string;
  role: string;
  creationSource: string;
  createdAt: string;
  expiresAt: string;
  openedAt: string | null;
  completedAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  generation: number;
  rotated: boolean;
  selectedBundle: string;
  selectedModules: string[];
  permissionsScope: string[];
  safeStopConditions: string[];
  projectId: string | null;
  workplaneId: string | null;
  taskId: number | null;
  persistence: 'durable';
  progress: InviteProgressStep[];
  /** Show-once secrets — present only after create/regenerate in this session. */
  token?: string;
  setupPath?: string;
  manifestPath?: string;
  bundlePath?: string;
  skillPath?: string;
  progressPath?: string;
}

/** In-memory show-once secrets keyed by invite id (never localStorage). */
export type ShowOnceSecrets = {
  token: string;
  setupPath: string;
  manifestPath: string;
  bundlePath: string;
  skillPath: string;
  progressPath: string;
};

export interface AgentInviteDeskState {
  uiStatus: DeskUiStatus;
  invites: DeskInviteView[];
  error: string | null;
  selectedInviteId: string | null;
  /** Ephemeral show-once secrets; cleared on revoke / hard refresh. */
  showOnceById: Record<string, ShowOnceSecrets>;
  actionBusyId: string | null;
  actionError: string | null;
}

export function createInitialDeskState(
  overrides: Partial<AgentInviteDeskState> = {},
): AgentInviteDeskState {
  return {
    uiStatus: 'empty',
    invites: [],
    error: null,
    selectedInviteId: null,
    showOnceById: {},
    actionBusyId: null,
    actionError: null,
    ...overrides,
  };
}

export function isAgentInviteStatus(value: unknown): value is AgentInviteStatus {
  return typeof value === 'string'
    && (AGENT_INVITE_STATUSES as readonly string[]).includes(value);
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

export function progressStepLabel(status: InviteProgressStepStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'running':
      return 'Running';
    case 'done':
      return 'Done';
    case 'error':
      return 'Error';
    default:
      return 'Unknown';
  }
}

/** Operator-facing status chip including rotation signal. */
export function deskStatusDisplay(invite: Pick<DeskInviteView, 'status' | 'rotated' | 'generation'>): string {
  const base = inviteStatusLabel(invite.status);
  if (invite.rotated || invite.generation > 1) {
    return `${base} · rotated (gen ${invite.generation})`;
  }
  return base;
}

export function isTerminalInviteStatus(status: AgentInviteStatus): boolean {
  return status === 'completed' || status === 'expired' || status === 'revoked';
}

/** Fail closed: revoke only when not already revoked. */
export function canRevokeInvite(invite: Pick<DeskInviteView, 'status'>): boolean {
  return invite.status !== 'revoked';
}

/**
 * Regenerate is allowed by the WP2-A-05 status machine from every product status.
 * UI still disables while an action is in flight (handled by caller).
 */
export function canRegenerateInvite(_invite: Pick<DeskInviteView, 'status'>): boolean {
  return true;
}

/** Copyable prompt/URL bundle only when show-once secrets are in memory. */
export function canCopyInviteSecrets(
  inviteId: string,
  showOnceById: Record<string, ShowOnceSecrets>,
): boolean {
  const secrets = showOnceById[inviteId];
  return Boolean(secrets?.token && secrets.setupPath);
}

export function mergeShowOnce(
  invite: DeskInviteView,
  showOnceById: Record<string, ShowOnceSecrets>,
): DeskInviteView {
  const secrets = showOnceById[invite.id];
  if (!secrets) return invite;
  return {
    ...invite,
    token: secrets.token,
    setupPath: secrets.setupPath,
    manifestPath: secrets.manifestPath,
    bundlePath: secrets.bundlePath,
    skillPath: secrets.skillPath,
    progressPath: secrets.progressPath,
  };
}

export function extractShowOnce(invite: DeskInviteView): ShowOnceSecrets | null {
  if (
    typeof invite.token !== 'string'
    || !invite.token
    || typeof invite.setupPath !== 'string'
    || !invite.setupPath
    || typeof invite.manifestPath !== 'string'
    || typeof invite.bundlePath !== 'string'
    || typeof invite.skillPath !== 'string'
    || typeof invite.progressPath !== 'string'
  ) {
    return null;
  }
  return {
    token: invite.token,
    setupPath: invite.setupPath,
    manifestPath: invite.manifestPath,
    bundlePath: invite.bundlePath,
    skillPath: invite.skillPath,
    progressPath: invite.progressPath,
  };
}

/** Strip raw token from a view before keeping it in the list (defense in depth). */
export function stripTokenFromView(invite: DeskInviteView): DeskInviteView {
  const { token: _token, ...rest } = invite;
  return rest;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  if (value === null) return null;
  return typeof value === 'string' ? value : null;
}

function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function normalizeProgress(raw: unknown): InviteProgressStep[] {
  if (!Array.isArray(raw)) return [];
  const steps: InviteProgressStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const stepId = asString(row.stepId ?? row.step_id);
    const label = asString(row.label, stepId || 'Step');
    const statusRaw = asString(row.status, 'pending');
    const status = (INVITE_PROGRESS_STEP_STATUSES as readonly string[]).includes(statusRaw)
      ? statusRaw as InviteProgressStepStatus
      : 'pending';
    if (!stepId) continue;
    steps.push({
      stepId,
      label,
      moduleId: typeof row.moduleId === 'string'
        ? row.moduleId
        : typeof row.module_id === 'string'
          ? row.module_id
          : undefined,
      status,
      message: typeof row.message === 'string' ? row.message : undefined,
      updatedAt: asString(row.updatedAt ?? row.updated_at, new Date(0).toISOString()),
      evidenceUrl: asNullableString(row.evidenceUrl ?? row.evidence_url),
    });
  }
  return steps;
}

export function normalizeDeskInvite(raw: unknown): DeskInviteView | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = asString(row.id);
  const statusRaw = asString(row.status);
  if (!id || !isAgentInviteStatus(statusRaw)) return null;
  const generation = typeof row.generation === 'number' && Number.isFinite(row.generation)
    ? row.generation
    : 1;
  const rotated = Boolean(row.rotated) || generation > 1;

  const view: DeskInviteView = {
    id,
    status: statusRaw,
    agentName: asString(row.agentName ?? row.agent_name, 'Unknown'),
    role: asString(row.role, 'worker'),
    creationSource: asString(row.creationSource ?? row.creation_source, 'agents_invite'),
    createdAt: asString(row.createdAt ?? row.created_at),
    expiresAt: asString(row.expiresAt ?? row.expires_at),
    openedAt: asNullableString(row.openedAt ?? row.opened_at),
    completedAt: asNullableString(row.completedAt ?? row.completed_at),
    revokedAt: asNullableString(row.revokedAt ?? row.revoked_at),
    revokedBy: asNullableString(row.revokedBy ?? row.revoked_by),
    generation,
    rotated,
    selectedBundle: asString(row.selectedBundle ?? row.selected_bundle, 'default'),
    selectedModules: asStringArray(row.selectedModules ?? row.selected_modules),
    permissionsScope: asStringArray(row.permissionsScope ?? row.permissions_scope),
    safeStopConditions: asStringArray(row.safeStopConditions ?? row.safe_stop_conditions),
    projectId: asNullableString(row.projectId ?? row.project_id),
    workplaneId: asNullableString(row.workplaneId ?? row.workplane_id),
    taskId: asNumberOrNull(row.taskId ?? row.task_id),
    persistence: 'durable',
    progress: normalizeProgress(row.progress),
  };

  if (typeof row.token === 'string' && row.token) view.token = row.token;
  if (typeof row.setupPath === 'string') view.setupPath = row.setupPath;
  if (typeof row.manifestPath === 'string') view.manifestPath = row.manifestPath;
  if (typeof row.bundlePath === 'string') view.bundlePath = row.bundlePath;
  if (typeof row.skillPath === 'string') view.skillPath = row.skillPath;
  if (typeof row.progressPath === 'string') view.progressPath = row.progressPath;

  return view;
}

export function normalizeDeskInviteList(raw: unknown): DeskInviteView[] {
  if (!raw || typeof raw !== 'object') return [];
  const payload = raw as Record<string, unknown>;
  const list = Array.isArray(payload.invites)
    ? payload.invites
    : Array.isArray(raw)
      ? raw as unknown[]
      : [];
  return list
    .map((item) => normalizeDeskInvite(item))
    .filter((item): item is DeskInviteView => Boolean(item));
}

export function deskFromListSuccess(
  state: AgentInviteDeskState,
  raw: unknown,
): AgentInviteDeskState {
  const invites = normalizeDeskInviteList(raw).map(stripTokenFromView);
  return {
    ...state,
    uiStatus: invites.length === 0 ? 'empty' : 'ready',
    invites,
    error: null,
    actionError: null,
    selectedInviteId:
      state.selectedInviteId && invites.some((invite) => invite.id === state.selectedInviteId)
        ? state.selectedInviteId
        : invites[0]?.id ?? null,
  };
}

export function deskFromListError(
  state: AgentInviteDeskState,
  error: string,
): AgentInviteDeskState {
  return {
    ...state,
    uiStatus: 'error',
    invites: [],
    error,
    actionBusyId: null,
  };
}

export function deskBeginLoad(state: AgentInviteDeskState): AgentInviteDeskState {
  return {
    ...state,
    uiStatus: 'loading',
    error: null,
    actionError: null,
  };
}

export function deskSelectInvite(
  state: AgentInviteDeskState,
  inviteId: string | null,
): AgentInviteDeskState {
  return { ...state, selectedInviteId: inviteId, actionError: null };
}

export function deskRememberShowOnce(
  state: AgentInviteDeskState,
  invite: DeskInviteView,
): AgentInviteDeskState {
  const secrets = extractShowOnce(invite);
  if (!secrets) return state;
  return {
    ...state,
    showOnceById: {
      ...state.showOnceById,
      [invite.id]: secrets,
    },
  };
}

export function deskForgetShowOnce(
  state: AgentInviteDeskState,
  inviteId: string,
): AgentInviteDeskState {
  if (!state.showOnceById[inviteId]) return state;
  const next = { ...state.showOnceById };
  delete next[inviteId];
  return { ...state, showOnceById: next };
}

export function deskApplyInviteUpdate(
  state: AgentInviteDeskState,
  raw: unknown,
  options: { rememberShowOnce?: boolean } = {},
): AgentInviteDeskState {
  const normalized = normalizeDeskInvite(raw);
  if (!normalized) {
    return {
      ...state,
      actionError: 'Invite response was invalid.',
      actionBusyId: null,
    };
  }
  const withSecrets = options.rememberShowOnce
    ? deskRememberShowOnce(state, normalized)
    : state;
  const clearedToken = stripTokenFromView(normalized);
  const invites = withSecrets.invites.some((row) => row.id === clearedToken.id)
    ? withSecrets.invites.map((row) => (row.id === clearedToken.id ? clearedToken : row))
    : [clearedToken, ...withSecrets.invites];
  let next: AgentInviteDeskState = {
    ...withSecrets,
    uiStatus: 'ready',
    invites,
    error: null,
    actionBusyId: null,
    actionError: null,
    selectedInviteId: clearedToken.id,
  };
  if (clearedToken.status === 'revoked') {
    next = deskForgetShowOnce(next, clearedToken.id);
  }
  return next;
}

export function verificationSummary(invite: Pick<DeskInviteView, 'progress' | 'status'>): string {
  const steps = invite.progress;
  if (steps.length === 0) {
    return invite.status === 'completed'
      ? 'Completed (no checklist rows)'
      : 'No verification steps yet';
  }
  const done = steps.filter((step) => step.status === 'done').length;
  const errored = steps.filter((step) => step.status === 'error').length;
  const running = steps.filter((step) => step.status === 'running').length;
  if (errored > 0) return `${done}/${steps.length} verified · ${errored} failed`;
  if (running > 0) return `${done}/${steps.length} verified · ${running} running`;
  if (done === steps.length) return `${done}/${steps.length} verified`;
  return `${done}/${steps.length} verified`;
}

export function urlsUnavailableReason(
  invite: Pick<DeskInviteView, 'id' | 'status'>,
  showOnceById: Record<string, ShowOnceSecrets>,
): string | null {
  if (canCopyInviteSecrets(invite.id, showOnceById)) return null;
  if (invite.status === 'revoked') {
    return 'Invite revoked — regenerate to mint a new show-once URL bundle.';
  }
  if (invite.status === 'expired') {
    return 'Invite expired — regenerate to mint a new show-once URL bundle.';
  }
  return 'Setup URLs are show-once (create/regenerate). They are not re-emitted by GET.';
}
