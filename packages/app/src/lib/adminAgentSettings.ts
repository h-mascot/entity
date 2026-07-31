/**
 * THE-887 / WP2-B-06 — Admin agent invite settings client model.
 *
 * TTL bounds, allowed/default modules, revoke audit (no secrets).
 */

export const ADMIN_AGENT_SETTINGS_UI_STATUSES = [
  'empty',
  'loading',
  'error',
  'ready',
  'saving',
] as const;

export type AdminAgentSettingsUiStatus = (typeof ADMIN_AGENT_SETTINGS_UI_STATUSES)[number];

export interface CatalogInviteModule {
  id: string;
  label: string;
  defaultAllowed: boolean;
}

export interface AdminAgentSettings {
  defaultTtlMs: number;
  minTtlMs: number;
  maxTtlMs: number;
  allowedModules: string[];
  defaultModules: string[];
  updatedAt: string | null;
  updatedBy: string | null;
  catalogModules: CatalogInviteModule[];
  hardMinTtlMs: number;
  hardMaxTtlMs: number;
}

export interface InviteAuditEventView {
  id: string;
  inviteId: string | null;
  eventType: string;
  actorId: string | null;
  agentName: string | null;
  status: string | null;
  generation: number | null;
  detail: string;
  createdAt: string;
}

export interface AdminAgentSettingsState {
  status: AdminAgentSettingsUiStatus;
  settings: AdminAgentSettings | null;
  draft: AdminAgentSettings | null;
  audit: InviteAuditEventView[];
  error: string | null;
  notice: string | null;
}

export function createInitialAdminAgentSettingsState(): AdminAgentSettingsState {
  return {
    status: 'empty',
    settings: null,
    draft: null,
    audit: [],
    error: null,
    notice: null,
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function asPositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

export function normalizeAdminAgentSettings(payload: unknown): AdminAgentSettings | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const row = payload as Record<string, unknown>;
  const catalogRaw = Array.isArray(row.catalogModules) ? row.catalogModules : [];
  const catalogModules = catalogRaw
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    .map((entry) => ({
      id: typeof entry.id === 'string' ? entry.id : '',
      label: typeof entry.label === 'string' ? entry.label : String(entry.id ?? ''),
      defaultAllowed: Boolean(entry.defaultAllowed),
    }))
    .filter((entry) => entry.id.length > 0);
  if (catalogModules.length === 0 && asStringArray(row.allowedModules).length === 0) {
    return null;
  }
  return {
    defaultTtlMs: asPositiveInt(row.defaultTtlMs, 30 * 60 * 1000),
    minTtlMs: asPositiveInt(row.minTtlMs, 60_000),
    maxTtlMs: asPositiveInt(row.maxTtlMs, 24 * 60 * 60 * 1000),
    allowedModules: asStringArray(row.allowedModules),
    defaultModules: asStringArray(row.defaultModules),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
    updatedBy: typeof row.updatedBy === 'string' ? row.updatedBy : null,
    catalogModules,
    hardMinTtlMs: asPositiveInt(row.hardMinTtlMs, 60_000),
    hardMaxTtlMs: asPositiveInt(row.hardMaxTtlMs, 7 * 24 * 60 * 60 * 1000),
  };
}

export function normalizeInviteAuditEvents(payload: unknown): InviteAuditEventView[] {
  const root = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.events)
      ? root!.events
      : [];
  return list
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    .map((entry) => ({
      id: typeof entry.id === 'string' ? entry.id : '',
      inviteId: typeof entry.inviteId === 'string' ? entry.inviteId : null,
      eventType: typeof entry.eventType === 'string' ? entry.eventType : 'unknown',
      actorId: typeof entry.actorId === 'string' ? entry.actorId : null,
      agentName: typeof entry.agentName === 'string' ? entry.agentName : null,
      status: typeof entry.status === 'string' ? entry.status : null,
      generation: typeof entry.generation === 'number' && Number.isFinite(entry.generation)
        ? entry.generation
        : null,
      detail: typeof entry.detail === 'string' ? entry.detail : '',
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : '',
    }))
    .filter((entry) => entry.id.length > 0);
}

export function validateAdminAgentSettingsDraft(draft: AdminAgentSettings): string | null {
  if (draft.minTtlMs < draft.hardMinTtlMs || draft.maxTtlMs > draft.hardMaxTtlMs) {
    return `TTL bounds must stay within ${draft.hardMinTtlMs}–${draft.hardMaxTtlMs} ms`;
  }
  if (draft.minTtlMs > draft.maxTtlMs) {
    return 'Minimum TTL cannot exceed maximum TTL';
  }
  if (draft.defaultTtlMs < draft.minTtlMs || draft.defaultTtlMs > draft.maxTtlMs) {
    return 'Default TTL must be within min and max';
  }
  if (draft.allowedModules.length === 0) {
    return 'Select at least one allowed module';
  }
  if (draft.defaultModules.length === 0) {
    return 'Select at least one default module';
  }
  const blocked = draft.defaultModules.filter((id) => !draft.allowedModules.includes(id));
  if (blocked.length > 0) {
    return `Default modules must be allowed: ${blocked.join(', ')}`;
  }
  return null;
}

export function msToMinutes(ms: number): number {
  return Math.round(ms / 60_000);
}

export function minutesToMs(minutes: number): number {
  return Math.floor(minutes) * 60_000;
}

export function auditEventLabel(eventType: string): string {
  switch (eventType) {
    case 'invite_created':
      return 'Created';
    case 'invite_revoked':
      return 'Revoked';
    case 'invite_regenerated':
      return 'Regenerated';
    case 'settings_updated':
      return 'Settings updated';
    default:
      return eventType;
  }
}

export function responseContainsSecretKeys(payload: unknown): boolean {
  const raw = JSON.stringify(payload);
  return /"token"\s*:|"apiKey"\s*:|"api_key"\s*:|"password"\s*:|"secret"\s*:|"authorization"\s*:|"tokenHash"\s*:|"previousTokenHash"\s*:/i.test(raw);
}
