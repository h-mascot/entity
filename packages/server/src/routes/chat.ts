import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import type express from 'express';
import { createClickClackBridge, type ClickClackChatBridge } from '../clickclack/bridge';
import { createEnvClickClackReadinessProbe, type ClickClackReadinessProbe } from '../clickclack/readiness';
import {
  createChatRepository,
  type ChatCategoryRecord,
  type ChatChannelRecord,
  type ChatMessageRecord,
  type ChatThreadRecord,
} from '../../../db/src/chat';
import {
  type ObjectRef,
} from '../../../db/src';
import { ChatModelRegistry, type ChatModelOption } from './chat-model-registry';
import { requireRequestOrg, sendPermissionDenied, type RequestOrgBinding } from '../request-permissions';
import { isTrustedServiceContext, requireOrgAuthority } from '../principals/request-context';

interface ChatObjectRefAccessDecision {
  allowed: boolean;
  reason?: string;
}

type ChatObjectRefAccess = (binding: RequestOrgBinding, objectRef: ObjectRef) => ChatObjectRefAccessDecision;

interface ChatRouteDependencies {
  app: express.Express;
  openClawBaseUrl?: string;
  clickClackBridge?: ClickClackChatBridge;
  clickClackReadiness?: ClickClackReadinessProbe;
  chatObjectRefAccess?: ChatObjectRefAccess;
  /**
   * R4: resolves the tenant org of a task id so `/api/chat/task/:taskId` can be
   * tenant-authorized for customer principals. Optional; when absent the route
   * trusts the resolved customer scope but cannot deny a foreign task id.
   */
  getTaskOrg?: (taskId: string) => Promise<string | null | undefined> | string | null | undefined;
}

interface OpenClawReply {
  sender: string;
  senderEmoji?: string;
  content: string;
  model?: string;
  isLocal?: boolean;
}

const DEFAULT_AGENT_EMOJI: Record<string, string> = {
  ada: '🔮',
  zora: '🌌',
  spock: '🖖',
  scotty: '🔧',
  geordi: '👷',
  midas: '✨',
  uhura: '📡',
  book: '📚',
};

const OLLAMA_MODEL_FETCH_TIMEOUT_MS = 750;
const CHAT_MODELS_CACHE_TTL_MS = 60_000;
const AGENT_REPLY_TIMEOUT_MS = 60_000;
const HERMES_REPLY_AGENT_IDS = new Set(['book', 'hermes']);
const OPENCLAW_REPLY_AGENT_IDS = new Set(['ada', 'main', 'zora', 'spock', 'scotty', 'geordi', 'midas', 'uhura']);
let cachedLocalModels: { models: ChatModelOption[]; checkedAt: number } | null = null;
let localModelsRefresh: Promise<ChatModelOption[]> | null = null;

function toChannel(channel: ChatChannelRecord) {
  return {
    id: channel.id,
    name: channel.name,
    description: channel.description ?? undefined,
    categoryId: channel.category_id,
    order: channel.order,
    agents: channel.agents,
    unreadCount: channel.unread_count,
    lastMessageAt: channel.last_message_at ?? undefined,
    createdAt: channel.created_at,
  };
}

function toCategory(category: ChatCategoryRecord) {
  return {
    id: category.id,
    name: category.name,
    emoji: category.emoji ?? undefined,
    order: category.order,
    createdAt: category.created_at,
  };
}

function toMessage(message: ChatMessageRecord) {
  return {
    id: message.id,
    channelId: message.channel_id,
    threadId: message.thread_id ?? undefined,
    sender: message.sender,
    senderEmoji: message.sender_emoji ?? undefined,
    content: message.content,
    model: message.model ?? undefined,
    isLocal: message.is_local,
    status: message.status,
    timestamp: message.timestamp,
    createdAt: message.created_at,
    updatedAt: message.updated_at,
    replyTo: message.reply_to ?? undefined,
  };
}

function toThread(thread: ChatThreadRecord) {
  return {
    id: thread.id,
    channelId: thread.channel_id,
    parentMessageId: thread.parent_message_id,
    title: thread.title,
    messageCount: thread.message_count,
    lastMessageAt: thread.last_message_at,
    createdAt: thread.created_at,
    messages: [],
  };
}

function normalizeAgents(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
    .filter(Boolean);
}

function parseObjectRefBody(body: unknown): ObjectRef {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const rawRef = record.object_ref && typeof record.object_ref === 'object' && !Array.isArray(record.object_ref)
    ? record.object_ref as Record<string, unknown>
    : record;
  const objectType = String(rawRef.object_type ?? '').trim();
  const objectId = String(rawRef.object_id ?? '').trim();
  const linkRole = String(rawRef.link_role ?? '').trim();
  if (!objectType || !objectId || !linkRole) {
    throw new Error('ObjectRef requires object_type, object_id, and link_role');
  }
  return { object_type: objectType, object_id: objectId, link_role: linkRole };
}

function allowChatObjectRef(): ChatObjectRefAccessDecision {
  return { allowed: true };
}

function visibleObjectRefs(
  binding: RequestOrgBinding,
  objectRefs: ObjectRef[],
  access: ChatObjectRefAccess,
): { object_refs: ObjectRef[]; restricted_count: number } {
  const visible: ObjectRef[] = [];
  let restrictedCount = 0;
  for (const objectRef of objectRefs) {
    const decision = access(binding, objectRef);
    if (decision.allowed) {
      visible.push(objectRef);
    } else {
      restrictedCount += 1;
    }
  }
  return { object_refs: visible, restricted_count: restrictedCount };
}

function compatibilityMessageTimestamp(value: string | undefined): string {
  const fallback = new Date().toISOString();
  if (!value) {
    return fallback;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function withTimeout(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs).unref?.();
  return controller.signal;
}

function extractTextFromUnknown(payload: unknown): string {
  if (typeof payload === 'string') {
    return payload.trim();
  }

  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const row = payload as Record<string, unknown>;

  if (typeof row.text === 'string') return row.text.trim();
  if (typeof row.content === 'string') return row.content.trim();
  if (typeof row.message === 'string') return row.message.trim();

  const choices = row.choices;
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === 'object') {
    const first = choices[0] as Record<string, unknown>;
    const message = first.message;
    if (message && typeof message === 'object' && typeof (message as Record<string, unknown>).content === 'string') {
      return String((message as Record<string, unknown>).content).trim();
    }
  }

  return '';
}

function agentReplyRuntimeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.ENTITY_CHAT_AGENT_RUNTIME;
  if (typeof flag !== 'string') {
    return true;
  }
  return !['0', 'false', 'off', 'no'].includes(flag.trim().toLowerCase());
}

function execFileText(command: string, args: string[], timeoutMs = AGENT_REPLY_TIMEOUT_MS): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 4 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

function providerFromRuntimeModel(modelId?: string): string | undefined {
  const normalized = modelId?.trim();
  if (!normalized || normalized === 'auto') {
    return undefined;
  }
  const provider = normalized.split('/')[0]?.trim();
  return provider || undefined;
}

function cleanRuntimeText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed === 'NO_REPLY' || trimmed === '<final>NO_REPLY</final>') {
    return '';
  }

  return trimmed
    .replace(/^<final>\s*/i, '')
    .replace(/\s*<\/final>$/i, '')
    .trim();
}

export function parseOpenClawAgentOutput(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return '';
  }

  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as {
        payloads?: Array<{ text?: unknown }>;
        meta?: {
          finalAssistantVisibleText?: unknown;
          finalAssistantRawText?: unknown;
        };
      };
      const text = parsed.payloads
        ?.map((payload) => cleanRuntimeText(payload.text))
        .find(Boolean);
      if (text) {
        return text;
      }

      const visibleText = cleanRuntimeText(parsed.meta?.finalAssistantVisibleText);
      if (visibleText) {
        return visibleText;
      }

      const rawText = cleanRuntimeText(parsed.meta?.finalAssistantRawText);
      if (rawText) {
        return rawText;
      }

      return '';
    } catch {
      // Fall back to plain text cleanup below.
    }
  }

  return trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('[plugins]') && !line.startsWith('[message-action-discovery]'))
    .join('\n')
    .trim();
}

function parseRuntimeJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const jsonStart = cleaned.indexOf('{');
  const jsonEnd = cleaned.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    return null;
  }

  try {
    const parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function parseOpenClawAgentReplyMap(stdout: string, agents: string[]): Map<string, string> {
  const text = parseOpenClawAgentOutput(stdout);
  const parsed = parseRuntimeJsonObject(text);
  const replies = new Map<string, string>();
  if (!parsed) {
    return replies;
  }

  for (const agent of agents) {
    const normalizedAgent = agent.trim().toLowerCase();
    const value = parsed[normalizedAgent];
    const content = typeof value === 'string'
      ? cleanRuntimeText(value)
      : value && typeof value === 'object'
        ? cleanRuntimeText((value as Record<string, unknown>).content ?? (value as Record<string, unknown>).text)
        : '';
    if (content) {
      replies.set(normalizedAgent, content);
    }
  }

  return replies;
}

function parseHermesOutput(stdout: string): string {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('session_id:') && !line.startsWith('⚠️'))
    .join('\n')
    .trim();
}

function buildAgentRuntimePrompt(agent: string, content: string): string {
  const emoji = DEFAULT_AGENT_EMOJI[agent] ?? '🤖';
  return [
    `You are ${agent} ${emoji} in Entity Mission Control chat.`,
    'Reply directly to Henry. Be concise, useful, and do not mention transport/runtime details.',
    'Answer only the latest user message below.',
    '',
    content,
  ].join('\n');
}

function runtimeSessionId(agent: string, channelId: string, threadId?: string): string {
  const scope = threadId || channelId || 'channel';
  const normalizedScope = scope.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 72);
  return `entity-chat-${agent}-${normalizedScope}`;
}

function buildOpenClawBatchPrompt(agents: string[], content: string): string {
  const agentList = agents
    .map((agent) => `${agent} ${DEFAULT_AGENT_EMOJI[agent] ?? '🤖'}`)
    .join(', ');
  return [
    'You are Entity Mission Control chat.',
    `Agents: ${agentList}.`,
    'Reply directly to Henry on behalf of the selected agents.',
    'Be concise, useful, and do not mention transport/runtime details.',
    'Answer only the latest user message below.',
    '',
    content,
  ].join('\n');
}

async function requestOpenClawAgentReplyMap(
  agents: string[],
  content: string,
  options: { modelId?: string; channelId: string; threadId?: string }
): Promise<Map<string, OpenClawReply>> {
  const replies = new Map<string, OpenClawReply>();
  if (!agentReplyRuntimeEnabled() || agents.length === 0) {
    return replies;
  }

  const normalizedAgents = agents
    .map((agent) => agent.trim().toLowerCase())
    .filter((agent) => OPENCLAW_REPLY_AGENT_IDS.has(agent));
  if (normalizedAgents.length === 0) {
    return replies;
  }

  const openClawAgent = process.env.ENTITY_OPENCLAW_CHAT_AGENT ?? 'main';
  const modelId = options.modelId;
  const args = [
    'agent',
    '--agent',
    openClawAgent,
    '--message',
    buildOpenClawBatchPrompt(normalizedAgents, content),
    '--session-id',
    runtimeSessionId('openclaw-batch', options.channelId, options.threadId),
    '--json',
    '--local',
  ];
  if (modelId && modelId !== 'auto') {
    args.push('--model', modelId);
  }

  try {
    const { stdout } = await execFileText(process.env.ENTITY_OPENCLAW_COMMAND ?? 'openclaw', args);
    const sharedReply = cleanRuntimeText(parseOpenClawAgentOutput(stdout));
    if (!sharedReply) {
      return replies;
    }
    for (const agent of normalizedAgents) {
      replies.set(agent, {
        sender: agent,
        senderEmoji: DEFAULT_AGENT_EMOJI[agent] ?? '🤖',
        content: sharedReply,
        model: modelId,
        isLocal: false,
      });
    }
  } catch {
    return replies;
  }

  return replies;
}

async function requestRuntimeAgentReply(
  agent: string,
  content: string,
  options: { modelId?: string; channelId: string; threadId?: string }
): Promise<OpenClawReply | null> {
  if (!agentReplyRuntimeEnabled()) {
    return null;
  }

  const normalizedAgent = agent.trim().toLowerCase();
  const prompt = buildAgentRuntimePrompt(normalizedAgent, content);
  const modelId = options.modelId;

  if (HERMES_REPLY_AGENT_IDS.has(normalizedAgent)) {
    const provider = providerFromRuntimeModel(modelId) ?? 'auto';
    const args = ['chat', '-q', prompt, '-Q', '--ignore-rules', '--source', 'entity-chat'];
    if (modelId && modelId !== 'auto') {
      args.push('--provider', provider, '-m', modelId);
    }

    try {
      const { stdout } = await execFileText(process.env.ENTITY_HERMES_COMMAND ?? 'hermes', args);
      const text = parseHermesOutput(stdout);
      if (!text) {
        return null;
      }
      return {
        sender: normalizedAgent,
        senderEmoji: DEFAULT_AGENT_EMOJI[normalizedAgent] ?? '🤖',
        content: text,
        model: modelId,
        isLocal: false,
      };
    } catch {
      return null;
    }
  }

  if (OPENCLAW_REPLY_AGENT_IDS.has(normalizedAgent)) {
    const openClawAgent = process.env.ENTITY_OPENCLAW_CHAT_AGENT ?? 'main';
    const args = [
      'agent',
      '--agent',
      openClawAgent,
      '--message',
      prompt,
      '--session-id',
      runtimeSessionId(normalizedAgent, options.channelId, options.threadId),
      '--json',
      '--local',
    ];
    if (modelId && modelId !== 'auto') {
      args.push('--model', modelId);
    }

    try {
      const { stdout } = await execFileText(process.env.ENTITY_OPENCLAW_COMMAND ?? 'openclaw', args);
      const text = parseOpenClawAgentOutput(stdout);
      if (!text) {
        return null;
      }
      return {
        sender: normalizedAgent,
        senderEmoji: DEFAULT_AGENT_EMOJI[normalizedAgent] ?? '🤖',
        content: text,
        model: modelId,
        isLocal: false,
      };
    } catch {
      return null;
    }
  }

  return null;
}

interface LlmProvider {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  isAnthropic?: boolean;
}

function resolveLlmProvider(modelId?: string): LlmProvider | null {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const zaiKey = process.env.ZAI_API_KEY;

  // Parse provider/model format
  const normalized = (modelId ?? '').trim();
  if (normalized.startsWith('anthropic/') || normalized.startsWith('claude')) {
    if (!anthropicKey) return null;
    const model = normalized.replace('anthropic/', '');
    return { name: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: anthropicKey, model, isAnthropic: true };
  }
  if (normalized.startsWith('openai-codex/') || normalized.startsWith('gpt')) {
    if (!openaiKey) return null;
    const model = normalized.replace('openai-codex/', '');
    return { name: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: openaiKey, model };
  }
  if (normalized.startsWith('zai/') || normalized.startsWith('glm')) {
    if (!zaiKey) return null;
    const model = normalized.replace('zai/', '');
    return { name: 'zai', baseUrl: 'https://api.z.ai/api/coding/paas/v4', apiKey: zaiKey, model };
  }
  if (normalized.startsWith('google/') || normalized.startsWith('gemini')) {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) return null;
    const model = normalized.replace('google/', '');
    return { name: 'google', baseUrl: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, apiKey: geminiKey, model };
  }

  // Default: try anthropic first, then openai
  if (anthropicKey) {
    return { name: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: anthropicKey, model: 'claude-sonnet-4-6', isAnthropic: true };
  }
  if (openaiKey) {
    return { name: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: openaiKey, model: 'gpt-4o' };
  }
  return null;
}

async function requestLlmResponse(agent: string, content: string, modelId?: string): Promise<OpenClawReply | null> {
  if (!agentReplyRuntimeEnabled()) {
    return null;
  }

  const provider = resolveLlmProvider(modelId);
  if (!provider) return null;

  const agentInfo = DEFAULT_AGENT_EMOJI[agent] ? `You are ${agent} (${DEFAULT_AGENT_EMOJI[agent]})` : `You are ${agent}`;
  const systemPrompt = `${agentInfo} in Entity Mission Control chat. Reply concisely and helpfully.`;

  try {
    if (provider.isAnthropic) {
      const response = await fetch(`${provider.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': provider.apiKey,
          'anthropic-version': '2023-06-01',
        },
        signal: withTimeout(30_000),
        body: JSON.stringify({
          model: provider.model,
          max_tokens: 2048,
          system: systemPrompt,
          messages: [{ role: 'user', content }],
        }),
      });

      if (!response.ok) return null;
      const payload = await response.json() as { content?: Array<{ text?: string }> };
      const text = payload.content?.[0]?.text?.trim();
      if (!text) return null;

      return {
        sender: agent,
        senderEmoji: DEFAULT_AGENT_EMOJI[agent] ?? '🤖',
        content: text,
        model: `anthropic/${provider.model}`,
        isLocal: false,
      };
    }

    if (provider.name === 'google') {
      const response = await fetch(provider.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: withTimeout(30_000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemPrompt}\n\nUser: ${content}` }] }],
        }),
      });

      if (!response.ok) return null;
      const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!text) return null;

      return {
        sender: agent,
        senderEmoji: DEFAULT_AGENT_EMOJI[agent] ?? '🤖',
        content: text,
        model: `google/${provider.model}`,
        isLocal: false,
      };
    }

    // OpenAI-compatible (openai, zai)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
    };
    if (provider.name === 'zai') {
      headers['Accept-Language'] = 'en-US,en';
    }

    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      signal: withTimeout(30_000),
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content },
        ],
        max_tokens: 2048,
      }),
    });

    if (!response.ok) return null;
    const payload = await response.json() as unknown;
    const text = extractTextFromUnknown(payload);
    if (!text) return null;

    return {
      sender: agent,
      senderEmoji: DEFAULT_AGENT_EMOJI[agent] ?? '🤖',
      content: text,
      model: `${provider.name}/${provider.model}`,
      isLocal: false,
    };
  } catch {
    return null;
  }
}

/**
 * R4: provision default chat categories/channels. When `orgId` is supplied
 * (a resolved CUSTOMER scope) the defaults are stamped with that org and use
 * org-prefixed ids so they never collide with the workspace-global ids seeded
 * by the trusted/admin bootstrap; the returned snapshot is the caller's own-org
 * view only. When `orgId` is undefined (trusted service/admin path) the
 * pre-R4 workspace-global seeding is preserved verbatim.
 */
async function ensureDefaults(orgId?: string) {
  const repo = createChatRepository();
  const scoped = typeof orgId === 'string' && orgId.trim() ? orgId.trim() : undefined;
  const prefix = scoped ? `${scoped}::` : '';
  const categoryOrgId = scoped ?? null;

  const generalId = `${prefix}general`;
  const agentsId = `${prefix}agents`;
  const general = repo.getCategoryByName('General', scoped)
    ?? repo.createCategory({ id: generalId, name: 'General', emoji: '💬', order: 0, org_id: categoryOrgId });
  const agents = repo.getCategoryByName('Agents', scoped)
    ?? repo.createCategory({ id: agentsId, name: 'Agents', emoji: '🤖', order: 1, org_id: categoryOrgId });

  const defaultChannels: Array<{ name: string; categoryId: string; order: number; agents: string[] }> = [
    { name: 'command-deck', categoryId: general.id, order: 0, agents: [] },
    { name: 'ada', categoryId: agents.id, order: 0, agents: ['ada'] },
    { name: 'spock', categoryId: agents.id, order: 1, agents: ['spock'] },
    { name: 'scotty', categoryId: agents.id, order: 2, agents: ['scotty'] },
    { name: 'geordi', categoryId: agents.id, order: 3, agents: ['geordi'] },
    { name: 'zora', categoryId: agents.id, order: 4, agents: ['zora'] },
    { name: 'midas', categoryId: agents.id, order: 5, agents: ['midas'] },
    { name: 'random', categoryId: general.id, order: 1, agents: [] },
  ];

  for (const def of defaultChannels) {
    if (!repo.getChannelByName(def.name, scoped)) {
      repo.createChannel({ id: `${prefix}${def.name}`, name: def.name, category_id: def.categoryId, order: def.order, agents: def.agents, org_id: categoryOrgId });
    }
  }

  return {
    categories: repo.listCategories(scoped).map(toCategory),
    channels: repo.listChannels(scoped).map(toChannel),
  };
}

function prettifyOllamaName(name: string): string {
  return name
    .replace(/:latest$/, '')
    .split(/[-_:.]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

async function fetchOllamaModels(): Promise<ChatModelOption[]> {
  try {
    const ollamaBaseUrl = (process.env.ENTITY_OLLAMA_BASE_URL ?? process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434').replace(/\/+$/, '');
    const response = await fetch(`${ollamaBaseUrl}/api/tags`, { signal: withTimeout(OLLAMA_MODEL_FETCH_TIMEOUT_MS) });
    if (!response.ok) return [];
    const data = await response.json() as { models?: Array<{ name: string; model: string; size: number }> };
    if (!Array.isArray(data.models)) return [];
    return data.models.map((m) => ({
      id: `ollama/${m.name}`,
      name: prettifyOllamaName(m.name),
      provider: 'ollama',
      isLocal: true,
      local: true,
      available: true,
      source: 'ollama',
    }));
  } catch {
    return [];
  }
}

async function getCachedOllamaModels(): Promise<ChatModelOption[]> {
  const now = Date.now();
  if (cachedLocalModels && now - cachedLocalModels.checkedAt < CHAT_MODELS_CACHE_TTL_MS) {
    return cachedLocalModels.models;
  }

  if (!localModelsRefresh) {
    localModelsRefresh = fetchOllamaModels()
      .then((models) => {
        cachedLocalModels = { models, checkedAt: Date.now() };
        return models;
      })
      .finally(() => {
        localModelsRefresh = null;
      });
  }

  if (cachedLocalModels) {
    return cachedLocalModels.models;
  }

  return localModelsRefresh;
}

export function registerChatRoutes({
  app,
  openClawBaseUrl,
  clickClackBridge,
  clickClackReadiness,
  chatObjectRefAccess = allowChatObjectRef,
  getTaskOrg,
}: ChatRouteDependencies): void {
  const repo = createChatRepository();
  const modelRegistry = new ChatModelRegistry({
    openClawBaseUrl,
    localInventory: getCachedOllamaModels,
    env: process.env,
  });
  const sidecarBridge = clickClackBridge
    ?? (process.env.ENTITY_CHAT_CLICKCLACK_BRIDGE === '1' ? createClickClackBridge() : undefined);
  const readinessProbe = clickClackReadiness
    ?? createEnvClickClackReadinessProbe({ bridgeEnabled: Boolean(sidecarBridge) });

  /**
   * R4: resolve the durable tenant scope for a chat request.
   *
   * Customer principals bind to a membership-derived org via the shared
   * requireRequestOrg resolver (caller-selected orgs only narrow within grants;
   * spoofed orgs are 403 and an ambiguous/omitted scope fails closed 400). The
   * returned `orgId` is then applied to EVERY chat list/read/mutation so foreign
   * and legacy-unowned rows (org_id IS NULL) are never disclosed or mutated.
   *
   * The trusted service/admin path resolves a binding too (so principal/object
   * checks keep working) but passes `orgId = undefined` so chat remains the
   * workspace-global surface it always was (PR #71/#72 preserved).
   *
   * Returns `{ binding, orgId }`, or `null` after a 400/403 has been written.
   */
  function resolveChatScope(req: express.Request, res: express.Response): { binding: RequestOrgBinding; orgId: string | undefined } | null {
    const binding = requireRequestOrg(req, res);
    if (!binding) return null;
    const orgId = isTrustedServiceContext(req) ? undefined : binding.orgId;
    return { binding, orgId };
  }

  /** R4: 404 helper that never discloses whether a foreign id exists. */
  function notFound(res: express.Response, what: string) {
    return res.status(404).json({ error: `${what} not found` });
  }

  type ChatScope = { binding: RequestOrgBinding; orgId: string | undefined };

  /**
   * D-R4-OBJECTREF-ASYNC: object-ref authorization for a resolved chat scope.
   * Defers to chatObjectRefAccess first; for task refs under a customer scope it
   * additionally verifies the task's org matches the request org via getTaskOrg.
   */
  async function authorize(scope: ChatScope, ref: ObjectRef): Promise<ChatObjectRefAccessDecision> {
    const decision = chatObjectRefAccess(scope.binding, ref);
    if (!decision.allowed) return decision;
    if (scope.orgId === undefined || ref.object_type !== 'task') return decision;
    if (!getTaskOrg) return { allowed: false, reason: 'task authorization unavailable' };
    const org = await getTaskOrg(ref.object_id);
    return org === scope.orgId ? decision : { allowed: false, reason: 'task outside request org' };
  }

  /** D-R4-OBJECTREF-ASYNC: async-visible object refs via authorize. */
  async function visible(scope: ChatScope, refs: ObjectRef[]): Promise<{ object_refs: ObjectRef[]; restricted_count: number }> {
    const visibleRefs: ObjectRef[] = [];
    let restrictedCount = 0;
    for (const ref of refs) {
      const decision = await authorize(scope, ref);
      if (decision.allowed) {
        visibleRefs.push(ref);
      } else {
        restrictedCount += 1;
      }
    }
    return { object_refs: visibleRefs, restricted_count: restrictedCount };
  }

  /**
   * D-R6-MUTATION-GATES: chat-wide mutation gate. Every non-GET/HEAD/OPTIONS
   * request to /api/chat must be backed by a persisted CONTRIBUTOR grant for
   * the resolved request org. Reads keep their existing per-route read checks
   * (exempt here). The trusted service/admin path is preserved —
   * requireOrgAuthority returns true for it. Scope resolution failure already
   * writes a 400/403 via requireRequestOrg; the gate returns without calling
   * next() so no duplicate response is ever emitted. Per-route scope checks
   * (resolveChatScope) remain in place and are unaffected.
   */
  app.use('/api/chat', (req, res, next) => {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next();
    }
    const binding = requireRequestOrg(req, res);
    if (!binding) return; // scope resolution already wrote 400/403; do not double-respond
    if (!requireOrgAuthority(req, res, binding.orgId, 'contributor')) return;
    next();
  });

  app.get('/api/chat/me', (_req, res) => {
    res.json({
      member: {
        id: 'mem_human_user',
        kind: 'human',
        displayName: 'Entity Human',
      },
    });
  });

  app.get('/api/chat/clickclack/readiness', async (_req, res) => {
    try {
      return res.json({ readiness: await readinessProbe() });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'ClickClack readiness unavailable';
      return res.status(503).json({
        readiness: {
          state: 'unavailable',
          configured: true,
          bridgeEnabled: Boolean(sidecarBridge),
          baseUrl: process.env.ENTITY_CLICKCLACK_BASE_URL ?? null,
          reason: message,
          checkedAt: new Date().toISOString(),
        },
      });
    }
  });

  app.get('/api/chat/task/:taskId', async (req, res) => {
    try {
      const taskId = String(req.params.taskId ?? '').trim();
      if (!taskId) {
        return res.status(400).json({ error: 'taskId is required' });
      }

      // R4: a task id is an org-scoped object reference. A customer principal
      // may only resolve chat for a task within its principal-derived scope.
      // An UNKNOWN task id (getTaskOrg resolves to null) must NOT fall through to
      // channel disclosure/creation; it fails closed 404, as does a foreign task.
      // The trusted service/admin path preserves the workspace-global lookup.
      let orgId: string | undefined;
      if (isTrustedServiceContext(req)) {
        orgId = undefined;
      } else {
        const binding = requireRequestOrg(req, res);
        if (!binding) return undefined;
        orgId = binding.orgId;
        if (getTaskOrg) {
          const taskOrg = await getTaskOrg(taskId);
          if (!taskOrg || taskOrg !== binding.orgId) {
            return notFound(res, 'task');
          }
        }
      }

      const candidateIds = [`task-${taskId}`, taskId];
      const channel = candidateIds
        .map((id) => repo.getChannel(id, orgId) ?? repo.getChannelByName(id, orgId))
        .find(Boolean);

      if (!channel) {
        return res.json({ taskId, channel: null, messages: [], threads: [] });
      }

      const messages = repo.listMessagesByChannel(channel.id, orgId).map(toMessage);
      const threads = repo.listThreadsByChannel(channel.id, orgId).map(toThread);
      return res.json({ taskId, channel: toChannel(channel), messages, threads });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/chat/models', async (req, res) => {
    try {
      const agentParam = typeof req.query.agent === 'string' ? req.query.agent : '';
      const agentsParam = typeof req.query.agents === 'string' ? req.query.agents : '';
      const agents = agentsParam
        ? agentsParam.split(',').map((agent) => agent.trim()).filter(Boolean)
        : agentParam
          ? [agentParam]
          : ['ada'];
      return res.json(await modelRegistry.buildResponse(agents));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load chat models';
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/chat/channels', (req, res) => {
    const scope = resolveChatScope(req, res);
    if (!scope) return undefined;
    try {
      return res.json({
        categories: repo.listCategories(scope.orgId).map(toCategory),
        channels: repo.listChannels(scope.orgId).map(toChannel),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/chat/channels/:channelId/messages', (req, res) => {
    const scope = resolveChatScope(req, res);
    if (!scope) return undefined;
    try {
      // R4: a foreign/unknown channel id discloses nothing (404) before listing.
      const channel = repo.getChannel(req.params.channelId, scope.orgId);
      if (!channel) return notFound(res, 'channel');
      const messages = repo.listMessagesByChannel(channel.id, scope.orgId).map(toMessage);
      return res.json({ messages });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/chat/channels/:channelId/threads', (req, res) => {
    const scope = resolveChatScope(req, res);
    if (!scope) return undefined;
    try {
      const channel = repo.getChannel(req.params.channelId, scope.orgId);
      if (!channel) return notFound(res, 'channel');
      const threads = repo.listThreadsByChannel(channel.id, scope.orgId).map(toThread);
      return res.json({ threads });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/chat/channels/:channelId/object-refs', async (req, res) => {
    const scope = resolveChatScope(req, res);
    if (!scope) return undefined;
    const channel = repo.getChannel(req.params.channelId, scope.orgId);
    if (!channel) {
      return notFound(res, 'channel');
    }
    return res.json({
      target: { type: 'channel', id: channel.id },
      ...await visible(scope, channel.linked_object_refs),
    });
  });

  app.post('/api/chat/channels/:channelId/object-refs', async (req, res) => {
    const scope = resolveChatScope(req, res);
    if (!scope) return undefined;
    try {
      const objectRef = parseObjectRefBody(req.body);
      const decision = await authorize(scope, objectRef);
      if (!decision.allowed) {
        return sendPermissionDenied(res, decision.reason ?? 'access denied by object policy');
      }
      // R4: link only against an own-org channel; a foreign id 404s and never mutates.
      const channel = repo.linkChannelObject(req.params.channelId, objectRef, scope.orgId);
      if (!channel) {
        return notFound(res, 'channel');
      }
      return res.status(201).json({
        target: { type: 'channel', id: channel.id },
        ...await visible(scope, channel.linked_object_refs),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(400).json({ error: message });
    }
  });

  app.get('/api/chat/threads/:threadId/messages', (req, res) => {
    const scope = resolveChatScope(req, res);
    if (!scope) return undefined;
    try {
      const thread = repo.getThread(req.params.threadId, scope.orgId);
      if (!thread) return notFound(res, 'thread');
      const messages = repo.listMessagesByThread(thread.id, scope.orgId).map(toMessage);
      return res.json({ messages });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/chat/messages/:messageId', (req, res) => {
    const scope = resolveChatScope(req, res);
    if (!scope) return undefined;
    const message = repo.getMessage(req.params.messageId, scope.orgId);
    if (!message) {
      return notFound(res, 'message');
    }

    return res.json({ message: toMessage(message) });
  });

  app.get('/api/chat/threads/:threadId/object-refs', async (req, res) => {
    const scope = resolveChatScope(req, res);
    if (!scope) return undefined;
    const thread = repo.getThread(req.params.threadId, scope.orgId);
    if (!thread) {
      return notFound(res, 'thread');
    }
    return res.json({
      target: { type: 'thread', id: thread.id },
      ...await visible(scope, thread.linked_object_refs),
    });
  });

  app.post('/api/chat/threads/:threadId/object-refs', async (req, res) => {
    const scope = resolveChatScope(req, res);
    if (!scope) return undefined;
    try {
      const objectRef = parseObjectRefBody(req.body);
      const decision = await authorize(scope, objectRef);
      if (!decision.allowed) {
        return sendPermissionDenied(res, decision.reason ?? 'access denied by object policy');
      }
      const thread = repo.linkThreadObject(req.params.threadId, objectRef, scope.orgId);
      if (!thread) {
        return notFound(res, 'thread');
      }
      return res.status(201).json({
        target: { type: 'thread', id: thread.id },
        ...await visible(scope, thread.linked_object_refs),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(400).json({ error: message });
    }
  });

  app.get('/api/chat/threads/by-parent/:parentMessageId', (req, res) => {
    const scope = resolveChatScope(req, res);
    if (!scope) return undefined;
    const thread = repo.getThreadByParentMessage(req.params.parentMessageId, scope.orgId);
    if (!thread) {
      return notFound(res, 'thread');
    }

    return res.json({ thread: toThread(thread) });
  });

  app.post('/api/chat/categories', (req, res) => {
    const scope = resolveChatScope(req, res);
    if (!scope) return undefined;
    try {
      // R4: ownership is principal-derived; caller body org_id is ignored.
      const category = repo.createCategory({
        id: typeof req.body?.id === 'string' ? req.body.id : undefined,
        name: String(req.body?.name ?? '').trim(),
        emoji: typeof req.body?.emoji === 'string' ? req.body.emoji : undefined,
        order: Number.isFinite(Number(req.body?.order)) ? Number(req.body.order) : undefined,
        org_id: scope.orgId ?? null,
      });
      return res.status(201).json({ category: toCategory(category) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(400).json({ error: message });
    }
  });

  app.post('/api/chat/channels', (req, res) => {
    const scope = resolveChatScope(req, res);
    if (!scope) return undefined;
    try {
      const categoryId = String(req.body?.categoryId ?? req.body?.category_id ?? '').trim();
      if (!categoryId) {
        return res.status(400).json({ error: 'categoryId is required' });
      }

      // R4: a channel INHERITS its parent category's org ownership. A foreign or
      // legacy-unowned category cannot host a caller's channel (404); the new
      // channel is stamped with the resolved principal-derived org, never a
      // caller-supplied body value.
      const category = repo.getCategory(categoryId, scope.orgId);
      if (!category) {
        return notFound(res, 'category');
      }
      const inheritedOrg = scope.orgId ?? category.org_id ?? null;

      const channel = repo.createChannel({
        id: typeof req.body?.id === 'string' ? req.body.id : undefined,
        name: String(req.body?.name ?? '').trim(),
        description: typeof req.body?.description === 'string' ? req.body.description : undefined,
        category_id: categoryId,
        order: Number.isFinite(Number(req.body?.order)) ? Number(req.body.order) : undefined,
        agents: normalizeAgents(req.body?.agents),
        org_id: inheritedOrg,
      });

      return res.status(201).json({ channel: toChannel(channel) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(400).json({ error: message });
    }
  });

  app.patch('/api/chat/channels/:channelId', (req, res) => {
    const scope = resolveChatScope(req, res);
    if (!scope) return undefined;
    try {
      const rawCategoryId = req.body?.categoryId ?? req.body?.category_id;
      let categoryId: string | undefined;
      if (typeof rawCategoryId === 'string') {
        categoryId = rawCategoryId.trim();
        if (!categoryId || !repo.getCategory(categoryId, scope.orgId)) {
          return notFound(res, 'category');
        }
      }

      const channel = repo.updateChannel(req.params.channelId, {
        name: typeof req.body?.name === 'string' ? req.body.name : undefined,
        description: typeof req.body?.description === 'string' ? req.body.description : undefined,
        category_id: categoryId,
        order: Number.isFinite(Number(req.body?.order)) ? Number(req.body.order) : undefined,
        agents: Array.isArray(req.body?.agents) ? normalizeAgents(req.body.agents) : undefined,
      }, scope.orgId);

      if (!channel) {
        return notFound(res, 'channel');
      }

      return res.json({ channel: toChannel(channel) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(400).json({ error: message });
    }
  });

  app.delete('/api/chat/channels/:channelId', (req, res) => {
    const scope = resolveChatScope(req, res);
    if (!scope) return undefined;
    const deleted = repo.deleteChannel(req.params.channelId, scope.orgId);
    if (!deleted) {
      return notFound(res, 'channel');
    }

    return res.json({ success: true });
  });

  app.post('/api/chat/channels/:channelId/read', (req, res) => {
    const scope = resolveChatScope(req, res);
    if (!scope) return undefined;
    // R4: only acknowledge a channel the caller owns; foreign id is a silent 404
    // so cross-org existence is not leaked.
    const channel = repo.getChannel(req.params.channelId, scope.orgId);
    if (!channel) return notFound(res, 'channel');
    repo.markChannelRead(channel.id, scope.orgId);
    return res.json({ success: true });
  });

  app.post('/api/chat/threads', (req, res) => {
    const scope = resolveChatScope(req, res);
    if (!scope) return undefined;
    try {
      const channelId = String(req.body?.channelId ?? '').trim();
      const parentMessageId = String(req.body?.parentMessageId ?? '').trim();
      const title = String(req.body?.title ?? 'Thread').trim() || 'Thread';
      if (!channelId || !parentMessageId) {
        return res.status(400).json({ error: 'channelId and parentMessageId are required' });
      }

      // R4: a thread INHERITS its parent channel's org. A foreign/unknown
      // channel id 404s before any thread is created.
      const channel = repo.getChannel(channelId, scope.orgId);
      if (!channel) {
        return notFound(res, 'channel');
      }

      // D-R4-PARENT-CHANNEL: the parent message must exist in the caller's org
      // and belong to the same channel before a thread is resolved/created from it.
      const parent = repo.getMessage(parentMessageId, scope.orgId);
      if (!parent || parent.channel_id !== channel.id) {
        return notFound(res, 'message');
      }

      const existing = repo.getThreadByParentMessage(parentMessageId, scope.orgId);
      if (existing) {
        return res.json({ thread: toThread(existing) });
      }

      const thread = repo.createThread({
        id: typeof req.body?.id === 'string' ? req.body.id : undefined,
        channel_id: channelId,
        parent_message_id: parentMessageId,
        title,
        org_id: scope.orgId ?? channel.org_id ?? null,
      });

      return res.status(201).json({ thread: toThread(thread) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(400).json({ error: message });
    }
  });

  app.post('/api/chat/setup', async (req, res) => {
    const scope = resolveChatScope(req, res);
    if (!scope) return undefined;
    try {
      const snapshot = await ensureDefaults(scope.orgId);
      return res.json(snapshot);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/chat/send', async (req, res) => {
    const scope = resolveChatScope(req, res);
    if (!scope) return undefined;
    try {
      const channelId = String(req.body?.channelId ?? '').trim();
      const content = String(req.body?.content ?? '').trim();
      if (!channelId || !content) {
        return res.status(400).json({ error: 'channelId and content are required' });
      }

      // R4: resolve the channel under the caller's org BEFORE any durable write.
      // A foreign or unknown channel id 404s and is never mutated. A thread, when
      // supplied, must likewise belong to the caller's org. Messages INHERIT the
      // channel's org ownership; caller-supplied body org/ownership is ignored.
      const channel = repo.getChannel(channelId, scope.orgId);
      if (!channel) {
        return notFound(res, 'channel');
      }
      const messageOrgId = scope.orgId ?? channel.org_id ?? null;

      // D-R4-PARENT-CHANNEL: validate the requested thread and optional parent
      // message against the resolved channel BEFORE any write, then reuse these
      // validated ids for every message create below (never re-read body values).
      const requestedThreadId = typeof req.body?.threadId === 'string' ? req.body.threadId.trim() : '';
      let threadId: string | undefined;
      if (requestedThreadId) {
        const thread = repo.getThread(requestedThreadId, scope.orgId);
        if (!thread || thread.channel_id !== channel.id) {
          return notFound(res, 'thread');
        }
        threadId = thread.id;
      }

      let parentMessageId: string | undefined;
      const requestedParentMessageId = typeof req.body?.parentMessageId === 'string' ? req.body.parentMessageId.trim() : '';
      if (requestedParentMessageId) {
        const parent = repo.getMessage(requestedParentMessageId, scope.orgId);
        if (!parent || parent.channel_id !== channel.id) {
          return notFound(res, 'message');
        }
        parentMessageId = parent.id;
      }

      const agents = normalizeAgents(req.body?.agents);
      const targetAgent = typeof req.body?.targetAgent === 'string' ? req.body.targetAgent.trim().toLowerCase() : '';
      const targets = targetAgent && targetAgent !== 'all'
        ? [targetAgent]
        : agents.length > 0
          ? agents
          : ['ada'];

      const modelId = typeof req.body?.model === 'string' ? req.body.model.trim() : undefined;
      const modelByAgent = new Map<string, { modelId?: string; isLocal: boolean }>();
      for (const agent of targets) {
        const resolved = await modelRegistry.resolveModelForAgent(agent, modelId);
        if (resolved.ok === false) {
          return res.status(400).json({ error: resolved.message, agent, model: modelId });
        }
        modelByAgent.set(agent, { modelId: resolved.modelId, isLocal: resolved.isLocal });
      }

      if (sidecarBridge) {
        const timestamp = typeof req.body?.timestamp === 'string' ? req.body.timestamp : new Date().toISOString();
        const userMessage = repo.createMessage({
          id: typeof req.body?.messageId === 'string' ? req.body.messageId : undefined,
          channel_id: channelId,
          thread_id: threadId,
          sender: typeof req.body?.sender === 'string' ? req.body.sender : 'user',
          sender_emoji: typeof req.body?.senderEmoji === 'string' ? req.body.senderEmoji : '🧑',
          content,
          model: modelId && modelId !== 'auto' ? modelId : undefined,
          is_local: Boolean(req.body?.isLocal),
          status: 'sent',
          timestamp,
          reply_to: parentMessageId,
          org_id: messageOrgId,
        });

        if (threadId) {
          repo.incrementThreadCount(threadId, userMessage.timestamp);
        }

        let result;
        try {
          result = await sidecarBridge.sendCompatibilityMessage({
            channelId,
            content,
            targets,
            messageId: userMessage.id,
            threadId,
            // Entity message ids are local; keep ClickClack sidecar sends channel-scoped until we persist an id map.
            parentMessageId: undefined,
            modelByAgent,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'ClickClack delivery failed';
          return res.status(202).json({
            degraded: true,
            error: message,
            message: toMessage(userMessage),
            messages: [],
            clickclack: {
              mode: 'dev-sidecar',
              baseUrl: process.env.ENTITY_CLICKCLACK_BASE_URL ?? 'http://127.0.0.1:3091',
              error: message,
            },
          });
        }

        const storedReplies = result.messages.map((message) => {
          const stored = repo.createMessage({
            id: message.id,
            channel_id: channelId,
            thread_id: threadId,
            sender: message.sender,
            sender_emoji: DEFAULT_AGENT_EMOJI[message.sender] ?? '🤖',
            content: message.content,
            model: message.model,
            is_local: Boolean(message.isLocal),
            status: 'sent',
            timestamp: compatibilityMessageTimestamp(message.createdAt),
            reply_to: parentMessageId,
            org_id: messageOrgId,
          });

          if (threadId) {
            repo.incrementThreadCount(threadId, stored.timestamp);
          }

          return toMessage(stored);
        });

        return res.status(201).json({
          ...result,
          message: toMessage(userMessage),
          messages: storedReplies,
        });
      }

      const timestamp = typeof req.body?.timestamp === 'string' ? req.body.timestamp : new Date().toISOString();

      const sender = typeof req.body?.sender === 'string' ? req.body.sender : 'user';
      const senderEmoji = typeof req.body?.senderEmoji === 'string' ? req.body.senderEmoji : '🧑';

      const userMessage = repo.createMessage({
        id: typeof req.body?.messageId === 'string' ? req.body.messageId : undefined,
        channel_id: channelId,
        thread_id: threadId,
        sender,
        sender_emoji: senderEmoji,
        content,
        model: modelId && modelId !== 'auto' ? modelId : undefined,
        is_local: Boolean(req.body?.isLocal),
        status: 'sent',
        timestamp,
        reply_to: parentMessageId,
        org_id: messageOrgId,
      });

      if (threadId) {
        repo.incrementThreadCount(threadId, userMessage.timestamp);
      }

      const openClawTargets = targets.filter((agent) => OPENCLAW_REPLY_AGENT_IDS.has(agent));
      const batchedOpenClawReplies = openClawTargets.length > 1
        ? await requestOpenClawAgentReplyMap(openClawTargets, content, {
          modelId: modelId && modelId !== 'auto' ? modelByAgent.get(openClawTargets[0])?.modelId : undefined,
          channelId,
          threadId,
        })
        : new Map<string, OpenClawReply>();

      const replyPayloads = await Promise.all(targets.map(async (agent) => {
        const resolved = modelByAgent.get(agent);
        const runtimeModelId = modelId && modelId !== 'auto' ? resolved?.modelId : undefined;
        const remote = batchedOpenClawReplies.get(agent)
          ?? (openClawTargets.length > 1 && OPENCLAW_REPLY_AGENT_IDS.has(agent)
            ? null
            : await requestRuntimeAgentReply(agent, content, {
              modelId: runtimeModelId,
              channelId,
              threadId,
            }))
          ?? await requestLlmResponse(agent, content, resolved?.modelId);
        const reply = remote ?? {
          sender: agent,
          senderEmoji: DEFAULT_AGENT_EMOJI[agent] ?? '🤖',
          content: `(${agent}) Received. OpenClaw reply unavailable right now.`,
          model: resolved?.modelId ?? 'fallback',
          isLocal: Boolean(resolved?.isLocal),
        };
        return { reply, parentMessageId, threadId };
      }));

      const replies: ReturnType<typeof toMessage>[] = [];
      for (const { reply } of replyPayloads) {
        const stored = repo.createMessage({
          id: randomUUID(),
          channel_id: channelId,
          thread_id: threadId,
          sender: reply.sender,
          sender_emoji: reply.senderEmoji,
          content: reply.content,
          model: reply.model,
          is_local: Boolean(reply.isLocal),
          status: 'sent',
          timestamp: new Date().toISOString(),
          reply_to: parentMessageId,
          org_id: messageOrgId,
        });

        if (threadId) {
          repo.incrementThreadCount(threadId, stored.timestamp);
        }

        replies.push(toMessage(stored));
      }

      return res.status(201).json({
        message: toMessage(userMessage),
        messages: replies,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: message });
    }
  });
}
