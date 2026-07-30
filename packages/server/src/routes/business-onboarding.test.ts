import express from 'express';
import http from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AgentRegistryRecord,
  AgentRegistryRepository,
  CreateOrgInput,
  CreateProjectInput,
  CreateTaskInput,
  CreateTeamInput,
  OrgQueryContext,
  OrgRecord,
  ProjectRecord,
  TaskRecord,
  TeamRecord,
  UpdateAgentRegistryInput,
  UpdateOrgInput,
  UpdateProjectInput,
  UpdateTeamInput,
  WorkspaceScopeRepository,
} from '../../../db/src';
import { createBusinessOnboardingRouter, createTaskSyncLayerRepoFactory } from './business-onboarding';

const now = '2026-07-07T02:30:00.000Z';

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
}

function createOrgRecord(input: CreateOrgInput): OrgRecord {
  return {
    id: input.id ?? slugify(input.name),
    name: input.name,
    slug: input.slug ?? slugify(input.name),
    status: input.status ?? 'active',
    deployment_mode: input.deployment_mode ?? 'saas',
    mission: input.mission ?? null,
    domains_json: input.domains_json ?? '[]',
    blueprint_json: input.blueprint_json ?? null,
    created_at: now,
    updated_at: now,
  };
}

function createFakeWorkspaceRepo(): WorkspaceScopeRepository {
  const orgs = new Map<string, OrgRecord>();
  const teams = new Map<string, TeamRecord>();
  const projects = new Map<number, ProjectRecord>();
  let nextProjectId = 1;

  return {
    listOrgs: () => Array.from(orgs.values()).sort((a, b) => a.name.localeCompare(b.name)),
    getOrg: (orgId: string) => orgs.get(orgId),
    createOrg: (input: CreateOrgInput) => {
      const org = createOrgRecord(input);
      orgs.set(org.id, org);
      return org;
    },
    updateOrg: (orgId: string, updates: UpdateOrgInput) => {
      const current = orgs.get(orgId);
      if (!current) return undefined;
      const updated: OrgRecord = {
        ...current,
        ...updates,
        mission: typeof updates.mission === 'undefined' ? current.mission : updates.mission ?? null,
        blueprint_json: typeof updates.blueprint_json === 'undefined' ? current.blueprint_json : updates.blueprint_json ?? null,
        domains_json: updates.domains_json ?? current.domains_json,
        updated_at: now,
      };
      orgs.set(orgId, updated);
      return updated;
    },
    listTeams: (context: OrgQueryContext) =>
      Array.from(teams.values()).filter((team) => team.org_id === context.orgId),
    getTeam: (context: OrgQueryContext, teamId: string) => {
      const team = teams.get(teamId);
      return team?.org_id === context.orgId ? team : undefined;
    },
    createTeam: (context: OrgQueryContext, input: CreateTeamInput) => {
      const id = input.id ?? slugify(input.name);
      const team: TeamRecord = {
        id,
        org_id: context.orgId,
        name: input.name,
        slug: input.slug ?? slugify(input.name),
        status: input.status ?? 'active',
        created_at: now,
        updated_at: now,
      };
      teams.set(team.id, team);
      return team;
    },
    updateTeam: (context: OrgQueryContext, teamId: string, updates: UpdateTeamInput) => {
      const current = teams.get(teamId);
      if (!current || current.org_id !== context.orgId) return undefined;
      const updated = { ...current, ...updates, updated_at: now };
      teams.set(teamId, updated);
      return updated;
    },
    listProjects: (context: OrgQueryContext) =>
      Array.from(projects.values()).filter(
        (project) => project.org_id === context.orgId && (!context.teamId || project.team_id === context.teamId),
      ),
    getProject: (context: OrgQueryContext, projectId: number) => {
      const project = projects.get(projectId);
      if (!project || project.org_id !== context.orgId) return undefined;
      if (context.teamId && project.team_id !== context.teamId) return undefined;
      return project;
    },
    createProject: (context: OrgQueryContext, input: CreateProjectInput) => {
      const project: ProjectRecord = {
        id: nextProjectId++,
        org_id: context.orgId,
        team_id: input.team_id ?? context.teamId,
        name: input.name,
        color: input.color ?? null,
        lifecycle_state: input.lifecycle_state ?? 'active',
        created_at: now,
      };
      projects.set(project.id, project);
      return project;
    },
    updateProject: (context: OrgQueryContext, projectId: number, updates: UpdateProjectInput) => {
      const current = projects.get(projectId);
      if (!current || current.org_id !== context.orgId) return undefined;
      if (context.teamId && current.team_id !== context.teamId) return undefined;
      const updated = { ...current, ...updates };
      projects.set(projectId, updated);
      return updated;
    },
    getTaskProjects: () => [],
    addTaskProject: () => false,
    removeTaskProject: () => false,
  };
}

type FakeTaskRepoFactory = (context: OrgQueryContext) => {
  listTasks: () => TaskRecord[];
  createTask: (input: CreateTaskInput) => TaskRecord;
};

function createFakeTaskRepoFactory(): FakeTaskRepoFactory {
  const tasksByTeam = new Map<string, TaskRecord[]>();
  let nextTaskId = 1;

  return (context: OrgQueryContext) => {
    const key = `${context.orgId}:${context.teamId ?? 'default-team'}`;
    if (!tasksByTeam.has(key)) tasksByTeam.set(key, []);
    const tasks = tasksByTeam.get(key)!;
    return {
      listTasks: () => [...tasks],
      createTask: (input: CreateTaskInput) => {
        const task: TaskRecord = {
          id: nextTaskId++,
          org_id: context.orgId,
          team_id: input.team_id ?? context.teamId,
          project_id: input.project_id ?? null,
          created_by_principal_id: input.created_by_principal_id ?? null,
          initiator_principal_id: input.initiator_principal_id ?? null,
          initiator_type: input.initiator_type ?? null,
          owner_principal_id: input.owner_principal_id ?? null,
          owner_principal_type: input.owner_principal_type ?? null,
          executor_principal_id: input.executor_principal_id ?? null,
          assignment_state: input.assignment_state ?? null,
          taskmaster_drivable: Boolean(input.taskmaster_drivable),
          worktype: input.worktype ?? 'general',
          risk_level: 'low',
          agent_trust_level: 'unknown',
          policy_inputs_json: '{}',
          external_side_effects_json: '[]',
          external_side_effects: [],
          review_required: false,
          review_state: 'not_required',
          human_gate_required: false,
          human_gate_state: 'not_required',
          name: input.name,
          description: input.description ?? null,
          brief: input.brief ?? null,
          origin_channel: input.origin_channel ?? null,
          column: 'todo',
          model: input.model ?? null,
          archived: false,
          assignee: input.assignee ?? null,
          blocked: false,
          blocker_reason: null,
          due_date: null,
          priority: input.priority ?? null,
          estimate_hours: null,
          time_spent: null,
          output: null,
          progress_status: null,
          recurring: false,
          recurring_config: null,
          created_at: now,
          updated_at: now,
          metadata: input.metadata ?? null,
          project: input.project ?? null,
          projects: [],
        };
        tasks.push(task);
        return task;
      },
    };
  };
}

function createAgent(id: string, name: string): AgentRegistryRecord {
  return {
    id,
    slug: id,
    name,
    emoji: '🤖',
    avatar_url: null,
    description: null,
    adapter_type: null,
    runtime_type: null,
    runtime_binding_id: null,
    provider_type: 'unknown',
    helm_managed: false,
    binding_state: 'unknown',
    status: 'active',
    instructions_path: null,
    metadata_json: '{}',
    created_at: now,
    updated_at: now,
  };
}

function createFakeAgentRepo(): Pick<AgentRegistryRepository, 'listAgents'> & Partial<AgentRegistryRepository> {
  const agents = [
    createAgent('atlas', 'Atlas'),
    createAgent('mafa', 'Mafa'),
    createAgent('sabi', 'Sabi'),
    createAgent('kashy', 'Kashy'),
  ];
  return {
    listAgents: () => agents,
    getAgent: () => undefined,
    getAgentBySlug: () => undefined,
    createAgent: () => { throw new Error('business onboarding must not create agents'); },
    updateAgent: (_id: string, _updates: UpdateAgentRegistryInput) => undefined,
    deleteAgent: () => false,
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('business onboarding routes', () => {
  let baseUrl = '';
  let server: http.Server;
  let workspaceRepo: WorkspaceScopeRepository;

  beforeAll(async () => {
    workspaceRepo = createFakeWorkspaceRepo();
    const app = express();
    app.use(express.json());
    app.use('/api', createBusinessOnboardingRouter({
      workspaceRepo,
      agentRegistryRepo: createFakeAgentRepo() as AgentRegistryRepository,
      taskRepoFactory: createFakeTaskRepoFactory(),
      now: () => now,
    }));
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server failed to bind');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('starts an org with additive onboarding fields and publishes the Curacel-shaped taxonomy', async () => {
    const startRes = await fetch(`${baseUrl}/api/onboarding/business/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgName: 'Curacel' }),
    });

    expect(startRes.status).toBe(201);
    const body = await readJson(startRes);
    expect(body).toMatchObject({
      org: {
        id: 'curacel',
        name: 'Curacel',
        mission: null,
        domains_json: '[]',
        blueprint_json: null,
      },
    });
    expect((body.domains as Array<{ id: string }>).map((domain) => domain.id)).toEqual([
      'claims-ops',
      'engineering-devops',
      'product',
      'sales-bd',
      'marketing',
      'finance',
      'customer-success',
      'people-ops',
      'health-business',
      'ai-ops',
      'other',
    ]);
  });

  it('provisions teams, projects, seed tasks, and existing named-agent mappings', async () => {
    const orgRes = await fetch(`${baseUrl}/api/onboarding/business/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgName: 'Curacel Blueprints' }),
    });
    const orgId = ((await readJson(orgRes)).org as OrgRecord).id;

    const provisionRes = await fetch(`${baseUrl}/api/onboarding/business/${orgId}/provision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        domains: ['product', 'sales-bd', 'customer-success', 'finance'],
        mission: 'Coordinate Curacel agent operations across teams.',
      }),
    });

    expect(provisionRes.status).toBe(200);
    const provisionBody = await readJson(provisionRes);
    expect(provisionBody).toMatchObject({
      org: {
        id: orgId,
        mission: 'Coordinate Curacel agent operations across teams.',
      },
      blueprint: {
        schemaVersion: 1,
        orgId,
        mission: 'Coordinate Curacel agent operations across teams.',
        domains: ['product', 'sales-bd', 'customer-success', 'finance'],
      },
    });

    const blueprint = provisionBody.blueprint as {
      teams: Array<{ domainId: string; teamName: string; projectName: string; seedTaskIds: number[]; assignedAgent?: { agentName: string; agentPrincipalId: string; functionLabel: string } }>;
      agentAssignments: Array<{ domainId: string; agentName: string; agentPrincipalId: string; functionLabel: string }>;
    };
    expect(blueprint.teams.map((team) => team.domainId)).toEqual(['product', 'sales-bd', 'customer-success', 'finance']);
    expect(blueprint.teams.every((team) => team.seedTaskIds.length === 3)).toBe(true);
    expect(blueprint.agentAssignments).toEqual([
      expect.objectContaining({ domainId: 'product', agentName: 'Atlas', agentPrincipalId: 'atlas', functionLabel: 'Product' }),
      expect.objectContaining({ domainId: 'sales-bd', agentName: 'Mafa', agentPrincipalId: 'mafa', functionLabel: 'Commercial' }),
      expect.objectContaining({ domainId: 'customer-success', agentName: 'Sabi', agentPrincipalId: 'sabi', functionLabel: 'Customer Success' }),
      expect.objectContaining({ domainId: 'finance', agentName: 'Kashy', agentPrincipalId: 'kashy', functionLabel: 'Finance' }),
    ]);

    expect(workspaceRepo.listTeams({ orgId }).map((team) => team.name)).toEqual([
      'Product',
      'Commercial',
      'Customer Success',
      'Finance',
    ]);

    const confirmRes = await fetch(`${baseUrl}/api/onboarding/business/${orgId}/confirm`, { method: 'POST' });
    expect(confirmRes.status).toBe(200);
    expect(await readJson(confirmRes)).toMatchObject({ confirmed: true, blueprint: { orgId } });
  });

  it('rejects unsupported business domains without provisioning', async () => {
    const orgRes = await fetch(`${baseUrl}/api/onboarding/business/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgName: 'Invalid Domain Co' }),
    });
    const orgId = ((await readJson(orgRes)).org as OrgRecord).id;

    const provisionRes = await fetch(`${baseUrl}/api/onboarding/business/${orgId}/provision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domains: ['software-ai'], mission: 'Use the old Matrix taxonomy.' }),
    });

    expect(provisionRes.status).toBe(400);
    expect(await readJson(provisionRes)).toEqual({ error: 'unsupported domains: software-ai' });
  });

  it('requires an injected taskRepoFactory instead of defaulting to a standalone org-scoped repository', () => {
    expect(() => createBusinessOnboardingRouter({ workspaceRepo } as Parameters<typeof createBusinessOnboardingRouter>[0])).toThrow(
      /taskRepoFactory is required/i,
    );
  });

  it('exposes a taskSyncLayer-compatible factory helper for production wiring', async () => {
    const created: CreateTaskInput[] = [];
    const factory = createTaskSyncLayerRepoFactory({
      listTasks: async () => [],
      createTask: async (input) => {
        created.push(input);
        return {
          id: created.length,
          org_id: input.org_id,
          team_id: input.team_id,
          project_id: input.project_id ?? null,
          created_by_principal_id: null,
          initiator_principal_id: null,
          initiator_type: null,
          owner_principal_id: null,
          owner_principal_type: null,
          executor_principal_id: null,
          assignment_state: null,
          taskmaster_drivable: false,
          worktype: 'general',
          risk_level: 'low',
          agent_trust_level: 'unknown',
          policy_inputs_json: '{}',
          external_side_effects_json: '[]',
          external_side_effects: [],
          review_required: false,
          review_state: 'not_required',
          human_gate_required: false,
          human_gate_state: 'not_required',
          name: input.name,
          description: null,
          brief: null,
          origin_channel: null,
          column: 'todo',
          model: null,
          archived: false,
          assignee: null,
          blocked: false,
          blocker_reason: null,
          due_date: null,
          priority: null,
          estimate_hours: null,
          time_spent: null,
          output: null,
          progress_status: null,
          recurring: false,
          recurring_config: null,
          created_at: now,
          updated_at: now,
          metadata: null,
          project: null,
          projects: [],
        } as TaskRecord;
      },
    });
    const repo = factory({ orgId: 'curacel', teamId: 'product' });
    await repo.createTask({ name: 'Seed via shared path', org_id: 'curacel', team_id: 'product' });
    expect(created).toHaveLength(1);
    expect(created[0]?.name).toBe('Seed via shared path');
  });

  it('provisions seed tasks through async taskSyncLayer-compatible repo methods', async () => {
    const asyncTasks: TaskRecord[] = [];
    let nextId = 100;
    const asyncApp = express();
    asyncApp.use(express.json());
    asyncApp.use('/api', createBusinessOnboardingRouter({
      workspaceRepo,
      agentRegistryRepo: createFakeAgentRepo() as AgentRegistryRepository,
      taskRepoFactory: () => ({
        listTasks: async () => [...asyncTasks],
        createTask: async (input: CreateTaskInput) => {
          const task = {
            id: nextId++,
            org_id: input.org_id,
            team_id: input.team_id,
            project_id: input.project_id ?? null,
            created_by_principal_id: input.created_by_principal_id ?? null,
            initiator_principal_id: input.initiator_principal_id ?? null,
            initiator_type: input.initiator_type ?? null,
            owner_principal_id: input.owner_principal_id ?? null,
            owner_principal_type: input.owner_principal_type ?? null,
            executor_principal_id: input.executor_principal_id ?? null,
            assignment_state: input.assignment_state ?? null,
            taskmaster_drivable: Boolean(input.taskmaster_drivable),
            worktype: input.worktype ?? 'general',
            risk_level: 'low',
            agent_trust_level: 'unknown',
            policy_inputs_json: '{}',
            external_side_effects_json: '[]',
            external_side_effects: [],
            review_required: false,
            review_state: 'not_required',
            human_gate_required: false,
            human_gate_state: 'not_required',
            name: input.name,
            description: input.description ?? null,
            brief: input.brief ?? null,
            origin_channel: input.origin_channel ?? null,
            column: 'todo',
            model: input.model ?? null,
            archived: false,
            assignee: input.assignee ?? null,
            blocked: false,
            blocker_reason: null,
            due_date: null,
            priority: input.priority ?? null,
            estimate_hours: null,
            time_spent: null,
            output: null,
            progress_status: null,
            recurring: false,
            recurring_config: null,
            created_at: now,
            updated_at: now,
            metadata: input.metadata ?? null,
            project: input.project ?? null,
            projects: [],
          } as TaskRecord;
          asyncTasks.push(task);
          return task;
        },
      }),
      now: () => now,
    }));
    const asyncServer = http.createServer(asyncApp);
    await new Promise<void>((resolve) => asyncServer.listen(0, resolve));
    const address = asyncServer.address();
    if (!address || typeof address === 'string') throw new Error('async test server failed to bind');
    const asyncBase = `http://127.0.0.1:${address.port}`;

    try {
      const orgRes = await fetch(`${asyncBase}/api/onboarding/business/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgName: 'Async Task Sync Co' }),
      });
      const orgId = ((await readJson(orgRes)).org as OrgRecord).id;
      const provisionRes = await fetch(`${asyncBase}/api/onboarding/business/${orgId}/provision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          domains: ['product'],
          mission: 'Prove seed tasks use async shared task path.',
        }),
      });
      expect(provisionRes.status).toBe(200);
      const body = await readJson(provisionRes);
      const blueprint = body.blueprint as { teams: Array<{ seedTaskIds: number[] }> };
      expect(blueprint.teams[0]?.seedTaskIds).toHaveLength(3);
      expect(asyncTasks).toHaveLength(3);
      expect(asyncTasks.every((task) => task.org_id === orgId)).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => asyncServer.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('rejects empty-domain provision without creating a blueprint', async () => {
    const orgRes = await fetch(`${baseUrl}/api/onboarding/business/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgName: 'Empty Domain Co' }),
    });
    const orgId = ((await readJson(orgRes)).org as OrgRecord).id;

    const provisionRes = await fetch(`${baseUrl}/api/onboarding/business/${orgId}/provision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domains: [], mission: 'No domains selected.' }),
    });

    expect(provisionRes.status).toBe(400);
    expect(await readJson(provisionRes)).toEqual({ error: 'at least one business domain is required' });
    expect(workspaceRepo.getOrg(orgId)?.blueprint_json).toBeNull();
  });

  it('rejects confirm without provision', async () => {
    const orgRes = await fetch(`${baseUrl}/api/onboarding/business/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgName: 'Confirm Early Co' }),
    });
    const orgId = ((await readJson(orgRes)).org as OrgRecord).id;

    const confirmRes = await fetch(`${baseUrl}/api/onboarding/business/${orgId}/confirm`, { method: 'POST' });
    expect(confirmRes.status).toBe(409);
    expect(await readJson(confirmRes)).toEqual({ error: 'business blueprint has not been provisioned' });
  });

  it('durably persists confirmation inside blueprint_json and stays idempotent', async () => {
    const orgRes = await fetch(`${baseUrl}/api/onboarding/business/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgName: 'Confirm Persist Co' }),
    });
    const orgId = ((await readJson(orgRes)).org as OrgRecord).id;

    const provisionRes = await fetch(`${baseUrl}/api/onboarding/business/${orgId}/provision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        domains: ['ai-ops'],
        mission: 'Persist confirmation without a schema migration.',
      }),
    });
    expect(provisionRes.status).toBe(200);

    const confirmRes = await fetch(`${baseUrl}/api/onboarding/business/${orgId}/confirm`, { method: 'POST' });
    expect(confirmRes.status).toBe(200);
    const confirmBody = await readJson(confirmRes);
    expect(confirmBody).toMatchObject({
      confirmed: true,
      blueprint: {
        orgId,
        confirmedAt: now,
      },
    });

    const stored = workspaceRepo.getOrg(orgId);
    expect(stored?.blueprint_json).toContain('"confirmedAt"');
    expect(JSON.parse(stored?.blueprint_json ?? '{}')).toMatchObject({ confirmedAt: now });

    const secondConfirm = await fetch(`${baseUrl}/api/onboarding/business/${orgId}/confirm`, { method: 'POST' });
    expect(secondConfirm.status).toBe(200);
    const secondBody = await readJson(secondConfirm);
    expect(secondBody).toMatchObject({
      confirmed: true,
      blueprint: { confirmedAt: now },
    });
    expect(JSON.parse(workspaceRepo.getOrg(orgId)?.blueprint_json ?? '{}')).toMatchObject({ confirmedAt: now });
  });
});
