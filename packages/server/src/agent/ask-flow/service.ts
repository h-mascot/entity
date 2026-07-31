/**
 * THE-886 / WP2-B-05 — ASK claim/resolve service.
 *
 * Durable ASK lifecycle with CAS claim/resolve. Preserves WP2-B-04 chief
 * priority and worker fallback. Never invents live chief presence or privileged
 * command execution.
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
} from '../chief-routing/store';
import { isChiefPresenceAvailable } from '../chief-routing/policy';
import { DEFAULT_CHIEF_PRIORITY_WINDOW_MS } from '../chief-routing/types';
import {
  createAskFlowStore,
  type AskFlowStore,
} from './store';
import {
  evaluateAskBlockPolicy,
  evaluateAskClaimPolicy,
  evaluateAskResolvePolicy,
  evaluateCreateAskStatus,
} from './policy';
import type {
  AskDenyCode,
  AskStatus,
  BlockAskInput,
  ClaimAskInput,
  CreateAskInput,
  ResolveAskInput,
  WorkplaneAsk,
  WorkplaneAskEvent,
  WorkplaneAskPanel,
} from './types';
import { ASK_STATUSES } from './types';

export type AskFailureCode = AskDenyCode;

export interface AskFailure {
  ok: false;
  error: string;
  code: AskFailureCode;
  statusCode: number;
  ask?: WorkplaneAsk;
  policy?: { code: string; policyReason: string; reasonChain: unknown[] };
}

export interface AskSuccess<T> {
  ok: true;
  value: T;
}

export type AskResult<T> = AskSuccess<T> | AskFailure;

export interface AskFlowServiceDeps {
  store?: AskFlowStore;
  attach?: WorkplaneAttachService;
  presence?: PresenceService;
  routingStore?: ChiefRoutingStore;
  now?: () => Date;
}

export interface AskFlowService {
  getPanel: (workplaneId: string) => AskResult<WorkplaneAskPanel>;
  listAsks: (workplaneId: string) => AskResult<{ workplaneId: string; asks: WorkplaneAsk[] }>;
  getAsk: (workplaneId: string, askId: string) => AskResult<WorkplaneAsk>;
  createAsk: (input: CreateAskInput) => AskResult<{ ask: WorkplaneAsk; created: true }>;
  claimAsk: (input: ClaimAskInput) => AskResult<{
    ask: WorkplaneAsk;
    created: boolean;
    policy: { code: string; policyReason: string; reasonChain: unknown[] };
  }>;
  resolveAsk: (input: ResolveAskInput) => AskResult<{
    ask: WorkplaneAsk;
    policy: { code: string; policyReason: string; reasonChain: unknown[] };
  }>;
  blockAsk: (input: BlockAskInput) => AskResult<{
    ask: WorkplaneAsk;
    policy: { code: string; policyReason: string; reasonChain: unknown[] };
  }>;
  listEvents: (workplaneId: string, askId: string) => AskResult<{
    askId: string;
    events: WorkplaneAskEvent[];
  }>;
}

function fail(
  code: AskFailureCode,
  error: string,
  statusCode: number,
  extras?: { ask?: WorkplaneAsk; policy?: AskFailure['policy'] },
): AskFailure {
  return { ok: false, code, error, statusCode, ...extras };
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

function readExpectedVersion(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

function readExpectedStatus(value: unknown): AskStatus | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string' && (ASK_STATUSES as readonly string[]).includes(value)) {
    return value as AskStatus;
  }
  return undefined;
}

function panelSummary(asks: WorkplaneAsk[]): string {
  if (asks.length === 0) return 'No ASKs on this workplane';
  const openish = asks.filter((a) => a.status === 'open' || a.status === 'chief_review').length;
  const claimed = asks.filter((a) => a.status === 'claimed').length;
  const stale = asks.filter((a) => a.status === 'stale').length;
  const resolved = asks.filter((a) => a.status === 'resolved').length;
  const parts = [
    openish ? `${openish} open` : null,
    claimed ? `${claimed} claimed` : null,
    stale ? `${stale} stale` : null,
    resolved ? `${resolved} resolved` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : `${asks.length} ASK(s)`;
}

let singleton: AskFlowService | null = null;

export function createAskFlowService(deps: AskFlowServiceDeps = {}): AskFlowService {
  const store = deps.store ?? createAskFlowStore();
  const attach = deps.attach ?? createWorkplaneAttachService();
  const presence = deps.presence ?? createPresenceService();
  const routingStore = deps.routingStore ?? createChiefRoutingStore();
  const now = deps.now ?? (() => new Date());

  store.ensureSchema();
  routingStore.ensureSchema();

  function findAttachment(workplaneId: string, agentId: string) {
    return attach.listAttachments(workplaneId).find((row) => row.agentId === agentId);
  }

  function chiefContext(workplaneId: string) {
    const assignment = routingStore.getChief(workplaneId) ?? null;
    if (!assignment) {
      return { assignment: null, presenceStatus: null as null, available: false };
    }
    const panel = presence.getWorkplanePresence(workplaneId);
    const agents = panel.ok ? panel.value.agents : [];
    const matched = agents.find((row) => {
      if (row.agentId === assignment.chiefAgentId) return true;
      if (assignment.chiefInviteId && row.inviteId === assignment.chiefInviteId) return true;
      if (assignment.chiefInviteId && row.agentId === `invite:${assignment.chiefInviteId}`) {
        return true;
      }
      return false;
    });
    const presenceStatus = matched?.presenceStatus ?? 'missing';
    return {
      assignment,
      presenceStatus,
      available: isChiefPresenceAvailable(presenceStatus),
    };
  }

  function ensureWindow(
    workplaneId: string,
    taskId: number | null,
    priorityWindowMs: number,
    nowMs: number,
  ) {
    const existing = routingStore.getWindow(workplaneId, taskId);
    if (existing) return existing;
    const openedAt = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + priorityWindowMs).toISOString();
    return routingStore.upsertWindow({
      workplaneId,
      taskId,
      openedAt,
      priorityWindowMs,
      expiresAt,
    });
  }

  function requireAsk(workplaneId: string, askId: string): AskResult<WorkplaneAsk> {
    const wp = present(workplaneId);
    const id = present(askId);
    if (!wp) return fail('invalid_input', 'workplaneId is required', 400);
    if (!id) return fail('invalid_input', 'askId is required', 400);
    const ask = store.getAsk(id);
    if (!ask || ask.workplaneId !== wp) {
      return fail('not_found', 'ASK not found on workplane', 404);
    }
    return { ok: true, value: ask };
  }

  function recordCasReject(
    ask: WorkplaneAsk,
    actorId: string | null,
    detail: string,
  ): void {
    store.insertEvent({
      askId: ask.id,
      workplaneId: ask.workplaneId,
      eventType: 'cas_rejected',
      actorId,
      fromStatus: ask.status,
      toStatus: ask.status,
      fromVersion: ask.version,
      toVersion: ask.version,
      code: 'stale_version',
      detail,
      createdAt: now().toISOString(),
    });
  }

  return {
    getPanel(workplaneId) {
      const wp = present(workplaneId);
      if (!wp) return fail('invalid_input', 'workplaneId is required', 400);
      const asks = store.listAsks(wp);
      return {
        ok: true,
        value: {
          workplaneId: wp,
          evaluatedAt: now().toISOString(),
          asks,
          openCount: asks.filter((a) => a.status === 'open' || a.status === 'chief_review').length,
          claimedCount: asks.filter((a) => a.status === 'claimed').length,
          resolvedCount: asks.filter((a) => a.status === 'resolved').length,
          staleCount: asks.filter((a) => a.status === 'stale').length,
          summary: panelSummary(asks),
        },
      };
    },

    listAsks(workplaneId) {
      const wp = present(workplaneId);
      if (!wp) return fail('invalid_input', 'workplaneId is required', 400);
      return { ok: true, value: { workplaneId: wp, asks: store.listAsks(wp) } };
    },

    getAsk(workplaneId, askId) {
      return requireAsk(workplaneId, askId);
    },

    createAsk(input) {
      const workplaneId = present(input.workplaneId);
      const title = present(input.title);
      if (!workplaneId) return fail('invalid_input', 'workplaneId is required', 400);
      if (!title) return fail('invalid_input', 'title is required', 400);

      let taskId: number | null = null;
      if (input.taskId !== undefined) {
        const parsed = readTaskId(input.taskId);
        if (parsed === undefined) return fail('invalid_input', 'taskId is invalid', 400);
        taskId = parsed;
      }

      const { assignment, available } = chiefContext(workplaneId);
      const createPolicy = evaluateCreateAskStatus({
        chiefAssigned: Boolean(assignment),
        chiefAvailable: available,
      });
      const createdAt = now().toISOString();
      const ask = store.insertAsk({
        workplaneId,
        taskId,
        title,
        body: present(input.body),
        status: createPolicy.nextStatus ?? 'open',
        version: 1,
        createdBy: present(input.createdBy),
        createdAt,
        updatedAt: createdAt,
        claimantAgentId: null,
        claimantAgentName: null,
        claimedAt: null,
        claimPolicyCode: null,
        resolvedBy: null,
        resolvedAt: null,
        resolutionNote: null,
        blockedReason: null,
        reasonChain: createPolicy.reasonChain,
      });

      store.insertEvent({
        askId: ask.id,
        workplaneId,
        eventType: 'created',
        actorId: ask.createdBy,
        fromStatus: null,
        toStatus: ask.status,
        fromVersion: null,
        toVersion: ask.version,
        code: createPolicy.code,
        detail: createPolicy.policyReason,
        createdAt,
      });

      return { ok: true, value: { ask, created: true } };
    },

    claimAsk(input) {
      const workplaneId = present(input.workplaneId);
      const askId = present(input.askId);
      const agentId = present(input.agentId);
      const expectedVersion = readExpectedVersion(input.expectedVersion);
      if (!workplaneId) return fail('invalid_input', 'workplaneId is required', 400);
      if (!askId) return fail('invalid_input', 'askId is required', 400);
      if (!agentId) return fail('invalid_input', 'agentId is required', 400);
      if (expectedVersion === undefined) {
        return fail('invalid_input', 'expectedVersion is required for CAS claim', 400);
      }

      const existingResult = requireAsk(workplaneId, askId);
      if (!existingResult.ok) return existingResult;
      const existing = existingResult.value;

      if (existing.version !== expectedVersion) {
        recordCasReject(
          existing,
          agentId,
          `CAS claim rejected: expected version ${expectedVersion}, actual ${existing.version}`,
        );
        return fail(
          'stale_version',
          `Stale ASK version: expected ${expectedVersion}, actual ${existing.version}`,
          409,
          { ask: existing },
        );
      }

      const expectedStatus = readExpectedStatus(input.expectedStatus);
      if (expectedStatus === undefined && input.expectedStatus !== undefined) {
        return fail('invalid_input', 'expectedStatus is invalid', 400);
      }
      if (expectedStatus && existing.status !== expectedStatus) {
        recordCasReject(
          existing,
          agentId,
          `CAS claim rejected: expected status ${expectedStatus}, actual ${existing.status}`,
        );
        return fail(
          'stale_version',
          `Stale ASK status: expected ${expectedStatus}, actual ${existing.status}`,
          409,
          { ask: existing },
        );
      }

      const attachment = findAttachment(workplaneId, agentId);
      const { assignment, presenceStatus } = chiefContext(workplaneId);
      const nowMs = now().getTime();
      const priorityWindowMs = assignment?.priorityWindowMs ?? DEFAULT_CHIEF_PRIORITY_WINDOW_MS;
      let windowOpenedAtMs: number | null = null;
      let windowExpiresAtMs: number | null = null;
      if (assignment) {
        const window = ensureWindow(workplaneId, existing.taskId, priorityWindowMs, nowMs);
        windowOpenedAtMs = Date.parse(window.openedAt);
        windowExpiresAtMs = Date.parse(window.expiresAt);
      }

      const policy = evaluateAskClaimPolicy({
        ask: existing,
        actor: {
          agentId,
          agentName: attachment?.agentName,
          attached: Boolean(attachment),
        },
        chief: { assignment, presenceStatus },
        nowMs,
        windowOpenedAtMs,
        windowExpiresAtMs,
      });

      if (!policy.allowed) {
        const statusCode = policy.code === 'already_claimed'
          || policy.code === 'chief_priority'
          || policy.code === 'not_attached'
          || policy.code === 'already_terminal'
          || policy.code === 'not_claimable'
          ? 409
          : 400;
        return fail(policy.code as AskFailureCode, policy.policyReason, statusCode, {
          ask: existing,
          policy: {
            code: policy.code,
            policyReason: policy.policyReason,
            reasonChain: policy.reasonChain,
          },
        });
      }

      if (policy.code === 'idempotent_claim') {
        return {
          ok: true,
          value: {
            ask: existing,
            created: false,
            policy: {
              code: policy.code,
              policyReason: policy.policyReason,
              reasonChain: policy.reasonChain,
            },
          },
        };
      }

      const claimedAt = now().toISOString();
      const updated = store.casUpdateAsk(askId, expectedVersion, {
        status: 'claimed',
        updatedAt: claimedAt,
        claimantAgentId: agentId,
        claimantAgentName: attachment?.agentName ?? agentId,
        claimedAt,
        claimPolicyCode: policy.code,
        reasonChain: policy.reasonChain,
      });

      if (!updated) {
        const latest = store.getAsk(askId);
        if (latest) {
          recordCasReject(
            latest,
            agentId,
            `CAS claim lost race: expected version ${expectedVersion}`,
          );
        }
        return fail(
          'stale_version',
          'Stale ASK version (concurrent claim)',
          409,
          { ask: latest },
        );
      }

      store.insertEvent({
        askId: updated.id,
        workplaneId,
        eventType: 'claimed',
        actorId: agentId,
        fromStatus: existing.status,
        toStatus: updated.status,
        fromVersion: existing.version,
        toVersion: updated.version,
        code: policy.code,
        detail: policy.policyReason,
        createdAt: claimedAt,
      });

      return {
        ok: true,
        value: {
          ask: updated,
          created: true,
          policy: {
            code: policy.code,
            policyReason: policy.policyReason,
            reasonChain: policy.reasonChain,
          },
        },
      };
    },

    resolveAsk(input) {
      const workplaneId = present(input.workplaneId);
      const askId = present(input.askId);
      const resolvedBy = present(input.resolvedBy);
      const expectedVersion = readExpectedVersion(input.expectedVersion);
      if (!workplaneId) return fail('invalid_input', 'workplaneId is required', 400);
      if (!askId) return fail('invalid_input', 'askId is required', 400);
      if (!resolvedBy) return fail('invalid_input', 'resolvedBy is required', 400);
      if (expectedVersion === undefined) {
        return fail('invalid_input', 'expectedVersion is required for CAS resolve', 400);
      }

      const existingResult = requireAsk(workplaneId, askId);
      if (!existingResult.ok) return existingResult;
      const existing = existingResult.value;

      if (existing.version !== expectedVersion) {
        recordCasReject(
          existing,
          resolvedBy,
          `CAS resolve rejected: expected version ${expectedVersion}, actual ${existing.version}`,
        );
        return fail(
          'stale_version',
          `Stale ASK version: expected ${expectedVersion}, actual ${existing.version}`,
          409,
          { ask: existing },
        );
      }

      const attachment = findAttachment(workplaneId, resolvedBy);
      const { assignment } = chiefContext(workplaneId);
      const policy = evaluateAskResolvePolicy({
        ask: existing,
        resolverId: resolvedBy,
        asOperator: Boolean(input.asOperator),
        chiefAgentId: assignment?.chiefAgentId ?? null,
        resolverAttached: Boolean(attachment),
      });

      if (!policy.allowed) {
        const statusCode = policy.code === 'double_resolve'
          || policy.code === 'already_terminal'
          || policy.code === 'not_resolvable'
          || policy.code === 'not_claimant'
          || policy.code === 'not_attached'
          ? 409
          : 400;
        return fail(policy.code as AskFailureCode, policy.policyReason, statusCode, {
          ask: existing,
          policy: {
            code: policy.code,
            policyReason: policy.policyReason,
            reasonChain: policy.reasonChain,
          },
        });
      }

      const resolvedAt = now().toISOString();
      const updated = store.casUpdateAsk(askId, expectedVersion, {
        status: 'resolved',
        updatedAt: resolvedAt,
        resolvedBy,
        resolvedAt,
        resolutionNote: present(input.note),
        reasonChain: policy.reasonChain,
      });

      if (!updated) {
        const latest = store.getAsk(askId);
        if (latest) {
          recordCasReject(
            latest,
            resolvedBy,
            `CAS resolve lost race: expected version ${expectedVersion}`,
          );
        }
        // If someone else already resolved, surface double_resolve when terminal.
        if (latest?.status === 'resolved') {
          return fail('double_resolve', 'ASK is already resolved (double resolution rejected)', 409, {
            ask: latest,
          });
        }
        return fail('stale_version', 'Stale ASK version (concurrent resolve)', 409, { ask: latest });
      }

      store.insertEvent({
        askId: updated.id,
        workplaneId,
        eventType: 'resolved',
        actorId: resolvedBy,
        fromStatus: existing.status,
        toStatus: updated.status,
        fromVersion: existing.version,
        toVersion: updated.version,
        code: policy.code,
        detail: policy.policyReason,
        createdAt: resolvedAt,
      });

      return {
        ok: true,
        value: {
          ask: updated,
          policy: {
            code: policy.code,
            policyReason: policy.policyReason,
            reasonChain: policy.reasonChain,
          },
        },
      };
    },

    blockAsk(input) {
      const workplaneId = present(input.workplaneId);
      const askId = present(input.askId);
      const blockedBy = present(input.blockedBy);
      const expectedVersion = readExpectedVersion(input.expectedVersion);
      if (!workplaneId) return fail('invalid_input', 'workplaneId is required', 400);
      if (!askId) return fail('invalid_input', 'askId is required', 400);
      if (!blockedBy) return fail('invalid_input', 'blockedBy is required', 400);
      if (expectedVersion === undefined) {
        return fail('invalid_input', 'expectedVersion is required for CAS block', 400);
      }

      const existingResult = requireAsk(workplaneId, askId);
      if (!existingResult.ok) return existingResult;
      const existing = existingResult.value;

      if (existing.version !== expectedVersion) {
        recordCasReject(
          existing,
          blockedBy,
          `CAS block rejected: expected version ${expectedVersion}, actual ${existing.version}`,
        );
        return fail(
          'stale_version',
          `Stale ASK version: expected ${expectedVersion}, actual ${existing.version}`,
          409,
          { ask: existing },
        );
      }

      const { assignment } = chiefContext(workplaneId);
      const policy = evaluateAskBlockPolicy({
        ask: existing,
        blockedBy,
        asOperator: Boolean(input.asOperator),
        chiefAgentId: assignment?.chiefAgentId ?? null,
      });

      if (!policy.allowed) {
        return fail(policy.code as AskFailureCode, policy.policyReason, 409, {
          ask: existing,
          policy: {
            code: policy.code,
            policyReason: policy.policyReason,
            reasonChain: policy.reasonChain,
          },
        });
      }

      const updatedAt = now().toISOString();
      const updated = store.casUpdateAsk(askId, expectedVersion, {
        status: 'blocked',
        updatedAt,
        blockedReason: present(input.reason) ?? 'Blocked',
        reasonChain: policy.reasonChain,
      });

      if (!updated) {
        return fail('stale_version', 'Stale ASK version (concurrent block)', 409);
      }

      store.insertEvent({
        askId: updated.id,
        workplaneId,
        eventType: 'blocked',
        actorId: blockedBy,
        fromStatus: existing.status,
        toStatus: updated.status,
        fromVersion: existing.version,
        toVersion: updated.version,
        code: policy.code,
        detail: policy.policyReason,
        createdAt: updatedAt,
      });

      return {
        ok: true,
        value: {
          ask: updated,
          policy: {
            code: policy.code,
            policyReason: policy.policyReason,
            reasonChain: policy.reasonChain,
          },
        },
      };
    },

    listEvents(workplaneId, askId) {
      const existingResult = requireAsk(workplaneId, askId);
      if (!existingResult.ok) return existingResult;
      return {
        ok: true,
        value: {
          askId: existingResult.value.id,
          events: store.listEvents(existingResult.value.id),
        },
      };
    },
  };
}

export function getAskFlowService(): AskFlowService {
  if (!singleton) {
    singleton = createAskFlowService();
  }
  return singleton;
}

/** Reset singleton (tests). */
export function resetAskFlowServiceForTests(): void {
  singleton = null;
  try {
    createAskFlowStore().clearForTests();
  } catch {
    // best-effort when DB path not ready
  }
}
