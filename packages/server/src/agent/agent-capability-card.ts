export interface AgentCapabilitySource {
  id: string;
  slug?: string | null;
  description?: string | null;
  adapter_type?: string | null;
  runtime_type?: string | null;
  status?: string | null;
  metadata_json?: string | null;
}

export interface ModuleGrantSource {
  agent_id: string;
  module_id: string;
  enabled: boolean;
  permissions_json: string;
  scope_json: string;
}

export interface ModuleSource {
  id: string;
  slug: string;
  name: string;
  permissions_schema_json: string;
  ui_config_json: string;
}

interface AgentCapabilityMetadata {
  modules?: string[];
  owner?: string;
  verification?: string;
  permissions?: string[];
}

export interface AgentCapabilityCard {
  adapterType?: string;
  runtimeType?: string;
  moduleCount: number;
  status?: string;
  ownerLabel?: string;
  verificationLabel?: string;
  capabilityLabels: string[];
  permissionLabels: string[];
  runtimeLabel?: string;
  identityLabel?: string;
}

const MAX_CAPABILITY_LABELS = 4;
const MAX_PERMISSION_LABELS = 4;

// Default owner labels for well-known agent slugs.
// Public install uses generic 'Entity' for all.
// Enterprise-specific mappings are loaded from entity config profiles only.
const DEFAULT_OWNER_BY_SLUG: Record<string, string> = {};

function parseJsonValue(value: string | null | undefined): unknown {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry): entry is string => entry.length > 0);
}

function normalizeLabel(value: string): string {
  const normalized = value.trim().replace(/[_-]+/g, ' ');
  if (!normalized) {
    return value;
  }

  return normalized
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function uniqueLimited(values: string[], limit: number): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(value.trim());
    if (unique.length >= limit) {
      break;
    }
  }

  return unique;
}

function parseAgentMetadata(agent: AgentCapabilitySource): AgentCapabilityMetadata {
  const parsed = parseJsonValue(agent.metadata_json);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }

  const record = parsed as Record<string, unknown>;
  return {
    modules: toStringArray(record.modules),
    owner: typeof record.owner === 'string' && record.owner.trim() ? record.owner.trim() : undefined,
    verification:
      typeof record.verification === 'string' && record.verification.trim()
        ? record.verification.trim()
        : undefined,
    permissions: toStringArray(record.permissions),
  };
}

function resolveModuleLabel(module: ModuleSource | undefined, fallbackSlug: string): string {
  if (!module) {
    return normalizeLabel(fallbackSlug);
  }

  const uiConfig = parseJsonValue(module.ui_config_json);
  if (uiConfig && typeof uiConfig === 'object' && !Array.isArray(uiConfig)) {
    const label = (uiConfig as Record<string, unknown>).label;
    if (typeof label === 'string' && label.trim()) {
      return label.trim();
    }
  }

  if (module.name.trim()) {
    return module.name.trim();
  }

  return normalizeLabel(module.slug);
}

function resolveOwnerLabel(agent: AgentCapabilitySource, metadata: AgentCapabilityMetadata): string | undefined {
  if (metadata.owner) {
    return metadata.owner;
  }

  const key = (agent.slug || agent.id).trim().toLowerCase();
  if (DEFAULT_OWNER_BY_SLUG[key]) {
    return DEFAULT_OWNER_BY_SLUG[key];
  }

  // Generic fallback: derive owner from agent slug or runtime type
  if (key) {
    return 'Entity';
  }

  return undefined;
}

function resolveVerificationLabel(
  metadata: AgentCapabilityMetadata,
  enabledGrantCount: number,
): string | undefined {
  if (metadata.verification) {
    return metadata.verification;
  }

  if (enabledGrantCount > 0) {
    return `Registry + ${enabledGrantCount} grant${enabledGrantCount === 1 ? '' : 's'}`;
  }

  return 'Registry only';
}

function resolveCapabilityLabels(
  metadata: AgentCapabilityMetadata,
  enabledGrants: ModuleGrantSource[],
  modulesById: Map<string, ModuleSource>,
  modulesBySlug: Map<string, ModuleSource>,
): string[] {
  const labelsFromGrants = enabledGrants.map((grant) => {
    const module = modulesById.get(grant.module_id);
    return resolveModuleLabel(module, module?.slug ?? grant.module_id);
  });
  if (labelsFromGrants.length > 0) {
    return uniqueLimited(labelsFromGrants, MAX_CAPABILITY_LABELS);
  }

  const labelsFromMetadata = metadata.modules?.map((slug) => {
    const module = modulesBySlug.get(slug);
    return resolveModuleLabel(module, slug);
  }) ?? [];
  return uniqueLimited(labelsFromMetadata, MAX_CAPABILITY_LABELS);
}

function resolvePermissionLabels(
  metadata: AgentCapabilityMetadata,
  enabledGrants: ModuleGrantSource[],
  modulesById: Map<string, ModuleSource>,
): string[] {
  const collected: string[] = [];

  collected.push(...(metadata.permissions ?? []).map(normalizeLabel));

  for (const grant of enabledGrants) {
    const parsedGrantPermissions = toStringArray(parseJsonValue(grant.permissions_json));
    const module = modulesById.get(grant.module_id);
    const parsedModulePermissions = module
      ? toStringArray(parseJsonValue(module.permissions_schema_json))
      : [];
    const permissions = parsedGrantPermissions.length > 0 ? parsedGrantPermissions : parsedModulePermissions;

    for (const permission of permissions) {
      collected.push(normalizeLabel(permission));
    }
  }

  return uniqueLimited(collected, MAX_PERMISSION_LABELS);
}

function resolveRuntimeLabel(agent: AgentCapabilitySource): string | undefined {
  const parts = [agent.adapter_type, agent.runtime_type, agent.status]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value): value is string => value.length > 0)
    .map((value) => normalizeLabel(value));

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join(' · ');
}

export function buildAgentCapabilityCard(input: {
  agent: AgentCapabilitySource;
  grants: ModuleGrantSource[];
  modules: ModuleSource[];
}): AgentCapabilityCard {
  const metadata = parseAgentMetadata(input.agent);
  const enabledGrants = input.grants.filter((grant) => grant.enabled);
  const modulesById = new Map(input.modules.map((module) => [module.id, module]));
  const modulesBySlug = new Map(input.modules.map((module) => [module.slug, module]));

  const capabilityLabels = resolveCapabilityLabels(metadata, enabledGrants, modulesById, modulesBySlug);
  const permissionLabels = resolvePermissionLabels(metadata, enabledGrants, modulesById);

  return {
    adapterType: input.agent.adapter_type ?? undefined,
    runtimeType: input.agent.runtime_type ?? undefined,
    moduleCount: enabledGrants.length > 0 ? enabledGrants.length : metadata.modules?.length ?? 0,
    status: input.agent.status ?? undefined,
    ownerLabel: resolveOwnerLabel(input.agent, metadata),
    verificationLabel: resolveVerificationLabel(metadata, enabledGrants.length),
    capabilityLabels,
    permissionLabels,
    runtimeLabel: resolveRuntimeLabel(input.agent),
    identityLabel: input.agent.description?.trim() || undefined,
  };
}
