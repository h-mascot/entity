/**
 * THE-884 / WP2-B-03 — Attach / detach / list agents on task Workplanes.
 *
 * Uses durable attachment rows + invite/identity/presence overlays.
 * Missing/offline/live stay truthful — never invent agent activity.
 */

import {
  createInviteControls,
  type InviteControls,
} from '../invite-kit/controls';
import {
  createPresenceService,
  type PresenceService,
  type EvaluatedPresence,
} from '../presence';
import { buildAgentIdentityCapabilityCard } from '../identity-capability-card';
import { createWorkplaneAttachStore, type WorkplaneAttachStore } from './store';
import type {
  AttachAgentInput,
  WorkplaneAgentAttachment,
  WorkplaneAttachedAgentView,
  WorkplaneAttachedAgentsPanel,
} from './types';

export type AttachFailureCode =
  | 'invalid_input'
  | 'not_found'
  | 'invite_not_found';

export interface AttachFailure {
  ok: false;
  error: string;
  code: AttachFailureCode;
  statusCode: number;
}

export interface AttachSuccess<T> {
  ok: true;
  value: T;
}

export type AttachResult<T> = AttachSuccess<T> | AttachFailure;

export interface WorkplaneAttachServiceDeps {
  store?: WorkplaneAttachStore;
  invites?: InviteControls;
  presence?: PresenceService;
  now?: () => Date;
}

export interface WorkplaneAttachService {
  attach: (input: AttachAgentInput) => AttachResult<{
    attachment: WorkplaneAgentAttachment;
    created: boolean;
    agent: WorkplaneAttachedAgentView;
  }>;
  detach: (workplaneId: string, agentId: string) => AttachResult<{
    detached: boolean;
    alreadyDetached: boolean;
    agentId: string;
    workplaneId: string;
  }>;
  list: (workplaneId: string) => AttachResult<WorkplaneAttachedAgentsPanel>;
  /** Active attachment rows for a workplane (no presence overlay). */
  listAttachments: (workplaneId: string) => WorkplaneAgentAttachment[];
}

function fail(
  code: AttachFailureCode,
  error: string,
  statusCode: number,
): AttachFailure {
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

function countStatuses(
  agents: readonly WorkplaneAttachedAgentView[],
): WorkplaneAttachedAgentsPanel['counts'] {
  const counts: WorkplaneAttachedAgentsPanel['counts'] = {
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
    if (agent.degradedReasons.length > 0) {
      counts.degraded += 1;
    }
  }
  return counts;
}

function matchPresence(
  attachment: WorkplaneAgentAttachment,
  presenceAgents: readonly EvaluatedPresence[],
): EvaluatedPresence | undefined {
  return presenceAgents.find((row) => {
    if (row.agentId === attachment.agentId) return true;
    if (attachment.inviteId && row.inviteId === attachment.inviteId) return true;
    if (attachment.inviteId && row.agentId === `invite:${attachment.inviteId}`) return true;
    return false;
  });
}

let singleton: WorkplaneAttachService | null = null;

export function createWorkplaneAttachService(
  deps: WorkplaneAttachServiceDeps = {},
): WorkplaneAttachService {
  const store = deps.store ?? createWorkplaneAttachStore();
  const invites = deps.invites ?? createInviteControls();
  const presence = deps.presence ?? createPresenceService({ invites });
  const now = deps.now ?? (() => new Date());

  store.ensureSchema();

  function evaluateAttachment(
    attachment: WorkplaneAgentAttachment,
    presenceAgents: readonly EvaluatedPresence[] = [],
  ): WorkplaneAttachedAgentView {
    const matched = matchPresence(attachment, presenceAgents);
    if (matched && matched.source === 'heartbeat') {
      return {
        attachmentId: attachment.id,
        workplaneId: attachment.workplaneId,
        agentId: attachment.agentId,
        inviteId: attachment.inviteId ?? matched.inviteId,
        taskId: attachment.taskId ?? matched.currentTaskId,
        agentName: attachment.agentName || matched.agentName,
        role: attachment.role || matched.role,
        attachedAt: attachment.attachedAt,
        attachedBy: attachment.attachedBy,
        presenceStatus: matched.presenceStatus,
        lastSeenAt: matched.lastSeenAt,
        heartbeatFreshnessLabel: matched.heartbeatFreshnessLabel,
        currentWorkLabel: matched.currentWorkLabel,
        degradedReasons: matched.degradedReasons,
        source: 'heartbeat',
      };
    }

    // No heartbeat → explicit missing. Never invent live.
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
    });

    return {
      attachmentId: attachment.id,
      workplaneId: attachment.workplaneId,
      agentId: attachment.agentId,
      inviteId: attachment.inviteId,
      taskId: attachment.taskId,
      agentName: attachment.agentName || card.agentName,
      role: attachment.role || card.role,
      attachedAt: attachment.attachedAt,
      attachedBy: attachment.attachedBy,
      presenceStatus: 'missing',
      lastSeenAt: null,
      heartbeatFreshnessLabel: card.heartbeatFreshnessLabel,
      currentWorkLabel: card.currentWorkLabel,
      degradedReasons: card.degradedReasons.filter(
        (reason) => reason !== 'runtime_unbound' && reason !== 'model_unbound',
      ),
      source: attachment.inviteId ? 'invite_missing' : 'attachment',
    };
  }

  function presenceAgentsFor(workplaneId: string): EvaluatedPresence[] {
    const panel = presence.getWorkplanePresence(workplaneId);
    return panel.ok ? panel.value.agents : [];
  }

  return {
    listAttachments(workplaneId) {
      const wp = present(workplaneId);
      if (!wp) return [];
      return store.listByWorkplaneId(wp);
    },

    attach(input) {
      const workplaneId = present(input.workplaneId);
      if (!workplaneId) {
        return fail('invalid_input', 'workplaneId is required', 400);
      }

      const inviteId = present(input.inviteId);
      let agentId = present(input.agentId);
      let agentName = present(input.agentName);
      let role = present(input.role) ?? 'worker';
      let taskId = readTaskId(input.taskId);
      if (taskId === undefined) taskId = null;

      if (inviteId) {
        const inviteResult = invites.getInvite(inviteId);
        if (!inviteResult.ok) {
          return fail('invite_not_found', `Invite not found: ${inviteId}`, 404);
        }
        const invite = inviteResult.value;
        agentName = agentName ?? invite.agentName;
        role = present(input.role) ?? invite.role ?? 'worker';
        if (taskId == null && invite.taskId != null) {
          taskId = invite.taskId;
        }
        // Prefer explicit agentId; else stable invite-scoped key (matches presence missing).
        if (!agentId) {
          agentId = `invite:${invite.id}`;
        }
      }

      if (!agentId) {
        return fail('invalid_input', 'agentId or inviteId is required', 400);
      }
      if (!agentName) {
        agentName = agentId;
      }

      const existing = store.getByWorkplaneAndAgent(workplaneId, agentId);
      if (existing) {
        return {
          ok: true,
          value: {
            attachment: existing,
            created: false,
            agent: evaluateAttachment(existing, presenceAgentsFor(workplaneId)),
          },
        };
      }

      const attachedAt = now().toISOString();
      const attachment = store.insert({
        workplaneId,
        agentId,
        inviteId,
        taskId,
        agentName,
        role,
        attachedAt,
        attachedBy: present(input.attachedBy),
      });

      return {
        ok: true,
        value: {
          attachment,
          created: true,
          agent: evaluateAttachment(attachment, presenceAgentsFor(workplaneId)),
        },
      };
    },

    detach(workplaneId, agentId) {
      const wp = present(workplaneId);
      const agent = present(agentId);
      if (!wp) {
        return fail('invalid_input', 'workplaneId is required', 400);
      }
      if (!agent) {
        return fail('invalid_input', 'agentId is required', 400);
      }

      const existing = store.getByWorkplaneAndAgent(wp, agent);
      if (!existing) {
        // Idempotent detach — already absent is success, not inventing membership.
        return {
          ok: true,
          value: {
            detached: true,
            alreadyDetached: true,
            agentId: agent,
            workplaneId: wp,
          },
        };
      }

      store.deleteByWorkplaneAndAgent(wp, agent);
      return {
        ok: true,
        value: {
          detached: true,
          alreadyDetached: false,
          agentId: agent,
          workplaneId: wp,
        },
      };
    },

    list(workplaneId) {
      const wp = present(workplaneId);
      if (!wp) {
        return fail('invalid_input', 'workplaneId is required', 400);
      }

      const presenceAgents = presenceAgentsFor(wp);
      const rows = store.listByWorkplaneId(wp);
      const agents = rows.map((row) => evaluateAttachment(row, presenceAgents));
      agents.sort((a, b) => {
        const rank = (status: WorkplaneAttachedAgentView['presenceStatus']): number => {
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

      return {
        ok: true,
        value: {
          workplaneId: wp,
          evaluatedAt: now().toISOString(),
          agents,
          counts: countStatuses(agents),
        },
      };
    },
  };
}

export function getWorkplaneAttachService(): WorkplaneAttachService {
  if (!singleton) {
    singleton = createWorkplaneAttachService();
  }
  return singleton;
}

/** Reset singleton (tests). */
export function resetWorkplaneAttachServiceForTests(): void {
  singleton = null;
  try {
    createWorkplaneAttachStore().clearForTests();
  } catch {
    // best-effort when DB path not ready
  }
}
