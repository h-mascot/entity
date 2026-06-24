import express from 'express';
import http from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAgentRegistryRouter } from '../routes/agent-registry';
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
    });
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
