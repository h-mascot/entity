import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureAppSettingsTable, getSettingJson, setSettingJson } from '../config/settings-store';
import {
  REQUIRED_REGISTRY_TABLES,
  runInferenceProviderMigrations,
} from './migrations';
import { createProfileRepository } from './repositories';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

/**
 * PR-B-09 — old code paths that only know app_settings / ensure-on-open
 * must continue to work when additive registry tables are present.
 */
describe('old-code compatibility with additive registry schema (PR-B-09)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
  });

  afterEach(() => {
    db.close();
  });

  it('allows legacy settings reads/writes after registry migration', () => {
    ensureAppSettingsTable(db);
    setSettingJson(
      db,
      'taskAgent.settings',
      {
        provider: 'openai',
        model: 'gpt-5.4',
        // Legacy store may contain plaintext keys; registry must not copy them.
        apiKeys: { openai: 'SENTINEL_SHOULD_STAY_IN_LEGACY_ONLY' },
      },
      'legacy',
    );

    runInferenceProviderMigrations({ db, logger: silentLogger });

    const settings = getSettingJson(db, 'taskAgent.settings') as {
      provider: string;
      apiKeys: { openai: string };
    };
    expect(settings.provider).toBe('openai');
    expect(settings.apiKeys.openai).toBe('SENTINEL_SHOULD_STAY_IN_LEGACY_ONLY');

    // Old code ignores unknown tables — querying core settings still works.
    const tables = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    for (const required of REQUIRED_REGISTRY_TABLES) {
      expect(tables).toContain(required);
    }
    expect(tables).toContain('app_settings');

    // Simulate "old code" that never opens provider registry repos — only settings.
    setSettingJson(db, 'docIntelligence.settings', { enabled: true }, 'legacy');
    expect(getSettingJson(db, 'docIntelligence.settings')).toEqual({ enabled: true });
  });

  it('does not require registry reads for legacy boot path', () => {
    runInferenceProviderMigrations({ db, logger: silentLogger });
    ensureAppSettingsTable(db);

    // Old boot: open DB, ensure settings, optionally seed — no registry queries.
    const keys = db
      .prepare('SELECT key FROM app_settings')
      .all() as Array<{ key: string }>;
    expect(Array.isArray(keys)).toBe(true);

    // New code can still use registry independently.
    const profiles = createProfileRepository(db);
    expect(profiles.list()).toEqual([]);
  });

  it('retains registry tables on simulated code rollback (no DROP)', () => {
    runInferenceProviderMigrations({ db, logger: silentLogger });
    const profiles = createProfileRepository(db);
    profiles.create({
      name: 'kept',
      displayLabel: 'Kept after rollback',
      providerKind: 'openai',
      authMode: 'env_ref',
      secretRef: 'OPENAI_API_KEY',
    });

    // "Rollback" = stop calling registry; tables remain (SuperSpec §11.10).
    const count = db
      .prepare('SELECT COUNT(*) AS c FROM inference_provider_profiles')
      .get() as { c: number };
    expect(count.c).toBe(1);
    expect(
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='inference_provider_profiles'`)
        .get(),
    ).toBeTruthy();
  });
});
