import type Database from 'better-sqlite3';
import { getSettingJson, setSettingJson } from './settings-store';
import { ADMIN_SETTINGS_DEFAULTS, ADMIN_SETTINGS_KEYS, parseAdminSettings, type AdminSettingsKey } from './admin-settings';

export function getAdminSettings<K extends AdminSettingsKey>(db: Database.Database, key: K): (typeof ADMIN_SETTINGS_DEFAULTS)[K] {
  const stored = getSettingJson(db, key);
  if (!stored) return ADMIN_SETTINGS_DEFAULTS[key];
  try {
    return parseAdminSettings(key, stored) as (typeof ADMIN_SETTINGS_DEFAULTS)[K];
  } catch {
    return ADMIN_SETTINGS_DEFAULTS[key];
  }
}

export function setAdminSettings<K extends AdminSettingsKey>(
  db: Database.Database,
  key: K,
  value: unknown,
  updatedBy = 'admin-ui',
) {
  const parsed = parseAdminSettings(key, value);
  setSettingJson(db, key, parsed, updatedBy);
  return parsed;
}

/**
 * Apply a partial patch on top of the currently stored settings for `key`.
 * Required so admin UI flows can PATCH a single field (e.g. the bootstrap
 * flow writing `apiPrincipalId`) without resending every required field.
 * The merged object is still validated by the full Zod schema, so an invalid
 * partial value (bad type, bad enum) still rejects.
 *
 * The read-merge-validate-write runs inside a single better-sqlite3
 * transaction so two concurrent partial PATCHes to the same section compose
 * serially instead of the later writer clobbering the earlier one's fields.
 */
export function patchAdminSettings<K extends AdminSettingsKey>(
  db: Database.Database,
  key: K,
  patch: Record<string, unknown>,
  updatedBy = 'admin-ui',
) {
  const applyPatch = () => {
    const current = getAdminSettings(db, key) as Record<string, unknown>;
    const merged = { ...current, ...patch };
    return setAdminSettings(db, key, merged, updatedBy);
  };
  // db.transaction wraps applyPatch in BEGIN/COMMIT; if setAdminSettings throws
  // (Zod rejection) the transaction rolls back and nothing is written.
  return db.transaction(applyPatch)();
}

export function resetAdminSettings<K extends AdminSettingsKey>(db: Database.Database, key: K, updatedBy = 'admin-ui') {
  const defaults = ADMIN_SETTINGS_DEFAULTS[key];
  setSettingJson(db, key, defaults, updatedBy);
  return defaults;
}

export function getAllAdminSettings(db: Database.Database) {
  return Object.fromEntries(
    Object.values(ADMIN_SETTINGS_KEYS).map((key) => [key, getAdminSettings(db, key)]),
  );
}
