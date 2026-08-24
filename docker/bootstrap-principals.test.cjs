'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { bootstrap } = require('./bootstrap-principals.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-bootstrap-'));
const dbPath = path.join(dir, 'entity.sqlite');
process.env.ENTITY_TASK_DB_PATH = dbPath;
process.env.ENTITY_CUSTOMER_ACCESS_TOKEN = `ect_${'a'.repeat(43)}`;

bootstrap();
bootstrap();

const db = new Database(dbPath, { readonly: true });
assert.equal(db.prepare("SELECT count(*) AS n FROM orgs WHERE id = 'curacel' AND deployment_mode = 'dedicated'").get().n, 1);
assert.equal(db.prepare("SELECT count(*) AS n FROM teams WHERE id = 'pilot' AND org_id = 'curacel'").get().n, 1);
assert.equal(db.prepare("SELECT count(*) AS n FROM entity_principals").get().n, 2);
assert.equal(db.prepare("SELECT count(*) AS n FROM principal_grants").get().n, 2);
assert.equal(db.prepare("SELECT count(*) AS n FROM entity_access_tokens WHERE status = 'active'").get().n, 1);
assert.deepEqual(
  db.prepare("SELECT org_id, team_id FROM principal_grants WHERE id = 'curacel-pilot-service-manager'").get(),
  { org_id: 'curacel', team_id: 'pilot' },
);
assert.equal(db.prepare("SELECT org_id FROM principal_grants WHERE id = 'curacel-deployment-admin-global'").get().org_id, null);
db.close();

process.env.ENTITY_CUSTOMER_ACCESS_TOKEN = `ect_${'b'.repeat(43)}`;
bootstrap();
const rotated = new Database(dbPath, { readonly: true });
assert.equal(rotated.prepare("SELECT count(*) AS n FROM entity_access_tokens WHERE status = 'active'").get().n, 1);
assert.equal(rotated.prepare("SELECT count(*) AS n FROM entity_access_tokens WHERE status = 'revoked'").get().n, 1);
rotated.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('[bootstrap-test] passed');
