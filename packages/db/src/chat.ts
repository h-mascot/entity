import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { getEntityDatabase } from './entity-db';

export interface ChatCategoryRecord {
  id: string;
  name: string;
  emoji: string | null;
  order: number;
  created_at: string;
}

export interface ChatChannelRecord {
  id: string;
  name: string;
  description: string | null;
  category_id: string;
  order: number;
  agents: string[];
  unread_count: number;
  last_message_at: string | null;
  created_at: string;
}

export interface ChatMessageRecord {
  id: string;
  channel_id: string;
  thread_id: string | null;
  sender: string;
  sender_emoji: string | null;
  content: string;
  model: string | null;
  is_local: boolean;
  status: string;
  timestamp: string;
  created_at: string;
  updated_at: string;
  reply_to: string | null;
}

export interface ChatThreadRecord {
  id: string;
  channel_id: string;
  parent_message_id: string;
  title: string;
  message_count: number;
  last_message_at: string;
  created_at: string;
}

export interface CreateChatCategoryInput {
  id?: string;
  name: string;
  emoji?: string;
  order?: number;
}

export interface CreateChatChannelInput {
  id?: string;
  name: string;
  description?: string;
  category_id: string;
  order?: number;
  agents?: string[];
}

export interface UpdateChatChannelInput {
  name?: string;
  description?: string;
  category_id?: string;
  order?: number;
  agents?: string[];
}

export interface CreateChatMessageInput {
  id?: string;
  channel_id: string;
  thread_id?: string;
  sender: string;
  sender_emoji?: string;
  content: string;
  model?: string;
  is_local?: boolean;
  status?: string;
  timestamp?: string;
  reply_to?: string;
}

export interface UpdateChatMessageStatusInput {
  status: string;
}

export interface CreateChatThreadInput {
  id?: string;
  channel_id: string;
  parent_message_id: string;
  title: string;
}

export interface ChatRepository {
  listCategories: () => ChatCategoryRecord[];
  createCategory: (input: CreateChatCategoryInput) => ChatCategoryRecord;
  getCategoryByName: (name: string) => ChatCategoryRecord | undefined;

  listChannels: () => ChatChannelRecord[];
  listChannelsByCategory: (categoryId: string) => ChatChannelRecord[];
  getChannel: (id: string) => ChatChannelRecord | undefined;
  getChannelByName: (name: string) => ChatChannelRecord | undefined;
  createChannel: (input: CreateChatChannelInput) => ChatChannelRecord;
  updateChannel: (id: string, patch: UpdateChatChannelInput) => ChatChannelRecord | undefined;
  deleteChannel: (id: string) => boolean;
  markChannelRead: (id: string) => void;
  touchChannelLastMessage: (id: string, timestamp: string) => void;

  listMessagesByChannel: (channelId: string) => ChatMessageRecord[];
  listMessagesByThread: (threadId: string) => ChatMessageRecord[];
  getMessage: (id: string) => ChatMessageRecord | undefined;
  createMessage: (input: CreateChatMessageInput) => ChatMessageRecord;
  updateMessageStatus: (id: string, patch: UpdateChatMessageStatusInput) => ChatMessageRecord | undefined;

  listThreadsByChannel: (channelId: string) => ChatThreadRecord[];
  getThread: (id: string) => ChatThreadRecord | undefined;
  getThreadByParentMessage: (parentMessageId: string) => ChatThreadRecord | undefined;
  createThread: (input: CreateChatThreadInput) => ChatThreadRecord;
  incrementThreadCount: (id: string, timestamp: string) => void;
}

function normalizeTimestamp(value?: string | null): string {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function parseAgents(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : '')).filter(Boolean);
  }

  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parseAgents(parsed);
  } catch {
    return value.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  }
}

function ensureChatSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      emoji TEXT,
      "order" INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chat_channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      category_id TEXT NOT NULL REFERENCES chat_categories(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL DEFAULT 0,
      agents TEXT NOT NULL DEFAULT '[]',
      unread_count INTEGER NOT NULL DEFAULT 0,
      last_message_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
      thread_id TEXT,
      sender TEXT NOT NULL,
      sender_emoji TEXT,
      content TEXT NOT NULL,
      model TEXT,
      is_local INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'sent',
      timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reply_to TEXT
    );

    CREATE TABLE IF NOT EXISTS chat_threads (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
      parent_message_id TEXT NOT NULL,
      title TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      last_message_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_chat_channels_category_order ON chat_channels(category_id, "order", name);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_ts ON chat_messages(channel_id, timestamp, created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_ts ON chat_messages(thread_id, timestamp, created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_threads_channel_last ON chat_threads(channel_id, last_message_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_threads_parent_message ON chat_threads(parent_message_id);
  `);
}

function mapCategoryRow(row: Record<string, unknown>): ChatCategoryRecord {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    emoji: typeof row.emoji === 'string' ? row.emoji : null,
    order: Number.isFinite(Number(row.order)) ? Number(row.order) : 0,
    created_at: normalizeTimestamp(typeof row.created_at === 'string' ? row.created_at : undefined),
  };
}

function mapChannelRow(row: Record<string, unknown>): ChatChannelRecord {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    description: typeof row.description === 'string' ? row.description : null,
    category_id: String(row.category_id ?? ''),
    order: Number.isFinite(Number(row.order)) ? Number(row.order) : 0,
    agents: parseAgents(row.agents),
    unread_count: Number.isFinite(Number(row.unread_count)) ? Number(row.unread_count) : 0,
    last_message_at: typeof row.last_message_at === 'string' ? normalizeTimestamp(row.last_message_at) : null,
    created_at: normalizeTimestamp(typeof row.created_at === 'string' ? row.created_at : undefined),
  };
}

function mapMessageRow(row: Record<string, unknown>): ChatMessageRecord {
  return {
    id: String(row.id ?? ''),
    channel_id: String(row.channel_id ?? ''),
    thread_id: typeof row.thread_id === 'string' ? row.thread_id : null,
    sender: String(row.sender ?? 'assistant'),
    sender_emoji: typeof row.sender_emoji === 'string' ? row.sender_emoji : null,
    content: String(row.content ?? ''),
    model: typeof row.model === 'string' ? row.model : null,
    is_local: Number(row.is_local) === 1,
    status: typeof row.status === 'string' ? row.status : 'sent',
    timestamp: normalizeTimestamp(typeof row.timestamp === 'string' ? row.timestamp : undefined),
    created_at: normalizeTimestamp(typeof row.created_at === 'string' ? row.created_at : undefined),
    updated_at: normalizeTimestamp(typeof row.updated_at === 'string' ? row.updated_at : undefined),
    reply_to: typeof row.reply_to === 'string' ? row.reply_to : null,
  };
}

function mapThreadRow(row: Record<string, unknown>): ChatThreadRecord {
  return {
    id: String(row.id ?? ''),
    channel_id: String(row.channel_id ?? ''),
    parent_message_id: String(row.parent_message_id ?? ''),
    title: String(row.title ?? 'Thread'),
    message_count: Number.isFinite(Number(row.message_count)) ? Number(row.message_count) : 0,
    last_message_at: normalizeTimestamp(typeof row.last_message_at === 'string' ? row.last_message_at : undefined),
    created_at: normalizeTimestamp(typeof row.created_at === 'string' ? row.created_at : undefined),
  };
}

export function createChatRepository(): ChatRepository {
  const db = getEntityDatabase(ensureChatSchema);

  const listCategoriesStmt = db.prepare('SELECT * FROM chat_categories ORDER BY "order" ASC, name COLLATE NOCASE ASC');
  const getCategoryByNameStmt = db.prepare('SELECT * FROM chat_categories WHERE lower(name) = lower(?)');
  const createCategoryStmt = db.prepare(`
    INSERT INTO chat_categories (id, name, emoji, "order", created_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const getCategoryStmt = db.prepare('SELECT * FROM chat_categories WHERE id = ?');

  const listChannelsStmt = db.prepare('SELECT * FROM chat_channels ORDER BY category_id ASC, "order" ASC, name COLLATE NOCASE ASC');
  const listChannelsByCategoryStmt = db.prepare('SELECT * FROM chat_channels WHERE category_id = ? ORDER BY "order" ASC, name COLLATE NOCASE ASC');
  const getChannelStmt = db.prepare('SELECT * FROM chat_channels WHERE id = ?');
  const getChannelByNameStmt = db.prepare('SELECT * FROM chat_channels WHERE lower(name) = lower(?)');
  const createChannelStmt = db.prepare(`
    INSERT INTO chat_channels (id, name, description, category_id, "order", agents, unread_count, last_message_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, NULL, CURRENT_TIMESTAMP)
  `);
  const deleteChannelStmt = db.prepare('DELETE FROM chat_channels WHERE id = ?');
  const markChannelReadStmt = db.prepare('UPDATE chat_channels SET unread_count = 0 WHERE id = ?');
  const touchChannelStmt = db.prepare('UPDATE chat_channels SET last_message_at = ? WHERE id = ?');
  const incUnreadStmt = db.prepare('UPDATE chat_channels SET unread_count = unread_count + 1 WHERE id = ?');

  const listMessagesByChannelStmt = db.prepare(`
    SELECT * FROM chat_messages
    WHERE channel_id = ? AND (thread_id IS NULL OR thread_id = '')
    ORDER BY datetime(timestamp) ASC, datetime(created_at) ASC, id ASC
  `);
  const listMessagesByThreadStmt = db.prepare(`
    SELECT * FROM chat_messages
    WHERE thread_id = ?
    ORDER BY datetime(timestamp) ASC, datetime(created_at) ASC, id ASC
  `);
  const getMessageStmt = db.prepare('SELECT * FROM chat_messages WHERE id = ?');
  const createMessageStmt = db.prepare(`
    INSERT INTO chat_messages (
      id, channel_id, thread_id, sender, sender_emoji, content, model, is_local, status, timestamp, created_at, updated_at, reply_to
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)
  `);
  const updateMessageStatusStmt = db.prepare('UPDATE chat_messages SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');

  const listThreadsByChannelStmt = db.prepare('SELECT * FROM chat_threads WHERE channel_id = ? ORDER BY datetime(last_message_at) DESC, id DESC');
  const getThreadStmt = db.prepare('SELECT * FROM chat_threads WHERE id = ?');
  const getThreadByParentStmt = db.prepare('SELECT * FROM chat_threads WHERE parent_message_id = ?');
  const createThreadStmt = db.prepare(`
    INSERT INTO chat_threads (id, channel_id, parent_message_id, title, message_count, last_message_at, created_at)
    VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  const incrementThreadStmt = db.prepare('UPDATE chat_threads SET message_count = message_count + 1, last_message_at = ? WHERE id = ?');

  return {
    listCategories: () => (listCategoriesStmt.all() as Array<Record<string, unknown>>).map(mapCategoryRow),

    createCategory: (input) => {
      const name = input.name.trim();
      if (!name) {
        throw new Error('name is required');
      }

      const id = input.id?.trim() || randomUUID();
      createCategoryStmt.run(id, name, input.emoji?.trim() || null, Number(input.order ?? 0));
      const row = getCategoryStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) throw new Error('Failed to create category');
      return mapCategoryRow(row);
    },

    getCategoryByName: (name) => {
      const row = getCategoryByNameStmt.get(name) as Record<string, unknown> | undefined;
      return row ? mapCategoryRow(row) : undefined;
    },

    listChannels: () => (listChannelsStmt.all() as Array<Record<string, unknown>>).map(mapChannelRow),

    listChannelsByCategory: (categoryId) => (listChannelsByCategoryStmt.all(categoryId) as Array<Record<string, unknown>>).map(mapChannelRow),

    getChannel: (id) => {
      const row = getChannelStmt.get(id) as Record<string, unknown> | undefined;
      return row ? mapChannelRow(row) : undefined;
    },

    getChannelByName: (name) => {
      const row = getChannelByNameStmt.get(name) as Record<string, unknown> | undefined;
      return row ? mapChannelRow(row) : undefined;
    },

    createChannel: (input) => {
      const name = input.name.trim();
      if (!name) {
        throw new Error('name is required');
      }

      const id = input.id?.trim() || randomUUID();
      createChannelStmt.run(
        id,
        name,
        input.description?.trim() || null,
        input.category_id,
        Number(input.order ?? 0),
        JSON.stringify(parseAgents(input.agents ?? []))
      );
      const row = getChannelStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) throw new Error('Failed to create channel');
      return mapChannelRow(row);
    },

    updateChannel: (id, patch) => {
      const existing = getChannelStmt.get(id) as Record<string, unknown> | undefined;
      if (!existing) {
        return undefined;
      }

      const fields: string[] = [];
      const values: unknown[] = [];

      if (typeof patch.name === 'string') {
        const normalized = patch.name.trim();
        if (!normalized) throw new Error('name cannot be empty');
        fields.push('name = ?');
        values.push(normalized);
      }

      if (typeof patch.description === 'string') {
        fields.push('description = ?');
        values.push(patch.description.trim() || null);
      }

      if (typeof patch.category_id === 'string') {
        fields.push('category_id = ?');
        values.push(patch.category_id);
      }

      if (typeof patch.order !== 'undefined') {
        fields.push('"order" = ?');
        values.push(Number(patch.order));
      }

      if (Array.isArray(patch.agents)) {
        fields.push('agents = ?');
        values.push(JSON.stringify(parseAgents(patch.agents)));
      }

      if (fields.length === 0) {
        return mapChannelRow(existing);
      }

      values.push(id);
      db.prepare(`UPDATE chat_channels SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      const row = getChannelStmt.get(id) as Record<string, unknown> | undefined;
      return row ? mapChannelRow(row) : undefined;
    },

    deleteChannel: (id) => deleteChannelStmt.run(id).changes > 0,

    markChannelRead: (id) => {
      markChannelReadStmt.run(id);
    },

    touchChannelLastMessage: (id, timestamp) => {
      touchChannelStmt.run(normalizeTimestamp(timestamp), id);
    },

    listMessagesByChannel: (channelId) => (listMessagesByChannelStmt.all(channelId) as Array<Record<string, unknown>>).map(mapMessageRow),

    listMessagesByThread: (threadId) => (listMessagesByThreadStmt.all(threadId) as Array<Record<string, unknown>>).map(mapMessageRow),

    getMessage: (id) => {
      const row = getMessageStmt.get(id) as Record<string, unknown> | undefined;
      return row ? mapMessageRow(row) : undefined;
    },

    createMessage: (input) => {
      const content = input.content.trim();
      if (!content) {
        throw new Error('content is required');
      }

      const id = input.id?.trim() || randomUUID();
      const timestamp = normalizeTimestamp(input.timestamp);
      createMessageStmt.run(
        id,
        input.channel_id,
        input.thread_id?.trim() || null,
        input.sender.trim().toLowerCase(),
        input.sender_emoji?.trim() || null,
        content,
        input.model?.trim() || null,
        input.is_local ? 1 : 0,
        input.status?.trim() || 'sent',
        timestamp,
        input.reply_to?.trim() || null
      );

      const row = getMessageStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) throw new Error('Failed to create message');

      touchChannelStmt.run(timestamp, input.channel_id);
      if ((input.status?.trim() || 'sent') !== 'sent' || input.sender.trim().toLowerCase() !== 'user') {
        incUnreadStmt.run(input.channel_id);
      }

      return mapMessageRow(row);
    },

    updateMessageStatus: (id, patch) => {
      updateMessageStatusStmt.run(patch.status, id);
      const row = getMessageStmt.get(id) as Record<string, unknown> | undefined;
      return row ? mapMessageRow(row) : undefined;
    },

    listThreadsByChannel: (channelId) => (listThreadsByChannelStmt.all(channelId) as Array<Record<string, unknown>>).map(mapThreadRow),

    getThread: (id) => {
      const row = getThreadStmt.get(id) as Record<string, unknown> | undefined;
      return row ? mapThreadRow(row) : undefined;
    },

    getThreadByParentMessage: (parentMessageId) => {
      const row = getThreadByParentStmt.get(parentMessageId) as Record<string, unknown> | undefined;
      return row ? mapThreadRow(row) : undefined;
    },

    createThread: (input) => {
      const id = input.id?.trim() || randomUUID();
      const title = input.title.trim() || 'Thread';
      createThreadStmt.run(id, input.channel_id, input.parent_message_id, title);
      const row = getThreadStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) throw new Error('Failed to create thread');
      return mapThreadRow(row);
    },

    incrementThreadCount: (id, timestamp) => {
      incrementThreadStmt.run(normalizeTimestamp(timestamp), id);
    },
  };
}
