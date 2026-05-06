import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { EntityConfigSchema } from './schema';
import { buildEffectiveConfig, deepMerge } from './effective';
import { ensureAppSettingsTable, setSettingJson } from './settings-store';

describe('settings-backed effective config', () => {
  it('uses safe public defaults without private Enterprise values', () => {
    const parsed = EntityConfigSchema.parse({});
    const serialized = JSON.stringify(parsed);
    expect(parsed.profile.displayName).toBe('Entity Workspace');
    expect(parsed.agents[0]?.id).toBe('assistant');
    expect(serialized).not.toContain('/Users/enterprise');
    expect(serialized).not.toContain('/home/henrymascot');
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

  it('tracks previous config layer when a setting is overridden', () => {
    vi.stubEnv('ENTITY_PUBLIC_BASE_URL', 'https://env.example.test');
    const result = buildEffectiveConfig({
      loaded: {
        defaults: EntityConfigSchema.parse({}),
        profile: { server: { publicBaseUrl: 'https://profile.example.test' } } as any,
        config: { server: { publicBaseUrl: 'https://config.example.test' } } as any,
        configPath: '/tmp/entity.config.yaml',
        profilePath: '/tmp/profile.yaml',
        warnings: [],
      },
    });

    expect((result.settings as any).server.publicBaseUrl).toBe('https://env.example.test');
    expect(result.sources['server.publicBaseUrl']).toMatchObject({
      source: 'env',
      overriddenBy: 'config',
    });
    vi.unstubAllEnvs();
  });

  it('preserves configured agents when runtime agents add new ids', () => {
    const merged = deepMerge(
      { agents: [{ id: 'assistant', name: 'Assistant', role: 'general' }] },
      { agents: [{ id: 'runtime-agent', name: 'Runtime Agent', role: 'ops' }] },
    ) as any;

    expect(merged.agents.map((agent: { id: string }) => agent.id)).toEqual(['assistant', 'runtime-agent']);
  });

});
