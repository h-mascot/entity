import { createHash, randomUUID } from 'crypto';
import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentRegistryRecord,
  AgentRegistryRepository,
  ModuleRegistryRepository,
  WorkspaceScopeRepository,
} from '../../../db/src';
const dbPaths: string[] = [];
const now = '2026-07-28T17:30:00.000Z';

function createAgentRepo(): AgentRegistryRepository {
  const agents = new Map<string, AgentRegistryRecord>();
  return {
    listAgents: () => [...agents.values()],
    getAgent: (id) => agents.get(id),
    getAgentBySlug: (slug) => [...agents.values()].find((agent) => agent.slug === slug),
    createAgent: (input) => {
      const agent: AgentRegistryRecord = {
        id: input.id ?? randomUUID(),
        slug: input.slug,
        name: input.name,
        emoji: input.emoji,
        avatar_url: input.avatar_url ?? null,
        description: input.description ?? null,
        adapter_type: input.adapter_type ?? null,
        runtime_type: input.runtime_type ?? null,
        runtime_binding_id: input.runtime_binding_id ?? null,
        provider_type: (input.provider_type as AgentRegistryRecord['provider_type'] | undefined) ?? 'unknown',
        helm_managed: input.helm_managed ?? false,
        binding_state: (input.binding_state as AgentRegistryRecord['binding_state'] | undefined) ?? 'unknown',
        status: input.status ?? 'active',
        instructions_path: null,
        metadata_json: input.metadata_json ?? '{}',
        created_at: now,
        updated_at: now,
      };
      agents.set(agent.id, agent);
      return agent;
    },
    updateAgent: (id, updates) => {
      const current = agents.get(id);
      if (!current) return undefined;
      const updated = { ...current, ...updates, updated_at: now } as AgentRegistryRecord;
      agents.set(id, updated);
      return updated;
    },
    deleteAgent: (id) => agents.delete(id),
  };
}

function createModuleRepo() {
  const grants: Array<{ agent_id: string; module_id: string; scope_json: string }> = [];
  let enabled = true;
  const repo = {
    listModules: () => [{
      id: 'mission-control',
      slug: 'mission-control',
      name: 'Mission Control',
      description: null,
      enabled,
      icon: null,
      kind: 'core',
      permissions_schema_json: '[]',
      ui_config_json: '{}',
      created_at: now,
      updated_at: now,
    }],
    listModuleSkillRefs: () => [],
    listAgentModuleGrants: (agentId: string) => grants.filter((grant) => grant.agent_id === agentId).map((grant) => ({
      id: `${grant.agent_id}:${grant.module_id}`,
      enabled: true,
      permissions_json: '[]',
      created_at: now,
      updated_at: now,
      ...grant,
    })),
    upsertAgentModuleGrant: (input: { agent_id: string; module_id: string; scope_json?: string }) => {
      const grant = {
        agent_id: input.agent_id,
        module_id: input.module_id,
        scope_json: input.scope_json ?? '{}',
      };
      grants.push(grant);
      return {
        id: `${grant.agent_id}:${grant.module_id}`,
        enabled: true,
        permissions_json: '[]',
        created_at: now,
        updated_at: now,
        ...grant,
      };
    },
    deleteAgentModuleGrant: () => false,
  } satisfies ModuleRegistryRepository;
  return {
    repo,
    grants,
    disableModule: () => {
      enabled = false;
    },
  };
}

function createWorkspaceRepo(): Pick<WorkspaceScopeRepository, 'getOrg' | 'listTeams' | 'getTeam'> {
  const org = {
    id: 'org-a',
    name: 'Org A',
    slug: 'org-a',
    status: 'active',
    deployment_mode: 'saas',
    mission: null,
    domains_json: '[]',
    blueprint_json: null,
    created_at: now,
    updated_at: now,
  };
  const team = {
    id: 'team-a',
    org_id: 'org-a',
    name: 'Operations',
    slug: 'operations',
    status: 'active',
    created_at: now,
    updated_at: now,
  };
  return {
    getOrg: (id) => id === org.id ? org : undefined,
    listTeams: ({ orgId }) => orgId === org.id ? [team] : [],
    getTeam: ({ orgId }, id) => orgId === org.id && id === team.id ? team : undefined,
  };
}

async function setup() {
  const dbPath = path.join(os.tmpdir(), `entity-agent-import-route-${process.pid}-${randomUUID()}.sqlite`);
  dbPaths.push(dbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', dbPath);
  vi.stubEnv('MISSION_CONTROL_DB_PATH', `${dbPath}.missing`);
  const [{ createAgentImportRepository }, { createAgentImportRouter }] = await Promise.all([
    import('../../../db/src/agent-import'),
    import('./agent-import'),
  ]);
  const agentRepo = createAgentRepo();
  const { repo: moduleRepo, grants, disableModule } = createModuleRepo();
  const app = express();
  app.use(express.json());
  const importRepo = createAgentImportRepository();
  app.use('/api', createAgentImportRouter({
    importRepo,
    agentRegistryRepo: agentRepo,
    moduleRegistryRepo: moduleRepo,
    workspaceRepo: createWorkspaceRepo(),
    chatRepo: {
      // Luna-high F4: the route must resolve channels through the org-scoped
      // (authoritative) lookup — 'operations' is org-a's, 'channel-b' belongs
      // to org-b, 'team-z-channel' is org-a but team-scoped outside team-a.
      getChannel: (id: string, orgId?: string) => {
        const channels: Record<string, { id: string; org_id: string | null; team_id: string | null }> = {
          operations: { id: 'operations', org_id: 'org-a', team_id: null },
          'channel-b': { id: 'channel-b', org_id: 'org-b', team_id: 'team-b' },
          'team-z-channel': { id: 'team-z-channel', org_id: 'org-a', team_id: 'team-z' },
        };
        const channel = channels[id];
        return channel && (orgId === undefined || channel.org_id === orgId) ? channel : undefined;
      },
    },
  }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  return {
    agentRepo,
    importRepo,
    grants,
    disableModule,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    get: async () => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/orgs/org-a/agent-imports`);
      return { status: response.status, body: await response.json() as Record<string, any> };
    },
    getOptions: async () => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/orgs/org-a/agent-import-options`);
      return { status: response.status, body: await response.json() as Record<string, any> };
    },
    post: async (key: string, payload: unknown) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/orgs/org-a/agent-imports`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify(payload),
      });
      return { status: response.status, body: await response.json() as Record<string, any> };
    },
  };
}

async function setupWithRealRepositories() {
  const dbPath = path.join(os.tmpdir(), `entity-agent-import-real-route-${process.pid}-${randomUUID()}.sqlite`);
  dbPaths.push(dbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', dbPath);
  vi.stubEnv('MISSION_CONTROL_DB_PATH', `${dbPath}.missing`);
  const [dbModule, { createAgentImportRouter }] = await Promise.all([
    import('../../../db/src'),
    import('./agent-import'),
  ]);
  const importRepo = dbModule.createAgentImportRepository();
  const agentRepo = dbModule.createAgentRegistryRepository();
  const moduleRepo = dbModule.createModuleRegistryRepository();
  const app = express();
  app.use(express.json());
  app.use('/api', createAgentImportRouter({
    importRepo,
    agentRegistryRepo: agentRepo,
    moduleRegistryRepo: moduleRepo,
    workspaceRepo: createWorkspaceRepo(),
    chatRepo: { getChannel: () => undefined },
    skipAdminAuth: true,
  }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  return {
    importRepo,
    agentRepo,
    moduleRepo,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    post: async (key: string, payload: unknown) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/orgs/org-a/agent-imports`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify(payload),
      });
      return { status: response.status, body: await response.json() as Record<string, any> };
    },
  };
}

afterEach(async () => {
  try {
    const { getEntityDatabase } = await import('../../../db/src/entity-db');
    getEntityDatabase().close();
  } catch {
    // Missing implementation is expected during the red phase.
  }
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const dbPath of dbPaths.splice(0)) {
    for (const candidate of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(candidate, { force: true });
  }
});

describe('agent import routes', () => {
  it('imports a generic runtime manifest once with scoped capability and reference mappings', async () => {
    const { agentRepo, grants, get, post, close } = await setup();
    const payload = {
      source: 'runtime-fleet',
      agents: [{
        externalId: 'runtime-agent-42',
        name: 'Operations Agent',
        slug: 'operations-agent',
        emoji: '🛠️',
        teamIds: ['team-a'],
        moduleIds: ['mission-control'],
        channelIds: ['operations'],
        reviewPolicy: { required: true, humanGateRequired: true },
      }],
    };
    const first = await post('import-1', payload);
    const replay = await post('import-1', payload);
    const restored = await get();

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.receipt).toEqual(first.body.receipt);
    expect(restored.body.latestReceipt).toEqual(first.body.receipt);
    expect(restored.body.mappings).toHaveLength(1);
    expect(agentRepo.listAgents()).toHaveLength(1);
    expect(first.body.receipt).toMatchObject({
      orgId: 'org-a',
      source: 'runtime-fleet',
      createdAgentIds: [expect.any(String)],
      channelAccessGranted: false,
    });
    expect(grants).toHaveLength(1);
    expect(JSON.parse(grants[0].scope_json)).toEqual({
      org_id: 'org-a',
      team_ids: ['team-a'],
      channel_ids: ['operations'],
      source: 'agent-import',
    });
    await close();
  });

  it('replays a stored receipt after referenced live catalog state is disabled', async () => {
    const { disableModule, post, close } = await setup();
    const payload = {
      source: 'runtime-fleet',
      agents: [{
        externalId: 'runtime-agent-42',
        name: 'Operations Agent',
        slug: 'operations-agent',
        emoji: '🛠️',
        teamIds: ['team-a'],
        moduleIds: ['mission-control'],
        channelIds: ['operations'],
        reviewPolicy: { required: true, humanGateRequired: true },
      }],
    };
    const first = await post('durable-replay', payload);
    disableModule();
    const replay = await post('durable-replay', payload);

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.receipt).toEqual(first.body.receipt);
    await close();
  });

  it('returns the organization total mapping count after incremental imports', async () => {
    const { post, close } = await setup();
    const importAgent = (externalId: string, slug: string) => ({
      source: 'runtime-fleet',
      agents: [{
        externalId,
        name: `Agent ${externalId}`,
        slug,
        emoji: '🤖',
        teamIds: ['team-a'],
        moduleIds: [],
        channelIds: [],
        reviewPolicy: { required: false, humanGateRequired: false },
      }],
    });

    const first = await post('incremental-1', importAgent('runtime-agent-1', 'runtime-agent-1'));
    const second = await post('incremental-2', importAgent('runtime-agent-2', 'runtime-agent-2'));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.mappingCount).toBe(2);
    await close();
  });

  it('creates an organization-local alias when an existing registry agent belongs to another organization', async () => {
    const { agentRepo, importRepo, post, close } = await setup();
    const sharedAgent = agentRepo.createAgent({
      id: 'atlas',
      slug: 'atlas',
      name: 'Atlas',
      emoji: '🧭',
      adapter_type: 'runtime-adapter',
      runtime_type: 'openclaw',
      runtime_binding_id: 'atlas-runtime',
      provider_type: 'helm_runtime',
      helm_managed: true,
      binding_state: 'bound',
      metadata_json: JSON.stringify({ runtime: 'shared', apiKey: 'must-not-copy' }),
    });
    importRepo.upsertMapping({
      org_id: 'org-b',
      source: 'runtime-fleet',
      external_id: 'atlas-shared',
      agent_id: sharedAgent.id,
      team_ids: ['team-b'],
      module_ids: [],
      channel_ids: [],
      review_policy: { required: true, human_gate_required: true },
      imported_by_user_id: 'org-b-owner',
    });

    const payload = {
      source: 'curacel-synthetic-qa',
      agents: [{
        externalId: 'curacel-atlas',
        existingAgentId: sharedAgent.id,
        teamIds: ['team-a'],
        moduleIds: [],
        channelIds: [],
        reviewPolicy: { required: true, humanGateRequired: true },
      }],
    };
    const response = await post('org-local-alias', payload);

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.receipt).toMatchObject({
      createdAgentIds: [expect.any(String)],
      reusedAgentIds: [],
      mappingIds: [expect.any(String)],
      channelAccessGranted: false,
    });
    const aliasId = response.body.receipt.createdAgentIds[0];
    expect(aliasId).not.toBe(sharedAgent.id);
    expect(importRepo.getMapping('org-a', 'curacel-synthetic-qa', 'curacel-atlas')).toMatchObject({
      agent_id: aliasId,
      source_agent_id: sharedAgent.id,
    });
    const alias = agentRepo.getAgent(aliasId);
    expect(alias).toMatchObject({
      name: 'Atlas',
      status: 'active',
      adapter_type: null,
      runtime_type: null,
      runtime_binding_id: null,
      provider_type: 'unknown',
      helm_managed: false,
      binding_state: 'unknown',
    });
    expect(JSON.stringify(alias)).not.toContain('must-not-copy');
    agentRepo.updateAgent(aliasId, {
      metadata_json: JSON.stringify({ edited_by_org_admin: true, alias_of: 'tampered' }),
    });

    const reimport = await post('org-local-alias-new-receipt', payload);
    expect(reimport.status, JSON.stringify(reimport.body)).toBe(201);
    expect(reimport.body).toMatchObject({
      mappingCount: 1,
      receipt: {
        createdAgentIds: [],
        reusedAgentIds: [aliasId],
        mappingIds: [response.body.receipt.mappingIds[0]],
      },
    });
    expect(agentRepo.listAgents()).toHaveLength(2);
    await close();
  });

  it('exposes only non-secret live-registry mapping options for the organization', async () => {
    const owner = await setup();
    const imported = await owner.post('member-options-import', {
      source: 'runtime-fleet',
      agents: [{
        externalId: 'operations-agent',
        name: 'Operations Agent',
        slug: 'operations-agent',
        teamIds: ['team-a'],
        moduleIds: [],
        channelIds: [],
        reviewPolicy: { required: true, humanGateRequired: true },
      }],
    });
    const expectedAgentId = imported.body.receipt.createdAgentIds[0];
    await owner.close();

    const member = await setup();
    member.agentRepo.createAgent({
      id: expectedAgentId,
      slug: 'operations-agent-member-view',
      name: 'Operations Agent',
      emoji: '🤖',
    });
    member.importRepo.upsertMapping({
      org_id: 'org-a',
      source: 'runtime-fleet',
      external_id: 'operations-agent',
      agent_id: expectedAgentId,
      team_ids: ['team-a'],
      module_ids: ['mission-control'],
      channel_ids: ['operations'],
      review_policy: { required: true, human_gate_required: true },
      imported_by_user_id: 'owner-1',
    });
    member.importRepo.upsertMapping({
      org_id: 'org-a',
      source: 'runtime-fleet',
      external_id: 'deleted-agent',
      agent_id: 'deleted-agent',
      team_ids: ['team-a'],
      module_ids: [],
      channel_ids: [],
      review_policy: { required: true, human_gate_required: true },
      imported_by_user_id: 'owner-1',
    });
    const options = await member.getOptions();

    expect(options.status).toBe(200);
    expect(options.body).toEqual({
      mappings: [{
        agent_id: expectedAgentId,
        external_id: 'operations-agent',
        team_ids: ['team-a'],
        mapping_kind: 'direct',
        runtime_ready: false,
      }],
    });
    expect(JSON.stringify(options.body)).not.toMatch(/review|module|channel|source_agent|imported_by|binding|provider/i);
    await member.close();
  });

  it('rolls back real registry, grant, mapping, and receipt writes on a late batch conflict', async () => {
    const { importRepo, agentRepo, moduleRepo, post, close } = await setupWithRealRepositories();
    const firstAgentId = `imported-${createHash('sha256')
      .update(JSON.stringify(['org-a', 'runtime-fleet', 'runtime-agent-1']))
      .digest('hex')
      .slice(0, 24)}`;
    const response = await post('late-conflict', {
      source: 'runtime-fleet',
      agents: [
        {
          externalId: 'runtime-agent-1',
          name: 'First Agent',
          slug: 'shared-agent-slug',
          emoji: '1️⃣',
          teamIds: ['team-a'],
          moduleIds: ['tasks'],
          channelIds: [],
          reviewPolicy: { required: false, humanGateRequired: false },
        },
        {
          externalId: 'runtime-agent-2',
          name: 'Second Agent',
          slug: 'shared-agent-slug',
          emoji: '2️⃣',
          teamIds: ['team-a'],
          moduleIds: [],
          channelIds: [],
          reviewPolicy: { required: false, humanGateRequired: false },
        },
      ],
    });

    expect(response.status, JSON.stringify(response.body)).toBe(409);
    expect(response.body.error).toMatch(/slug already exists/i);
    expect(agentRepo.getAgent(firstAgentId)).toBeUndefined();
    expect(moduleRepo.listAgentModuleGrants(firstAgentId)).toEqual([]);
    expect(importRepo.listMappings('org-a')).toEqual([]);
    expect(importRepo.getReceiptByIdempotencyKey('org-a', 'late-conflict')).toBeUndefined();
    await close();
  });

  it('requires an explicit existing agent selection and fails closed on invalid scopes', async () => {
    const { agentRepo, post, close } = await setup();
    agentRepo.createAgent({ id: 'existing', slug: 'existing', name: 'Existing', emoji: '🤖' });
    const collision = await post('collision', {
        source: 'runtime-fleet',
        agents: [{
          externalId: 'runtime-existing',
          name: 'Collision',
          slug: 'existing',
          teamIds: ['team-a'],
          moduleIds: [],
          channelIds: [],
          reviewPolicy: { required: false, humanGateRequired: false },
        }],
      });
    expect(collision.status).toBe(409);
    expect(collision.body.error).toMatch(/existingAgentId/i);

    const invalidTeam = await post('invalid-team', {
        source: 'runtime-fleet',
        agents: [{
          externalId: 'runtime-new',
          name: 'New',
          slug: 'new-agent',
          teamIds: ['other-org-team'],
          moduleIds: [],
          channelIds: [],
          reviewPolicy: { required: false, humanGateRequired: false },
        }],
      });
    expect(invalidTeam.status).toBe(400);
    expect(invalidTeam.body.error).toMatch(/team/i);

    const credential = await post('credential', {
      source: 'runtime-fleet',
      agents: [{
        externalId: 'runtime-secret',
        existingAgentId: 'existing',
        teamIds: ['team-a'],
        moduleIds: [],
        channelIds: [],
        reviewPolicy: { required: false, humanGateRequired: false },
        apiKey: 'must-not-be-accepted',
      }],
    });
    expect(credential.status).toBe(400);
    expect(credential.body.error).toMatch(/unsupported fields/i);
    await close();
  });

  // Luna-high F4: channel references must resolve through the authoritative
  // org/team-aware lookup. A channel owned by another organization (or scoped
  // to a team outside the import) must be rejected before any mapping, grant,
  // or receipt exists — zero side effects.
  it('rejects channels owned by another organization with zero side effects', async () => {
    const { agentRepo, importRepo, grants, post, close } = await setup();
    const rejected = await post('cross-tenant-channel', {
      source: 'runtime-fleet',
      agents: [{
        externalId: 'runtime-agent-77',
        name: 'Cross Channel Agent',
        slug: 'cross-channel-agent',
        teamIds: ['team-a'],
        moduleIds: ['mission-control'],
        channelIds: ['operations', 'channel-b'],
        reviewPolicy: { required: false, humanGateRequired: false },
      }],
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toMatch(/channel/);

    // Zero side effects: no agents, mappings, grants, or receipts.
    expect(agentRepo.listAgents()).toEqual([]);
    expect(importRepo.listMappings('org-a')).toEqual([]);
    expect(importRepo.listMappings('org-b')).toEqual([]);
    expect(grants).toEqual([]);
    expect(importRepo.getLatestReceipt('org-a')).toBeUndefined();
    expect(importRepo.getReceiptByIdempotencyKey('org-a', 'cross-tenant-channel')).toBeUndefined();
    await close();
  });

  it('rejects same-org channels scoped to a team outside the import with zero side effects', async () => {
    const { agentRepo, importRepo, grants, post, close } = await setup();
    const rejected = await post('cross-team-channel', {
      source: 'runtime-fleet',
      agents: [{
        externalId: 'runtime-agent-78',
        name: 'Cross Team Agent',
        slug: 'cross-team-agent',
        teamIds: ['team-a'],
        moduleIds: [],
        channelIds: ['team-z-channel'],
        reviewPolicy: { required: false, humanGateRequired: false },
      }],
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toMatch(/channel/);
    expect(agentRepo.listAgents()).toEqual([]);
    expect(importRepo.listMappings('org-a')).toEqual([]);
    expect(grants).toEqual([]);
    expect(importRepo.getLatestReceipt('org-a')).toBeUndefined();
    await close();
  });

  // REC-006 adaptation: the historical membership-role gate (ORG_ADMIN_REQUIRED)
  // is superseded by main's admin-principal middleware (createRequireAdminPrincipal),
  // whose deny paths are covered by packages/server/src/middleware/admin-auth.test.ts.
  // These route tests focus on import logic behind that gate (skipAdminAuth seam).
});
