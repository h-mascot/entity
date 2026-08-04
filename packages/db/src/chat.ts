import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { getEntityDatabase } from './entity-db';
import type { ObjectRef } from './index';

export interface ChatCategoryRecord {
  id: string;
  name: string;
  emoji: string | null;
  order: number;
  org_id: string | null;
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
  linked_object_refs: ObjectRef[];
  org_id: string | null;
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
  org_id: string | null;
}

export interface ChatThreadRecord {
  id: string;
  channel_id: string;
  parent_message_id: string;
  title: string;
  message_count: number;
  last_message_at: string;
  linked_object_refs: ObjectRef[];
  org_id: string | null;
  created_at: string;
}

export interface CreateChatCategoryInput {
  id?: string;
  name: string;
  emoji?: string;
  order?: number;
  /**
   * R4: durable org ownership. Resolved by the route from the authenticated
   * principal's scope; caller-supplied values are ignored for authority.
   * null/undefined = workspace-global (trusted/admin bootstrap only).
   */
  org_id?: string | null;
}

export interface CreateChatChannelInput {
  id?: string;
  name: string;
  description?: string;
  category_id: string;
  order?: number;
  agents?: string[];
  /** R4: inherited from the parent category; ignored when caller-supplied. */
  org_id?: string | null;
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
  /** R4: inherited from the resolved channel; ignored when caller-supplied. */
  org_id?: string | null;
}

export interface UpdateChatMessageStatusInput {
  status: string;
}

export interface CreateChatThreadInput {
  id?: string;
  channel_id: string;
  parent_message_id: string;
  title: string;
  /** R4: inherited from the parent channel; ignored when caller-supplied. */
  org_id?: string | null;
}

/**
 * R4: the resolved tenant scope passed to every chat repository method.
 * - `undefined` (omitted): the TRUSTED service/admin path. Queries are
 *   unfiltered (workspace-global) and preserve the pre-R4 behavior.
 * - a `string` org id: a resolved CUSTOMER principal scope. Every query is
 *   constrained to `org_id = <orgId>` so foreign and legacy-unowned rows
 *   (org_id IS NULL) are never disclosed and never mutated.
 */
export type ChatOrgScope = string | undefined;

export interface ChatRepository {
  listCategories: (orgId?: ChatOrgScope) => ChatCategoryRecord[];
  createCategory: (input: CreateChatCategoryInput) => ChatCategoryRecord;
  getCategoryByName: (name: string, orgId?: ChatOrgScope) => ChatCategoryRecord | undefined;
  getCategory: (id: string, orgId?: ChatOrgScope) => ChatCategoryRecord | undefined;

  listChannels: (orgId?: ChatOrgScope) => ChatChannelRecord[];
  listChannelsByCategory: (categoryId: string, orgId?: ChatOrgScope) => ChatChannelRecord[];
  getChannel: (id: string, orgId?: ChatOrgScope) => ChatChannelRecord | undefined;
  getChannelByName: (name: string, orgId?: ChatOrgScope) => ChatChannelRecord | undefined;
  createChannel: (input: CreateChatChannelInput) => ChatChannelRecord;
  updateChannel: (id: string, patch: UpdateChatChannelInput, orgId?: ChatOrgScope) => ChatChannelRecord | undefined;
  deleteChannel: (id: string, orgId?: ChatOrgScope) => boolean;
  markChannelRead: (id: string, orgId?: ChatOrgScope) => void;
  touchChannelLastMessage: (id: string, timestamp: string) => void;
  linkChannelObject: (id: string, objectRef: ObjectRef, orgId?: ChatOrgScope) => ChatChannelRecord | undefined;
  listChannelObjectRefs: (id: string, orgId?: ChatOrgScope) => ObjectRef[];

  listMessagesByChannel: (channelId: string, orgId?: ChatOrgScope) => ChatMessageRecord[];
  listMessagesByThread: (threadId: string, orgId?: ChatOrgScope) => ChatMessageRecord[];
  getMessage: (id: string, orgId?: ChatOrgScope) => ChatMessageRecord | undefined;
  createMessage: (input: CreateChatMessageInput) => ChatMessageRecord;
  updateMessageStatus: (id: string, patch: UpdateChatMessageStatusInput) => ChatMessageRecord | undefined;

  listThreadsByChannel: (channelId: string, orgId?: ChatOrgScope) => ChatThreadRecord[];
  getThread: (id: string, orgId?: ChatOrgScope) => ChatThreadRecord | undefined;
  getThreadByParentMessage: (parentMessageId: string, orgId?: ChatOrgScope) => ChatThreadRecord | undefined;
  createThread: (input: CreateChatThreadInput) => ChatThreadRecord;
  incrementThreadCount: (id: string, timestamp: string) => void;
  linkThreadObject: (id: string, objectRef: ObjectRef, orgId?: ChatOrgScope) => ChatThreadRecord | undefined;
  listThreadObjectRefs: (id: string, orgId?: ChatOrgScope) => ObjectRef[];
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

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>)
    .some((entry) => entry.name === column);
}

function normalizeObjectRef(value: ObjectRef): ObjectRef {
  const objectType = String(value.object_type ?? '').trim();
  const objectId = String(value.object_id ?? '').trim();
  const linkRole = String(value.link_role ?? '').trim();
  if (!objectType || !objectId || !linkRole) {
    throw new Error('ObjectRef requires object_type, object_id, and link_role');
  }
  return { object_type: objectType, object_id: objectId, link_role: linkRole };
}

function parseObjectRefs(value: unknown): ObjectRef[] {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeObjectRef(entry as ObjectRef));
  }
  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((entry) => normalizeObjectRef(entry as ObjectRef)) : [];
  } catch {
    return [];
  }
}

function appendObjectRef(current: ObjectRef[], objectRef: ObjectRef): ObjectRef[] {
  const normalized = normalizeObjectRef(objectRef);
  const exists = current.some((entry) =>
    entry.object_type === normalized.object_type &&
    entry.object_id === normalized.object_id &&
    entry.link_role === normalized.link_role
  );
  return exists ? current : [...current, normalized];
}

/**
 * R4: detect a legacy `chat_*` table created by the pre-R4 schema, i.e. one
 * whose `name` column carries an inline `UNIQUE` constraint (global uniqueness)
 * and which therefore cannot host per-org chat rows. Returns the CREATE TABLE
 * sql when the legacy inline-UNIQUE form is present, else null.
 */
function legacyGlobalUniqueNameSql(db: Database.Database, table: string): string | null {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table) as { sql?: string } | undefined;
  const sql = row?.sql ?? '';
  if (!sql) return null;
  // Original schema declared `name TEXT NOT NULL UNIQUE`. The new schema uses a
  // separate UNIQUE(org_id, name) index so per-org duplicate names are allowed
  // while cross-org isolation is preserved.
  return /name\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(sql) ? sql : null;
}

/**
 * R4: rebuild a legacy chat table in place to add the `org_id` column and
 * replace the global inline `UNIQUE(name)` with a per-org unique index. The
 * rebuild preserves every existing row (legacy rows become org_id = NULL
 * workspace-global). Foreign-key enforcement is toggled off for the rebuild
 * because SQLite cannot change constraints any other way; ids are preserved so
 * FK relationships remain intact. Idempotent (no-op on the new schema).
 */
function rebuildChatTableForOrgOwnership(
  db: Database.Database,
  table: 'chat_categories' | 'chat_channels',
  createSql: string,
  columnList: string,
): void {
  if (!legacyGlobalUniqueNameSql(db, table)) return;
  const previousForeignKeys = (db.pragma('foreign_keys', { simple: true }) as number | string) === 1;
  if (previousForeignKeys) db.pragma('foreign_keys = OFF');
  try {
    const tmp = `${table}__r4_rebuild`;
    db.exec(`DROP TABLE IF EXISTS ${tmp};`);
    db.exec(createSql.replace(table, tmp));
    db.exec(`INSERT INTO ${tmp} (${columnList}) SELECT ${columnList} FROM ${table};`);
    db.exec(`DROP TABLE ${table};`);
    db.exec(`ALTER TABLE ${tmp} RENAME TO ${table};`);
  } finally {
    if (previousForeignKeys) db.pragma('foreign_keys = ON');
  }
}

function ensureChatSchema(db: Database.Database): void {
  // Fresh tables carry org_id and a separate per-org unique index (no inline
  // global UNIQUE on name). CREATE TABLE IF NOT EXISTS is a no-op on legacy DBs.
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT,
      "order" INTEGER NOT NULL DEFAULT 0,
      org_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chat_channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      category_id TEXT NOT NULL REFERENCES chat_categories(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL DEFAULT 0,
      agents TEXT NOT NULL DEFAULT '[]',
      unread_count INTEGER NOT NULL DEFAULT 0,
      last_message_at TEXT,
      linked_object_refs_json TEXT NOT NULL DEFAULT '[]',
      org_id TEXT,
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
      reply_to TEXT,
      org_id TEXT
    );

    CREATE TABLE IF NOT EXISTS chat_threads (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
      parent_message_id TEXT NOT NULL,
      title TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      last_message_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      linked_object_refs_json TEXT NOT NULL DEFAULT '[]',
      org_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Legacy additive migrations: org_id on every table + object-ref JSON columns.
  if (!hasColumn(db, 'chat_categories', 'org_id')) {
    db.exec('ALTER TABLE chat_categories ADD COLUMN org_id TEXT');
  }
  if (!hasColumn(db, 'chat_channels', 'org_id')) {
    db.exec('ALTER TABLE chat_channels ADD COLUMN org_id TEXT');
  }
  if (!hasColumn(db, 'chat_messages', 'org_id')) {
    db.exec('ALTER TABLE chat_messages ADD COLUMN org_id TEXT');
  }
  if (!hasColumn(db, 'chat_threads', 'org_id')) {
    db.exec('ALTER TABLE chat_threads ADD COLUMN org_id TEXT');
  }
  if (!hasColumn(db, 'chat_channels', 'linked_object_refs_json')) {
    db.exec("ALTER TABLE chat_channels ADD COLUMN linked_object_refs_json TEXT NOT NULL DEFAULT '[]'");
  }
  if (!hasColumn(db, 'chat_threads', 'linked_object_refs_json')) {
    db.exec("ALTER TABLE chat_threads ADD COLUMN linked_object_refs_json TEXT NOT NULL DEFAULT '[]'");
  }

  // Replace legacy global inline UNIQUE(name) with a per-org unique index so two
  // orgs may each own a "general" category/channel. No-op on fresh tables.
  rebuildChatTableForOrgOwnership(
    db,
    'chat_categories',
    `CREATE TABLE chat_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT,
      "order" INTEGER NOT NULL DEFAULT 0,
      org_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    'id, name, emoji, "order", org_id, created_at',
  );
  rebuildChatTableForOrgOwnership(
    db,
    'chat_channels',
    `CREATE TABLE chat_channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      category_id TEXT NOT NULL REFERENCES chat_categories(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL DEFAULT 0,
      agents TEXT NOT NULL DEFAULT '[]',
      unread_count INTEGER NOT NULL DEFAULT 0,
      last_message_at TEXT,
      linked_object_refs_json TEXT NOT NULL DEFAULT '[]',
      org_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    'id, name, description, category_id, "order", agents, unread_count, last_message_at, linked_object_refs_json, org_id, created_at',
  );

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_chat_channels_category_order ON chat_channels(category_id, "order", name);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_ts ON chat_messages(channel_id, timestamp, created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_ts ON chat_messages(thread_id, timestamp, created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_threads_channel_last ON chat_threads(channel_id, last_message_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_threads_parent_message ON chat_threads(parent_message_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_categories_org_name ON chat_categories(org_id, name);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_channels_org_name ON chat_channels(org_id, name);
    CREATE INDEX IF NOT EXISTS idx_chat_channels_org ON chat_channels(org_id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_org ON chat_messages(org_id);
    CREATE INDEX IF NOT EXISTS idx_chat_threads_org ON chat_threads(org_id);
  `);
}

function mapCategoryRow(row: Record<string, unknown>): ChatCategoryRecord {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    emoji: typeof row.emoji === 'string' ? row.emoji : null,
    order: Number.isFinite(Number(row.order)) ? Number(row.order) : 0,
    org_id: typeof row.org_id === 'string' && row.org_id.trim() ? row.org_id : null,
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
    linked_object_refs: parseObjectRefs(row.linked_object_refs_json),
    org_id: typeof row.org_id === 'string' && row.org_id.trim() ? row.org_id : null,
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
    org_id: typeof row.org_id === 'string' && row.org_id.trim() ? row.org_id : null,
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
    linked_object_refs: parseObjectRefs(row.linked_object_refs_json),
    org_id: typeof row.org_id === 'string' && row.org_id.trim() ? row.org_id : null,
    created_at: normalizeTimestamp(typeof row.created_at === 'string' ? row.created_at : undefined),
  };
}

export { appendObjectRef as _appendChatObjectRef };

export function createChatRepository(): ChatRepository {
  const db = getEntityDatabase(ensureChatSchema);

  // R4: prepared statements are created in pairs — an unfiltered (trusted) form
  // and an org-scoped (customer) form `..._org` that binds org_id. The method
  // selects the right one based on whether an org scope was supplied.
  const listCategoriesStmt = db.prepare('SELECT * FROM chat_categories ORDER BY "order" ASC, name COLLATE NOCASE ASC');
  const listCategoriesOrgStmt = db.prepare('SELECT * FROM chat_categories WHERE org_id = ? ORDER BY "order" ASC, name COLLATE NOCASE ASC');
  const getCategoryByNameStmt = db.prepare('SELECT * FROM chat_categories WHERE lower(name) = lower(?)');
  const getCategoryByNameOrgStmt = db.prepare('SELECT * FROM chat_categories WHERE lower(name) = lower(?) AND org_id = ?');
  const createCategoryStmt = db.prepare(`
    INSERT INTO chat_categories (id, name, emoji, "order", org_id, created_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const getCategoryStmt = db.prepare('SELECT * FROM chat_categories WHERE id = ?');
  const getCategoryOrgStmt = db.prepare('SELECT * FROM chat_categories WHERE id = ? AND org_id = ?');

  const listChannelsStmt = db.prepare('SELECT * FROM chat_channels ORDER BY category_id ASC, "order" ASC, name COLLATE NOCASE ASC');
  const listChannelsOrgStmt = db.prepare('SELECT * FROM chat_channels WHERE org_id = ? ORDER BY category_id ASC, "order" ASC, name COLLATE NOCASE ASC');
  const listChannelsByCategoryStmt = db.prepare('SELECT * FROM chat_channels WHERE category_id = ? ORDER BY "order" ASC, name COLLATE NOCASE ASC');
  const listChannelsByCategoryOrgStmt = db.prepare('SELECT * FROM chat_channels WHERE category_id = ? AND org_id = ? ORDER BY "order" ASC, name COLLATE NOCASE ASC');
  const getChannelStmt = db.prepare('SELECT * FROM chat_channels WHERE id = ?');
  const getChannelOrgStmt = db.prepare('SELECT * FROM chat_channels WHERE id = ? AND org_id = ?');
  const getChannelByNameStmt = db.prepare('SELECT * FROM chat_channels WHERE lower(name) = lower(?)');
  const getChannelByNameOrgStmt = db.prepare('SELECT * FROM chat_channels WHERE lower(name) = lower(?) AND org_id = ?');
  const createChannelStmt = db.prepare(`
    INSERT INTO chat_channels (id, name, description, category_id, "order", agents, unread_count, last_message_at, org_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, CURRENT_TIMESTAMP)
  `);
  const deleteChannelStmt = db.prepare('DELETE FROM chat_channels WHERE id = ?');
  const deleteChannelOrgStmt = db.prepare('DELETE FROM chat_channels WHERE id = ? AND org_id = ?');
  const markChannelReadStmt = db.prepare('UPDATE chat_channels SET unread_count = 0 WHERE id = ?');
  const markChannelReadOrgStmt = db.prepare('UPDATE chat_channels SET unread_count = 0 WHERE id = ? AND org_id = ?');
  const touchChannelStmt = db.prepare('UPDATE chat_channels SET last_message_at = ? WHERE id = ?');
  const incUnreadStmt = db.prepare('UPDATE chat_channels SET unread_count = unread_count + 1 WHERE id = ?');
  const updateChannelObjectRefsStmt = db.prepare('UPDATE chat_channels SET linked_object_refs_json = ? WHERE id = ?');

  const listMessagesByChannelStmt = db.prepare(`
    SELECT * FROM chat_messages
    WHERE channel_id = ? AND (thread_id IS NULL OR thread_id = '')
    ORDER BY datetime(timestamp) ASC, datetime(created_at) ASC, id ASC
  `);
  const listMessagesByChannelOrgStmt = db.prepare(`
    SELECT * FROM chat_messages
    WHERE channel_id = ? AND org_id = ? AND (thread_id IS NULL OR thread_id = '')
    ORDER BY datetime(timestamp) ASC, datetime(created_at) ASC, id ASC
  `);
  const listMessagesByThreadStmt = db.prepare(`
    SELECT * FROM chat_messages
    WHERE thread_id = ?
    ORDER BY datetime(timestamp) ASC, datetime(created_at) ASC, id ASC
  `);
  const listMessagesByThreadOrgStmt = db.prepare(`
    SELECT * FROM chat_messages
    WHERE thread_id = ? AND org_id = ?
    ORDER BY datetime(timestamp) ASC, datetime(created_at) ASC, id ASC
  `);
  const getMessageStmt = db.prepare('SELECT * FROM chat_messages WHERE id = ?');
  const getMessageOrgStmt = db.prepare('SELECT * FROM chat_messages WHERE id = ? AND org_id = ?');
  const createMessageStmt = db.prepare(`
    INSERT INTO chat_messages (
      id, channel_id, thread_id, sender, sender_emoji, content, model, is_local, status, timestamp, created_at, updated_at, reply_to, org_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?)
  `);
  const updateMessageStatusStmt = db.prepare('UPDATE chat_messages SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');

  const listThreadsByChannelStmt = db.prepare('SELECT * FROM chat_threads WHERE channel_id = ? ORDER BY datetime(last_message_at) DESC, id DESC');
  const listThreadsByChannelOrgStmt = db.prepare('SELECT * FROM chat_threads WHERE channel_id = ? AND org_id = ? ORDER BY datetime(last_message_at) DESC, id DESC');
  const getThreadStmt = db.prepare('SELECT * FROM chat_threads WHERE id = ?');
  const getThreadOrgStmt = db.prepare('SELECT * FROM chat_threads WHERE id = ? AND org_id = ?');
  const getThreadByParentStmt = db.prepare('SELECT * FROM chat_threads WHERE parent_message_id = ?');
  const getThreadByParentOrgStmt = db.prepare('SELECT * FROM chat_threads WHERE parent_message_id = ? AND org_id = ?');
  const createThreadStmt = db.prepare(`
    INSERT INTO chat_threads (id, channel_id, parent_message_id, title, message_count, last_message_at, org_id, created_at)
    VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)
  `);
  const incrementThreadStmt = db.prepare('UPDATE chat_threads SET message_count = message_count + 1, last_message_at = ? WHERE id = ?');
  const updateThreadObjectRefsStmt = db.prepare('UPDATE chat_threads SET linked_object_refs_json = ? WHERE id = ?');

  return {
    listCategories: (orgId) => (orgId === undefined
      ? (listCategoriesStmt.all() as Array<Record<string, unknown>>)
      : (listCategoriesOrgStmt.all(orgId) as Array<Record<string, unknown>>)
    ).map(mapCategoryRow),

    createCategory: (input) => {
      const name = input.name.trim();
      if (!name) {
        throw new Error('name is required');
      }

      const id = input.id?.trim() || randomUUID();
      const orgId = input.org_id?.trim() || null;
      createCategoryStmt.run(id, name, input.emoji?.trim() || null, Number(input.order ?? 0), orgId);
      const row = getCategoryStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) throw new Error('Failed to create category');
      return mapCategoryRow(row);
    },

    getCategoryByName: (name, orgId) => {
      const row = orgId === undefined
        ? getCategoryByNameStmt.get(name) as Record<string, unknown> | undefined
        : getCategoryByNameOrgStmt.get(name, orgId) as Record<string, unknown> | undefined;
      return row ? mapCategoryRow(row) : undefined;
    },

    getCategory: (id, orgId) => {
      const row = orgId === undefined
        ? getCategoryStmt.get(id) as Record<string, unknown> | undefined
        : getCategoryOrgStmt.get(id, orgId) as Record<string, unknown> | undefined;
      return row ? mapCategoryRow(row) : undefined;
    },

    listChannels: (orgId) => (orgId === undefined
      ? (listChannelsStmt.all() as Array<Record<string, unknown>>)
      : (listChannelsOrgStmt.all(orgId) as Array<Record<string, unknown>>)
    ).map(mapChannelRow),

    listChannelsByCategory: (categoryId, orgId) => (orgId === undefined
      ? (listChannelsByCategoryStmt.all(categoryId) as Array<Record<string, unknown>>)
      : (listChannelsByCategoryOrgStmt.all(categoryId, orgId) as Array<Record<string, unknown>>)
    ).map(mapChannelRow),

    getChannel: (id, orgId) => {
      const row = orgId === undefined
        ? getChannelStmt.get(id) as Record<string, unknown> | undefined
        : getChannelOrgStmt.get(id, orgId) as Record<string, unknown> | undefined;
      return row ? mapChannelRow(row) : undefined;
    },

    getChannelByName: (name, orgId) => {
      const row = orgId === undefined
        ? getChannelByNameStmt.get(name) as Record<string, unknown> | undefined
        : getChannelByNameOrgStmt.get(name, orgId) as Record<string, unknown> | undefined;
      return row ? mapChannelRow(row) : undefined;
    },

    createChannel: (input) => {
      const name = input.name.trim();
      if (!name) {
        throw new Error('name is required');
      }

      const id = input.id?.trim() || randomUUID();
      const orgId = input.org_id?.trim() || null;
      createChannelStmt.run(
        id,
        name,
        input.description?.trim() || null,
        input.category_id,
        Number(input.order ?? 0),
        JSON.stringify(parseAgents(input.agents ?? [])),
        orgId,
      );
      const row = getChannelStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) throw new Error('Failed to create channel');
      return mapChannelRow(row);
    },

    updateChannel: (id, patch, orgId) => {
      const existing = orgId === undefined
        ? getChannelStmt.get(id) as Record<string, unknown> | undefined
        : getChannelOrgStmt.get(id, orgId) as Record<string, unknown> | undefined;
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
      const row = orgId === undefined
        ? getChannelStmt.get(id) as Record<string, unknown> | undefined
        : getChannelOrgStmt.get(id, orgId) as Record<string, unknown> | undefined;
      return row ? mapChannelRow(row) : undefined;
    },

    deleteChannel: (id, orgId) => orgId === undefined
      ? deleteChannelStmt.run(id).changes > 0
      : deleteChannelOrgStmt.run(id, orgId).changes > 0,

    markChannelRead: (id, orgId) => {
      if (orgId === undefined) markChannelReadStmt.run(id);
      else markChannelReadOrgStmt.run(id, orgId);
    },

    touchChannelLastMessage: (id, timestamp) => {
      touchChannelStmt.run(normalizeTimestamp(timestamp), id);
    },

    linkChannelObject: (id, objectRef, orgId) => {
      const row = orgId === undefined
        ? getChannelStmt.get(id) as Record<string, unknown> | undefined
        : getChannelOrgStmt.get(id, orgId) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      const refs = appendObjectRef(mapChannelRow(row).linked_object_refs, objectRef);
      updateChannelObjectRefsStmt.run(JSON.stringify(refs), id);
      const updated = orgId === undefined
        ? getChannelStmt.get(id) as Record<string, unknown> | undefined
        : getChannelOrgStmt.get(id, orgId) as Record<string, unknown> | undefined;
      return updated ? mapChannelRow(updated) : undefined;
    },

    listChannelObjectRefs: (id, orgId) => {
      const row = orgId === undefined
        ? getChannelStmt.get(id) as Record<string, unknown> | undefined
        : getChannelOrgStmt.get(id, orgId) as Record<string, unknown> | undefined;
      return row ? mapChannelRow(row).linked_object_refs : [];
    },

    listMessagesByChannel: (channelId, orgId) => (orgId === undefined
      ? (listMessagesByChannelStmt.all(channelId) as Array<Record<string, unknown>>)
      : (listMessagesByChannelOrgStmt.all(channelId, orgId) as Array<Record<string, unknown>>)
    ).map(mapMessageRow),

    listMessagesByThread: (threadId, orgId) => (orgId === undefined
      ? (listMessagesByThreadStmt.all(threadId) as Array<Record<string, unknown>>)
      : (listMessagesByThreadOrgStmt.all(threadId, orgId) as Array<Record<string, unknown>>)
    ).map(mapMessageRow),

    getMessage: (id, orgId) => {
      const row = orgId === undefined
        ? getMessageStmt.get(id) as Record<string, unknown> | undefined
        : getMessageOrgStmt.get(id, orgId) as Record<string, unknown> | undefined;
      return row ? mapMessageRow(row) : undefined;
    },

    createMessage: (input) => {
      const content = input.content.trim();
      if (!content) {
        throw new Error('content is required');
      }

      const id = input.id?.trim() || randomUUID();
      const timestamp = normalizeTimestamp(input.timestamp);
      const orgId = input.org_id?.trim() || null;
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
        input.reply_to?.trim() || null,
        orgId,
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

    listThreadsByChannel: (channelId, orgId) => (orgId === undefined
      ? (listThreadsByChannelStmt.all(channelId) as Array<Record<string, unknown>>)
      : (listThreadsByChannelOrgStmt.all(channelId, orgId) as Array<Record<string, unknown>>)
    ).map(mapThreadRow),

    getThread: (id, orgId) => {
      const row = orgId === undefined
        ? getThreadStmt.get(id) as Record<string, unknown> | undefined
        : getThreadOrgStmt.get(id, orgId) as Record<string, unknown> | undefined;
      return row ? mapThreadRow(row) : undefined;
    },

    getThreadByParentMessage: (parentMessageId, orgId) => {
      const row = orgId === undefined
        ? getThreadByParentStmt.get(parentMessageId) as Record<string, unknown> | undefined
        : getThreadByParentOrgStmt.get(parentMessageId, orgId) as Record<string, unknown> | undefined;
      return row ? mapThreadRow(row) : undefined;
    },

    createThread: (input) => {
      const id = input.id?.trim() || randomUUID();
      const title = input.title.trim() || 'Thread';
      const orgId = input.org_id?.trim() || null;
      createThreadStmt.run(id, input.channel_id, input.parent_message_id, title, orgId);
      const row = getThreadStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) throw new Error('Failed to create thread');
      return mapThreadRow(row);
    },

    incrementThreadCount: (id, timestamp) => {
      incrementThreadStmt.run(normalizeTimestamp(timestamp), id);
    },

    linkThreadObject: (id, objectRef, orgId) => {
      const row = orgId === undefined
        ? getThreadStmt.get(id) as Record<string, unknown> | undefined
        : getThreadOrgStmt.get(id, orgId) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      const refs = appendObjectRef(mapThreadRow(row).linked_object_refs, objectRef);
      updateThreadObjectRefsStmt.run(JSON.stringify(refs), id);
      const updated = orgId === undefined
        ? getThreadStmt.get(id) as Record<string, unknown> | undefined
        : getThreadOrgStmt.get(id, orgId) as Record<string, unknown> | undefined;
      return updated ? mapThreadRow(updated) : undefined;
    },

    listThreadObjectRefs: (id, orgId) => {
      const row = orgId === undefined
        ? getThreadStmt.get(id) as Record<string, unknown> | undefined
        : getThreadOrgStmt.get(id, orgId) as Record<string, unknown> | undefined;
      return row ? mapThreadRow(row).linked_object_refs : [];
    },
  };
}
