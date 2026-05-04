import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensurePluginMigrationTable, runPluginMigrations } from './migrations';
import type { LoadedPlugin } from './types';

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe('runPluginMigrations', () => {
  let db: Database.Database;
  let pluginDir: string;

  beforeEach(() => {
    db = new Database(':memory:');
    ensurePluginMigrationTable(db);
    pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-plugin-migrations-'));
    fs.mkdirSync(path.join(pluginDir, 'migrations'), { recursive: true });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(pluginDir, { recursive: true, force: true });
  });

  it('applies pending sql files exactly once', () => {
    fs.writeFileSync(
      path.join(pluginDir, 'migrations', '001-create-swarm-jobs.sql'),
      'CREATE TABLE IF NOT EXISTS swarm_jobs (id TEXT PRIMARY KEY);',
    );

    const plugin: LoadedPlugin = {
      id: 'geordi-swarm',
      name: 'Geordi Swarm',
      version: '0.1.0',
      kind: 'product',
      description: 'Swarm plugin',
      capabilities: ['data.tables.own'],
      hooks: [],
      enabled: true,
      settings: {},
      directory: pluginDir,
      manifestPath: path.join(pluginDir, 'plugin.json'),
      storage: {
        tables: ['swarm_jobs'],
        migrationsDir: './migrations',
      },
      status: {
        loaded: true,
        registeredAt: new Date().toISOString(),
        routesMounted: [],
      },
    };

    runPluginMigrations({
      db,
      logger: silentLogger,
      plugins: [plugin],
    });

    const table = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'swarm_jobs'`)
      .get() as { name?: string } | undefined;
    expect(table?.name).toBe('swarm_jobs');

    const applied = db
      .prepare(`SELECT COUNT(*) AS count FROM plugin_migrations WHERE plugin_id = 'geordi-swarm'`)
      .get() as { count?: number };
    expect(applied.count).toBe(1);

    runPluginMigrations({
      db,
      logger: silentLogger,
      plugins: [plugin],
    });

    const rerunCount = db
      .prepare(`SELECT COUNT(*) AS count FROM plugin_migrations WHERE plugin_id = 'geordi-swarm'`)
      .get() as { count?: number };
    expect(rerunCount.count).toBe(1);
  });
});
