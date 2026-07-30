import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  REQUIRED_REGISTRY_TABLES,
  ensureInferenceProviderMigrationTable,
  listAppliedInferenceProviderMigrations,
  runInferenceProviderMigrations,
} from './migrations';
import { ensureAppSettingsTable, getSettingJson, setSettingJson } from '../config/settings-store';

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe('inference provider migrations (PR-B-03)', () => {
  let db: Database.Database;
  let tempDir: string;

  beforeEach(() => {
    db = new Database(':memory:');
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-registry-mig-'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('applies additive schema exactly once (idempotent)', () => {
    const first = runInferenceProviderMigrations({ db, logger: silentLogger });
    expect(first.length).toBeGreaterThanOrEqual(1);
    expect(first[0]).toMatch(/001-inference-provider-registry\.sql$/);

    for (const table of REQUIRED_REGISTRY_TABLES) {
      const row = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
        .get(table) as { name?: string } | undefined;
      expect(row?.name).toBe(table);
    }

    const second = runInferenceProviderMigrations({ db, logger: silentLogger });
    expect(second).toEqual([]);
    expect(listAppliedInferenceProviderMigrations(db)).toEqual(first);
  });


  it('uses embedded migrations when compiled output has no migrations directory', () => {
    const missingDir = path.join(tempDir, 'missing-dist-migrations');
    const applied = runInferenceProviderMigrations({
      db,
      logger: silentLogger,
      migrationsDir: missingDir,
    });
    expect(applied).toContain('001-inference-provider-registry.sql');
    for (const table of REQUIRED_REGISTRY_TABLES) {
      const row = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
        .get(table) as { name?: string } | undefined;
      expect(row?.name).toBe(table);
    }
  });

  it('wraps each migration file in a transaction and records ledger', () => {
    ensureInferenceProviderMigrationTable(db);
    const badDir = path.join(tempDir, 'migrations');
    fs.mkdirSync(badDir);
    fs.writeFileSync(
      path.join(badDir, '001-ok.sql'),
      'CREATE TABLE IF NOT EXISTS inference_provider_migrations (filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL); CREATE TABLE ok_table (id TEXT PRIMARY KEY);',
    );
    fs.writeFileSync(path.join(badDir, '002-fail.sql'), 'THIS IS NOT VALID SQL ;;;');

    expect(() =>
      runInferenceProviderMigrations({
        db,
        logger: silentLogger,
        migrationsDir: badDir,
      }),
    ).toThrow();

    const applied = listAppliedInferenceProviderMigrations(db);
    // 001 may or may not be recorded depending on whether 001 was applied before 002 failed
    // in a separate transaction — each file is its own transaction, so 001 should be present.
    expect(applied).toContain('001-ok.sql');
    expect(applied).not.toContain('002-fail.sql');
  });

  it('does not modify app_settings during registry migration', () => {
    ensureAppSettingsTable(db);
    setSettingJson(db, 'taskAgent.settings', { provider: 'google', model: 'gemini-2.5-flash' }, 'test');
    const before = getSettingJson(db, 'taskAgent.settings');

    runInferenceProviderMigrations({ db, logger: silentLogger });

    expect(getSettingJson(db, 'taskAgent.settings')).toEqual(before);
  });

  it('enables and keeps foreign_keys enforceable on registry tables', () => {
    db.pragma('foreign_keys = OFF');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(0);
    runInferenceProviderMigrations({ db, logger: silentLogger });
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(() => {
      db.prepare(`
        INSERT INTO inference_provider_models (
          profile_id, model_id, display_label, enabled, created_at, updated_at
        ) VALUES ('missing', 'm1', null, 1, datetime('now'), datetime('now'))
      `).run();
    }).toThrow();
  });
});
