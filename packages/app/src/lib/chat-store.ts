export interface ChatCategory {
  id: string;
  name: string;
  emoji?: string;
  order: number;
  channels?: ChatChannel[];
}

export interface ChatChannel {
  id: string;
  name: string;
  description?: string;
  categoryId: string;
  order: number;
  agents: string[];
  unreadCount?: number;
  lastMessage?: ChatMessage;
  lastMessageAt?: string;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  threadId?: string;
  sender: string;
  senderEmoji?: string;
  content: string;
  model?: string;
  isLocal?: boolean;
  status?: ChatMessageStatus;
  timestamp: string;
  createdAt: string;
  updatedAt?: string;
  replyTo?: string;
}

export type ChatMessageStatus = 'sending' | 'sent' | 'error' | 'offline-queued';

export interface ChatThread {
  id: string;
  channelId: string;
  parentMessageId: string;
  title: string;
  lastMessageAt: string;
  messageCount?: number;
  messages: ChatMessage[];
}

export interface ChatSnapshot {
  categories: ChatCategory[];
  channels: ChatChannel[];
}

const messageCache = new Map<string, ChatMessage>();
const threadByParentCache = new Map<string, ChatThread>();

function queueKey(messageId: string): string {
  return `entity.chat.queue.${messageId}`;
}

function readQueueStorage(): ChatMessage[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const messages: ChatMessage[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith('entity.chat.queue.')) continue;

    try {
      const parsed = JSON.parse(window.localStorage.getItem(key) ?? '{}') as ChatMessage;
      if (parsed?.status === 'offline-queued') {
        messages.push(parsed);
      }
    } catch {
      // ignore malformed queue entry
    }
  }

  return messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let errorMessage = `Request failed (${response.status})`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (typeof payload?.error === 'string' && payload.error.trim()) {
        errorMessage = payload.error;
      }
    } catch {
      // ignore
    }
    throw new Error(errorMessage);
  }

  return (await response.json()) as T;
}

function cacheMessages(messages: ChatMessage[]): void {
  for (const message of messages) {
    messageCache.set(message.id, message);
  }
}

export async function createCategory(input: { name: string; emoji?: string; order?: number }): Promise<ChatCategory> {
  const payload = await requestJson<{ category: ChatCategory }>('/api/chat/categories', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  return payload.category;
}

export async function createChannel(input: { name: string; categoryId?: string; description?: string; agents?: string[]; order?: number }): Promise<ChatChannel> {
  const payload = await requestJson<{ channel: ChatChannel }>('/api/chat/channels', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  return payload.channel;
}

export async function createThread(input: { channelId: string; parentMessageId: string; title?: string }): Promise<ChatThread> {
  const payload = await requestJson<{ thread: ChatThread }>('/api/chat/threads', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  threadByParentCache.set(payload.thread.parentMessageId, payload.thread);
  return payload.thread;
}

export async function deleteChannel(id: string): Promise<void> {
  await requestJson<{ success: boolean }>(`/api/chat/channels/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function ensureDefaultChatSetup(): Promise<ChatSnapshot> {
  return requestJson<ChatSnapshot>('/api/chat/setup', { method: 'POST' });
}

export async function loadInitialChatSnapshot(
  setup: () => Promise<ChatSnapshot> = ensureDefaultChatSetup,
  list: () => Promise<ChatSnapshot> = listChatSnapshot,
): Promise<ChatSnapshot> {
  try {
    return await setup();
  } catch {
    return list();
  }
}

export async function getMessageById(id: string): Promise<ChatMessage | undefined> {
  const cached = messageCache.get(id);
  if (cached) return cached;

  try {
    const payload = await requestJson<{ message: ChatMessage }>(`/api/chat/messages/${encodeURIComponent(id)}`);
    messageCache.set(payload.message.id, payload.message);
    return payload.message;
  } catch {
    return undefined;
  }
}

export async function getThreadByParentMessage(parentMessageId: string): Promise<ChatThread | undefined> {
  const cached = threadByParentCache.get(parentMessageId);
  if (cached) return cached;

  try {
    const payload = await requestJson<{ thread: ChatThread }>(`/api/chat/threads/by-parent/${encodeURIComponent(parentMessageId)}`);
    threadByParentCache.set(payload.thread.parentMessageId, payload.thread);
    return payload.thread;
  } catch {
    return undefined;
  }
}

export async function listChannelsByCategory(categoryId: string): Promise<ChatChannel[]> {
  const snapshot = await listChatSnapshot();
  return snapshot.channels.filter((channel) => channel.categoryId === categoryId);
}

export async function listChatSnapshot(): Promise<ChatSnapshot> {
  return requestJson<ChatSnapshot>('/api/chat/channels');
}

export async function listMessagesByChannel(channelId: string): Promise<ChatMessage[]> {
  const payload = await requestJson<{ messages: ChatMessage[] }>(`/api/chat/channels/${encodeURIComponent(channelId)}/messages`);
  cacheMessages(payload.messages);
  return payload.messages;
}

export async function listMessagesByThread(threadId: string): Promise<ChatMessage[]> {
  const payload = await requestJson<{ messages: ChatMessage[] }>(`/api/chat/threads/${encodeURIComponent(threadId)}/messages`);
  cacheMessages(payload.messages);
  return payload.messages;
}

export async function listThreadsByChannel(channelId: string): Promise<ChatThread[]> {
  const payload = await requestJson<{ threads: ChatThread[] }>(`/api/chat/channels/${encodeURIComponent(channelId)}/threads`);
  for (const thread of payload.threads) {
    threadByParentCache.set(thread.parentMessageId, thread);
  }
  return payload.threads;
}

export async function markChannelRead(channelId: string): Promise<void> {
  await requestJson<{ success: boolean }>(`/api/chat/channels/${encodeURIComponent(channelId)}/read`, {
    method: 'POST',
  });
}

export async function upsertMessage(msg: Partial<ChatMessage> & { channelId: string; content: string; sender: string }, _options?: Record<string, unknown>): Promise<ChatMessage> {
  const now = new Date().toISOString();
  const message: ChatMessage = {
    id: msg.id ?? crypto.randomUUID(),
    channelId: msg.channelId,
    content: msg.content,
    sender: msg.sender,
    senderEmoji: msg.senderEmoji,
    model: msg.model,
    isLocal: msg.isLocal,
    status: msg.status ?? 'sent',
    timestamp: msg.timestamp ?? msg.createdAt ?? now,
    createdAt: msg.createdAt ?? now,
    updatedAt: msg.updatedAt,
    threadId: msg.threadId,
    replyTo: msg.replyTo,
  };

  messageCache.set(message.id, message);

  if (typeof window !== 'undefined') {
    if (message.status === 'offline-queued') {
      window.localStorage.setItem(queueKey(message.id), JSON.stringify(message));
    } else {
      window.localStorage.removeItem(queueKey(message.id));
    }
  }

  return message;
}

export async function updateChannel(id: string, updates: Partial<ChatChannel>): Promise<ChatChannel> {
  const payload = await requestJson<{ channel: ChatChannel }>(`/api/chat/channels/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });

  return payload.channel;
}

export async function updateMessageStatus(id: string, status: ChatMessageStatus): Promise<void> {
  const current = messageCache.get(id);
  if (current) {
    const next = { ...current, status };
    messageCache.set(id, next);

    if (typeof window !== 'undefined') {
      if (status === 'offline-queued') {
        window.localStorage.setItem(queueKey(id), JSON.stringify(next));
      } else {
        window.localStorage.removeItem(queueKey(id));
      }
    }
  }
}

export function formatRelativeTime(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export async function listQueuedMessages(limit?: number): Promise<ChatMessage[]> {
  const all = readQueueStorage();
  if (typeof limit === 'number' && limit > 0) {
    return all.slice(0, limit);
  }
  return all;
}
