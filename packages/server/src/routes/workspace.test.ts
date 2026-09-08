import express from 'express';
import http from 'http';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  CreateOrgInput,
  CreateProjectInput,
  CreateTeamInput,
  OrgQueryContext,
  OrgRecord,
  ProjectRecord,
  TeamRecord,
  UpdateOrgInput,
  UpdateProjectInput,
  UpdateTeamInput,
  WorkspaceScopeRepository,
} from '../../../db/src';
import {
  createPrincipalRepository,
  ensurePrincipalsSchema,
} from '../../../db/src/principals';
import {
  createAccessTokenRepository,
  ensureAccessTokensSchema,
} from '../../../db/src/access-tokens';
import type { PrincipalGrant } from '../permissions';
import { createApiAuthMiddleware } from '../middleware/api-auth';
import { createDataPlaneCredentialGuard } from '../middleware/data-plane-credential';
import { createCustomerPrincipalMiddleware } from '../principals/request-context';
import { buildCustomerPrincipalContext } from '../principals/request-context';
import { createAdminWorkspaceRouter, createWorkspaceRouter } from './workspace';

const now = '2026-06-23T00:00:00.000Z';
let requestServerSequence = 0;

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
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
      const id = input.id ?? slugify(input.name);
      const org: OrgRecord = {
        id,
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
      orgs.set(org.id, org);
      return org;
    },
    updateOrg: (orgId: string, updates: UpdateOrgInput) => {
      const current = orgs.get(orgId);
      if (!current) return undefined;
      const updated = {
        ...current,
        ...updates,
        mission: typeof updates.mission === 'undefined' ? current.mission : updates.mission ?? null,
        domains_json: updates.domains_json ?? current.domains_json,
        blueprint_json: typeof updates.blueprint_json === 'undefined' ? current.blueprint_json : updates.blueprint_json ?? null,
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
        project_key: input.project_key ?? null,
        work_domain: input.work_domain ?? null,
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

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function requestAsPrincipal(
  workspaceRepo: WorkspaceScopeRepository,
  grants: PrincipalGrant[],
  path: string,
  init: RequestInit,
): Promise<Response> {
  const app = express();
  app.use(express.json());
  const serverMarker = `workspace-test-${++requestServerSequence}`;
  app.use((_req, res, next) => {
    res.setHeader('x-workspace-test-server', serverMarker);
    next();
  });
  app.use((req, _res, next) => {
    req.entityCustomerPrincipal = buildCustomerPrincipalContext({
      principalId: 'workspace-test-principal',
      principalType: 'human',
      permission: { principal_id: 'workspace-test-principal', grants },
    });
    next();
  });
  app.use('/api', createWorkspaceRouter({ workspaceRepo }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server failed to bind');
  try {
    // Each authorization case owns a short-lived server; do not pool sockets
    // across cases.
    const headers = new Headers(init.headers);
    headers.set('connection', 'close');
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { ...init, headers });
    if (response.status === 401 && response.headers.get('x-workspace-test-server') !== serverMarker) {
      const body = await response.clone().text();
      throw new Error(
        `workspace helper received a 401 from the wrong server (expected ${serverMarker}, `
        + `got ${response.headers.get('x-workspace-test-server') ?? 'no marker'}): ${body.slice(0, 240)}`,
      );
    }
    return response;
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

describe('workspace hierarchy routes', () => {
  let baseUrl = '';
  let server: http.Server;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', createWorkspaceRouter({ workspaceRepo: createFakeWorkspaceRepo() }));
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server failed to bind');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('creates, lists, reads, and updates org-scoped hierarchy objects', async () => {
    const orgRes = await fetch(`${baseUrl}/api/orgs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'org-a',
        name: 'Org A',
        deployment_mode: 'enterprise_self_deploy',
        mission: 'Run a scoped business workspace.',
        domains_json: JSON.stringify(['product']),
      }),
    });
    expect(orgRes.status).toBe(201);
    expect(await readJson(orgRes)).toMatchObject({
      org: {
        id: 'org-a',
        name: 'Org A',
        deployment_mode: 'enterprise_self_deploy',
        mission: 'Run a scoped business workspace.',
        domains_json: JSON.stringify(['product']),
        blueprint_json: null,
      },
    });

    const orgUpdateRes = await fetch(`${baseUrl}/api/orgs/org-a`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blueprint_json: JSON.stringify({ schemaVersion: 1 }) }),
    });
    expect(orgUpdateRes.status).toBe(200);
    expect(await readJson(orgUpdateRes)).toMatchObject({
      org: {
        id: 'org-a',
        mission: 'Run a scoped business workspace.',
        domains_json: JSON.stringify(['product']),
        blueprint_json: JSON.stringify({ schemaVersion: 1 }),
      },
    });

    const teamRes = await fetch(`${baseUrl}/api/orgs/org-a/teams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'team-a', name: 'Team A' }),
    });
    expect(teamRes.status).toBe(201);
    expect(await readJson(teamRes)).toMatchObject({
      team: { id: 'team-a', org_id: 'org-a', name: 'Team A' },
    });

    const projectRes = await fetch(`${baseUrl}/api/orgs/org-a/teams/team-a/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Workspace API',
        color: '#2563eb',
        lifecycle_state: 'active',
        project_key: 'workspace-api',
        work_domain: 'engineering',
      }),
    });
    expect(projectRes.status).toBe(201);
    const projectBody = await readJson(projectRes);
    expect(projectBody).toMatchObject({
      project: {
        org_id: 'org-a',
        team_id: 'team-a',
        name: 'Workspace API',
        lifecycle_state: 'active',
        project_key: 'workspace-api',
        work_domain: 'engineering',
      },
    });
    const projectId = Number((projectBody.project as ProjectRecord).id);

    const projectsRes = await fetch(`${baseUrl}/api/teams/team-a/projects`, {
      headers: { 'x-entity-org-id': 'org-a' },
    });
    expect(projectsRes.status).toBe(200);
    expect(await readJson(projectsRes)).toMatchObject({
      projects: [{
        id: projectId,
        org_id: 'org-a',
        team_id: 'team-a',
        name: 'Workspace API',
        project_key: 'workspace-api',
        work_domain: 'engineering',
      }],
    });

    const getRes = await fetch(`${baseUrl}/api/projects/${projectId}`, {
      headers: {
        'x-entity-org-id': 'org-a',
        'x-entity-team-id': 'team-a',
      },
    });
    expect(getRes.status).toBe(200);
    expect(await readJson(getRes)).toMatchObject({
      project: {
        id: projectId,
        project_key: 'workspace-api',
        work_domain: 'engineering',
      },
    });

    const updateRes = await fetch(`${baseUrl}/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-entity-org-id': 'org-a',
        'x-entity-team-id': 'team-a',
      },
      body: JSON.stringify({
        name: 'Workspace API v2',
        lifecycle_state: 'review',
        project_key: 'workspace-api-v2',
        work_domain: null,
      }),
    });
    expect(updateRes.status).toBe(200);
    expect(await readJson(updateRes)).toMatchObject({
      project: {
        id: projectId,
        name: 'Workspace API v2',
        lifecycle_state: 'review',
        project_key: 'workspace-api-v2',
        work_domain: null,
      },
    });
  });

  it('returns explicit missing-scope errors for scoped lookups', async () => {
    const teamRes = await fetch(`${baseUrl}/api/teams/team-a`);
    expect(teamRes.status).toBe(400);
    expect(await readJson(teamRes)).toEqual({ error: 'org scope is required' });

    const projectRes = await fetch(`${baseUrl}/api/projects/1`, {
      headers: { 'x-entity-org-id': 'org-a' },
    });
    expect(projectRes.status).toBe(400);
    expect(await readJson(projectRes)).toEqual({ error: 'team scope is required' });
  });

  it('rejects non-normalized project classification at the scoped API boundary', async () => {
    const invalidKeyRes = await fetch(`${baseUrl}/api/orgs/org-a/teams/team-a/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Invalid key',
        project_key: 'Engineering',
      }),
    });
    expect(invalidKeyRes.status).toBe(400);
    expect(await readJson(invalidKeyRes)).toEqual({
      error: 'project_key must be a normalized lowercase slug (1-64 characters)',
    });

    const invalidDomainRes = await fetch(`${baseUrl}/api/orgs/org-a/teams/team-a/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Invalid domain',
        work_domain: '',
      }),
    });
    expect(invalidDomainRes.status).toBe(400);
    expect(await readJson(invalidDomainRes)).toEqual({
      error: 'work_domain must be a normalized lowercase slug (1-64 characters)',
    });
  });

  it('denies cross-org and cross-team lookups by scoped not-found responses', async () => {
    await fetch(`${baseUrl}/api/orgs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'org-b', name: 'Org B' }),
    });
    await fetch(`${baseUrl}/api/orgs/org-b/teams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'team-b', name: 'Team B' }),
    });
    const projectRes = await fetch(`${baseUrl}/api/orgs/org-b/teams/team-b/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Org B Project' }),
    });
    const projectId = Number(((await readJson(projectRes)).project as ProjectRecord).id);

    const wrongOrgTeamRes = await fetch(`${baseUrl}/api/teams/team-a`, {
      headers: { 'x-entity-org-id': 'org-b' },
    });
    expect(wrongOrgTeamRes.status).toBe(404);
    expect(await readJson(wrongOrgTeamRes)).toEqual({ error: 'team not found in org' });

    const wrongTeamProjectRes = await fetch(`${baseUrl}/api/projects/${projectId}`, {
      headers: {
        'x-entity-org-id': 'org-b',
        'x-entity-team-id': 'team-a',
      },
    });
    expect(wrongTeamProjectRes.status).toBe(404);
    expect(await readJson(wrongTeamProjectRes)).toEqual({ error: 'project not found in scope' });
  });

  it('requires contributor authority on the exact project team for both create aliases and updates', async () => {
    const createPaths = [
      '/api/orgs/org-a/teams/team-a/projects',
      '/api/teams/team-a/projects',
    ];
    for (const path of createPaths) {
      const workspaceRepo = createFakeWorkspaceRepo();
      workspaceRepo.createOrg({ id: 'org-a', name: 'Org A' });
      workspaceRepo.createTeam({ orgId: 'org-a' }, { id: 'team-a', name: 'Team A' });
      workspaceRepo.createTeam({ orgId: 'org-a' }, { id: 'team-b', name: 'Team B' });

      const viewer = await requestAsPrincipal(
        workspaceRepo,
        [{ role: 'viewer', org_id: 'org-a' }],
        path,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Viewer project' }) },
      );
      expect(viewer.status).toBe(403);

      const foreignTeamManager = await requestAsPrincipal(
        workspaceRepo,
        [{ role: 'manager', org_id: 'org-a', team_id: 'team-b' }],
        path,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Foreign project' }) },
      );
      expect(foreignTeamManager.status).toBe(403);

      const contributor = await requestAsPrincipal(
        workspaceRepo,
        [{ role: 'contributor', org_id: 'org-a', team_id: 'team-a' }],
        path,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Contributor project' }) },
      );
      expect(contributor.status).toBe(201);
    }

    const workspaceRepo = createFakeWorkspaceRepo();
    workspaceRepo.createOrg({ id: 'org-a', name: 'Org A' });
    workspaceRepo.createTeam({ orgId: 'org-a' }, { id: 'team-a', name: 'Team A' });
    workspaceRepo.createTeam({ orgId: 'org-a' }, { id: 'team-b', name: 'Team B' });
    const project = workspaceRepo.createProject({ orgId: 'org-a', teamId: 'team-a' }, { name: 'Project A' });

    const viewerUpdate = await requestAsPrincipal(
      workspaceRepo,
      [{ role: 'viewer', org_id: 'org-a', team_id: 'team-a' }],
      `/api/projects/${project.id}`,
      { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-entity-org-id': 'org-a', 'x-entity-team-id': 'team-a' }, body: JSON.stringify({ name: 'Viewer update' }) },
    );
    expect(viewerUpdate.status).toBe(403);

    const foreignTeamManagerUpdate = await requestAsPrincipal(
      workspaceRepo,
      [{ role: 'manager', org_id: 'org-a', team_id: 'team-b' }],
      `/api/projects/${project.id}`,
      { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-entity-org-id': 'org-a', 'x-entity-team-id': 'team-a' }, body: JSON.stringify({ name: 'Foreign update' }) },
    );
    expect(foreignTeamManagerUpdate.status).toBe(403);

    const contributorUpdate = await requestAsPrincipal(
      workspaceRepo,
      [{ role: 'contributor', org_id: 'org-a', team_id: 'team-a' }],
      `/api/projects/${project.id}`,
      { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-entity-org-id': 'org-a', 'x-entity-team-id': 'team-a' }, body: JSON.stringify({ name: 'Contributor update' }) },
    );
    expect(contributorUpdate.status).toBe(200);

    const projectContributorUpdate = await requestAsPrincipal(
      workspaceRepo,
      [{ role: 'contributor', org_id: 'org-a', project_id: project.id }],
      `/api/projects/${project.id}`,
      { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-entity-org-id': 'org-a', 'x-entity-team-id': 'team-a' }, body: JSON.stringify({ name: 'Project-scoped update' }) },
    );
    expect(projectContributorUpdate.status).toBe(200);

    const globalAdminUpdate = await requestAsPrincipal(
      workspaceRepo,
      [{ role: 'admin' }],
      `/api/projects/${project.id}`,
      { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-entity-org-id': 'org-a', 'x-entity-team-id': 'team-a' }, body: JSON.stringify({ name: 'Global admin update' }) },
    );
    expect(globalAdminUpdate.status).toBe(200);
  });

  it('requires manager or admin authority for team creation and rename at the precise scope', async () => {
    const workspaceRepo = createFakeWorkspaceRepo();
    workspaceRepo.createOrg({ id: 'org-a', name: 'Org A' });
    workspaceRepo.createTeam({ orgId: 'org-a' }, { id: 'team-a', name: 'Team A' });
    workspaceRepo.createTeam({ orgId: 'org-a' }, { id: 'team-b', name: 'Team B' });

    for (const role of ['viewer', 'contributor'] as const) {
      const createResponse = await requestAsPrincipal(
        workspaceRepo,
        [{ role, org_id: 'org-a', team_id: 'team-a' }],
        '/api/orgs/org-a/teams',
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `${role}-team`, name: `${role} team` }) },
      );
      expect(createResponse.status).toBe(403);

      const renameResponse = await requestAsPrincipal(
        workspaceRepo,
        [{ role, org_id: 'org-a', team_id: 'team-a' }],
        '/api/teams/team-a',
        { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `${role} rename` }) },
      );
      expect(renameResponse.status).toBe(403);
    }

    const teamManagerCreate = await requestAsPrincipal(
      workspaceRepo,
      [{ role: 'manager', org_id: 'org-a', team_id: 'team-a' }],
      '/api/orgs/org-a/teams',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'blocked-team', name: 'Blocked team' }) },
    );
    expect(teamManagerCreate.status).toBe(403);

    const teamManagerRename = await requestAsPrincipal(
      workspaceRepo,
      [{ role: 'manager', org_id: 'org-a', team_id: 'team-a' }],
      '/api/teams/team-a',
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Team A managed' }) },
    );
    expect(teamManagerRename.status).toBe(200);
    expect(await readJson(teamManagerRename)).toMatchObject({ team: { id: 'team-a', name: 'Team A managed' } });

    const wrongTeamRename = await requestAsPrincipal(
      workspaceRepo,
      [{ role: 'manager', org_id: 'org-a', team_id: 'team-a' }],
      '/api/teams/team-b',
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Should be denied' }) },
    );
    expect(wrongTeamRename.status).toBe(403);

    const orgManagerCreate = await requestAsPrincipal(
      workspaceRepo,
      [{ role: 'manager', org_id: 'org-a' }],
      '/api/orgs/org-a/teams',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'team-c', name: 'Team C' }) },
    );
    expect(orgManagerCreate.status).toBe(201);

    const orgManagerRename = await requestAsPrincipal(
      workspaceRepo,
      [{ role: 'manager', org_id: 'org-a' }],
      '/api/teams/team-b',
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Team B managed' }) },
    );
    expect(orgManagerRename.status).toBe(200);
    expect(await readJson(orgManagerRename)).toMatchObject({ team: { id: 'team-b', name: 'Team B managed' } });

    const globalAdminRename = await requestAsPrincipal(
      workspaceRepo,
      [{ role: 'admin' }],
      '/api/teams/team-c',
      { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-entity-org-id': 'org-a' }, body: JSON.stringify({ name: 'Team C managed' }) },
    );
    expect(globalAdminRename.status).toBe(200);
    expect(await readJson(globalAdminRename)).toMatchObject({ team: { id: 'team-c', name: 'Team C managed' } });
  });

  it('restricts organization creation to deployment admins and updates to exact org managers', async () => {
    const workspaceRepo = createFakeWorkspaceRepo();
    workspaceRepo.createOrg({ id: 'org-a', name: 'Org A' });

    for (const role of ['viewer', 'contributor', 'manager'] as const) {
      const response = await requestAsPrincipal(
        workspaceRepo,
        [{ role, org_id: 'org-a' }],
        '/api/orgs',
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `${role}-org`, name: `${role} Org` }) },
      );
      expect(response.status).toBe(403);
    }

    const globalCreate = await requestAsPrincipal(
      workspaceRepo,
      [{ role: 'admin' }],
      '/api/orgs',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'org-global', name: 'Global Org' }) },
    );
    expect(globalCreate.status).toBe(201);

    for (const role of ['viewer', 'contributor'] as const) {
      const response = await requestAsPrincipal(
        workspaceRepo,
        [{ role, org_id: 'org-a' }],
        '/api/orgs/org-a',
        { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `${role} rename` }) },
      );
      expect(response.status).toBe(403);
    }

    const orgManager = await requestAsPrincipal(
      workspaceRepo,
      [{ role: 'manager', org_id: 'org-a' }],
      '/api/orgs/org-a',
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Manager rename' }) },
    );
    expect(orgManager.status).toBe(200);

    const wrongOrgManager = await requestAsPrincipal(
      workspaceRepo,
      [{ role: 'manager', org_id: 'org-b' }],
      '/api/orgs/org-a',
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Wrong rename' }) },
    );
    expect(wrongOrgManager.status).toBe(403);
  });
});

describe('admin workspace control-plane adapter', () => {
  it('lets the bound active admin use workspace controls without weakening data-plane auth', async () => {
    const db = new Database(':memory:');
    ensurePrincipalsSchema(db);
    ensureAccessTokensSchema(db);
    const principalRepo = createPrincipalRepository(db);
    principalRepo.createPrincipal({ id: 'bound-admin', principal_type: 'human', display_name: 'Bound Admin' });
    principalRepo.createGrant({ principal_id: 'bound-admin', role: 'admin', created_by: 'test' });
    principalRepo.createPrincipal({ id: 'tenant-viewer', principal_type: 'human', display_name: 'Tenant Viewer' });
    principalRepo.createGrant({ principal_id: 'tenant-viewer', role: 'viewer', org_id: 'org-a', created_by: 'test' });
    principalRepo.createPrincipal({ id: 'disabled-bound', principal_type: 'human', display_name: 'Disabled Bound' });
    principalRepo.createGrant({ principal_id: 'disabled-bound', role: 'admin', created_by: 'test' });
    principalRepo.disablePrincipal('disabled-bound');
    const accessTokens = createAccessTokenRepository(db, principalRepo);
    const adminAccessToken = accessTokens.createToken({ principal_id: 'bound-admin' }).token;
    const viewerAccessToken = accessTokens.createToken({ principal_id: 'tenant-viewer' }).token;

    const workspaceRepo = createFakeWorkspaceRepo();
    workspaceRepo.createOrg({ id: 'org-a', name: 'Org A' });
    workspaceRepo.createTeam({ orgId: 'org-a' }, { id: 'team-a', name: 'Team A' });

    vi.stubEnv('ENTITY_API_TOKEN', 'deployment-token');
    vi.stubEnv('ENTITY_API_PRINCIPAL_ID', 'bound-admin');
    const app = express();
    app.use(express.json());
    app.use(createApiAuthMiddleware());
    app.use(createCustomerPrincipalMiddleware(accessTokens));
    app.use(createDataPlaneCredentialGuard());
    app.use('/api/admin/workspace', createAdminWorkspaceRouter({ workspaceRepo, principalRepo }));
    app.use('/api', createWorkspaceRouter({ workspaceRepo }));

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server failed to bind');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const bearer = { authorization: 'Bearer deployment-token' };
    try {
      const orgs = await fetch(`${baseUrl}/api/admin/workspace/orgs`, { headers: bearer });
      expect(orgs.status).toBe(200);
      expect(await readJson(orgs)).toMatchObject({ orgs: [{ id: 'org-a' }] });

      const teams = await fetch(`${baseUrl}/api/admin/workspace/orgs/org-a/teams`, { headers: bearer });
      expect(teams.status).toBe(200);
      expect(await readJson(teams)).toMatchObject({ teams: [{ id: 'team-a' }] });

      const created = await fetch(`${baseUrl}/api/admin/workspace/orgs/org-a/teams`, {
        method: 'POST',
        headers: { ...bearer, 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'team-b', name: 'Team B' }),
      });
      expect(created.status).toBe(201);

      const renamed = await fetch(`${baseUrl}/api/admin/workspace/teams/team-b?orgId=org-a`, {
        method: 'PATCH',
        headers: { ...bearer, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Team B renamed' }),
      });
      expect(renamed.status).toBe(200);

      // The original workspace path remains data-plane and still rejects the
      // deployment bearer when no customer credential is supplied.
      const dataPlane = await fetch(`${baseUrl}/api/orgs`, { headers: bearer });
      expect(dataPlane.status).toBe(403);
      expect((await readJson(dataPlane)).code).toBe('customer_credential_required');

      // A stored global admin customer credential may use the control adapter.
      const adminCredential = await fetch(`${baseUrl}/api/admin/workspace/orgs`, {
        headers: { ...bearer, 'x-entity-access-token': adminAccessToken },
      });
      expect(adminCredential.status).toBe(200);

      // A tenant credential cannot turn the control adapter into an org-manager
      // bypass, even though it has a valid data-plane identity.
      const tenantCredential = await fetch(`${baseUrl}/api/admin/workspace/orgs`, {
        headers: { ...bearer, 'x-entity-access-token': viewerAccessToken },
      });
      expect(tenantCredential.status).toBe(403);
      expect((await readJson(tenantCredential)).code).toBe('permission_denied');

      const noBearer = await fetch(`${baseUrl}/api/admin/workspace/orgs`);
      expect(noBearer.status).toBe(401);

      const invalidCustomerCredential = await fetch(`${baseUrl}/api/admin/workspace/orgs`, {
        headers: { ...bearer, 'x-entity-access-token': 'ect_invalid-token' },
      });
      expect(invalidCustomerCredential.status).toBe(403);
      expect((await readJson(invalidCustomerCredential)).code).toBe('customer_credential_invalid');

      // The server-bound principal, not caller-supplied admin headers, is the
      // identity evaluated by the existing admin middleware.
      vi.stubEnv('ENTITY_API_PRINCIPAL_ID', 'tenant-viewer');
      const spoofedAdminHeaders = await fetch(`${baseUrl}/api/admin/workspace/orgs`, {
        headers: {
          ...bearer,
          'x-entity-principal-id': 'bound-admin',
          'x-entity-role': 'admin',
        },
      });
      expect(spoofedAdminHeaders.status).toBe(403);
      expect((await readJson(spoofedAdminHeaders)).code).toBe('admin_grant_required');

      vi.stubEnv('ENTITY_API_PRINCIPAL_ID', 'disabled-bound');
      const disabledBinding = await fetch(`${baseUrl}/api/admin/workspace/orgs`, { headers: bearer });
      expect(disabledBinding.status).toBe(403);
      // Disabled bindings are rejected while resolving the server identity,
      // before the middleware can expose the disabled principal as authority.
      expect((await readJson(disabledBinding)).code).toBe('admin_principal_binding_required');

      vi.stubEnv('ENTITY_API_PRINCIPAL_ID', 'bound-admin');
      // The adapter is intentionally narrow: workspace project/org mutation
      // routes are not accidentally exposed beneath the control prefix.
      const unexposedProjectRoute = await fetch(`${baseUrl}/api/admin/workspace/projects/1`, {
        headers: bearer,
      });
      expect(unexposedProjectRoute.status).toBe(404);
      const unexposedOrgRoute = await fetch(`${baseUrl}/api/admin/workspace/orgs/org-a`, {
        headers: bearer,
      });
      expect(unexposedOrgRoute.status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      vi.unstubAllEnvs();
      db.close();
    }
  });
});
