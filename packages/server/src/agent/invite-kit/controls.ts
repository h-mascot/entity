/**
 * Durable invite create / revoke / regenerate / expiry controls (THE-880 / WP2-A-05).
 *
 * Human-facing APIs use this service. Tokenized onboarding routes call
 * resolveTokenizedInviteAccess() so revoke/expiry/rotation fail closed.
 */

import {
  createAgentInviteRepository,
  type AgentInviteProgressRecord,
  type AgentInviteRecord,
  type AgentInviteRepository,
} from '../../../../db/src/agent-invites';
import { getEntityDatabase } from '../../../../db/src/entity-db';
import {
  OnboardingAgentSessionSchema,
  OnboardingStateSchema,
  type OnboardingAgentSession,
} from '../../config/schema';
import { ensureAppSettingsTable, getSettingJson, setSettingJson } from '../../config/settings-store';
import {
  mapInviteStatusToOnboardingSession,
  shouldMutateGlobalOnboardingState,
} from './compatibility';
import {
  applyExpiryIfNeeded,
  applyRegenerate,
  canAccessTokenizedEndpoints,
  transitionInvite,
} from './status-machine';
import { hashInviteToken, mintInviteToken } from './token';
import {
  DEFAULT_AGENT_INVITE_TTL_MS,
  type AgentInviteDomain,
  type AgentInviteProgressItem,
  type AgentInviteStatus,
  type ChiefRoutingMode,
  type InviteCreationSource,
} from './types';

const ONBOARDING_AGENT_SESSION_PREFIX = 'onboarding.agentSession.';

export interface CreateDurableInviteInput {
  agentName: string;
  role?: string;
  ttlMs?: number;
  expiresAt?: string;
  selectedBundle?: string;
  selectedModules?: readonly string[];
  selectedModuleConfig?: Record<string, unknown>;
  permissionsScope?: readonly string[];
  safeStopConditions?: readonly string[];
  projectId?: string | null;
  workplaneId?: string | null;
  taskId?: number | null;
  workspaceId?: string | null;
  providerProfileId?: string | null;
  chiefRoutingMode?: ChiefRoutingMode;
  createdBy?: string | null;
  creationSource?: InviteCreationSource;
  progress?: readonly AgentInviteProgressItem[];
}

export interface InviteUrlBundle {
  setupPath: string;
  manifestPath: string;
  bundlePath: string;
  skillPath: string;
  progressPath: string;
}

export interface DurableInviteView {
  id: string;
  status: AgentInviteStatus;
  agentName: string;
  role: string;
  creationSource: InviteCreationSource;
  createdAt: string;
  expiresAt: string;
  openedAt: string | null;
  completedAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  generation: number;
  selectedBundle: string;
  selectedModules: string[];
  permissionsScope: string[];
  safeStopConditions: string[];
  projectId: string | null;
  workplaneId: string | null;
  taskId: number | null;
  persistence: 'durable';
  /** Raw token — present only on create / regenerate (show-once). */
  token?: string;
  setupPath?: string;
  manifestPath?: string;
  bundlePath?: string;
  skillPath?: string;
  progressPath?: string;
}

export type InviteControlFailureCode =
  | 'not_found'
  | 'forbidden_transition'
  | 'terminal_status'
  | 'missing_completion_evidence'
  | 'already_terminal'
  | 'invalid_clock'
  | 'invalid_input'
  | 'invite_revoked'
  | 'invite_expired'
  | 'invite_past_expires_at'
  | 'invite_token_rotated'
  | 'invite_status_blocked';

export interface InviteControlFailure {
  ok: false;
  error: string;
  code: InviteControlFailureCode;
  statusCode: number;
}

export interface InviteControlSuccess<T> {
  ok: true;
  value: T;
}

export type InviteControlResult<T> = InviteControlSuccess<T> | InviteControlFailure;

export type TokenizedInviteAccess =
  | { kind: 'legacy' }
  | { kind: 'allowed'; invite: AgentInviteDomain }
  | {
      kind: 'denied';
      statusCode: number;
      error: string;
      code: InviteControlFailureCode;
    };

export interface InviteControlsDeps {
  repo?: AgentInviteRepository;
  now?: () => Date;
  mintToken?: () => string;
}

function fail(
  code: InviteControlFailureCode,
  error: string,
  statusCode: number,
): InviteControlFailure {
  return { ok: false, code, error, statusCode };
}

function progressFromRecord(row: AgentInviteProgressRecord): AgentInviteProgressItem {
  return {
    stepId: row.step_id,
    label: row.label,
    moduleId: row.module_id ?? undefined,
    status: row.status,
    message: row.message ?? undefined,
    updatedAt: row.updated_at,
    evidenceUrl: row.evidence_url,
  };
}

export function recordToDomain(
  record: AgentInviteRecord,
  progress: readonly AgentInviteProgressRecord[] = [],
): AgentInviteDomain {
  return {
    id: record.id,
    tokenHash: record.token_hash,
    previousTokenHash: record.previous_token_hash,
    generation: record.generation,
    status: record.status,
    agentId: record.agent_id,
    agentName: record.agent_name,
    role: record.role,
    createdAt: record.created_at,
    openedAt: record.opened_at,
    completedAt: record.completed_at,
    expiresAt: record.expires_at,
    revokedAt: record.revoked_at,
    revokedBy: record.revoked_by,
    createdBy: record.created_by,
    creationSource: record.creation_source,
    workspaceId: record.workspace_id,
    projectId: record.project_id,
    workplaneId: record.workplane_id,
    taskId: record.task_id,
    selectedBundle: record.selected_bundle,
    selectedModules: record.selected_modules,
    selectedModuleConfig: record.selected_module_config,
    permissionsScope: record.permissions_scope,
    safeStopConditions: record.safe_stop_conditions,
    providerProfileId: record.provider_profile_id,
    chiefRoutingMode: record.chief_routing_mode,
    progress: progress.map(progressFromRecord),
  };
}

export function buildInviteUrlBundle(rawToken: string): InviteUrlBundle {
  const encoded = encodeURIComponent(rawToken);
  const apiPrefix = `/api/onboarding/agent-session/${encoded}`;
  return {
    setupPath: `/onboard/agent/${rawToken}`,
    manifestPath: `${apiPrefix}/manifest`,
    bundlePath: `${apiPrefix}/bundle`,
    skillPath: `${apiPrefix}/skill`,
    progressPath: `${apiPrefix}/progress`,
  };
}

function toPublicView(
  invite: AgentInviteDomain,
  options: { token?: string } = {},
): DurableInviteView {
  const base: DurableInviteView = {
    id: invite.id,
    status: invite.status,
    agentName: invite.agentName,
    role: invite.role,
    creationSource: invite.creationSource,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    openedAt: invite.openedAt,
    completedAt: invite.completedAt,
    revokedAt: invite.revokedAt,
    revokedBy: invite.revokedBy,
    generation: invite.generation,
    selectedBundle: invite.selectedBundle,
    selectedModules: [...invite.selectedModules],
    permissionsScope: [...invite.permissionsScope],
    safeStopConditions: [...invite.safeStopConditions],
    projectId: invite.projectId,
    workplaneId: invite.workplaneId,
    taskId: invite.taskId,
    persistence: 'durable',
  };
  if (!options.token) {
    return base;
  }
  const urls = buildInviteUrlBundle(options.token);
  return {
    ...base,
    token: options.token,
    ...urls,
  };
}

function persistDomain(
  repo: AgentInviteRepository,
  invite: AgentInviteDomain,
): AgentInviteRecord {
  const updated = repo.updateInvite(invite.id, {
    status: invite.status,
    opened_at: invite.openedAt,
    completed_at: invite.completedAt,
    revoked_at: invite.revokedAt,
    revoked_by: invite.revokedBy,
    expires_at: invite.expiresAt,
    token_hash: invite.tokenHash,
    generation: invite.generation,
    previous_token_hash: invite.previousTokenHash,
  });
  if (!updated) {
    throw new Error(`Failed to persist invite ${invite.id}`);
  }
  return updated;
}

function loadDomain(repo: AgentInviteRepository, id: string): AgentInviteDomain | null {
  const record = repo.getInviteById(id);
  if (!record) return null;
  return recordToDomain(record, repo.listProgress(id));
}

function resolveExpiresAt(input: CreateDurableInviteInput, now: Date): string {
  if (typeof input.expiresAt === 'string' && input.expiresAt.trim()) {
    const parsed = Date.parse(input.expiresAt);
    if (Number.isNaN(parsed)) {
      throw new Error('expiresAt must be a valid ISO timestamp');
    }
    return new Date(parsed).toISOString();
  }
  const ttl = typeof input.ttlMs === 'number' && Number.isFinite(input.ttlMs) && input.ttlMs > 0
    ? Math.min(input.ttlMs, 7 * 24 * 60 * 60 * 1000)
    : DEFAULT_AGENT_INVITE_TTL_MS;
  return new Date(now.getTime() + ttl).toISOString();
}

function writeCompatibilitySession(
  rawToken: string,
  invite: AgentInviteDomain,
  options: { markExpired?: boolean } = {},
): void {
  const db = getEntityDatabase(ensureAppSettingsTable);
  const legacyStatus = options.markExpired
    ? 'expired'
    : mapInviteStatusToOnboardingSession(invite.status);
  // revoked has no legacy status — fail-closed tombstone as expired
  const status = legacyStatus ?? 'expired';
  const session = OnboardingAgentSessionSchema.parse({
    token: rawToken,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    status,
    state: OnboardingStateSchema.parse({
      mode: 'agent',
      selectedBundle: ['minimal', 'default', 'custom'].includes(invite.selectedBundle)
        ? invite.selectedBundle
        : 'default',
      selectedModules: invite.selectedModules,
      selectedModuleConfig: invite.selectedModuleConfig,
    }),
    progress: invite.progress.map((step) => ({
      id: step.stepId,
      label: step.label,
      moduleId: step.moduleId,
      status: step.status,
      message: step.message,
      updatedAt: step.updatedAt,
    })),
  });
  setSettingJson(db, `${ONBOARDING_AGENT_SESSION_PREFIX}${rawToken}`, session, 'agents-invite');
}

function tombstoneCompatibilitySession(rawToken: string, expiresAt: string): void {
  const db = getEntityDatabase(ensureAppSettingsTable);
  const existing = getSettingJson(db, `${ONBOARDING_AGENT_SESSION_PREFIX}${rawToken}`);
  if (!existing || typeof existing !== 'object') {
    const tombstone = OnboardingAgentSessionSchema.parse({
      token: rawToken,
      createdAt: new Date().toISOString(),
      expiresAt,
      status: 'expired',
      progress: [],
    });
    setSettingJson(db, `${ONBOARDING_AGENT_SESSION_PREFIX}${rawToken}`, tombstone, 'agents-invite');
    return;
  }
  const parsed = OnboardingAgentSessionSchema.parse(existing);
  setSettingJson(
    db,
    `${ONBOARDING_AGENT_SESSION_PREFIX}${rawToken}`,
    { ...parsed, status: 'expired', expiresAt },
    'agents-invite',
  );
}

function refreshExpiry(
  repo: AgentInviteRepository,
  invite: AgentInviteDomain,
  now: Date,
): AgentInviteDomain {
  const result = applyExpiryIfNeeded(invite, now);
  if (!result.ok) return invite;
  if (result.to === result.from) return result.invite;
  persistDomain(repo, result.invite);
  return result.invite;
}

export function createInviteControls(deps: InviteControlsDeps = {}) {
  const repo = deps.repo ?? createAgentInviteRepository();
  const nowFn = deps.now ?? (() => new Date());
  const mintToken = deps.mintToken ?? (() => mintInviteToken());

  repo.ensureSchema();

  function createInvite(input: CreateDurableInviteInput): InviteControlResult<DurableInviteView> {
    try {
      const agentName = typeof input.agentName === 'string' ? input.agentName.trim() : '';
      if (!agentName) {
        return fail('invalid_input', 'agentName is required', 400);
      }
      const now = nowFn();
      const rawToken = mintToken();
      const tokenHash = hashInviteToken(rawToken);
      const creationSource = input.creationSource ?? 'agents_invite';
      const expiresAt = resolveExpiresAt(input, now);
      const progress = input.progress ?? [
        {
          stepId: 'install-entity-mc',
          label: 'Install Entity MC',
          moduleId: 'entity-mc',
          status: 'pending' as const,
          updatedAt: now.toISOString(),
        },
      ];

      const created = repo.createInvite({
        token_hash: tokenHash,
        agent_name: agentName,
        role: input.role?.trim() || 'worker',
        expires_at: expiresAt,
        created_at: now.toISOString(),
        created_by: input.createdBy ?? null,
        creation_source: creationSource,
        workspace_id: input.workspaceId ?? null,
        project_id: input.projectId ?? null,
        workplane_id: input.workplaneId ?? null,
        task_id: input.taskId ?? null,
        selected_bundle: input.selectedBundle?.trim() || 'default',
        selected_modules: input.selectedModules ?? ['entity-mc'],
        selected_module_config: input.selectedModuleConfig ?? {},
        permissions_scope: input.permissionsScope ?? [],
        safe_stop_conditions: input.safeStopConditions ?? [
          'Stop if manifest token is invalid/expired/revoked.',
        ],
        provider_profile_id: input.providerProfileId ?? null,
        chief_routing_mode: input.chiefRoutingMode ?? 'none',
        progress: progress.map((step) => ({
          step_id: step.stepId,
          label: step.label,
          module_id: step.moduleId ?? null,
          status: step.status,
          message: step.message ?? null,
          evidence_url: step.evidenceUrl ?? null,
          updated_at: step.updatedAt,
        })),
      });

      const domain = recordToDomain(created, repo.listProgress(created.id));
      // Agents invites must not mutate global first-run onboarding.state.
      // Compatibility session mirror only — never write ONBOARDING_STATE_KEY here.
      if (shouldMutateGlobalOnboardingState(creationSource)) {
        throw new Error('onboarding_first_run create is out of scope for /api/agents/invites');
      }
      writeCompatibilitySession(rawToken, domain);
      return { ok: true, value: toPublicView(domain, { token: rawToken }) };
    } catch (error) {
      return fail(
        'invalid_input',
        error instanceof Error ? error.message : String(error),
        400,
      );
    }
  }

  function getInvite(id: string): InviteControlResult<DurableInviteView> {
    const loaded = loadDomain(repo, id);
    if (!loaded) {
      return fail('not_found', 'Invite not found', 404);
    }
    const current = refreshExpiry(repo, loaded, nowFn());
    // Audit-safe: never re-emit raw token on GET.
    return { ok: true, value: toPublicView(current) };
  }

  function revokeInvite(
    id: string,
    options: { revokedBy?: string | null } = {},
  ): InviteControlResult<DurableInviteView> {
    const loaded = loadDomain(repo, id);
    if (!loaded) {
      return fail('not_found', 'Invite not found', 404);
    }
    const now = nowFn();
    const current = refreshExpiry(repo, loaded, now);
    const result = transitionInvite(current, 'revoke', {
      now,
      revokedBy: options.revokedBy ?? null,
    });
    if (!result.ok) {
      return fail(result.code, result.error, result.code === 'terminal_status' ? 409 : 400);
    }
    persistDomain(repo, result.invite);
    // Raw token is unknown here; tombstone any session that still matches current hash is
    // impossible without the raw token. Tokenized routes use durable hash lookup.
    return { ok: true, value: toPublicView(result.invite) };
  }

  function regenerateInvite(
    id: string,
    options: { ttlMs?: number; expiresAt?: string; revokedBy?: string | null } = {},
  ): InviteControlResult<DurableInviteView> {
    const loaded = loadDomain(repo, id);
    if (!loaded) {
      return fail('not_found', 'Invite not found', 404);
    }
    const now = nowFn();
    const current = refreshExpiry(repo, loaded, now);
    const newRaw = mintToken();
    const newHash = hashInviteToken(newRaw);
    let nextExpires = current.expiresAt;
    try {
      nextExpires = resolveExpiresAt(
        {
          agentName: current.agentName,
          ttlMs: options.ttlMs,
          expiresAt: options.expiresAt,
        },
        now,
      );
    } catch (error) {
      return fail(
        'invalid_input',
        error instanceof Error ? error.message : String(error),
        400,
      );
    }

    const result = applyRegenerate(current, newHash, { now, expiresAt: nextExpires });
    if (!result.ok) {
      return fail(result.code, result.error, 400);
    }
    persistDomain(repo, result.invite);
    // Old raw token unknown — mark rotated via previous_token_hash lookup on access.
    // If a caller still has the old token string, tombstone best-effort is N/A without it.
    writeCompatibilitySession(newRaw, result.invite);
    void options.revokedBy;
    return { ok: true, value: toPublicView(result.invite, { token: newRaw }) };
  }

  function resolveTokenizedInviteAccess(rawToken: string): TokenizedInviteAccess {
    if (typeof rawToken !== 'string' || rawToken.length < 8) {
      return {
        kind: 'denied',
        statusCode: 401,
        error: 'Invalid invite token',
        code: 'invalid_input',
      };
    }

    let tokenHash: string;
    try {
      tokenHash = hashInviteToken(rawToken);
    } catch {
      return {
        kind: 'denied',
        statusCode: 401,
        error: 'Invalid invite token',
        code: 'invalid_input',
      };
    }

    const byCurrent = repo.getInviteByTokenHash(tokenHash);
    if (byCurrent) {
      let domain = recordToDomain(byCurrent, repo.listProgress(byCurrent.id));
      domain = refreshExpiry(repo, domain, nowFn());
      const access = canAccessTokenizedEndpoints(domain, nowFn());
      if (!access.allowed) {
        const code = (access.reason ?? 'invite_status_blocked') as InviteControlFailureCode;
        return {
          kind: 'denied',
          statusCode: 401,
          error:
            code === 'invite_revoked'
              ? 'Invite has been revoked'
              : code === 'invite_expired' || code === 'invite_past_expires_at'
                ? 'Invite has expired'
                : 'Invite token is not usable',
          code,
        };
      }
      return { kind: 'allowed', invite: domain };
    }

    const byPrevious = repo.getInviteByPreviousTokenHash(tokenHash);
    if (byPrevious) {
      return {
        kind: 'denied',
        statusCode: 401,
        error: 'Invite token has been rotated',
        code: 'invite_token_rotated',
      };
    }

    // No durable invite for this token — preserve legacy onboarding sessions.
    return { kind: 'legacy' };
  }

  /** Mark opened on durable invite when tokenized manifest is fetched. */
  function markOpenedFromToken(rawToken: string): void {
    const access = resolveTokenizedInviteAccess(rawToken);
    if (access.kind !== 'allowed') return;
    const now = nowFn();
    const result = transitionInvite(access.invite, 'open_manifest', { now });
    if (!result.ok || result.to === result.from) return;
    persistDomain(repo, result.invite);
  }

  return {
    createInvite,
    getInvite,
    revokeInvite,
    regenerateInvite,
    resolveTokenizedInviteAccess,
    markOpenedFromToken,
    /** Test helper */
    _repo: repo,
  };
}

export type InviteControls = ReturnType<typeof createInviteControls>;

let defaultControls: InviteControls | null = null;

export function getInviteControls(): InviteControls {
  if (!defaultControls) {
    defaultControls = createInviteControls();
  }
  return defaultControls;
}

/** Reset singleton (tests). */
export function resetInviteControlsForTests(): void {
  defaultControls = null;
}

export function readLegacyAgentSession(rawToken: string): OnboardingAgentSession | null {
  const db = getEntityDatabase(ensureAppSettingsTable);
  const stored = getSettingJson(db, `${ONBOARDING_AGENT_SESSION_PREFIX}${rawToken}`);
  if (!stored) return null;
  return OnboardingAgentSessionSchema.parse(stored);
}

export { tombstoneCompatibilitySession };
