import { execFile } from 'child_process';
import type express from 'express';
import { createClickClackBridge, type ClickClackChatBridge } from '../clickclack/bridge';
import { createEnvClickClackReadinessProbe, type ClickClackReadinessProbe } from '../clickclack/readiness';
import {
  createChatRepository,
  createTenantChatRepository,
  type ChatCategoryRecord,
  type ChatChannelRecord,
  type ChatDbScope,
  type ChatMessageRecord,
  type ChatThreadRecord,
} from '../../../db/src/chat';
import {
  type ObjectRef,
} from '../../../db/src';
import { ChatModelRegistry, type ChatModelOption } from './chat-model-registry';
import { requireRequestOrg, sendPermissionDenied, type RequestOrgBinding } from '../request-permissions';
import { type PrincipalGrant } from '../permissions';
import { createAgentNoiseGuard, type AgentNoiseGuard, type NoiseReservation } from './agent-noise-guard';
import { getEntityDatabase } from '../../../db/src/entity-db';
import { ensureAppSettingsTable, getSettingJson, setSettingJson } from '../config/settings-store';
import { getTaskAgentSettings } from '../agent/settings';
import { LOCAL_ADMIN_PRINCIPAL_ID } from '../principals/admin-identity';

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
   * THE-931: gate chat *history* reads (message/channel/thread content) on the
   * org/team-grant ownership model. Defaults to principalCanReadChatHistory.
   */
  chatHistoryAccess?: ChatHistoryAccess;
  /**
   * THE-930: agent noise guard (mute/cooldown/atomic duplicate reservation).
   * Defaults to one built from persisted chat noise settings.
   */
  agentNoiseGuard?: AgentNoiseGuard;
}

interface ChatHistoryDecision {
  allowed: boolean;
  reason?: string;
}

type ChatHistoryAccess = (binding: RequestOrgBinding) => ChatHistoryDecision;

/**
 * THE-931 — coherent org/team-grant ownership model for chat history.
 *
 * A principal may read chat history scoped to an org when they hold at least a
 * viewer-level grant covering that org. In dev mode (no API token) the local
 * admin principal carries a manager grant for the default org, so existing
 * flows stay green. An agent principal with no assignments resolves to role
 * 'none' and is denied.
 */
export function principalCanReadChatHistory(binding: RequestOrgBinding): ChatHistoryDecision {
  const allowed = binding.principal.grants.some((grant) =>
    grant.role !== 'none' && (!grant.org_id || grant.org_id === binding.orgId),
  );
  if (!allowed) return { allowed: false, reason: 'chat history requires an org/team assignment' };
  return { allowed: true };
}

/** Uniform no-leak 404 for chat history resources (unauthorized == missing). */
function denyChatHistory(res: express.Response, missingError: string) {
  return res.status(404).json({ error: missingError });
}

/**
 * THE-931 — authoritative tenant scope for chat resources.
 *
 * Resources are owned by an {orgId, teamId} pair. The scope is resolved from
 * the authenticated principal's binding and the owned parent resource, never
 * from a caller-supplied teamId. Legacy unowned rows (orgId null) are preserved
 * but fail closed for every non-local-admin principal.
 */
export interface ChatTenantScope {
  orgId: string;
  teamId: string | null;
}

/** THE-931 (R2): grants applicable to chat for this binding (non-none, covering the request org). */
function applicableChatGrants(binding: RequestOrgBinding): PrincipalGrant[] {
  return binding.principal.grants.filter((g) =>
    g.role !== 'none' && (!g.org_id || g.org_id === binding.orgId),
  );
}

/**
 * THE-931 (R2): resolve the DB read scope from the authenticated binding/grants.
 * Returns null when the principal has no applicable grant (fail closed). An
 * org-wide grant yields org-wide visibility; team-only grants yield only those
 * teams (never org-wide resources). Legacy unowned rows are visible only to the
 * explicit local-admin compatibility principal.
 */
function resolveChatReadScope(binding: RequestOrgBinding): ChatDbScope | null {
  const grants = applicableChatGrants(binding);
  if (grants.length === 0) return null;
  const isLocalAdmin = binding.principal.principal_id === LOCAL_ADMIN_PRINCIPAL_ID;
  if (grants.some((g) => !g.team_id)) {
    return { orgId: binding.orgId, mode: 'org-wide', teamIds: [], includeLegacy: isLocalAdmin };
  }
  const teamIds = [...new Set(grants.map((g) => g.team_id).filter((t): t is string => Boolean(t)))];
  if (teamIds.length === 0) return null;
  return { orgId: binding.orgId, mode: 'team', teamIds, includeLegacy: isLocalAdmin };
}

export interface ChatCreationScope {
  orgId: string;
  teamId: string | null;
}

/**
 * THE-931 (R2): derive the creation scope from the authenticated binding/grants.
 * Caller-supplied ownership (teamId) is NEVER trusted. An org-wide grant creates
 * org-wide; a single unambiguous team grant creates in that team; zero/revoked /
 * inactive / ambiguous (multiple teams) grants fail closed (null).
 */
export function resolveChatCreationScope(binding: RequestOrgBinding): ChatCreationScope | null {
  const grants = applicableChatGrants(binding);
  if (grants.length === 0) return null;
  if (grants.some((g) => !g.team_id)) return { orgId: binding.orgId, teamId: null };
  const teamIds = [...new Set(grants.map((g) => g.team_id).filter((t): t is string => Boolean(t)))];
  if (teamIds.length === 1) return { orgId: binding.orgId, teamId: teamIds[0]! };
  return null;
}

/**
 * THE-931 — scoped chat repository.
 *
 * The authoritative org/team ownership boundary. Every read resolves parent
 * ownership before returning (unauthorized is indistinguishable from missing —
 * uniform no-leak). Every write derives its org/team from the owned parent and
 * ignores any caller-supplied teamId, so a request that reaches the repository
 * can never read or mutate another tenant's resources even if a route forgets a
 * check. Routes MUST go through this wrapper for tenant-facing operations.
 */
export interface ScopedChatRepository {
  historyAllowed(): boolean;
  listChannels(): ChatChannelRecord[];
  getChannel(id: string): ChatChannelRecord | undefined;
  getChannelByName(name: string): ChatChannelRecord | undefined;
  listMessagesByChannel(channelId: string): ChatMessageRecord[];
  listMessagesByThread(threadId: string): ChatMessageRecord[];
  listThreadsByChannel(channelId: string): ChatThreadRecord[];
  getThread(id: string): ChatThreadRecord | undefined;
  getThreadByParentMessage(parentMessageId: string): ChatThreadRecord | undefined;
  getMessage(id: string): ChatMessageRecord | undefined;
  listChannelObjectRefs(id: string): ObjectRef[];
  listThreadObjectRefs(id: string): ObjectRef[];
  listCategories(): ChatCategoryRecord[];
  createCategory(input: { name: string; emoji?: string; order?: number }): ChatCategoryRecord;
  /** Returns null when the principal has no creation scope (fail closed). */
  creationScope(): ChatCreationScope | null;
  createChannel(input: { name: string; description?: string; category_id: string; order?: number; agents?: string[] }): ChatChannelRecord;
  updateChannel(id: string, patch: { name?: string; description?: string; category_id?: string; order?: number; agents?: string[] }): ChatChannelRecord | undefined;
  deleteChannel(id: string): boolean;
  markChannelRead(id: string): boolean;
  linkChannelObject(id: string, objectRef: ObjectRef): ChatChannelRecord | undefined;
  linkThreadObject(id: string, objectRef: ObjectRef): ChatThreadRecord | undefined;
  createThread(input: { channel_id: string; parent_message_id: string; title: string }): ChatThreadRecord | undefined;
  incrementThreadCount(threadId: string, timestamp: string): boolean;
  createMessage(input: { channel_id: string; thread_id?: string; sender: string; sender_emoji?: string; content: string; model?: string; is_local?: boolean; status?: string; timestamp?: string; reply_to?: string }): ChatMessageRecord | undefined;
}

export function createScopedChatRepository(
  repo: ReturnType<typeof createChatRepository>,
  binding: RequestOrgBinding,
  access: ChatHistoryAccess,
): ScopedChatRepository {
  const readScope = resolveChatReadScope(binding);
  // The DB-layer scoped repository is the authoritative tenant boundary: it
  // emits only rows the principal owns, so routes cannot leak another tenant's
  // resources even if a check is forgotten. null scope => fail closed (empty).
  const tenant = readScope ? createTenantChatRepository(readScope) : null;
  const creationScope = resolveChatCreationScope(binding);
  const historyAllowed = (): boolean => access(binding).allowed && tenant !== null;
  const categoryMatchesOwner = (
    category: ChatCategoryRecord | undefined,
    owner: { org_id: string | null; team_id: string | null },
  ): boolean => Boolean(category && category.org_id === owner.org_id && category.team_id === owner.team_id);

  return {
    historyAllowed,

    listChannels: () => (historyAllowed() && tenant ? tenant.listChannels() : []),

    getChannel: (id) => (historyAllowed() ? tenant?.getChannel(id) : undefined),

    getChannelByName: (name) => (historyAllowed() ? tenant?.getChannelByName(name) : undefined),

    listMessagesByChannel: (channelId) => (historyAllowed() && tenant ? tenant.listMessagesByChannel(channelId) : []),

    listMessagesByThread: (threadId) => (historyAllowed() && tenant ? tenant.listMessagesByThread(threadId) : []),

    listThreadsByChannel: (channelId) => (historyAllowed() && tenant ? tenant.listThreadsByChannel(channelId) : []),

    getThread: (id) => (historyAllowed() ? tenant?.getThread(id) : undefined),

    getThreadByParentMessage: (parentMessageId) => (historyAllowed() ? tenant?.getThreadByParentMessage(parentMessageId) : undefined),

    getMessage: (id) => (historyAllowed() ? tenant?.getMessage(id) : undefined),

    listChannelObjectRefs: (id) => (historyAllowed() && tenant ? tenant.listChannelObjectRefs(id) : []),

    listThreadObjectRefs: (id) => (historyAllowed() && tenant ? tenant.listThreadObjectRefs(id) : []),

    listCategories: () => (historyAllowed() && tenant ? tenant.listCategories() : []),

    creationScope: () => creationScope,

    createCategory: (input) => {
      if (!creationScope) throw new Error('chat category creation requires an assignment');
      return repo.createCategory({
        name: input.name,
        emoji: input.emoji,
        order: input.order,
        // Server-derived scope; caller ownership is never trusted.
        org_id: creationScope.orgId,
        team_id: creationScope.teamId ?? undefined,
      });
    },

    createChannel: (input) => {
      if (!creationScope) throw new Error('channel creation requires an assignment');
      const category = tenant?.getCategory(input.category_id);
      if (!categoryMatchesOwner(category, {
        org_id: creationScope.orgId,
        team_id: creationScope.teamId,
      })) throw new Error('category not found');
      return repo.createChannel({
        name: input.name,
        description: input.description,
        category_id: input.category_id,
        order: input.order,
        agents: input.agents,
        // Server-derived org/team ownership; caller teamId is ignored. The id is
        // server-generated (authoritative) so a caller-supplied id can never
        // collide with / oracle a foreign resource.
        org_id: creationScope.orgId,
        team_id: creationScope.teamId ?? undefined,
      });
    },

    updateChannel: (id, patch) => {
      if (!historyAllowed() || !tenant) return undefined;
      const channel = tenant.getChannel(id);
      if (!channel) return undefined;
      if (typeof patch.category_id === 'string' && !categoryMatchesOwner(tenant.getCategory(patch.category_id), channel)) {
        return undefined;
      }
      return repo.updateChannel(id, patch);
    },

    deleteChannel: (id) => Boolean(historyAllowed() && tenant?.getChannel(id) && repo.deleteChannel(id)),

    markChannelRead: (id) => {
      if (!historyAllowed() || !tenant?.getChannel(id)) return false;
      repo.markChannelRead(id);
      return true;
    },

    linkChannelObject: (id, objectRef) => (historyAllowed() && tenant?.getChannel(id) ? repo.linkChannelObject(id, objectRef) : undefined),

    linkThreadObject: (id, objectRef) => (historyAllowed() && tenant?.getThread(id) ? repo.linkThreadObject(id, objectRef) : undefined),

    createThread: (input) => {
      if (!historyAllowed()) return undefined;
      // Thread inherits the owned parent channel scope; caller teamId/id ignored.
      const channel = tenant?.getChannel(input.channel_id);
      const parent = tenant?.getMessage(input.parent_message_id);
      if (!channel || !parent || parent.channel_id !== input.channel_id) return undefined;
      return repo.createThread({
        channel_id: input.channel_id,
        parent_message_id: input.parent_message_id,
        title: input.title,
        org_id: binding.orgId,
        team_id: channel.team_id ?? undefined,
      });
    },

    incrementThreadCount: (threadId, timestamp) => {
      if (!historyAllowed() || !tenant?.getThread(threadId)) return false;
      repo.incrementThreadCount(threadId, timestamp);
      return true;
    },

    createMessage: (input) => {
      if (!historyAllowed()) return undefined;
      // Message inherits the owned parent channel scope (and thread, if any).
      // Caller teamId/id are never trusted; the id is server-generated.
      const channel = tenant?.getChannel(input.channel_id);
      if (!channel) return undefined;
      if (input.thread_id) {
        const thread = tenant?.getThread(input.thread_id);
        if (!thread || thread.channel_id !== input.channel_id) return undefined;
      }
      return repo.createMessage({
        channel_id: input.channel_id,
        thread_id: input.thread_id,
        sender: input.sender,
        sender_emoji: input.sender_emoji,
        content: input.content,
        model: input.model,
        is_local: input.is_local,
        status: input.status,
        timestamp: input.timestamp,
        reply_to: input.reply_to,
        org_id: binding.orgId,
        team_id: channel.team_id ?? undefined,
      });
    },
  };
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

/** THE-930: server-authoritative emoji for human-authored messages. */
const USER_MESSAGE_EMOJI = '🧑';

const OLLAMA_MODEL_FETCH_TIMEOUT_MS = 750;
const CHAT_NOISE_SETTINGS_KEY = 'chat.noiseSettings';
const CHAT_NOISE_MAX_MUTED = 64;
const CHAT_NOISE_MAX_COOLDOWN_MS = 60 * 60 * 1000;

interface StoredChatNoiseSettings {
  cooldownMs?: number;
  mutedAgents?: string[];
}

function normalizeMutedAgents(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
    .filter(Boolean)
    .slice(0, CHAT_NOISE_MAX_MUTED);
}

function readChatNoiseSettings(): Required<StoredChatNoiseSettings> {
  try {
    const db = getEntityDatabase(ensureAppSettingsTable);
    const stored = getSettingJson(db, CHAT_NOISE_SETTINGS_KEY);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      return { cooldownMs: 0, mutedAgents: [] };
    }
    const record = stored as StoredChatNoiseSettings;
    const cooldownMs = Math.min(CHAT_NOISE_MAX_COOLDOWN_MS, Math.max(0, Number(record.cooldownMs ?? 0) || 0));
    return { cooldownMs, mutedAgents: normalizeMutedAgents(record.mutedAgents) };
  } catch {
    // A persistence failure is not an empty policy: fail closed so a mute or
    // cooldown cannot be silently bypassed.
    throw new Error('chat noise policy unavailable');
  }
}

function writeChatNoiseSettings(settings: Required<StoredChatNoiseSettings>): void {
  const db = getEntityDatabase(ensureAppSettingsTable);
  setSettingJson(db, CHAT_NOISE_SETTINGS_KEY, settings, 'admin-ui');
}

function chatNoiseSettingsView(guard: AgentNoiseGuard) {
  const snapshot = guard.snapshot();
  return {
    cooldownMs: snapshot.cooldownMs,
    mutedAgents: snapshot.mutedAgents,
    // THE-930: surface the selected model backend so the UI can show it alongside
    // muted/cooldown/degraded state.
    backend: getTaskAgentSettings().provider,
    maxCooldownMs: CHAT_NOISE_MAX_COOLDOWN_MS,
  };
}

/**
 * THE-930: global noise settings are system-wide configuration. Only an admin
 * principal may mutate them: a principal holding an admin grant, or the local
 * admin principal in single-process/dev (no token auth). Non-admins are denied.
 */
function principalCanAdminNoise(principal: RequestOrgBinding['principal']): boolean {
  if (principal.principal_id === LOCAL_ADMIN_PRINCIPAL_ID) return true;
  return principal.grants.some((grant) => grant.role === 'admin');
}
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
    orgId: channel.org_id,
    teamId: channel.team_id,
  };
}

function toCategory(category: ChatCategoryRecord) {
  return {
    id: category.id,
    name: category.name,
    emoji: category.emoji ?? undefined,
    order: category.order,
    createdAt: category.created_at,
    orgId: category.org_id,
    teamId: category.team_id,
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

async function ensureDefaults() {
  const repo = createChatRepository();
  const categories = repo.listCategories();
  const byName = new Map(categories.map((row) => [row.name.trim().toLowerCase(), row]));

  const general = byName.get('general') ?? repo.createCategory({ id: 'general', name: 'General', emoji: '💬', order: 0 });
  const agents = byName.get('agents') ?? repo.createCategory({ id: 'agents', name: 'Agents', emoji: '🤖', order: 1 });

  const channels = repo.listChannels();
  const channelByName = new Map(channels.map((row) => [row.name.trim().toLowerCase(), row]));

  if (!channelByName.has('command-deck')) {
    repo.createChannel({ id: 'command-deck', name: 'command-deck', category_id: general.id, order: 0, agents: [] });
  }

  if (!channelByName.has('ada')) {
    repo.createChannel({ id: 'ada', name: 'ada', category_id: agents.id, order: 0, agents: ['ada'] });
  }

  if (!channelByName.has('spock')) {
    repo.createChannel({ id: 'spock', name: 'spock', category_id: agents.id, order: 1, agents: ['spock'] });
  }

  if (!channelByName.has('scotty')) {
    repo.createChannel({ id: 'scotty', name: 'scotty', category_id: agents.id, order: 2, agents: ['scotty'] });
  }

  if (!channelByName.has('geordi')) {
    repo.createChannel({ id: 'geordi', name: 'geordi', category_id: agents.id, order: 3, agents: ['geordi'] });
  }

  if (!channelByName.has('zora')) {
    repo.createChannel({ id: 'zora', name: 'zora', category_id: agents.id, order: 4, agents: ['zora'] });
  }

  if (!channelByName.has('midas')) {
    repo.createChannel({ id: 'midas', name: 'midas', category_id: agents.id, order: 5, agents: ['midas'] });
  }

  if (!channelByName.has('random')) {
    repo.createChannel({ id: 'random', name: 'random', category_id: general.id, order: 1, agents: [] });
  }

  return {
    categories: repo.listCategories().map(toCategory),
    channels: repo.listChannels().map(toChannel),
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
  chatHistoryAccess = principalCanReadChatHistory,
  agentNoiseGuard,
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

  // THE-930: agent noise guard built from persisted settings (mute/cooldown).
  // When no guard is injected, use a DB-backed reservation so multiple server
  // processes sharing the SQLite DB cannot both emit a duplicate reply.
  const noiseGuard = agentNoiseGuard ?? (() => {
    const stored = readChatNoiseSettings();
    return createAgentNoiseGuard({
      cooldownMs: stored.cooldownMs,
      mutedAgents: stored.mutedAgents,
      db: getEntityDatabase(),
      policy: readChatNoiseSettings,
    });
  })();

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

  // THE-930: agent noise controls (mute/cooldown) + selected backend.
  app.get('/api/chat/noise-settings', (_req, res) => {
    try {
      return res.json({ settings: chatNoiseSettingsView(noiseGuard) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: message });
    }
  });

  app.patch('/api/chat/noise-settings', (req, res) => {
    try {
      // THE-930: global noise settings are system-wide config — require an admin
      // principal (explicit admin grant, or the local admin in single-process/dev).
      const adminBinding = requireRequestOrg(req, res);
      if (!adminBinding) return undefined;
      if (!principalCanAdminNoise(adminBinding.principal)) {
        return res.status(403).json({ error: 'admin role required', code: 'admin_required' });
      }
      const current = readChatNoiseSettings();
      const next = {
        cooldownMs: typeof req.body?.cooldownMs === 'number'
          ? Math.min(CHAT_NOISE_MAX_COOLDOWN_MS, Math.max(0, Math.floor(req.body.cooldownMs)) || 0)
          : current.cooldownMs,
        mutedAgents: Array.isArray(req.body?.mutedAgents)
          ? normalizeMutedAgents(req.body.mutedAgents)
          : current.mutedAgents,
      };
      // Persist first. Every reservation refreshes this shared policy, so other
      // already-running instances observe the update without restart.
      writeChatNoiseSettings(next);
      // Keep an explicitly injected/test guard in sync while the default guard
      // will refresh the same persisted policy on its next reservation.
      noiseGuard.setCooldownMs(next.cooldownMs);
      const currentMuted = noiseGuard.snapshot().mutedAgents;
      for (const agent of currentMuted) noiseGuard.setMuted(agent, false);
      for (const agent of next.mutedAgents) noiseGuard.setMuted(agent, true);
      return res.json({ settings: chatNoiseSettingsView(noiseGuard) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(400).json({ error: message });
    }
  });

  app.get('/api/chat/task/:taskId', (req, res) => {
    try {
      const taskId = String(req.params.taskId ?? '').trim();
      if (!taskId) {
        return res.status(400).json({ error: 'taskId is required' });
      }

      const binding = requireRequestOrg(req, res);
      if (!binding) return undefined;
      const scoped = createScopedChatRepository(repo, binding, chatHistoryAccess);
      // THE-931: denied principals get the same empty shape as a task with no
      // channel — no existence leak.
      if (!scoped.historyAllowed()) {
        return res.json({ taskId, channel: null, messages: [], threads: [] });
      }

      const candidateIds = [`task-${taskId}`, taskId];
      // THE-931 (R2): task lookup goes through the scoped repository boundary —
      // never the raw repo — so a foreign/legacy channel is indistinguishable
      // from a missing one (no existence leak).
      const channel = candidateIds
        .map((id) => scoped.getChannel(id) ?? scoped.getChannelByName(id))
        .find((candidate) => candidate);

      if (!channel) {
        return res.json({ taskId, channel: null, messages: [], threads: [] });
      }

      const messages = scoped.listMessagesByChannel(channel.id).map(toMessage);
      const threads = scoped.listThreadsByChannel(channel.id).map(toThread);
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
    const binding = requireRequestOrg(req, res);
    if (!binding) return undefined;
    const scoped = createScopedChatRepository(repo, binding, chatHistoryAccess);
    if (!scoped.historyAllowed()) {
      return sendPermissionDenied(res, 'chat history requires an org/team assignment');
    }
    try {
      return res.json({
        categories: scoped.listCategories().map(toCategory),
        channels: scoped.listChannels().map(toChannel),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/chat/channels/:channelId/messages', (req, res) => {
    const binding = requireRequestOrg(req, res);
    if (!binding) return undefined;
    const scoped = createScopedChatRepository(repo, binding, chatHistoryAccess);
    // THE-931: unauthorized is indistinguishable from missing (uniform no-leak 404).
    const channel = scoped.getChannel(req.params.channelId);
    if (!channel) {
      return denyChatHistory(res, 'channel not found');
    }
    try {
      return res.json({ messages: scoped.listMessagesByChannel(req.params.channelId).map(toMessage) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/chat/channels/:channelId/threads', (req, res) => {
    const binding = requireRequestOrg(req, res);
    if (!binding) return undefined;
    const scoped = createScopedChatRepository(repo, binding, chatHistoryAccess);
    const channel = scoped.getChannel(req.params.channelId);
    if (!channel) {
      return denyChatHistory(res, 'channel not found');
    }
    try {
      return res.json({ threads: scoped.listThreadsByChannel(req.params.channelId).map(toThread) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/chat/channels/:channelId/object-refs', (req, res) => {
    const binding = requireRequestOrg(req, res);
    if (!binding) return undefined;
    const scoped = createScopedChatRepository(repo, binding, chatHistoryAccess);
    const channel = scoped.getChannel(req.params.channelId);
    if (!channel) {
      return res.status(404).json({ error: 'channel not found' });
    }
    return res.json({
      target: { type: 'channel', id: channel.id },
      ...visibleObjectRefs(binding, channel.linked_object_refs, chatObjectRefAccess),
    });
  });

  app.post('/api/chat/channels/:channelId/object-refs', (req, res) => {
    const binding = requireRequestOrg(req, res);
    if (!binding) return undefined;
    const scoped = createScopedChatRepository(repo, binding, chatHistoryAccess);
    if (!scoped.getChannel(req.params.channelId)) return denyChatHistory(res, 'channel not found');
    try {
      const objectRef = parseObjectRefBody(req.body);
      const decision = chatObjectRefAccess(binding, objectRef);
      if (!decision.allowed) {
        return sendPermissionDenied(res, decision.reason ?? 'access denied by object policy');
      }
      const channel = scoped.linkChannelObject(req.params.channelId, objectRef);
      if (!channel) {
        return res.status(404).json({ error: 'channel not found' });
      }
      return res.status(201).json({
        target: { type: 'channel', id: channel.id },
        ...visibleObjectRefs(binding, channel.linked_object_refs, chatObjectRefAccess),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(400).json({ error: message });
    }
  });

  app.get('/api/chat/threads/:threadId/messages', (req, res) => {
    const binding = requireRequestOrg(req, res);
    if (!binding) return undefined;
    const scoped = createScopedChatRepository(repo, binding, chatHistoryAccess);
    const thread = scoped.getThread(req.params.threadId);
    if (!thread) {
      return denyChatHistory(res, 'thread not found');
    }
    try {
      // THE-931 (R2): thread message listing goes through the scoped repository
      // boundary (tenant-scoped SQL), not the raw repo + JS filter.
      const messages = scoped.listMessagesByThread(req.params.threadId).map(toMessage);
      return res.json({ messages });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/chat/messages/:messageId', (req, res) => {
    const binding = requireRequestOrg(req, res);
    if (!binding) return undefined;
    const scoped = createScopedChatRepository(repo, binding, chatHistoryAccess);
    const message = scoped.getMessage(req.params.messageId);
    if (!message) {
      return denyChatHistory(res, 'message not found');
    }

    return res.json({ message: toMessage(message) });
  });

  app.get('/api/chat/threads/:threadId/object-refs', (req, res) => {
    const binding = requireRequestOrg(req, res);
    if (!binding) return undefined;
    const scoped = createScopedChatRepository(repo, binding, chatHistoryAccess);
    const thread = scoped.getThread(req.params.threadId);
    if (!thread) {
      return res.status(404).json({ error: 'thread not found' });
    }
    return res.json({
      target: { type: 'thread', id: thread.id },
      ...visibleObjectRefs(binding, thread.linked_object_refs, chatObjectRefAccess),
    });
  });

  app.post('/api/chat/threads/:threadId/object-refs', (req, res) => {
    const binding = requireRequestOrg(req, res);
    if (!binding) return undefined;
    const scoped = createScopedChatRepository(repo, binding, chatHistoryAccess);
    if (!scoped.getThread(req.params.threadId)) return denyChatHistory(res, 'thread not found');
    try {
      const objectRef = parseObjectRefBody(req.body);
      const decision = chatObjectRefAccess(binding, objectRef);
      if (!decision.allowed) {
        return sendPermissionDenied(res, decision.reason ?? 'access denied by object policy');
      }
      const thread = scoped.linkThreadObject(req.params.threadId, objectRef);
      if (!thread) {
        return res.status(404).json({ error: 'thread not found' });
      }
      return res.status(201).json({
        target: { type: 'thread', id: thread.id },
        ...visibleObjectRefs(binding, thread.linked_object_refs, chatObjectRefAccess),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(400).json({ error: message });
    }
  });

  app.get('/api/chat/threads/by-parent/:parentMessageId', (req, res) => {
    const binding = requireRequestOrg(req, res);
    if (!binding) return undefined;
    const scoped = createScopedChatRepository(repo, binding, chatHistoryAccess);
    const thread = scoped.getThreadByParentMessage(req.params.parentMessageId);
    if (!thread) {
      return res.status(404).json({ error: 'thread not found' });
    }

    return res.json({ thread: toThread(thread) });
  });

  app.post('/api/chat/categories', (req, res) => {
    try {
      const binding = requireRequestOrg(req, res);
      if (!binding) return undefined;
      const scoped = createScopedChatRepository(repo, binding, chatHistoryAccess);
      // THE-931 (R2): category creation requires an assignment and a
      // server-derived scope. Zero/revoked/inactive/ambiguous grants fail closed.
      if (!scoped.creationScope()) {
        return sendPermissionDenied(res, 'chat category creation requires an assignment');
      }
      const category = scoped.createCategory({
        name: String(req.body?.name ?? '').trim(),
        emoji: typeof req.body?.emoji === 'string' ? req.body.emoji : undefined,
        order: Number.isFinite(Number(req.body?.order)) ? Number(req.body.order) : undefined,
      });
      return res.status(201).json({ category: toCategory(category) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(400).json({ error: message });
    }
  });

  app.post('/api/chat/channels', (req, res) => {
    try {
      const categoryId = String(req.body?.categoryId ?? req.body?.category_id ?? '').trim();
      if (!categoryId) {
        return res.status(400).json({ error: 'categoryId is required' });
      }

      const binding = requireRequestOrg(req, res);
      if (!binding) return undefined;
      const scoped = createScopedChatRepository(repo, binding, chatHistoryAccess);
      // THE-931 (R2): channel creation requires an assignment and a
      // server-derived scope. Caller teamId/id are ignored (server derives
      // org/team and generates an authoritative id). Zero/revoked/inactive /
      // ambiguous grants fail closed.
      if (!scoped.creationScope()) {
        return sendPermissionDenied(res, 'channel creation requires an assignment');
      }
      const channel = scoped.createChannel({
        name: String(req.body?.name ?? '').trim(),
        description: typeof req.body?.description === 'string' ? req.body.description : undefined,
        category_id: categoryId,
        order: Number.isFinite(Number(req.body?.order)) ? Number(req.body.order) : undefined,
        agents: normalizeAgents(req.body?.agents),
      });

      return res.status(201).json({ channel: toChannel(channel) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(400).json({ error: message });
    }
  });

  app.patch('/api/chat/channels/:channelId', (req, res) => {
    const binding = requireRequestOrg(req, res);
    if (!binding) return undefined;
    const scoped = createScopedChatRepository(repo, binding, chatHistoryAccess);
    if (!scoped.getChannel(req.params.channelId)) return denyChatHistory(res, 'channel not found');
    try {
      const channel = scoped.updateChannel(req.params.channelId, {
        name: typeof req.body?.name === 'string' ? req.body.name : undefined,
        description: typeof req.body?.description === 'string' ? req.body.description : undefined,
        category_id: typeof req.body?.categoryId === 'string' ? req.body.categoryId : undefined,
        order: Number.isFinite(Number(req.body?.order)) ? Number(req.body.order) : undefined,
        agents: Array.isArray(req.body?.agents) ? normalizeAgents(req.body.agents) : undefined,
      });

      if (!channel) {
        return res.status(404).json({ error: 'channel not found' });
      }

      return res.json({ channel: toChannel(channel) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(400).json({ error: message });
    }
  });

  app.delete('/api/chat/channels/:channelId', (req, res) => {
    const binding = requireRequestOrg(req, res);
    if (!binding) return undefined;
    const scoped = createScopedChatRepository(repo, binding, chatHistoryAccess);
    if (!scoped.getChannel(req.params.channelId)) return denyChatHistory(res, 'channel not found');
    const deleted = scoped.deleteChannel(req.params.channelId);
    if (!deleted) {
      return res.status(404).json({ error: 'channel not found' });
    }

    return res.json({ success: true });
  });

  app.post('/api/chat/channels/:channelId/read', (req, res) => {
    const binding = requireRequestOrg(req, res);
    if (!binding) return undefined;
    const scoped = createScopedChatRepository(repo, binding, chatHistoryAccess);
    if (!scoped.getChannel(req.params.channelId)) return denyChatHistory(res, 'channel not found');
    scoped.markChannelRead(req.params.channelId);
    return res.json({ success: true });
  });

  app.post('/api/chat/threads', (req, res) => {
    try {
      const binding = requireRequestOrg(req, res);
      if (!binding) return undefined;
      const scoped = createScopedChatRepository(repo, binding, chatHistoryAccess);
      const channelId = String(req.body?.channelId ?? '').trim();
      const parentMessageId = String(req.body?.parentMessageId ?? '').trim();
      const title = String(req.body?.title ?? 'Thread').trim() || 'Thread';
      if (!channelId || !parentMessageId) {
        return res.status(400).json({ error: 'channelId and parentMessageId are required' });
      }

      const existing = scoped.getThreadByParentMessage(parentMessageId);
      if (existing) {
        return res.json({ thread: toThread(existing) });
      }

      // THE-931 (R2): createThread resolves parent channel/message ownership at
      // the repository boundary and inherits the owned channel's team scope. The
      // caller id is ignored (server generates an authoritative id).
      const thread = scoped.createThread({
        channel_id: channelId,
        parent_message_id: parentMessageId,
        title,
      });
      if (!thread) return denyChatHistory(res, 'thread not found');

      return res.status(201).json({ thread: toThread(thread) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(400).json({ error: message });
    }
  });

  app.post('/api/chat/setup', async (req, res) => {
    const binding = requireRequestOrg(req, res);
    if (!binding) return undefined;
    const scoped = createScopedChatRepository(repo, binding, chatHistoryAccess);
    if (!scoped.historyAllowed()) return denyChatHistory(res, 'chat setup unavailable');
    try {
      const snapshot = await ensureDefaults();
      // THE-931 (R2): ensureDefaults bootstraps legacy unowned channels/categories;
      // the setup surface returns only channels AND categories the principal owns
      // (legacy rows fail closed for every non-local-admin principal). Ownership
      // is resolved at the repository boundary, so foreign/legacy metadata
      // cannot leak here.
      const ownedChannelIds = new Set(scoped.listChannels().map((c) => c.id));
      const ownedCategoryIds = new Set(scoped.listCategories().map((c) => c.id));
      snapshot.channels = snapshot.channels.filter((channel) => ownedChannelIds.has(channel.id));
      snapshot.categories = snapshot.categories.filter((category) => ownedCategoryIds.has(category.id));
      return res.json(snapshot);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/chat/send', async (req, res) => {
    try {
      const channelId = String(req.body?.channelId ?? '').trim();
      const content = String(req.body?.content ?? '').trim();
      if (!channelId || !content) {
        return res.status(400).json({ error: 'channelId and content are required' });
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

      // THE-930 (blocker 1): identity and time are server-authoritative. The
      // sender is the authenticated/server-resolved principal; the timestamp is
      // the server clock; locality is derived from the resolved target model.
      // Caller-supplied sender/senderEmoji/timestamp/isLocal are NEVER trusted.
      const binding = requireRequestOrg(req, res);
      if (!binding) return undefined;
      const authoritativeSender = binding.principal.principal_id;
      const authoritativeTimestamp = new Date().toISOString();
      const scoped = createScopedChatRepository(repo, binding, chatHistoryAccess);
      // THE-931: the channel is resolved and owned at the repository boundary;
      // every message/thread write below inherits the owned channel scope and
      // ignores any caller-supplied teamId.
      const ownedChannel = scoped.getChannel(channelId);
      if (!ownedChannel) return denyChatHistory(res, 'channel not found');
      const userIsLocal = targets.length > 0 ? Boolean(modelByAgent.get(targets[0])?.isLocal) : false;

      if (sidecarBridge) {
        const threadId = typeof req.body?.threadId === 'string' ? req.body.threadId : undefined;
        const parentMessageId = typeof req.body?.parentMessageId === 'string' ? req.body.parentMessageId : undefined;
        const userMessage = scoped.createMessage({
          channel_id: channelId,
          thread_id: threadId,
          sender: authoritativeSender,
          sender_emoji: USER_MESSAGE_EMOJI,
          content,
          model: modelId && modelId !== 'auto' ? modelId : undefined,
          is_local: userIsLocal,
          status: 'sent',
          timestamp: authoritativeTimestamp,
          reply_to: parentMessageId,
        });
        if (!userMessage) return denyChatHistory(res, 'channel not found');

        if (threadId) {
          scoped.incrementThreadCount(threadId, userMessage.timestamp);
        }

        // THE-930: apply the same noise guard to the ClickClack sidecar path so
        // muted/cooldown/concurrent-duplicate agents are suppressed consistently.
        const sidecarScope = { channelId, threadId };
        const sidecarTargets: string[] = [];
        const sidecarTokens = new Map<string, string>();
        const sidecarSuppressed: Array<{ agent: string; reason: string }> = [];
        for (const agent of targets) {
          const reservation = noiseGuard.reserve(agent, sidecarScope, content);
          if (reservation.suppressed) {
            sidecarSuppressed.push({ agent, reason: reservation.reason ?? 'suppressed' });
          } else {
            sidecarTargets.push(agent);
            if (reservation.ownerToken) sidecarTokens.set(agent, reservation.ownerToken);
          }
        }
        // THE-930 (blocker 2): every acquired reservation is released in a
        // finally so a failed sidecar delivery cannot leak in-flight slots and
        // suppress a legitimate retry as duplicate-concurrent. Cooldown is
        // recorded only when the delivery was accepted.
        let sidecarDelivered = false;
        try {
          const result = await sidecarBridge.sendCompatibilityMessage({
            channelId,
            content,
            targets: sidecarTargets,
            messageId: userMessage.id,
            threadId: typeof req.body?.threadId === 'string' ? req.body.threadId : undefined,
            // Entity message ids are local; keep ClickClack sidecar sends channel-scoped until we persist an id map.
            parentMessageId: undefined,
            modelByAgent,
          });
          sidecarDelivered = true;

          const storedReplies = result.messages.map((message): ReturnType<typeof toMessage> | null => {
            const stored = scoped.createMessage({
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
            });
            if (!stored) return null;

            if (threadId) {
              scoped.incrementThreadCount(threadId, stored.timestamp);
            }

            return toMessage(stored);
          }).filter((m): m is ReturnType<typeof toMessage> => m !== null);

          return res.status(201).json({
            ...result,
            message: toMessage(userMessage),
            messages: storedReplies,
            suppressed: sidecarSuppressed,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'ClickClack delivery failed';
          return res.status(202).json({
            degraded: true,
            error: message,
            message: toMessage(userMessage),
            messages: [],
            suppressed: sidecarSuppressed,
            clickclack: {
              mode: 'dev-sidecar',
              baseUrl: process.env.ENTITY_CLICKCLACK_BASE_URL ?? 'http://127.0.0.1:3091',
              error: message,
            },
          });
        } finally {
          // THE-930 (R2): release requires the exact owner token returned by the
          // corresponding reservation. Only acquired reservations have a token;
          // a missing token is a no-op (fail closed).
          for (const agent of sidecarTargets) {
            const token = sidecarTokens.get(agent);
            if (token) noiseGuard.release(agent, sidecarScope, content, { delivered: sidecarDelivered, ownerToken: token });
          }
        }
      }

      const threadId = typeof req.body?.threadId === 'string' ? req.body.threadId : undefined;
      const parentMessageId = typeof req.body?.parentMessageId === 'string' ? req.body.parentMessageId : undefined;

      const userMessage = scoped.createMessage({
        channel_id: channelId,
        thread_id: threadId,
        sender: authoritativeSender,
        sender_emoji: USER_MESSAGE_EMOJI,
        content,
        model: modelId && modelId !== 'auto' ? modelId : undefined,
        is_local: userIsLocal,
        status: 'sent',
        timestamp: authoritativeTimestamp,
        reply_to: parentMessageId,
      });
      if (!userMessage) return denyChatHistory(res, 'channel not found');

      if (threadId) {
        scoped.incrementThreadCount(threadId, userMessage.timestamp);
      }

      // THE-930: atomic scoped reservation. Suppression keys only on the
      // server-resolved target identity + guard clock; client sender/timestamps
      // can neither bypass nor trigger it. Reservations are held across reply
      // generation+storage so concurrent duplicate sends are suppressed.
      const noiseScope = { channelId, threadId };
      const sendableTargets: string[] = [];
      const reservationTokens = new Map<string, string>();
      const suppressedReplies: Array<{ agent: string; reason: string }> = [];
      for (const agent of targets) {
        const reservation = noiseGuard.reserve(agent, noiseScope, content);
        if (reservation.suppressed) {
          suppressedReplies.push({ agent, reason: reservation.reason ?? 'suppressed' });
        } else {
          sendableTargets.push(agent);
          if (reservation.ownerToken) reservationTokens.set(agent, reservation.ownerToken);
        }
      }

      const openClawTargets = sendableTargets.filter((agent) => OPENCLAW_REPLY_AGENT_IDS.has(agent));
      const batchedOpenClawReplies = openClawTargets.length > 1
        ? await requestOpenClawAgentReplyMap(openClawTargets, content, {
          modelId: modelId && modelId !== 'auto' ? modelByAgent.get(openClawTargets[0])?.modelId : undefined,
          channelId,
          threadId,
        })
        : new Map<string, OpenClawReply>();

      const replies: ReturnType<typeof toMessage>[] = [];
      await Promise.all(sendableTargets.map(async (agent) => {
        let delivered = false;
        try {
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

          const stored = scoped.createMessage({
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
          });
          if (!stored) return;

          if (threadId) {
            scoped.incrementThreadCount(threadId, stored.timestamp);
          }

          replies.push(toMessage(stored));
          delivered = true;
        } finally {
          // THE-930 (R2): release requires the exact owner token returned by the
          // corresponding reservation; a missing token is a no-op (fail closed).
          const token = reservationTokens.get(agent);
          if (token) noiseGuard.release(agent, noiseScope, content, { delivered, ownerToken: token });
        }
      }));

      return res.status(201).json({
        message: toMessage(userMessage),
        messages: replies,
        suppressed: suppressedReplies,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: message });
    }
  });
}
