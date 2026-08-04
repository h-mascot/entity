/**
 * THE-883 / WP2-B-02 — Heartbeat / presence domain service.
 *
 * Updates last-seen from real heartbeats; evaluates stale/missing via
 * THE-882 identity/capability card builder. Never invents live agents.
 */

import {
  createInviteControls,
  type InviteControls,
} from '../invite-kit/controls';
import {
  buildAgentIdentityCapabilityCard,
  type AgentPresenceStatus,
} from '../identity-capability-card';
import {
  createWorkplaneAttachStore,
  type WorkplaneAttachStore,
} from '../workplane-attach/store';
import { createAgentPresenceStore, type AgentPresenceStore } from './store';
import {
  HEARTBEAT_INPUT_STATUSES,
  PRESENCE_STALE_AFTER_MS,
  type AgentPresenceRecord,
  type EvaluatedPresence,
  type HeartbeatInput,
  type HeartbeatInputStatus,
  type WorkplanePresencePanel,
} from './types';

export type PresenceFailureCode =
  | 'invalid_input'
  | 'not_found'
  | 'invalid_status';

export interface PresenceFailure {
  ok: false;
  error: string;
  code: PresenceFailureCode;
  statusCode: number;
}

export interface PresenceSuccess<T> {
  ok: true;
  value: T;
}

export type PresenceResult<T> = PresenceSuccess<T> | PresenceFailure;

export interface PresenceServiceDeps {
  store?: AgentPresenceStore;
  invites?: InviteControls;
  /** Explicit Workplane attachments (THE-884); optional to avoid inventing membership. */
  attachments?: WorkplaneAttachStore;
  now?: () => Date;
  staleAfterMs?: number;
}

export interface PresenceService {
  recordHeartbeat: (input: HeartbeatInput) => PresenceResult<{
    record: AgentPresenceRecord;
    evaluated: EvaluatedPresence;
  }>;
  getAgentPresence: (agentId: string) => PresenceResult<EvaluatedPresence>;
  getWorkplanePresence: (workplaneId: string) => PresenceResult<WorkplanePresencePanel>;
}

function fail(
  code: PresenceFailureCode,
  error: string,
  statusCode: number,
): PresenceFailure {
  return { ok: false, code, error, statusCode };
}

function present(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readTaskId(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeHeartbeatStatus(value: unknown): HeartbeatInputStatus | null {
  if (value == null || value === '') return 'live';
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if ((HEARTBEAT_INPUT_STATUSES as readonly string[]).includes(normalized)) {
    return normalized as HeartbeatInputStatus;
  }
  // Derived statuses are not accepted as heartbeat writes.
  if (normalized === 'stale' || normalized === 'missing' || normalized === 'unknown') {
    return null;
  }
  return null;
}

function countStatuses(agents: readonly EvaluatedPresence[]): WorkplanePresencePanel['counts'] {
  const counts: WorkplanePresencePanel['counts'] = {
    total: agents.length,
    live: 0,
    idle: 0,
    stale: 0,
    offline: 0,
    missing: 0,
    unknown: 0,
    degraded: 0,
  };
  for (const agent of agents) {
    switch (agent.presenceStatus) {
      case 'live':
        counts.live += 1;
        break;
      case 'idle':
        counts.idle += 1;
        break;
      case 'stale':
        counts.stale += 1;
        break;
      case 'offline':
        counts.offline += 1;
        break;
      case 'unknown':
        counts.unknown += 1;
        break;
      case 'missing':
      default:
        counts.missing += 1;
        break;
    }
    if (agent.cardCompleteness !== 'complete' || agent.degradedReasons.length > 0) {
      counts.degraded += 1;
    }
  }
  return counts;
}

let singleton: PresenceService | null = null;

export function createPresenceService(deps: PresenceServiceDeps = {}): PresenceService {
  const store = deps.store ?? createAgentPresenceStore();
  const invites = deps.invites ?? createInviteControls();
  const attachments = deps.attachments ?? createWorkplaneAttachStore();
  const now = deps.now ?? (() => new Date());
  const staleAfterMs = deps.staleAfterMs ?? PRESENCE_STALE_AFTER_MS;

  store.ensureSchema();
  attachments.ensureSchema();

  function evaluateRecord(
    record: AgentPresenceRecord,
    inviteHints?: {
      agentName?: string | null;
      role?: string | null;
      inviteId?: string | null;
      taskId?: number | null;
      workplaneId?: string | null;
    },
  ): EvaluatedPresence {
    const nowMs = now().getTime();
    const card = buildAgentIdentityCapabilityCard({
      invite: inviteHints
        ? {
            id: inviteHints.inviteId ?? record.inviteId,
            agentId: record.agentId,
            agentName: inviteHints.agentName,
            role: inviteHints.role,
            taskId: inviteHints.taskId ?? record.currentTaskId,
            workplaneId: inviteHints.workplaneId ?? record.currentWorkplaneId,
          }
        : {
            id: record.inviteId,
            agentId: record.agentId,
            taskId: record.currentTaskId,
            workplaneId: record.currentWorkplaneId,
          },
      presence: {
        agentId: record.agentId,
        status: record.status,
        lastSeenAt: record.lastSeenAt,
        currentTaskId: record.currentTaskId,
        currentWorkplaneId: record.currentWorkplaneId,
        runtime: record.runtime,
        sessionId: record.sessionId,
        capabilities: record.capabilities,
      },
      nowMs,
      staleAfterMs,
    });

    return {
      agentId: record.agentId,
      inviteId: record.inviteId,
      agentName: card.agentName,
      role: card.role,
      presenceStatus: card.presenceStatus,
      lastSeenAt: card.lastSeenAt,
      heartbeatFreshnessLabel: card.heartbeatFreshnessLabel,
      currentTaskId: card.currentTaskId,
      currentWorkplaneId: card.currentWorkplaneId,
      currentWorkLabel: card.currentWorkLabel,
      runtime: record.runtime,
      sessionId: record.sessionId,
      capabilities: record.capabilities,
      cardCompleteness: card.cardCompleteness,
      degradedReasons: card.degradedReasons.filter(
        (reason) => reason !== 'runtime_unbound' && reason !== 'model_unbound',
      ),
      source: 'heartbeat',
    };
  }

  function evaluateMissingInvite(invite: {
    id: string;
    agentName: string;
    role: string;
    taskId: number | null;
    workplaneId: string | null;
  }): EvaluatedPresence {
    const card = buildAgentIdentityCapabilityCard({
      invite: {
        id: invite.id,
        agentName: invite.agentName,
        role: invite.role,
        taskId: invite.taskId,
        workplaneId: invite.workplaneId,
      },
      nowMs: now().getTime(),
      staleAfterMs,
    });

    return {
      agentId: `invite:${invite.id}`,
      inviteId: invite.id,
      agentName: card.agentName,
      role: card.role,
      presenceStatus: 'missing',
      lastSeenAt: null,
      heartbeatFreshnessLabel: card.heartbeatFreshnessLabel,
      currentTaskId: card.currentTaskId,
      currentWorkplaneId: card.currentWorkplaneId,
      currentWorkLabel: card.currentWorkLabel,
      runtime: null,
      sessionId: null,
      capabilities: [],
      cardCompleteness: card.cardCompleteness,
      degradedReasons: card.degradedReasons.filter(
        (reason) => reason !== 'runtime_unbound' && reason !== 'model_unbound',
      ),
      source: 'invite_missing',
    };
  }

  function evaluateMissingAttachment(attachment: {
    agentId: string;
    inviteId: string | null;
    agentName: string;
    role: string;
    taskId: number | null;
    workplaneId: string;
  }): EvaluatedPresence {
    const card = buildAgentIdentityCapabilityCard({
      invite: {
        id: attachment.inviteId,
        agentId: attachment.agentId,
        agentName: attachment.agentName,
        role: attachment.role,
        taskId: attachment.taskId,
        workplaneId: attachment.workplaneId,
      },
      nowMs: now().getTime(),
      staleAfterMs,
    });

    return {
      agentId: attachment.agentId,
      inviteId: attachment.inviteId,
      agentName: card.agentName,
      role: card.role,
      presenceStatus: 'missing',
      lastSeenAt: null,
      heartbeatFreshnessLabel: card.heartbeatFreshnessLabel,
      currentTaskId: card.currentTaskId,
      currentWorkplaneId: card.currentWorkplaneId,
      currentWorkLabel: card.currentWorkLabel,
      runtime: null,
      sessionId: null,
      capabilities: [],
      cardCompleteness: card.cardCompleteness,
      degradedReasons: card.degradedReasons.filter(
        (reason) => reason !== 'runtime_unbound' && reason !== 'model_unbound',
      ),
      source: 'attachment_missing',
    };
  }

  return {
    recordHeartbeat(input) {
      const agentId = present(input.agentId);
      if (!agentId) {
        return fail('invalid_input', 'agentId is required', 400);
      }

      const status = normalizeHeartbeatStatus(input.status);
      if (!status) {
        return fail(
          'invalid_status',
          'status must be live, idle, or offline (stale/missing are derived on read)',
          400,
        );
      }

      const existing = store.getByAgentId(agentId);
      const inviteId = present(input.inviteId) ?? existing?.inviteId ?? null;

      let inviteHints: {
        agentName?: string | null;
        role?: string | null;
        inviteId?: string | null;
        taskId?: number | null;
        workplaneId?: string | null;
      } | undefined;

      if (inviteId) {
        const inviteResult = invites.getInvite(inviteId);
        if (inviteResult.ok) {
          inviteHints = {
            inviteId: inviteResult.value.id,
            agentName: inviteResult.value.agentName,
            role: inviteResult.value.role,
            taskId: inviteResult.value.taskId,
            workplaneId: inviteResult.value.workplaneId,
          };
        }
      }

      const taskId = readTaskId(input.currentTaskId);
      const workplaneId =
        input.currentWorkplaneId === undefined
          ? undefined
          : present(input.currentWorkplaneId);

      const clock = now().toISOString();
      const lastSeenAt = present(input.lastSeenAt) ?? clock;

      const record = store.upsertHeartbeat({
        agentId,
        inviteId,
        status,
        lastSeenAt,
        currentTaskId:
          taskId !== undefined
            ? taskId
            : existing?.currentTaskId ?? inviteHints?.taskId ?? null,
        currentWorkplaneId:
          workplaneId !== undefined
            ? workplaneId
            : existing?.currentWorkplaneId ?? inviteHints?.workplaneId ?? null,
        runtime:
          input.runtime === undefined
            ? existing?.runtime ?? null
            : present(input.runtime),
        sessionId:
          input.sessionId === undefined
            ? existing?.sessionId ?? null
            : present(input.sessionId),
        capabilities:
          input.capabilities === undefined
            ? existing?.capabilities ?? []
            : [...(input.capabilities ?? [])].filter(
                (item): item is string => typeof item === 'string' && item.trim().length > 0,
              ),
        updatedAt: clock,
      });

      return {
        ok: true,
        value: {
          record,
          evaluated: evaluateRecord(record, inviteHints),
        },
      };
    },

    getAgentPresence(agentId) {
      const id = present(agentId);
      if (!id) {
        return fail('invalid_input', 'agentId is required', 400);
      }
      const record = store.getByAgentId(id);
      if (!record) {
        return fail('not_found', 'presence not found', 404);
      }

      let inviteHints: {
        agentName?: string | null;
        role?: string | null;
        inviteId?: string | null;
        taskId?: number | null;
        workplaneId?: string | null;
      } | undefined;
      if (record.inviteId) {
        const inviteResult = invites.getInvite(record.inviteId);
        if (inviteResult.ok) {
          inviteHints = {
            inviteId: inviteResult.value.id,
            agentName: inviteResult.value.agentName,
            role: inviteResult.value.role,
            taskId: inviteResult.value.taskId,
            workplaneId: inviteResult.value.workplaneId,
          };
        }
      }

      return { ok: true, value: evaluateRecord(record, inviteHints) };
    },

    getWorkplanePresence(workplaneId) {
      const id = present(workplaneId);
      if (!id) {
        return fail('invalid_input', 'workplaneId is required', 400);
      }

      const heartbeatRows = store.listByWorkplaneId(id);
      const agents: EvaluatedPresence[] = [];
      const seenAgentKeys = new Set<string>();
      const seenInviteIds = new Set<string>();

      for (const record of heartbeatRows) {
        let inviteHints: {
          agentName?: string | null;
          role?: string | null;
          inviteId?: string | null;
          taskId?: number | null;
          workplaneId?: string | null;
        } | undefined;
        if (record.inviteId) {
          seenInviteIds.add(record.inviteId);
          const inviteResult = invites.getInvite(record.inviteId);
          if (inviteResult.ok) {
            inviteHints = {
              inviteId: inviteResult.value.id,
              agentName: inviteResult.value.agentName,
              role: inviteResult.value.role,
              taskId: inviteResult.value.taskId,
              workplaneId: inviteResult.value.workplaneId,
            };
          }
        }
        const evaluated = evaluateRecord(record, inviteHints);
        agents.push(evaluated);
        seenAgentKeys.add(evaluated.agentId);
      }

      // Invite-bound agents for this workplane with no heartbeat → explicit missing.
      const inviteList = invites.listInvites({ limit: 500 });
      if (inviteList.ok) {
        for (const invite of inviteList.value.invites) {
          if (invite.workplaneId !== id) continue;
          if (seenInviteIds.has(invite.id)) continue;
          const missingKey = `invite:${invite.id}`;
          if (seenAgentKeys.has(missingKey)) continue;
          // Bound invites without heartbeats stay missing — never invent live activity.
          agents.push(
            evaluateMissingInvite({
              id: invite.id,
              agentName: invite.agentName,
              role: invite.role,
              taskId: invite.taskId,
              workplaneId: invite.workplaneId,
            }),
          );
          seenAgentKeys.add(missingKey);
          seenInviteIds.add(invite.id);
        }
      }

      // Explicit attachments (THE-884) with no heartbeat → missing, never invent live.
      for (const attachment of attachments.listByWorkplaneId(id)) {
        if (seenAgentKeys.has(attachment.agentId)) continue;
        if (attachment.inviteId && seenInviteIds.has(attachment.inviteId)) continue;
        agents.push(
          evaluateMissingAttachment({
            agentId: attachment.agentId,
            inviteId: attachment.inviteId,
            agentName: attachment.agentName,
            role: attachment.role,
            taskId: attachment.taskId,
            workplaneId: attachment.workplaneId,
          }),
        );
        seenAgentKeys.add(attachment.agentId);
        if (attachment.inviteId) seenInviteIds.add(attachment.inviteId);
      }

      agents.sort((a, b) => {
        const rank = (status: AgentPresenceStatus): number => {
          switch (status) {
            case 'live':
              return 0;
            case 'idle':
              return 1;
            case 'stale':
              return 2;
            case 'offline':
              return 3;
            case 'unknown':
              return 4;
            case 'missing':
            default:
              return 5;
          }
        };
        const diff = rank(a.presenceStatus) - rank(b.presenceStatus);
        if (diff !== 0) return diff;
        return a.agentName.localeCompare(b.agentName);
      });

      const evaluatedAt = now().toISOString();
      return {
        ok: true,
        value: {
          workplaneId: id,
          staleAfterMs,
          evaluatedAt,
          agents,
          counts: countStatuses(agents),
        },
      };
    },
  };
}

export function getPresenceService(): PresenceService {
  if (!singleton) {
    singleton = createPresenceService();
  }
  return singleton;
}

/** Reset singleton (tests). */
export function resetPresenceServiceForTests(): void {
  singleton = null;
  try {
    createAgentPresenceStore().clearForTests();
  } catch {
    // best-effort when DB path not ready
  }
}
