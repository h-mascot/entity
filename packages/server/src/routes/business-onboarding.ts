import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import {
  type AgentRegistryRecord,
  type AgentRegistryRepository,
  type CreateTaskInput,
  type OrgQueryContext,
  type OrgRecord,
  type ProjectRecord,
  type TaskRecord,
  type TeamRecord,
  type WorkspaceScopeRepository,
} from '../../../db/src';
import { getEntityDatabase } from '../../../db/src/entity-db';
import { ensureAppSettingsTable } from '../config/settings-store';
import { ADMIN_SETTINGS_KEYS } from '../config/admin-settings';
import { getAdminSettings } from '../config/admin-settings-store';

function readBusinessOnboardingSettings() {
  const db = getEntityDatabase(ensureAppSettingsTable);
  return getAdminSettings(db, ADMIN_SETTINGS_KEYS.businessOnboarding);
}

export const BUSINESS_DOMAIN_CATALOG = [
  {
    id: 'claims-ops',
    label: 'Claims Operations',
    teamName: 'Claims Operations',
    description: 'Claims intake, auto-vetting, ERP sync, review gates, and exceptions.',
    seedProject: 'Claims Control Room',
    seedTasks: ['Define claims intake SLA', 'Map human sign-off gates', 'Review ERP sync exceptions'],
  },
  {
    id: 'engineering-devops',
    label: 'Engineering / DevOps',
    teamName: 'Engineering / DevOps',
    description: 'PR hygiene, releases, cron heartbeats, incident loops, and platform reliability.',
    seedProject: 'Engineering Reliability',
    seedTasks: ['Define release guardrails', 'Set stale-PR watcher rules', 'Map production incident handoffs'],
  },
  {
    id: 'product',
    label: 'Product',
    teamName: 'Product',
    description: 'Roadmaps, experiments, issue summaries, sprint KPIs, and competitor signal.',
    seedProject: 'Product Operating System',
    seedTasks: ['Summarize current product bets', 'Define experiment signal cadence', 'Create first roadmap review'],
  },
  {
    id: 'sales-bd',
    label: 'Sales / BD',
    teamName: 'Commercial',
    description: 'Pipeline, partner motion, deal SLAs, outreach drafts, and buyer intelligence.',
    seedProject: 'Commercial Engine',
    seedTasks: ['Define ICP and pipeline stages', 'Map deal-SLA alerts', 'Draft first partner follow-up loop'],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    teamName: 'Marketing',
    description: 'Market intel, lead-gen reports, content calendars, launch assets, and campaigns.',
    seedProject: 'Market Intelligence',
    seedTasks: ['Set weekly market digest cadence', 'Create content backlog', 'Map lead-gen report inputs'],
  },
  {
    id: 'finance',
    label: 'Finance',
    teamName: 'Finance',
    description: 'Reimbursements, payout reporting, approvals, invoices, and compliance reminders.',
    seedProject: 'Finance Approvals',
    seedTasks: ['Define reimbursement intake', 'Map approval thresholds', 'Create payout report checklist'],
  },
  {
    id: 'customer-success',
    label: 'Customer Success',
    teamName: 'Customer Success',
    description: 'Issue triage, customer health, resolution tracking, data checks, and escalations.',
    seedProject: 'Customer Issue Triage',
    seedTasks: ['Define daily CS triage queue', 'Map escalation rules', 'Create resolution reporting loop'],
  },
  {
    id: 'people-ops',
    label: 'People Ops',
    teamName: 'People Ops',
    description: 'Daily briefs, standups, recruiting pipeline, OKRs, and 1:1 follow-through.',
    seedProject: 'People Rhythm',
    seedTasks: ['Define daily brief cadence', 'Map recruiting stages', 'Create OKR follow-up loop'],
  },
  {
    id: 'health-business',
    label: 'Health Business',
    teamName: 'Health Business',
    description: 'Churn-risk scoring, early-warning alerts, account health, and health-market ops.',
    seedProject: 'Health Growth Signals',
    seedTasks: ['Define churn-risk indicators', 'Map early-warning alert path', 'Create account-health review'],
  },
  {
    id: 'ai-ops',
    label: 'AI Ops',
    teamName: 'AI Ops',
    description: 'Agent fleet adoption, cost monitoring, model/provider health, and config changes.',
    seedProject: 'Agent Fleet Control',
    seedTasks: ['Map agent registry ownership', 'Define provider health checks', 'Create cost-monitoring cadence'],
  },
  {
    id: 'other',
    label: 'Other',
    teamName: 'Other',
    description: 'A holding team for work outside the closed taxonomy.',
    seedProject: 'General Operations',
    seedTasks: ['Clarify operating domain', 'Define initial owner', 'Create first operating checklist'],
  },
] as const;

type BusinessDomainId = (typeof BUSINESS_DOMAIN_CATALOG)[number]['id'];

type BlueprintAgentAssignment = {
  domainId: BusinessDomainId;
  teamName: string;
  agentName: string;
  agentPrincipalId: string;
  functionLabel: string;
  registryStatus: 'matched' | 'named-existing-agent';
};

type BlueprintTeam = {
  domainId: BusinessDomainId;
  domainLabel: string;
  teamId: string;
  teamName: string;
  projectId: number;
  projectName: string;
  seedTaskIds: number[];
  assignedAgent?: BlueprintAgentAssignment;
};

type BusinessBlueprint = {
  schemaVersion: 1;
  orgId: string;
  orgName: string;
  mission: string;
  domains: BusinessDomainId[];
  teams: BlueprintTeam[];
  agentAssignments: BlueprintAgentAssignment[];
  generatedAt: string;
  confirmedAt?: string;
};

type BusinessOnboardingTaskRepo = {
  listTasks: () => TaskRecord[] | Promise<TaskRecord[]>;
  createTask: (input: CreateTaskInput) => TaskRecord | Promise<TaskRecord>;
};

type BusinessOnboardingTaskRepoFactory = (context: OrgQueryContext) => BusinessOnboardingTaskRepo;

/** Shared taskSyncLayer-compatible factory for production wiring (listTasks/createTask may be async). */
export function createTaskSyncLayerRepoFactory(
  taskLayer: Pick<BusinessOnboardingTaskRepo, 'listTasks' | 'createTask'>,
): BusinessOnboardingTaskRepoFactory {
  return () => ({
    listTasks: () => taskLayer.listTasks(),
    createTask: (input) => taskLayer.createTask(input),
  });
}

interface BusinessOnboardingRouterDeps {
  workspaceRepo: WorkspaceScopeRepository;
  agentRegistryRepo?: Pick<AgentRegistryRepository, 'listAgents'>;
  /** Required: production must inject taskSyncLayer-backed methods (fail-closed; no org-scoped default). */
  taskRepoFactory: BusinessOnboardingTaskRepoFactory;
  now?: () => string;
}

class BusinessOnboardingApiError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

const DOMAIN_BY_ID = new Map(BUSINESS_DOMAIN_CATALOG.map((domain) => [domain.id, domain]));
const NAMED_AGENT_ASSIGNMENTS: Partial<Record<BusinessDomainId, Omit<BlueprintAgentAssignment, 'domainId' | 'teamName' | 'agentPrincipalId' | 'registryStatus'>>> = {
  product: { agentName: 'Atlas', functionLabel: 'Product' },
  'sales-bd': { agentName: 'Mafa', functionLabel: 'Commercial' },
  finance: { agentName: 'Kashy', functionLabel: 'Finance' },
  'customer-success': { agentName: 'Sabi', functionLabel: 'Customer Success' },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalString(body: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    if (!(key in body)) continue;
    const value = body[key];
    if (value === null || typeof value === 'undefined') return undefined;
    if (typeof value !== 'string') {
      throw new BusinessOnboardingApiError(400, `${key} must be a string`);
    }
    return value.trim();
  }
  return undefined;
}

function requiredString(body: Record<string, unknown>, ...keys: string[]): string {
  const value = optionalString(body, ...keys);
  if (!value) {
    throw new BusinessOnboardingApiError(400, `${keys[0]} is required`);
  }
  return value;
}

function parseBody(req: Request): Record<string, unknown> {
  if (!isRecord(req.body)) {
    throw new BusinessOnboardingApiError(400, 'body must be an object');
  }
  return req.body;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
}

function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_.-]+/g, '');
}

function domainsFromUnknown(value: unknown, options: { allowEmpty?: boolean } = {}): BusinessDomainId[] {
  if (!Array.isArray(value)) {
    if (options.allowEmpty) return [];
    throw new BusinessOnboardingApiError(400, 'domains must be an array');
  }

  const domains: BusinessDomainId[] = [];
  const invalid: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      invalid.push(String(entry));
      continue;
    }
    const id = entry.trim() as BusinessDomainId;
    if (!DOMAIN_BY_ID.has(id)) {
      invalid.push(entry);
      continue;
    }
    if (!domains.includes(id)) {
      domains.push(id);
    }
  }

  if (invalid.length > 0) {
    throw new BusinessOnboardingApiError(400, `unsupported domains: ${invalid.join(', ')}`);
  }
  if (!options.allowEmpty && domains.length === 0) {
    throw new BusinessOnboardingApiError(400, 'at least one business domain is required');
  }
  return domains;
}

function parseStoredDomains(org: OrgRecord): BusinessDomainId[] {
  try {
    return domainsFromUnknown(JSON.parse(org.domains_json || '[]'), { allowEmpty: true });
  } catch {
    return [];
  }
}

function parseStoredBlueprint(org: OrgRecord): BusinessBlueprint | null {
  if (!org.blueprint_json) return null;
  try {
    const parsed = JSON.parse(org.blueprint_json) as BusinessBlueprint;
    return parsed && parsed.schemaVersion === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function sendRouteError(res: Response, error: unknown): Response {
  if (error instanceof BusinessOnboardingApiError) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
}

function getOrgOrThrow(workspaceRepo: WorkspaceScopeRepository, orgId: string): OrgRecord {
  const org = workspaceRepo.getOrg(orgId);
  if (!org) {
    throw new BusinessOnboardingApiError(404, 'org not found');
  }
  return org;
}

function findOrgBySlug(workspaceRepo: WorkspaceScopeRepository, slug: string): OrgRecord | undefined {
  return workspaceRepo.listOrgs().find((org) => org.slug === slug);
}

function findExistingTeam(workspaceRepo: WorkspaceScopeRepository, orgId: string, teamId: string, slug: string): TeamRecord | undefined {
  return workspaceRepo.listTeams({ orgId }).find((team) => team.id === teamId || team.slug === slug);
}

function getOrCreateTeam(workspaceRepo: WorkspaceScopeRepository, orgId: string, domain: (typeof BUSINESS_DOMAIN_CATALOG)[number]): TeamRecord {
  const slug = domain.id;
  const teamId = `${orgId}-${slug}`;
  const existing = findExistingTeam(workspaceRepo, orgId, teamId, slug);
  if (existing) return existing;
  return workspaceRepo.createTeam({ orgId }, { id: teamId, name: domain.teamName, slug });
}

function getOrCreateProject(workspaceRepo: WorkspaceScopeRepository, orgId: string, teamId: string, name: string): ProjectRecord {
  const existing = workspaceRepo
    .listProjects({ orgId, teamId })
    .find((project) => project.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (existing) return existing;
  return workspaceRepo.createProject({ orgId, teamId }, { name, lifecycle_state: 'active' });
}

function findMatchingRegistryAgent(
  agents: readonly AgentRegistryRecord[],
  agentName: string,
): AgentRegistryRecord | undefined {
  const wanted = normalizeIdentity(agentName);
  return agents.find((agent) => {
    return [agent.id, agent.slug, agent.name].some((candidate) => normalizeIdentity(candidate) === wanted);
  });
}

function assignmentForDomain(
  domainId: BusinessDomainId,
  teamName: string,
  registryAgents: readonly AgentRegistryRecord[],
): BlueprintAgentAssignment | undefined {
  const named = NAMED_AGENT_ASSIGNMENTS[domainId];
  if (!named) return undefined;
  const registryAgent = findMatchingRegistryAgent(registryAgents, named.agentName);
  if (!registryAgent) return undefined;
  return {
    domainId,
    teamName,
    agentName: registryAgent.name,
    agentPrincipalId: registryAgent.id,
    functionLabel: named.functionLabel,
    registryStatus: 'matched',
  };
}

function createSeedTaskInput(
  org: OrgRecord,
  team: TeamRecord,
  project: ProjectRecord,
  domain: (typeof BUSINESS_DOMAIN_CATALOG)[number],
  taskName: string,
  mission: string,
  assignment: BlueprintAgentAssignment | undefined,
): CreateTaskInput {
  return {
    org_id: org.id,
    team_id: team.id,
    project_id: project.id,
    name: taskName,
    description: `${domain.label}: ${taskName}. Mission context: ${mission}`,
    column: 'todo',
    priority: 'P2',
    project: project.name,
    assignee: assignment?.agentName ?? team.name,
    executor_principal_id: assignment?.agentPrincipalId,
    assignment_state: assignment ? 'assigned' : 'unassigned',
    created_by_principal_id: 'business-onboarding',
    initiator_principal_id: 'business-onboarding',
    initiator_type: 'system',
    owner_principal_id: assignment?.agentPrincipalId ?? 'business-onboarding',
    owner_principal_type: assignment ? 'agent' : 'system',
    metadata: JSON.stringify({
      businessOnboarding: {
        schemaVersion: 1,
        orgId: org.id,
        domainId: domain.id,
        projectId: project.id,
        mappedAgent: assignment
          ? {
              agentName: assignment.agentName,
              agentPrincipalId: assignment.agentPrincipalId,
              functionLabel: assignment.functionLabel,
            }
          : null,
      },
    }),
  };
}

async function getOrCreateSeedTasks(
  taskRepo: BusinessOnboardingTaskRepo,
  inputs: CreateTaskInput[],
): Promise<TaskRecord[]> {
  const existingTasks = await Promise.resolve(taskRepo.listTasks());
  const existingByName = new Map(existingTasks.map((task) => [`${task.team_id ?? ''}:${task.name.trim().toLowerCase()}`, task]));
  const results: TaskRecord[] = [];
  for (const input of inputs) {
    const existing = existingByName.get(`${input.team_id ?? ''}:${input.name.trim().toLowerCase()}`);
    if (existing) {
      results.push(existing);
      continue;
    }
    const created = await Promise.resolve(taskRepo.createTask(input));
    existingByName.set(`${created.team_id ?? ''}:${created.name.trim().toLowerCase()}`, created);
    results.push(created);
  }
  return results;
}

async function buildBlueprint(
  deps: Required<Pick<BusinessOnboardingRouterDeps, 'taskRepoFactory' | 'now'>> & Pick<BusinessOnboardingRouterDeps, 'workspaceRepo' | 'agentRegistryRepo'>,
  org: OrgRecord,
  domains: BusinessDomainId[],
  mission: string,
): Promise<BusinessBlueprint> {
  const registryAgents = deps.agentRegistryRepo?.listAgents() ?? [];
  const teams: BlueprintTeam[] = [];
  const agentAssignments: BlueprintAgentAssignment[] = [];

  for (const domainId of domains) {
    const domain = DOMAIN_BY_ID.get(domainId);
    if (!domain) continue;
    const team = getOrCreateTeam(deps.workspaceRepo, org.id, domain);
    const project = getOrCreateProject(deps.workspaceRepo, org.id, team.id, domain.seedProject);
    const assignment = assignmentForDomain(domainId, team.name, registryAgents);
    if (assignment) agentAssignments.push(assignment);
    const taskRepo = deps.taskRepoFactory({ orgId: org.id, teamId: team.id });
    const seedTasks = await getOrCreateSeedTasks(
      taskRepo,
      domain.seedTasks.map((taskName) => createSeedTaskInput(org, team, project, domain, taskName, mission, assignment)),
    );

    teams.push({
      domainId,
      domainLabel: domain.label,
      teamId: team.id,
      teamName: team.name,
      projectId: project.id,
      projectName: project.name,
      seedTaskIds: seedTasks.map((task) => task.id),
      ...(assignment ? { assignedAgent: assignment } : {}),
    });
  }

  return {
    schemaVersion: 1,
    orgId: org.id,
    orgName: org.name,
    mission,
    domains,
    teams,
    agentAssignments,
    generatedAt: deps.now(),
  };
}

export function createBusinessOnboardingRouter({
  workspaceRepo,
  agentRegistryRepo,
  taskRepoFactory,
  now = () => new Date().toISOString(),
}: BusinessOnboardingRouterDeps): Router {
  if (!taskRepoFactory) {
    throw new Error('taskRepoFactory is required');
  }
  const router = createRouter();
  const blueprintDeps = { workspaceRepo, agentRegistryRepo, taskRepoFactory, now };

  router.get('/onboarding/business/catalog', (_req, res) => {
    return res.json({ domains: BUSINESS_DOMAIN_CATALOG });
  });

  router.post('/onboarding/business/start', (req, res) => {
    try {
      const settings = readBusinessOnboardingSettings();
      if (!settings.enabled) {
        return res.status(403).json({ error: 'business onboarding is disabled by admin settings' });
      }
      const body = parseBody(req);
      const name = requiredString(body, 'orgName', 'name');
      const slug = optionalString(body, 'slug') ?? slugify(name);
      const existing = findOrgBySlug(workspaceRepo, slug);
      if (existing) {
        return res.json({ org: existing, domains: BUSINESS_DOMAIN_CATALOG });
      }
      const org = workspaceRepo.createOrg({
        name,
        slug,
        mission: optionalString(body, 'mission') ?? null,
        domains_json: JSON.stringify([settings.defaultDomain]),
      });
      return res.status(201).json({ org, domains: BUSINESS_DOMAIN_CATALOG });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.patch('/onboarding/business/:orgId', (req, res) => {
    try {
      const org = getOrgOrThrow(workspaceRepo, String(req.params.orgId));
      const body = parseBody(req);
      const domains = 'domains' in body ? domainsFromUnknown(body.domains, { allowEmpty: true }) : undefined;
      const updated = workspaceRepo.updateOrg(org.id, {
        name: optionalString(body, 'orgName', 'name'),
        slug: optionalString(body, 'slug'),
        mission: optionalString(body, 'mission'),
        domains_json: domains ? JSON.stringify(domains) : undefined,
      });
      return res.json({ org: updated ?? org, domains: BUSINESS_DOMAIN_CATALOG });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.post('/onboarding/business/:orgId/provision', async (req, res) => {
    try {
      const settings = readBusinessOnboardingSettings();
      if (!settings.enabled) {
        return res.status(403).json({ error: 'business onboarding is disabled by admin settings' });
      }
      if (settings.requireDryRun && req.body?.dryRun !== true && req.body?.dryRunConfirmed !== true) {
        return res.status(400).json({ error: 'dryRun=true or dryRunConfirmed=true is required before business onboarding provision' });
      }
      const org = getOrgOrThrow(workspaceRepo, String(req.params.orgId));
      const body = parseBody(req);
      const storedDomains = parseStoredDomains(org);
      const domains = 'domains' in body
        ? domainsFromUnknown(body.domains)
        : (storedDomains.length > 0 ? storedDomains : [settings.defaultDomain]);
      if (domains.length === 0) {
        throw new BusinessOnboardingApiError(400, 'at least one business domain is required');
      }
      const mission = optionalString(body, 'mission') ?? org.mission;
      if (!mission) {
        throw new BusinessOnboardingApiError(400, 'mission is required');
      }

      const orgForBlueprint = workspaceRepo.updateOrg(org.id, {
        mission,
        domains_json: JSON.stringify(domains),
      }) ?? org;
      const blueprint = await buildBlueprint(blueprintDeps, orgForBlueprint, domains, mission);
      const updated = workspaceRepo.updateOrg(org.id, {
        mission,
        domains_json: JSON.stringify(domains),
        blueprint_json: JSON.stringify(blueprint),
      }) ?? orgForBlueprint;

      return res.json({ org: updated, blueprint });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.post('/onboarding/business/:orgId/confirm', (req, res) => {
    try {
      const org = getOrgOrThrow(workspaceRepo, String(req.params.orgId));
      const blueprint = parseStoredBlueprint(org);
      if (!blueprint) {
        throw new BusinessOnboardingApiError(409, 'business blueprint has not been provisioned');
      }

      const confirmedAt = blueprint.confirmedAt ?? now();
      const confirmedBlueprint: BusinessBlueprint = blueprint.confirmedAt
        ? blueprint
        : { ...blueprint, confirmedAt };
      const updated = blueprint.confirmedAt
        ? org
        : workspaceRepo.updateOrg(org.id, {
            blueprint_json: JSON.stringify(confirmedBlueprint),
          }) ?? org;

      return res.json({ org: updated, blueprint: confirmedBlueprint, confirmed: true });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  return router;
}
