/**
 * THE-883 / WP2-B-02 — Workplane presence fetch helpers.
 */

import { buildApiCandidates, requestJsonWithFallback } from './http';
import {
  parseWorkplanePresencePanel,
  type WorkplanePresencePanel,
} from './workplanePresence';

export async function fetchWorkplanePresence(
  workplaneId: string,
): Promise<WorkplanePresencePanel> {
  const id = workplaneId.trim();
  if (!id) {
    throw new Error('workplaneId is required');
  }
  const encoded = encodeURIComponent(id);
  const payload = await requestJsonWithFallback<unknown>({
    urls: buildApiCandidates(`/api/workplanes/${encoded}/presence`),
    continueOnStatuses: [],
    fallbackError: 'Unable to load workplane presence.',
  });
  const panel = parseWorkplanePresencePanel(payload);
  if (!panel) {
    throw new Error('Invalid workplane presence response');
  }
  return panel;
}

export async function postAgentHeartbeat(input: {
  agentId: string;
  inviteId?: string | null;
  status?: string;
  currentTaskId?: number | null;
  currentWorkplaneId?: string | null;
  runtime?: string | null;
  sessionId?: string | null;
  capabilities?: string[];
}): Promise<unknown> {
  return requestJsonWithFallback({
    urls: buildApiCandidates('/api/agents/presence/heartbeat'),
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    continueOnStatuses: [],
    fallbackError: 'Unable to post agent heartbeat.',
  });
}
