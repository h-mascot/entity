export interface BuiltInAgentRecord {
  id: string;
  slug: string;
  name: string;
  emoji: string;
  avatarUrl?: string;
  status: 'online' | 'offline';
  modules: string[];
}

/**
 * Fallback agents used when the API is unavailable or returns no agents.
 * human is always included as an authorship identity.
 */
export const FALLBACK_AGENTS: BuiltInAgentRecord[] = [
  {
    id: 'human',
    slug: 'human',
    name: 'Human',
    emoji: '👤',
    status: 'online',
    modules: ['chat', 'tasks', 'files', 'docs'],
  },
  {
    id: 'assistant',
    slug: 'assistant',
    name: 'Assistant',
    emoji: '🤖',
    status: 'online',
    modules: ['chat', 'tasks', 'files', 'docs'],
  },
];

/**
 * Legacy export — use getCachedAgents() for runtime registry.
 * Kept for TypeScript type inference (typeof BUILT_IN_AGENTS[number]).
 */
export const BUILT_IN_AGENTS: BuiltInAgentRecord[] = FALLBACK_AGENTS;

/**
 * Registry cache populated from /api/agents. Falls back to FALLBACK_AGENTS.
 */
let _cachedAgents: BuiltInAgentRecord[] | null = null;

export function getCachedAgents(): BuiltInAgentRecord[] {
  if (!_cachedAgents) {
    return FALLBACK_AGENTS;
  }
  return _cachedAgents;
}

export function setCachedAgents(agents: BuiltInAgentRecord[]): void {
  _cachedAgents = agents.length > 0 ? agents : FALLBACK_AGENTS;
}

export const BUILT_IN_AGENT_AVATARS: Record<string, string> = {};

export const BUILT_IN_AUTHORSHIP_ACTORS = ['human', 'assistant'] as const;

function normalizeAgentIdentity(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

export function getAgentRegistryRecord(identity: string | null | undefined): BuiltInAgentRecord | null {
  const normalized = normalizeAgentIdentity(identity ?? '');
  if (!normalized) {
    return null;
  }

  const agents = getCachedAgents();
  return agents.find((agent) => {
    return [agent.id, agent.slug, agent.name].some((candidate) => normalizeAgentIdentity(candidate) === normalized);
  }) ?? null;
}

export function resolveAgentAvatarUrl(identity: string | null | undefined): string | undefined {
  return getAgentRegistryRecord(identity)?.avatarUrl;
}

export function resolveAgentDisplayName(identity: string | null | undefined): string {
  const record = getAgentRegistryRecord(identity);
  if (record) {
    return record.name;
  }

  const normalized = identity?.trim();
  if (!normalized) {
    return 'Agent';
  }

  return normalized[0]?.toUpperCase() + normalized.slice(1);
}

export function resolveAgentEmoji(identity: string | null | undefined): string {
  return getAgentRegistryRecord(identity)?.emoji ?? '🤖';
}

export function getAgentsForModule(moduleId: string): BuiltInAgentRecord[] {
  return getCachedAgents().filter((agent) => agent.modules.includes(moduleId));
}

export function getChatAgentOptions() {
  return getAgentsForModule('chat').map((agent) => ({
    id: agent.slug,
    name: agent.name,
    emoji: agent.emoji,
  }));
}

export function getFileAgentFilterOptions() {
  return getAgentsForModule('files').map((agent) => ({
    id: agent.slug,
    name: agent.name,
  }));
}

export function getDocumentAuthorSlugs() {
  return getCachedAgents().map((agent) => agent.slug);
}
