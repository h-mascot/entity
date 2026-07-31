/**
 * THE-884 / WP2-B-03 — Workplane attached-agents fetch helpers.
 */

import { buildApiCandidates, requestJsonWithFallback } from './http';
import {
  parseWorkplaneAttachedAgentsPanel,
  type WorkplaneAttachedAgent,
  type WorkplaneAttachedAgentsPanel,
} from './workplaneAttachedAgents';

export async function fetchWorkplaneAttachedAgents(
  workplaneId: string,
): Promise<WorkplaneAttachedAgentsPanel> {
  const id = workplaneId.trim();
  if (!id) {
    throw new Error('workplaneId is required');
  }
  const encoded = encodeURIComponent(id);
  const payload = await requestJsonWithFallback<unknown>({
    urls: buildApiCandidates(`/api/workplanes/${encoded}/agents`),
    continueOnStatuses: [],
    fallbackError: 'Unable to load attached agents.',
  });
  const panel = parseWorkplaneAttachedAgentsPanel(payload);
  if (!panel) {
    throw new Error('Invalid attached agents response');
  }
  return panel;
}

export async function attachAgentToWorkplane(input: {
  workplaneId: string;
  agentId?: string | null;
  inviteId?: string | null;
  taskId?: number | null;
  agentName?: string | null;
  role?: string | null;
}): Promise<{ created: boolean; agent: WorkplaneAttachedAgent }> {
  const id = input.workplaneId.trim();
  if (!id) {
    throw new Error('workplaneId is required');
  }
  const encoded = encodeURIComponent(id);
  const payload = await requestJsonWithFallback<{
    created?: boolean;
    agent?: unknown;
  }>({
    urls: buildApiCandidates(`/api/workplanes/${encoded}/agents`),
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: input.agentId,
        inviteId: input.inviteId,
        taskId: input.taskId,
        agentName: input.agentName,
        role: input.role,
      }),
    },
    continueOnStatuses: [],
    fallbackError: 'Unable to attach agent to workplane.',
  });
  const panelish = parseWorkplaneAttachedAgentsPanel({
    workplaneId: id,
    evaluatedAt: new Date().toISOString(),
    agents: payload.agent ? [payload.agent] : [],
    counts: { total: 1, live: 0, idle: 0, stale: 0, offline: 0, missing: 0, unknown: 0, degraded: 0 },
  });
  const agent = panelish?.agents[0];
  if (!agent) {
    throw new Error('Invalid attach response');
  }
  return { created: Boolean(payload.created), agent };
}

export async function detachAgentFromWorkplane(
  workplaneId: string,
  agentId: string,
): Promise<{ detached: boolean; alreadyDetached: boolean }> {
  const wp = workplaneId.trim();
  const agent = agentId.trim();
  if (!wp || !agent) {
    throw new Error('workplaneId and agentId are required');
  }
  const encodedWp = encodeURIComponent(wp);
  const encodedAgent = encodeURIComponent(agent);
  const payload = await requestJsonWithFallback<{
    detached?: boolean;
    alreadyDetached?: boolean;
  }>({
    urls: buildApiCandidates(`/api/workplanes/${encodedWp}/agents/${encodedAgent}`),
    init: { method: 'DELETE' },
    continueOnStatuses: [],
    fallbackError: 'Unable to detach agent from workplane.',
  });
  return {
    detached: payload.detached !== false,
    alreadyDetached: Boolean(payload.alreadyDetached),
  };
}
