/**
 * Admin agent invite settings: TTL bounds, allowed/default modules (THE-887 / WP2-B-06).
 *
 * Stored in app_settings. Never persists secrets/tokens.
 */

import {
  DEFAULT_ONBOARDING_MODULE_IDS,
  MINIMAL_ONBOARDING_MODULE_IDS,
} from '../../config/onboarding-modules';
import { ensureAppSettingsTable, getSettingJson, setSettingJson } from '../../config/settings-store';
import { getEntityDatabase } from '../../../../db/src/entity-db';
import { DEFAULT_AGENT_INVITE_TTL_MS } from './types';

export const AGENT_INVITE_ADMIN_SETTINGS_KEY = 'agents.inviteAdminSettings';

/** Hard product ceiling — admin maxTtlMs cannot exceed this. */
export const HARD_MAX_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Hard product floor — admin minTtlMs cannot go below this. */
export const HARD_MIN_INVITE_TTL_MS = 60_000;

export const CATALOG_INVITE_MODULE_IDS = [
  ...DEFAULT_ONBOARDING_MODULE_IDS,
  'entity-discord-title-hook',
  'entity-services',
] as const;

export type CatalogInviteModuleId = (typeof CATALOG_INVITE_MODULE_IDS)[number];

export interface AgentInviteAdminSettings {
  defaultTtlMs: number;
  minTtlMs: number;
  maxTtlMs: number;
  allowedModules: string[];
  defaultModules: string[];
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface UpdateAgentInviteAdminSettingsInput {
  defaultTtlMs?: number;
  minTtlMs?: number;
  maxTtlMs?: number;
  allowedModules?: readonly string[];
  defaultModules?: readonly string[];
  updatedBy?: string | null;
}

export interface AgentInviteAdminSettingsView extends AgentInviteAdminSettings {
  catalogModules: Array<{ id: string; label: string; defaultAllowed: boolean }>;
  hardMinTtlMs: number;
  hardMaxTtlMs: number;
}

interface StoredAdminSettings {
  defaultTtlMs?: unknown;
  minTtlMs?: unknown;
  maxTtlMs?: unknown;
  allowedModules?: unknown;
  defaultModules?: unknown;
  updatedAt?: unknown;
  updatedBy?: unknown;
}

const CATALOG_LABELS: Record<string, string> = {
  'entity-agent-contracts': 'Agent contracts',
  'entity-fs': 'Entity FS',
  'entity-mc': 'Entity MC',
  'entity-linker': 'Entity Linker',
  'entity-discord-title-hook': 'Discord title hook',
  'entity-services': 'Entity Services',
};

function uniqueModuleIds(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function isCatalogModule(id: string): boolean {
  return (CATALOG_INVITE_MODULE_IDS as readonly string[]).includes(id);
}

function clampTtl(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(HARD_MAX_INVITE_TTL_MS, Math.max(HARD_MIN_INVITE_TTL_MS, Math.floor(value)));
}

function readStored(): StoredAdminSettings {
  try {
    const db = getEntityDatabase(ensureAppSettingsTable);
    const stored = getSettingJson(db, AGENT_INVITE_ADMIN_SETTINGS_KEY);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      return {};
    }
    return stored as StoredAdminSettings;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown settings read error';
    console.warn('[AgentInviteAdmin] Failed to read settings:', message);
    return {};
  }
}

function writeStored(next: AgentInviteAdminSettings, updatedBy: string | null): void {
  const db = getEntityDatabase(ensureAppSettingsTable);
  setSettingJson(db, AGENT_INVITE_ADMIN_SETTINGS_KEY, {
    defaultTtlMs: next.defaultTtlMs,
    minTtlMs: next.minTtlMs,
    maxTtlMs: next.maxTtlMs,
    allowedModules: next.allowedModules,
    defaultModules: next.defaultModules,
    updatedAt: next.updatedAt,
    updatedBy,
  }, updatedBy ?? 'admin-ui');
}

export function defaultAgentInviteAdminSettings(): AgentInviteAdminSettings {
  return {
    defaultTtlMs: DEFAULT_AGENT_INVITE_TTL_MS,
    minTtlMs: HARD_MIN_INVITE_TTL_MS,
    maxTtlMs: 24 * 60 * 60 * 1000,
    allowedModules: [...DEFAULT_ONBOARDING_MODULE_IDS],
    defaultModules: [...DEFAULT_ONBOARDING_MODULE_IDS],
    updatedAt: null,
    updatedBy: null,
  };
}

export function normalizeAgentInviteAdminSettings(
  stored: StoredAdminSettings | null | undefined,
): AgentInviteAdminSettings {
  const defaults = defaultAgentInviteAdminSettings();
  const minTtlMs = clampTtl(stored?.minTtlMs, defaults.minTtlMs);
  const maxTtlMs = Math.max(minTtlMs, clampTtl(stored?.maxTtlMs, defaults.maxTtlMs));
  let defaultTtlMs = clampTtl(stored?.defaultTtlMs, defaults.defaultTtlMs);
  if (defaultTtlMs < minTtlMs) defaultTtlMs = minTtlMs;
  if (defaultTtlMs > maxTtlMs) defaultTtlMs = maxTtlMs;

  const allowedRaw = Array.isArray(stored?.allowedModules)
    ? uniqueModuleIds(stored!.allowedModules as string[]).filter(isCatalogModule)
    : defaults.allowedModules;
  const allowedModules = allowedRaw.length > 0 ? allowedRaw : [...defaults.allowedModules];

  const defaultRaw = Array.isArray(stored?.defaultModules)
    ? uniqueModuleIds(stored!.defaultModules as string[]).filter((id) => allowedModules.includes(id))
    : defaults.defaultModules.filter((id) => allowedModules.includes(id));
  const defaultModules = defaultRaw.length > 0
    ? defaultRaw
    : allowedModules.filter((id) => (MINIMAL_ONBOARDING_MODULE_IDS as readonly string[]).includes(id));

  return {
    defaultTtlMs,
    minTtlMs,
    maxTtlMs,
    allowedModules,
    defaultModules: defaultModules.length > 0 ? defaultModules : [allowedModules[0]!],
    updatedAt: typeof stored?.updatedAt === 'string' ? stored.updatedAt : null,
    updatedBy: typeof stored?.updatedBy === 'string' ? stored.updatedBy : null,
  };
}

export function getAgentInviteAdminSettings(): AgentInviteAdminSettingsView {
  const settings = normalizeAgentInviteAdminSettings(readStored());
  return {
    ...settings,
    hardMinTtlMs: HARD_MIN_INVITE_TTL_MS,
    hardMaxTtlMs: HARD_MAX_INVITE_TTL_MS,
    catalogModules: CATALOG_INVITE_MODULE_IDS.map((id) => ({
      id,
      label: CATALOG_LABELS[id] ?? id,
      defaultAllowed: (DEFAULT_ONBOARDING_MODULE_IDS as readonly string[]).includes(id),
    })),
  };
}

export function updateAgentInviteAdminSettings(
  input: UpdateAgentInviteAdminSettingsInput,
): AgentInviteAdminSettingsView {
  const current = normalizeAgentInviteAdminSettings(readStored());
  const nextStored: StoredAdminSettings = {
    defaultTtlMs: input.defaultTtlMs ?? current.defaultTtlMs,
    minTtlMs: input.minTtlMs ?? current.minTtlMs,
    maxTtlMs: input.maxTtlMs ?? current.maxTtlMs,
    allowedModules: input.allowedModules ?? current.allowedModules,
    defaultModules: input.defaultModules ?? current.defaultModules,
  };

  if (input.allowedModules !== undefined) {
    const unknown = uniqueModuleIds(input.allowedModules).filter((id) => !isCatalogModule(id));
    if (unknown.length > 0) {
      throw new Error(`Unknown module id(s): ${unknown.join(', ')}`);
    }
    if (uniqueModuleIds(input.allowedModules).filter(isCatalogModule).length === 0) {
      throw new Error('allowedModules must include at least one catalog module');
    }
  }

  if (input.defaultModules !== undefined) {
    const allowed = uniqueModuleIds(
      (input.allowedModules ?? current.allowedModules) as string[],
    ).filter(isCatalogModule);
    const blocked = uniqueModuleIds(input.defaultModules).filter((id) => !allowed.includes(id));
    if (blocked.length > 0) {
      throw new Error(`defaultModules not in allowedModules: ${blocked.join(', ')}`);
    }
  }

  const normalized = normalizeAgentInviteAdminSettings(nextStored);
  if (normalized.minTtlMs > normalized.maxTtlMs) {
    throw new Error('minTtlMs cannot exceed maxTtlMs');
  }
  if (normalized.defaultTtlMs < normalized.minTtlMs || normalized.defaultTtlMs > normalized.maxTtlMs) {
    throw new Error('defaultTtlMs must be within minTtlMs and maxTtlMs');
  }

  const updatedBy = typeof input.updatedBy === 'string' && input.updatedBy.trim()
    ? input.updatedBy.trim()
    : 'admin-ui';
  const withMeta: AgentInviteAdminSettings = {
    ...normalized,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  writeStored(withMeta, updatedBy);
  return getAgentInviteAdminSettings();
}

export function resolveInviteTtlMs(
  requestedTtlMs: number | undefined,
  settings: AgentInviteAdminSettings = normalizeAgentInviteAdminSettings(readStored()),
): { ok: true; ttlMs: number } | { ok: false; error: string; code: 'ttl_out_of_range' } {
  if (requestedTtlMs === undefined) {
    return { ok: true, ttlMs: settings.defaultTtlMs };
  }
  if (typeof requestedTtlMs !== 'number' || !Number.isFinite(requestedTtlMs) || requestedTtlMs <= 0) {
    return { ok: false, error: 'ttlMs must be a positive number', code: 'ttl_out_of_range' };
  }
  const ttlMs = Math.floor(requestedTtlMs);
  if (ttlMs < settings.minTtlMs || ttlMs > settings.maxTtlMs) {
    return {
      ok: false,
      error: `ttlMs must be between ${settings.minTtlMs} and ${settings.maxTtlMs}`,
      code: 'ttl_out_of_range',
    };
  }
  return { ok: true, ttlMs };
}

export function resolveInviteModules(
  requestedModules: readonly string[] | undefined,
  settings: AgentInviteAdminSettings = normalizeAgentInviteAdminSettings(readStored()),
): { ok: true; modules: string[] } | { ok: false; error: string; code: 'module_not_allowed' } {
  const modules = requestedModules === undefined
    ? [...settings.defaultModules]
    : uniqueModuleIds(requestedModules);
  if (modules.length === 0) {
    return { ok: false, error: 'selectedModules must not be empty', code: 'module_not_allowed' };
  }
  const blocked = modules.filter((id) => !settings.allowedModules.includes(id));
  if (blocked.length > 0) {
    return {
      ok: false,
      error: `Module(s) not allowed by admin policy: ${blocked.join(', ')}`,
      code: 'module_not_allowed',
    };
  }
  return { ok: true, modules };
}

/** Test helper — wipe stored admin settings. */
export function clearAgentInviteAdminSettingsForTests(): void {
  try {
    const db = getEntityDatabase(ensureAppSettingsTable);
    db.prepare('DELETE FROM app_settings WHERE key = ?').run(AGENT_INVITE_ADMIN_SETTINGS_KEY);
  } catch {
    // ignore when table missing
  }
}
