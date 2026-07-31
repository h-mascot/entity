/**
 * EEPC-A-02 — execution-engine plugin manifest schema + fixture proofs.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as manifestModule from './index';
import {
  EXECUTION_ENGINE_KIND,
  EXECUTION_ENGINE_MANIFEST_SCHEMA_VERSION,
  parseExecutionEngineManifest,
  validateExecutionEngineManifest,
} from './index';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const INVENTORY_JSON = path.resolve(
  __dirname,
  '../../../../../docs/context/entity-eepc-a-01-swarm-provider-dispatcher-inventory.json',
);

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, name), 'utf8')) as unknown;
}

function listFixtures(prefix: string): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
    .sort();
}

describe('EEPC-A-02 execution-engine plugin manifest schema', () => {
  it('schema constants match contract versioning', () => {
    expect(EXECUTION_ENGINE_MANIFEST_SCHEMA_VERSION).toBe('1.0.0');
    expect(EXECUTION_ENGINE_KIND).toBe('execution-engine');
  });

  it('valid fixtures cover every built-in inventory provider family', () => {
    const inventory = JSON.parse(readFileSync(INVENTORY_JSON, 'utf8')) as {
      providers: Array<{ name: string }>;
    };
    const validNames = listFixtures('valid-').map((file) => {
      const manifest = parseExecutionEngineManifest(loadFixture(file));
      return manifest.identity.name;
    });

    const expected = inventory.providers.map((p) => p.name).sort();
    expect(validNames.sort()).toEqual(expected);
  });

  it.each(listFixtures('valid-'))('accepts valid fixture %s', (file) => {
    const result = validateExecutionEngineManifest(loadFixture(file));
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    if (result.ok) {
      expect(result.manifest.schemaVersion).toBe('1.0.0');
      expect(result.manifest.kind).toBe('execution-engine');
      expect(result.manifest.identity.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(result.manifest.health.publicFields.length).toBeGreaterThan(0);
      // Public health contract never advertises secret-like field names.
      for (const field of result.manifest.health.publicFields) {
        expect(field.toLowerCase()).not.toMatch(/key|token|secret|password/);
      }
      for (const binding of result.manifest.config.bindings) {
        if (/api[_-]?key|token|secret|password/i.test(binding.key)) {
          expect(binding.secret).toBe(true);
        }
      }
    }
  });

  it('eforge valid fixture declares the shell dangerous-action allowlist entry', () => {
    const manifest = parseExecutionEngineManifest(loadFixture('valid-eforge.json'));
    expect(manifest.dangerousActions).toHaveLength(1);
    expect(manifest.dangerousActions[0]).toMatchObject({
      id: 'eforge-daemon-control',
      requiresExplicitAllow: true,
      shells: true,
      pathTemplate: '/api/swarm/providers/eforge/control',
    });
    expect(manifest.health.allowUrlsInPublicMessage).toBe(false);
    expect(manifest.health.allowPathsInPublicMessage).toBe(false);
    expect(manifest.health.privateFields).toEqual(
      expect.arrayContaining(['apiUrl', 'queueDir']),
    );
  });

  it('symphony valid fixture maps claim/proof callbacks and classifies SYMPHONY_API_KEY', () => {
    const manifest = parseExecutionEngineManifest(loadFixture('valid-symphony.json'));
    expect(manifest.execution.mode).toBe('pull');
    expect(manifest.execution.expectsClaimCallbacks).toBe(true);
    expect(manifest.statusMapping.afterDispatch).toBe('queued');
    const events = manifest.callbacks.intake.map((entry) => entry.event).sort();
    expect(events).toEqual(
      ['claim', 'complete', 'fail', 'proof', 'release', 'status'].sort(),
    );
    const keyBinding = manifest.config.bindings.find((b) => b.key === 'SYMPHONY_API_KEY');
    expect(keyBinding?.secret).toBe(true);
  });

  it('stub fixtures refuse dispatch', () => {
    for (const file of ['valid-ccp-stub.json', 'valid-flywheel-stub.json']) {
      const manifest = parseExecutionEngineManifest(loadFixture(file));
      expect(manifest.execution.mode).toBe('stub');
      expect(manifest.execution.acceptsDispatch).toBe(false);
      expect(manifest.lifecycle.dispatch).toBe(false);
      expect(manifest.dangerousActions).toEqual([]);
    }
  });

  it.each(listFixtures('invalid-'))('rejects invalid fixture %s', (file) => {
    const result = validateExecutionEngineManifest(loadFixture(file));
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('negative: stub acceptsDispatch is rejected with semantic code', () => {
    const result = validateExecutionEngineManifest(
      loadFixture('invalid-stub-accepts-dispatch.json'),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'stub_accepts_dispatch')).toBe(true);
  });

  it('negative: unclassified secret config key is rejected', () => {
    const result = validateExecutionEngineManifest(
      loadFixture('invalid-secret-unclassified.json'),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'secret_key_unclassified')).toBe(true);
  });

  it('negative: pull without claim mapping is rejected', () => {
    const result = validateExecutionEngineManifest(
      loadFixture('invalid-pull-missing-claim.json'),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'missing_claim_mapping')).toBe(true);
  });

  it('negative: embedded secret-like description value is rejected', () => {
    const result = validateExecutionEngineManifest(
      loadFixture('invalid-secret-value-leak.json'),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'secret_value_leak')).toBe(true);
  });

  it('negative: missing identity.version fails schema parse', () => {
    const result = validateExecutionEngineManifest(
      loadFixture('invalid-missing-identity-version.json'),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes('version') || i.code === 'schema')).toBe(
      true,
    );
  });

  it('parseExecutionEngineManifest throws a readable aggregate error', () => {
    expect(() => parseExecutionEngineManifest({ kind: 'nope' })).toThrow(
      /Invalid execution-engine manifest/,
    );
  });

  it('does not wire production registration — export surface stays pure', () => {
    expect(manifestModule.validateExecutionEngineManifest).toBeTypeOf('function');
    expect(manifestModule.parseExecutionEngineManifest).toBeTypeOf('function');
    expect(
      (manifestModule as Record<string, unknown>).registerProvider,
    ).toBeUndefined();
    expect(
      (manifestModule as Record<string, unknown>).ensureProvidersRegistered,
    ).toBeUndefined();
  });
});
