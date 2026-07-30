import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import type {
  CreateOrgInput,
  CreateProjectInput,
  CreateTeamInput,
  OrgQueryContext,
  UpdateOrgInput,
  UpdateProjectInput,
  UpdateTeamInput,
  WorkspaceScopeRepository,
} from '../../../db/src';

interface WorkspaceRouterDeps {
  workspaceRepo: WorkspaceScopeRepository;
}

class WorkspaceApiError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requiredBodyString(body: Record<string, unknown>, key: string): string {
  const value = readString(body[key]);
  if (!value) {
    throw new WorkspaceApiError(400, `${key} is required`);
  }
  return value;
}

function optionalBodyString(body: Record<string, unknown>, key: string): string | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null) return undefined;
  if (typeof value !== 'string') {
    throw new WorkspaceApiError(400, `${key} must be a string`);
  }
  return value.trim();
}

function optionalProjectSlug(
  body: Record<string, unknown>,
  key: string,
  alias: string,
): string | null | undefined {
  const selectedKey = key in body ? key : alias in body ? alias : null;
  if (!selectedKey) return undefined;
  const value = body[selectedKey];
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    value.length < 1 ||
    value.length > 64 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  ) {
    throw new WorkspaceApiError(400, `${key} must be a normalized lowercase slug (1-64 characters)`);
  }
  return value;
}

function parseBody(req: Request): Record<string, unknown> {
  if (!isRecord(req.body)) {
    throw new WorkspaceApiError(400, 'body must be an object');
  }
  return req.body;
}

function readScopedString(req: Request, key: string, header: string): string | undefined {
  return readString(req.params[key]) ?? readString(req.header(header)) ?? readString(req.query[key]);
}

function requireOrgId(req: Request): string {
  const orgId = readScopedString(req, 'orgId', 'x-entity-org-id');
  if (!orgId) {
    throw new WorkspaceApiError(400, 'org scope is required');
  }
  return orgId;
}

function requireTeamId(req: Request): string {
  const teamId = readScopedString(req, 'teamId', 'x-entity-team-id');
  if (!teamId) {
    throw new WorkspaceApiError(400, 'team scope is required');
  }
  return teamId;
}

function requireProjectId(req: Request): number {
  const parsed = Number(req.params.projectId);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new WorkspaceApiError(400, 'project id must be a positive integer');
  }
  return parsed;
}

function scopeFromRequest(req: Request, options: { requireTeam?: boolean } = {}): OrgQueryContext {
  const orgId = requireOrgId(req);
  const teamId = options.requireTeam ? requireTeamId(req) : readScopedString(req, 'teamId', 'x-entity-team-id');
  return typeof teamId === 'string' ? { orgId, teamId } : { orgId };
}

function sendRouteError(res: Response, error: unknown): Response {
  if (error instanceof WorkspaceApiError) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
}

function parseCreateOrg(body: Record<string, unknown>): CreateOrgInput {
  return {
    id: optionalBodyString(body, 'id'),
    name: requiredBodyString(body, 'name'),
    slug: optionalBodyString(body, 'slug'),
    status: optionalBodyString(body, 'status'),
    deployment_mode: optionalBodyString(body, 'deployment_mode') ?? optionalBodyString(body, 'deploymentMode'),
  };
}

function parseUpdateOrg(body: Record<string, unknown>): UpdateOrgInput {
  return {
    name: optionalBodyString(body, 'name'),
    slug: optionalBodyString(body, 'slug'),
    status: optionalBodyString(body, 'status'),
    deployment_mode: optionalBodyString(body, 'deployment_mode') ?? optionalBodyString(body, 'deploymentMode'),
  };
}

function parseCreateTeam(body: Record<string, unknown>): CreateTeamInput {
  return {
    id: optionalBodyString(body, 'id'),
    name: requiredBodyString(body, 'name'),
    slug: optionalBodyString(body, 'slug'),
    status: optionalBodyString(body, 'status'),
  };
}

function parseUpdateTeam(body: Record<string, unknown>): UpdateTeamInput {
  return {
    name: optionalBodyString(body, 'name'),
    slug: optionalBodyString(body, 'slug'),
    status: optionalBodyString(body, 'status'),
  };
}

function parseCreateProject(body: Record<string, unknown>): CreateProjectInput {
  return {
    name: requiredBodyString(body, 'name'),
    color: optionalBodyString(body, 'color'),
    lifecycle_state: optionalBodyString(body, 'lifecycle_state') ?? optionalBodyString(body, 'lifecycleState'),
    project_key: optionalProjectSlug(body, 'project_key', 'projectKey'),
    work_domain: optionalProjectSlug(body, 'work_domain', 'workDomain'),
  };
}

function parseUpdateProject(body: Record<string, unknown>): UpdateProjectInput {
  return {
    name: optionalBodyString(body, 'name'),
    color: optionalBodyString(body, 'color'),
    lifecycle_state: optionalBodyString(body, 'lifecycle_state') ?? optionalBodyString(body, 'lifecycleState'),
    project_key: optionalProjectSlug(body, 'project_key', 'projectKey'),
    work_domain: optionalProjectSlug(body, 'work_domain', 'workDomain'),
  };
}

export function createWorkspaceRouter({ workspaceRepo }: WorkspaceRouterDeps): Router {
  const router = createRouter();

  router.get('/orgs', (_req, res) => {
    return res.json({ orgs: workspaceRepo.listOrgs() });
  });

  router.post('/orgs', (req, res) => {
    try {
      const org = workspaceRepo.createOrg(parseCreateOrg(parseBody(req)));
      return res.status(201).json({ org });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.get('/orgs/:orgId', (req, res) => {
    try {
      const org = workspaceRepo.getOrg(requireOrgId(req));
      if (!org) return res.status(404).json({ error: 'org not found' });
      return res.json({ org });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.patch('/orgs/:orgId', (req, res) => {
    try {
      const org = workspaceRepo.updateOrg(requireOrgId(req), parseUpdateOrg(parseBody(req)));
      if (!org) return res.status(404).json({ error: 'org not found' });
      return res.json({ org });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.get('/orgs/:orgId/teams', (req, res) => {
    try {
      return res.json({ teams: workspaceRepo.listTeams(scopeFromRequest(req)) });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.post('/orgs/:orgId/teams', (req, res) => {
    try {
      const team = workspaceRepo.createTeam(scopeFromRequest(req), parseCreateTeam(parseBody(req)));
      return res.status(201).json({ team });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.get('/teams/:teamId', (req, res) => {
    try {
      const team = workspaceRepo.getTeam(scopeFromRequest(req, { requireTeam: true }), requireTeamId(req));
      if (!team) return res.status(404).json({ error: 'team not found in org' });
      return res.json({ team });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.patch('/teams/:teamId', (req, res) => {
    try {
      const scope = scopeFromRequest(req, { requireTeam: true });
      const team = workspaceRepo.updateTeam(scope, requireTeamId(req), parseUpdateTeam(parseBody(req)));
      if (!team) return res.status(404).json({ error: 'team not found in org' });
      return res.json({ team });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.get('/orgs/:orgId/teams/:teamId/projects', (req, res) => {
    try {
      return res.json({ projects: workspaceRepo.listProjects(scopeFromRequest(req, { requireTeam: true })) });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.post('/orgs/:orgId/teams/:teamId/projects', (req, res) => {
    try {
      const project = workspaceRepo.createProject(
        scopeFromRequest(req, { requireTeam: true }),
        parseCreateProject(parseBody(req)),
      );
      return res.status(201).json({ project });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.get('/teams/:teamId/projects', (req, res) => {
    try {
      return res.json({ projects: workspaceRepo.listProjects(scopeFromRequest(req, { requireTeam: true })) });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.post('/teams/:teamId/projects', (req, res) => {
    try {
      const project = workspaceRepo.createProject(
        scopeFromRequest(req, { requireTeam: true }),
        parseCreateProject(parseBody(req)),
      );
      return res.status(201).json({ project });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.get('/projects/:projectId', (req, res) => {
    try {
      const project = workspaceRepo.getProject(scopeFromRequest(req, { requireTeam: true }), requireProjectId(req));
      if (!project) return res.status(404).json({ error: 'project not found in scope' });
      return res.json({ project });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.patch('/projects/:projectId', (req, res) => {
    try {
      const project = workspaceRepo.updateProject(
        scopeFromRequest(req, { requireTeam: true }),
        requireProjectId(req),
        parseUpdateProject(parseBody(req)),
      );
      if (!project) return res.status(404).json({ error: 'project not found in scope' });
      return res.json({ project });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  return router;
}
