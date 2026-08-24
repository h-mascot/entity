#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (name) => readFileSync(resolve(root, name), 'utf8');

const dockerfile = read('Dockerfile');
const ignore = read('.dockerignore');
const entrypoint = read('docker/entrypoint.sh');
const config = read('docker/entity.config.yaml');
const compose = read('docker-compose.coolify.yml');

assert.match(dockerfile, /FROM node:22-bookworm-slim@sha256:[0-9a-f]{64} AS build/);
assert.match(dockerfile, /FROM caddy:2\.10-alpine@sha256:[0-9a-f]{64} AS caddy/);
assert.match(dockerfile, /ARG SOURCE_COMMIT/);
assert.doesNotMatch(dockerfile, /ARG ENTITY_RELEASE_SHA/);
assert.match(dockerfile, /npm ci/);
assert.match(dockerfile, /npm run build/);
assert.match(dockerfile, /USER node/);
assert.match(dockerfile, /HEALTHCHECK/);
assert.match(dockerfile, /docker\/entrypoint\.sh/);
assert.match(dockerfile, /docker\/supervise\.sh/);
assert.match(dockerfile, /EXPOSE 8080/);

for (const required of ['.git', 'node_modules', '.env', '*.db', 'data', 'workspace']) {
  assert.ok(ignore.split(/\r?\n/).includes(required), `.dockerignore must exclude ${required}`);
}

assert.match(entrypoint, /ENTITY_API_TOKEN/);
assert.match(entrypoint, /ENTITY_DEFAULT_DOCUMENTS_TOKEN/);
assert.match(entrypoint, /ENTITY_TASK_DB_PATH/);
assert.match(entrypoint, /ENTITY_BASIC_AUTH_USER/);
assert.match(entrypoint, /ENTITY_BASIC_AUTH_HASH/);
assert.match(entrypoint, /exec dumb-init/);

assert.match(config, /host: 127\.0\.0\.1/);
assert.match(config, /databasePath: \/data\/entity\.sqlite/);
assert.match(config, /workspaceRoot: \/workspace/);
assert.match(config, /mode: local/);
assert.match(config, /targets: \[\]/);

for (const required of [
  'image: ${ENTITY_IMAGE:?',
  'ENTITY_API_TOKEN: ${ENTITY_API_TOKEN:?',
  'ENTITY_DEFAULT_DOCUMENTS_TOKEN: ${ENTITY_DEFAULT_DOCUMENTS_TOKEN:?',
  'ENTITY_CUSTOMER_ACCESS_TOKEN: ${ENTITY_CUSTOMER_ACCESS_TOKEN:?',
  'ENTITY_BASIC_AUTH_HASH: ${ENTITY_BASIC_AUTH_HASH:?',
  'ENTITY_TASK_DB_PATH: /data/entity.sqlite',
  'WORKSPACE: /workspace',
  'ENTITY_AGENT_NATIVE_EDITOR: "false"',
  'ENTITY_CLICKCLACK_SIDECAR: "0"',
  'cap_drop:',
  '- ALL',
  'no-new-privileges:true',
  'entity-data:/data',
  'entity-workspace:/workspace',
  'restart: unless-stopped',
  'traefik.enable=true',
  'loadbalancer.server.port=8080',
  '/api/health',
]) {
  assert.ok(compose.includes(required), `compose contract missing ${required}`);
}
assert.doesNotMatch(compose, /customrequestheaders\.(?:Authorization|X-Entity-Access-Token)/i);
assert.doesNotMatch(compose, /basicauth\.users=/i);

console.log('[container-contract] passed');
