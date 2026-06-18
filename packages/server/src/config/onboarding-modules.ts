import fs from 'fs';
import path from 'path';
import type { ModuleRegistryRecord, ModuleSkillRefRecord } from '../../../db/src';

export const ONBOARDING_BUNDLE_IDS = ['minimal', 'default', 'custom'] as const;
export type OnboardingBundleId = (typeof ONBOARDING_BUNDLE_IDS)[number];

export const DEFAULT_ONBOARDING_BUNDLE: OnboardingBundleId = 'default';
export const MINIMAL_ONBOARDING_MODULE_IDS = ['entity-agent-contracts', 'entity-fs'] as const;
export const DEFAULT_ONBOARDING_MODULE_IDS = [
  ...MINIMAL_ONBOARDING_MODULE_IDS,
  'entity-mc',
  'entity-linker',
] as const;

export type OnboardingModuleId = (typeof DEFAULT_ONBOARDING_MODULE_IDS)[number]
  | 'entity-discord-title-hook'
  | 'entity-services'
  | 'geordi-swarm';

export type OnboardingModuleCategory = 'required' | 'recommended' | 'optional' | 'third-party';
export type OnboardingModuleKind = 'contract' | 'module' | 'plugin';
export type OnboardingRiskLevel = 'low' | 'medium' | 'high' | 'admin';
export type OnboardingGateStatus = 'pass' | 'warn' | 'fail';

export interface OnboardingOperationStep {
  id: string;
  label: string;
  detail: string;
  command?: string;
  url?: string;
  optional?: boolean;
}

export interface OnboardingModuleSkillRef {
  id: string;
  label: string;
  kind: string;
  ref: string;
  required: boolean;
  notes: string | null;
}

export interface OnboardingAgentContextExport {
  moduleId: string;
  path: string;
  kind: 'state' | 'contract' | 'snippet';
  format: 'json' | 'markdown';
  description: string;
}

export interface OnboardingModuleManifest {
  id: OnboardingModuleId;
  name: string;
  description: string;
  version: string;
  kind: OnboardingModuleKind;
  host: string;
  entityVersion: string;
  category: OnboardingModuleCategory;
  required: boolean;
  recommended: boolean;
  defaultMode: OnboardingBundleId;
  riskLevel: OnboardingRiskLevel;
  capabilities: string[];
  requires: string[];
  conflictsWith: string[];
  docsUrl: string;
  availableInOnboarding: boolean;
  approvedForOnboarding: boolean;
  installFootprint: string[];
  skillRefs: OnboardingModuleSkillRef[];
  entrypoints: Record<string, string>;
  installSteps: OnboardingOperationStep[];
  verifySteps: OnboardingOperationStep[];
  uninstallSteps: OnboardingOperationStep[];
  rollbackSteps: OnboardingOperationStep[];
  agentContextSnippet: string;
  agentContextExports: OnboardingAgentContextExport[];
  runtime: boolean;
  verificationRequired: boolean;
  installRank: number;
}

export interface OnboardingModuleSummary extends OnboardingModuleManifest {
  enabled: boolean;
  selectable: boolean;
  locked: boolean;
  source: 'seeded' | 'registry';
  installOrder: number;
  uiLabel: string;
}

export interface OnboardingSelectionInput {
  selectedBundle?: string | null;
  selectedModules?: string[] | null;
  selectedModuleConfig?: Record<string, unknown> | null;
}

export interface OnboardingSelectionWarning {
  id: string;
  reason: string;
}

export interface OnboardingGateResult {
  id: string;
  label: string;
  status: OnboardingGateStatus;
  detail: string;
}

export interface OnboardingDryRunPlan {
  mode: OnboardingBundleId;
  writes: Array<{ path: string; reason: string; moduleId?: string }>;
  downloads: Array<{ ref: string; label: string; moduleId: string }>;
  installSteps: Array<OnboardingOperationStep & { moduleId: string }>;
  verifySteps: Array<OnboardingOperationStep & { moduleId: string }>;
  rollbackSteps: Array<OnboardingOperationStep & { moduleId: string }>;
  contextExports: OnboardingAgentContextExport[];
}

export interface OnboardingChecklistItem {
  id: string;
  label: string;
  moduleId?: string;
  status: 'pending' | 'running' | 'done' | 'error';
  message?: string;
}

export interface OnboardingSelectionResolution {
  requestedBundle: OnboardingBundleId;
  normalizedBundle: OnboardingBundleId;
  requestedModules: string[];
  selectedModules: string[];
  selectedModuleConfig: Record<string, unknown>;
  modules: OnboardingModuleSummary[];
  installOrder: string[];
  warnings: string[];
  skipped: OnboardingSelectionWarning[];
  adminOnly: OnboardingSelectionWarning[];
  gates: OnboardingGateResult[];
  dryRun: OnboardingDryRunPlan;
  checklist: OnboardingChecklistItem[];
  safeStopConditions: string[];
  canApply: boolean;
  status: 'ready' | 'warning' | 'blocked';
}

export interface OnboardingModulesResponse {
  version: number;
  defaultBundle: OnboardingBundleId;
  defaultModules: string[];
  bundles: Array<{ id: OnboardingBundleId; name: string; description: string; moduleIds: string[] }>;
  modules: OnboardingModuleSummary[];
  groups: Record<OnboardingModuleCategory, OnboardingModuleSummary[]>;
  warnings: string[];
}

export interface OnboardingReadiness {
  version: number;
  entityVersion: string;
  publicUrl: string;
  openClawDetected: boolean;
  fileSourcesAvailable: boolean;
  missionControlReachable: boolean;
  pluginHostAvailable: boolean;
  installedRegistry: { total: number; onboarding: number; selectable: number };
  warnings: string[];
  adminOnly: OnboardingSelectionWarning[];
}

export class OnboardingSelectionError extends Error {
  statusCode: number;
  payload?: Record<string, unknown>;

  constructor(statusCode: number, message: string, payload?: Record<string, unknown>) {
    super(message);
    this.name = 'OnboardingSelectionError';
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

interface OnboardingModuleSeed {
  id: OnboardingModuleId;
  name: string;
  description: string;
  kind: OnboardingModuleKind;
  category: OnboardingModuleCategory;
  required: boolean;
  recommended: boolean;
  defaultMode: OnboardingBundleId;
  riskLevel: OnboardingRiskLevel;
  capabilities: string[];
  requires: string[];
  conflictsWith: string[];
  docsUrl: string;
  availableInOnboarding: boolean;
  approvedForOnboarding: boolean;
  installFootprint: string[];
  entrypoints: Record<string, string>;
  installSteps: Omit<OnboardingOperationStep, 'id'>[];
  verifySteps: Omit<OnboardingOperationStep, 'id'>[];
  uninstallSteps: Omit<OnboardingOperationStep, 'id'>[];
  rollbackSteps: Omit<OnboardingOperationStep, 'id'>[];
  agentContextSnippet: string;
  runtime: boolean;
  verificationRequired: boolean;
  installRank: number;
  icon: string;
  uiLabel: string;
}

interface BuildModuleOptions {
  entityVersion: string;
  entityMcBundlePath: string;
  token?: string;
  publicBaseUrl?: string;
}

interface ResolveSelectionOptions extends BuildModuleOptions {
  selectedBundle?: string | null;
  selectedModules?: string[] | null;
  selectedModuleConfig?: Record<string, unknown> | null;
}

const ENTITY_CONTEXT_ROOT = '~/.entity/agent-context';

const BUNDLE_LABELS: Record<OnboardingBundleId, { name: string; description: string }> = {
  minimal: {
    name: 'Minimal',
    description: 'Required contracts and Entity-backed docs/file delivery only.',
  },
  default: {
    name: 'Default',
    description: 'Minimal plus the recommended Entity helper modules.',
  },
  custom: {
    name: 'Custom',
    description: 'Manual module selection with dependency and safety checks.',
  },
};

const SEEDED_MODULES: OnboardingModuleSeed[] = [
  {
    id: 'entity-agent-contracts',
    name: 'Entity Agent Contracts',
    description: 'Required operating contract for Entity-aware agents, evidence links, and source-of-truth discipline.',
    kind: 'contract',
    category: 'required',
    required: true,
    recommended: true,
    defaultMode: 'minimal',
    riskLevel: 'low',
    capabilities: ['entity-doc-links', 'source-of-truth-discipline', 'setup-scope-guardrails'],
    requires: [],
    conflictsWith: [],
    docsUrl: 'docs/pluggable-agents-modules-spec.md#required-base-contract',
    availableInOnboarding: true,
    approvedForOnboarding: true,
    installFootprint: [`${ENTITY_CONTEXT_ROOT}/contracts/entity-agent-contracts.json`],
    entrypoints: {},
    installSteps: [
      {
        label: 'Export contract bundle',
        detail: 'Write the required Entity agent contract into the composable agent-context contract directory.',
      },
    ],
    verifySteps: [
      {
        label: 'Validate contract export',
        detail: 'Ensure the required Entity contract export exists in agent context before setup completes.',
      },
    ],
    uninstallSteps: [
      {
        label: 'Keep contract installed',
        detail: 'Required contracts are not removed in user-facing onboarding.',
        optional: false,
      },
    ],
    rollbackSteps: [
      {
        label: 'Restore prior contract export',
        detail: 'Restore the last known-good contract export if a managed update fails.',
      },
    ],
    agentContextSnippet: 'Always use Entity docs links for evidence and stay within the setup manifest scope.',
    runtime: false,
    verificationRequired: true,
    installRank: 10,
    icon: 'shield',
    uiLabel: 'Required contract',
  },
  {
    id: 'entity-fs',
    name: 'Entity FS',
    description: 'Entity-backed file sources, docs links, and artifact delivery behavior for onboarding-safe agents.',
    kind: 'module',
    category: 'required',
    required: true,
    recommended: true,
    defaultMode: 'minimal',
    riskLevel: 'low',
    capabilities: ['file-sources', 'docs-output-links', 'artifact-delivery'],
    requires: ['entity-agent-contracts'],
    conflictsWith: [],
    docsUrl: 'docs/pluggable-agents-modules-spec.md#module-model',
    availableInOnboarding: true,
    approvedForOnboarding: true,
    installFootprint: [`${ENTITY_CONTEXT_ROOT}/snippets/entity-fs.md`],
    entrypoints: {},
    installSteps: [
      {
        label: 'Bind docs/file context',
        detail: 'Export the Entity FS snippet so onboarding agents know how to reference docs and file sources.',
      },
    ],
    verifySteps: [
      {
        label: 'Check file source visibility',
        detail: 'Confirm the workspace can expose docs/file source links after setup.',
      },
    ],
    uninstallSteps: [
      {
        label: 'Preserve managed FS docs link contract',
        detail: 'Required file-source integration stays enabled for Entity-aware setup.',
      },
    ],
    rollbackSteps: [
      {
        label: 'Restore prior FS snippet',
        detail: 'Restore the previous FS context snippet if setup rewrites fail verification.',
      },
    ],
    agentContextSnippet: 'Use Entity file-source and docs-output links when referring to workspace artifacts.',
    runtime: true,
    verificationRequired: true,
    installRank: 20,
    icon: 'folder',
    uiLabel: 'Required docs/file layer',
  },
  {
    id: 'entity-mc',
    name: 'Entity MC',
    description: 'Mission Control helper bundle for task pickup, progress evidence, and setup-safe verification flow.',
    kind: 'module',
    category: 'recommended',
    required: false,
    recommended: true,
    defaultMode: 'default',
    riskLevel: 'medium',
    capabilities: ['mission-control', 'progress-reporting', 'task-context'],
    requires: ['entity-agent-contracts', 'entity-fs'],
    conflictsWith: [],
    docsUrl: 'skills/entity-mc/SKILL.md',
    availableInOnboarding: true,
    approvedForOnboarding: true,
    installFootprint: ['skills/entity-mc/', `${ENTITY_CONTEXT_ROOT}/snippets/entity-mc.md`],
    entrypoints: {},
    installSteps: [
      {
        label: 'Download Entity MC bundle',
        detail: 'Fetch the setup-safe Entity MC bundle from the onboarding manifest.',
      },
      {
        label: 'Install Entity MC',
        detail: 'Run install.sh against the current Entity app with the session token.',
      },
    ],
    verifySteps: [
      {
        label: 'Verify Entity MC',
        detail: 'Run verify.sh and require VERIFY_OK before marking the helper ready.',
      },
    ],
    uninstallSteps: [
      {
        label: 'Remove local helper install',
        detail: 'Run rollback.sh or the local helper removal path for Entity MC-managed files only.',
      },
    ],
    rollbackSteps: [
      {
        label: 'Rollback Entity MC install',
        detail: 'Restore the previous Entity MC-managed state after a failed verify.',
      },
    ],
    agentContextSnippet: 'Report meaningful progress through the manifest progress endpoint after each setup milestone.',
    runtime: true,
    verificationRequired: true,
    installRank: 30,
    icon: 'check',
    uiLabel: 'Recommended task helper',
  },
  {
    id: 'entity-linker',
    name: 'Entity Linker',
    description: 'Outbound docs-link rewriting and Entity delivery integration for shared artifacts.',
    kind: 'plugin',
    category: 'recommended',
    required: false,
    recommended: true,
    defaultMode: 'default',
    riskLevel: 'medium',
    capabilities: ['link-rewriting', 'docs-delivery'],
    requires: ['entity-agent-contracts', 'entity-fs'],
    conflictsWith: [],
    docsUrl: 'docs/PLUGIN-ARCHITECTURE-SPEC.md',
    availableInOnboarding: true,
    approvedForOnboarding: true,
    installFootprint: [`${ENTITY_CONTEXT_ROOT}/snippets/entity-linker.md`],
    entrypoints: {},
    installSteps: [
      {
        label: 'Configure docs-link integration',
        detail: 'Install the linker snippet and module metadata needed for Entity doc-link delivery.',
      },
    ],
    verifySteps: [
      {
        label: 'Check docs-link routing',
        detail: 'Confirm the selected setup can render Entity-backed docs links after onboarding.',
      },
    ],
    uninstallSteps: [
      {
        label: 'Remove linker snippet',
        detail: 'Remove only the onboarding-managed linker snippet and keep user docs intact.',
      },
    ],
    rollbackSteps: [
      {
        label: 'Restore prior linker config',
        detail: 'Restore the previous linker-managed integration if a verify probe fails.',
      },
    ],
    agentContextSnippet: 'Prefer Entity docs links for exported artifacts and stop if docs delivery checks fail.',
    runtime: true,
    verificationRequired: true,
    installRank: 40,
    icon: 'link',
    uiLabel: 'Recommended docs linker',
  },
  {
    id: 'entity-discord-title-hook',
    name: 'Discord Title Hook',
    description: 'Discord title sync integration for channels and task views.',
    kind: 'plugin',
    category: 'optional',
    required: false,
    recommended: false,
    defaultMode: 'custom',
    riskLevel: 'admin',
    capabilities: ['discord-sync', 'title-hooks'],
    requires: ['entity-linker'],
    conflictsWith: [],
    docsUrl: 'docs/PLUGIN-ARCHITECTURE-SPEC.md',
    availableInOnboarding: false,
    approvedForOnboarding: false,
    installFootprint: ['Admin-managed Discord integration config'],
    entrypoints: {},
    installSteps: [
      {
        label: 'Configure Discord bridge',
        detail: 'Requires Admin approval and external service credentials.',
      },
    ],
    verifySteps: [],
    uninstallSteps: [],
    rollbackSteps: [],
    agentContextSnippet: 'Admin-only: do not configure Discord title sync during first-run onboarding.',
    runtime: true,
    verificationRequired: false,
    installRank: 45,
    icon: 'hash',
    uiLabel: 'Admin only',
  },
  {
    id: 'entity-services',
    name: 'Entity Services',
    description: 'Service/runtime integrations that need explicit host approval and lifecycle management.',
    kind: 'plugin',
    category: 'optional',
    required: false,
    recommended: false,
    defaultMode: 'custom',
    riskLevel: 'admin',
    capabilities: ['service-integrations', 'runtime-bridges'],
    requires: ['entity-fs'],
    conflictsWith: [],
    docsUrl: 'docs/PLUGIN-ARCHITECTURE-SPEC.md',
    availableInOnboarding: false,
    approvedForOnboarding: false,
    installFootprint: ['Admin-managed service config'],
    entrypoints: {},
    installSteps: [
      {
        label: 'Configure service integrations',
        detail: 'Requires host/runtime approval and is deferred to Admin/Doctor.',
      },
    ],
    verifySteps: [],
    uninstallSteps: [],
    rollbackSteps: [],
    agentContextSnippet: 'Admin-only: service/runtime integrations stay out of first-run onboarding.',
    runtime: true,
    verificationRequired: false,
    installRank: 50,
    icon: 'server',
    uiLabel: 'Admin only',
  },
  {
    id: 'geordi-swarm',
    name: 'Geordi Swarm',
    description: 'Multi-agent swarm/product orchestration built on top of the core Entity helpers.',
    kind: 'plugin',
    category: 'optional',
    required: false,
    recommended: false,
    defaultMode: 'custom',
    riskLevel: 'admin',
    capabilities: ['multi-agent-orchestration', 'swarm-ops'],
    requires: ['entity-mc'],
    conflictsWith: [],
    docsUrl: 'docs/PLUGIN-ARCHITECTURE-SPEC.md',
    availableInOnboarding: false,
    approvedForOnboarding: false,
    installFootprint: ['Admin-managed swarm runtime config'],
    entrypoints: {},
    installSteps: [
      {
        label: 'Configure swarm runtime',
        detail: 'Deferred to Admin because it depends on runtime/process configuration outside onboarding.',
      },
    ],
    verifySteps: [],
    uninstallSteps: [],
    rollbackSteps: [],
    agentContextSnippet: 'Admin-only: Geordi Swarm requires runtime configuration beyond first-run setup.',
    runtime: true,
    verificationRequired: false,
    installRank: 60,
    icon: 'users',
    uiLabel: 'Admin only',
  },
];

function bundleModuleIds(bundle: OnboardingBundleId): string[] {
  if (bundle === 'minimal') return [...MINIMAL_ONBOARDING_MODULE_IDS];
  return [...DEFAULT_ONBOARDING_MODULE_IDS];
}

function inferBundle(moduleIds: string[]): OnboardingBundleId {
  const normalized = uniqueStrings(moduleIds).sort();
  const minimal = [...MINIMAL_ONBOARDING_MODULE_IDS].sort();
  const defaults = [...DEFAULT_ONBOARDING_MODULE_IDS].sort();
  if (arrayEquals(normalized, minimal)) return 'minimal';
  if (arrayEquals(normalized, defaults)) return 'default';
  return 'custom';
}

function arrayEquals(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function safeParseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    list.push(normalized);
  }
  return list;
}

function normalizeBundle(bundle: string | null | undefined): OnboardingBundleId {
  if (bundle === 'minimal' || bundle === 'default' || bundle === 'custom') return bundle;
  return DEFAULT_ONBOARDING_BUNDLE;
}

function readUiConfig(row: ModuleRegistryRecord | undefined): Record<string, unknown> {
  return row ? safeParseJson<Record<string, unknown>>(row.ui_config_json, {}) : {};
}

function moduleContextExports(moduleId: OnboardingModuleId): OnboardingAgentContextExport[] {
  const shared: OnboardingAgentContextExport[] = [
    {
      moduleId,
      path: `${ENTITY_CONTEXT_ROOT}/installed.json`,
      kind: 'state',
      format: 'json',
      description: 'Selection lockfile for onboarding-managed modules.',
    },
  ];
  if (moduleId === 'entity-agent-contracts') {
    return [
      ...shared,
      {
        moduleId,
        path: `${ENTITY_CONTEXT_ROOT}/contracts/entity-agent-contracts.json`,
        kind: 'contract',
        format: 'json',
        description: 'Required Entity operating contract export.',
      },
    ];
  }
  return [
    ...shared,
    {
      moduleId,
      path: `${ENTITY_CONTEXT_ROOT}/snippets/${moduleId}.md`,
      kind: 'snippet',
      format: 'markdown',
      description: `${moduleId} snippet used for composable agent context.`,
    },
  ];
}

function toStep(moduleId: string, prefix: string, step: Omit<OnboardingOperationStep, 'id'>, index: number): OnboardingOperationStep {
  return {
    id: `${moduleId}:${prefix}:${index + 1}`,
    ...step,
  };
}

function toSkillRefs(seed: OnboardingModuleSeed, dbRefs: ModuleSkillRefRecord[], options: BuildModuleOptions): OnboardingModuleSkillRef[] {
  const refs: OnboardingModuleSkillRef[] = dbRefs.map((ref) => ({
    id: ref.id,
    label: ref.label,
    kind: ref.kind,
    ref: ref.ref,
    required: ref.required,
    notes: ref.notes,
  }));
  if (refs.length === 0 && seed.docsUrl) {
    refs.push({
      id: `${seed.id}-docs`,
      label: `${seed.name} docs`,
      kind: 'doc',
      ref: seed.docsUrl,
      required: seed.required,
      notes: 'Seeded onboarding reference used when the admin registry has not been initialized yet.',
    });
  }
  if (seed.id === 'entity-mc') {
    const prefix = options.token ? `/api/onboarding/agent-session/${encodeURIComponent(options.token)}` : '/api/onboarding/agent-session/<token>';
    refs.push(
      {
        id: 'entity-mc-skill-url',
        label: 'Entity MC skill',
        kind: 'skill',
        ref: `${prefix}/skill`,
        required: true,
        notes: 'Setup-safe skill URL exposed by the onboarding session manifest.',
      },
      {
        id: 'entity-mc-bundle-url',
        label: 'Entity MC bundle',
        kind: 'bundle',
        ref: `${prefix}/bundle`,
        required: true,
        notes: 'Legacy-compatible bundle download route for setup agents.',
      },
    );
  }
  const deduped = new Map<string, OnboardingModuleSkillRef>();
  for (const ref of refs) deduped.set(ref.id, ref);
  return Array.from(deduped.values());
}

export function buildOnboardingModuleRegistry(
  registryRows: ModuleRegistryRecord[],
  registrySkillRefs: ModuleSkillRefRecord[],
  options: BuildModuleOptions,
): OnboardingModuleSummary[] {
  const rowsById = new Map<string, ModuleRegistryRecord>(registryRows.map((row) => [row.id, row]));
  const skillRefsByModuleId = new Map<string, ModuleSkillRefRecord[]>();
  for (const ref of registrySkillRefs) {
    const list = skillRefsByModuleId.get(ref.module_id) ?? [];
    list.push(ref);
    skillRefsByModuleId.set(ref.module_id, list);
  }

  return SEEDED_MODULES.map((seed) => {
    const row = rowsById.get(seed.id);
    const uiConfig = readUiConfig(row);
    const labelFromConfig = typeof uiConfig.label === 'string' ? uiConfig.label : undefined;
    const entrypoints = { ...seed.entrypoints };
    if (seed.id === 'entity-mc') {
      const sessionPrefix = options.token ? `/api/onboarding/agent-session/${encodeURIComponent(options.token)}` : '/api/onboarding/agent-session/<token>';
      entrypoints.skillUrl = `${sessionPrefix}/skill`;
      entrypoints.bundleUrl = `${sessionPrefix}/bundle`;
      entrypoints.progressUrl = `${sessionPrefix}/progress`;
    }
    return {
      id: seed.id,
      name: row?.name ?? seed.name,
      description: row?.description ?? seed.description,
      version: options.entityVersion,
      kind: seed.kind,
      host: seed.kind === 'plugin' ? 'plugin-host' : 'entity',
      entityVersion: options.entityVersion,
      category: seed.category,
      required: seed.required,
      recommended: seed.recommended,
      defaultMode: seed.defaultMode,
      riskLevel: seed.riskLevel,
      capabilities: [...seed.capabilities],
      requires: [...seed.requires],
      conflictsWith: [...seed.conflictsWith],
      docsUrl: seed.docsUrl,
      availableInOnboarding: seed.availableInOnboarding,
      approvedForOnboarding: seed.approvedForOnboarding,
      installFootprint: [...seed.installFootprint],
      skillRefs: toSkillRefs(seed, skillRefsByModuleId.get(seed.id) ?? [], options),
      entrypoints,
      installSteps: seed.installSteps.map((step, index) => toStep(seed.id, 'install', step, index)),
      verifySteps: seed.verifySteps.map((step, index) => toStep(seed.id, 'verify', step, index)),
      uninstallSteps: seed.uninstallSteps.map((step, index) => toStep(seed.id, 'uninstall', step, index)),
      rollbackSteps: seed.rollbackSteps.map((step, index) => toStep(seed.id, 'rollback', step, index)),
      agentContextSnippet: seed.agentContextSnippet,
      agentContextExports: moduleContextExports(seed.id),
      runtime: seed.runtime,
      verificationRequired: seed.verificationRequired,
      installRank: seed.installRank,
      enabled: row?.enabled ?? true,
      selectable: seed.availableInOnboarding && (row?.enabled ?? true),
      locked: seed.required,
      source: row ? 'registry' : 'seeded',
      installOrder: seed.installRank,
      uiLabel: labelFromConfig ?? seed.uiLabel,
    };
  });
}

export function buildOnboardingModulesResponse(
  registryRows: ModuleRegistryRecord[],
  registrySkillRefs: ModuleSkillRefRecord[],
  options: BuildModuleOptions,
): OnboardingModulesResponse {
  const modules = buildOnboardingModuleRegistry(registryRows, registrySkillRefs, options);
  const groups: Record<OnboardingModuleCategory, OnboardingModuleSummary[]> = {
    required: [],
    recommended: [],
    optional: [],
    'third-party': [],
  };
  for (const module of modules.filter((entry) => entry.selectable)) {
    groups[module.category].push(module);
  }

  const warnings: string[] = [];
  const entityMc = modules.find((entry) => entry.id === 'entity-mc');
  if (!entityMc) {
    warnings.push('Entity MC is missing from the seeded onboarding registry.');
  } else if (!fs.existsSync(options.entityMcBundlePath)) {
    warnings.push('Entity MC bundle is not readable from the current host. Default setup will keep the module selected but verification will warn.');
  }

  return {
    version: 1,
    defaultBundle: DEFAULT_ONBOARDING_BUNDLE,
    defaultModules: [...DEFAULT_ONBOARDING_MODULE_IDS],
    bundles: ONBOARDING_BUNDLE_IDS.map((id) => ({
      id,
      name: BUNDLE_LABELS[id].name,
      description: BUNDLE_LABELS[id].description,
      moduleIds: id === 'custom' ? [...DEFAULT_ONBOARDING_MODULE_IDS] : bundleModuleIds(id),
    })),
    modules: modules.filter((entry) => entry.selectable),
    groups,
    warnings,
  };
}

export function buildOnboardingReadiness(
  registryRows: ModuleRegistryRecord[],
  registrySkillRefs: ModuleSkillRefRecord[],
  options: BuildModuleOptions & {
    publicUrl: string;
    openClawDetected: boolean;
    fileSourcesAvailable: boolean;
    pluginHostAvailable: boolean;
  },
): OnboardingReadiness {
  const modules = buildOnboardingModuleRegistry(registryRows, registrySkillRefs, options);
  const adminOnly = modules
    .filter((module) => !module.availableInOnboarding || module.riskLevel === 'admin')
    .map((module) => ({
      id: module.id,
      reason: 'Configure later in Admin or Entity Doctor.',
    }));

  const warnings: string[] = [];
  if (!options.fileSourcesAvailable) {
    warnings.push('No file source is configured yet; Entity FS will remain selected but needs a source before docs links are useful.');
  }
  if (!fs.existsSync(options.entityMcBundlePath)) {
    warnings.push('Entity MC bundle path is missing on this host.');
  }
  if (!options.pluginHostAvailable) {
    warnings.push('Plugin host settings are not configured yet. Optional runtime modules remain Admin-only.');
  }

  return {
    version: 1,
    entityVersion: options.entityVersion,
    publicUrl: options.publicUrl,
    openClawDetected: options.openClawDetected,
    fileSourcesAvailable: options.fileSourcesAvailable,
    missionControlReachable: fs.existsSync(options.entityMcBundlePath),
    pluginHostAvailable: options.pluginHostAvailable,
    installedRegistry: {
      total: Math.max(registryRows.length, modules.length),
      onboarding: modules.length,
      selectable: modules.filter((module) => module.selectable).length,
    },
    warnings,
    adminOnly,
  };
}

export function resolveOnboardingSelection(
  registryRows: ModuleRegistryRecord[],
  registrySkillRefs: ModuleSkillRefRecord[],
  options: ResolveSelectionOptions,
): OnboardingSelectionResolution {
  const bundle = normalizeBundle(options.selectedBundle);
  const selectedModuleConfig = options.selectedModuleConfig ?? {};
  const requestedCustom = uniqueStrings(options.selectedModules ?? []);
  const modules = buildOnboardingModuleRegistry(registryRows, registrySkillRefs, options);
  const modulesById = new Map(modules.map((module) => [module.id, module]));
  const requestedModules = bundle === 'custom'
    ? (requestedCustom.length ? requestedCustom : [...DEFAULT_ONBOARDING_MODULE_IDS])
    : bundleModuleIds(bundle);

  const unknownIds = requestedModules.filter((id) => !modulesById.has(id as OnboardingModuleId));
  if (unknownIds.length > 0) {
    throw new OnboardingSelectionError(400, `Unknown onboarding module selection: ${unknownIds.join(', ')}`, {
      unknownIds,
    });
  }

  const skipped: OnboardingSelectionWarning[] = [];
  const adminOnly: OnboardingSelectionWarning[] = [];
  const warnings: string[] = [];
  const initialSelected = new Set<string>();
  for (const moduleId of requestedModules) {
    const module = modulesById.get(moduleId as OnboardingModuleId);
    if (!module) continue;
    if (!module.selectable && !module.required) {
      const reason = module.riskLevel === 'admin'
        ? 'Admin-only module is not selectable during first-run onboarding.'
        : 'Module is not selectable in the current onboarding context.';
      adminOnly.push({ id: module.id, reason });
      skipped.push({ id: module.id, reason });
      warnings.push(`${module.name} was skipped: ${reason}`);
      continue;
    }
    initialSelected.add(module.id);
  }
  for (const module of modules.filter((entry) => entry.required)) {
    initialSelected.add(module.id);
  }

  const resolvedIds = new Set<string>(initialSelected);
  const queue = Array.from(initialSelected);
  while (queue.length > 0) {
    const currentId = queue.shift() as string;
    const current = modulesById.get(currentId as OnboardingModuleId);
    if (!current) continue;
    for (const requiredId of current.requires) {
      const dependency = modulesById.get(requiredId as OnboardingModuleId);
      if (!dependency) {
        throw new OnboardingSelectionError(409, `Missing dependency ${requiredId} required by ${current.id}`, {
          moduleId: current.id,
          missingDependency: requiredId,
        });
      }
      if (!dependency.selectable && !dependency.required) {
        throw new OnboardingSelectionError(409, `${current.id} requires Admin-only dependency ${requiredId}`, {
          moduleId: current.id,
          missingDependency: requiredId,
        });
      }
      if (!resolvedIds.has(requiredId)) {
        resolvedIds.add(requiredId);
        queue.push(requiredId);
      }
    }
  }

  const selectedModules = Array.from(resolvedIds)
    .map((id) => modulesById.get(id as OnboardingModuleId))
    .filter((module): module is OnboardingModuleSummary => Boolean(module))
    .sort((left, right) => left.installOrder - right.installOrder || left.id.localeCompare(right.id));

  for (const module of selectedModules) {
    for (const conflictId of module.conflictsWith) {
      if (resolvedIds.has(conflictId)) {
        throw new OnboardingSelectionError(409, `Selection conflict: ${module.id} conflicts with ${conflictId}`, {
          moduleId: module.id,
          conflictId,
        });
      }
    }
  }

  const docsFailures = selectedModules.filter((module) => module.runtime && !module.docsUrl.trim());
  const verifierFailures = selectedModules.filter((module) => module.verificationRequired && module.verifySteps.length === 0);
  const requiredDocsFailures = docsFailures.filter((module) => module.required);
  const requiredVerifierFailures = verifierFailures.filter((module) => module.required);

  const gates: OnboardingGateResult[] = [
    {
      id: 'manifest',
      label: 'Manifest gate',
      status: 'pass',
      detail: 'Seeded onboarding module metadata is present for the requested selection.',
    },
    {
      id: 'dependency',
      label: 'Dependency gate',
      status: 'pass',
      detail: 'All required dependencies are satisfied and no conflicts were detected.',
    },
    {
      id: 'docs',
      label: 'Docs gate',
      status: requiredDocsFailures.length > 0 ? 'fail' : docsFailures.length > 0 ? 'warn' : 'pass',
      detail: docsFailures.length > 0
        ? `Docs metadata is missing for: ${docsFailures.map((module) => module.id).join(', ')}`
        : 'Each selected runtime module has a docs reference.',
    },
    {
      id: 'filesystem',
      label: 'Filesystem gate',
      status: fs.existsSync(options.entityMcBundlePath) ? 'pass' : 'warn',
      detail: fs.existsSync(options.entityMcBundlePath)
        ? 'Managed bundle and context export paths are discoverable from the current host.'
        : 'Entity MC bundle path is not readable on this host; default setup keeps the selection but verification will warn.',
    },
    {
      id: 'snippet',
      label: 'Snippet gate',
      status: selectedModules.every((module) => module.agentContextExports.length > 0) ? 'pass' : 'fail',
      detail: selectedModules.every((module) => module.agentContextExports.length > 0)
        ? 'Each selected module exports isolated agent-context entries.'
        : 'One or more selected modules are missing agent-context export metadata.',
    },
    {
      id: 'install',
      label: 'Install gate',
      status: selectedModules.every((module) => module.installSteps.length > 0) ? 'pass' : 'warn',
      detail: selectedModules.every((module) => module.installSteps.length > 0)
        ? 'Install metadata is present for every selected module.'
        : 'Some selected modules are metadata-only and do not require install writes.',
    },
    {
      id: 'verifier',
      label: 'Verifier gate',
      status: requiredVerifierFailures.length > 0 ? 'fail' : verifierFailures.length > 0 ? 'warn' : 'pass',
      detail: verifierFailures.length > 0
        ? `Verification metadata is missing for: ${verifierFailures.map((module) => module.id).join(', ')}`
        : 'Verification steps are present for each selected module that requires them.',
    },
    {
      id: 'agent-context',
      label: 'Agent-context gate',
      status: 'pass',
      detail: 'Context exports are module-scoped and composable.',
    },
    {
      id: 'rollback',
      label: 'Rollback gate',
      status: selectedModules.every((module) => module.rollbackSteps.length > 0) ? 'pass' : 'warn',
      detail: selectedModules.every((module) => module.rollbackSteps.length > 0)
        ? 'Rollback metadata exists before mutation.'
        : 'Some selected modules do not expose rollback metadata and remain Admin-only or metadata-only.',
    },
    {
      id: 'report',
      label: 'Report gate',
      status: 'pass',
      detail: 'Progress checklist entries are generated from the resolved module graph.',
    },
  ];

  if (!fs.existsSync(options.entityMcBundlePath) && selectedModules.some((module) => module.id === 'entity-mc')) {
    warnings.push('Entity MC bundle path is not readable on this host. Setup may continue, but Entity MC verification will warn until the bundle is available.');
  }
  if (adminOnly.length > 0) {
    warnings.push('Some requested modules were deferred to Admin because they are not onboarding-safe.');
  }

  const dryRunContextExports = uniqueByPath(selectedModules.flatMap((module) => module.agentContextExports));
  const dryRun: OnboardingDryRunPlan = {
    mode: bundle,
    writes: dryRunContextExports.map((entry) => ({
      path: entry.path,
      reason: entry.description,
      moduleId: entry.moduleId,
    })),
    downloads: selectedModules.flatMap((module) => module.skillRefs
      .filter((ref) => ref.kind === 'bundle' || ref.kind === 'skill')
      .map((ref) => ({
        ref: ref.ref,
        label: ref.label,
        moduleId: module.id,
      }))),
    installSteps: selectedModules.flatMap((module) => module.installSteps.map((step) => ({ ...step, moduleId: module.id }))),
    verifySteps: selectedModules.flatMap((module) => module.verifySteps.map((step) => ({ ...step, moduleId: module.id }))),
    rollbackSteps: selectedModules.flatMap((module) => module.rollbackSteps.map((step) => ({ ...step, moduleId: module.id }))),
    contextExports: dryRunContextExports,
  };

  const checklist = buildChecklist(selectedModules);
  const installOrder = selectedModules.map((module) => module.id);
  const normalizedBundle = inferBundle(installOrder);
  const failedGates = gates.filter((gate) => gate.status === 'fail');
  const status = failedGates.length > 0 ? 'blocked' : warnings.length > 0 || gates.some((gate) => gate.status === 'warn') ? 'warning' : 'ready';

  return {
    requestedBundle: bundle,
    normalizedBundle,
    requestedModules,
    selectedModules: installOrder,
    selectedModuleConfig,
    modules: selectedModules,
    installOrder,
    warnings,
    skipped,
    adminOnly,
    gates,
    dryRun,
    checklist,
    safeStopConditions: buildSafeStopConditions(selectedModules, gates),
    canApply: failedGates.length === 0,
    status,
  };
}

function uniqueByPath(entries: OnboardingAgentContextExport[]): OnboardingAgentContextExport[] {
  const seen = new Set<string>();
  const list: OnboardingAgentContextExport[] = [];
  for (const entry of entries) {
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    list.push(entry);
  }
  return list;
}

function buildChecklist(modules: OnboardingModuleSummary[]): OnboardingChecklistItem[] {
  const checklist: OnboardingChecklistItem[] = [
    { id: 'session', label: 'Setup session created', status: 'done' },
    { id: 'opened', label: 'Agent opened link', status: 'pending' },
  ];
  for (const module of modules) {
    if (module.id === 'entity-mc') {
      checklist.push({
        id: 'skill',
        label: 'Entity MC skill installed',
        moduleId: module.id,
        status: 'pending',
      });
      continue;
    }
    checklist.push({
      id: `module:${module.id}`,
      label: `${module.name} configured`,
      moduleId: module.id,
      status: 'pending',
    });
  }
  checklist.push(
    { id: 'workspace', label: 'Workspace configured', status: 'pending' },
    { id: 'source', label: 'Source tested', status: 'pending' },
    { id: 'verified', label: 'Ready to enter workspace', status: 'pending' },
  );
  return checklist;
}

function buildSafeStopConditions(modules: OnboardingModuleSummary[], gates: OnboardingGateResult[]): string[] {
  const moduleSummary = modules.map((module) => module.name).join(', ');
  const failIds = gates.filter((gate) => gate.status === 'fail').map((gate) => gate.id);
  const stopConditions = [
    `Stop if any required validation gate fails${failIds.length ? ` (${failIds.join(', ')})` : ''}.`,
    `Stop before configuring any Admin-only module that is not present in modules[].`,
    `Stop if a required verify step fails for ${modules.filter((module) => module.required || module.verificationRequired).map((module) => module.name).join(', ') || 'the selected modules'}.`,
    `Stop if the resolved module graph changes unexpectedly after reading the manifest (${moduleSummary || 'no modules selected'}).`,
  ];
  return stopConditions;
}

export function collectOnboardingRegistrySkillRefs(
  listSkillRefs: (moduleId: string) => ModuleSkillRefRecord[],
): ModuleSkillRefRecord[] {
  return SEEDED_MODULES.flatMap((module) => listSkillRefs(module.id));
}

export function buildAgentContextPlan(resolution: OnboardingSelectionResolution) {
  return {
    root: ENTITY_CONTEXT_ROOT,
    installedStatePath: `${ENTITY_CONTEXT_ROOT}/installed.json`,
    exports: resolution.dryRun.contextExports,
  };
}

export function buildCompatibilityEntityMcUrls(token: string) {
  const encoded = encodeURIComponent(token);
  return {
    skillUrl: `/api/onboarding/agent-session/${encoded}/skill`,
    bundleUrl: `/api/onboarding/agent-session/${encoded}/bundle`,
    progressUrl: `/api/onboarding/agent-session/${encoded}/progress`,
  };
}

export function readEntityVersion(cwd: string): string {
  const candidates = [
    path.join(cwd, 'packages/server/package.json'),
    path.join(cwd, 'package.json'),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as { version?: string };
      if (typeof parsed.version === 'string' && parsed.version.trim()) return parsed.version.trim();
    } catch {
      continue;
    }
  }
  return '0.0.1';
}
