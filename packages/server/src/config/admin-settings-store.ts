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
