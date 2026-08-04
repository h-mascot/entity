import { withApiToken } from './http';

export interface AdminRuntimeSettings {
  accessControl: {
    loginRequiredDefault: boolean;
    defaultOrgId: string;
    enforceStoredPrincipals: boolean;
    allowHeaderCompat: boolean;
    apiPrincipalId: string | null;
  };
  businessOnboarding: {
    enabled: boolean;
    defaultDomain: string;
    requireDryRun: boolean;
  };
  engineering: {
    defaultWorkDomain: 'engineering' | 'product' | 'ops';
    importDryRunRequired: boolean;
    showEmptyStateHints: boolean;
  };
  strategicRoadmap: {
    showBacklogLane: boolean;
    showRecurringLane: boolean;
    showDependencyHints: boolean;
  };
  scopedSearch: {
    defaultCollection: string;
    labelDegradedResults: boolean;
    includeTaskProof: boolean;
  };
}

let cachedSettings: AdminRuntimeSettings | null = null;

export async function loadAdminRuntimeSettings(apiBase = ''): Promise<AdminRuntimeSettings | null> {
  if (cachedSettings) return cachedSettings;
  try {
    const res = await fetch(`${apiBase}/api/runtime/admin-settings`, withApiToken());
    if (!res.ok) return null;
    cachedSettings = await res.json() as AdminRuntimeSettings;
    return cachedSettings;
  } catch {
    return null;
  }
}

export function clearAdminRuntimeSettingsCache(): void {
  cachedSettings = null;
}
