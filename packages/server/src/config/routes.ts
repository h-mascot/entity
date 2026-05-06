import type express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getEntityDatabase } from '../../../db/src/entity-db';
import { buildEffectiveConfig, deepMerge } from './effective';
import { EntityConfigSchema, OnboardingAgentSessionSchema, OnboardingStateSchema, type OnboardingAgentSession } from './schema';
import { ensureAppSettingsTable, getSettingJson, setSettingJson } from './settings-store';

const ONBOARDING_STATE_KEY = 'onboarding.state';
const ONBOARDING_AGENT_SESSION_PREFIX = 'onboarding.agentSession.';
const AGENT_SESSION_TTL_MS = 30 * 60 * 1000;
export function resolveEntityMcBundlePath(cwd = process.cwd(), dirname = __dirname): string {
  const candidates = [
    path.resolve(cwd, 'skills/entity-mc'),
    path.resolve(dirname, '../../../../skills/entity-mc'),
    path.resolve(dirname, '../../../../../skills/entity-mc'),
  ];
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, 'SKILL.md'))) ?? candidates[0];
}

function absoluteRequestUrl(req: express.Request, routePath: string): string {
  const configuredBase = process.env.ENTITY_PUBLIC_BASE_URL?.trim().replace(/\/$/, '');
  const fallbackBase = `${req.protocol}://${req.get('host') ?? 'localhost:3000'}`;
  return `${configuredBase || fallbackBase}${routePath}`;
}

const ENTITY_MC_BUNDLE_PATH = resolveEntityMcBundlePath();
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

function buildDefaultProgress() {
  const createdAt = nowIso();
  return [
    { id: 'session', label: 'Setup session created', status: 'done' as const, updatedAt: createdAt },
    { id: 'opened', label: 'Agent opened link', status: 'pending' as const, updatedAt: createdAt },
    { id: 'skill', label: 'Entity MC skill installed', status: 'pending' as const, updatedAt: createdAt },
    { id: 'workspace', label: 'Workspace configured', status: 'pending' as const, updatedAt: createdAt },
    { id: 'source', label: 'Source tested', status: 'pending' as const, updatedAt: createdAt },
    { id: 'verified', label: 'Ready to enter workspace', status: 'pending' as const, updatedAt: createdAt },
  ];
}

function buildAgentManifest(session: OnboardingAgentSession, req: express.Request) {
  const encodedToken = encodeURIComponent(session.token);
  const skillPath = `/api/onboarding/agent-session/${encodedToken}/skill`;
  const bundlePath = `/api/onboarding/agent-session/${encodedToken}/bundle`;
  const progressPath = `/api/onboarding/agent-session/${encodedToken}/progress`;
  return {
    version: 1,
    token: session.token,
    status: session.status,
    expiresAt: session.expiresAt,
    setupOnly: true,
    onboarding: session.state,
    entityMc: {
      name: 'entity-mc',
      skillUrl: absoluteRequestUrl(req, skillPath),
      bundleUrl: absoluteRequestUrl(req, bundlePath),
      progressUrl: absoluteRequestUrl(req, progressPath),
      paths: {
        skill: skillPath,
        bundle: bundlePath,
        progress: progressPath,
      },
      install: 'Run install.sh from the entity-mc bundle with --entity-url and --token, then run verify.sh.',
      verify: 'verify.sh must print VERIFY_OK before setup is marked complete.',
    },
    checklist: session.progress,
    instructions: [
      'Open the setup URL in Entity.',
      'Read this manifest before making changes.',
      'Install the Entity MC skill bundle from skills/entity-mc or the skillUrl.',
      'Apply only the selected onboarding preset and first source/agent choices.',
      'Report progress through the progress endpoint.',
      'Leave advanced Admin setup for later unless the manifest explicitly includes it.',
    ],
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

  app.post('/api/onboarding/agent-session', (req, res) => {
    try {
      const state = OnboardingStateSchema.parse(req.body?.state ?? {});
      const db = getEntityDatabase(ensureAppSettingsTable);
      const createdAt = nowIso();
      const token = crypto.randomBytes(12).toString('hex');
      const session = OnboardingAgentSessionSchema.parse({
        token,
        createdAt,
        expiresAt: new Date(Date.now() + AGENT_SESSION_TTL_MS).toISOString(),
        state: { ...state, mode: 'agent' },
        progress: buildDefaultProgress(),
      });
      setSettingJson(db, `${ONBOARDING_AGENT_SESSION_PREFIX}${token}`, session, 'onboarding-ui');
      res.status(201).json({
        token,
        setupUrl: `/onboard/agent/${token}`,
        expiresAt: session.expiresAt,
        progress: session.progress,
      });
    } catch (error) {
      res.status(400).json({
        error: 'Invalid agent setup session payload',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/api/onboarding/agent-session/:token/manifest', (req, res) => {
    try {
      const db = getEntityDatabase(ensureAppSettingsTable);
      const session = readAgentSession(db, req.params.token);
      if (!session) {
        res.status(404).json({ error: 'Agent setup session not found' });
        return;
      }
      const opened = session.status === 'created' ? { ...session, status: 'opened' as const } : session;
      if (opened !== session) {
        setSettingJson(db, `${ONBOARDING_AGENT_SESSION_PREFIX}${session.token}`, opened, 'onboarding-agent');
      }
      res.json(buildAgentManifest(opened, req));
    } catch (error) {
      res.status(400).json({
        error: 'Failed to load agent setup manifest',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.patch('/api/onboarding/agent-session/:token/progress', (req, res) => {
    try {
      const db = getEntityDatabase(ensureAppSettingsTable);
      const session = readAgentSession(db, req.params.token);
      if (!session) {
        res.status(404).json({ error: 'Agent setup session not found' });
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
        status: req.body?.status ?? session.status,
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
      const db = getEntityDatabase(ensureAppSettingsTable);
      const session = readAgentSession(db, req.params.token);
      if (!session) {
        res.status(404).json({ error: 'Agent setup session not found' });
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
      const db = getEntityDatabase(ensureAppSettingsTable);
      const session = readAgentSession(db, req.params.token);
      if (!session) {
        res.status(404).json({ error: 'Agent setup session not found' });
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
