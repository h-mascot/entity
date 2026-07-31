/**
 * THE-885 / WP2-B-04 — Workplane chief routing fetch helpers.
 */

import { buildApiCandidates, requestJsonWithFallback } from './http';
import {
  parseWorkplaneRoutingPanel,
  type WorkplaneRoutingPanel,
} from './workplaneChiefRouting';

export async function fetchWorkplaneRoutingPanel(
  workplaneId: string,
  taskId?: number | null,
): Promise<WorkplaneRoutingPanel> {
  const id = workplaneId.trim();
  if (!id) {
    throw new Error('workplaneId is required');
  }
  const encoded = encodeURIComponent(id);
  const query = taskId != null && Number.isFinite(taskId) ? `?taskId=${encodeURIComponent(String(taskId))}` : '';
  const payload = await requestJsonWithFallback<unknown>({
    urls: buildApiCandidates(`/api/workplanes/${encoded}/routing${query}`),
    continueOnStatuses: [],
    fallbackError: 'Unable to load routing policy.',
  });
  const panel = parseWorkplaneRoutingPanel(payload);
  if (!panel) {
    throw new Error('Invalid routing policy response');
  }
  return panel;
}

export async function assignWorkplaneChief(input: {
  workplaneId: string;
  agentId: string;
  assignedBy?: string | null;
  priorityWindowMs?: number | null;
}): Promise<{ created: boolean; chief: NonNullable<WorkplaneRoutingPanel['chief']> }> {
  const id = input.workplaneId.trim();
  const agentId = input.agentId.trim();
  if (!id || !agentId) {
    throw new Error('workplaneId and agentId are required');
  }
  const encoded = encodeURIComponent(id);
  const payload = await requestJsonWithFallback<{
    created?: boolean;
    chief?: unknown;
  }>({
    urls: buildApiCandidates(`/api/workplanes/${encoded}/routing/chief`),
    init: {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId,
        assignedBy: input.assignedBy,
        priorityWindowMs: input.priorityWindowMs,
      }),
    },
    continueOnStatuses: [],
    fallbackError: 'Unable to assign chief.',
  });
  const panel = parseWorkplaneRoutingPanel({
    workplaneId: id,
    evaluatedAt: new Date().toISOString(),
    chief: payload.chief,
    chiefPresence: null,
    activeClaim: null,
    priorityWindow: { open: false, openedAt: null, expiresAt: null, priorityWindowMs: 300000 },
    policy: {
      chiefRequired: false,
      workersMayClaim: true,
      claimGate: 'open',
      summary: 'Chief assigned',
    },
    attachedAgentIds: [],
  });
  if (!panel?.chief) {
    throw new Error('Invalid chief assign response');
  }
  return { created: Boolean(payload.created), chief: panel.chief };
}

export async function clearWorkplaneChief(workplaneId: string): Promise<{
  cleared: boolean;
  alreadyCleared: boolean;
}> {
  const id = workplaneId.trim();
  if (!id) throw new Error('workplaneId is required');
  const encoded = encodeURIComponent(id);
  const payload = await requestJsonWithFallback<{
    cleared?: boolean;
    alreadyCleared?: boolean;
  }>({
    urls: buildApiCandidates(`/api/workplanes/${encoded}/routing/chief`),
    init: { method: 'DELETE' },
    continueOnStatuses: [],
    fallbackError: 'Unable to clear chief.',
  });
  return {
    cleared: payload.cleared !== false,
    alreadyCleared: Boolean(payload.alreadyCleared),
  };
}

export async function claimWorkplaneRouting(input: {
  workplaneId: string;
  agentId: string;
  taskId?: number | null;
  requestId?: string | null;
}): Promise<{ created: boolean; policyCode: string }> {
  const id = input.workplaneId.trim();
  const agentId = input.agentId.trim();
  if (!id || !agentId) {
    throw new Error('workplaneId and agentId are required');
  }
  const encoded = encodeURIComponent(id);
  const payload = await requestJsonWithFallback<{
    created?: boolean;
    policy?: { code?: string };
  }>({
    urls: buildApiCandidates(`/api/workplanes/${encoded}/routing/claim`),
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId,
        taskId: input.taskId,
        requestId: input.requestId,
      }),
    },
    continueOnStatuses: [],
    fallbackError: 'Unable to claim routing slot.',
  });
  return {
    created: Boolean(payload.created),
    policyCode: typeof payload.policy?.code === 'string' ? payload.policy.code : 'unknown',
  };
}

export async function assignWorkplaneRouting(input: {
  workplaneId: string;
  agentId: string;
  assignedBy: string;
  taskId?: number | null;
  asOperator?: boolean;
}): Promise<{ created: boolean; policyCode: string }> {
  const id = input.workplaneId.trim();
  const agentId = input.agentId.trim();
  const assignedBy = input.assignedBy.trim();
  if (!id || !agentId || !assignedBy) {
    throw new Error('workplaneId, agentId, and assignedBy are required');
  }
  const encoded = encodeURIComponent(id);
  const payload = await requestJsonWithFallback<{
    created?: boolean;
    policy?: { code?: string };
  }>({
    urls: buildApiCandidates(`/api/workplanes/${encoded}/routing/assign`),
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId,
        assignedBy,
        taskId: input.taskId,
        asOperator: input.asOperator ?? true,
      }),
    },
    continueOnStatuses: [],
    fallbackError: 'Unable to assign routing slot.',
  });
  return {
    created: Boolean(payload.created),
    policyCode: typeof payload.policy?.code === 'string' ? payload.policy.code : 'unknown',
  };
}
