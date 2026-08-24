'use strict';

const { createHash, randomUUID } = require('node:crypto');
const Database = require('better-sqlite3');

function requireValue(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function bootstrap() {
  const dbPath = requireValue('ENTITY_TASK_DB_PATH');
  const rawCustomerToken = requireValue('ENTITY_CUSTOMER_ACCESS_TOKEN');
  const database = new Database(dbPath);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE IF NOT EXISTS orgs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      deployment_mode TEXT NOT NULL DEFAULT 'saas',
      mission TEXT,
      domains_json TEXT NOT NULL DEFAULT '[]',
      blueprint_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(org_id, slug)
    );
    CREATE TABLE IF NOT EXISTS entity_principals (
      id TEXT PRIMARY KEY,
      principal_type TEXT NOT NULL CHECK (principal_type IN ('human', 'agent', 'service_account')),
      display_name TEXT NOT NULL,
      handle TEXT,
      email TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT,
      updated_by TEXT
    );
    CREATE TABLE IF NOT EXISTS principal_grants (
      id TEXT PRIMARY KEY,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('viewer', 'contributor', 'manager', 'admin')),
      org_id TEXT,
      team_id TEXT,
      project_id INTEGER,
      sensitivity_categories_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT,
      updated_by TEXT,
      FOREIGN KEY (principal_id) REFERENCES entity_principals(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS entity_access_tokens (
      id TEXT PRIMARY KEY,
      principal_id TEXT NOT NULL,
      label TEXT,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT,
      created_by TEXT,
      FOREIGN KEY (principal_id) REFERENCES entity_principals(id) ON DELETE CASCADE
    );
  `);

  const transaction = database.transaction(() => {
    database.prepare(`
      INSERT INTO orgs (id, name, slug, status, deployment_mode, mission, domains_json)
      VALUES ('curacel', 'Curacel', 'curacel', 'active', 'dedicated', 'Curacel tenant-zero Entity pilot', '[]')
      ON CONFLICT(id) DO NOTHING
    `).run();
    database.prepare(`
      INSERT INTO teams (id, org_id, name, slug, status)
      VALUES ('pilot', 'curacel', 'Pilot', 'pilot', 'active')
      ON CONFLICT(id) DO NOTHING
    `).run();

    database.prepare(`
      INSERT INTO entity_principals (id, principal_type, display_name, status, metadata_json, created_by, updated_by)
      VALUES ('curacel-deployment-admin', 'service_account', 'Curacel Deployment Admin', 'active', '{"purpose":"deployment-control"}', 'container-bootstrap', 'container-bootstrap')
      ON CONFLICT(id) DO NOTHING
    `).run();
    database.prepare(`
      INSERT INTO principal_grants (id, principal_id, role, org_id, sensitivity_categories_json, created_by, updated_by)
      VALUES ('curacel-deployment-admin-global', 'curacel-deployment-admin', 'admin', NULL, '[]', 'container-bootstrap', 'container-bootstrap')
      ON CONFLICT(id) DO NOTHING
    `).run();

    database.prepare(`
      INSERT INTO entity_principals (id, principal_type, display_name, status, metadata_json, created_by, updated_by)
      VALUES ('curacel-pilot-service', 'service_account', 'Curacel Pilot Service', 'active', '{"purpose":"tenant-zero-proxy"}', 'container-bootstrap', 'container-bootstrap')
      ON CONFLICT(id) DO NOTHING
    `).run();
    database.prepare(`
      INSERT INTO principal_grants (id, principal_id, role, org_id, team_id, sensitivity_categories_json, created_by, updated_by)
      VALUES ('curacel-pilot-service-manager', 'curacel-pilot-service', 'manager', 'curacel', 'pilot', '["customer","workspace_defined","confidential_strategy"]', 'container-bootstrap', 'container-bootstrap')
      ON CONFLICT(id) DO NOTHING
    `).run();

    const tokenHash = createHash('sha256').update(rawCustomerToken, 'utf8').digest('hex');
    const existingForPrincipal = database.prepare(
      "SELECT id, token_hash FROM entity_access_tokens WHERE principal_id = 'curacel-pilot-service' AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    ).get();
    if (existingForPrincipal && existingForPrincipal.token_hash !== tokenHash) {
      database.prepare(
        "UPDATE entity_access_tokens SET status = 'revoked', revoked_at = datetime('now') WHERE principal_id = 'curacel-pilot-service' AND status = 'active'",
      ).run();
    }
    database.prepare(`
      INSERT INTO entity_access_tokens (id, principal_id, label, token_hash, token_prefix, status, created_by)
      SELECT ?, 'curacel-pilot-service', 'coolify-proxy', ?, ?, 'active', 'container-bootstrap'
      WHERE NOT EXISTS (SELECT 1 FROM entity_access_tokens WHERE token_hash = ? AND status = 'active')
    `).run(randomUUID(), tokenHash, rawCustomerToken.slice(0, 12), tokenHash);
  });

  transaction();
  database.close();
  console.log('[bootstrap] Curacel principals and scoped proxy credential ready');
}

if (require.main === module) {
  bootstrap();
}

module.exports = { bootstrap };
