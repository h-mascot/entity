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
import { getCustomerPrincipal, isTrustedServiceContext, sendPermissionDenied } from '../principals/request-context';
import { readDefaultOrgId } from '../config/admin-runtime';

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

/**
 * R4: resolve the customer principal-derived org id. The caller MUST gate the
 * trusted service/admin path with `isTrustedServiceContext(req)` first; this
 * resolver only handles customer principals. The org is derived from the
 * authenticated principal's persisted grants; a requested path/header/query org
 * is honored ONLY when it lies within the membership (it can narrow, never
 * widen). Absent/ambiguous customer scope fails closed. Returns the resolved
 * org id, or null when a 400/403 response has already been written.
 */
function resolveCustomerOrgId(req: Request, res: Response): string | null {
  const ctx = getCustomerPrincipal(req);
  if (!ctx) {
    // Defensive: should be unreachable because callers gate the trusted path.
    sendPermissionDenied(res, 'customer principal required');
    return null;
  }
  // R4: gather every caller-supplied org signal (path, header, query). Any signal
  // naming an org outside the membership is a spoofing attempt and is rejected;
  // the effective scope can only narrow within grants.
  const pathOrg = readString(req.params.orgId);
  const headerOrg = readString(req.header('x-entity-org-id')) ?? readString(req.header('x-entity-org'));
  const queryOrg = readString(req.query.orgId) ?? readString(req.query.org_id);
  const signals = [pathOrg, headerOrg, queryOrg].filter((value): value is string => Boolean(value));
  if (ctx.isGlobalAdmin) {
    const orgId = signals[0] ?? readDefaultOrgId();
    if (!orgId) {
      res.status(400).json({ error: 'request org required', code: 'request_org_required' });
      return null;
    }
    return orgId;
  }
  for (const signal of signals) {
    if (!ctx.orgIds.includes(signal)) {
      sendPermissionDenied(res, 'requested org is outside the principal membership');
      return null;
    }
  }
  const orgId = signals[0] ?? (ctx.orgIds.length === 1 ? ctx.orgIds[0] : null);
  if (!orgId) {
    res.status(400).json({
      error: 'request org required',
      code: 'request_org_required',
      reason: 'customer principal has multiple org scopes; specify one',
    });
    return null;
  }
  return orgId;
}

/**
 * R4: resolve the principal-derived workspace scope. Returns:
 *   - undefined: trusted path -> route uses legacy scopeFromRequest/requireOrgId (unchanged)
 *   - null: customer fail-closed (response sent; route returns)
 *   - OrgQueryContext: customer principal-derived scope (teamId, when required, still
 *     comes from path/header/query but is scoped to the principal's org by the repo)
 */
function resolveRequestScope(
  req: Request,
  res: Response,
  options: { requireTeam?: boolean } = {},
): OrgQueryContext | null | undefined {
  if (isTrustedServiceContext(req)) return undefined;
  const orgId = resolveCustomerOrgId(req, res);
  if (orgId === null) return null;
  const teamId = options.requireTeam
    ? requireTeamId(req)
    : readScopedString(req, 'teamId', 'x-entity-team-id');
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
    mission: optionalBodyString(body, 'mission'),
    domains_json: optionalBodyString(body, 'domains_json') ?? optionalBodyString(body, 'domainsJson'),
    blueprint_json: optionalBodyString(body, 'blueprint_json') ?? optionalBodyString(body, 'blueprintJson'),
  };
}

function parseUpdateOrg(body: Record<string, unknown>): UpdateOrgInput {
  return {
    name: optionalBodyString(body, 'name'),
    slug: optionalBodyString(body, 'slug'),
    status: optionalBodyString(body, 'status'),
    deployment_mode: optionalBodyString(body, 'deployment_mode') ?? optionalBodyString(body, 'deploymentMode'),
    mission: optionalBodyString(body, 'mission'),
    domains_json: optionalBodyString(body, 'domains_json') ?? optionalBodyString(body, 'domainsJson'),
    blueprint_json: optionalBodyString(body, 'blueprint_json') ?? optionalBodyString(body, 'blueprintJson'),
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

  router.get('/orgs', (req, res) => {
    const customer = getCustomerPrincipal(req);
    const all = workspaceRepo.listOrgs();
    // R4: a customer principal only sees its membership; trusted/admin see all.
    if (!customer || customer.isGlobalAdmin) {
      return res.json({ orgs: all });
    }
    const allowed = new Set(customer.orgIds);
    return res.json({ orgs: all.filter((org) => allowed.has(org.id)) });
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
      const resolution = resolveRequestScope(req, res);
      if (resolution === null) return undefined;
      const orgId = resolution ? resolution.orgId : requireOrgId(req);
      const org = workspaceRepo.getOrg(orgId);
      if (!org) return res.status(404).json({ error: 'org not found' });
      return res.json({ org });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.patch('/orgs/:orgId', (req, res) => {
    try {
      const resolution = resolveRequestScope(req, res);
      if (resolution === null) return undefined;
      const orgId = resolution ? resolution.orgId : requireOrgId(req);
      const org = workspaceRepo.updateOrg(orgId, parseUpdateOrg(parseBody(req)));
      if (!org) return res.status(404).json({ error: 'org not found' });
      return res.json({ org });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.get('/orgs/:orgId/teams', (req, res) => {
    try {
      const resolution = resolveRequestScope(req, res);
      if (resolution === null) return undefined;
      const scope = resolution ?? scopeFromRequest(req);
      return res.json({ teams: workspaceRepo.listTeams(scope) });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.post('/orgs/:orgId/teams', (req, res) => {
    try {
      const resolution = resolveRequestScope(req, res);
      if (resolution === null) return undefined;
      const scope = resolution ?? scopeFromRequest(req);
      const team = workspaceRepo.createTeam(scope, parseCreateTeam(parseBody(req)));
      return res.status(201).json({ team });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.get('/teams/:teamId', (req, res) => {
    try {
      const resolution = resolveRequestScope(req, res, { requireTeam: true });
      if (resolution === null) return undefined;
      const scope = resolution ?? scopeFromRequest(req, { requireTeam: true });
      const team = workspaceRepo.getTeam(scope, requireTeamId(req));
      if (!team) return res.status(404).json({ error: 'team not found in org' });
      return res.json({ team });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.patch('/teams/:teamId', (req, res) => {
    try {
      const resolution = resolveRequestScope(req, res, { requireTeam: true });
      if (resolution === null) return undefined;
      const scope = resolution ?? scopeFromRequest(req, { requireTeam: true });
      const team = workspaceRepo.updateTeam(scope, requireTeamId(req), parseUpdateTeam(parseBody(req)));
      if (!team) return res.status(404).json({ error: 'team not found in org' });
      return res.json({ team });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.get('/orgs/:orgId/teams/:teamId/projects', (req, res) => {
    try {
      const resolution = resolveRequestScope(req, res, { requireTeam: true });
      if (resolution === null) return undefined;
      const scope = resolution ?? scopeFromRequest(req, { requireTeam: true });
      return res.json({ projects: workspaceRepo.listProjects(scope) });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.post('/orgs/:orgId/teams/:teamId/projects', (req, res) => {
    try {
      const resolution = resolveRequestScope(req, res, { requireTeam: true });
      if (resolution === null) return undefined;
      const scope = resolution ?? scopeFromRequest(req, { requireTeam: true });
      const project = workspaceRepo.createProject(
        scope,
        parseCreateProject(parseBody(req)),
      );
      return res.status(201).json({ project });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.get('/teams/:teamId/projects', (req, res) => {
    try {
      const resolution = resolveRequestScope(req, res, { requireTeam: true });
      if (resolution === null) return undefined;
      const scope = resolution ?? scopeFromRequest(req, { requireTeam: true });
      return res.json({ projects: workspaceRepo.listProjects(scope) });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.post('/teams/:teamId/projects', (req, res) => {
    try {
      const resolution = resolveRequestScope(req, res, { requireTeam: true });
      if (resolution === null) return undefined;
      const scope = resolution ?? scopeFromRequest(req, { requireTeam: true });
      const project = workspaceRepo.createProject(
        scope,
        parseCreateProject(parseBody(req)),
      );
      return res.status(201).json({ project });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.get('/projects/:projectId', (req, res) => {
    try {
      const resolution = resolveRequestScope(req, res, { requireTeam: true });
      if (resolution === null) return undefined;
      const scope = resolution ?? scopeFromRequest(req, { requireTeam: true });
      const project = workspaceRepo.getProject(scope, requireProjectId(req));
      if (!project) return res.status(404).json({ error: 'project not found in scope' });
      return res.json({ project });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.patch('/projects/:projectId', (req, res) => {
    try {
      const resolution = resolveRequestScope(req, res, { requireTeam: true });
      if (resolution === null) return undefined;
      const scope = resolution ?? scopeFromRequest(req, { requireTeam: true });
      const project = workspaceRepo.updateProject(
        scope,
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
