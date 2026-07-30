import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';

export const INFERENCE_PROVIDER_MIGRATIONS_DIR = path.join(__dirname, 'migrations');

const EMBEDDED_INFERENCE_PROVIDER_MIGRATIONS: Record<string, string> = {
  '001-inference-provider-registry.sql': "PRAGMA foreign_keys = ON;\n\n-- Inference Provider Registry (Phase B) \u2014 additive schema.\n-- Intentionally SEPARATE from swarm lineage tables provider_health_samples /\n-- provider_recovery_receipts. Do not reuse or dual-write those tables here.\n\nCREATE TABLE IF NOT EXISTS inference_provider_migrations (\n  filename TEXT PRIMARY KEY,\n  applied_at TEXT NOT NULL DEFAULT (datetime('now'))\n);\n\nCREATE TABLE IF NOT EXISTS inference_provider_profiles (\n  id TEXT PRIMARY KEY,\n  name TEXT NOT NULL COLLATE NOCASE UNIQUE,\n  display_label TEXT NOT NULL,\n  provider_kind TEXT NOT NULL CHECK (\n    provider_kind IN (\n      'openai',\n      'azure_openai',\n      'openai_compatible',\n      'anthropic',\n      'google',\n      'xai',\n      'vercel_gateway',\n      'local_openai_compatible'\n    )\n  ),\n  base_url TEXT,\n  auth_mode TEXT NOT NULL CHECK (\n    auth_mode IN (\n      'none',\n      'env_ref',\n      'managed_secret_ref',\n      'legacy_setting_ref'\n    )\n  ),\n  secret_ref TEXT,\n  provider_config_json TEXT NOT NULL DEFAULT '{}',\n  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),\n  migration_source TEXT,\n  migration_fingerprint TEXT,\n  last_used_at TEXT,\n  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  CHECK (\n    (auth_mode = 'none' AND secret_ref IS NULL)\n    OR\n    (auth_mode <> 'none' AND secret_ref IS NOT NULL)\n  )\n);\n\nCREATE UNIQUE INDEX IF NOT EXISTS idx_inference_provider_profiles_migration_fingerprint\n  ON inference_provider_profiles(migration_fingerprint)\n  WHERE migration_fingerprint IS NOT NULL;\n\nCREATE INDEX IF NOT EXISTS idx_inference_provider_profiles_kind_enabled\n  ON inference_provider_profiles(provider_kind, enabled);\n\nCREATE TABLE IF NOT EXISTS inference_provider_models (\n  profile_id TEXT NOT NULL,\n  model_id TEXT NOT NULL,\n  display_label TEXT,\n  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  PRIMARY KEY (profile_id, model_id),\n  FOREIGN KEY (profile_id)\n    REFERENCES inference_provider_profiles(id)\n    ON UPDATE CASCADE\n    ON DELETE RESTRICT\n);\n\nCREATE INDEX IF NOT EXISTS idx_inference_provider_models_enabled\n  ON inference_provider_models(profile_id, enabled);\n\nCREATE TABLE IF NOT EXISTS inference_provider_model_capabilities (\n  profile_id TEXT NOT NULL,\n  model_id TEXT NOT NULL,\n  capability TEXT NOT NULL,\n  created_at TEXT NOT NULL,\n  PRIMARY KEY (profile_id, model_id, capability),\n  FOREIGN KEY (profile_id, model_id)\n    REFERENCES inference_provider_models(profile_id, model_id)\n    ON UPDATE CASCADE\n    ON DELETE RESTRICT\n);\n\nCREATE TABLE IF NOT EXISTS inference_provider_profile_defaults (\n  profile_id TEXT NOT NULL,\n  capability TEXT NOT NULL,\n  model_id TEXT NOT NULL,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  PRIMARY KEY (profile_id, capability),\n  FOREIGN KEY (profile_id, model_id)\n    REFERENCES inference_provider_models(profile_id, model_id)\n    ON UPDATE CASCADE\n    ON DELETE RESTRICT\n);\n\nCREATE TABLE IF NOT EXISTS inference_provider_bindings (\n  id TEXT PRIMARY KEY,\n  consumer_key TEXT NOT NULL,\n  scope_kind TEXT NOT NULL CHECK (\n    scope_kind IN ('global', 'workspace', 'user')\n  ),\n  scope_id TEXT NOT NULL DEFAULT '',\n  capability TEXT NOT NULL,\n  profile_id TEXT NOT NULL,\n  model_id TEXT NOT NULL,\n  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),\n  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  UNIQUE (\n    consumer_key,\n    scope_kind,\n    scope_id,\n    capability\n  ),\n  FOREIGN KEY (profile_id, model_id)\n    REFERENCES inference_provider_models(profile_id, model_id)\n    ON UPDATE CASCADE\n    ON DELETE RESTRICT,\n  CHECK (\n    (scope_kind = 'global' AND scope_id = '')\n    OR\n    (scope_kind <> 'global' AND length(scope_id) > 0)\n  )\n);\n\nCREATE INDEX IF NOT EXISTS idx_inference_provider_bindings_profile\n  ON inference_provider_bindings(profile_id, model_id);\n\nCREATE INDEX IF NOT EXISTS idx_inference_provider_bindings_consumer\n  ON inference_provider_bindings(consumer_key, capability, enabled);\n\n-- Explicitly separate from swarm provider_health_samples / provider_recovery_receipts.\nCREATE TABLE IF NOT EXISTS inference_provider_health_checks (\n  id TEXT PRIMARY KEY,\n  profile_id TEXT NOT NULL,\n  model_id TEXT,\n  test_kind TEXT NOT NULL CHECK (\n    test_kind IN (\n      'configuration',\n      'connectivity',\n      'capability',\n      'consumer_smoke'\n    )\n  ),\n  capability TEXT,\n  status TEXT NOT NULL CHECK (\n    status IN (\n      'queued',\n      'running',\n      'healthy',\n      'unhealthy',\n      'cancelled'\n    )\n  ),\n  error_code TEXT,\n  safe_message TEXT,\n  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),\n  initiated_by TEXT,\n  request_id TEXT,\n  details_json TEXT NOT NULL DEFAULT '{}',\n  started_at TEXT NOT NULL,\n  completed_at TEXT,\n  FOREIGN KEY (profile_id)\n    REFERENCES inference_provider_profiles(id)\n    ON UPDATE CASCADE\n    ON DELETE RESTRICT,\n  FOREIGN KEY (profile_id, model_id)\n    REFERENCES inference_provider_models(profile_id, model_id)\n    ON UPDATE CASCADE\n    ON DELETE RESTRICT,\n  CHECK (\n    (status IN ('queued', 'running') AND completed_at IS NULL)\n    OR\n    (status IN ('healthy', 'unhealthy', 'cancelled') AND completed_at IS NOT NULL)\n  )\n);\n\nCREATE INDEX IF NOT EXISTS idx_inference_provider_health_profile_time\n  ON inference_provider_health_checks(\n    profile_id,\n    completed_at DESC,\n    started_at DESC\n  );\n\nCREATE INDEX IF NOT EXISTS idx_inference_provider_health_model_capability\n  ON inference_provider_health_checks(\n    profile_id,\n    model_id,\n    capability,\n    completed_at DESC\n  );\n\n-- Approved fallback audit store (OQ-018): no existing dedicated provider audit framework.\nCREATE TABLE IF NOT EXISTS inference_provider_audit_events (\n  id TEXT PRIMARY KEY,\n  actor_ref TEXT,\n  action TEXT NOT NULL,\n  target_type TEXT NOT NULL,\n  target_id TEXT,\n  request_id TEXT,\n  details_json TEXT NOT NULL DEFAULT '{}',\n  created_at TEXT NOT NULL\n);\n\nCREATE INDEX IF NOT EXISTS idx_inference_provider_audit_target\n  ON inference_provider_audit_events(\n    target_type,\n    target_id,\n    created_at DESC\n  );\n",
};

export function ensureInferenceProviderMigrationTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inference_provider_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function loadMigrationFiles(migrationsDir: string): Array<{ filename: string; sql: string }> {
  if (fs.existsSync(migrationsDir)) {
    const diskFiles = fs
      .readdirSync(migrationsDir)
      .filter((entry) => entry.toLowerCase().endsWith('.sql'))
      .sort((left, right) => left.localeCompare(right));
    if (diskFiles.length > 0) {
      return diskFiles.map((filename) => ({
        filename,
        sql: fs.readFileSync(path.join(migrationsDir, filename), 'utf-8'),
      }));
    }
  }

  return Object.entries(EMBEDDED_INFERENCE_PROVIDER_MIGRATIONS)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([filename, migrationSql]) => ({ filename, sql: migrationSql }));
}

/**
 * Additive, idempotent registry migrations mirroring plugin_migrations ledger
 * (OQ-002). Never drops tables on normal rollback (SuperSpec §11.10).
 */
export function runInferenceProviderMigrations(options: {
  db: Database.Database;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  migrationsDir?: string;
}): string[] {
  const logger = options.logger ?? console;
  const migrationsDir = options.migrationsDir ?? INFERENCE_PROVIDER_MIGRATIONS_DIR;
  options.db.pragma('foreign_keys = ON');
  ensureInferenceProviderMigrationTable(options.db);

  const files = loadMigrationFiles(migrationsDir);
  if (files.length === 0) {
    throw new Error(`[ProviderRegistry] No inference provider migrations available from ${migrationsDir}`);
  }
  if (!fs.existsSync(migrationsDir)) {
    logger.warn(`[ProviderRegistry] Migration directory not found: ${migrationsDir}; using embedded migrations`);
  }

  const appliedNow: string[] = [];

  for (const { filename, sql: migrationSql } of files) {
    const alreadyApplied = options.db
      .prepare('SELECT 1 FROM inference_provider_migrations WHERE filename = ? LIMIT 1')
      .get(filename);

    if (alreadyApplied) {
      continue;
    }

    const transaction = options.db.transaction(() => {
      options.db.exec(migrationSql);
      options.db
        .prepare(`
          INSERT INTO inference_provider_migrations (filename, applied_at)
          VALUES (?, datetime('now'))
        `)
        .run(filename);
    });

    transaction();
    appliedNow.push(filename);
    logger.info(`[ProviderRegistry] Applied migration ${filename}`);
  }

  return appliedNow;
}

export function listAppliedInferenceProviderMigrations(db: Database.Database): string[] {
  ensureInferenceProviderMigrationTable(db);
  const rows = db
    .prepare('SELECT filename FROM inference_provider_migrations ORDER BY filename ASC')
    .all() as Array<{ filename: string }>;
  return rows.map((row) => row.filename);
}

export const REQUIRED_REGISTRY_TABLES = [
  'inference_provider_migrations',
  'inference_provider_profiles',
  'inference_provider_models',
  'inference_provider_model_capabilities',
  'inference_provider_profile_defaults',
  'inference_provider_bindings',
  'inference_provider_health_checks',
  'inference_provider_audit_events',
] as const;
