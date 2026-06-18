import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { loadRuntimeFileConfig } from '../config/runtime';

export const CLICKCLACK_PINNED_COMMIT = 'd77dd568d8ff5c9d3d7c1063b4c317c1e3cd1be2';
export const DEFAULT_CLICKCLACK_BASE_URL = 'http://127.0.0.1:3091';
export const DEFAULT_CLICKCLACK_CHECKOUT = '/tmp/clickclack';

export interface AgentModelSelection {
  modelId?: string;
  isLocal: boolean;
}

export interface ClickClackCompatibilityInput {
  channelId: string;
  content: string;
  targets: string[];
  messageId?: string;
  threadId?: string;
  parentMessageId?: string;
  modelByAgent: Map<string, AgentModelSelection>;
}

export interface ClickClackCompatibilityMessage {
  id: string;
  channelId: string;
  sender: string;
  content: string;
  createdAt: string;
  model?: string;
  isLocal?: boolean;
  clickclackMessage?: ClickClackMessage;
}

export interface ClickClackCompatibilityResult {
  message: ClickClackCompatibilityMessage;
  messages: ClickClackCompatibilityMessage[];
  clickclack: {
    mode: 'dev-sidecar';
    baseUrl: string;
    workspaceId: string;
    channelId: string;
    humanUserId: string;
    agentUserIds: Record<string, string>;
  };
}

export interface ClickClackChatBridge {
  sendCompatibilityMessage(input: ClickClackCompatibilityInput): Promise<ClickClackCompatibilityResult>;
}

interface ClickClackUser {
  id: string;
  kind?: string;
  display_name?: string;
  handle?: string;
}

interface ClickClackWorkspace {
  id: string;
  slug?: string;
  name: string;
}

interface ClickClackChannel {
  id: string;
  workspace_id: string;
  name: string;
  kind?: string;
}

interface ClickClackMessage {
  id: string;
  workspace_id?: string;
  channel_id?: string;
  author_id: string;
  body: string;
  created_at: string;
}

interface AgentBotRecord {
  agent: string;
  workspaceId: string;
  botUserId: string;
  token: string;
  created: boolean;
}

interface BridgeManifest {
  version: 1;
  commit: string;
  agents: Record<string, AgentBotRecord>;
}

export interface CreateClickClackBridgeOptions {
  baseUrl?: string;
  checkoutPath?: string;
  dataDir?: string;
  manifestPath?: string;
  createAgentBot?: (agent: string, workspaceId: string) => Promise<AgentBotRecord>;
  fetcher?: typeof fetch;
}

function repoRoot(): string {
  let current = path.resolve(process.cwd());
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      fs.existsSync(path.join(current, 'package.json')) &&
      fs.existsSync(path.join(current, 'packages', 'server', 'src'))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(process.cwd(), '../..');
}

export function defaultClickClackDataDir(): string {
  return path.join(repoRoot(), 'var', 'clickclack-sidecar');
}

export function defaultClickClackManifestPath(dataDir = defaultClickClackDataDir()): string {
  return path.join(dataDir, 'entity-bridge.json');
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function normalizeAgent(agent: string): string {
  return agent.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function displayAgentName(agent: string): string {
  const normalized = normalizeAgent(agent);
  return normalized
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Entity Agent';
}

function uniqueAgents(agents: string[]): string[] {
  return [...new Set(agents.map(normalizeAgent).filter(Boolean))];
}

function loadActiveConfiguredAgents(root: string): string[] {
  const config = loadRuntimeFileConfig(root);
  return uniqueAgents(
    config.agents
      .filter((agent) => agent.enabled !== false)
      .map((agent) => agent.id)
  );
}

function readManifest(manifestPath: string): BridgeManifest {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BridgeManifest;
    if (parsed?.version === 1 && parsed.commit === CLICKCLACK_PINNED_COMMIT && parsed.agents) {
      return parsed;
    }
  } catch {
    // Missing or invalid manifests are recreated on demand.
  }
  return { version: 1, commit: CLICKCLACK_PINNED_COMMIT, agents: {} };
}

function writeManifest(manifestPath: string, manifest: BridgeManifest): void {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}

function execFileText(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, maxBuffer: 1024 * 1024 * 4 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${command} ${args.join(' ')} failed: ${String(stderr || error.message).trim()}`));
        return;
      }
      resolve(String(stdout ?? '').trim());
    });
  });
}

async function createAgentBotWithCli(
  agent: string,
  workspaceId: string,
  ownerUserId: string,
  options: Required<Pick<CreateClickClackBridgeOptions, 'checkoutPath' | 'dataDir'>>
): Promise<AgentBotRecord> {
  const normalized = normalizeAgent(agent) || 'agent';
  const output = await execFileText('go', [
    'run',
    './apps/api/cmd/clickclack',
    'admin',
    'bot',
    'create',
    '--data',
    options.dataDir,
    '--workspace',
    workspaceId,
    '--owner',
    ownerUserId,
    '--created-by',
    ownerUserId,
    '--name',
    `Entity ${displayAgentName(normalized)}`,
    '--handle',
    `entity-${normalized}-${Date.now().toString(36)}`,
    '--scopes',
    'bot:write',
    '--token-name',
    'entity-sidecar-spike',
  ], options.checkoutPath);

  const parsed = JSON.parse(output) as { bot?: { id?: string }; token?: string };
  const token = typeof parsed.token === 'string' ? parsed.token : '';
  const botUserId = typeof parsed.bot?.id === 'string' ? parsed.bot.id : '';
  if (!token || !botUserId) {
    throw new Error('ClickClack bot creation did not return a bot id and token');
  }

  return { agent: normalized, workspaceId, botUserId, token, created: true };
}

function messageToCompatibility(
  message: ClickClackMessage,
  sender: string,
  model?: AgentModelSelection,
  entityChannelId?: string
): ClickClackCompatibilityMessage {
  return {
    id: message.id,
    channelId: entityChannelId ?? message.channel_id ?? '',
    sender,
    content: message.body,
    createdAt: message.created_at,
    model: model?.modelId,
    isLocal: model?.isLocal,
    clickclackMessage: message,
  };
}

export function createClickClackBridge(options: CreateClickClackBridgeOptions = {}): ClickClackChatBridge {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.ENTITY_CLICKCLACK_BASE_URL ?? DEFAULT_CLICKCLACK_BASE_URL);
  const root = repoRoot();
  const checkoutPath = path.resolve(options.checkoutPath ?? process.env.ENTITY_CLICKCLACK_CHECKOUT ?? DEFAULT_CLICKCLACK_CHECKOUT);
  const dataDir = path.resolve(root, options.dataDir ?? process.env.ENTITY_CLICKCLACK_DATA_DIR ?? defaultClickClackDataDir());
  const manifestPath = options.manifestPath ?? process.env.ENTITY_CLICKCLACK_BRIDGE_MANIFEST ?? defaultClickClackManifestPath(dataDir);
  const fetcher = options.fetcher ?? fetch;

  function activeAgentRoster(): string[] {
    const configured = loadActiveConfiguredAgents(root);
    if (configured.length === 0) {
      throw new Error('ClickClack bridge found no active Entity agents in entity.config.yaml');
    }
    return configured;
  }

  async function request<T>(apiPath: string, init: RequestInit = {}, token?: string): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body && !(init.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    const response = await fetcher(`${baseUrl}${apiPath}`, { ...init, headers });
    if (!response.ok) {
      throw new Error(`ClickClack ${apiPath} failed with ${response.status}: ${await response.text()}`);
    }
    return response.json() as Promise<T>;
  }

  async function pickWorkspace(): Promise<ClickClackWorkspace> {
    const payload = await request<{ workspaces: ClickClackWorkspace[] }>('/api/workspaces');
    const existing = payload.workspaces.find((workspace) => workspace.slug === 'entity' || workspace.name === 'Entity')
      ?? payload.workspaces[0];
    if (existing) {
      return existing;
    }
    const created = await request<{ workspace: ClickClackWorkspace }>('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name: 'Entity', slug: 'entity' }),
    });
    return created.workspace;
  }

  async function pickChannel(workspaceId: string, requestedChannelId: string): Promise<ClickClackChannel> {
    const payload = await request<{ channels: ClickClackChannel[] }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/channels`);
    const requested = requestedChannelId.startsWith('chn_')
      ? payload.channels.find((channel) => channel.id === requestedChannelId)
      : undefined;
    const existing = requested
      ?? payload.channels.find((channel) => channel.name === 'entity-agents')
      ?? payload.channels.find((channel) => channel.name === 'general')
      ?? payload.channels[0];
    if (existing) {
      return existing;
    }
    const created = await request<{ channel: ClickClackChannel }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/channels`, {
      method: 'POST',
      body: JSON.stringify({ name: 'entity-agents', kind: 'public' }),
    });
    return created.channel;
  }

  async function ensureAgentBot(agent: string, workspaceId: string, ownerUserId: string): Promise<AgentBotRecord> {
    const normalized = normalizeAgent(agent) || 'agent';
    const manifest = readManifest(manifestPath);
    const existing = manifest.agents[normalized];
    if (existing?.workspaceId === workspaceId && existing.token) {
      try {
        const payload = await request<{ user: ClickClackUser }>('/api/me', {}, existing.token);
        return {
          ...existing,
          botUserId: payload.user.id || existing.botUserId,
          created: false,
        };
      } catch {
        delete manifest.agents[normalized];
      }
    }

    let created: AgentBotRecord;
    try {
      created = options.createAgentBot
        ? await options.createAgentBot(normalized, workspaceId)
        : await createAgentBotWithCli(normalized, workspaceId, ownerUserId, { checkoutPath, dataDir });
    } catch (error) {
      if (process.env.ENTITY_CLICKCLACK_ALLOW_HUMAN_AGENT_FALLBACK !== '1') {
        throw error;
      }
      created = {
        agent: normalized,
        workspaceId,
        botUserId: ownerUserId,
        token: '',
        created: false,
      };
    }
    manifest.agents[normalized] = created;
    writeManifest(manifestPath, manifest);
    return created;
  }

  async function sendChannelMessage(channelId: string, body: string, token?: string, parentMessageId?: string): Promise<ClickClackMessage> {
    const endpoint = parentMessageId
      ? `/api/messages/${encodeURIComponent(parentMessageId)}/thread/replies`
      : `/api/channels/${encodeURIComponent(channelId)}/messages`;
    const payload = await request<{ message: ClickClackMessage }>(endpoint, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }, token);
    return payload.message;
  }

  return {
    async sendCompatibilityMessage(input) {
      const me = await request<{ user: ClickClackUser }>('/api/me');
      const workspace = await pickWorkspace();
      const channel = await pickChannel(workspace.id, input.channelId);
      const humanMessage = await sendChannelMessage(channel.id, input.content);
      const agentUserIds: Record<string, string> = {};
      const replies: ClickClackCompatibilityMessage[] = [];
      const roster = uniqueAgents([...activeAgentRoster(), ...input.targets]);

      for (const agent of roster) {
        const bot = await ensureAgentBot(agent, workspace.id, me.user.id);
        agentUserIds[agent] = bot.botUserId;
      }

      for (const target of input.targets) {
        const agent = normalizeAgent(target) || 'agent';
        const model = input.modelByAgent.get(agent);
        const bot = await ensureAgentBot(agent, workspace.id, me.user.id);
        const replyText = [
          `${displayAgentName(agent)} received the Entity sidecar spike message.`,
          `Echo: ${input.content}`,
        ].join('\n');
        const reply = await sendChannelMessage(channel.id, replyText, bot.token || undefined, humanMessage.id);
        replies.push(messageToCompatibility(reply, agent, model, input.channelId));
      }

      return {
        message: messageToCompatibility(humanMessage, 'user', undefined, input.channelId),
        messages: replies,
        clickclack: {
          mode: 'dev-sidecar',
          baseUrl,
          workspaceId: workspace.id,
          channelId: channel.id,
          humanUserId: me.user.id,
          agentUserIds,
        },
      };
    },
  };
}
