import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {
  defaultEntityDevEnv,
  loadSidecarPin,
  normalizeBaseUrl,
  repoRoot,
  splitHostPort,
} from './clickclack-sidecar-lib.mjs';

test('loadSidecarPin uses the checked-in pin and local defaults', () => {
  const pin = loadSidecarPin({});
  assert.equal(pin.remote, 'https://github.com/openclaw/clickclack');
  assert.equal(pin.checkoutPath, '/tmp/clickclack');
  assert.equal(pin.commit, 'd77dd568d8ff5c9d3d7c1063b4c317c1e3cd1be2');
  assert.equal(pin.addr, '127.0.0.1:3091');
  assert.equal(pin.baseUrl, 'http://127.0.0.1:3091');
  assert.equal(pin.dataDir, path.join(repoRoot, 'var', 'clickclack-sidecar'));
});

test('loadSidecarPin honors env overrides without trailing slashes', () => {
  const pin = loadSidecarPin({
    ENTITY_CLICKCLACK_CHECKOUT: '/tmp/custom-clickclack',
    ENTITY_CLICKCLACK_DATA_DIR: '/tmp/custom-data',
    ENTITY_CLICKCLACK_BASE_URL: 'http://127.0.0.1:3999/',
    CLICKCLACK_ADDR: '127.0.0.1:3999',
    ENTITY_URL: 'http://127.0.0.1:3888/',
  });

  assert.equal(pin.checkoutPath, '/tmp/custom-clickclack');
  assert.equal(pin.dataDir, '/tmp/custom-data');
  assert.equal(pin.baseUrl, 'http://127.0.0.1:3999');
  assert.equal(pin.entityUrl, 'http://127.0.0.1:3888');
});

test('defaultEntityDevEnv starts ClickClack without hijacking normal chat routing', () => {
  const pin = loadSidecarPin({});
  const env = defaultEntityDevEnv(pin, { PORT: '3888' });

  assert.equal(env.PORT, '3888');
  assert.equal(env.ENTITY_CHAT_CLICKCLACK_BRIDGE, '0');
  assert.equal(env.ENTITY_CLICKCLACK_BASE_URL, 'http://127.0.0.1:3091');
  assert.equal(env.VITE_ENTITY_API_BASE, 'http://localhost:3888');
  assert.equal(env.VITE_ENTITY_WS_PORT, '3888');
});

test('defaultEntityDevEnv preserves explicit ClickClack bridge opt-in', () => {
  const pin = loadSidecarPin({});
  const env = defaultEntityDevEnv(pin, { PORT: '3888', ENTITY_CHAT_CLICKCLACK_BRIDGE: '1' });

  assert.equal(env.ENTITY_CHAT_CLICKCLACK_BRIDGE, '1');
});

test('defaultEntityDevEnv enables local ClickClack bot fallback for user testing', () => {
  const pin = loadSidecarPin({});
  const env = defaultEntityDevEnv(pin, { PORT: '3888' });

  assert.equal(env.ENTITY_CLICKCLACK_ALLOW_HUMAN_AGENT_FALLBACK, '1');
});

test('utility helpers normalize URLs and host ports', () => {
  assert.equal(normalizeBaseUrl('http://localhost:3000///'), 'http://localhost:3000');
  assert.deepEqual(splitHostPort('127.0.0.1:3091'), { host: '127.0.0.1', port: 3091 });
  assert.deepEqual(splitHostPort('3091'), { host: '127.0.0.1', port: 3091 });
});
