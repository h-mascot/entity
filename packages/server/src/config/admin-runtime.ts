import { getEntityDatabase } from '../../../db/src/entity-db';
import { ensureAppSettingsTable } from '../config/settings-store';
import {
  ADMIN_SETTINGS_DEFAULTS,
  ADMIN_SETTINGS_KEYS,
  type AccessControlSettings,
  type AdminSettingsKey,
  type BusinessOnboardingSettings,
  type ChannelsSettings,
  type EngineeringSettings,
  type ScopedSearchSettings,
  type StrategicRoadmapSettings,
  type WorkplanesSettings,
} from '../config/admin-settings';
import { getAdminSettings } from '../config/admin-settings-store';

function readSettings<K extends AdminSettingsKey>(key: K) {
  try {
    const db = getEntityDatabase(ensureAppSettingsTable);
    return getAdminSettings(db, key);
  } catch {
    return ADMIN_SETTINGS_DEFAULTS[key];
  }
}

export function readAdminRuntimeSettings() {
  const settings = {
    accessControl: readSettings(ADMIN_SETTINGS_KEYS.accessControl),
    businessOnboarding: readSettings(ADMIN_SETTINGS_KEYS.businessOnboarding),
    engineering: readSettings(ADMIN_SETTINGS_KEYS.engineering),
    workplanes: readSettings(ADMIN_SETTINGS_KEYS.workplanes),
    strategicRoadmap: readSettings(ADMIN_SETTINGS_KEYS.strategicRoadmap),
    scopedSearch: readSettings(ADMIN_SETTINGS_KEYS.scopedSearch),
    channels: readSettings(ADMIN_SETTINGS_KEYS.channels),
  };
  return settings as unknown as {
    accessControl: AccessControlSettings;
    businessOnboarding: BusinessOnboardingSettings;
    engineering: EngineeringSettings;
    workplanes: WorkplanesSettings;
    strategicRoadmap: StrategicRoadmapSettings;
    scopedSearch: ScopedSearchSettings;
    channels: ChannelsSettings;
  };
}

export function readAccessControlRuntimeSettings(): AccessControlSettings {
  return readAdminRuntimeSettings().accessControl;
}

export function readDefaultOrgId(): string {
  return readAccessControlRuntimeSettings().defaultOrgId;
}

export function readEngineeringRuntimeSettings(): EngineeringSettings {
  return readAdminRuntimeSettings().engineering;
}

export function readStrategicRoadmapRuntimeSettings(): StrategicRoadmapSettings {
  return readAdminRuntimeSettings().strategicRoadmap;
}

export function readScopedSearchRuntimeSettings(): ScopedSearchSettings {
  return readAdminRuntimeSettings().scopedSearch;
}

export function readChannelsRuntimeSettings(): ChannelsSettings {
  return readAdminRuntimeSettings().channels;
}

export function assertEngineeringImportExecuteAllowed(
  executeRequested: boolean,
  importDryRunRequired: boolean = readEngineeringRuntimeSettings().importDryRunRequired,
): void {
  if (executeRequested && importDryRunRequired) {
    throw new Error('Engineering import execute is blocked while importDryRunRequired is enabled.');
  }
}
