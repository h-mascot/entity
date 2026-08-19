type EnvLike = Record<string, string | undefined>;

export const PHASE2_FLAG_DEFINITIONS = [
  {
    key: 'receipt_completion_enforcement',
    envVar: 'ENTITY_PHASE2_RECEIPT_COMPLETION_ENFORCEMENT',
    defaultEnabled: true,
    category: 'enforcement',
    surface: 'completion',
    stage: 'strict_for_new_completion',
    description: 'Require canonical receipt creation before a task can cleanly move to done.',
  },
  {
    key: 'review_gate_policy_enforcement',
    envVar: 'ENTITY_PHASE2_REVIEW_GATE_POLICY_ENFORCEMENT',
    defaultEnabled: true,
    category: 'enforcement',
    surface: 'review_and_human_gates',
    stage: 'strict_for_reviewed_work',
    description: 'Enforce review packet, separation-of-duties, and human gate checks on review/done transitions.',
  },
  {
    key: 'worktype_registry_surface',
    envVar: 'ENTITY_PHASE2_WORKTYPE_REGISTRY_SURFACE',
    defaultEnabled: true,
    category: 'surface',
    surface: 'worktype_registry',
    stage: 'visible',
    description: 'Expose the versioned worktype registry and overlay metadata.',
  },
  {
    key: 'migration_enforcement',
    envVar: 'ENTITY_PHASE2_MIGRATION_ENFORCEMENT',
    defaultEnabled: false,
    category: 'enforcement',
    surface: 'migration_backfill',
    stage: 'observation_only',
    description: 'Allow migration warnings to participate in staged strict enforcement for newly touched records.',
  },
  {
    key: 'search_permission_strictness',
    envVar: 'ENTITY_PHASE2_SEARCH_PERMISSION_STRICTNESS',
    defaultEnabled: true,
    category: 'enforcement',
    surface: 'search_permissions',
    stage: 'strict_before_render',
    description: 'Require permission filtering before search snippets, previews, or document content are returned.',
  },
  {
    key: 'taskmaster_automation',
    envVar: 'ENTITY_PHASE2_TASKMASTER_AUTOMATION',
    defaultEnabled: true,
    category: 'automation',
    surface: 'task_master_routing',
    stage: 'policy_controlled',
    description: 'Allow Task Master claim/routing automation where policy marks work as drivable.',
  },
  {
    key: 'capability_resolver_enforcement',
    envVar: 'ENTITY_PHASE2_CAPABILITY_RESOLVER_ENFORCEMENT',
    defaultEnabled: true,
    category: 'enforcement',
    surface: 'document_capabilities',
    stage: 'strict_for_truthful_actions',
    description:
      'Route API/UI document actions through the truthing Capability Resolver (T-006) so ' +
      'provider+connection+destination+policy+runtime evidence, not provider name, decides ' +
      'actionability. Disabling reverts to the prior behavior for the resolution rollout.',
  },
] as const;

export type Phase2FlagKey = typeof PHASE2_FLAG_DEFINITIONS[number]['key'];
export type Phase2FlagCategory = typeof PHASE2_FLAG_DEFINITIONS[number]['category'];

export interface Phase2FlagState {
  key: Phase2FlagKey;
  envVar: string;
  enabled: boolean;
  defaultEnabled: boolean;
  category: Phase2FlagCategory;
  surface: string;
  stage: string;
  description: string;
  source: 'default' | 'enable_list' | 'disable_list' | 'env';
}

export type Phase2FlagSnapshot = Record<Phase2FlagKey, Phase2FlagState>;

export interface Phase2FlagDiagnostics {
  profile: 'phase2-staged-rollout';
  generated_at: string;
  flags: Phase2FlagState[];
  groups: Record<Phase2FlagCategory, Phase2FlagKey[]>;
  coverage: {
    receipt_completion: Phase2FlagKey;
    review_gate_policy: Phase2FlagKey;
    worktype_registry: Phase2FlagKey;
    migration_enforcement: Phase2FlagKey;
    search_permission_strictness: Phase2FlagKey;
    taskmaster_automation: Phase2FlagKey;
    capability_resolver: Phase2FlagKey;
  };
  legacy_compatibility: {
    old_tasks_remain_visible: true;
    disabled_flags_preserve_data: true;
    migration_enforcement_default: false;
  };
}

function normalizeFlagToken(value: string): string {
  return value.trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (['1', 'true', 'yes', 'on', 'enabled', 'enable'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off', 'disabled', 'disable'].includes(normalized)) {
    return false;
  }
  return undefined;
}

function parseFlagList(value: string | undefined): Set<string> {
  if (!value) {
    return new Set();
  }
  return new Set(
    value
      .split(',')
      .map(normalizeFlagToken)
      .filter(Boolean),
  );
}

function listHasFlag(flags: Set<string>, key: Phase2FlagKey): boolean {
  return flags.has('all') || flags.has(normalizeFlagToken(key));
}

export function resolvePhase2Flags(env: EnvLike = process.env): Phase2FlagSnapshot {
  const enabledList = parseFlagList(env.ENTITY_PHASE2_ENABLE_FLAGS);
  const disabledList = parseFlagList(env.ENTITY_PHASE2_DISABLE_FLAGS);
  const entries = PHASE2_FLAG_DEFINITIONS.map((definition): [Phase2FlagKey, Phase2FlagState] => {
    let enabled = definition.defaultEnabled;
    let source: Phase2FlagState['source'] = 'default';

    if (listHasFlag(enabledList, definition.key)) {
      enabled = true;
      source = 'enable_list';
    }
    if (listHasFlag(disabledList, definition.key)) {
      enabled = false;
      source = 'disable_list';
    }

    const envOverride = parseBoolean(env[definition.envVar]);
    if (typeof envOverride !== 'undefined') {
      enabled = envOverride;
      source = 'env';
    }

    return [
      definition.key,
      {
        key: definition.key,
        envVar: definition.envVar,
        enabled,
        defaultEnabled: definition.defaultEnabled,
        category: definition.category,
        surface: definition.surface,
        stage: definition.stage,
        description: definition.description,
        source,
      },
    ];
  });

  return Object.fromEntries(entries) as Phase2FlagSnapshot;
}

export function phase2FlagEnabled(flags: Phase2FlagSnapshot, key: Phase2FlagKey): boolean {
  return flags[key]?.enabled === true;
}

export function serializePhase2FlagDiagnostics(
  flags: Phase2FlagSnapshot = resolvePhase2Flags(),
  now: Date = new Date(),
): Phase2FlagDiagnostics {
  const groups = PHASE2_FLAG_DEFINITIONS.reduce((acc, definition) => {
    const group = definition.category;
    acc[group] = [...(acc[group] ?? []), definition.key];
    return acc;
  }, {} as Record<Phase2FlagCategory, Phase2FlagKey[]>);

  return {
    profile: 'phase2-staged-rollout',
    generated_at: now.toISOString(),
    flags: PHASE2_FLAG_DEFINITIONS.map((definition) => flags[definition.key]),
    groups,
    coverage: {
      receipt_completion: 'receipt_completion_enforcement',
      review_gate_policy: 'review_gate_policy_enforcement',
      worktype_registry: 'worktype_registry_surface',
      migration_enforcement: 'migration_enforcement',
      search_permission_strictness: 'search_permission_strictness',
      taskmaster_automation: 'taskmaster_automation',
      capability_resolver: 'capability_resolver_enforcement',
    },
    legacy_compatibility: {
      old_tasks_remain_visible: true,
      disabled_flags_preserve_data: true,
      migration_enforcement_default: false,
    },
  };
}
