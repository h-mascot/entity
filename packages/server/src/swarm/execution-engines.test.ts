/**
 * EEPC-B-01 — API redaction proofs for execution-engine list + health.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDbPath = path.join(
  os.tmpdir(),
  `entity-eepc-b-01-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);

process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
process.env.MISSION_CONTROL_DB_PATH = '/tmp/nonexistent-mc-eepc-b-01.db';
process.env.ACP_BASE_URL = 'http://127.0.0.1:9/secret-acp-base';

let baseUrl = '';
let server: Awaited<ReturnType<express.Express['listen']>>;
let createSwarmRouter: typeof import('./routes').createSwarmRouter;
let getProvider: typeof import('./dispatcher').getProvider;
let projectLegacyPublicHealth: typeof import('./execution-engines').projectLegacyPublicHealth;
let listRegisteredExecutionEngines: typeof import('./execution-engines').listRegisteredExecutionEngines;
let isSwarmContractAdapter: typeof import('./providers/contract-bootstrap').isSwarmContractAdapter;

const SECRET_PATTERNS = [
  /https?:\/\//i,
  /\/Users\//i,
  /\/home\//i,
  /\/tmp\//i,
  /Bearer\s+[A-Za-z0-9_\-.+/=]{8,}/i,
  /\bsk-[A-Za-z0-9]{10,}\b/,
  /api[_-]?key\s*=/i,
  /secret-acp-base/i,
];

function assertNoSecretLeak(payload: unknown, label: string): void {
  const serialized = JSON.stringify(payload);
  for (const pattern of SECRET_PATTERNS) {
    expect(serialized, `${label} must not match ${pattern}`).not.toMatch(pattern);
  }
}

beforeAll(async () => {
  ({ createSwarmRouter } = await import('./routes'));
  ({ getProvider } = await import('./dispatcher'));
  ({ projectLegacyPublicHealth, listRegisteredExecutionEngines } = await import('./execution-engines'));
  ({ isSwarmContractAdapter } = await import('./providers/contract-bootstrap'));

  const app = express();
  app.use(express.json());
  app.use('/api/swarm', createSwarmRouter());

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
      baseUrl = `http://127.0.0.1:${address.port}/api/swarm`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  try {
    fs.unlinkSync(tmpDbPath);
  } catch {
    // ignore
  }
});

describe('EEPC-B-01 execution engine public list/health redaction', () => {
  it(
    'lists registered engines with health and never leaks urls/paths/secrets',
    async () => {
      const response = await fetch(`${baseUrl}/execution-engines`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        engines: Array<{ name: string; kind: string; health: { available: boolean; message?: string } }>;
      };

      expect(Array.isArray(body.engines)).toBe(true);
      expect(body.engines.length).toBeGreaterThan(0);
      for (const engine of body.engines) {
        expect(engine.kind).toBe('execution-engine');
        expect(typeof engine.name).toBe('string');
        expect(engine.health).toBeTruthy();
        expect(typeof engine.health.available).toBe('boolean');
      }

      assertNoSecretLeak(body, 'GET /execution-engines');
    },
    15000,
  );

  it(
    'GET /providers attaches public health and mirrors engines without secret leak',
    async () => {
      const response = await fetch(`${baseUrl}/providers`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        providers: Array<{ name: string; health: { available: boolean; message?: string } }>;
        engines: Array<{ name: string }>;
      };

      expect(body.providers.length).toBeGreaterThan(0);
      expect(body.engines.length).toBe(body.providers.length);
      for (const provider of body.providers) {
        expect(provider.health).toBeTruthy();
        expect(typeof provider.health.available).toBe('boolean');
      }
      assertNoSecretLeak(body, 'GET /providers');
    },
    15000,
  );

  it('GET /providers/:name/health uses public projection (ACP URL redacted)', async () => {
    const acp = getProvider('acp');
    expect(acp).toBeTruthy();
    expect(isSwarmContractAdapter(acp)).toBe(true);
    if (!acp || !isSwarmContractAdapter(acp)) return;

    // Force a leaky raw health message through the inner provider, then assert route redacts.
    const healthSpy = vi.spyOn(acp.inner, 'healthCheck').mockResolvedValue({
      available: true,
      latencyMs: 4,
      message:
        'ACP reachable at http://127.0.0.1:9/secret-acp-base path=/Users/synth/secret Bearer abcdefghijklmnopqrstuvwxyz01234567',
    });

    try {
      const response = await fetch(`${baseUrl}/providers/acp/health`);
      expect(response.status).toBe(200);
      const health = (await response.json()) as {
        available: boolean;
        message?: string;
        latencyMs?: number;
      };

      expect(health.available).toBe(true);
      expect(health.message).toBeTruthy();
      expect(health.message).toContain('[redacted-url]');
      expect(health.message).toContain('[redacted-path]');
      expect(health.message).toMatch(/Bearer \[redacted\]/i);
      assertNoSecretLeak(health, 'GET /providers/acp/health');
    } finally {
      healthSpy.mockRestore();
    }
  });

  it('unknown provider health is fail-closed without leaking probe details', async () => {
    const response = await fetch(`${baseUrl}/providers/not-a-real-engine/health`);
    expect(response.status).toBe(200);
    const health = await response.json();
    expect(health).toEqual({ available: false, message: 'Unknown provider: not-a-real-engine' });
    assertNoSecretLeak(health, 'unknown provider health');
  });

  it('projectLegacyPublicHealth strips urls/paths and refuses secret-shaped leftovers', () => {
    const projected = projectLegacyPublicHealth({
      available: true,
      latencyMs: 99,
      message: 'up http://evil.example/x under /tmp/secret',
    });
    expect(projected.available).toBe(true);
    expect('latencyMs' in projected).toBe(false);
    expect(projected.message).toContain('[redacted-url]');
    expect(projected.message).toContain('[redacted-path]');
    assertNoSecretLeak(projected, 'legacy public health urls/paths');

    const secretShaped = projectLegacyPublicHealth({
      available: false,
      message: 'token=super-secret-value-abcdefghijklmnopqrstuvwxyz',
    });
    expect(secretShaped.message).toBe('[redacted]');
    assertNoSecretLeak(secretShaped, 'legacy public health secrets');
  });

  it(
    'listRegisteredExecutionEngines returns only public-safe fields',
    async () => {
      const engines = await listRegisteredExecutionEngines();
      expect(engines.some((e) => e.name === 'acp')).toBe(true);
      for (const engine of engines) {
        const keys = Object.keys(engine).sort();
        for (const key of keys) {
          expect([
            'id',
            'name',
            'label',
            'kind',
            'category',
            'description',
            'capabilities',
            'acceptsDispatch',
            'executionMode',
            'mode',
            'health',
          ]).toContain(key);
        }
        expect(engine).not.toHaveProperty('apiKey');
        expect(engine).not.toHaveProperty('env');
        expect(engine).not.toHaveProperty('config');
        expect(engine).not.toHaveProperty('inner');
        expect(engine).not.toHaveProperty('manifest');
      }
      assertNoSecretLeak(engines, 'listRegisteredExecutionEngines');
    },
    15000,
  );
});
