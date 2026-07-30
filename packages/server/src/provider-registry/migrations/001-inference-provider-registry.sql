PRAGMA foreign_keys = ON;

-- Inference Provider Registry (Phase B) — additive schema.
-- Intentionally SEPARATE from swarm lineage tables provider_health_samples /
-- provider_recovery_receipts. Do not reuse or dual-write those tables here.

CREATE TABLE IF NOT EXISTS inference_provider_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inference_provider_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_label TEXT NOT NULL,
  provider_kind TEXT NOT NULL CHECK (
    provider_kind IN (
      'openai',
      'azure_openai',
      'openai_compatible',
      'anthropic',
      'google',
      'xai',
      'vercel_gateway',
      'local_openai_compatible'
    )
  ),
  base_url TEXT,
  auth_mode TEXT NOT NULL CHECK (
    auth_mode IN (
      'none',
      'env_ref',
      'managed_secret_ref',
      'legacy_setting_ref'
    )
  ),
  secret_ref TEXT,
  provider_config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  migration_source TEXT,
  migration_fingerprint TEXT,
  last_used_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (auth_mode = 'none' AND secret_ref IS NULL)
    OR
    (auth_mode <> 'none' AND secret_ref IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inference_provider_profiles_migration_fingerprint
  ON inference_provider_profiles(migration_fingerprint)
  WHERE migration_fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inference_provider_profiles_kind_enabled
  ON inference_provider_profiles(provider_kind, enabled);

CREATE TABLE IF NOT EXISTS inference_provider_models (
  profile_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  display_label TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, model_id),
  FOREIGN KEY (profile_id)
    REFERENCES inference_provider_profiles(id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_inference_provider_models_enabled
  ON inference_provider_models(profile_id, enabled);

CREATE TABLE IF NOT EXISTS inference_provider_model_capabilities (
  profile_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, model_id, capability),
  FOREIGN KEY (profile_id, model_id)
    REFERENCES inference_provider_models(profile_id, model_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS inference_provider_profile_defaults (
  profile_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  model_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, capability),
  FOREIGN KEY (profile_id, model_id)
    REFERENCES inference_provider_models(profile_id, model_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS inference_provider_bindings (
  id TEXT PRIMARY KEY,
  consumer_key TEXT NOT NULL,
  scope_kind TEXT NOT NULL CHECK (
    scope_kind IN ('global', 'workspace', 'user')
  ),
  scope_id TEXT NOT NULL DEFAULT '',
  capability TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (
    consumer_key,
    scope_kind,
    scope_id,
    capability
  ),
  FOREIGN KEY (profile_id, model_id)
    REFERENCES inference_provider_models(profile_id, model_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CHECK (
    (scope_kind = 'global' AND scope_id = '')
    OR
    (scope_kind <> 'global' AND length(scope_id) > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_inference_provider_bindings_profile
  ON inference_provider_bindings(profile_id, model_id);

CREATE INDEX IF NOT EXISTS idx_inference_provider_bindings_consumer
  ON inference_provider_bindings(consumer_key, capability, enabled);

-- Explicitly separate from swarm provider_health_samples / provider_recovery_receipts.
CREATE TABLE IF NOT EXISTS inference_provider_health_checks (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  model_id TEXT,
  test_kind TEXT NOT NULL CHECK (
    test_kind IN (
      'configuration',
      'connectivity',
      'capability',
      'consumer_smoke'
    )
  ),
  capability TEXT,
  status TEXT NOT NULL CHECK (
    status IN (
      'queued',
      'running',
      'healthy',
      'unhealthy',
      'cancelled'
    )
  ),
  error_code TEXT,
  safe_message TEXT,
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  initiated_by TEXT,
  request_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (profile_id)
    REFERENCES inference_provider_profiles(id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  FOREIGN KEY (profile_id, model_id)
    REFERENCES inference_provider_models(profile_id, model_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CHECK (
    (status IN ('queued', 'running') AND completed_at IS NULL)
    OR
    (status IN ('healthy', 'unhealthy', 'cancelled') AND completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_inference_provider_health_profile_time
  ON inference_provider_health_checks(
    profile_id,
    completed_at DESC,
    started_at DESC
  );

CREATE INDEX IF NOT EXISTS idx_inference_provider_health_model_capability
  ON inference_provider_health_checks(
    profile_id,
    model_id,
    capability,
    completed_at DESC
  );

-- Approved fallback audit store (OQ-018): no existing dedicated provider audit framework.
CREATE TABLE IF NOT EXISTS inference_provider_audit_events (
  id TEXT PRIMARY KEY,
  actor_ref TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  request_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inference_provider_audit_target
  ON inference_provider_audit_events(
    target_type,
    target_id,
    created_at DESC
  );
