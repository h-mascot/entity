import { createHash } from 'crypto';
import { Router, type Request, type Response } from 'express';
import {
  createAgentImportRepository,
  type AgentImportRepository,
  type AgentRegistryRepository,
  type ModuleRegistryRepository,
  type WorkspaceScopeRepository,
} from '../../../db/src';
import { createRequireAdminPrincipal } from '../middleware/admin-auth';
import { resolveRequestActorId } from '../principals/request-context';

interface AgentImportRouterDependencies {
  importRepo?: AgentImportRepository;
  agentRegistryRepo: AgentRegistryRepository;
  moduleRegistryRepo: ModuleRegistryRepository;
  workspaceRepo: Pick<WorkspaceScopeRepository, 'getOrg' | 'listTeams' | 'getTeam'>;
  chatRepo: { getChannel: (id: string) => unknown };
  /** Test seam: skip the admin-principal gate (focused logic tests). */
  skipAdminAuth?: boolean;
}

interface NormalizedAgentImport {
  externalId: string;
  existingAgentId: string | null;
  name: string | null;
  slug: string | null;
  emoji: string;
  teamIds: string[];
  moduleIds: string[];
  channelIds: string[];
  reviewPolicy: { required: boolean; human_gate_required: boolean };
}

class AgentImportError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9_.-]{1,63}$/;
const TOP_LEVEL_KEYS = new Set(['source', 'agents']);
const AGENT_KEYS = new Set([
  'externalId',
  'existingAgentId',
  'name',
  'slug',
  'emoji',
  'teamIds',
  'moduleIds',
  'channelIds',
  'reviewPolicy',
]);
const REVIEW_POLICY_KEYS = new Set(['required', 'humanGateRequired']);

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentImportError(400, `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, field: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new AgentImportError(400, `${field} contains unsupported fields: ${unknown.join(', ')}`);
  }
}

function requiredString(value: unknown, field: string, max = 240): string {
  if (typeof value !== 'string' || !value.trim()) throw new AgentImportError(400, `${field} is required`);
  const normalized = value.trim();
  if (normalized.length > max) throw new AgentImportError(400, `${field} is too long`);
  return normalized;
}

function optionalString(value: unknown, field: string, max = 240): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredString(value, field, max);
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new AgentImportError(400, `${field} must be an array`);
  return [...new Set(value.map((item) => requiredString(item, field, 200)))].sort();
}

function parseAgent(value: unknown): NormalizedAgentImport {
  const input = record(value, 'agent import');
  rejectUnknownKeys(input, AGENT_KEYS, 'agent import');
  const existingAgentId = optionalString(input.existingAgentId, 'existingAgentId', 200);
  const name = optionalString(input.name, 'name');
  const rawSlug = optionalString(input.slug, 'slug', 64);
  const slug = rawSlug?.toLowerCase() ?? null;
  if (!existingAgentId && (!name || !slug)) {
    throw new AgentImportError(400, 'name and slug are required when existingAgentId is not supplied');
  }
  if (slug && !SLUG_PATTERN.test(slug)) {
    throw new AgentImportError(400, 'slug must be 2-64 chars: lowercase letters, numbers, _, ., or -');
  }
  const review = record(input.reviewPolicy, 'reviewPolicy');
  rejectUnknownKeys(review, REVIEW_POLICY_KEYS, 'reviewPolicy');
  if (typeof review.required !== 'boolean' || typeof review.humanGateRequired !== 'boolean') {
    throw new AgentImportError(400, 'reviewPolicy flags must be booleans');
  }
  return {
    externalId: requiredString(input.externalId, 'externalId', 200),
    existingAgentId,
    name,
    slug,
    emoji: optionalString(input.emoji, 'emoji', 20) ?? '🤖',
    teamIds: stringArray(input.teamIds, 'teamIds'),
    moduleIds: stringArray(input.moduleIds, 'moduleIds'),
    channelIds: stringArray(input.channelIds, 'channelIds'),
    reviewPolicy: {
      required: review.required,
      human_gate_required: review.humanGateRequired,
    },
  };
}

function parsePayload(value: unknown): { source: string; agents: NormalizedAgentImport[] } {
  const body = record(value, 'body');
  rejectUnknownKeys(body, TOP_LEVEL_KEYS, 'body');
  if (!Array.isArray(body.agents) || body.agents.length < 1 || body.agents.length > 100) {
    throw new AgentImportError(400, 'agents must contain 1-100 entries');
  }
  const agents = body.agents.map(parseAgent);
  const externalIds = new Set<string>();
  for (const agent of agents) {
    if (externalIds.has(agent.externalId)) {
      throw new AgentImportError(400, `duplicate externalId in import: ${agent.externalId}`);
    }
    externalIds.add(agent.externalId);
  }
  return {
    source: requiredString(body.source, 'source', 80).toLowerCase(),
    agents,
  };
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function actor(req: Request): string {
  return resolveRequestActorId(req, 'system');
}

// REC-006 adaptation: the curacel-readiness line enforced org membership roles
// (owner/admin/member) from its session-backed principal. Current main uses the
// persisted admin-principal model, so org-management mutations require an
// admin principal (same posture as /principals management routes); option reads
// stay behind the global API auth boundary like the rest of the org surface.
function createAgentImportGuards(skipAdminAuth: boolean) {
  const requireAdminPrincipal = createRequireAdminPrincipal();
  return {
    admin: (req: Request, res: Response, next: () => void): void => {
      if (skipAdminAuth) {
        next();
        return;
      }
      requireAdminPrincipal(req, res, next);
    },
  };
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof AgentImportError) {
    res.status(error.statusCode).json({
      code: error.statusCode === 409 ? 'AGENT_IMPORT_CONFLICT' : 'AGENT_IMPORT_INVALID',
      error: error.message,
    });
    return;
  }
  const message = error instanceof Error ? error.message : 'Agent import failed';
  const conflict = /idempotency|unique constraint|already mapped/i.test(message);
  res.status(conflict ? 409 : 400).json({
    code: conflict ? 'AGENT_IMPORT_CONFLICT' : 'AGENT_IMPORT_INVALID',
    error: message,
  });
}

function importOwnsGrant(scopeJson: string, orgId: string): boolean {
  try {
    const scope = JSON.parse(scopeJson) as Record<string, unknown>;
    return scope.source === 'agent-import' && scope.org_id === orgId;
  } catch {
    return false;
  }
}

function aliasSlug(sourceSlug: string, identityHash: string): string {
  const base = sourceSlug.toLowerCase().replace(/[^a-z0-9_.-]/g, '-').replace(/^-+/, '') || 'agent';
  return `${base.slice(0, 55)}-${identityHash.slice(0, 8)}`;
}

export function createAgentImportRouter(deps: AgentImportRouterDependencies): Router {
  const router = Router();
  const imports = deps.importRepo ?? createAgentImportRepository();
  const guards = createAgentImportGuards(Boolean(deps.skipAdminAuth));

  router.get('/orgs/:orgId/agent-import-options', (req, res) => {
    if (!deps.workspaceRepo.getOrg(req.params.orgId)) {
      res.status(404).json({ code: 'ORG_NOT_FOUND', error: 'Organization not found.' });
      return;
    }
    const mappings = imports.listMappings(req.params.orgId)
      .filter((mapping) => deps.agentRegistryRepo.getAgent(mapping.agent_id));
    res.json({
      mappings: mappings.map((mapping) => {
        const agent = deps.agentRegistryRepo.getAgent(mapping.agent_id);
        return {
          agent_id: mapping.agent_id,
          external_id: mapping.external_id,
          team_ids: mapping.team_ids,
          mapping_kind: mapping.source_agent_id && mapping.source_agent_id !== mapping.agent_id
            ? 'synthetic-alias'
            : 'direct',
          runtime_ready: agent?.binding_state === 'bound' && agent.provider_type !== 'unknown',
        };
      }),
    });
  });

  router.get('/orgs/:orgId/agent-imports', guards.admin, (req, res) => {
    if (!deps.workspaceRepo.getOrg(req.params.orgId)) {
      res.status(404).json({ code: 'ORG_NOT_FOUND', error: 'Organization not found.' });
      return;
    }
    const latest = imports.getLatestReceipt(req.params.orgId);
    res.json({
      mappings: imports.listMappings(req.params.orgId),
      latestReceipt: latest ? { id: latest.id, ...JSON.parse(latest.receipt_json) } : null,
      channelAccessGranted: false,
    });
  });

  router.post('/orgs/:orgId/agent-imports', guards.admin, (req, res) => {
    try {
      const orgId = req.params.orgId;
      if (!deps.workspaceRepo.getOrg(orgId)) throw new AgentImportError(404, 'Organization not found.');
      const key = requiredString(req.header('idempotency-key'), 'Idempotency-Key', 200);
      const payload = parsePayload(req.body);
      const inputHash = stableHash(payload);
      const existingReceipt = imports.getReceiptByIdempotencyKey(orgId, key);
      if (existingReceipt && existingReceipt.input_hash !== inputHash) {
        throw new AgentImportError(409, 'Idempotency-Key was already used for different input.');
      }
      if (existingReceipt) {
        res.status(200).json({
          receipt: { id: existingReceipt.id, ...JSON.parse(existingReceipt.receipt_json) },
          mappingCount: imports.listMappings(orgId).length,
        });
        return;
      }

      const teams = new Set(deps.workspaceRepo.listTeams({ orgId }).map((team) => team.id));
      const modules = deps.moduleRegistryRepo.listModules().filter((module) => module.enabled);
      const moduleIds = new Map(modules.flatMap((module) => [[module.id, module.id], [module.slug, module.id]]));
      for (const agent of payload.agents) {
        for (const teamId of agent.teamIds) {
          if (!teams.has(teamId)) throw new AgentImportError(400, `team is not in organization: ${teamId}`);
        }
        agent.moduleIds = agent.moduleIds.map((moduleId) => {
          const canonicalId = moduleIds.get(moduleId);
          if (!canonicalId) throw new AgentImportError(400, `module capability is unavailable: ${moduleId}`);
          return canonicalId;
        }).sort();
        for (const channelId of agent.channelIds) {
          if (!deps.chatRepo.getChannel(channelId)) {
            throw new AgentImportError(400, `channel reference does not exist: ${channelId}`);
          }
        }
      }

      const stored = imports.importBatch({
        org_id: orgId,
        idempotency_key: key,
        input_hash: inputHash,
        actor_user_id: actor(req),
      }, () => {
        const createdAgentIds: string[] = [];
        const reusedAgentIds: string[] = [];
        const mappings = payload.agents.map((input) => {
          const previous = imports.getMapping(orgId, payload.source, input.externalId);
          let agent = previous ? deps.agentRegistryRepo.getAgent(previous.agent_id) : undefined;
          let sourceAgentId = previous?.source_agent_id ?? null;
          let createdAgent = false;
          if (
            previous
            && input.existingAgentId
            && input.existingAgentId !== (previous.source_agent_id ?? previous.agent_id)
          ) {
            throw new AgentImportError(409, `external identity is already mapped: ${input.externalId}`);
          }
          if (!agent && input.existingAgentId) {
            agent = deps.agentRegistryRepo.getAgent(input.existingAgentId);
            if (!agent) throw new AgentImportError(400, `existingAgentId was not found: ${input.existingAgentId}`);
          }
          if (agent) {
            const assignedScope = imports.getMappingByAgent(agent.id);
            if (assignedScope && assignedScope.org_id !== orgId) {
              const sourceAgent = agent;
              sourceAgentId = sourceAgent.id;
              const identityHash = stableHash([orgId, payload.source, input.externalId]);
              const aliasId = `imported-${identityHash.slice(0, 24)}`;
              agent = deps.agentRegistryRepo.getAgent(aliasId);
              if (agent) {
                throw new AgentImportError(409, `organization alias identity already exists: ${aliasId}`);
              }
              const slug = aliasSlug(sourceAgent.slug, identityHash);
              const slugCollision = deps.agentRegistryRepo.getAgentBySlug(slug);
              if (slugCollision) {
                throw new AgentImportError(409, `organization alias slug already exists: ${slug}`);
              }
              agent = deps.agentRegistryRepo.createAgent({
                id: aliasId,
                slug,
                name: sourceAgent.name,
                emoji: sourceAgent.emoji,
                description: 'Organization-local alias for an existing runtime agent.',
                provider_type: 'unknown',
                binding_state: 'unknown',
                status: 'active',
                metadata_json: JSON.stringify({
                  imported: true,
                  org_id: orgId,
                  source: payload.source,
                  external_id: input.externalId,
                  alias_of: sourceAgent.id,
                }),
              });
              createdAgentIds.push(agent.id);
              createdAgent = true;
            } else if (input.existingAgentId) {
              sourceAgentId = input.existingAgentId;
            }
          }
          if (!agent) {
            const slug = input.slug as string;
            const collision = deps.agentRegistryRepo.getAgentBySlug(slug);
            if (collision) {
              throw new AgentImportError(409, `slug already exists; select it with existingAgentId: ${slug}`);
            }
            const id = `imported-${stableHash([orgId, payload.source, input.externalId]).slice(0, 24)}`;
            const idCollision = deps.agentRegistryRepo.getAgent(id);
            if (idCollision) {
              throw new AgentImportError(409, `generated agent identity already exists: ${id}`);
            }
            agent = deps.agentRegistryRepo.createAgent({
              id,
              slug,
              name: input.name as string,
              emoji: input.emoji,
              description: 'Imported from an existing runtime fleet.',
              provider_type: 'unknown',
              binding_state: 'unknown',
              status: 'active',
              metadata_json: JSON.stringify({
                imported: true,
                org_id: orgId,
                source: payload.source,
                external_id: input.externalId,
              }),
            });
            createdAgentIds.push(agent.id);
            createdAgent = true;
          }
          if (!createdAgent) {
            reusedAgentIds.push(agent.id);
          }

          const desiredModules = new Set(input.moduleIds);
          for (const grant of deps.moduleRegistryRepo.listAgentModuleGrants(agent.id)) {
            if (!desiredModules.has(grant.module_id) && importOwnsGrant(grant.scope_json, orgId)) {
              deps.moduleRegistryRepo.deleteAgentModuleGrant(agent.id, grant.module_id);
            }
          }
          for (const moduleId of input.moduleIds) {
            const existingGrant = deps.moduleRegistryRepo.listAgentModuleGrants(agent.id)
              .find((grant) => grant.module_id === moduleId);
            if (existingGrant && !importOwnsGrant(existingGrant.scope_json, orgId)) {
              throw new AgentImportError(
                409,
                `module grant is managed outside this organization import: ${moduleId}`,
              );
            }
            deps.moduleRegistryRepo.upsertAgentModuleGrant({
              agent_id: agent.id,
              module_id: moduleId,
              permissions_json: '[]',
              scope_json: JSON.stringify({
                org_id: orgId,
                team_ids: input.teamIds,
                channel_ids: input.channelIds,
                source: 'agent-import',
              }),
            });
          }
          return imports.upsertMapping({
            org_id: orgId,
            source: payload.source,
            external_id: input.externalId,
            agent_id: agent.id,
            source_agent_id: sourceAgentId,
            team_ids: input.teamIds,
            module_ids: input.moduleIds,
            channel_ids: input.channelIds,
            review_policy: input.reviewPolicy,
            imported_by_user_id: actor(req),
          });
        });
        return {
          receipt: {
            orgId,
            source: payload.source,
            inputHash,
            createdAgentIds,
            reusedAgentIds,
            mappingIds: mappings.map((mapping) => mapping.id),
            channelAccessGranted: false,
            importedAt: new Date().toISOString(),
          },
        };
      });
      res.status(201).json({
        receipt: { id: stored.id, ...JSON.parse(stored.receipt_json) },
        mappingCount: imports.listMappings(orgId).length,
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}
