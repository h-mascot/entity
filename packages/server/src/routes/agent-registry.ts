import type { Router } from 'express';
import { Router as createRouter } from 'express';
import type {
  AgentRegistryRecord,
  AgentRegistryRepository,
  CreateAgentRegistryInput,
  ModuleRegistryRepository,
  UpdateAgentRegistryInput,
} from '../../../db/src';
import { buildAgentCapabilityCard } from '../agent/agent-capability-card';

interface AgentRegistryRouterDeps {
  agentRegistryRepo: AgentRegistryRepository;
  moduleRegistryRepo: ModuleRegistryRepository;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9_.-]{1,63}$/;
const STATUS_VALUES = new Set(['active', 'idle', 'disabled', 'template', 'archived']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function optionalString(body: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string`);
  }
  return value.trim();
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = optionalString(body, key);
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function normalizeJsonField(value: unknown, fallback: string, fieldName: string): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') {
    const trimmed = value.trim() || fallback;
    JSON.parse(trimmed);
    return trimmed;
  }
  return JSON.stringify(value);
}

function validateSlug(slug: string): string {
  const normalized = slug.trim().toLowerCase();
  if (!ID_PATTERN.test(normalized)) {
    throw new Error('slug must be 2-64 chars: lowercase letters, numbers, _, ., or -');
  }
  return normalized;
}

function validateStatus(status: string | null | undefined): string | undefined {
  if (status === undefined || status === null || !status.trim()) return undefined;
  const normalized = status.trim().toLowerCase();
  if (!STATUS_VALUES.has(normalized)) {
    throw new Error(`status must be one of: ${Array.from(STATUS_VALUES).join(', ')}`);
  }
  return normalized;
}

function serializeAgent(
  agent: AgentRegistryRecord,
  moduleRegistryRepo: ModuleRegistryRepository,
): AgentRegistryRecord & { avatarUrl?: string; capabilities: ReturnType<typeof buildAgentCapabilityCard> } {
  const grants = moduleRegistryRepo.listAgentModuleGrants(agent.id);
  const modules = moduleRegistryRepo.listModules();
  return {
    ...agent,
    avatarUrl: agent.avatar_url || undefined,
    capabilities: buildAgentCapabilityCard({ agent, grants, modules }),
  };
}

function findAgent(repo: AgentRegistryRepository, idOrSlug: string): AgentRegistryRecord | undefined {
  return repo.getAgent(idOrSlug) ?? repo.getAgentBySlug(idOrSlug);
}

function parseCreateAgentInput(body: unknown): CreateAgentRegistryInput {
  if (!isRecord(body)) throw new Error('body must be an object');
  const slug = validateSlug(requiredString(body, 'slug'));
  return {
    id: optionalString(body, 'id') ?? slug,
    slug,
    name: requiredString(body, 'name'),
    emoji: optionalString(body, 'emoji') || '🤖',
    avatar_url: optionalString(body, 'avatar_url') ?? optionalString(body, 'avatarUrl') ?? null,
    description: optionalString(body, 'description') ?? null,
    adapter_type: optionalString(body, 'adapter_type') ?? optionalString(body, 'adapterType') ?? null,
    runtime_type: optionalString(body, 'runtime_type') ?? optionalString(body, 'runtimeType') ?? null,
    status: validateStatus(optionalString(body, 'status')) ?? 'active',
    instructions_path: optionalString(body, 'instructions_path') ?? optionalString(body, 'instructionsPath') ?? null,
    metadata_json: normalizeJsonField(body.metadata_json ?? body.metadata ?? undefined, '{}', 'metadata_json'),
  };
}

function parseUpdateAgentInput(body: unknown): UpdateAgentRegistryInput {
  if (!isRecord(body)) throw new Error('body must be an object');
  const updates: UpdateAgentRegistryInput = {};
  const slug = optionalString(body, 'slug');
  if (slug !== undefined && slug !== null) updates.slug = validateSlug(slug);
  const status = validateStatus(optionalString(body, 'status'));
  if (status !== undefined) updates.status = status;

  for (const [bodyKey, updateKey] of [
    ['name', 'name'],
    ['emoji', 'emoji'],
    ['avatar_url', 'avatar_url'],
    ['description', 'description'],
    ['adapter_type', 'adapter_type'],
    ['runtime_type', 'runtime_type'],
    ['instructions_path', 'instructions_path'],
  ] as Array<[string, keyof UpdateAgentRegistryInput]>) {
    const value = optionalString(body, bodyKey);
    if (value !== undefined) (updates as Record<string, unknown>)[updateKey] = value;
  }

  const avatarUrl = optionalString(body, 'avatarUrl');
  if (avatarUrl !== undefined) updates.avatar_url = avatarUrl;
  const adapterType = optionalString(body, 'adapterType');
  if (adapterType !== undefined) updates.adapter_type = adapterType;
  const runtimeType = optionalString(body, 'runtimeType');
  if (runtimeType !== undefined) updates.runtime_type = runtimeType;
  const instructionsPath = optionalString(body, 'instructionsPath');
  if (instructionsPath !== undefined) updates.instructions_path = instructionsPath;
  if ('metadata_json' in body || 'metadata' in body) {
    updates.metadata_json = normalizeJsonField(body.metadata_json ?? body.metadata ?? undefined, '{}', 'metadata_json');
  }
  return updates;
}

function parseGrantInput(body: unknown, agentId: string, moduleIdFromPath?: string) {
  if (!isRecord(body)) throw new Error('body must be an object');
  const moduleId = moduleIdFromPath ?? requiredString(body, 'module_id');
  return {
    agent_id: agentId,
    module_id: moduleId,
    enabled: body.enabled === undefined ? true : Boolean(body.enabled),
    permissions_json: normalizeJsonField(body.permissions_json ?? body.permissions ?? undefined, '[]', 'permissions_json'),
    scope_json: normalizeJsonField(body.scope_json ?? body.scope ?? undefined, '{}', 'scope_json'),
  };
}

export function createAgentRegistryRouter(deps: AgentRegistryRouterDeps): Router {
  const router = createRouter();
  const { agentRegistryRepo, moduleRegistryRepo } = deps;

  router.get('/agents/registry', (_req, res) => {
    const list = agentRegistryRepo
      .listAgents()
      .map((agent) => serializeAgent(agent, moduleRegistryRepo));
    return res.json({ list });
  });

  router.post('/agents', (req, res) => {
    try {
      const input = parseCreateAgentInput(req.body);
      if (agentRegistryRepo.getAgent(input.id ?? input.slug) || agentRegistryRepo.getAgentBySlug(input.slug)) {
        return res.status(409).json({ error: 'Agent already exists.' });
      }
      const agent = agentRegistryRepo.createAgent(input);
      return res.status(201).json({ agent: serializeAgent(agent, moduleRegistryRepo) });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid agent payload.' });
    }
  });

  router.patch('/agents/:id', (req, res) => {
    const agent = findAgent(agentRegistryRepo, String(req.params.id));
    if (!agent) return res.status(404).json({ error: 'Agent not found.' });
    try {
      const updates = parseUpdateAgentInput(req.body);
      const updated = agentRegistryRepo.updateAgent(agent.id, updates);
      if (!updated) return res.status(404).json({ error: 'Agent not found.' });
      return res.json({ agent: serializeAgent(updated, moduleRegistryRepo) });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid agent update payload.' });
    }
  });

  router.delete('/agents/:id', (req, res) => {
    const agent = findAgent(agentRegistryRepo, String(req.params.id));
    if (!agent) return res.status(404).json({ error: 'Agent not found.' });
    const deleted = agentRegistryRepo.deleteAgent(agent.id);
    return res.json({ deleted });
  });

  router.post('/agents/:id/grants', (req, res) => {
    const agent = findAgent(agentRegistryRepo, String(req.params.id));
    if (!agent) return res.status(404).json({ error: 'Agent not found.' });
    try {
      const input = parseGrantInput(req.body, agent.id);
      const moduleExists = moduleRegistryRepo.listModules().some((module) => module.id === input.module_id || module.slug === input.module_id);
      if (!moduleExists) return res.status(404).json({ error: 'Module not found.' });
      const grant = moduleRegistryRepo.upsertAgentModuleGrant(input);
      return res.status(201).json({ grant });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid grant payload.' });
    }
  });

  router.put('/agents/:id/grants/:moduleId', (req, res) => {
    const agent = findAgent(agentRegistryRepo, String(req.params.id));
    if (!agent) return res.status(404).json({ error: 'Agent not found.' });
    try {
      const input = parseGrantInput(req.body, agent.id, String(req.params.moduleId));
      const moduleExists = moduleRegistryRepo.listModules().some((module) => module.id === input.module_id || module.slug === input.module_id);
      if (!moduleExists) return res.status(404).json({ error: 'Module not found.' });
      const grant = moduleRegistryRepo.upsertAgentModuleGrant(input);
      return res.json({ grant });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid grant payload.' });
    }
  });

  router.delete('/agents/:id/grants/:moduleId', (req, res) => {
    const agent = findAgent(agentRegistryRepo, String(req.params.id));
    if (!agent) return res.status(404).json({ error: 'Agent not found.' });
    const deleted = moduleRegistryRepo.deleteAgentModuleGrant(agent.id, String(req.params.moduleId));
    return res.json({ deleted });
  });

  return router;
}
