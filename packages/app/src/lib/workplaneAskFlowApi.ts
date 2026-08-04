/**
 * THE-886 / WP2-B-05 — Workplane ASK fetch helpers.
 */

import { buildApiCandidates, requestJsonWithFallback } from './http';
import {
  parseWorkplaneAsk,
  parseWorkplaneAskPanel,
  type WorkplaneAsk,
  type WorkplaneAskPanel,
} from './workplaneAskFlow';

export async function fetchWorkplaneAskPanel(workplaneId: string): Promise<WorkplaneAskPanel> {
  const id = workplaneId.trim();
  if (!id) throw new Error('workplaneId is required');
  const encoded = encodeURIComponent(id);
  const payload = await requestJsonWithFallback<unknown>({
    urls: buildApiCandidates(`/api/workplanes/${encoded}/asks?panel=1`),
    continueOnStatuses: [],
    fallbackError: 'Unable to load ASK panel.',
  });
  const panel = parseWorkplaneAskPanel(payload);
  if (!panel) throw new Error('Invalid ASK panel response');
  return panel;
}

export async function createWorkplaneAsk(input: {
  workplaneId: string;
  title: string;
  body?: string | null;
  taskId?: number | null;
  createdBy?: string | null;
}): Promise<WorkplaneAsk> {
  const id = input.workplaneId.trim();
  const title = input.title.trim();
  if (!id || !title) throw new Error('workplaneId and title are required');
  const encoded = encodeURIComponent(id);
  const payload = await requestJsonWithFallback<{ ask?: unknown }>({
    urls: buildApiCandidates(`/api/workplanes/${encoded}/asks`),
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        body: input.body,
        taskId: input.taskId,
        createdBy: input.createdBy,
      }),
    },
    continueOnStatuses: [],
    fallbackError: 'Unable to create ASK.',
  });
  const ask = parseWorkplaneAsk(payload.ask);
  if (!ask) throw new Error('Invalid create ASK response');
  return ask;
}

export async function claimWorkplaneAsk(input: {
  workplaneId: string;
  askId: string;
  agentId: string;
  expectedVersion: number;
}): Promise<WorkplaneAsk> {
  const workplaneId = input.workplaneId.trim();
  const askId = input.askId.trim();
  const agentId = input.agentId.trim();
  if (!workplaneId || !askId || !agentId) {
    throw new Error('workplaneId, askId, and agentId are required');
  }
  const payload = await requestJsonWithFallback<{ ask?: unknown }>({
    urls: buildApiCandidates(
      `/api/workplanes/${encodeURIComponent(workplaneId)}/asks/${encodeURIComponent(askId)}/claim`,
    ),
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId,
        expectedVersion: input.expectedVersion,
      }),
    },
    continueOnStatuses: [],
    fallbackError: 'Unable to claim ASK.',
  });
  const ask = parseWorkplaneAsk(payload.ask);
  if (!ask) throw new Error('Invalid claim ASK response');
  return ask;
}

export async function resolveWorkplaneAsk(input: {
  workplaneId: string;
  askId: string;
  resolvedBy: string;
  expectedVersion: number;
  note?: string | null;
  asOperator?: boolean;
}): Promise<WorkplaneAsk> {
  const workplaneId = input.workplaneId.trim();
  const askId = input.askId.trim();
  const resolvedBy = input.resolvedBy.trim();
  if (!workplaneId || !askId || !resolvedBy) {
    throw new Error('workplaneId, askId, and resolvedBy are required');
  }
  const payload = await requestJsonWithFallback<{ ask?: unknown }>({
    urls: buildApiCandidates(
      `/api/workplanes/${encodeURIComponent(workplaneId)}/asks/${encodeURIComponent(askId)}/resolve`,
    ),
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resolvedBy,
        expectedVersion: input.expectedVersion,
        note: input.note,
        asOperator: input.asOperator ?? false,
      }),
    },
    continueOnStatuses: [],
    fallbackError: 'Unable to resolve ASK.',
  });
  const ask = parseWorkplaneAsk(payload.ask);
  if (!ask) throw new Error('Invalid resolve ASK response');
  return ask;
}
