export interface BuiltInAgentRecord {
  id: string;
  slug: string;
  name: string;
  emoji: string;
  avatarUrl?: string;
  model: string;
  gateway: string;
  status: 'online' | 'offline';
  modules: string[];
}

export const BUILT_IN_AGENTS: readonly BuiltInAgentRecord[] = [
  { id: 'main', slug: 'ada', name: 'Ada', emoji: '🔮', avatarUrl: '/agent-avatars/ada.jpg', model: 'Opus 4.6', gateway: 'ada-gateway', status: 'online', modules: ['chat', 'tasks', 'files', 'docs', 'swarm', 'plugins'] },
  { id: 'spock', slug: 'spock', name: 'Spock', emoji: '🖖', avatarUrl: '/agent-avatars/spock.jpg', model: 'Kimi', gateway: 'ada-gateway', status: 'online', modules: ['chat', 'tasks', 'files', 'docs'] },
  { id: 'scotty', slug: 'scotty', name: 'Scotty', emoji: '🔧', avatarUrl: '/agent-avatars/scotty.jpg', model: 'Sonnet', gateway: 'Pi', status: 'online', modules: ['chat', 'tasks', 'files', 'docs', 'swarm'] },
  { id: 'geordi', slug: 'geordi', name: 'Geordi', emoji: '👷', avatarUrl: '/agent-avatars/geordi.png', model: 'GPT-5.3 Codex', gateway: 'MascotM3', status: 'online', modules: ['chat', 'tasks', 'files', 'docs', 'swarm', 'plugins'] },
  { id: 'zora', slug: 'zora', name: 'Zora', emoji: '🌌', avatarUrl: '/agent-avatars/zora.jpg', model: 'Gemini Flash', gateway: 'MascotM3', status: 'online', modules: ['chat', 'tasks', 'files', 'docs'] },
  { id: 'midas', slug: 'midas', name: 'Midas', emoji: '✨', model: 'GPT-5.3 Codex', gateway: 'ada-gateway', status: 'online', modules: ['chat', 'tasks', 'files', 'docs', 'plugins'] },
  { id: 'uhura', slug: 'uhura', name: 'Uhura', emoji: '📡', model: 'Gemini Flash', gateway: 'ada-gateway', status: 'online', modules: ['chat', 'tasks', 'files', 'docs'] },
  { id: 'book', slug: 'book', name: 'Book', emoji: '📚', model: 'Gemini Flash', gateway: 'ada-gateway', status: 'online', modules: ['chat', 'tasks', 'files', 'docs'] },
];

export const BUILT_IN_AGENT_AVATARS: Record<string, string> = BUILT_IN_AGENTS.reduce((acc, agent) => {
  if (agent.avatarUrl) {
    acc[agent.id] = agent.avatarUrl;
    acc[agent.slug] = agent.avatarUrl;
    acc[agent.name.toLowerCase()] = agent.avatarUrl;
  }
  return acc;
}, {} as Record<string, string>);

export const BUILT_IN_AUTHORSHIP_ACTORS = ['human', ...BUILT_IN_AGENTS.map((agent) => agent.slug)] as const;

function normalizeAgentIdentity(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

export function getAgentRegistryRecord(identity: string | null | undefined): BuiltInAgentRecord | null {
  const normalized = normalizeAgentIdentity(identity ?? '');
  if (!normalized) {
    return null;
  }

  return BUILT_IN_AGENTS.find((agent) => {
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
  return BUILT_IN_AGENTS.filter((agent) => agent.modules.includes(moduleId));
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
  return BUILT_IN_AGENTS.map((agent) => agent.slug);
}
