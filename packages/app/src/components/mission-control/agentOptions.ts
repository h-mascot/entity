import { HttpRequestError, buildApiCandidates, requestJsonWithFallback } from '../../lib/http';

/**
 * Statuses that mean an agent is currently part of the active fleet and should
 * be offered as a task assignee. Anything explicitly disabled/retired is hidden.
 */
const INACTIVE_AGENT_STATUSES = new Set(['offline', 'inactive', 'disabled', 'archived', 'retired', 'deleted']);

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isActiveAgentStatus(status: unknown): boolean {
  const normalized = typeof status === 'string' ? status.trim().toLowerCase() : '';
  if (!normalized) {
    // Treat an unspecified status as active so agents are never silently hidden.
    return true;
  }
  return !INACTIVE_AGENT_STATUSES.has(normalized);
}

function extractAgentList(payload: unknown): Record<string, unknown>[] {
  const record = toRecord(payload);
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.list)
      ? (record!.list as unknown[])
      : Array.isArray(record?.agents)
        ? (record!.agents as unknown[])
        : [];
  return list.map(toRecord).filter((entry): entry is Record<string, unknown> => entry !== null);
}

/**
 * Returns the display names of active Entity agents from `/api/agents`.
 * Returns an empty array (not a hardcoded fallback) when the endpoint is
 * unavailable, so callers can decide how to compose the final option list
 * (typically active agents + the current user).
 */
export async function fetchActiveAgentNames(apiBase: string): Promise<string[]> {
  try {
    const payload = await requestJsonWithFallback({
      urls: buildApiCandidates('/agents', apiBase),
      init: { method: 'GET' },
      continueOnStatuses: [],
      fallbackError: 'Unable to load agents.',
    });

    const seen = new Set<string>();
    const names: string[] = [];
    for (const entry of extractAgentList(payload)) {
      if (!isActiveAgentStatus(entry.status)) {
        continue;
      }
      const name = readNonEmptyString(entry.name) ?? readNonEmptyString(entry.slug) ?? readNonEmptyString(entry.id);
      if (!name) {
        continue;
      }
      const key = name.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      names.push(name);
    }

    return names;
  } catch (error) {
    if (error instanceof HttpRequestError && error.status === 404) {
      return [];
    }
    throw error;
  }
}

/**
 * Composes the assignee dropdown options: active Entity agents plus the current
 * user, always including "Unassigned" and preserving the task's current
 * assignee even if that identity is no longer active.
 */
export function composeAssigneeOptions(
  agentNames: string[],
  userDisplayName: string,
  currentAssignee?: string | null,
): string[] {
  const ordered: string[] = [...agentNames];
  const userName = userDisplayName.trim();
  if (userName) {
    ordered.push(userName);
  }
  ordered.push('Unassigned');

  const current = currentAssignee?.trim();
  if (current) {
    ordered.unshift(current);
  }

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const option of ordered) {
    const key = option.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(option);
  }
  return deduped;
}
