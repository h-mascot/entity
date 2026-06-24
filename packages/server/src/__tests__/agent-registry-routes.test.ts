import express from 'express';
import http from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAgentRegistryRouter } from '../routes/agent-registry';
import type { HelmLightControlAdapter } from '../agent/helm-light-controls';
import type { HelmStatusAdapter } from '../agent/helm-status-adapter';
import type {
  AgentModuleGrantRecord,
  AgentRegistryRecord,
  AgentRegistryRepository,
  AgentRuntimeBindingState,
  AgentRuntimeProviderType,
  CreateAgentRegistryInput,
  ModuleRegistryRecord,
  ModuleRegistryRepository,
  ModuleSkillRefRecord,
  UpdateAgentRegistryInput,
  UpsertAgentModuleGrantInput,
} from '../../../db/src';

const now = '2026-05-01T00:00:00.000Z';
const PROVIDER_TYPES = new Set<AgentRuntimeProviderType>([
  'local_process',
  'remote_http',
  'openai_compatible',
  'anthropic_compatible',
  'helm_runtime',
  'custom',
  'unknown',
]);
const BINDING_STATES = new Set<AgentRuntimeBindingState>(['bound', 'unbound', 'stale', 'unknown']);

function normalizeProviderType(value: unknown): AgentRuntimeProviderType {
  return typeof value === 'string' && PROVIDER_TYPES.has(value as AgentRuntimeProviderType)
    ? value as AgentRuntimeProviderType
    : 'unknown';
}

function normalizeBindingState(value: unknown): AgentRuntimeBindingState {
  return typeof value === 'string' && BINDING_STATES.has(value as AgentRuntimeBindingState)
    ? value as AgentRuntimeBindingState
    : 'unknown';
}

function makeAgent(overrides: Partial<AgentRegistryRecord> = {}): AgentRegistryRecord {
  return {
    id: 'book',
    slug: 'book',
    name: 'Book',
    emoji: '📘',
    avatar_url: '/agent-avatars/book.png',
    description: 'Continuity operator',
    adapter_type: 'hermes',
    runtime_type: 'remote',
    runtime_binding_id: null,
    provider_type: 'unknown',
    helm_managed: false,
    binding_state: 'unknown',
    status: 'active',
    instructions_path: null,
    metadata_json: '{"modules":["docs"],"owner":"Entity Docs"}',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function makeGrant(overrides: Partial<AgentModuleGrantRecord> = {}): AgentModuleGrantRecord {
  return {
    id: 'grant-docs',
    agent_id: 'book',
    module_id: 'docs',
    enabled: true,
    permissions_json: '["read","write"]',
    scope_json: '{}',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function createRepos() {
  const agents = new Map<string, AgentRegistryRecord>([['book', makeAgent()]]);
  const grants = new Map<string, AgentModuleGrantRecord>([['book:docs', makeGrant()]]);
  const modules: ModuleRegistryRecord[] = [
    {
      id: 'docs',
      slug: 'docs',
      name: 'Docs',
      description: null,
      enabled: true,
      icon: '📚',
      kind: 'core',
      permissions_schema_json: '["read","write","comment","review"]',
      ui_config_json: '{"label":"Docs"}',
      created_at: now,
      updated_at: now,
    },
    {
      id: 'tasks',
      slug: 'tasks',
      name: 'Mission Control',
      description: null,
      enabled: true,
      icon: '✅',
      kind: 'core',
      permissions_schema_json: '["read","create","update","assign","review","admin"]',
      ui_config_json: '{"label":"Mission Control"}',
      created_at: now,
      updated_at: now,
    },
  ];

  const agentRepo: AgentRegistryRepository = {
    listAgents: () => Array.from(agents.values()),
    getAgent: (id: string) => agents.get(id),
    getAgentBySlug: (slug: string) => Array.from(agents.values()).find((agent) => agent.slug === slug),
    createAgent: (input: CreateAgentRegistryInput) => {
      const agent = makeAgent({
        id: input.id ?? input.slug,
        slug: input.slug,
        name: input.name,
        emoji: input.emoji,
        avatar_url: input.avatar_url ?? null,
        description: input.description ?? null,
        adapter_type: input.adapter_type ?? null,
        runtime_type: input.runtime_type ?? null,
        runtime_binding_id: input.runtime_binding_id ?? null,
        provider_type: normalizeProviderType(input.provider_type),
        helm_managed: input.helm_managed ?? false,
        binding_state: normalizeBindingState(input.binding_state),
        status: input.status ?? 'active',
        instructions_path: input.instructions_path ?? null,
        metadata_json: input.metadata_json ?? '{}',
      });
      agents.set(agent.id, agent);
      return agent;
    },
    updateAgent: (id: string, updates: UpdateAgentRegistryInput) => {
      const current = agents.get(id);
      if (!current) return undefined;
      const normalizedUpdates: UpdateAgentRegistryInput = { ...updates };
      if (updates.provider_type !== undefined) {
        normalizedUpdates.provider_type = normalizeProviderType(updates.provider_type);
      }
      if (updates.binding_state !== undefined) {
        normalizedUpdates.binding_state = normalizeBindingState(updates.binding_state);
      }
      const updated: AgentRegistryRecord = {
        ...current,
        ...normalizedUpdates,
        provider_type: normalizeProviderType(normalizedUpdates.provider_type ?? current.provider_type),
        binding_state: normalizeBindingState(normalizedUpdates.binding_state ?? current.binding_state),
        helm_managed: normalizedUpdates.helm_managed ?? current.helm_managed,
        runtime_binding_id: normalizedUpdates.runtime_binding_id === undefined
          ? current.runtime_binding_id
          : normalizedUpdates.runtime_binding_id,
        updated_at: now,
      };
      agents.set(id, updated);
      return updated;
    },
    deleteAgent: (id: string) => {
      const deleted = agents.delete(id);
      for (const key of Array.from(grants.keys())) {
        if (key.startsWith(`${id}:`)) grants.delete(key);
      }
      return deleted;
    },
  };

  const moduleRepo: ModuleRegistryRepository = {
    listModules: () => modules,
    listModuleSkillRefs: (_moduleId: string): ModuleSkillRefRecord[] => [],
    listAgentModuleGrants: (agentId: string) => Array.from(grants.values()).filter((grant) => grant.agent_id === agentId),
    upsertAgentModuleGrant: (input: UpsertAgentModuleGrantInput) => {
      const grant = makeGrant({
        id: `${input.agent_id}-${input.module_id}`,
        agent_id: input.agent_id,
        module_id: input.module_id,
        enabled: input.enabled === false ? false : true,
        permissions_json: input.permissions_json ?? '[]',
        scope_json: input.scope_json ?? '{}',
      });
      grants.set(`${input.agent_id}:${input.module_id}`, grant);
      return grant;
    },
    deleteAgentModuleGrant: (agentId: string, moduleId: string) => grants.delete(`${agentId}:${moduleId}`),
  };

  return { agentRepo, moduleRepo };
}

describe('agent registry mutation routes', () => {
  let baseUrl = '';
  let server: http.Server;

  beforeAll(async () => {
    const { agentRepo, moduleRepo } = createRepos();
    const app = express();
    app.use(express.json());
    app.use('/api', createAgentRegistryRouter({ agentRegistryRepo: agentRepo, moduleRegistryRepo: moduleRepo }));
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server failed to bind');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('lists registry agents with serialized capability cards', async () => {
    const res = await fetch(`${baseUrl}/api/agents/registry`);
    expect(res.status).toBe(200);
    const json = await res.json() as {
      list: Array<{
        id: string;
        avatarUrl?: string;
        runtime_binding_id: string | null;
        provider_type: string;
        helm_managed: boolean;
        binding_state: string;
        runtime_status: {
          source: string;
          state: string;
          readiness: string;
          reason: string;
        };
        runtimeStatus: {
          state: string;
        };
        capabilities?: { runtimeLabel?: string; capabilityLabels: string[] };
      }>;
    };
    expect(json.list[0].id).toBe('book');
    expect(json.list[0].avatarUrl).toBe('/agent-avatars/book.png');
    expect(json.list[0]).toMatchObject({
      runtime_binding_id: null,
      provider_type: 'unknown',
      helm_managed: false,
      binding_state: 'unknown',
      runtime_status: {
        source: 'helm',
        state: 'unknown',
        readiness: 'unknown',
        reason: 'not_helm_managed',
      },
    });
    expect(json.list[0].runtimeStatus.state).toBe('unknown');
    expect(json.list[0].capabilities?.runtimeLabel).toBe('Hermes · Remote · Active');
    expect(json.list[0].capabilities?.capabilityLabels).toEqual(['Docs']);
  });

  it('creates an agent, upserts grants, soft-disables, removes grants, and hard deletes', async () => {
    const createRes = await fetch(`${baseUrl}/api/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'moltbook',
        name: 'Moltbook',
        emoji: '🧪',
        adapterType: 'legacy-adapter-label',
        runtimeType: 'remote',
        runtimeBindingId: 'helm-runtime-moltbook',
        providerType: 'custom',
        helmManaged: true,
        bindingState: 'bound',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json() as {
      agent: {
        id: string;
        slug: string;
        status: string;
        runtime_binding_id: string;
        provider_type: string;
        helm_managed: boolean;
        binding_state: string;
      };
    };
    expect(created.agent.slug).toBe('moltbook');
    expect(created.agent.status).toBe('active');
    expect(created.agent).toMatchObject({
      runtime_binding_id: 'helm-runtime-moltbook',
      provider_type: 'custom',
      helm_managed: true,
      binding_state: 'bound',
    });

    const grantRes = await fetch(`${baseUrl}/api/agents/moltbook/grants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ module_id: 'tasks', permissions: ['read', 'create'], scope: { projects: ['entity'] } }),
    });
    expect(grantRes.status).toBe(201);
    const grantJson = await grantRes.json() as { grant: { module_id: string; permissions_json: string } };
    expect(grantJson.grant.module_id).toBe('tasks');
    expect(JSON.parse(grantJson.grant.permissions_json)).toEqual(['read', 'create']);

    const disableRes = await fetch(`${baseUrl}/api/agents/moltbook`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'disabled', bindingState: 'stale', providerType: 'bogus-provider' }),
    });
    expect(disableRes.status).toBe(200);
    const disabled = await disableRes.json() as { agent: { status: string; binding_state: string; provider_type: string } };
    expect(disabled.agent.status).toBe('disabled');
    expect(disabled.agent.binding_state).toBe('stale');
    expect(disabled.agent.provider_type).toBe('unknown');

    const deleteGrantRes = await fetch(`${baseUrl}/api/agents/moltbook/grants/tasks`, { method: 'DELETE' });
    expect(deleteGrantRes.status).toBe(200);
    expect(await deleteGrantRes.json()).toEqual({ deleted: true });

    const deleteAgentRes = await fetch(`${baseUrl}/api/agents/moltbook`, { method: 'DELETE' });
    expect(deleteAgentRes.status).toBe(200);
    expect(await deleteAgentRes.json()).toEqual({ deleted: true });

    const deletedAgentGrantsRes = await fetch(`${baseUrl}/api/agents/moltbook/grants`);
    expect(deletedAgentGrantsRes.status).toBe(404);
  });

  it('rejects invalid slugs and unknown modules', async () => {
    const badCreate = await fetch(`${baseUrl}/api/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'Bad Slug', name: 'Bad' }),
    });
    expect(badCreate.status).toBe(400);

    const badGrant = await fetch(`${baseUrl}/api/agents/book/grants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ module_id: 'missing' }),
    });
    expect(badGrant.status).toBe(404);
  });
});

describe('agent registry Helm runtime status serialization', () => {
  it('includes sanitized adapter status without changing agent lifecycle state', async () => {
    const { agentRepo, moduleRepo } = createRepos();
    agentRepo.createAgent({
      slug: 'helmbook',
      name: 'Helm Book',
      emoji: 'H',
      adapter_type: 'helm',
      runtime_type: 'remote',
      runtime_binding_id: 'runtime-helmbook',
      provider_type: 'helm_runtime',
      helm_managed: true,
      binding_state: 'bound',
      status: 'active',
      metadata_json: '{}',
    });
    const helmStatusAdapter: HelmStatusAdapter = {
      getStatus: async (agent) => ({
        source: 'helm',
        binding_id: agent.runtime_binding_id,
        state: 'degraded',
        health: 'degraded',
        readiness: 'degraded',
        current_work: 'Waiting for review',
        heartbeat_at: '2026-05-01T00:00:00.000Z',
        checked_at: '2026-05-01T00:00:10.000Z',
        stale: true,
        reason: 'stale_helm_heartbeat',
        helm_link: null,
      }),
    };
    const app = express();
    app.use(express.json());
    app.use('/api', createAgentRegistryRouter({ agentRegistryRepo: agentRepo, moduleRegistryRepo: moduleRepo, helmStatusAdapter }));
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('test server failed to bind');
      const res = await fetch(`http://127.0.0.1:${address.port}/api/agents/registry`);
      expect(res.status).toBe(200);
      const json = await res.json() as { list: Array<{ slug: string; status: string; runtime_status: { state: string; current_work: string; reason: string } }> };
      const helmAgent = json.list.find((entry) => entry.slug === 'helmbook');
      expect(helmAgent).toMatchObject({
        status: 'active',
        runtime_status: {
          state: 'degraded',
          current_work: 'Waiting for review',
          reason: 'stale_helm_heartbeat',
        },
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('exposes management-surface fields for degraded runtime bindings', async () => {
    const { agentRepo, moduleRepo } = createRepos();
    agentRepo.createAgent({
      slug: 'opsbook',
      name: 'Ops Book',
      emoji: 'O',
      adapter_type: 'helm',
      runtime_type: 'remote',
      runtime_binding_id: 'runtime-opsbook',
      provider_type: 'helm_runtime',
      helm_managed: true,
      binding_state: 'stale',
      status: 'active',
      metadata_json: '{"loops":["daily review sweep"]}',
    });
    moduleRepo.upsertAgentModuleGrant({
      agent_id: 'opsbook',
      module_id: 'tasks',
      enabled: true,
      permissions_json: '["read","review"]',
      scope_json: '{"projects":["entity"]}',
    });
    const helmStatusAdapter: HelmStatusAdapter = {
      getStatus: async (agent) => ({
        source: 'helm',
        binding_id: agent.runtime_binding_id,
        state: 'degraded',
        health: 'degraded',
        readiness: 'degraded',
        current_work: 'Review stale runtime binding',
        heartbeat_at: null,
        checked_at: '2026-05-01T00:00:10.000Z',
        stale: true,
        reason: 'stale_runtime_binding',
        helm_link: null,
      }),
    };
    const app = express();
    app.use(express.json());
    app.use('/api', createAgentRegistryRouter({ agentRegistryRepo: agentRepo, moduleRegistryRepo: moduleRepo, helmStatusAdapter }));
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('test server failed to bind');
      const res = await fetch(`http://127.0.0.1:${address.port}/api/agents/registry`);
      expect(res.status).toBe(200);
      const json = await res.json() as {
        list: Array<{
          slug: string;
          runtime_binding_id: string | null;
          provider_type: string;
          helm_managed: boolean;
          binding_state: string;
          metadata_json: string;
          runtime_status: { state: string; readiness: string; current_work: string; reason: string };
          capabilities: { capabilityLabels: string[]; permissionLabels: string[]; scopeLabels: string[] };
        }>;
      };
      const managedAgent = json.list.find((entry) => entry.slug === 'opsbook');
      expect(managedAgent).toMatchObject({
        runtime_binding_id: 'runtime-opsbook',
        provider_type: 'helm_runtime',
        helm_managed: true,
        binding_state: 'stale',
        runtime_status: {
          state: 'degraded',
          readiness: 'degraded',
          current_work: 'Review stale runtime binding',
          reason: 'stale_runtime_binding',
        },
      });
      expect(JSON.parse(managedAgent?.metadata_json ?? '{}')).toEqual({ loops: ['daily review sweep'] });
      expect(managedAgent?.capabilities.capabilityLabels).toEqual(['Mission Control']);
      expect(managedAgent?.capabilities.permissionLabels).toEqual(['Read', 'Review']);
      expect(managedAgent?.capabilities.scopeLabels).toEqual(['Projects: Entity']);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});

describe('agent registry Helm light controls', () => {
  it('forwards only safe reversible controls with an audit fixture', async () => {
    const { agentRepo, moduleRepo } = createRepos();
    agentRepo.createAgent({
      slug: 'controlbook',
      name: 'Control Book',
      emoji: 'C',
      adapter_type: 'helm',
      runtime_type: 'remote',
      runtime_binding_id: 'runtime-controlbook',
      provider_type: 'helm_runtime',
      helm_managed: true,
      binding_state: 'bound',
      status: 'active',
      metadata_json: '{}',
    });
    const sent: Array<{ bindingId: string; action: string; audit: unknown }> = [];
    const helmLightControlAdapter: HelmLightControlAdapter = {
      requestControl: async (agent, action, actorPrincipalId) => {
        const audit = {
          event_type: 'helm_light_control_requested' as const,
          agent_id: agent.id,
          action,
          actor_principal_id: actorPrincipalId,
          runtime_binding_id: agent.runtime_binding_id,
          policy_allowed: true,
          policy_reason: 'policy_allowed_reversible_control',
          forwarded_to_helm: true,
          created_at: now,
        };
        sent.push({ bindingId: agent.runtime_binding_id ?? '', action, audit });
        return {
          accepted: true,
          status: 'accepted',
          action,
          reason: 'policy_allowed_reversible_control',
          audit,
          helm_link: 'https://helm.example/runtimes/runtime-controlbook',
        };
      },
    };
    const app = express();
    app.use(express.json());
    app.use('/api', createAgentRegistryRouter({ agentRegistryRepo: agentRepo, moduleRegistryRepo: moduleRepo, helmLightControlAdapter }));
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('test server failed to bind');
      const res = await fetch(`http://127.0.0.1:${address.port}/api/agents/controlbook/runtime-controls`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'pause', actorPrincipalId: 'human:reviewer' }),
      });
      expect(res.status).toBe(202);
      const json = await res.json() as {
        accepted: boolean;
        status: string;
        action: string;
        reason: string;
        helm_link: string;
        audit: {
          event_type: string;
          action: string;
          actor_principal_id: string;
          runtime_binding_id: string;
          policy_allowed: boolean;
          forwarded_to_helm: boolean;
        };
        deep_admin?: unknown;
        model_config?: unknown;
        deployment_settings?: unknown;
      };
      expect(json).toMatchObject({
        accepted: true,
        status: 'accepted',
        action: 'pause',
        reason: 'policy_allowed_reversible_control',
        helm_link: 'https://helm.example/runtimes/runtime-controlbook',
        audit: {
          event_type: 'helm_light_control_requested',
          action: 'pause',
          actor_principal_id: 'human:reviewer',
          runtime_binding_id: 'runtime-controlbook',
          policy_allowed: true,
          forwarded_to_helm: true,
        },
      });
      expect(json.deep_admin).toBeUndefined();
      expect(json.model_config).toBeUndefined();
      expect(json.deployment_settings).toBeUndefined();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ bindingId: 'runtime-controlbook', action: 'pause' });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('denies controls for stale bindings and rejects deep admin actions', async () => {
    const { agentRepo, moduleRepo } = createRepos();
    agentRepo.createAgent({
      slug: 'stalecontrol',
      name: 'Stale Control',
      emoji: 'S',
      adapter_type: 'helm',
      runtime_type: 'remote',
      runtime_binding_id: 'runtime-stalecontrol',
      provider_type: 'helm_runtime',
      helm_managed: true,
      binding_state: 'stale',
      status: 'active',
      metadata_json: '{}',
    });
    const app = express();
    app.use(express.json());
    app.use('/api', createAgentRegistryRouter({ agentRegistryRepo: agentRepo, moduleRegistryRepo: moduleRepo }));
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('test server failed to bind');
      const denied = await fetch(`http://127.0.0.1:${address.port}/api/agents/stalecontrol/runtime-controls`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'resume', actorPrincipalId: 'human:reviewer' }),
      });
      expect(denied.status).toBe(403);
      const deniedJson = await denied.json() as { accepted: boolean; reason: string; audit: { policy_allowed: boolean; forwarded_to_helm: boolean } };
      expect(deniedJson).toMatchObject({
        accepted: false,
        reason: 'runtime_binding_stale',
        audit: {
          policy_allowed: false,
          forwarded_to_helm: false,
        },
      });

      const unsafe = await fetch(`http://127.0.0.1:${address.port}/api/agents/stalecontrol/runtime-controls`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'deploy_runtime', actorPrincipalId: 'human:reviewer' }),
      });
      expect(unsafe.status).toBe(400);
      expect(await unsafe.json()).toEqual({ error: 'action must be one of: pause, resume, request_retry' });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('keeps Entity flows alive when Helm control forwarding is unavailable', async () => {
    const { agentRepo, moduleRepo } = createRepos();
    agentRepo.createAgent({
      slug: 'unavailablecontrol',
      name: 'Unavailable Control',
      emoji: 'U',
      adapter_type: 'helm',
      runtime_type: 'remote',
      runtime_binding_id: 'runtime-unavailablecontrol',
      provider_type: 'helm_runtime',
      helm_managed: true,
      binding_state: 'bound',
      status: 'active',
      metadata_json: '{}',
    });
    const app = express();
    app.use(express.json());
    app.use('/api', createAgentRegistryRouter({ agentRegistryRepo: agentRepo, moduleRegistryRepo: moduleRepo }));
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('test server failed to bind');
      const res = await fetch(`http://127.0.0.1:${address.port}/api/agents/unavailablecontrol/runtime-controls`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'request_retry', actorPrincipalId: 'human:reviewer' }),
      });
      expect(res.status).toBe(503);
      const json = await res.json() as {
        accepted: boolean;
        status: string;
        reason: string;
        audit: { policy_allowed: boolean; forwarded_to_helm: boolean; policy_reason: string };
      };
      expect(json).toMatchObject({
        accepted: false,
        status: 'unavailable',
        reason: 'helm_control_provider_unavailable',
        audit: {
          policy_allowed: true,
          forwarded_to_helm: false,
          policy_reason: 'helm_control_provider_unavailable',
        },
      });

      const registry = await fetch(`http://127.0.0.1:${address.port}/api/agents/registry`);
      expect(registry.status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
