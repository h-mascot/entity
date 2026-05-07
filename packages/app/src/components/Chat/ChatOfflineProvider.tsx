import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  CHAT_AGENT_OPTIONS,
  CHAT_ALL_AGENTS_ID,
  useChat,
  type ChatChannel,
  type ChatMessage,
  type ChatModelOption,
} from '../../hooks/useChat';
import { listQueuedMessages } from '../../lib/chat-store';

interface OllamaTagsResponse {
  models?: Array<{ name?: string }>;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface ServerChatSendResponse {
  message?: {
    id?: string;
    channelId?: string;
    threadId?: string;
    sender?: string;
    senderEmoji?: string;
    content?: string;
    model?: string;
    isLocal?: boolean;
    status?: string;
    timestamp?: string;
    createdAt?: string;
    replyTo?: string;
  };
  messages?: Array<{
    id?: string;
    channelId?: string;
    threadId?: string;
    sender?: string;
    senderEmoji?: string;
    content?: string;
    model?: string;
    isLocal?: boolean;
    status?: string;
    timestamp?: string;
    createdAt?: string;
    replyTo?: string;
  }>;
}

export interface ChatSendInput {
  channel: ChatChannel;
  content: string;
  threadId?: string;
  parentMessageId?: string;
  threadTitle?: string;
  targetAgentId: string;
  modelId?: string;
}

interface ChatTransportContextValue {
  cloudAvailable: boolean;
  localModel: string;
  sendMessage: (input: ChatSendInput) => Promise<void>;
  statusLabel: (agentId: string, modelId?: string) => string;
}

const DEFAULT_LOCAL_MODEL = 'qwen2.5-coder:7b';
const SERVER_CHAT_TIMEOUT_MS = 90_000;

const ChatTransportContext = createContext<ChatTransportContextValue | null>(null);

function createMessageId(prefix = 'msg'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 12_000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  return fetch(url, { ...init, signal: controller.signal }).finally(() => {
    window.clearTimeout(timeoutId);
  });
}

function normalizeAssistantText(payload: ChatCompletionResponse): string {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    return '';
  }
  return content.trim();
}

function findAgent(agentId: string): { id: string; name: string; emoji: string } {
  const normalized = agentId.trim().toLowerCase();
  const found = CHAT_AGENT_OPTIONS.find((agent) => agent.id === normalized);
  if (found) {
    return found;
  }
  return {
    id: normalized || 'agent',
    name: normalized || 'Agent',
    emoji: '🤖',
  };
}

function deriveTargets(channel: ChatChannel, targetAgentId: string): string[] {
  const normalized = targetAgentId.trim().toLowerCase();
  if (normalized === CHAT_ALL_AGENTS_ID) {
    return CHAT_AGENT_OPTIONS.map((agent) => agent.id);
  }

  return [normalized || 'ada'];
}

function normalizeServerMessages(payload: ServerChatSendResponse): ChatMessage[] {
  const list = Array.isArray(payload.messages) ? payload.messages : [];

  return list
    .map((row) => {
      const content = typeof row.content === 'string' ? row.content.trim() : '';
      if (!content) {
        return null;
      }

      return {
        id: typeof row.id === 'string' && row.id.trim() ? row.id.trim() : createMessageId('msg'),
        channelId: typeof row.channelId === 'string' && row.channelId.trim() ? row.channelId.trim() : '',
        threadId: typeof row.threadId === 'string' && row.threadId.trim() ? row.threadId.trim() : undefined,
        sender: typeof row.sender === 'string' && row.sender.trim() ? row.sender.trim().toLowerCase() : 'assistant',
        senderEmoji: typeof row.senderEmoji === 'string' ? row.senderEmoji : undefined,
        content,
        model: typeof row.model === 'string' ? row.model : undefined,
        isLocal: typeof row.isLocal === 'boolean' ? row.isLocal : undefined,
        status: row.status === 'sending' || row.status === 'error' || row.status === 'offline-queued' ? row.status : 'sent',
        timestamp: typeof row.timestamp === 'string' ? row.timestamp : new Date().toISOString(),
        createdAt: typeof row.createdAt === 'string' ? row.createdAt : new Date().toISOString(),
        replyTo: typeof row.replyTo === 'string' ? row.replyTo : undefined,
      };
    })
    .filter((entry) => entry !== null) as ChatMessage[];
}

function getModelOption(modelId?: string): ChatModelOption | null {
  if (!modelId) {
    return null;
  }

  const normalized = modelId.trim();
  if (!normalized) {
    return null;
  }

  return useChat.getState().modelOptions.find((model) => model.id === normalized) ?? null;
}

function toConversationHistory(messages: ChatMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .filter((message) => Boolean(message.content.trim()))
    .slice(-18)
    .map((message) => ({
      role: message.sender === 'user' ? 'user' : 'assistant',
      content: message.content,
    }));
}

async function resolveOllamaModel(): Promise<string> {
  try {
    const ollamaUrl = (import.meta.env.VITE_OLLAMA_BASE_URL as string | undefined) || 'http://localhost:11434';
    const response = await fetchWithTimeout(`${ollamaUrl}/api/tags`, { method: 'GET' }, 3500);
    if (!response.ok) {
      return DEFAULT_LOCAL_MODEL;
    }

    const payload = (await response.json()) as OllamaTagsResponse;
    const names = Array.isArray(payload.models)
      ? payload.models
          .map((model) => (typeof model?.name === 'string' ? model.name.trim() : ''))
          .filter((name) => Boolean(name))
      : [];

    if (names.length === 0) {
      return DEFAULT_LOCAL_MODEL;
    }

    if (names.includes(DEFAULT_LOCAL_MODEL)) {
      return DEFAULT_LOCAL_MODEL;
    }

    const preferred = names.find((name) => name.toLowerCase().includes('qwen2.5-coder'));
    return preferred ?? names[0];
  } catch {
    return DEFAULT_LOCAL_MODEL;
  }
}

async function requestLocalAgentReply(params: {
  model: string;
  agentId: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<string> {
  const agent = findAgent(params.agentId);
  const ollamaUrl = (import.meta.env.VITE_OLLAMA_BASE_URL as string | undefined) || 'http://localhost:11434';
  const response = await fetchWithTimeout(
    `${ollamaUrl}/v1/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        stream: false,
        messages: [
          {
            role: 'system',
            content: `You are ${agent.name} (${agent.emoji}) in Entity Mission Control chat. Reply in concise markdown and stay on topic.`,
          },
          ...params.history,
        ],
      }),
    },
    20_000
  );

  if (!response.ok) {
    throw new Error('Local model unavailable.');
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  const text = normalizeAssistantText(payload);
  if (!text) {
    throw new Error('Local model returned an empty response.');
  }

  return text;
}

async function requestServerAgentReply(params: {
  channelId: string;
  threadId?: string;
  parentMessageId?: string;
  content: string;
  targetAgentId: string;
  agents: string[];
  model?: string;
  messageId?: string;
}): Promise<ChatMessage[]> {
  const response = await fetchWithTimeout(
    '/api/chat/send',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channelId: params.channelId,
        threadId: params.threadId,
        parentMessageId: params.parentMessageId,
        content: params.content,
        targetAgent: params.targetAgentId,
        agents: params.agents,
        model: params.model,
        messageId: params.messageId,
      }),
    },
    SERVER_CHAT_TIMEOUT_MS
  );

  if (!response.ok) {
    throw new Error('Server chat route unavailable.');
  }

  const payload = (await response.json()) as ServerChatSendResponse;
  const messages = normalizeServerMessages(payload);
  if (messages.length === 0) {
    throw new Error('Server returned no chat messages.');
  }

  return messages;
}

export function ChatOfflineProvider({ children }: { children: ReactNode }) {
  const addMessage = useChat((state) => state.addMessage);
  const patchMessageStatus = useChat((state) => state.patchMessageStatus);
  const setTyping = useChat((state) => state.setTyping);

  const [browserOnline, setBrowserOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [cloudAvailable, setCloudAvailable] = useState(false);
  const [localModel, setLocalModel] = useState(DEFAULT_LOCAL_MODEL);
  const localModelRef = useRef(DEFAULT_LOCAL_MODEL);

  const refreshCloudAvailability = useCallback(async () => {
    if (!browserOnline) {
      setCloudAvailable(false);
      return;
    }

    try {
      const response = await fetchWithTimeout('/api/chat/channels', { method: 'GET' }, 3500);
      setCloudAvailable(response.ok);
    } catch {
      setCloudAvailable(false);
    }
  }, [browserOnline]);

  const refreshLocalModel = useCallback(async () => {
    const nextModel = await resolveOllamaModel();
    localModelRef.current = nextModel;
    setLocalModel(nextModel);
  }, []);

  useEffect(() => {
    void refreshLocalModel();
  }, [refreshLocalModel]);

  useEffect(() => {
    const handleConnectivity = () => {
      setBrowserOnline(window.navigator.onLine);
    };

    window.addEventListener('online', handleConnectivity);
    window.addEventListener('offline', handleConnectivity);

    return () => {
      window.removeEventListener('online', handleConnectivity);
      window.removeEventListener('offline', handleConnectivity);
    };
  }, []);

  useEffect(() => {
    void refreshCloudAvailability();
  }, [refreshCloudAvailability]);

  useEffect(() => {
    if (!browserOnline || !cloudAvailable) {
      return;
    }

    let cancelled = false;

    const syncQueuedMessages = async () => {
      const queued = await listQueuedMessages(120);

      for (const message of queued) {
        if (cancelled) {
          return;
        }

        try {
          const response = await fetchWithTimeout(
            '/api/chat/send',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                channelId: message.channelId,
                threadId: message.threadId,
                content: message.content,
                messageId: message.id,
                sender: message.sender,
                timestamp: message.timestamp,
                model: message.model,
                isLocal: message.isLocal,
              }),
            },
            8000
          );

          if (!response.ok) {
            break;
          }

          await patchMessageStatus(message.id, 'sent');
        } catch {
          break;
        }
      }
    };

    void syncQueuedMessages();
    const intervalId = window.setInterval(() => {
      void syncQueuedMessages();
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [browserOnline, cloudAvailable, patchMessageStatus]);

  const sendMessage = useCallback(
    async (input: ChatSendInput) => {
      const content = input.content.trim();
      if (!content) {
        return;
      }

      const scopeId = input.threadId ?? input.channel.id;
      const agents = deriveTargets(input.channel, input.targetAgentId);
      const now = new Date().toISOString();
      const selectedModel = getModelOption(input.modelId);
      const preferCloud = browserOnline && cloudAvailable && !selectedModel?.isLocal;
      const explicitCloudModel = Boolean(selectedModel && !selectedModel.isLocal);

      const userMessage: ChatMessage = {
        id: createMessageId('msg'),
        channelId: input.channel.id,
        threadId: input.threadId,
        sender: 'user',
        senderEmoji: '🧑',
        content,
        timestamp: now,
        createdAt: now,
        replyTo: input.parentMessageId,
        status: preferCloud ? 'sending' : 'offline-queued',
      };

      await addMessage(userMessage, {
        parentMessageId: input.parentMessageId,
        threadTitle: input.threadTitle,
      });

      setTyping(scopeId, agents);

      try {
        const state = useChat.getState();
        const channelHistory = state.channelMessages[input.channel.id] ?? [];
        const threadHistory = input.threadId ? state.threadMessages[input.threadId] ?? [] : [];
        const parentMessage =
          input.threadId && input.parentMessageId
            ? channelHistory.find((message) => message.id === input.parentMessageId)
            : null;
        const baseHistory = input.threadId
          ? [
              ...(parentMessage ? [parentMessage] : []),
              ...threadHistory,
              userMessage,
            ]
          : [...channelHistory, userMessage];
        const conversationHistory = toConversationHistory(baseHistory);

        try {
          if (preferCloud) {
            const serverMessages = await requestServerAgentReply({
              channelId: input.channel.id,
              threadId: input.threadId,
              parentMessageId: input.parentMessageId,
              content,
              targetAgentId: input.targetAgentId,
              agents,
              model: selectedModel?.isLocal ? undefined : selectedModel?.id,
              messageId: userMessage.id,
            });

            await patchMessageStatus(userMessage.id, 'sent');

            for (const message of serverMessages) {
              const sender = findAgent(message.sender);
              const agentMessage: ChatMessage = {
                id: message.id,
                channelId: message.channelId || input.channel.id,
                threadId: message.threadId ?? input.threadId,
                sender: sender.id,
                senderEmoji: message.senderEmoji ?? sender.emoji,
                content: message.content,
                timestamp: message.timestamp,
                createdAt: message.createdAt,
                replyTo: message.replyTo ?? input.parentMessageId,
                status: message.status,
                model: message.model,
                isLocal: message.isLocal,
              };

              await addMessage(agentMessage, {
                parentMessageId: input.parentMessageId,
                threadTitle: input.threadTitle,
              });
            }

            return;
          }
        } catch {
          await patchMessageStatus(userMessage.id, 'offline-queued');

          if (explicitCloudModel) {
            for (const agentId of agents) {
              const sender = findAgent(agentId);
              const errorMessage: ChatMessage = {
                id: createMessageId('msg'),
                channelId: input.channel.id,
                threadId: input.threadId,
                sender: sender.id,
                senderEmoji: sender.emoji,
                content: 'Cloud reply unavailable.',
                timestamp: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                replyTo: input.parentMessageId,
                status: 'error',
                model: selectedModel?.id,
                isLocal: false,
              };

              await addMessage(errorMessage, {
                parentMessageId: input.parentMessageId,
                threadTitle: input.threadTitle,
              });
            }

            return;
          }
        }

        const model = selectedModel?.isLocal
          ? selectedModel.id.replace(/^ollama\//, '')
          : await resolveOllamaModel();
        localModelRef.current = model;
        setLocalModel(model);

        for (const agentId of agents) {
          const sender = findAgent(agentId);

          try {
            const reply = await requestLocalAgentReply({
              model,
              agentId,
              history: conversationHistory,
            });

            const agentMessage: ChatMessage = {
              id: createMessageId('msg'),
              channelId: input.channel.id,
              threadId: input.threadId,
              sender: sender.id,
              senderEmoji: sender.emoji,
              content: reply,
              timestamp: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              replyTo: input.parentMessageId,
              status: 'offline-queued',
              model,
              isLocal: true,
            };

            await addMessage(agentMessage, {
              parentMessageId: input.parentMessageId,
              threadTitle: input.threadTitle,
            });
          } catch {
            const errorMessage: ChatMessage = {
              id: createMessageId('msg'),
              channelId: input.channel.id,
              threadId: input.threadId,
              sender: sender.id,
              senderEmoji: sender.emoji,
              content: 'AI unavailable offline.',
              timestamp: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              replyTo: input.parentMessageId,
              status: 'error',
              model,
              isLocal: true,
            };

            await addMessage(errorMessage, {
              parentMessageId: input.parentMessageId,
              threadTitle: input.threadTitle,
            });
          }
        }
      } finally {
        setTyping(scopeId, []);
      }
    },
    [addMessage, browserOnline, cloudAvailable, patchMessageStatus, setTyping]
  );

  const statusLabel = useCallback(
    (agentId: string, modelId?: string) => {
      const selectedModel = getModelOption(modelId);
      if (selectedModel) {
        if (selectedModel.isLocal) {
          return `Local - ${selectedModel.name}`;
        }

        if (cloudAvailable && browserOnline) {
          return `Online - ${selectedModel.name}`;
        }

        return `Offline - ${selectedModel.name} unavailable`;
      }

      if (cloudAvailable && browserOnline) {
        if (agentId === CHAT_ALL_AGENTS_ID) {
          return 'Online - All Agents (Cloud)';
        }
        const agent = findAgent(agentId);
        return `Online - ${agent.name} (Cloud)`;
      }
      return 'Offline - Ollama (Local)';
    },
    [browserOnline, cloudAvailable]
  );

  const value = useMemo<ChatTransportContextValue>(
    () => ({
      cloudAvailable: browserOnline && cloudAvailable,
      localModel,
      sendMessage,
      statusLabel,
    }),
    [browserOnline, cloudAvailable, localModel, sendMessage, statusLabel]
  );

  return <ChatTransportContext.Provider value={value}>{children}</ChatTransportContext.Provider>;
}

export function useChatTransport(): ChatTransportContextValue {
  const context = useContext(ChatTransportContext);
  if (!context) {
    throw new Error('useChatTransport must be used within ChatOfflineProvider.');
  }
  return context;
}
