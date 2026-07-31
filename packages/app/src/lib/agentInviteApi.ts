/**
 * THE-881 / WP2-A-06 — Durable invite HTTP helpers for Agent Desk + Add Agent.
 *
 * Uses /api/agents/invites* from THE-880. Never writes raw tokens to storage.
 */

import { buildApiCandidates, requestJsonWithFallback } from './http';
import type { AddAgentDraft, InviteKitPreview } from './addAgentInviteCreation';
import {
  normalizeDeskInvite,
  normalizeDeskInviteList,
  type DeskInviteView,
} from './agentInviteDesk';

export async function fetchDurableInvites(): Promise<{ invites: DeskInviteView[]; count: number }> {
  const payload = await requestJsonWithFallback<unknown>({
    urls: buildApiCandidates('/api/agents/invites'),
    continueOnStatuses: [],
    fallbackError: 'Unable to load durable invites.',
  });
  const invites = normalizeDeskInviteList(payload);
  return { invites, count: invites.length };
}

export async function fetchDurableInvite(inviteId: string): Promise<DeskInviteView> {
  const payload = await requestJsonWithFallback<unknown>({
    urls: buildApiCandidates(`/api/agents/invites/${encodeURIComponent(inviteId)}`),
    continueOnStatuses: [],
    fallbackError: 'Unable to load invite.',
  });
  const invite = normalizeDeskInvite(payload);
  if (!invite) {
    throw new Error('Invite response was invalid.');
  }
  return invite;
}

export async function revokeDurableInvite(inviteId: string): Promise<DeskInviteView> {
  const payload = await requestJsonWithFallback<unknown>({
    urls: buildApiCandidates(`/api/agents/invites/${encodeURIComponent(inviteId)}/revoke`),
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revokedBy: 'agent-desk' }),
    },
    continueOnStatuses: [],
    fallbackError: 'Unable to revoke invite.',
  });
  const invite = normalizeDeskInvite(payload);
  if (!invite) throw new Error('Revoke response was invalid.');
  return invite;
}

export async function regenerateDurableInvite(inviteId: string): Promise<DeskInviteView> {
  const payload = await requestJsonWithFallback<unknown>({
    urls: buildApiCandidates(`/api/agents/invites/${encodeURIComponent(inviteId)}/regenerate`),
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
    continueOnStatuses: [],
    fallbackError: 'Unable to regenerate invite.',
  });
  const invite = normalizeDeskInvite(payload);
  if (!invite) throw new Error('Regenerate response was invalid.');
  if (!invite.token || !invite.setupPath) {
    throw new Error('Regenerate did not return show-once token/URLs.');
  }
  return invite;
}

/** Map durable create response into Add Agent InviteKitPreview shape. */
export function durableViewToInviteKitPreview(view: DeskInviteView): InviteKitPreview | null {
  if (!view.token || !view.setupPath || !view.manifestPath || !view.bundlePath
    || !view.skillPath || !view.progressPath) {
    return null;
  }
  const role = (['worker', 'reviewer', 'chief', 'specialist'] as const).includes(
    view.role as 'worker',
  )
    ? view.role as InviteKitPreview['role']
    : 'worker';
  const bundle = (['minimal', 'default', 'custom'] as const).includes(
    view.selectedBundle as 'default',
  )
    ? view.selectedBundle as InviteKitPreview['selectedBundle']
    : 'default';

  return {
    id: view.id,
    status: view.status,
    agentName: view.agentName,
    role,
    creationSource: 'agents_invite',
    createdAt: view.createdAt,
    expiresAt: view.expiresAt,
    selectedBundle: bundle,
    selectedModules: [...view.selectedModules],
    permissionsScope: [...view.permissionsScope],
    safeStopConditions: [...view.safeStopConditions],
    projectId: view.projectId,
    workplaneId: view.workplaneId,
    taskId: view.taskId,
    setupPath: view.setupPath,
    manifestPath: view.manifestPath,
    bundlePath: view.bundlePath,
    skillPath: view.skillPath,
    progressPath: view.progressPath,
    seam: 'agents_invites_api',
    persistence: 'durable',
    nextStep:
      'Copy the invite prompt or URLs now — the raw token is show-once and will not be re-emitted by GET.',
  };
}

export async function createDurableInviteFromDraft(
  draft: AddAgentDraft,
): Promise<InviteKitPreview | null> {
  const payload = await requestJsonWithFallback<unknown>({
    urls: buildApiCandidates('/api/agents/invites'),
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentName: draft.agentName.trim(),
        role: draft.role,
        selectedBundle: draft.selectedBundle,
        permissionsScope: draft.permissionsScope,
        safeStopConditions: draft.safeStopConditions,
        ttlMs: draft.ttlMs,
        projectId: draft.projectId.trim() || null,
        workplaneId: draft.workplaneId.trim() || null,
        taskId: draft.taskId.trim() ? Number(draft.taskId) : null,
        creationSource: 'agents_invite',
      }),
    },
    continueOnStatuses: [],
    fallbackError: 'Unable to create durable invite.',
  });
  const view = normalizeDeskInvite(payload);
  if (!view) return null;
  return durableViewToInviteKitPreview(view);
}
