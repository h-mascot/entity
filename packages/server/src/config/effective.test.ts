import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { EntityConfigSchema } from './schema';
import { buildEffectiveConfig, deepMerge } from './effective';
import { ensureAppSettingsTable, setSettingJson } from './settings-store';

describe('settings-backed effective config', () => {
  it('uses safe public defaults without private Enterprise values', () => {
    const parsed = EntityConfigSchema.parse({});
    const serialized = JSON.stringify(parsed);
    const privateUserPath = ['/Users', 'enterprise'].join('');
    const privateHomePath = ['/home', 'henrymascot'].join('/');
    expect(parsed.profile.displayName).toBe('Entity Workspace');
    expect(parsed.agents[0]?.id).toBe('assistant');
    expect(serialized).not.toContain(privateUserPath);
    expect(serialized).not.toContain(privateHomePath);
    expect(serialized).not.toContain('100.104.229.62');
    expect(serialized).not.toContain('Ada');
  });

  it('deep-merges objects and merges entity arrays by id', () => {
    const merged = deepMerge(
      { server: { port: 3000, host: '127.0.0.1' }, agents: [{ id: 'assistant', name: 'Assistant', role: 'general' }] },
      { server: { port: 3100 }, agents: [{ id: 'assistant', name: 'Local Assistant' }, { id: 'writer', name: 'Writer' }] },
    ) as any;
    expect(merged.server).toEqual({ port: 3100, host: '127.0.0.1' });
    expect(merged.agents).toEqual([
      { id: 'assistant', name: 'Local Assistant', role: 'general' },
      { id: 'writer', name: 'Writer' },
    ]);
  });

  it('applies profile, config, database, then env precedence', () => {
    vi.stubEnv('PORT', '3333');
    const db = new Database(':memory:');
    setSettingJson(db, 'config.runtime', { profile: { displayName: 'DB' }, server: { port: 3222 } }, 'test');
    const result = buildEffectiveConfig({
      db,
      loaded: {
        defaults: EntityConfigSchema.parse({}),
        profile: { profile: { displayName: 'Profile' }, server: { port: 3111 } } as any,
        config: { profile: { displayName: 'Config' }, server: { port: 3001 } } as any,
        configPath: '/tmp/entity.config.yaml',
        profilePath: '/tmp/profile.yaml',
        warnings: [],
      },
    });
    expect((result.settings as any).profile.displayName).toBe('DB');
    expect((result.settings as any).server.port).toBe(3333);
    expect(result.sources['profile.displayName'].source).toBe('database');
    expect(result.sources['server.port'].source).toBe('env');
    vi.unstubAllEnvs();
  });

  it('applies public api and websocket URL env overrides to effective config', () => {
    vi.stubEnv('ENTITY_PUBLIC_BASE_URL', 'http://sandbox.entity');
    vi.stubEnv('ENTITY_CLOUD_API_BASE', 'http://sandbox.entity/api');
    vi.stubEnv('VITE_ENTITY_WS_URL', 'ws://sandbox.entity/ws');

    const result = buildEffectiveConfig({
      loaded: {
        defaults: EntityConfigSchema.parse({}),
        profile: null,
        config: null,
        configPath: '/tmp/entity.config.yaml',
        profilePath: null,
        warnings: [],
      },
    });

    expect((result.settings as any).server.publicBaseUrl).toBe('http://sandbox.entity');
    expect((result.settings as any).server.apiBaseUrl).toBe('http://sandbox.entity/api');
    expect((result.settings as any).server.wsBaseUrl).toBe('ws://sandbox.entity/ws');
    expect(result.sources['server.publicBaseUrl'].source).toBe('env');
    expect(result.sources['server.apiBaseUrl'].source).toBe('env');
    expect(result.sources['server.wsBaseUrl'].source).toBe('env');
    vi.unstubAllEnvs();
  });

  it('preserves read-only file-source capabilities from the database', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE file_sources (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        type TEXT NOT NULL,
        base_url TEXT,
        base_path TEXT,
        enabled INTEGER NOT NULL,
        icon TEXT,
        capabilities TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO file_sources (
        id, display_name, type, base_path, enabled, icon, capabilities, updated_at
      ) VALUES (
        'entity-wiki', 'Entity Wiki', 'local', '/tmp/openwiki', 1, 'book-open',
        '{"readOnly":true}', '2026-08-03T00:00:00.000Z'
      );
    `);

    const result = buildEffectiveConfig({
      db,
      loaded: {
        defaults: EntityConfigSchema.parse({}),
        profile: null,
        config: null,
        configPath: '/tmp/entity.config.yaml',
        profilePath: null,
        warnings: [],
      },
    });

    expect((result.settings as any).fileSources).toContainEqual(
      expect.objectContaining({ id: 'entity-wiki', readOnly: true }),
    );
  });

  it('redacts secret-looking fields', () => {
    const result = buildEffectiveConfig({
      loaded: {
        defaults: EntityConfigSchema.parse({ providers: { openclaw: { tokenRef: 'env:OPENCLAW_TOKEN' } } }),
        profile: null,
        config: null,
        configPath: '/tmp/entity.config.yaml',
        profilePath: null,
        warnings: [],
      },
    });
    expect(JSON.stringify(result.settings)).not.toContain('OPENCLAW_TOKEN');
    expect(JSON.stringify(result.settings)).toContain('[REDACTED]');
  });

  it('migrates legacy app_settings tables before writing updated_by metadata', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    ensureAppSettingsTable(db);
    setSettingJson(db, 'config.runtime', { profile: { displayName: 'Migrated' } }, 'test');
    const row = db.prepare('SELECT value_json, updated_by FROM app_settings WHERE key = ?').get('config.runtime') as any;
    expect(JSON.parse(row.value_json).profile.displayName).toBe('Migrated');
    expect(row.updated_by).toBe('test');
  });
});
