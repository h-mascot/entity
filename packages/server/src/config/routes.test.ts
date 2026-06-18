import Database from 'better-sqlite3';
import os from 'os';
import path from 'path';
import express from 'express';
import { Readable, Writable } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerConfigRoutes } from './routes';

const db = new Database(':memory:');

vi.mock('../../../db/src/entity-db', () => ({
  getEntityDatabase: (initializer?: (database: Database.Database) => void) => {
    initializer?.(db);
    return db;
  },
}));

function createServer() {
  const app = express();
  app.use(express.json());
  registerConfigRoutes(app);
  return Promise.resolve({
    request: (requestPath: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
      requestApp(app, { path: requestPath, ...init }),
    close: async () => undefined,
  });
}

async function requestApp(
  app: express.Express,
  options: {
    path: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<Response> {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(options.headers ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)]),
  );
  const bodyText = options.body ?? '';
  if (bodyText && !normalizedHeaders['content-length']) {
    normalizedHeaders['content-length'] = String(Buffer.byteLength(bodyText));
  }

  return await new Promise<Response>((resolve, reject) => {
    const req = Readable.from(bodyText ? [bodyText] : []) as any;
    req.url = options.path;
    req.method = options.method ?? 'GET';
    req.headers = normalizedHeaders;
    req.rawHeaders = Object.entries(normalizedHeaders).flatMap(([key, value]) => [key, value]);
    req.httpVersion = '1.1';
    req.httpVersionMajor = 1;
    req.httpVersionMinor = 1;
    req.socket = { writable: true, on() {}, removeListener() {}, destroy() {} };
    req.connection = req.socket;

    const chunks: Buffer[] = [];
    const res: any = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
      },
    });

    const headersMap = new Map<string, string>();
    res.statusCode = 200;
    Object.defineProperty(res, 'headersSent', { value: false, writable: true, configurable: true });
    Object.defineProperty(res, 'finished', { value: false, writable: true, configurable: true });
    Object.defineProperty(res, 'writableEnded', { value: false, writable: true, configurable: true });
    res.setHeader = (name: string, value: string) => {
      headersMap.set(String(name).toLowerCase(), String(value));
      return res;
    };
    res.getHeader = (name: string) => headersMap.get(String(name).toLowerCase());
    res.getHeaders = () => Object.fromEntries(headersMap.entries());
    res.removeHeader = (name: string) => {
      headersMap.delete(String(name).toLowerCase());
    };
    res.writeHead = (statusCode: number, reasonOrHeaders?: unknown, maybeHeaders?: Record<string, string>) => {
      res.statusCode = statusCode;
      const headerSource = typeof reasonOrHeaders === 'object' && reasonOrHeaders !== null
        ? reasonOrHeaders as Record<string, string>
        : maybeHeaders;
      if (headerSource) {
        for (const [name, value] of Object.entries(headerSource)) {
          res.setHeader(name, value);
        }
      }
      res.headersSent = true;
      return res;
    };
    const end = res.end.bind(res);
    res.end = (chunk?: unknown, encoding?: BufferEncoding, callback?: () => void) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), encoding));
      }
      res.headersSent = true;
      res.finished = true;
      res.writableEnded = true;
      resolve(new Response(Buffer.concat(chunks), {
        status: Number(res.statusCode ?? 200),
        headers: Object.fromEntries(headersMap.entries()),
      }));
      return end(() => {
        if (typeof callback === 'function') callback();
      });
    };
    res.on('error', reject);

    try {
      (app as any).handle(req, res, reject);
    } catch (error) {
      reject(error);
    }
  });
}

describe('config routes', () => {
  beforeEach(() => {
    db.exec('DROP TABLE IF EXISTS app_settings');
    db.exec('DROP TABLE IF EXISTS file_sources');
    db.exec('DROP TABLE IF EXISTS entity_agents');
    db.exec('DROP TABLE IF EXISTS entity_agent_module_grants');
    db.exec('DROP TABLE IF EXISTS entity_module_skill_refs');
    db.exec('DROP TABLE IF EXISTS entity_modules');
    vi.stubEnv('PORT', undefined);
    vi.stubEnv('ENTITY_CONFIG', path.join(os.tmpdir(), `entity-config-routes-missing-${process.pid}.yaml`));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns effective config with source metadata', async () => {
    const server = await createServer();
    try {
      const res = await server.request('/api/config/effective');
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.settings.profile.displayName).toBe('Entity Workspace');
      expect(body.sources['profile.displayName'].source).toBe('default');
    } finally {
      await server.close();
    }
  });

  it('saves DB-backed runtime profile and safe server patches', async () => {
    const server = await createServer();
    try {
      const res = await server.request('/api/settings/config/runtime', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: { displayName: 'Portable Entity', ownerName: 'Ops' },
          server: { publicBaseUrl: 'https://entity.example.test' },
          tasks: { defaultAssignee: 'agent-alpha' },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.settings.profile.displayName).toBe('Portable Entity');
      expect(body.settings.profile.ownerName).toBe('Ops');
      expect(body.settings.server.publicBaseUrl).toBe('https://entity.example.test');
      expect(body.settings.tasks.defaultAssignee).toBe('agent-alpha');
      expect(body.sources['profile.displayName'].source).toBe('database');
      expect(body.sources['server.publicBaseUrl'].source).toBe('database');
      expect(body.sources['tasks.defaultAssignee'].source).toBe('database');
    } finally {
      await server.close();
    }
  });

  it('includes DB-backed agents in effective config visibility', async () => {
    db.exec(`
      CREATE TABLE entity_agents (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        emoji TEXT NOT NULL,
        avatar_url TEXT,
        description TEXT,
        adapter_type TEXT,
        runtime_type TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        instructions_path TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO entity_agents (id, slug, name, emoji, avatar_url, description, adapter_type, runtime_type, status)
      VALUES ('agent-alpha', 'agent-alpha', 'Agent Alpha', '🤖', NULL, 'General operator', 'local', 'cli', 'active');
    `);

    const server = await createServer();
    try {
      const res = await server.request('/api/config/effective');
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.settings.agents).toEqual([
        expect.objectContaining({
          id: 'agent-alpha',
          name: 'Agent Alpha',
          role: 'General operator',
          enabled: true,
          gateway: expect.objectContaining({ type: 'local', tokenRef: '[REDACTED]' }),
        }),
      ]);
      expect(body.sources['agents'].source).toBe('database');
      expect(body.sources['agents[0].name'].source).toBe('database');
    } finally {
      await server.close();
    }
  });

  it('includes DB-backed file sources in effective config visibility', async () => {
    db.exec(`
      CREATE TABLE file_sources (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        type TEXT NOT NULL,
        base_url TEXT,
        base_path TEXT,
        auth_type TEXT NOT NULL DEFAULT 'none',
        auth_ref TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        icon TEXT,
        capabilities TEXT NOT NULL DEFAULT '{}',
        health TEXT NOT NULL DEFAULT 'ok',
        last_synced_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO file_sources (id, display_name, type, base_url, base_path, enabled, icon)
      VALUES ('docs', 'Portable Docs', 'local', NULL, './docs', 1, '📄');
    `);

    const server = await createServer();
    try {
      const res = await server.request('/api/config/effective');
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.settings.fileSources).toEqual([
        expect.objectContaining({
          id: 'docs',
          displayName: 'Portable Docs',
          type: 'local',
          basePath: './docs',
          baseUrl: null,
          enabled: true,
        }),
      ]);
      expect(body.sources['fileSources'].source).toBe('database');
      expect(body.sources['fileSources[0].basePath'].source).toBe('database');
    } finally {
      await server.close();
    }
  });

  it('rejects invalid runtime patches', async () => {
    const server = await createServer();
    try {
      const res = await server.request('/api/settings/config/runtime', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server: { port: -1 } }),
      });
      expect(res.status).toBe(400);
    } finally {
      await server.close();
    }
  });

  it('stores onboarding state and completion server-side', async () => {
    const server = await createServer();
    try {
      const initialRes = await server.request('/api/onboarding/state');
      expect(initialRes.status).toBe(200);
      const initial = await initialRes.json() as any;
      expect(initial.completed).toBe(false);
      expect(initial.selectedTheme).toBe('aurora');
      expect(initial.selectedBundle).toBe('default');
      expect(initial.selectedModules).toEqual([
        'entity-agent-contracts',
        'entity-fs',
        'entity-mc',
        'entity-linker',
      ]);

      const patchRes = await server.request('/api/onboarding/state', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'manual',
          currentStep: 3,
          selectedTheme: 'paper',
          selectedBundle: 'custom',
          selectedModules: ['entity-agent-contracts', 'entity-fs', 'entity-linker'],
          selectedModuleConfig: { 'entity-linker': { verify: 'docs' } },
        }),
      });
      expect(patchRes.status).toBe(200);
      const patched = await patchRes.json() as any;
      expect(patched.mode).toBe('manual');
      expect(patched.currentStep).toBe(3);
      expect(patched.selectedTheme).toBe('paper');
      expect(patched.selectedBundle).toBe('custom');
      expect(patched.selectedModules).toEqual(['entity-agent-contracts', 'entity-fs', 'entity-linker']);
      expect(patched.selectedModuleConfig).toEqual({ 'entity-linker': { verify: 'docs' } });

      const modelOnlyRes = await server.request('/api/onboarding/state', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultAiModel: 'codex/gpt-5.5' }),
      });
      expect(modelOnlyRes.status).toBe(200);
      const modelOnly = await modelOnlyRes.json() as any;
      expect(modelOnly.currentStep).toBe(3);
      expect(modelOnly.mode).toBe('manual');
      expect(modelOnly.selectedTheme).toBe('paper');
      expect(modelOnly.defaultAiModel).toBe('codex/gpt-5.5');

      const completeRes = await server.request('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ starterPreset: 'solo' }),
      });
      expect(completeRes.status).toBe(200);
      const completed = await completeRes.json() as any;
      expect(completed.completed).toBe(true);
      expect(completed.completedAt).toEqual(expect.any(String));
      expect(completed.starterPreset).toBe('solo');
      expect(completed.currentStep).toBe(3);
      expect(completed.defaultAiModel).toBe('codex/gpt-5.5');
      expect(completed.selectedBundle).toBe('custom');
      expect(completed.selectedModules).toEqual(['entity-agent-contracts', 'entity-fs', 'entity-linker']);
    } finally {
      await server.close();
    }
  });

  it('returns registry-backed onboarding modules and readiness', async () => {
    const server = await createServer();
    try {
      const modulesRes = await server.request('/api/onboarding/modules');
      expect(modulesRes.status).toBe(200);
      const modules = await modulesRes.json() as any;
      expect(modules.defaultBundle).toBe('default');
      expect(modules.defaultModules).toEqual([
        'entity-agent-contracts',
        'entity-fs',
        'entity-mc',
        'entity-linker',
      ]);
      expect(modules.modules).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'entity-agent-contracts', category: 'required', locked: true }),
        expect.objectContaining({ id: 'entity-fs', category: 'required', locked: true }),
        expect.objectContaining({ id: 'entity-mc', category: 'recommended', recommended: true }),
        expect.objectContaining({ id: 'entity-linker', category: 'recommended', recommended: true }),
      ]));
      expect(modules.modules.some((module: { id: string }) => module.id === 'geordi-swarm')).toBe(false);
      expect(modules.groups.required).toHaveLength(2);
      expect(modules.groups.recommended).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'entity-mc' }),
        expect.objectContaining({ id: 'entity-linker' }),
      ]));

      const readinessRes = await server.request('/api/onboarding/readiness');
      expect(readinessRes.status).toBe(200);
      const readiness = await readinessRes.json() as any;
      expect(readiness.entityVersion).toEqual(expect.any(String));
      expect(readiness.installedRegistry.total).toBeGreaterThanOrEqual(7);
      expect(readiness.fileSourcesAvailable).toBe(false);
      expect(readiness.adminOnly).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'entity-discord-title-hook' }),
        expect.objectContaining({ id: 'entity-services' }),
        expect.objectContaining({ id: 'geordi-swarm' }),
      ]));
    } finally {
      await server.close();
    }
  });

  it('resolves onboarding selections, returns dry runs, and rejects invalid module ids', async () => {
    const server = await createServer();
    try {
      const resolveRes = await server.request('/api/onboarding/resolve-selection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedBundle: 'custom',
          selectedModules: ['entity-linker'],
        }),
      });
      expect(resolveRes.status).toBe(200);
      const resolved = await resolveRes.json() as any;
      expect(resolved.requestedBundle).toBe('custom');
      expect(resolved.normalizedBundle).toBe('custom');
      expect(resolved.selectedModules).toEqual([
        'entity-agent-contracts',
        'entity-fs',
        'entity-linker',
      ]);
      expect(resolved.installOrder).toEqual([
        'entity-agent-contracts',
        'entity-fs',
        'entity-linker',
      ]);
      expect(resolved.modules).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'entity-linker' }),
      ]));
      expect(resolved.context.root).toBe('~/.entity/agent-context');
      expect(resolved.safeStopConditions).toEqual(expect.arrayContaining([
        expect.stringContaining('Stop if any required validation gate fails'),
      ]));

      const dryRunRes = await server.request('/api/onboarding/dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedBundle: 'minimal' }),
      });
      expect(dryRunRes.status).toBe(200);
      const dryRun = await dryRunRes.json() as any;
      expect(dryRun.normalizedBundle).toBe('minimal');
      expect(dryRun.selectedModules).toEqual(['entity-agent-contracts', 'entity-fs']);
      expect(dryRun.dryRun.writes).toEqual(expect.arrayContaining([
        expect.objectContaining({ moduleId: 'entity-agent-contracts' }),
        expect.objectContaining({ moduleId: 'entity-fs' }),
      ]));
      expect(dryRun.dryRun.verifySteps).toEqual(expect.arrayContaining([
        expect.objectContaining({ moduleId: 'entity-agent-contracts' }),
        expect.objectContaining({ moduleId: 'entity-fs' }),
      ]));

      const invalidRes = await server.request('/api/onboarding/resolve-selection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedBundle: 'custom',
          selectedModules: ['unknown-module'],
        }),
      });
      expect(invalidRes.status).toBe(400);
      const invalid = await invalidRes.json() as any;
      expect(invalid.error).toContain('Unknown onboarding module selection');
      expect(invalid.payload.unknownIds).toEqual(['unknown-module']);
    } finally {
      await server.close();
    }
  });

  it('creates agent setup sessions with manifests and Entity MC skill access', async () => {
    const server = await createServer();
    try {
      const createRes = await server.request('/api/onboarding/agent-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: {
            mode: 'agent',
            starterPreset: 'crew',
            selectedBundle: 'default',
            selectedModules: ['entity-agent-contracts', 'entity-fs', 'entity-mc', 'entity-linker'],
          },
        }),
      });
      expect(createRes.status).toBe(201);
      const created = await createRes.json() as any;
      expect(created.token).toEqual(expect.any(String));
      expect(created.setupUrl).toBe(`/onboard/agent/${created.token}`);

      const manifestRes = await server.request(`/api/onboarding/agent-session/${created.token}/manifest`);
      expect(manifestRes.status).toBe(200);
      const manifest = await manifestRes.json() as any;
      expect(manifest.entityMc.name).toBe('entity-mc');
      expect(manifest.entityMc.selected).toBe(true);
      expect(manifest.entityMc.bundlePath).toBeUndefined();
      expect(manifest.entityMc.bundleUrl).toBe(`/api/onboarding/agent-session/${created.token}/bundle`);
      expect(manifest.entityMc.progressUrl).toBe(`/api/onboarding/agent-session/${created.token}/progress`);
      expect(manifest.onboarding.selectedBundle).toBe('default');
      expect(manifest.modules).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'entity-agent-contracts', required: true }),
        expect.objectContaining({ id: 'entity-fs', required: true }),
        expect.objectContaining({ id: 'entity-mc', required: false }),
        expect.objectContaining({ id: 'entity-linker', required: false }),
      ]));
      expect(manifest.installOrder).toEqual([
        'entity-agent-contracts',
        'entity-fs',
        'entity-mc',
        'entity-linker',
      ]);
      expect(manifest.moduleSkillRefs).toEqual(expect.arrayContaining([
        expect.objectContaining({ moduleId: 'entity-mc' }),
      ]));
      const linkerModule = manifest.modules.find((module: { id: string }) => module.id === 'entity-linker');
      expect(linkerModule?.skillRefs?.length ?? 0).toBeGreaterThan(0);
      expect(manifest.context.root).toBe('~/.entity/agent-context');
      expect(manifest.safeStopConditions).toEqual(expect.arrayContaining([
        expect.stringContaining('Stop before configuring any Admin-only module'),
      ]));
      expect(manifest.checklist).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'skill', label: 'Entity MC skill installed' }),
        expect.objectContaining({ id: 'module:entity-linker', label: 'Entity Linker configured' }),
      ]));

      const skillRes = await server.request(`/api/onboarding/agent-session/${created.token}/skill`);
      expect(skillRes.status).toBe(200);
      const skillText = await skillRes.text();
      expect(skillText).toContain('name: entity-mc');

      const bundleRes = await server.request(`/api/onboarding/agent-session/${created.token}/bundle`);
      expect(bundleRes.status).toBe(200);
      const bundle = await bundleRes.json() as any;
      expect(bundle.files).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'SKILL.md', content: expect.stringContaining('name: entity-mc') }),
        expect.objectContaining({ path: 'install.sh' }),
        expect.objectContaining({ path: 'verify.sh' }),
        expect.objectContaining({ path: 'manifests/example.env' }),
      ]));
      const bundleText = JSON.stringify(bundle);
      const privateMarkerPattern = new RegExp([
        String.raw`\/Users\/`,
        String.raw`\/home\/`,
        `10${'0'}\\.\\d+`,
        ['entity', 'private'].join(''),
      ].join('|'), 'i');
      expect(bundleText).not.toMatch(privateMarkerPattern);
      const bundlePaths = bundle.files.map((file: { path: string }) => file.path);
      expect(bundlePaths.filter((filePath: string) => filePath.startsWith('manifests/'))).toEqual(['manifests/example.env']);
      expect(bundlePaths.some((filePath: string) => filePath.startsWith('exec-tracking/'))).toBe(false);

      const progressRes = await server.request(`/api/onboarding/agent-session/${created.token}/progress`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          progress: [{ id: 'skill', status: 'done', message: 'qa pass' }],
        }),
      });
      expect(progressRes.status).toBe(200);
      const progress = await progressRes.json() as any;
      expect(progress.status).toBe('opened');
      expect(progress.progress).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'skill', status: 'done', message: 'qa pass' }),
      ]));
    } finally {
      await server.close();
    }
  });
});
