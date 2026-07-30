import express from 'express';
import http from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { createWorkspaceRouter } from './workspace';

const now = '2026-06-23T00:00:00.000Z';

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
      body: JSON.stringify({ id: 'org-a', name: 'Org A', deployment_mode: 'enterprise_self_deploy' }),
    });
    expect(orgRes.status).toBe(201);
    expect(await readJson(orgRes)).toMatchObject({
      org: { id: 'org-a', name: 'Org A', deployment_mode: 'enterprise_self_deploy' },
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
});
