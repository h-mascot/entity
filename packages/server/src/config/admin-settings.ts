import { z } from 'zod';

export const ADMIN_SETTINGS_KEYS = {
  accessControl: 'admin.accessControl',
  businessOnboarding: 'admin.businessOnboarding',
  engineering: 'admin.engineering',
  workplanes: 'admin.workplanes',
  strategicRoadmap: 'admin.strategicRoadmap',
  scopedSearch: 'admin.scopedSearch',
  channels: 'admin.channels',
} as const;

export type AdminSettingsKey = (typeof ADMIN_SETTINGS_KEYS)[keyof typeof ADMIN_SETTINGS_KEYS];

export const AccessControlSettingsSchema = z.object({
  loginRequiredDefault: z.boolean(),
  defaultOrgId: z.string().min(1),
  enforceStoredPrincipals: z.boolean(),
  allowHeaderCompat: z.boolean(),
});

export const BusinessOnboardingSettingsSchema = z.object({
  enabled: z.boolean(),
  defaultDomain: z.enum([
    'claims',
    'engineering',
    'product',
    'sales',
    'marketing',
    'finance',
    'customer_success',
    'people_ops',
    'health_business',
    'ai_ops',
    'other',
  ]),
  requireDryRun: z.boolean(),
});

export const EngineeringSettingsSchema = z.object({
  defaultWorkDomain: z.enum(['engineering', 'product', 'ops']),
  importDryRunRequired: z.boolean(),
  showEmptyStateHints: z.boolean(),
});

export const WorkplanesSettingsSchema = z.object({
  requireProofBeforeReview: z.boolean(),
  lockAgentLayoutMutation: z.boolean(),
  showActivityDegradedBanner: z.boolean(),
});

export const StrategicRoadmapSettingsSchema = z.object({
  showBacklogLane: z.boolean(),
  showRecurringLane: z.boolean(),
  showDependencyHints: z.boolean(),
});

export const ScopedSearchSettingsSchema = z.object({
  defaultCollection: z.enum(['all', 'obsidian', 'superada', 'sessions', 'scotty', 'spock', 'memory']),
  labelDegradedResults: z.boolean(),
  includeTaskProof: z.boolean(),
});

export const ChannelsSettingsSchema = z.object({
  referenceAdapterEnabled: z.boolean(),
  preferredChannels: z.array(z.enum(['entity_inbox', 'clickclack', 'email', 'discord', 'slack', 'agentpush', 'webhook', 'other'])),
  degradeOnAdapterFailure: z.boolean(),
});

export const ADMIN_SETTINGS_SCHEMAS = {
  [ADMIN_SETTINGS_KEYS.accessControl]: AccessControlSettingsSchema,
  [ADMIN_SETTINGS_KEYS.businessOnboarding]: BusinessOnboardingSettingsSchema,
  [ADMIN_SETTINGS_KEYS.engineering]: EngineeringSettingsSchema,
  [ADMIN_SETTINGS_KEYS.workplanes]: WorkplanesSettingsSchema,
  [ADMIN_SETTINGS_KEYS.strategicRoadmap]: StrategicRoadmapSettingsSchema,
  [ADMIN_SETTINGS_KEYS.scopedSearch]: ScopedSearchSettingsSchema,
  [ADMIN_SETTINGS_KEYS.channels]: ChannelsSettingsSchema,
} as const;

export const ADMIN_SETTINGS_DEFAULTS = {
  [ADMIN_SETTINGS_KEYS.accessControl]: {
    loginRequiredDefault: false,
    defaultOrgId: 'default-org',
    enforceStoredPrincipals: true,
    allowHeaderCompat: true,
  },
  [ADMIN_SETTINGS_KEYS.businessOnboarding]: {
    enabled: true,
    defaultDomain: 'product',
    requireDryRun: false,
  },
  [ADMIN_SETTINGS_KEYS.engineering]: {
    defaultWorkDomain: 'engineering',
    importDryRunRequired: true,
    showEmptyStateHints: true,
  },
  [ADMIN_SETTINGS_KEYS.workplanes]: {
    requireProofBeforeReview: true,
    lockAgentLayoutMutation: true,
    showActivityDegradedBanner: true,
  },
  [ADMIN_SETTINGS_KEYS.strategicRoadmap]: {
    showBacklogLane: true,
    showRecurringLane: true,
    showDependencyHints: true,
  },
  [ADMIN_SETTINGS_KEYS.scopedSearch]: {
    defaultCollection: 'all',
    labelDegradedResults: true,
    includeTaskProof: true,
  },
  [ADMIN_SETTINGS_KEYS.channels]: {
    referenceAdapterEnabled: false,
    preferredChannels: ['entity_inbox', 'clickclack'],
    degradeOnAdapterFailure: true,
  },
} as const;

export type AccessControlSettings = z.infer<typeof AccessControlSettingsSchema>;
export type BusinessOnboardingSettings = z.infer<typeof BusinessOnboardingSettingsSchema>;
export type EngineeringSettings = z.infer<typeof EngineeringSettingsSchema>;
export type WorkplanesSettings = z.infer<typeof WorkplanesSettingsSchema>;
export type StrategicRoadmapSettings = z.infer<typeof StrategicRoadmapSettingsSchema>;
export type ScopedSearchSettings = z.infer<typeof ScopedSearchSettingsSchema>;
export type ChannelsSettings = z.infer<typeof ChannelsSettingsSchema>;

export function parseAdminSettings<K extends AdminSettingsKey>(
  key: K,
  value: unknown,
) {
  return ADMIN_SETTINGS_SCHEMAS[key].parse(value);
}

export function getAdminSettingsDefault<K extends AdminSettingsKey>(key: K) {
  return ADMIN_SETTINGS_DEFAULTS[key];
}
