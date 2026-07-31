import type express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { ModuleRegistryRecord, ModuleSkillRefRecord } from '../../../db/src';
import { getEntityDatabase } from '../../../db/src/entity-db';
import { getInviteControls } from '../agent/invite-kit/controls';
import {
  buildAgentContextPlan,
  buildCompatibilityEntityMcUrls,
  buildOnboardingModulesResponse,
  buildOnboardingReadiness,
  collectOnboardingRegistrySkillRefs,
  type OnboardingChecklistItem,
  type OnboardingSelectionInput,
  type OnboardingSelectionResolution,
  OnboardingSelectionError,
  readEntityVersion,
  resolveOnboardingSelection,
} from './onboarding-modules';
import { buildEffectiveConfig, deepMerge } from './effective';
import { EntityConfigSchema, OnboardingAgentSessionSchema, OnboardingStateSchema, type OnboardingAgentSession } from './schema';
import { ensureAppSettingsTable, getSettingJson, setSettingJson } from './settings-store';

const ONBOARDING_STATE_KEY = 'onboarding.state';
const ONBOARDING_AGENT_SESSION_PREFIX = 'onboarding.agentSession.';
const AGENT_SESSION_TTL_MS = 30 * 60 * 1000;
const ENTITY_MC_BUNDLE_PATH = process.env.ENTITY_MC_SKILL_PATH
  ? path.resolve(process.env.ENTITY_MC_SKILL_PATH)
  : fs.existsSync(path.resolve(process.cwd(), 'skills/entity-mc'))
    ? path.resolve(process.cwd(), 'skills/entity-mc')
    : path.join(process.env.HOME || require('os').homedir(), '.hermes', 'skills', 'entity-mc');
const ENTITY_MC_ALLOWED_FILES = [
  'SKILL.md',
  'VERSION',
  'install.sh',
  'verify.sh',
  'rollback.sh',
  'lib.sh',
  'source-scripts/mc.sh',
  'source-scripts/mc-auto-pull.sh',
  'source-scripts/mc-assign-model.sh',
  'source-scripts/mc-build-context.sh',
  'source-scripts/mc-health-check.sh',
  'source-scripts/mc-stall-check.sh',
  'manifests/example.env',
];
const ONBOARDING_MODULE_REGISTRY_SEED = [
  ['entity-agent-contracts', 'entity-agent-contracts', 'Entity Agent Contracts', 'Required operating contract for Entity-aware onboarding agents.', 1, '📜', 'contract', '["read","validate"]', '{"label":"Required contract"}'],
  ['entity-fs', 'entity-fs', 'Entity FS', 'Entity-backed file source and docs-link delivery behavior for setup agents.', 1, '📁', 'module', '["read","search","export"]', '{"label":"Required docs/file layer"}'],
  ['entity-mc', 'entity-mc', 'Entity MC', 'Mission Control helper bundle for setup-safe progress reporting and verification.', 1, '📋', 'module', '["read","configure","verify"]', '{"label":"Recommended task helper"}'],
  ['entity-linker', 'entity-linker', 'Entity Linker', 'Docs-link delivery integration for shared artifacts during onboarding.', 1, '🔗', 'plugin', '["read","rewrite","verify"]', '{"label":"Recommended docs linker"}'],
  ['entity-discord-title-hook', 'entity-discord-title-hook', 'Discord Title Hook', 'Admin-managed Discord channel title sync integration.', 1, '#️⃣', 'plugin', '["read","configure"]', '{"label":"Admin only"}'],
  ['entity-services', 'entity-services', 'Entity Services', 'Admin-managed service/runtime integrations.', 1, '🛠️', 'plugin', '["read","configure","admin"]', '{"label":"Admin only"}'],
  ['geordi-swarm', 'geordi-swarm', 'Geordi Swarm', 'Future multi-agent swarm orchestration on top of Entity helper modules.', 1, '🐝', 'plugin', '["read","dispatch","admin"]', '{"label":"Future swarm module"}'],
] as const;
const ONBOARDING_MODULE_SKILL_REF_SEED = [
  ['entity-agent-contracts-doc', 'entity-agent-contracts', 'Entity contract spec', 'doc', 'docs/pluggable-agents-modules-spec.md', 1, 'Required onboarding contract reference'],
  ['entity-fs-doc', 'entity-fs', 'Entity FS onboarding spec', 'doc', 'docs/pluggable-agents-modules-spec.md', 1, 'Docs/file delivery reference'],
  ['entity-mc-skill', 'entity-mc', 'Entity MC skill bundle', 'skill', 'skills/entity-mc/', 1, 'Setup-safe Mission Control helper bundle'],
  ['entity-linker-doc', 'entity-linker', 'Plugin architecture spec', 'doc', 'docs/PLUGIN-ARCHITECTURE-SPEC.md', 0, 'Docs-link integration contract'],
  ['entity-discord-title-hook-doc', 'entity-discord-title-hook', 'Plugin architecture spec', 'doc', 'docs/PLUGIN-ARCHITECTURE-SPEC.md', 0, 'Admin-only Discord integration reference'],
  ['entity-services-doc', 'entity-services', 'Plugin architecture spec', 'doc', 'docs/PLUGIN-ARCHITECTURE-SPEC.md', 0, 'Admin-only service integration reference'],
  ['geordi-swarm-doc', 'geordi-swarm', 'Geordi Swarm manifest example', 'doc', 'docs/ENTITY-PLUGIN-MANIFEST.example.json', 0, 'Future swarm packaging reference'],
] as const;

function nowIso(): string {
  return new Date().toISOString();
}

function readOnboardingState(db: ReturnType<typeof getEntityDatabase>) {
  return OnboardingStateSchema.parse(getSettingJson(db, ONBOARDING_STATE_KEY) ?? {});
}

function parseOnboardingPatch(body: unknown) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const parsed = OnboardingStateSchema.partial().parse(input);
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(input)) {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      patch[key] = parsed[key as keyof typeof parsed];
    }
  }
  return patch;
}

function readAgentSession(db: ReturnType<typeof getEntityDatabase>, token: string): OnboardingAgentSession | null {
  const stored = getSettingJson(db, `${ONBOARDING_AGENT_SESSION_PREFIX}${token}`);
  if (!stored) return null;
  const parsed = OnboardingAgentSessionSchema.parse(stored);
  if (new Date(parsed.expiresAt).getTime() < Date.now() && parsed.status !== 'expired') {
    const expired = { ...parsed, status: 'expired' as const };
    setSettingJson(db, `${ONBOARDING_AGENT_SESSION_PREFIX}${token}`, expired, 'onboarding');
    return expired;
  }
  return parsed;
}

/**
 * Whether an onboarding agent session is expired. These endpoints bypass the
 * global API bearer (they self-authenticate via the path token), so they must
 * reject expired links to avoid leaving stale setup tokens usable.
 */
function isExpiredAgentSession(session: OnboardingAgentSession): boolean {
  return session.status === 'expired' || new Date(session.expiresAt).getTime() < Date.now();
}

/**
 * Durable invite gate (WP2-A-05). When a token maps to agent_invites, enforce
 * revoke / expiry / rotation before legacy session handling. Legacy first-run
 * sessions without a durable row continue unchanged.
 */
function assertTokenizedInviteAccess(
  res: express.Response,
  rawToken: string,
  options: { markOpened?: boolean } = {},
): boolean {
  const access = getInviteControls().resolveTokenizedInviteAccess(rawToken);
  if (access.kind === 'denied') {
    res.status(access.statusCode).json({
      error: access.error,
      code: access.code,
    });
    return false;
  }
  if (access.kind === 'allowed' && options.markOpened) {
    getInviteControls().markOpenedFromToken(rawToken);
  }
  return true;
}

function ensureOnboardingRegistrySeed(db: ReturnType<typeof getEntityDatabase>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_modules (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      icon TEXT,
      kind TEXT NOT NULL DEFAULT 'core',
      permissions_schema_json TEXT NOT NULL DEFAULT '[]',
      ui_config_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS entity_module_skill_refs (
      id TEXT PRIMARY KEY,
      module_id TEXT NOT NULL,
      label TEXT NOT NULL,
      kind TEXT NOT NULL,
      ref TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 0,
      notes TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_entity_modules_slug ON entity_modules(slug);
    CREATE INDEX IF NOT EXISTS idx_entity_skill_refs_module ON entity_module_skill_refs(module_id);
  `);

  const insertModule = db.prepare(`
    INSERT OR IGNORE INTO entity_modules (
      id, slug, name, description, enabled, icon, kind, permissions_schema_json, ui_config_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of ONBOARDING_MODULE_REGISTRY_SEED) {
    insertModule.run(...row);
  }

  const insertSkillRef = db.prepare(`
    INSERT OR IGNORE INTO entity_module_skill_refs (
      id, module_id, label, kind, ref, required, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of ONBOARDING_MODULE_SKILL_REF_SEED) {
    insertSkillRef.run(...row);
  }
}


function tableExists(db: ReturnType<typeof getEntityDatabase>, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name?: string } | undefined;
  return row?.name === tableName;
}

function listRegistryModules(db: ReturnType<typeof getEntityDatabase>): ModuleRegistryRecord[] {
  if (!tableExists(db, 'entity_modules')) return [];
  return (db.prepare('SELECT * FROM entity_modules ORDER BY name COLLATE NOCASE ASC').all() as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id ?? ''),
    slug: String(row.slug ?? ''),
    name: String(row.name ?? ''),
    description: typeof row.description === 'string' ? row.description : null,
    enabled: Number(row.enabled ?? 0) === 1,
    icon: typeof row.icon === 'string' ? row.icon : null,
    kind: String(row.kind ?? 'core'),
    permissions_schema_json: typeof row.permissions_schema_json === 'string' ? row.permissions_schema_json : '[]',
    ui_config_json: typeof row.ui_config_json === 'string' ? row.ui_config_json : '{}',
    created_at: typeof row.created_at === 'string' ? row.created_at : '',
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : '',
  }));
}

function listRegistrySkillRefs(db: ReturnType<typeof getEntityDatabase>, moduleId: string): ModuleSkillRefRecord[] {
  if (!tableExists(db, 'entity_module_skill_refs')) return [];
  const rows = db.prepare(
    'SELECT * FROM entity_module_skill_refs WHERE module_id = ? ORDER BY required DESC, label COLLATE NOCASE ASC',
  ).all(moduleId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id ?? ''),
    module_id: String(row.module_id ?? moduleId),
    label: String(row.label ?? ''),
    kind: String(row.kind ?? ''),
    ref: String(row.ref ?? ''),
    required: Number(row.required ?? 0) === 1,
    notes: typeof row.notes === 'string' ? row.notes : null,
  }));
}

function parseOnboardingSelectionInput(body: unknown): OnboardingSelectionInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const input = body as Record<string, unknown>;
  const selection: OnboardingSelectionInput = {};

  if ('selectedBundle' in input) {
    if (input.selectedBundle !== null && typeof input.selectedBundle !== 'string') {
      throw new Error('selectedBundle must be a string or null');
    }
    selection.selectedBundle = (input.selectedBundle as string | null) ?? null;
  }

  if ('selectedModules' in input) {
    if (input.selectedModules !== null && !Array.isArray(input.selectedModules)) {
      throw new Error('selectedModules must be an array or null');
    }
    if (Array.isArray(input.selectedModules) && input.selectedModules.some((entry) => typeof entry !== 'string')) {
      throw new Error('selectedModules must contain only strings');
    }
    selection.selectedModules = (input.selectedModules as string[] | null) ?? null;
  }

  if ('selectedModuleConfig' in input) {
    if (
      input.selectedModuleConfig !== null
      && (typeof input.selectedModuleConfig !== 'object' || Array.isArray(input.selectedModuleConfig))
    ) {
      throw new Error('selectedModuleConfig must be an object or null');
    }
    selection.selectedModuleConfig = (input.selectedModuleConfig as Record<string, unknown> | null) ?? null;
  }

  return selection;
}

function selectionInputFromState(state: ReturnType<typeof readOnboardingState>): OnboardingSelectionInput {
  return {
    selectedBundle: state.selectedBundle,
    selectedModules: state.selectedModules,
    selectedModuleConfig: state.selectedModuleConfig,
  };
}

function mergeSelectionInput(
  current: ReturnType<typeof readOnboardingState>,
  input: OnboardingSelectionInput,
): OnboardingSelectionInput {
  return {
    selectedBundle: input.selectedBundle === undefined ? current.selectedBundle : input.selectedBundle,
    selectedModules: input.selectedModules === undefined ? current.selectedModules : input.selectedModules,
    selectedModuleConfig: input.selectedModuleConfig === undefined ? current.selectedModuleConfig : input.selectedModuleConfig,
  };
}

function getOnboardingRuntime(db: ReturnType<typeof getEntityDatabase>, token?: string) {
  ensureOnboardingRegistrySeed(db);
  const effective = buildEffectiveConfig({ db, cwd: process.cwd() });
  const settings = EntityConfigSchema.parse(effective.settings ?? {});
  const registryRows = listRegistryModules(db);
  const registrySkillRefs = collectOnboardingRegistrySkillRefs((moduleId) => listRegistrySkillRefs(db, moduleId));
  const fileSources = settings.fileSources;
  const services = settings.services;
  const providers = settings.providers;
  const plugins = settings.plugins;
  const entityVersion = readEntityVersion(process.cwd());
  const publicUrl = settings.server.publicBaseUrl || settings.server.apiBaseUrl || 'http://localhost:3000';
  const openClawDetected = Boolean(process.env.OPENCLAW?.trim())
    || services.some((service) => /openclaw/i.test(String(service.id ?? '')) || /openclaw/i.test(String(service.name ?? '')));
  const fileSourcesAvailable = fileSources.some((source) => source.enabled !== false);
  const pluginHostAvailable = Object.keys(plugins).length > 0 || Object.keys(providers).length > 0;

  return {
    effective,
    registryRows,
    registrySkillRefs,
    buildOptions: {
      entityVersion,
      entityMcBundlePath: ENTITY_MC_BUNDLE_PATH,
      token,
      publicBaseUrl: publicUrl,
    },
    readinessOptions: {
      publicUrl,
      openClawDetected,
      fileSourcesAvailable,
      pluginHostAvailable,
    },
  };
}

function resolveSelectionForState(
  db: ReturnType<typeof getEntityDatabase>,
  state: ReturnType<typeof readOnboardingState>,
  token?: string,
): OnboardingSelectionResolution {
  const runtime = getOnboardingRuntime(db, token);
  return resolveOnboardingSelection(runtime.registryRows, runtime.registrySkillRefs, {
    ...runtime.buildOptions,
    ...selectionInputFromState(state),
  });
}

function buildDefaultProgress(checklist: OnboardingChecklistItem[]) {
  const createdAt = nowIso();
  return checklist.map((item) => ({
    ...item,
    updatedAt: createdAt,
  }));
}

function mergeChecklistProgress(
  checklist: OnboardingChecklistItem[],
  progress: OnboardingAgentSession['progress'],
): OnboardingAgentSession['progress'] {
  const now = nowIso();
  const byId = new Map(progress.map((item) => [item.id, item]));
  return checklist.map((item) => {
    const existing = byId.get(item.id);
    return {
      ...item,
      status: existing?.status ?? item.status,
      message: existing?.message,
      updatedAt: existing?.updatedAt ?? now,
    };
  });
}

function hasProgressShapeChanged(
  current: OnboardingAgentSession['progress'],
  next: OnboardingAgentSession['progress'],
): boolean {
  if (current.length !== next.length) return true;
  return next.some((item, index) => {
    const previous = current[index];
    return !previous || previous.id !== item.id || previous.label !== item.label || previous.moduleId !== item.moduleId;
  });
}

function buildAgentManifest(session: OnboardingAgentSession, resolution: OnboardingSelectionResolution) {
  const entityMc = buildCompatibilityEntityMcUrls(session.token);
  const moduleSkillRefs = resolution.modules.flatMap((module) =>
    module.skillRefs.map((ref) => ({
      moduleId: module.id,
      ...ref,
    })),
  );
  return {
    version: 2,
    token: session.token,
    status: session.status,
    expiresAt: session.expiresAt,
    setupOnly: true,
    onboarding: session.state,
    entityMc: {
      name: 'entity-mc',
      moduleId: 'entity-mc',
      selected: resolution.selectedModules.includes('entity-mc'),
      ...entityMc,
      install: 'Run install.sh from the entity-mc bundle with --entity-url and --token, then run verify.sh.',
      verify: 'verify.sh must print VERIFY_OK before setup is marked complete.',
    },
    checklist: session.progress,
    generatedChecklist: resolution.checklist,
    bundle: {
      requested: resolution.requestedBundle,
      resolved: resolution.normalizedBundle,
    },
    modules: resolution.modules,
    moduleSkillRefs,
    installOrder: resolution.installOrder,
    warnings: resolution.warnings,
    skipped: resolution.skipped,
    adminOnly: resolution.adminOnly,
    gates: resolution.gates,
    canApply: resolution.canApply,
    resolutionStatus: resolution.status,
    safeStopConditions: resolution.safeStopConditions,
    dryRun: resolution.dryRun,
    context: buildAgentContextPlan(resolution),
    instructions: [
      'Open the setup URL in Entity.',
      'Read this manifest before making changes.',
      `Install modules in order: ${resolution.installOrder.join(', ') || 'none'}.`,
      'Use modules[] as the source of truth for selected capabilities and skill refs.',
      'Report progress through the progress endpoint.',
      'Leave advanced Admin setup for later unless the manifest explicitly includes it.',
    ],
  };
}

function buildOnboardingError(error: unknown, fallbackMessage: string) {
  if (error instanceof OnboardingSelectionError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: error.message,
        ...(error.payload ? { payload: error.payload } : {}),
      },
    };
  }

  return {
    statusCode: 400,
    body: {
      error: fallbackMessage,
      detail: error instanceof Error ? error.message : String(error),
    },
  };
}

export function registerConfigRoutes(app: express.Express): void {
  app.get('/api/config/effective', (_req, res) => {
    try {
      const db = getEntityDatabase(ensureAppSettingsTable);
      res.json(buildEffectiveConfig({ db, cwd: process.cwd() }));
    } catch (error) {
      res.status(500).json({
        error: 'Failed to build effective config',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.patch('/api/settings/config/runtime', (req, res) => {
    try {
      const patch = EntityConfigSchema.partial().parse(req.body ?? {});
      const db = getEntityDatabase(ensureAppSettingsTable);
      const current = (getSettingJson(db, 'config.runtime') ?? {}) as Record<string, unknown>;
      const next = deepMerge(current, patch) as Record<string, unknown>;
      setSettingJson(db, 'config.runtime', next, 'admin-ui');
      res.json(buildEffectiveConfig({ db, cwd: process.cwd() }));
    } catch (error) {
      res.status(400).json({
        error: 'Invalid runtime config patch',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/api/onboarding/state', (_req, res) => {
    try {
      const db = getEntityDatabase(ensureAppSettingsTable);
      res.json(readOnboardingState(db));
    } catch (error) {
      res.status(500).json({
        error: 'Failed to load onboarding state',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.patch('/api/onboarding/state', (req, res) => {
    try {
      const patch = parseOnboardingPatch(req.body);
      const db = getEntityDatabase(ensureAppSettingsTable);
      const current = readOnboardingState(db);
      const next = OnboardingStateSchema.parse({ ...current, ...patch, skipped: false });
      setSettingJson(db, ONBOARDING_STATE_KEY, next, 'onboarding-ui');
      res.json(next);
    } catch (error) {
      res.status(400).json({
        error: 'Invalid onboarding state patch',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post('/api/onboarding/complete', (req, res) => {
    try {
      const patch = parseOnboardingPatch(req.body);
      const db = getEntityDatabase(ensureAppSettingsTable);
      const current = readOnboardingState(db);
      const next = OnboardingStateSchema.parse({
        ...current,
        ...patch,
        completed: true,
        skipped: Boolean(patch.skipped),
        completedAt: nowIso(),
      });
      setSettingJson(db, ONBOARDING_STATE_KEY, next, 'onboarding-ui');
      res.json(next);
    } catch (error) {
      res.status(400).json({
        error: 'Invalid onboarding completion payload',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/api/onboarding/modules', (_req, res) => {
    try {
      const db = getEntityDatabase(ensureAppSettingsTable);
      const runtime = getOnboardingRuntime(db);
      res.json(buildOnboardingModulesResponse(runtime.registryRows, runtime.registrySkillRefs, runtime.buildOptions));
    } catch (error) {
      res.status(500).json({
        error: 'Failed to load onboarding modules',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/api/onboarding/readiness', (_req, res) => {
    try {
      const db = getEntityDatabase(ensureAppSettingsTable);
      const runtime = getOnboardingRuntime(db);
      res.json(buildOnboardingReadiness(runtime.registryRows, runtime.registrySkillRefs, {
        ...runtime.buildOptions,
        ...runtime.readinessOptions,
      }));
    } catch (error) {
      res.status(500).json({
        error: 'Failed to load onboarding readiness',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post('/api/onboarding/resolve-selection', (req, res) => {
    try {
      const db = getEntityDatabase(ensureAppSettingsTable);
      const runtime = getOnboardingRuntime(db);
      const current = readOnboardingState(db);
      const input = mergeSelectionInput(current, parseOnboardingSelectionInput(req.body));
      const resolution = resolveOnboardingSelection(runtime.registryRows, runtime.registrySkillRefs, {
        ...runtime.buildOptions,
        ...input,
      });
      res.json({
        ...resolution,
        context: buildAgentContextPlan(resolution),
      });
    } catch (error) {
      const failure = buildOnboardingError(error, 'Invalid onboarding selection payload');
      res.status(failure.statusCode).json(failure.body);
    }
  });

  app.post('/api/onboarding/dry-run', (req, res) => {
    try {
      const db = getEntityDatabase(ensureAppSettingsTable);
      const runtime = getOnboardingRuntime(db);
      const current = readOnboardingState(db);
      const input = mergeSelectionInput(current, parseOnboardingSelectionInput(req.body));
      const resolution = resolveOnboardingSelection(runtime.registryRows, runtime.registrySkillRefs, {
        ...runtime.buildOptions,
        ...input,
      });
      res.json({
        ...resolution,
        context: buildAgentContextPlan(resolution),
      });
    } catch (error) {
      const failure = buildOnboardingError(error, 'Invalid onboarding dry-run payload');
      res.status(failure.statusCode).json(failure.body);
    }
  });

  app.post('/api/onboarding/agent-session', (req, res) => {
    try {
      const db = getEntityDatabase(ensureAppSettingsTable);
      const state = OnboardingStateSchema.parse(req.body?.state ?? {});
      const createdAt = nowIso();
      const token = crypto.randomBytes(12).toString('hex');
      const runtime = getOnboardingRuntime(db, token);
      const resolution = resolveOnboardingSelection(runtime.registryRows, runtime.registrySkillRefs, {
        ...runtime.buildOptions,
        ...selectionInputFromState(state),
      });
      const normalizedState = OnboardingStateSchema.parse({
        ...state,
        mode: 'agent',
        selectedBundle: resolution.normalizedBundle,
        selectedModules: resolution.selectedModules,
        selectedModuleConfig: resolution.selectedModuleConfig,
      });
      const session = OnboardingAgentSessionSchema.parse({
        token,
        createdAt,
        expiresAt: new Date(Date.now() + AGENT_SESSION_TTL_MS).toISOString(),
        state: normalizedState,
        progress: buildDefaultProgress(resolution.checklist),
      });
      setSettingJson(db, `${ONBOARDING_AGENT_SESSION_PREFIX}${token}`, session, 'onboarding-ui');
      setSettingJson(db, ONBOARDING_STATE_KEY, normalizedState, 'onboarding-ui');
      res.status(201).json({
        token,
        setupUrl: `/onboard/agent/${token}`,
        expiresAt: session.expiresAt,
        progress: session.progress,
      });
    } catch (error) {
      const failure = buildOnboardingError(error, 'Invalid agent setup session payload');
      res.status(failure.statusCode).json(failure.body);
    }
  });

  app.get('/api/onboarding/agent-session/:token/manifest', (req, res) => {
    try {
      if (!assertTokenizedInviteAccess(res, req.params.token, { markOpened: true })) {
        return;
      }
      const db = getEntityDatabase(ensureAppSettingsTable);
      const session = readAgentSession(db, req.params.token);
      if (!session) {
        res.status(404).json({ error: 'Agent setup session not found' });
        return;
      }
      if (isExpiredAgentSession(session)) {
        res.status(401).json({ error: 'Agent setup session has expired' });
        return;
      }
      const opened = session.status === 'created' ? { ...session, status: 'opened' as const } : session;
      const resolution = resolveSelectionForState(db, opened.state, opened.token);
      const progress = mergeChecklistProgress(resolution.checklist, opened.progress);
      const next = OnboardingAgentSessionSchema.parse({
        ...opened,
        progress,
      });
      if (opened !== session || hasProgressShapeChanged(opened.progress, progress)) {
        setSettingJson(db, `${ONBOARDING_AGENT_SESSION_PREFIX}${session.token}`, next, 'onboarding-agent');
      }
      res.json(buildAgentManifest(next, resolution));
    } catch (error) {
      const failure = buildOnboardingError(error, 'Failed to load agent setup manifest');
      res.status(failure.statusCode).json(failure.body);
    }
  });

  app.patch('/api/onboarding/agent-session/:token/progress', (req, res) => {
    try {
      if (!assertTokenizedInviteAccess(res, req.params.token)) {
        return;
      }
      const db = getEntityDatabase(ensureAppSettingsTable);
      const session = readAgentSession(db, req.params.token);
      if (!session) {
        res.status(404).json({ error: 'Agent setup session not found' });
        return;
      }
      if (isExpiredAgentSession(session)) {
        res.status(401).json({ error: 'Agent setup session has expired' });
        return;
      }
      const updates = Array.isArray(req.body?.progress) ? req.body.progress : [req.body];
      const progress = session.progress.map((item) => {
        const update = updates.find((entry: { id?: unknown }) => entry?.id === item.id);
        if (!update) return item;
        return {
          ...item,
          status: update.status ?? item.status,
          message: typeof update.message === 'string' ? update.message : item.message,
          updatedAt: nowIso(),
        };
      });
      const next = OnboardingAgentSessionSchema.parse({
        ...session,
        status: typeof req.body?.sessionStatus === 'string' ? req.body.sessionStatus : session.status,
        progress,
      });
      setSettingJson(db, `${ONBOARDING_AGENT_SESSION_PREFIX}${session.token}`, next, 'onboarding-agent');
      res.json(next);
    } catch (error) {
      res.status(400).json({
        error: 'Invalid agent setup progress payload',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/api/onboarding/agent-session/:token/skill', (req, res) => {
    try {
      if (!assertTokenizedInviteAccess(res, req.params.token)) {
        return;
      }
      const db = getEntityDatabase(ensureAppSettingsTable);
      const session = readAgentSession(db, req.params.token);
      if (!session) {
        res.status(404).json({ error: 'Agent setup session not found' });
        return;
      }
      if (isExpiredAgentSession(session)) {
        res.status(401).json({ error: 'Agent setup session has expired' });
        return;
      }
      const skillPath = path.join(ENTITY_MC_BUNDLE_PATH, 'SKILL.md');
      if (!fs.existsSync(skillPath)) {
        res.status(404).json({ error: 'Entity MC skill bundle not found' });
        return;
      }
      res.type('text/markdown').send(fs.readFileSync(skillPath, 'utf8'));
    } catch (error) {
      res.status(400).json({
        error: 'Failed to load Entity MC skill',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/api/onboarding/agent-session/:token/bundle', (req, res) => {
    try {
      if (!assertTokenizedInviteAccess(res, req.params.token)) {
        return;
      }
      const db = getEntityDatabase(ensureAppSettingsTable);
      const session = readAgentSession(db, req.params.token);
      if (!session) {
        res.status(404).json({ error: 'Agent setup session not found' });
        return;
      }
      if (isExpiredAgentSession(session)) {
        res.status(401).json({ error: 'Agent setup session has expired' });
        return;
      }
      if (!fs.existsSync(ENTITY_MC_BUNDLE_PATH)) {
        res.status(404).json({ error: 'Entity MC skill bundle not found' });
        return;
      }
      const files = ENTITY_MC_ALLOWED_FILES
        .map((relativePath) => {
          const absolutePath = path.join(ENTITY_MC_BUNDLE_PATH, relativePath);
          if (!absolutePath.startsWith(ENTITY_MC_BUNDLE_PATH) || !fs.existsSync(absolutePath)) return null;
          return {
            path: relativePath,
            content: fs.readFileSync(absolutePath, 'utf8'),
          };
        })
        .filter((entry): entry is { path: string; content: string } => Boolean(entry));
      res.json({
        name: 'entity-mc',
        version: fs.existsSync(path.join(ENTITY_MC_BUNDLE_PATH, 'VERSION'))
          ? fs.readFileSync(path.join(ENTITY_MC_BUNDLE_PATH, 'VERSION'), 'utf8').trim()
          : 'unknown',
        files,
      });
    } catch (error) {
      res.status(400).json({
        error: 'Failed to load Entity MC bundle',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
