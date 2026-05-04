import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import type { LoadedPlugin } from './types';

export function ensurePluginMigrationTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_migrations (
      plugin_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (plugin_id, filename)
    );
  `);
}

export function runPluginMigrations(options: {
  db: Database.Database;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  plugins: LoadedPlugin[];
}): void {
  const logger = options.logger ?? console;

  for (const plugin of options.plugins) {
    const migrationsDir = plugin.storage?.migrationsDir;
    if (!migrationsDir) {
      continue;
    }

    const resolvedDir = path.resolve(plugin.directory, migrationsDir);
    if (!fs.existsSync(resolvedDir)) {
      logger.warn(`[Plugins] Migration directory not found for ${plugin.id}: ${resolvedDir}`);
      continue;
    }

    const files = fs
      .readdirSync(resolvedDir)
      .filter((entry) => entry.toLowerCase().endsWith('.sql'))
      .sort((left, right) => left.localeCompare(right));

    for (const filename of files) {
      const alreadyApplied = options.db
        .prepare('SELECT 1 FROM plugin_migrations WHERE plugin_id = ? AND filename = ? LIMIT 1')
        .get(plugin.id, filename);

      if (alreadyApplied) {
        continue;
      }

      const sql = fs.readFileSync(path.join(resolvedDir, filename), 'utf-8');
      const transaction = options.db.transaction(() => {
        options.db.exec(sql);
        options.db
          .prepare(`
            INSERT INTO plugin_migrations (plugin_id, filename, applied_at)
            VALUES (?, ?, datetime('now'))
          `)
          .run(plugin.id, filename);
      });

      transaction();
      logger.info(`[Plugins] Applied ${plugin.id} migration ${filename}`);
    }
  }
}
