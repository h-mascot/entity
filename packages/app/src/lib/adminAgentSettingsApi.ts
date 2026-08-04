/**
 * THE-887 / WP2-B-06 — Admin agent settings HTTP helpers.
 */

import { buildApiCandidates, requestJsonWithFallback } from './http';
import {
  normalizeAdminAgentSettings,
  normalizeInviteAuditEvents,
  responseContainsSecretKeys,
  type AdminAgentSettings,
  type InviteAuditEventView,
} from './adminAgentSettings';

export async function fetchAdminAgentSettings(): Promise<AdminAgentSettings> {
  const payload = await requestJsonWithFallback<unknown>({
    urls: buildApiCandidates('/api/agents/admin-settings'),
    continueOnStatuses: [],
    fallbackError: 'Unable to load agent admin settings.',
  });
  if (responseContainsSecretKeys(payload)) {
    throw new Error('Admin settings response contained secret keys.');
  }
  const settings = normalizeAdminAgentSettings(payload);
  if (!settings) throw new Error('Admin settings response was invalid.');
  return settings;
}

export async function patchAdminAgentSettings(
  patch: Partial<Pick<AdminAgentSettings, 'defaultTtlMs' | 'minTtlMs' | 'maxTtlMs' | 'allowedModules' | 'defaultModules'>>
    & { updatedBy?: string },
): Promise<AdminAgentSettings> {
  const payload = await requestJsonWithFallback<unknown>({
    urls: buildApiCandidates('/api/agents/admin-settings'),
    init: {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
    continueOnStatuses: [],
    fallbackError: 'Unable to save agent admin settings.',
  });
  if (responseContainsSecretKeys(payload)) {
    throw new Error('Admin settings response contained secret keys.');
  }
  const settings = normalizeAdminAgentSettings(payload);
  if (!settings) throw new Error('Admin settings save response was invalid.');
  return settings;
}

export async function fetchInviteAuditEvents(limit = 50): Promise<InviteAuditEventView[]> {
  const payload = await requestJsonWithFallback<unknown>({
    urls: buildApiCandidates(`/api/agents/admin-settings/audit?limit=${encodeURIComponent(String(limit))}`),
    continueOnStatuses: [],
    fallbackError: 'Unable to load invite revoke audit.',
  });
  if (responseContainsSecretKeys(payload)) {
    throw new Error('Audit response contained secret keys.');
  }
  return normalizeInviteAuditEvents(payload);
}
