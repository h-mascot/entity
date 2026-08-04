/**
 * THE-885 / WP2-B-04 — Chief-of-Staff routing policy service (claim/assign).
 *
 * Uses attach + presence overlays. Never invents live chief availability.
 * Does not execute privileged commands or expose secrets.
 */

import {
  createWorkplaneAttachService,
  type WorkplaneAttachService,
} from '../workplane-attach';
import {
  createPresenceService,
  type PresenceService,
} from '../presence';
import {
  createChiefRoutingStore,
  type ChiefRoutingStore,
} from './store';
import {
  evaluateAssignPolicy,
  evaluateClaimPolicy,
  isChiefPresenceAvailable,
  isPriorityWindowOpen,
} from './policy';
import type {
  AssignChiefInput,
  AssignRoutingInput,
  ClaimRoutingInput,
  ChiefPresenceOverlay,
  PolicyEvaluation,
  WorkplaneChiefAssignment,
  WorkplaneRoutingClaim,
  WorkplaneRoutingPanel,
} from './types';
import { DEFAULT_CHIEF_PRIORITY_WINDOW_MS } from './types';

export type RoutingFailureCode =
  | 'invalid_input'
  | 'not_attached'
  | 'target_not_attached'
  | 'chief_not_attached'
  | 'chief_priority'
  | 'already_claimed'
  | 'chief_required'
  | 'no_active_claim'
  | 'not_found';

export interface RoutingFailure {
  ok: false;
  error: string;
  code: RoutingFailureCode;
  statusCode: number;
  policy?: PolicyEvaluation;
}

export interface RoutingSuccess<T> {
  ok: true;
  value: T;
}

export type RoutingResult<T> = RoutingSuccess<T> | RoutingFailure;

export interface ChiefRoutingServiceDeps {
  store?: ChiefRoutingStore;
  attach?: WorkplaneAttachService;
  presence?: PresenceService;
  now?: () => Date;
}

export interface ChiefRoutingService {
  getPanel: (workplaneId: string, taskId?: number | null) => RoutingResult<WorkplaneRoutingPanel>;
  assignChief: (input: AssignChiefInput) => RoutingResult<{
    chief: WorkplaneChiefAssignment;
    created: boolean;
  }>;
  clearChief: (workplaneId: string) => RoutingResult<{
    cleared: boolean;
    alreadyCleared: boolean;
    workplaneId: string;
  }>;
  claim: (input: ClaimRoutingInput) => RoutingResult<{
    claim: WorkplaneRoutingClaim;
    created: boolean;
    policy: PolicyEvaluation;
  }>;
  assign: (input: AssignRoutingInput) => RoutingResult<{
    claim: WorkplaneRoutingClaim;
    created: boolean;
    policy: PolicyEvaluation;
  }>;
  release: (workplaneId: string, taskId?: number | null) => RoutingResult<{
    claim: WorkplaneRoutingClaim;
    released: boolean;
  }>;
  listDecisions: (workplaneId: string) => RoutingResult<{
    workplaneId: string;
    decisions: WorkplaneRoutingClaim[];
  }>;
}

function fail(
  code: RoutingFailureCode,
  error: string,
  statusCode: number,
  policy?: PolicyEvaluation,
): RoutingFailure {
  return { ok: false, code, error, statusCode, policy };
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

function normalizePriorityWindowMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.min(Math.floor(value), 24 * 60 * 60 * 1000);
  }
  return DEFAULT_CHIEF_PRIORITY_WINDOW_MS;
}

let singleton: ChiefRoutingService | null = null;

export function createChiefRoutingService(
  deps: ChiefRoutingServiceDeps = {},
): ChiefRoutingService {
  const store = deps.store ?? createChiefRoutingStore();
  const attach = deps.attach ?? createWorkplaneAttachService();
  const presence = deps.presence ?? createPresenceService();
  const now = deps.now ?? (() => new Date());

  store.ensureSchema();

  function findAttachment(workplaneId: string, agentId: string) {
    return attach.listAttachments(workplaneId).find((row) => row.agentId === agentId);
  }

  function chiefPresenceOverlay(
    workplaneId: string,
    chief: WorkplaneChiefAssignment | null,
  ): ChiefPresenceOverlay | null {
    if (!chief) return null;
    const panel = presence.getWorkplanePresence(workplaneId);
    const agents = panel.ok ? panel.value.agents : [];
    const matched = agents.find((row) => {
      if (row.agentId === chief.chiefAgentId) return true;
      if (chief.chiefInviteId && row.inviteId === chief.chiefInviteId) return true;
      if (chief.chiefInviteId && row.agentId === `invite:${chief.chiefInviteId}`) return true;
      return false;
    });
    const presenceStatus = matched?.presenceStatus ?? 'missing';
    return {
      agentId: chief.chiefAgentId,
      agentName: chief.chiefAgentName,
      presenceStatus,
      available: isChiefPresenceAvailable(presenceStatus),
      lastSeenAt: matched?.lastSeenAt ?? null,
      heartbeatFreshnessLabel: matched?.heartbeatFreshnessLabel ?? 'No heartbeat',
    };
  }

  function ensureWindow(
    workplaneId: string,
    taskId: number | null,
    priorityWindowMs: number,
    nowMs: number,
  ) {
    const existing = store.getWindow(workplaneId, taskId);
    if (existing) return existing;
    const openedAt = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + priorityWindowMs).toISOString();
    return store.upsertWindow({
      workplaneId,
      taskId,
      openedAt,
      priorityWindowMs,
      expiresAt,
    });
  }

  function chiefContext(workplaneId: string) {
    const assignment = store.getChief(workplaneId) ?? null;
    const overlay = chiefPresenceOverlay(workplaneId, assignment);
    return {
      assignment,
      presenceStatus: overlay?.presenceStatus ?? null,
      overlay,
    };
  }

  function buildPanel(workplaneId: string, taskId: number | null = null): WorkplaneRoutingPanel {
    const nowMs = now().getTime();
    const { assignment, overlay } = chiefContext(workplaneId);
    const activeClaim = store.getActiveClaim(workplaneId, taskId) ?? null;
    const priorityWindowMs = assignment?.priorityWindowMs ?? DEFAULT_CHIEF_PRIORITY_WINDOW_MS;
    const window = store.getWindow(workplaneId, taskId);
    const windowOpenedAtMs = window ? Date.parse(window.openedAt) : null;
    const windowExpiresAtMs = window ? Date.parse(window.expiresAt) : null;
    const priorityOpen = isPriorityWindowOpen(nowMs, windowOpenedAtMs, windowExpiresAtMs);
    const attached = attach.listAttachments(workplaneId);
    const chiefAvailable = Boolean(overlay?.available);

    let claimGate: WorkplaneRoutingPanel['policy']['claimGate'] = 'open';
    let workersMayClaim = true;
    let summary = 'Attached agents may claim (no chief gate).';

    if (activeClaim) {
      claimGate = 'blocked_claimed';
      workersMayClaim = false;
      summary = `Active claim held by ${activeClaim.agentId}.`;
    } else if (assignment && chiefAvailable && priorityOpen) {
      claimGate = 'chief_priority';
      workersMayClaim = false;
      summary = 'Chief priority window open — only the assigned chief may claim.';
    } else if (assignment && !chiefAvailable) {
      summary = 'Chief unavailable — attached workers may claim (fallback).';
    } else if (assignment && !priorityOpen) {
      summary = 'Chief priority window closed — attached workers may claim.';
    }

    return {
      workplaneId,
      evaluatedAt: now().toISOString(),
      chief: assignment,
      chiefPresence: overlay,
      activeClaim,
      priorityWindow: {
        open: priorityOpen,
        openedAt: window?.openedAt ?? null,
        expiresAt: window?.expiresAt ?? null,
        priorityWindowMs,
      },
      policy: {
        chiefRequired: false,
        workersMayClaim,
        claimGate,
        summary,
      },
      attachedAgentIds: attached.map((row) => row.agentId),
    };
  }

  return {
    getPanel(workplaneId, taskId) {
      const wp = present(workplaneId);
      if (!wp) return fail('invalid_input', 'workplaneId is required', 400);
      let task: number | null = null;
      if (taskId !== undefined) {
        const parsed = readTaskId(taskId);
        if (parsed === undefined) return fail('invalid_input', 'taskId is invalid', 400);
        task = parsed;
      }
      return { ok: true, value: buildPanel(wp, task) };
    },

    assignChief(input) {
      const workplaneId = present(input.workplaneId);
      const agentId = present(input.agentId);
      if (!workplaneId) return fail('invalid_input', 'workplaneId is required', 400);
      if (!agentId) return fail('invalid_input', 'agentId is required', 400);

      const attachment = findAttachment(workplaneId, agentId);
      if (!attachment) {
        return fail('chief_not_attached', 'Chief candidate must be attached to the workplane', 409);
      }

      const existing = store.getChief(workplaneId);
      const assignedAt = now().toISOString();
      const chief = store.upsertChief({
        workplaneId,
        chiefAgentId: agentId,
        chiefInviteId: attachment.inviteId,
        chiefAgentName: attachment.agentName,
        assignedAt: existing && existing.chiefAgentId === agentId ? existing.assignedAt : assignedAt,
        assignedBy: present(input.assignedBy),
        priorityWindowMs: normalizePriorityWindowMs(input.priorityWindowMs),
        updatedAt: assignedAt,
      });

      return {
        ok: true,
        value: {
          chief,
          created: !existing || existing.chiefAgentId !== agentId,
        },
      };
    },

    clearChief(workplaneId) {
      const wp = present(workplaneId);
      if (!wp) return fail('invalid_input', 'workplaneId is required', 400);
      const cleared = store.clearChief(wp);
      return {
        ok: true,
        value: {
          cleared: true,
          alreadyCleared: !cleared,
          workplaneId: wp,
        },
      };
    },

    claim(input) {
      const workplaneId = present(input.workplaneId);
      const agentId = present(input.agentId);
      if (!workplaneId) return fail('invalid_input', 'workplaneId is required', 400);
      if (!agentId) return fail('invalid_input', 'agentId is required', 400);

      let taskId: number | null = null;
      if (input.taskId !== undefined) {
        const parsed = readTaskId(input.taskId);
        if (parsed === undefined) return fail('invalid_input', 'taskId is invalid', 400);
        taskId = parsed;
      }

      const attachment = findAttachment(workplaneId, agentId);
      const { assignment, presenceStatus } = chiefContext(workplaneId);
      const activeClaim = store.getActiveClaim(workplaneId, taskId) ?? null;
      const nowMs = now().getTime();
      const priorityWindowMs = assignment?.priorityWindowMs ?? DEFAULT_CHIEF_PRIORITY_WINDOW_MS;

      // Open priority window on first claim interest when a chief is assigned.
      let windowOpenedAtMs: number | null = null;
      let windowExpiresAtMs: number | null = null;
      if (assignment) {
        const window = ensureWindow(workplaneId, taskId, priorityWindowMs, nowMs);
        windowOpenedAtMs = Date.parse(window.openedAt);
        windowExpiresAtMs = Date.parse(window.expiresAt);
      }

      const policy = evaluateClaimPolicy({
        actor: {
          agentId,
          agentName: attachment?.agentName,
          attached: Boolean(attachment),
        },
        chief: { assignment, presenceStatus },
        activeClaim,
        nowMs,
        windowOpenedAtMs,
        windowExpiresAtMs,
      });

      if (!policy.allowed) {
        const statusCode = policy.code === 'already_claimed' ? 409
          : policy.code === 'chief_priority' ? 409
            : policy.code === 'not_attached' ? 409
              : 400;
        return fail(policy.code as RoutingFailureCode, policy.policyReason, statusCode, policy);
      }

      if (activeClaim && activeClaim.agentId === agentId) {
        return {
          ok: true,
          value: { claim: activeClaim, created: false, policy },
        };
      }

      const claimedAt = now().toISOString();
      const claim = store.insertClaim({
        workplaneId,
        taskId,
        agentId,
        agentName: attachment?.agentName ?? agentId,
        claimMode: 'claim',
        status: 'active',
        requestId: present(input.requestId),
        policyCode: policy.code,
        policyReason: policy.policyReason,
        reasonChain: policy.reasonChain,
        claimedAt,
        claimedBy: agentId,
        releasedAt: null,
      });

      return { ok: true, value: { claim, created: true, policy } };
    },

    assign(input) {
      const workplaneId = present(input.workplaneId);
      const agentId = present(input.agentId);
      const assignedBy = present(input.assignedBy);
      if (!workplaneId) return fail('invalid_input', 'workplaneId is required', 400);
      if (!agentId) return fail('invalid_input', 'agentId is required', 400);
      if (!assignedBy) return fail('invalid_input', 'assignedBy is required', 400);

      let taskId: number | null = null;
      if (input.taskId !== undefined) {
        const parsed = readTaskId(input.taskId);
        if (parsed === undefined) return fail('invalid_input', 'taskId is invalid', 400);
        taskId = parsed;
      }

      const target = findAttachment(workplaneId, agentId);
      const assignerAttachment = findAttachment(workplaneId, assignedBy);
      const { assignment, presenceStatus } = chiefContext(workplaneId);
      const activeClaim = store.getActiveClaim(workplaneId, taskId) ?? null;
      const nowMs = now().getTime();
      const priorityWindowMs = assignment?.priorityWindowMs ?? DEFAULT_CHIEF_PRIORITY_WINDOW_MS;

      let windowOpenedAtMs: number | null = null;
      let windowExpiresAtMs: number | null = null;
      if (assignment) {
        const window = ensureWindow(workplaneId, taskId, priorityWindowMs, nowMs);
        windowOpenedAtMs = Date.parse(window.openedAt);
        windowExpiresAtMs = Date.parse(window.expiresAt);
      }

      const policy = evaluateAssignPolicy({
        target: {
          agentId,
          agentName: target?.agentName,
          attached: Boolean(target),
        },
        assigner: {
          id: assignedBy,
          asOperator: Boolean(input.asOperator),
          attached: Boolean(assignerAttachment),
        },
        chief: { assignment, presenceStatus },
        activeClaim,
        nowMs,
        windowOpenedAtMs,
        windowExpiresAtMs,
      });

      if (!policy.allowed) {
        const statusCode = policy.code === 'already_claimed' ? 409
          : policy.code === 'target_not_attached' || policy.code === 'not_attached' ? 409
            : policy.code === 'chief_required' ? 409
              : 400;
        return fail(policy.code as RoutingFailureCode, policy.policyReason, statusCode, policy);
      }

      if (activeClaim && activeClaim.agentId === agentId) {
        return {
          ok: true,
          value: { claim: activeClaim, created: false, policy },
        };
      }

      const claimedAt = now().toISOString();
      const claim = store.insertClaim({
        workplaneId,
        taskId,
        agentId,
        agentName: target?.agentName ?? agentId,
        claimMode: 'assign',
        status: 'active',
        requestId: present(input.requestId),
        policyCode: policy.code,
        policyReason: policy.policyReason,
        reasonChain: policy.reasonChain,
        claimedAt,
        claimedBy: assignedBy,
        releasedAt: null,
      });

      return { ok: true, value: { claim, created: true, policy } };
    },

    release(workplaneId, taskId) {
      const wp = present(workplaneId);
      if (!wp) return fail('invalid_input', 'workplaneId is required', 400);
      let task: number | null = null;
      if (taskId !== undefined) {
        const parsed = readTaskId(taskId);
        if (parsed === undefined) return fail('invalid_input', 'taskId is invalid', 400);
        task = parsed;
      }
      const active = store.getActiveClaim(wp, task);
      if (!active) {
        return fail('no_active_claim', 'No active claim to release', 404);
      }
      const released = store.releaseClaim(active.id, now().toISOString());
      if (!released) {
        return fail('no_active_claim', 'No active claim to release', 404);
      }
      return { ok: true, value: { claim: released, released: true } };
    },

    listDecisions(workplaneId) {
      const wp = present(workplaneId);
      if (!wp) return fail('invalid_input', 'workplaneId is required', 400);
      return {
        ok: true,
        value: {
          workplaneId: wp,
          decisions: store.listClaims(wp),
        },
      };
    },
  };
}

export function getChiefRoutingService(): ChiefRoutingService {
  if (!singleton) {
    singleton = createChiefRoutingService();
  }
  return singleton;
}

/** Reset singleton (tests). */
export function resetChiefRoutingServiceForTests(): void {
  singleton = null;
  try {
    createChiefRoutingStore().clearForTests();
  } catch {
    // best-effort when DB path not ready
  }
}
