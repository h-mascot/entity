import { create } from 'zustand';
import { getChatAgentOptions } from '../lib/agentRegistry';
import {
  createCategory,
  createChannel,
  createThread,
  deleteChannel,
  ensureDefaultChatSetup,
  getMessageById,
  getThreadByParentMessage,
  listChannelsByCategory,
  listChatSnapshot,
  listMessagesByChannel,
  listMessagesByThread,
  listThreadsByChannel,
  markChannelRead,
  upsertMessage,
  updateChannel,
  updateMessageStatus,
  type ChatCategory,
  type ChatChannel,
  type ChatMessage,
  type ChatMessageStatus,
  type ChatThread,
} from '../lib/chat-store';

export interface ChatAgentOption {
  id: string;
  name: string;
  emoji: string;
}

export interface ChatModelOption {
  id: string;
  name: string;
  provider: string;
  isLocal: boolean;
  available?: boolean;
  allowed?: boolean;
  source?: string;
}

export const CHAT_AGENT_OPTIONS: readonly ChatAgentOption[] = getChatAgentOptions();

export const CHAT_MODEL_OPTIONS: readonly ChatModelOption[] = [] as const;

export const CHAT_ALL_AGENTS_ID = 'all';
export const CHAT_AUTO_MODEL_ID = "auto";

function messageTimestamp(message: ChatMessage): number {
  const parsed = new Date(message.timestamp).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function threadTimestamp(thread: ChatThread): number {
  const parsed = new Date(thread.lastMessageAt).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function upsertMessageList(list: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const next = [...list];
  const existingIndex = next.findIndex((candidate) => candidate.id === message.id);
  if (existingIndex >= 0) {
    next[existingIndex] = message;
  } else {
    next.push(message);
  }
  next.sort((left, right) => messageTimestamp(left) - messageTimestamp(right));
  return next;
}

function upsertThreadList(list: ChatThread[], thread: ChatThread): ChatThread[] {
  const next = [...list];
  const existingIndex = next.findIndex((candidate) => candidate.id === thread.id);
  if (existingIndex >= 0) {
    next[existingIndex] = thread;
  } else {
    next.push(thread);
  }
  next.sort((left, right) => threadTimestamp(right) - threadTimestamp(left));
  return next;
}

function upsertChannelList(list: ChatChannel[], patch: ChatChannel): ChatChannel[] {
  const next = [...list];
  const existingIndex = next.findIndex((candidate) => candidate.id === patch.id);
  if (existingIndex >= 0) {
    next[existingIndex] = patch;
  } else {
    next.push(patch);
  }
  return next;
}

function categorySort(left: ChatCategory, right: ChatCategory): number {
  if (left.order !== right.order) {
    return left.order - right.order;
  }
  return left.name.localeCompare(right.name);
}

function channelSort(left: ChatChannel, right: ChatChannel): number {
  if (left.categoryId !== right.categoryId) {
    return left.categoryId.localeCompare(right.categoryId);
  }
  if (left.order !== right.order) {
    return left.order - right.order;
  }
  return left.name.localeCompare(right.name);
}

function deriveThreadTitleFromMessage(message: ChatMessage | null): string {
  if (!message) {
    return 'Thread';
  }

  const text = message.content.replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return 'Thread';
  }

  if (text.length <= 60) {
    return text;
  }

  return `${text.slice(0, 57)}...`;
}

interface ChatStoreState {
  initialized: boolean;
  loading: boolean;
  error: string | null;
  categories: ChatCategory[];
  channels: ChatChannel[];
  collapsedCategoryIds: string[];
  activeChannelId: string | null;
  openThreadId: string | null;
  selectedAgentByChannel: Record<string, string>;
  selectedModelByChannel: Record<string, string>;
  channelMessages: Record<string, ChatMessage[]>;
  channelThreads: Record<string, ChatThread[]>;
  threadMessages: Record<string, ChatMessage[]>;
  typingByScope: Record<string, string[]>;
  modelOptions: ChatModelOption[];
  modelOptionsAgentKey: string;
  modelOptionsLoading: boolean;

  initialize: () => Promise<void>;
  refreshStructure: () => Promise<void>;
  selectChannel: (channelId: string) => Promise<void>;
  toggleCategory: (categoryId: string) => void;

  createCategory: (input: { name: string; emoji?: string }) => Promise<void>;
  createChannel: (input: { categoryId: string; name: string; description?: string; agents?: string[] }) => Promise<void>;
  saveChannel: (
    channelId: string,
    patch: Partial<Pick<ChatChannel, 'name' | 'description' | 'agents'>>
  ) => Promise<void>;
  removeChannel: (channelId: string) => Promise<void>;

  openThreadFromMessage: (parentMessageId: string) => Promise<ChatThread | null>;
  closeThread: () => void;
  loadThreadMessages: (threadId: string) => Promise<void>;

  addMessage: (
    message: ChatMessage,
    options?: {
      incrementUnread?: boolean;
      threadTitle?: string;
      parentMessageId?: string;
    }
  ) => Promise<void>;
  patchMessageStatus: (messageId: string, status: ChatMessageStatus) => Promise<void>;

  setTyping: (scopeId: string, agentIds: string[]) => void;
  setSelectedAgent: (channelId: string, agentId: string) => void;
  setSelectedModel: (channelId: string, modelId: string) => void;
  loadModelOptions: (agentIds: string[]) => Promise<void>;
}

function normalizeModel(value: unknown): ChatModelOption | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !row.id.trim()) return null;
  const id = row.id.trim();
  return {
    id,
    name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : id,
    provider: typeof row.provider === 'string' && row.provider.trim() ? row.provider.trim() : id.split('/')[0] ?? 'unknown',
    isLocal: Boolean(row.isLocal ?? row.local),
    available: typeof row.available === 'boolean' ? row.available : undefined,
    allowed: typeof row.allowed === 'boolean' ? row.allowed : undefined,
    source: typeof row.source === 'string' ? row.source : undefined,
  };
}

function uniqModels(models: ChatModelOption[]): ChatModelOption[] {
  const seen = new Set<string>();
  const out: ChatModelOption[] = [];
  for (const model of models) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    out.push(model);
  }
  return out;
}

export const useChat = create<ChatStoreState>((set, get) => ({
  initialized: false,
  loading: false,
  error: null,
  categories: [],
  channels: [],
  collapsedCategoryIds: [],
  activeChannelId: null,
  openThreadId: null,
  selectedAgentByChannel: {},
  selectedModelByChannel: {},
  channelMessages: {},
  channelThreads: {},
  threadMessages: {},
  typingByScope: {},
  modelOptions: [...CHAT_MODEL_OPTIONS],
  modelOptionsAgentKey: '',
  modelOptionsLoading: false,

  initialize: async () => {
    const current = get();
    if (current.loading || current.initialized) {
      return;
    }

    set({ loading: true, error: null });

    try {
      await ensureDefaultChatSetup();
      const snapshot = await listChatSnapshot();

      const categories = [...snapshot.categories].sort(categorySort);
      const channels = [...snapshot.channels].sort(channelSort);
      const activeChannelId = current.activeChannelId ?? channels[0]?.id ?? null;

      set({
        categories,
        channels,
        activeChannelId,
        initialized: true,
        loading: false,
      });

      if (activeChannelId) {
        await get().selectChannel(activeChannelId);
        const activeChannel = channels.find((channel) => channel.id === activeChannelId);
        void get().loadModelOptions(activeChannel?.agents?.length ? activeChannel.agents : ['ada']);
      }
    } catch (error) {
      set({
        loading: false,
        initialized: false,
        error: error instanceof Error ? error.message : 'Failed to initialize chat.',
      });
    }
  },

  refreshStructure: async () => {
    try {
      const snapshot = await listChatSnapshot();
      const categories = [...snapshot.categories].sort(categorySort);
      const channels = [...snapshot.channels].sort(channelSort);
      const activeChannelId = get().activeChannelId;
      const hasActive = activeChannelId ? channels.some((channel) => channel.id === activeChannelId) : false;

      set({
        categories,
        channels,
        activeChannelId: hasActive ? activeChannelId : channels[0]?.id ?? null,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to refresh chat structure.' });
    }
  },

  selectChannel: async (channelId: string) => {
    set({ activeChannelId: channelId, openThreadId: null });

    try {
      const [messages, threads] = await Promise.all([
        listMessagesByChannel(channelId),
        listThreadsByChannel(channelId),
        markChannelRead(channelId),
      ]);

      set((state) => ({
        channels: state.channels.map((channel) =>
          channel.id === channelId
            ? {
                ...channel,
                unreadCount: 0,
              }
            : channel
        ),
        channelMessages: {
          ...state.channelMessages,
          [channelId]: messages,
        },
        channelThreads: {
          ...state.channelThreads,
          [channelId]: threads,
        },
      }));

      const state = get();
      const selectedAgent = state.selectedAgentByChannel[channelId] ?? CHAT_ALL_AGENTS_ID;
      const channel = state.channels.find((candidate) => candidate.id === channelId);
      const agents = selectedAgent === CHAT_ALL_AGENTS_ID ? channel?.agents ?? [] : [selectedAgent];
      void get().loadModelOptions(agents.length > 0 ? agents : ['ada']);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to load channel.' });
    }
  },

  toggleCategory: (categoryId: string) => {
    set((state) => {
      const next = new Set(state.collapsedCategoryIds);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return { collapsedCategoryIds: Array.from(next) };
    });
  },

  createCategory: async (input) => {
    await createCategory(input);
    await get().refreshStructure();
  },

  createChannel: async (input) => {
    const channel = await createChannel(input);
    await get().refreshStructure();
    await get().selectChannel(channel.id);
  },

  saveChannel: async (channelId, patch) => {
    const next = await updateChannel(channelId, patch);
    set((state) => ({
      channels: upsertChannelList(state.channels, next).sort(channelSort),
    }));
  },

  removeChannel: async (channelId) => {
    await deleteChannel(channelId);

    set((state) => {
      const channels = state.channels.filter((channel) => channel.id !== channelId);
      const activeChannelId = state.activeChannelId === channelId ? channels[0]?.id ?? null : state.activeChannelId;
      const channelMessages = { ...state.channelMessages };
      const channelThreads = { ...state.channelThreads };
      delete channelMessages[channelId];
      delete channelThreads[channelId];

      return {
        channels,
        activeChannelId,
        channelMessages,
        channelThreads,
      };
    });

    const nextActiveChannel = get().activeChannelId;
    if (nextActiveChannel) {
      await get().selectChannel(nextActiveChannel);
    }
  },

  openThreadFromMessage: async (parentMessageId: string) => {
    const parent = await getMessageById(parentMessageId);
    if (!parent) {
      return null;
    }

    let thread = await getThreadByParentMessage(parentMessageId);
    if (!thread) {
      thread = await createThread({
        channelId: parent.channelId,
        parentMessageId,
        title: deriveThreadTitleFromMessage(parent),
      });
    }

    set({ activeChannelId: parent.channelId, openThreadId: thread.id });

    await Promise.all([
      get().loadThreadMessages(thread.id),
      (async () => {
        const threads = await listThreadsByChannel(parent.channelId);
        set((state) => ({
          channelThreads: {
            ...state.channelThreads,
            [parent.channelId]: threads,
          },
        }));
      })(),
    ]);

    return thread;
  },

  closeThread: () => {
    set({ openThreadId: null });
  },

  loadThreadMessages: async (threadId: string) => {
    const messages = await listMessagesByThread(threadId);
    set((state) => ({
      threadMessages: {
        ...state.threadMessages,
        [threadId]: messages,
      },
    }));
  },

  addMessage: async (message, options) => {
    await upsertMessage(message, options);

    const { incrementUnread = false } = options ?? {};
    set((state) => {
      const nextChannels = state.channels.map((channel) => {
        if (channel.id !== message.channelId) {
          return channel;
        }

        const nextUnread = incrementUnread ? (channel.unreadCount ?? 0) + 1 : (channel.unreadCount ?? 0);
        return {
          ...channel,
          lastMessageAt: message.timestamp,
          unreadCount: nextUnread,
        };
      });

      const channelMessages = { ...state.channelMessages };
      const channelThreads = { ...state.channelThreads };
      const threadMessages = { ...state.threadMessages };

      if (message.threadId) {
        const currentThreadMessages = threadMessages[message.threadId] ?? [];
        threadMessages[message.threadId] = upsertMessageList(currentThreadMessages, message);

        const existingThreads = channelThreads[message.channelId] ?? [];
        const currentThread = existingThreads.find((thread) => thread.id === message.threadId);
        const nextThread: ChatThread = currentThread
          ? {
              ...currentThread,
              messageCount: (currentThread.messageCount ?? 0) + 1,
              lastMessageAt: message.timestamp,
            }
          : {
              id: message.threadId,
              channelId: message.channelId,
              parentMessageId: options?.parentMessageId ?? message.replyTo ?? message.id,
              title: options?.threadTitle ?? 'Thread',
              messageCount: 1,
              lastMessageAt: message.timestamp,
              messages: [],
            };
        channelThreads[message.channelId] = upsertThreadList(existingThreads, nextThread);
      } else {
        const currentChannelMessages = channelMessages[message.channelId] ?? [];
        channelMessages[message.channelId] = upsertMessageList(currentChannelMessages, message);
      }

      return {
        channels: nextChannels,
        channelMessages,
        channelThreads,
        threadMessages,
      };
    });

    if (message.threadId) {
      try {
        const threads = await listThreadsByChannel(message.channelId);
        set((state) => ({
          channelThreads: {
            ...state.channelThreads,
            [message.channelId]: threads,
          },
        }));
      } catch {
        // Ignore thread refresh failures.
      }
    }
  },

  patchMessageStatus: async (messageId, status) => {
    await updateMessageStatus(messageId, status);

    set((state) => {
      const channelMessages: Record<string, ChatMessage[]> = {};
      for (const [channelId, messages] of Object.entries(state.channelMessages)) {
        channelMessages[channelId] = messages.map((message) =>
          message.id === messageId
            ? {
                ...message,
                status,
              }
            : message
        );
      }

      const threadMessages: Record<string, ChatMessage[]> = {};
      for (const [threadId, messages] of Object.entries(state.threadMessages)) {
        threadMessages[threadId] = messages.map((message) =>
          message.id === messageId
            ? {
                ...message,
                status,
              }
            : message
        );
      }

      return {
        channelMessages,
        threadMessages,
      };
    });
  },

  setTyping: (scopeId, agentIds) => {
    set((state) => ({
      typingByScope: {
        ...state.typingByScope,
        [scopeId]: [...new Set(agentIds.map((agentId) => agentId.trim().toLowerCase()).filter(Boolean))],
      },
    }));
  },

  setSelectedAgent: (channelId, agentId) => {
    set((state) => ({
      selectedAgentByChannel: {
        ...state.selectedAgentByChannel,
        [channelId]: agentId,
      },
      selectedModelByChannel: {
        ...state.selectedModelByChannel,
        [channelId]: '',
      },
    }));

    const channel = get().channels.find((candidate) => candidate.id === channelId);
    const agents = agentId === CHAT_ALL_AGENTS_ID ? channel?.agents ?? [] : [agentId];
    void get().loadModelOptions(agents.length > 0 ? agents : ['ada']);
  },

  setSelectedModel: (channelId, modelId) => {
    set((state) => ({
      selectedModelByChannel: {
        ...state.selectedModelByChannel,
        [channelId]: modelId,
      },
    }));
  },

  loadModelOptions: async (agentIds) => {
    const normalized = Array.from(new Set(agentIds.map((agentId) => agentId.trim().toLowerCase()).filter(Boolean)));
    const targetAgents = normalized.length > 0 ? normalized : ['ada'];
    const key = [...targetAgents].sort().join(',');
    if (get().modelOptionsAgentKey === key && get().modelOptions.length > 0) return;
    set({ modelOptionsLoading: true });
    try {
      const param = targetAgents.length === 1
        ? `agent=${encodeURIComponent(targetAgents[0])}`
        : `agents=${encodeURIComponent(targetAgents.join(','))}`;
      const response = await fetch(`/api/chat/models?${param}`);
      if (!response.ok) {
        set({ modelOptionsLoading: false });
        return;
      }
      const data = await response.json() as { models?: unknown[]; agents?: Record<string, { models?: unknown[] }> };
      const explicitModels = Array.isArray(data.models)
        ? data.models.map(normalizeModel).filter(Boolean) as ChatModelOption[]
        : [];
      const perAgentModels = data.agents
        ? Object.values(data.agents).flatMap((entry) => (Array.isArray(entry.models) ? entry.models : [])).map(normalizeModel).filter(Boolean) as ChatModelOption[]
        : [];
      set({
        modelOptions: uniqModels([...explicitModels, ...perAgentModels]),
        modelOptionsAgentKey: key,
        modelOptionsLoading: false,
      });
    } catch {
      set({ modelOptionsLoading: false });
    }
  },
}));

export type {
  ChatCategory,
  ChatChannel,
  ChatMessage,
  ChatMessageStatus,
  ChatThread,
} from '../lib/chat-store';

export async function listCategoryChannels(categoryIds: string[]): Promise<Record<string, ChatChannel[]>> {
  const byCategory: Record<string, ChatChannel[]> = {};

  for (const categoryId of categoryIds) {
    byCategory[categoryId] = await listChannelsByCategory(categoryId);
  }

  return byCategory;
}

