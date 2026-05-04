import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PluginRegistry, ensurePluginSettingsTable, parsePluginManifest, resolvePluginsDirectory } from './registry';

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe('parsePluginManifest', () => {
  it('normalizes valid module sub-view plugins', () => {
    const manifest = parsePluginManifest(
      {
        id: 'geordi-swarm',
        name: 'Geordi Swarm',
        version: '0.1.0',
        kind: 'product',
        description: 'Swarm plugin',
        capabilities: ['api.routes.register'],
        hooks: ['task:created'],
        ui: {
          mountPoint: { type: 'module-sub-view', module: 'tasks' },
          component: 'SwarmBoard',
          label: 'Swarm',
        },
        routes: [{ basePath: '/api/swarm', entry: './routes.ts' }],
      },
      {
        directory: '/tmp/geordi-swarm',
        manifestPath: '/tmp/geordi-swarm/plugin.json',
      },
    );

    expect(manifest.ui?.mountPoint).toEqual({ type: 'module-sub-view', module: 'tasks' });
    expect(manifest.routes?.[0]?.basePath).toBe('/api/swarm');
  });

  it('normalizes top-level tab plugins', () => {
    const manifest = parsePluginManifest(
      {
        id: 'entity-services',
        name: 'Entity Services',
        version: '0.1.0',
        kind: 'integration',
        description: 'Services registry',
        capabilities: ['api.routes.register'],
        hooks: [],
        ui: {
          mountPoint: { type: 'top-level-tab' },
          component: 'EntityServicesBoard',
          label: 'Services',
        },
        routes: [{ basePath: '/api/entity-services', entry: './routes.ts' }],
      },
      {
        directory: '/tmp/entity-services',
        manifestPath: '/tmp/entity-services/plugin.json',
      },
    );

    expect(manifest.ui?.mountPoint).toEqual({ type: 'top-level-tab' });
    expect(manifest.routes?.[0]?.basePath).toBe('/api/entity-services');
  });

  it('rejects routes outside the api namespace', () => {
    expect(() =>
      parsePluginManifest(
        {
          id: 'bad-plugin',
          name: 'Bad Plugin',
          version: '0.1.0',
          kind: 'ui',
          description: 'Broken plugin',
          capabilities: [],
          hooks: [],
          routes: [{ basePath: '/swarm' }],
        },
        {
          directory: '/tmp/bad-plugin',
          manifestPath: '/tmp/bad-plugin/plugin.json',
        },
      ),
    ).toThrow('/api/');
  });
});

describe('resolvePluginsDirectory', () => {
  it('prefers the source plugin directory when cwd points at dist output', () => {
    const originalCwd = process.cwd();
    const distApp = path.resolve(__dirname, '../../dist/app');

    fs.mkdirSync(distApp, { recursive: true });
    process.chdir(distApp);

    try {
      expect(resolvePluginsDirectory()).toBe(path.resolve(__dirname));
    } finally {
      process.chdir(originalCwd);
    }
  });
});

describe('PluginRegistry', () => {
  let db: Database.Database;
  let pluginsDir: string;

  beforeEach(() => {
    db = new Database(':memory:');
    ensurePluginSettingsTable(db);
    pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-plugins-'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(pluginsDir, { recursive: true, force: true });
  });

  it('loads multiple plugin kinds and merges persisted settings independently', () => {
    const swarmDir = path.join(pluginsDir, 'geordi-swarm');
    fs.mkdirSync(swarmDir, { recursive: true });
    fs.writeFileSync(
      path.join(swarmDir, 'plugin.json'),
      JSON.stringify({
        id: 'geordi-swarm',
        name: 'Geordi Swarm',
        version: '0.1.0',
        kind: 'product',
        description: 'Swarm plugin',
        capabilities: ['api.routes.register'],
        hooks: ['task:created'],
        settings: {
          defaultProvider: 'acp',
          autoDispatch: false,
        },
        ui: {
          mountPoint: { type: 'module-sub-view', module: 'tasks' },
          component: 'SwarmBoard',
          label: 'Swarm',
        },
      }),
    );

    const linkerDir = path.join(pluginsDir, 'entity-linker');
    fs.mkdirSync(linkerDir, { recursive: true });
    fs.writeFileSync(
      path.join(linkerDir, 'plugin.json'),
      JSON.stringify({
        id: 'entity-linker',
        name: 'Entity Linker',
        version: '0.1.0',
        kind: 'behavior',
        description: 'Linker plugin',
        capabilities: ['api.routes.register', 'tasks.events.observe'],
        hooks: ['task:updated'],
        settings: {
          entityBaseUrl: 'http://100.106.69.9:3000',
          rewriteAbsolutePaths: true,
        },
        routes: [{ basePath: '/api/entity-linker', entry: './routes.ts' }],
      }),
    );

    db.prepare(`
      INSERT INTO plugin_settings (plugin_id, enabled, settings_json, updated_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run('geordi-swarm', 0, JSON.stringify({ autoDispatch: true }));

    db.prepare(`
      INSERT INTO plugin_settings (plugin_id, enabled, settings_json, updated_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run('entity-linker', 1, JSON.stringify({ rewriteAbsolutePaths: false }));

    const registry = new PluginRegistry({
      db,
      logger: silentLogger,
      pluginsDir,
    });

    const plugins = registry.load();
    expect(plugins).toHaveLength(2);

    const swarm = plugins.find((plugin) => plugin.id === 'geordi-swarm');
    const linker = plugins.find((plugin) => plugin.id === 'entity-linker');

    expect(swarm?.enabled).toBe(false);
    expect(swarm?.settings).toEqual({
      defaultProvider: 'acp',
      autoDispatch: true,
    });

    expect(linker?.enabled).toBe(true);
    expect(linker?.kind).toBe('behavior');
    expect(linker?.settings).toEqual({
      entityBaseUrl: 'http://100.106.69.9:3000',
      rewriteAbsolutePaths: false,
    });
  });
});
