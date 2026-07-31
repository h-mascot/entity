/**
 * EEPC-A-01 characterization — locks Swarm provider interface + dispatcher seams
 * for the execution-engine plugin manifest task (EEPC-A-02).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SWARM_JOB_STATUSES } from './types';
import type { SwarmProvider } from './providers/interface';
import {
  checkProviderHealth,
  getProvider,
  listProviders,
} from './dispatcher';

const INVENTORY_JSON = path.resolve(
  __dirname,
  '../../../../docs/context/entity-eepc-a-01-swarm-provider-dispatcher-inventory.json',
);

const SECRET_LIKE_KEYS = [
  'apiKey',
  'api_key',
  'token',
  'secret',
  'password',
  'authorization',
  'SYMPHONY_API_KEY',
  'OPENCLAW_API_TOKEN',
  'OPENAI_API_KEY',
  'AZURE_OPENAI_API_KEY',
];

function assertNoSecretLikeKeys(value: unknown, trail = 'root'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretLikeKeys(entry, `${trail}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    expect(SECRET_LIKE_KEYS, `${trail}.${key}`).not.toContain(key);
    const lower = key.toLowerCase();
    for (const banned of SECRET_LIKE_KEYS) {
      expect(lower.includes(banned.toLowerCase()), `${trail}.${key}`).toBe(false);
    }
    if (typeof child === 'string') {
      // Values must not look like bearer tokens / long opaque secrets.
      expect(child).not.toMatch(/^(Bearer\s+)?[A-Za-z0-9_-]{32,}$/);
      expect(child.toLowerCase()).not.toContain('api_key=');
      expect(child.toLowerCase()).not.toContain('token=');
    }
    assertNoSecretLikeKeys(child, `${trail}.${key}`);
  }
}

describe('EEPC-A-01 Swarm provider/dispatcher inventory', () => {
  const inventory = JSON.parse(readFileSync(INVENTORY_JSON, 'utf8')) as {
    providers: Array<{ name: string; hasMeta: boolean; dispatchReady: boolean }>;
    providerInterface: { requiredMembers: string[] };
    jobStatuses: string[];
    dispatcherExports: string[];
    callbackRoutes: string[];
    healthRoutes: string[];
    registry: { bootstrap: { hardcodedOrder: string[] } };
  };

  it('durable inventory lists the hardcoded bootstrap order and job statuses', () => {
    expect(inventory.registry.bootstrap.hardcodedOrder).toEqual([
      'acp',
      'symphony',
      'eforge',
      'codex',
      'ccp',
      'flywheel',
    ]);
    expect(inventory.jobStatuses).toEqual([...SWARM_JOB_STATUSES]);
  });

  it('listProviders exposes exactly the built-in seam names with public-safe fields', () => {
    const providers = listProviders();
    const names = providers.map((p) => p.name).sort();
    expect(names).toEqual(
      inventory.registry.bootstrap.hardcodedOrder.slice().sort(),
    );

    for (const entry of providers) {
      // listProviders always projects { name, label, meta } — meta may be undefined.
      expect(Object.keys(entry).sort()).toEqual(['label', 'meta', 'name']);
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.label).toBe('string');
    }

    assertNoSecretLikeKeys(providers);
  });

  it('each registered provider implements the SwarmProvider lifecycle methods', () => {
    const required = inventory.providerInterface.requiredMembers;
    for (const expected of inventory.providers) {
      const provider = getProvider(expected.name);
      expect(provider, expected.name).toBeDefined();
      const concrete = provider as SwarmProvider;
      for (const member of required) {
        const value = (concrete as unknown as Record<string, unknown>)[member];
        if (['name', 'label'].includes(member)) {
          expect(typeof value).toBe('string');
        } else {
          expect(typeof value, `${expected.name}.${member}`).toBe('function');
        }
      }
      expect(Boolean(concrete.meta), `${expected.name}.meta`).toBe(expected.hasMeta);
    }
  });

  it('stub providers that declare acceptsDispatch=false still register but report unavailable', async () => {
    for (const name of ['ccp', 'flywheel']) {
      const health = await checkProviderHealth(name);
      expect(health.available).toBe(false);
      expect(health.message?.toLowerCase()).toMatch(/not configured|pending|not implemented|registry slot/);
      assertNoSecretLikeKeys(health);
    }
  });

  it('inventory callback and health routes match the routes module surface', () => {
    const routesSource = readFileSync(path.resolve(__dirname, 'routes.ts'), 'utf8');
    for (const route of [...inventory.callbackRoutes, ...inventory.healthRoutes]) {
      const pathOnly = route.replace(/^(GET|POST|PATCH|DELETE)\s+/, '').replace('/api/swarm', '');
      // Express paths in source omit the /api/swarm mount prefix.
      const needle = pathOnly
        .replace('/providers/:name/health', "/providers/:name/health")
        .replace(/:id/g, ':id');
      expect(routesSource.includes(needle) || routesSource.includes(needle.replace(/^\//, '')), route).toBe(
        true,
      );
    }

    // Dangerous eforge control remains an explicit shell seam for later contracts.
    expect(routesSource).toContain('eforge daemon');
  });

  it('negative: listProviders never grows secret-bearing keys without inventory update', () => {
    const providers = listProviders();
    const serialized = JSON.stringify(providers);
    for (const banned of ['SYMPHONY_API_KEY', 'OPENCLAW_API_TOKEN', 'Authorization', 'Bearer ']) {
      expect(serialized).not.toContain(banned);
    }
  });
});
