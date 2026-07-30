import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProviderRegistryError } from './errors';
import { runInferenceProviderMigrations } from './migrations';
import {
  createBindingRepository,
  createDefaultsRepository,
  createHealthCheckRepository,
  createModelRepository,
  createProfileRepository,
  looksLikeRawSecret,
} from './repositories';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

describe('provider registry repositories (PR-B-02/04/05/06)', () => {
  let db: Database.Database;
  let profiles: ReturnType<typeof createProfileRepository>;
  let models: ReturnType<typeof createModelRepository>;
  let defaults: ReturnType<typeof createDefaultsRepository>;
  let bindings: ReturnType<typeof createBindingRepository>;
  let health: ReturnType<typeof createHealthCheckRepository>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runInferenceProviderMigrations({ db, logger: silentLogger });
    profiles = createProfileRepository(db);
    models = createModelRepository(db);
    defaults = createDefaultsRepository(db);
    bindings = createBindingRepository(db);
    health = createHealthCheckRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates and lists profiles without storing raw secrets', () => {
    const profile = profiles.create({
      name: 'primary-chat',
      displayLabel: 'Primary chat',
      providerKind: 'openai',
      authMode: 'env_ref',
      secretRef: 'OPENAI_API_KEY',
      providerConfig: { organization: 'org_test' },
    });

    expect(profile.version).toBe(1);
    expect(profile.secretRef).toBe('OPENAI_API_KEY');
    expect(profiles.getByName('PRIMARY-CHAT')?.id).toBe(profile.id);
    expect(profiles.list()).toHaveLength(1);

    expect(() =>
      profiles.create({
        name: 'bad',
        displayLabel: 'Bad',
        providerKind: 'openai',
        authMode: 'env_ref',
        secretRef: 'sk-abcdefghijklmnopqrstuvwxyz012345',
      }),
    ).toThrow(ProviderRegistryError);

    expect(looksLikeRawSecret('OPENAI_API_KEY')).toBe(false);
    expect(looksLikeRawSecret('sk-abcdefghijklmnopqrstuvwxyz012345')).toBe(true);
  });

  it('rejects duplicate profile names', () => {
    profiles.create({
      name: 'dup',
      displayLabel: 'One',
      providerKind: 'google',
      authMode: 'none',
    });
    expect(() =>
      profiles.create({
        name: 'DUP',
        displayLabel: 'Two',
        providerKind: 'google',
        authMode: 'none',
      }),
    ).toThrow(/PROVIDER_NAME_EXISTS|name already exists/i);
  });

  it('upserts models, capabilities, defaults, and global bindings', () => {
    const profile = profiles.create({
      name: 'tm',
      displayLabel: 'Task Master',
      providerKind: 'anthropic',
      authMode: 'legacy_setting_ref',
      secretRef: 'taskAgent.settings.apiKeys.anthropic',
    });

    const model = models.upsert({
      profileId: profile.id,
      modelId: 'claude-sonnet-4.5',
      displayLabel: 'Sonnet',
      capabilities: ['chat', 'reasoning'],
    });
    expect(model.capabilities).toEqual(['chat', 'reasoning']);

    const def = defaults.setDefault(profile.id, 'chat', 'claude-sonnet-4.5');
    expect(def.modelId).toBe('claude-sonnet-4.5');

    const binding = bindings.upsert({
      consumerKey: 'task_master',
      capability: 'chat',
      profileId: profile.id,
      modelId: 'claude-sonnet-4.5',
    });
    expect(binding.scopeKind).toBe('global');
    expect(binding.scopeId).toBe('');
    expect(binding.version).toBe(1);

    const docs = bindings.upsert({
      consumerKey: 'doc_intelligence',
      capability: 'chat',
      profileId: profile.id,
      modelId: 'claude-sonnet-4.5',
    });
    expect(docs.consumerKey).toBe('doc_intelligence');

    expect(bindings.list({ consumerKey: 'task_master' })).toHaveLength(1);
    expect(models.listByProfile(profile.id)).toHaveLength(1);
  });

  it('enforces optimistic concurrency on profile updates (PR-B-06)', () => {
    const profile = profiles.create({
      name: 'conc',
      displayLabel: 'Concurrency',
      providerKind: 'xai',
      authMode: 'env_ref',
      secretRef: 'XAI_API_KEY',
    });

    const updated = profiles.update(profile.id, {
      expectedVersion: 1,
      displayLabel: 'Concurrency v2',
    });
    expect(updated.version).toBe(2);
    expect(updated.displayLabel).toBe('Concurrency v2');

    expect(() =>
      profiles.update(profile.id, {
        expectedVersion: 1,
        displayLabel: 'Stale writer',
      }),
    ).toThrow(ProviderRegistryError);

    const again = profiles.update(profile.id, {
      expectedVersion: 2,
      enabled: false,
    });
    expect(again.enabled).toBe(false);
    expect(again.version).toBe(3);
  });

  it('enforces optimistic concurrency on bindings', () => {
    const profile = profiles.create({
      name: 'bind-conc',
      displayLabel: 'Bind',
      providerKind: 'google',
      authMode: 'none',
    });
    models.upsert({
      profileId: profile.id,
      modelId: 'gemini-2.5-flash',
      capabilities: ['chat'],
    });
    const binding = bindings.upsert({
      consumerKey: 'task_master',
      capability: 'chat',
      profileId: profile.id,
      modelId: 'gemini-2.5-flash',
    });

    const next = bindings.upsert({
      consumerKey: 'task_master',
      capability: 'chat',
      profileId: profile.id,
      modelId: 'gemini-2.5-flash',
      expectedVersion: binding.version,
      enabled: false,
    });
    expect(next.version).toBe(2);
    expect(next.enabled).toBe(false);

    expect(() =>
      bindings.upsert({
        consumerKey: 'task_master',
        capability: 'chat',
        profileId: profile.id,
        modelId: 'gemini-2.5-flash',
        expectedVersion: 1,
      }),
    ).toThrow(ProviderRegistryError);
  });

  it('persists health-check lifecycle without secret details (PR-B-05)', () => {
    const profile = profiles.create({
      name: 'health',
      displayLabel: 'Health',
      providerKind: 'openai_compatible',
      baseUrl: 'https://example.invalid/v1',
      authMode: 'env_ref',
      secretRef: 'CUSTOM_API_KEY',
    });
    models.upsert({
      profileId: profile.id,
      modelId: 'gpt-4o',
      capabilities: ['chat'],
    });

    const queued = health.create({
      profileId: profile.id,
      modelId: 'gpt-4o',
      testKind: 'capability',
      capability: 'chat',
      status: 'running',
      details: {
        apiKey: 'sk-should-never-persist',
        probe: 'ok',
      },
    });
    expect(queued.status).toBe('running');
    expect(queued.completedAt).toBeNull();
    expect(queued.details).not.toHaveProperty('apiKey');
    expect(queued.details.probe).toBe('ok');

    const done = health.complete(queued.id, {
      status: 'healthy',
      latencyMs: 42,
      safeMessage: 'The provider accepted the capability test.',
      details: {
        secret: 'nope',
        httpStatus: 200,
      },
    });
    expect(done.status).toBe('healthy');
    expect(done.completedAt).toBeTruthy();
    expect(done.latencyMs).toBe(42);
    expect(done.details).not.toHaveProperty('secret');
    expect(done.details.httpStatus).toBe(200);

    expect(health.latestForProfile(profile.id)?.id).toBe(done.id);
    expect(health.listByProfile(profile.id)).toHaveLength(1);

    // Separate table name — never touches swarm health tables
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain('inference_provider_health_checks');
    expect(tables).not.toContain('provider_health_samples');
  });


  it('rejects providerConfig secret material on create and update', () => {
    expect(() =>
      profiles.create({
        name: 'config-secret',
        displayLabel: 'Config Secret',
        providerKind: 'openai',
        authMode: 'env_ref',
        secretRef: 'OPENAI_API_KEY',
        providerConfig: { nested: [{ apiKey: 'sk-reviewerfound1234567890' }] },
      }),
    ).toThrow(ProviderRegistryError);

    const profile = profiles.create({
      name: 'config-safe',
      displayLabel: 'Config Safe',
      providerKind: 'openai',
      authMode: 'env_ref',
      secretRef: 'OPENAI_API_KEY',
      providerConfig: { region: 'us-test' },
    });

    expect(() =>
      profiles.update(profile.id, {
        expectedVersion: profile.version,
        providerConfig: { headers: { authorization: 'Bearer sk-reviewerfound1234567890' } },
      }),
    ).toThrow(ProviderRegistryError);
  });

  it('rejects unknown consumer keys before persisting bindings', () => {
    const profile = profiles.create({
      name: 'consumer-safe',
      displayLabel: 'Consumer Safe',
      providerKind: 'openai',
      authMode: 'env_ref',
      secretRef: 'OPENAI_API_KEY',
    });
    models.upsert({ profileId: profile.id, modelId: 'gpt-safe', capabilities: ['chat'] });

    expect(() =>
      bindings.upsert({
        // Runtime guard protects JS callers even if TS is bypassed.
        consumerKey: 'task_mater' as 'task_master',
        capability: 'chat',
        profileId: profile.id,
        modelId: 'gpt-safe',
      }),
    ).toThrow(/PROVIDER_REQUEST_INVALID|request is invalid|Unknown provider consumer key/);
    expect(bindings.list()).toHaveLength(0);
  });

  it('requires defaults and bindings to target models with the requested capability', () => {
    const profile = profiles.create({
      name: 'capability-safe',
      displayLabel: 'Capability Safe',
      providerKind: 'google',
      authMode: 'none',
    });
    models.upsert({
      profileId: profile.id,
      modelId: 'chat-only',
      capabilities: ['chat'],
    });

    expect(() => defaults.setDefault(profile.id, 'embeddings', 'chat-only')).toThrow(
      ProviderRegistryError,
    );
    expect(() =>
      bindings.upsert({
        consumerKey: 'doc_intelligence',
        capability: 'embeddings',
        profileId: profile.id,
        modelId: 'chat-only',
      }),
    ).toThrow(ProviderRegistryError);
  });

  it('prevents capability removal while defaults or bindings depend on it', () => {
    const profile = profiles.create({
      name: 'capability-in-use',
      displayLabel: 'Capability In Use',
      providerKind: 'anthropic',
      authMode: 'none',
    });
    models.upsert({
      profileId: profile.id,
      modelId: 'multi',
      capabilities: ['chat', 'reasoning'],
    });
    defaults.setDefault(profile.id, 'chat', 'multi');

    expect(() => models.setCapabilities(profile.id, 'multi', ['reasoning'])).toThrow(
      ProviderRegistryError,
    );
  });

  it('rejects model-specific health capability checks unsupported by the model', () => {
    const profile = profiles.create({
      name: 'health-capability-safe',
      displayLabel: 'Health Capability Safe',
      providerKind: 'openai',
      authMode: 'env_ref',
      secretRef: 'OPENAI_API_KEY',
    });
    models.upsert({ profileId: profile.id, modelId: 'gpt-safe', capabilities: ['chat'] });

    expect(() =>
      health.create({
        profileId: profile.id,
        modelId: 'gpt-safe',
        testKind: 'capability',
        capability: 'embeddings',
      }),
    ).toThrow(/PROVIDER_CAPABILITY_UNSUPPORTED|requested capability|capability/i);

    expect(
      health.create({
        profileId: profile.id,
        testKind: 'capability',
        capability: 'embeddings',
      }).capability,
    ).toBe('embeddings');
  });

  it('recursively sanitizes health arrays and redacts safeMessage before persistence', () => {
    const profile = profiles.create({
      name: 'health-redaction',
      displayLabel: 'Health Redaction',
      providerKind: 'openai',
      authMode: 'env_ref',
      secretRef: 'OPENAI_API_KEY',
    });
    models.upsert({
      profileId: profile.id,
      modelId: 'gpt-safe',
      capabilities: ['chat'],
    });

    const queued = health.create({
      profileId: profile.id,
      modelId: 'gpt-safe',
      testKind: 'capability',
      capability: 'chat',
      details: { nested: [{ apiKey: 'sk-reviewerfound1234567890', ok: true }] },
    });
    expect(queued.details).toEqual({ nested: [{ ok: true }] });

    const done = health.complete(queued.id, {
      status: 'unhealthy',
      safeMessage: 'authorization: Bearer sk-reviewerfound1234567890',
      details: { attempts: [{ token: 'sk-reviewerfound1234567890', status: 401 }] },
    });
    expect(done.safeMessage).toContain('[redacted]');
    expect(JSON.stringify(done.details)).not.toContain('sk-reviewerfound');
    expect(done.details).toEqual({ attempts: [{ status: 401 }] });
  });


  it('rejects common OAuth secret-bearing config keys and redacts token/password labels', () => {
    expect(() =>
      profiles.create({
        name: 'oauth-secret',
        displayLabel: 'OAuth Secret',
        providerKind: 'openai',
        authMode: 'env_ref',
        secretRef: 'OPENAI_API_KEY',
        providerConfig: { oauth: { clientSecret: '12345678901234567890123456789012' } },
      }),
    ).toThrow(ProviderRegistryError);

    const profile = profiles.create({
      name: 'health-label-redaction',
      displayLabel: 'Health Label Redaction',
      providerKind: 'openai',
      authMode: 'env_ref',
      secretRef: 'OPENAI_API_KEY',
    });
    models.upsert({ profileId: profile.id, modelId: 'gpt-safe', capabilities: ['chat'] });
    const queued = health.create({ profileId: profile.id, modelId: 'gpt-safe', testKind: 'capability' });
    const done = health.complete(queued.id, {
      status: 'unhealthy',
      safeMessage: 'token=12345678901234567890123456789012 password: hunter2',
    });
    expect(done.safeMessage).toContain('token=[redacted]');
    expect(done.safeMessage).toContain('password: [redacted]');
    expect(done.safeMessage).not.toContain('12345678901234567890123456789012');
    expect(done.safeMessage).not.toContain('hunter2');
  });

  it('preserves profile update invariants for display labels and global scope IDs', () => {
    const profile = profiles.create({
      name: 'update-invariants',
      displayLabel: 'Update Invariants',
      providerKind: 'google',
      authMode: 'none',
    });
    models.upsert({ profileId: profile.id, modelId: 'gemini-safe', capabilities: ['chat'] });

    expect(() =>
      profiles.update(profile.id, { expectedVersion: profile.version, displayLabel: '   ' }),
    ).toThrow(ProviderRegistryError);
    expect(() =>
      bindings.upsert({
        consumerKey: 'task_master',
        scopeKind: 'global',
        scopeId: 'workspace-1',
        capability: 'chat',
        profileId: profile.id,
        modelId: 'gemini-safe',
      }),
    ).toThrow(ProviderRegistryError);
  });


  it('rejects credentials embedded in base URLs on create and update', () => {
    expect(() =>
      profiles.create({
        name: 'url-secret-create',
        displayLabel: 'URL Secret Create',
        providerKind: 'openai_compatible',
        baseUrl: 'https://user:password@example.test/v1',
        authMode: 'env_ref',
        secretRef: 'OPENAI_API_KEY',
      }),
    ).toThrow(ProviderRegistryError);

    const profile = profiles.create({
      name: 'url-secret-update',
      displayLabel: 'URL Secret Update',
      providerKind: 'openai_compatible',
      baseUrl: 'https://example.test/v1',
      authMode: 'env_ref',
      secretRef: 'OPENAI_API_KEY',
    });

    expect(() =>
      profiles.update(profile.id, {
        expectedVersion: profile.version,
        baseUrl: 'https://example.test/v1?access_token=12345678901234567890123456789012',
      }),
    ).toThrow(ProviderRegistryError);
  });


  it('rejects non-http and secret-bearing provider base URLs', () => {
    expect(() =>
      profiles.create({
        name: 'url-file',
        displayLabel: 'URL File',
        providerKind: 'local_openai_compatible',
        baseUrl: 'file:///etc/passwd',
        authMode: 'none',
      }),
    ).toThrow(ProviderRegistryError);

    expect(() =>
      profiles.create({
        name: 'url-path-secret',
        displayLabel: 'URL Path Secret',
        providerKind: 'openai_compatible',
        baseUrl: 'https://example.test/v1/sk-reviewerfound1234567890',
        authMode: 'env_ref',
        secretRef: 'OPENAI_API_KEY',
      }),
    ).toThrow(ProviderRegistryError);
  });

  it('preserves existing model metadata when optional upsert fields are omitted', () => {
    const profile = profiles.create({
      name: 'model-upsert-preserve',
      displayLabel: 'Model Upsert Preserve',
      providerKind: 'openai',
      authMode: 'none',
    });
    models.upsert({
      profileId: profile.id,
      modelId: 'm',
      displayLabel: 'Label',
      enabled: false,
      capabilities: ['chat'],
    });
    const updated = models.upsert({
      profileId: profile.id,
      modelId: 'm',
      capabilities: ['chat', 'reasoning'],
    });
    expect(updated.displayLabel).toBe('Label');
    expect(updated.enabled).toBe(false);
    expect(updated.capabilities).toEqual(['chat', 'reasoning']);
  });

  it('disables profiles instead of deleting (v1)', () => {
    const profile = profiles.create({
      name: 'disable-me',
      displayLabel: 'Disable',
      providerKind: 'vercel_gateway',
      authMode: 'env_ref',
      secretRef: 'AI_GATEWAY_API_KEY',
    });
    const disabled = profiles.setEnabled(profile.id, false, 1);
    expect(disabled.enabled).toBe(false);
    expect(profiles.getById(profile.id)?.enabled).toBe(false);
  });
});
