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
  team_id: string | null;
  created_at: string;
}

export interface ChatChannelRecord {
  id: string;
  org_id: string | null;
  team_id: string | null;
  name: string;
  description: string | null;
  category_id: string;
  order: number;
  agents: string[];
  unread_count: number;
  last_message_at: string | null;
  linked_object_refs: ObjectRef[];
  created_at: string;
}

export interface ChatMessageRecord {
  id: string;
  org_id: string | null;
  team_id: string | null;
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
  org_id: string | null;
  team_id: string | null;
  channel_id: string;
  parent_message_id: string;
  title: string;
  message_count: number;
  last_message_at: string;
  linked_object_refs: ObjectRef[];
  created_at: string;
}

export interface CreateChatCategoryInput {
  id?: string;
  name: string;
  emoji?: string;
  order?: number;
  org_id?: string | null;
  team_id?: string;
}

export interface CreateChatChannelInput {
  id?: string;
  name: string;
  description?: string;
  category_id: string;
  order?: number;
  agents?: string[];
  org_id?: string | null;
  team_id?: string;
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
  org_id?: string | null;
  team_id?: string;
}

export interface UpdateChatMessageStatusInput {
  status: string;
}

export interface CreateChatThreadInput {
  id?: string;
  channel_id: string;
  parent_message_id: string;
  title: string;
  org_id?: string | null;
  team_id?: string;
}

export type ChatOrgScope = string | undefined;

export interface ChatRepository {
  listCategories: (orgId?: ChatOrgScope) => ChatCategoryRecord[];
  createCategory: (input: CreateChatCategoryInput) => ChatCategoryRecord;
  getCategory: (id: string, orgId?: ChatOrgScope) => ChatCategoryRecord | undefined;
  getCategoryByName: (name: string, orgId?: ChatOrgScope) => ChatCategoryRecord | undefined;

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

interface SqliteIndexRow {
  name: string;
  unique: number;
}

type ChatNameTable = 'chat_categories' | 'chat_channels';

const CHAT_TENANT_NAME_INDEXES = [
  {
    name: 'idx_chat_categories_tenant_name_team',
    sql: `CREATE UNIQUE INDEX idx_chat_categories_tenant_name_team
      ON chat_categories(org_id, team_id, name COLLATE NOCASE)
      WHERE org_id IS NOT NULL AND team_id IS NOT NULL`,
  },
  {
    name: 'idx_chat_categories_tenant_name_orgwide',
    sql: `CREATE UNIQUE INDEX idx_chat_categories_tenant_name_orgwide
      ON chat_categories(org_id, name COLLATE NOCASE)
      WHERE org_id IS NOT NULL AND team_id IS NULL`,
  },
  {
    name: 'idx_chat_channels_tenant_name_team',
    sql: `CREATE UNIQUE INDEX idx_chat_channels_tenant_name_team
      ON chat_channels(org_id, team_id, name COLLATE NOCASE)
      WHERE org_id IS NOT NULL AND team_id IS NOT NULL`,
  },
  {
    name: 'idx_chat_channels_tenant_name_orgwide',
    sql: `CREATE UNIQUE INDEX idx_chat_channels_tenant_name_orgwide
      ON chat_channels(org_id, name COLLATE NOCASE)
      WHERE org_id IS NOT NULL AND team_id IS NULL`,
  },
] as const;

const RESERVED_CHAT_TENANT_NAME_INDEXES = new Set(CHAT_TENANT_NAME_INDEXES.map((index) => index.name));

interface SqlToken {
  kind: 'word' | 'identifier' | 'string' | 'symbol';
  value: string;
  start: number;
  end: number;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function sqlTokens(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let index = 0;
  while (index < sql.length) {
    const start = index;
    const character = sql[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === '-' && sql[index + 1] === '-') {
      index += 2;
      while (index < sql.length && sql[index] !== '\n') index += 1;
      continue;
    }
    if (character === '/' && sql[index + 1] === '*') {
      index += 2;
      while (index < sql.length && !(sql[index] === '*' && sql[index + 1] === '/')) index += 1;
      index = Math.min(sql.length, index + 2);
      continue;
    }
    if (character === "'") {
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") index += 2;
        else if (sql[index++] === "'") break;
      }
      tokens.push({ kind: 'string', value: sql.slice(start, index), start, end: index });
      continue;
    }
    if (character === '"' || character === '`' || character === '[') {
      const close = character === '[' ? ']' : character;
      index += 1;
      let value = '';
      while (index < sql.length) {
        if (sql[index] === close) {
          if (close !== ']' && sql[index + 1] === close) {
            value += close;
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        value += sql[index++];
      }
      tokens.push({ kind: 'identifier', value, start, end: index });
      continue;
    }
    if (/[A-Za-z_]/.test(character)) {
      index += 1;
      while (index < sql.length && /[A-Za-z0-9_$]/.test(sql[index])) index += 1;
      tokens.push({ kind: 'word', value: sql.slice(start, index), start, end: index });
      continue;
    }
    index += 1;
    tokens.push({ kind: 'symbol', value: character, start, end: index });
  }
  return tokens;
}

function tokenKeyword(token: SqlToken | undefined, keyword: string): boolean {
  return token?.kind === 'word' && token.value.toUpperCase() === keyword;
}

function tokenIdentifier(token: SqlToken | undefined): string | null {
  return token && (token.kind === 'word' || token.kind === 'identifier') ? token.value : null;
}

function isGlobalTableNameUnique(definition: string): boolean {
  const tokens = sqlTokens(definition);
  let offset = 0;
  if (tokenKeyword(tokens[offset], 'CONSTRAINT')) offset += 2;
  if (!tokenKeyword(tokens[offset], 'UNIQUE') || tokens[offset + 1]?.value !== '(') return false;

  let closeIndex = offset + 2;
  let depth = 1;
  for (; closeIndex < tokens.length && depth > 0; closeIndex += 1) {
    if (tokens[closeIndex].value === '(') depth += 1;
    else if (tokens[closeIndex].value === ')') depth -= 1;
  }
  if (depth !== 0) return false;
  const inner = tokens.slice(offset + 2, closeIndex - 1);
  if (tokenIdentifier(inner[0])?.toLowerCase() !== 'name') return false;
  let innerIndex = 1;
  if (tokenKeyword(inner[innerIndex], 'COLLATE') && tokenIdentifier(inner[innerIndex + 1])) innerIndex += 2;
  if (tokenKeyword(inner[innerIndex], 'ASC') || tokenKeyword(inner[innerIndex], 'DESC')) innerIndex += 1;
  if (innerIndex !== inner.length) return false;

  const suffix = tokens.slice(closeIndex);
  return suffix.length === 0 || (
    suffix.length === 3
    && tokenKeyword(suffix[0], 'ON')
    && tokenKeyword(suffix[1], 'CONFLICT')
    && ['ROLLBACK', 'ABORT', 'FAIL', 'IGNORE', 'REPLACE'].some((action) => tokenKeyword(suffix[2], action))
  );
}

function removeInlineNameUnique(definition: string): string {
  const tokens = sqlTokens(definition);
  if (tokenIdentifier(tokens[0])?.toLowerCase() !== 'name') return definition;

  const ranges: Array<{ start: number; end: number }> = [];
  let depth = 0;
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.value === '(') depth += 1;
    else if (token.value === ')') depth -= 1;
    else if (depth === 0 && tokenKeyword(token, 'UNIQUE')) {
      let start = token.start;
      if (index >= 2 && tokenKeyword(tokens[index - 2], 'CONSTRAINT') && tokenIdentifier(tokens[index - 1])) {
        start = tokens[index - 2].start;
      }
      let end = token.end;
      if (tokenKeyword(tokens[index + 1], 'ON') && tokenKeyword(tokens[index + 2], 'CONFLICT') && tokens[index + 3]) {
        end = tokens[index + 3].end;
        index += 3;
      }
      ranges.push({ start, end });
    }
  }
  return ranges.reverse().reduce((sql, range) => `${sql.slice(0, range.start)}${sql.slice(range.end)}`, definition);
}

function tableDefinitions(createSql: string): { definitions: string[]; closeParen: number } {
  const tokens = sqlTokens(createSql);
  const openIndex = tokens.findIndex((token) => token.value === '(');
  if (openIndex < 0) throw new Error('chat tenant-name migration could not parse CREATE TABLE');
  const definitions: string[] = [];
  let depth = 0;
  let definitionStart = tokens[openIndex].end;
  for (let index = openIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.value === '(') depth += 1;
    else if (token.value === ')' && depth > 0) depth -= 1;
    else if ((token.value === ',' || token.value === ')') && depth === 0) {
      definitions.push(createSql.slice(definitionStart, token.start));
      if (token.value === ')') return { definitions, closeParen: token.start };
      definitionStart = token.end;
    }
  }
  throw new Error('chat tenant-name migration found unterminated CREATE TABLE');
}

function replacementTableSql(createSql: string, temporaryTable: string): string {
  const parsed = tableDefinitions(createSql);
  const definitions = parsed.definitions
    .filter((definition) => !isGlobalTableNameUnique(definition))
    .map(removeInlineNameUnique);
  return `CREATE TABLE ${quoteIdentifier(temporaryTable)} (${definitions.join(',')})${createSql.slice(parsed.closeParen + 1)}`;
}

function indexColumns(db: Database.Database, indexName: string): string[] {
  return (db.prepare(`PRAGMA index_info(${JSON.stringify(indexName)})`).all() as Array<{ name: string }>)
    .map((row) => row.name);
}

function hasGlobalNameUniqueness(db: Database.Database, table: ChatNameTable): boolean {
  return (db.prepare(`PRAGMA index_list(${table})`).all() as SqliteIndexRow[])
    .some((index) => index.unique === 1 && indexColumns(db, index.name).join(',') === 'name');
}

function assertNoTenantNameDuplicates(db: Database.Database): void {
  for (const table of ['chat_categories', 'chat_channels'] as const) {
    const tableExists = Boolean(db.prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
    ).get(table));
    if (!tableExists || !['name', 'org_id', 'team_id'].every((column) => hasColumn(db, table, column))) {
      continue;
    }
    const duplicate = db.prepare(`
      SELECT org_id, team_id, lower(name) AS normalized_name
      FROM ${quoteIdentifier(table)}
      WHERE org_id IS NOT NULL
      GROUP BY org_id, team_id, lower(name)
      HAVING COUNT(*) > 1
      ORDER BY org_id COLLATE BINARY, team_id IS NOT NULL, team_id COLLATE BINARY, lower(name) COLLATE BINARY
      LIMIT 1
    `).get() as { org_id: string; team_id: string | null; normalized_name: string } | undefined;
    if (duplicate) {
      throw new Error(
        `chat tenant-name migration blocked by duplicate: ${table} org_id=${duplicate.org_id} team_id=${duplicate.team_id ?? 'NULL'} name=${duplicate.normalized_name}`,
      );
    }
  }
}

/**
 * SQLite cannot drop inline or table-level UNIQUE constraints. Rebuild affected
 * tables from their deployed SQL and replace all reserved tenant indexes in the
 * same transaction, so any copy, schema-object, index, or FK failure rolls back.
 */
function migrateChatNameUniqueness(db: Database.Database): void {
  // Index creation cannot succeed with these rows. Fail before changing either
  // the schema or foreign-key mode so startup is deterministic and retryable.
  assertNoTenantNameDuplicates(db);

  const tables = (['chat_categories', 'chat_channels'] as const)
    .filter((table) => hasGlobalNameUniqueness(db, table));

  const schemaObjects = (db.prepare(`
    SELECT type, name, tbl_name, sql FROM sqlite_master
    WHERE type IN ('index', 'trigger')
      AND tbl_name IN ('chat_categories', 'chat_channels')
      AND sql IS NOT NULL
    ORDER BY CASE type WHEN 'index' THEN 0 ELSE 1 END, name
  `).all() as Array<{ type: 'index' | 'trigger'; name: string; tbl_name: ChatNameTable; sql: string }>)
    .filter((object) => tables.includes(object.tbl_name))
    .filter((object) => !RESERVED_CHAT_TENANT_NAME_INDEXES.has(object.name as typeof CHAT_TENANT_NAME_INDEXES[number]['name']))
    .filter((object) => object.type === 'trigger' || !(
      (db.prepare(`SELECT [unique] FROM pragma_index_list(?) WHERE name = ?`).get(
        object.tbl_name,
        object.name,
      ) as { unique?: number } | undefined)?.unique === 1
      && indexColumns(db, object.name).join(',') === 'name'
    ));

  const tablePlans = tables.map((table) => {
    const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) as { sql?: string } | undefined;
    if (!row?.sql) throw new Error(`chat tenant-name migration missing schema for ${table}`);
    const temporaryTable = `__${table}_tenant_name_${randomUUID().replace(/-/g, '')}`;
    const columns = (db.prepare(`PRAGMA table_xinfo(${quoteIdentifier(table)})`).all() as Array<{ name: string; hidden: number }>)
      .filter((column) => column.hidden === 0)
      .map((column) => column.name);
    if (columns.length === 0) throw new Error(`chat tenant-name migration found no columns for ${table}`);
    return { table, temporaryTable, createSql: replacementTableSql(row.sql, temporaryTable), columns };
  });

  const foreignKeysEnabled = Number(db.pragma('foreign_keys', { simple: true })) === 1;
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      // These names are reserved. Never trust IF NOT EXISTS: remove any index
      // using one of them, regardless of its current table or definition.
      for (const index of CHAT_TENANT_NAME_INDEXES) {
        db.exec(`DROP INDEX IF EXISTS ${quoteIdentifier(index.name)}`);
      }
      for (const plan of tablePlans) {
        db.exec(plan.createSql);
        const columns = plan.columns.map(quoteIdentifier).join(', ');
        db.exec(`INSERT INTO ${quoteIdentifier(plan.temporaryTable)} (${columns}) SELECT ${columns} FROM ${quoteIdentifier(plan.table)}`);
      }
      for (const table of [...tables].reverse()) db.exec(`DROP TABLE ${quoteIdentifier(table)}`);
      for (const plan of tablePlans) {
        db.exec(`ALTER TABLE ${quoteIdentifier(plan.temporaryTable)} RENAME TO ${quoteIdentifier(plan.table)}`);
      }
      for (const object of schemaObjects) db.exec(object.sql);
      for (const index of CHAT_TENANT_NAME_INDEXES) db.exec(index.sql);
      const violations = db.pragma('foreign_key_check') as unknown[];
      if (violations.length > 0) throw new Error('chat tenant-name migration failed foreign_key_check');
    })();
  } finally {
    db.pragma(`foreign_keys = ${foreignKeysEnabled ? 'ON' : 'OFF'}`);
  }
}

function ensureChatSchema(db: Database.Database): void {
  // Existing tenant-scoped tables must be validated before CREATE/ALTER/INDEX
  // statements can change any deployed schema object.
  assertNoTenantNameDuplicates(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT,
      "order" INTEGER NOT NULL DEFAULT 0,
      org_id TEXT,
      team_id TEXT,
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
      team_id TEXT,
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
      org_id TEXT,
      team_id TEXT
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
      team_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

  `);

  for (const [table, column] of [['chat_channels', 'org_id'], ['chat_channels', 'team_id'], ['chat_messages', 'org_id'], ['chat_messages', 'team_id'], ['chat_threads', 'org_id'], ['chat_threads', 'team_id'], ['chat_categories', 'org_id'], ['chat_categories', 'team_id']] as const) {
    if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
  }
  if (!hasColumn(db, 'chat_channels', 'linked_object_refs_json')) {
    db.exec("ALTER TABLE chat_channels ADD COLUMN linked_object_refs_json TEXT NOT NULL DEFAULT '[]'");
  }
  if (!hasColumn(db, 'chat_threads', 'linked_object_refs_json')) {
    db.exec("ALTER TABLE chat_threads ADD COLUMN linked_object_refs_json TEXT NOT NULL DEFAULT '[]'");
  }
  migrateChatNameUniqueness(db);
  db.exec(`
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
    org_id: typeof row.org_id === 'string' ? row.org_id : null,
    team_id: typeof row.team_id === 'string' ? row.team_id : null,
    created_at: normalizeTimestamp(typeof row.created_at === 'string' ? row.created_at : undefined),
  };
}

function mapChannelRow(row: Record<string, unknown>): ChatChannelRecord {
  return {
    id: String(row.id ?? ''),
    org_id: typeof row.org_id === 'string' ? row.org_id : null,
    team_id: typeof row.team_id === 'string' ? row.team_id : null,
    name: String(row.name ?? ''),
    description: typeof row.description === 'string' ? row.description : null,
    category_id: String(row.category_id ?? ''),
    order: Number.isFinite(Number(row.order)) ? Number(row.order) : 0,
    agents: parseAgents(row.agents),
    unread_count: Number.isFinite(Number(row.unread_count)) ? Number(row.unread_count) : 0,
    last_message_at: typeof row.last_message_at === 'string' ? normalizeTimestamp(row.last_message_at) : null,
    linked_object_refs: parseObjectRefs(row.linked_object_refs_json),
    created_at: normalizeTimestamp(typeof row.created_at === 'string' ? row.created_at : undefined),
  };
}

function mapMessageRow(row: Record<string, unknown>): ChatMessageRecord {
  return {
    id: String(row.id ?? ''),
    org_id: typeof row.org_id === 'string' ? row.org_id : null,
    team_id: typeof row.team_id === 'string' ? row.team_id : null,
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
    org_id: typeof row.org_id === 'string' ? row.org_id : null,
    team_id: typeof row.team_id === 'string' ? row.team_id : null,
    channel_id: String(row.channel_id ?? ''),
    parent_message_id: String(row.parent_message_id ?? ''),
    title: String(row.title ?? 'Thread'),
    message_count: Number.isFinite(Number(row.message_count)) ? Number(row.message_count) : 0,
    last_message_at: normalizeTimestamp(typeof row.last_message_at === 'string' ? row.last_message_at : undefined),
    linked_object_refs: parseObjectRefs(row.linked_object_refs_json),
    created_at: normalizeTimestamp(typeof row.created_at === 'string' ? row.created_at : undefined),
  };
}

export function createChatRepository(): ChatRepository {
  const db = getEntityDatabase(ensureChatSchema);

  const listCategoriesStmt = db.prepare('SELECT * FROM chat_categories ORDER BY "order" ASC, name COLLATE NOCASE ASC');
  const listCategoriesOrgStmt = db.prepare('SELECT * FROM chat_categories WHERE org_id = ? ORDER BY "order" ASC, name COLLATE NOCASE ASC');
  const getCategoryByNameStmt = db.prepare('SELECT * FROM chat_categories WHERE lower(name) = lower(?)');
  const getCategoryByNameOrgStmt = db.prepare('SELECT * FROM chat_categories WHERE lower(name) = lower(?) AND org_id = ?');
  const createCategoryStmt = db.prepare(`
    INSERT INTO chat_categories (id, name, emoji, "order", org_id, team_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const getCategoryStmt = db.prepare('SELECT * FROM chat_categories WHERE id = ?');
  const getCategoryOrgStmt = db.prepare('SELECT * FROM chat_categories WHERE id = ? AND org_id = ?');
  const getCategoryInExactScopeStmt = db.prepare('SELECT id FROM chat_categories WHERE id = ? AND org_id IS ? AND team_id IS ?');

  const listChannelsStmt = db.prepare('SELECT * FROM chat_channels ORDER BY category_id ASC, "order" ASC, name COLLATE NOCASE ASC');
  const listChannelsOrgStmt = db.prepare('SELECT * FROM chat_channels WHERE org_id = ? ORDER BY category_id ASC, "order" ASC, name COLLATE NOCASE ASC');
  const listChannelsByCategoryStmt = db.prepare('SELECT * FROM chat_channels WHERE category_id = ? ORDER BY "order" ASC, name COLLATE NOCASE ASC');
  const listChannelsByCategoryOrgStmt = db.prepare('SELECT * FROM chat_channels WHERE category_id = ? AND org_id = ? ORDER BY "order" ASC, name COLLATE NOCASE ASC');
  const getChannelStmt = db.prepare('SELECT * FROM chat_channels WHERE id = ?');
  const getChannelOrgStmt = db.prepare('SELECT * FROM chat_channels WHERE id = ? AND org_id = ?');
  const getChannelByNameStmt = db.prepare('SELECT * FROM chat_channels WHERE lower(name) = lower(?)');
  const getChannelByNameOrgStmt = db.prepare('SELECT * FROM chat_channels WHERE lower(name) = lower(?) AND org_id = ?');
  const createChannelStmt = db.prepare(`
    INSERT INTO chat_channels (id, name, description, category_id, "order", agents, unread_count, last_message_at, org_id, team_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, CURRENT_TIMESTAMP)
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
  const listMessagesByThreadStmt = db.prepare(`
    SELECT * FROM chat_messages
    WHERE thread_id = ?
    ORDER BY datetime(timestamp) ASC, datetime(created_at) ASC, id ASC
  `);
  const getMessageStmt = db.prepare('SELECT * FROM chat_messages WHERE id = ?');
  const getMessageOrgStmt = db.prepare('SELECT * FROM chat_messages WHERE id = ? AND org_id = ?');
  const createMessageStmt = db.prepare(`
    INSERT INTO chat_messages (
      id, channel_id, thread_id, sender, sender_emoji, content, model, is_local, status, timestamp, created_at, updated_at, reply_to, org_id, team_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?)
  `);
  const updateMessageStatusStmt = db.prepare('UPDATE chat_messages SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');

  const listThreadsByChannelStmt = db.prepare('SELECT * FROM chat_threads WHERE channel_id = ? ORDER BY datetime(last_message_at) DESC, id DESC');
  const getThreadStmt = db.prepare('SELECT * FROM chat_threads WHERE id = ?');
  const getThreadByParentStmt = db.prepare('SELECT * FROM chat_threads WHERE parent_message_id = ?');
  const createThreadStmt = db.prepare(`
    INSERT INTO chat_threads (id, channel_id, parent_message_id, title, message_count, last_message_at, org_id, team_id, created_at)
    VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP, ?, ?, CURRENT_TIMESTAMP)
  `);
  const incrementThreadStmt = db.prepare('UPDATE chat_threads SET message_count = message_count + 1, last_message_at = ? WHERE id = ?');
  const updateThreadObjectRefsStmt = db.prepare('UPDATE chat_threads SET linked_object_refs_json = ? WHERE id = ?');

  return {
    listCategories: (orgId) => (orgId === undefined
      ? listCategoriesStmt.all() as Array<Record<string, unknown>>
      : listCategoriesOrgStmt.all(orgId) as Array<Record<string, unknown>>).map(mapCategoryRow),

    createCategory: (input) => {
      const name = input.name.trim();
      if (!name) {
        throw new Error('name is required');
      }

      const id = input.id?.trim() || randomUUID();
      createCategoryStmt.run(id, name, input.emoji?.trim() || null, Number(input.order ?? 0), input.org_id?.trim() || null, input.team_id?.trim() || null);
      const row = getCategoryStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) throw new Error('Failed to create category');
      return mapCategoryRow(row);
    },

    getCategory: (id, orgId) => {
      const row = (orgId === undefined ? getCategoryStmt.get(id) : getCategoryOrgStmt.get(id, orgId)) as Record<string, unknown> | undefined;
      return row ? mapCategoryRow(row) : undefined;
    },

    getCategoryByName: (name, orgId) => {
      const row = (orgId === undefined ? getCategoryByNameStmt.get(name) : getCategoryByNameOrgStmt.get(name, orgId)) as Record<string, unknown> | undefined;
      return row ? mapCategoryRow(row) : undefined;
    },

    listChannels: (orgId) => (orgId === undefined
      ? listChannelsStmt.all() as Array<Record<string, unknown>>
      : listChannelsOrgStmt.all(orgId) as Array<Record<string, unknown>>).map(mapChannelRow),

    listChannelsByCategory: (categoryId, orgId) => (orgId === undefined
      ? listChannelsByCategoryStmt.all(categoryId) as Array<Record<string, unknown>>
      : listChannelsByCategoryOrgStmt.all(categoryId, orgId) as Array<Record<string, unknown>>).map(mapChannelRow),

    getChannel: (id, orgId) => {
      const row = (orgId === undefined ? getChannelStmt.get(id) : getChannelOrgStmt.get(id, orgId)) as Record<string, unknown> | undefined;
      return row ? mapChannelRow(row) : undefined;
    },

    getChannelByName: (name, orgId) => {
      const row = (orgId === undefined ? getChannelByNameStmt.get(name) : getChannelByNameOrgStmt.get(name, orgId)) as Record<string, unknown> | undefined;
      return row ? mapChannelRow(row) : undefined;
    },

    createChannel: (input) => {
      const name = input.name.trim();
      if (!name) {
        throw new Error('name is required');
      }

      const orgId = input.org_id?.trim() || null;
      const teamId = input.team_id?.trim() || null;
      const categoryId = input.category_id.trim();
      if (!categoryId || !getCategoryInExactScopeStmt.get(categoryId, orgId, teamId)) {
        throw new Error('category not found');
      }

      const id = input.id?.trim() || randomUUID();
      createChannelStmt.run(
        id,
        name,
        input.description?.trim() || null,
        categoryId,
        Number(input.order ?? 0),
        JSON.stringify(parseAgents(input.agents ?? [])),
        orgId,
        teamId
      );
      const row = getChannelStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) throw new Error('Failed to create channel');
      return mapChannelRow(row);
    },

    updateChannel: (id, patch, orgId) => {
      const existing = (orgId === undefined ? getChannelStmt.get(id) : getChannelOrgStmt.get(id, orgId)) as Record<string, unknown> | undefined;
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
        const categoryId = patch.category_id.trim();
        const orgId = typeof existing.org_id === 'string' ? existing.org_id : null;
        const teamId = typeof existing.team_id === 'string' ? existing.team_id : null;
        if (!categoryId || !getCategoryInExactScopeStmt.get(categoryId, orgId, teamId)) return undefined;
        fields.push('category_id = ?');
        values.push(categoryId);
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

    deleteChannel: (id, orgId) => (orgId === undefined ? deleteChannelStmt.run(id) : deleteChannelOrgStmt.run(id, orgId)).changes > 0,

    markChannelRead: (id, orgId) => {
      if (orgId === undefined) markChannelReadStmt.run(id);
      else markChannelReadOrgStmt.run(id, orgId);
    },

    touchChannelLastMessage: (id, timestamp) => {
      touchChannelStmt.run(normalizeTimestamp(timestamp), id);
    },

    linkChannelObject: (id, objectRef, orgId) => {
      const row = (orgId === undefined ? getChannelStmt.get(id) : getChannelOrgStmt.get(id, orgId)) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      const refs = appendObjectRef(mapChannelRow(row).linked_object_refs, objectRef);
      updateChannelObjectRefsStmt.run(JSON.stringify(refs), id);
      const updated = getChannelStmt.get(id) as Record<string, unknown> | undefined;
      return updated ? mapChannelRow(updated) : undefined;
    },

    listChannelObjectRefs: (id) => {
      const row = getChannelStmt.get(id) as Record<string, unknown> | undefined;
      return row ? mapChannelRow(row).linked_object_refs : [];
    },

    listMessagesByChannel: (channelId) => (listMessagesByChannelStmt.all(channelId) as Array<Record<string, unknown>>).map(mapMessageRow),

    listMessagesByThread: (threadId) => (listMessagesByThreadStmt.all(threadId) as Array<Record<string, unknown>>).map(mapMessageRow),

    getMessage: (id, orgId) => {
      const row = (orgId === undefined ? getMessageStmt.get(id) : getMessageOrgStmt.get(id, orgId)) as Record<string, unknown> | undefined;
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
        input.reply_to?.trim() || null,
        input.org_id?.trim() || null,
        input.team_id?.trim() || null
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
      createThreadStmt.run(id, input.channel_id, input.parent_message_id, title, input.org_id?.trim() || null, input.team_id?.trim() || null);
      const row = getThreadStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) throw new Error('Failed to create thread');
      return mapThreadRow(row);
    },

    incrementThreadCount: (id, timestamp) => {
      incrementThreadStmt.run(normalizeTimestamp(timestamp), id);
    },

    linkThreadObject: (id, objectRef) => {
      const row = getThreadStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      const refs = appendObjectRef(mapThreadRow(row).linked_object_refs, objectRef);
      updateThreadObjectRefsStmt.run(JSON.stringify(refs), id);
      const updated = getThreadStmt.get(id) as Record<string, unknown> | undefined;
      return updated ? mapThreadRow(updated) : undefined;
    },

    listThreadObjectRefs: (id) => {
      const row = getThreadStmt.get(id) as Record<string, unknown> | undefined;
      return row ? mapThreadRow(row).linked_object_refs : [];
    },
  };
}

/**
 * THE-931 (R2) — DB-layer tenant scope for chat resources.
 *
 * The authoritative org/team boundary at the repository/query layer. Reads are
 * scoped by a resolved {orgId, mode, teamIds} predicate so the DB itself never
 * returns another tenant's rows for tenant-facing operations. Legacy unowned
 * rows (org_id null) are included only when `includeLegacy` is set (explicit
 * local-admin compatibility); for every other principal they are invisible.
 */
export interface ChatDbScope {
  orgId: string;
  /** 'org-wide' sees every row in orgId; 'team' sees only teamIds rows. */
  mode: 'org-wide' | 'team';
  teamIds: string[];
  /** local-admin compatibility: also return legacy org_id-null rows. */
  includeLegacy: boolean;
}

export interface TenantChatRepository {
  listChannels(): ChatChannelRecord[];
  getChannel(id: string): ChatChannelRecord | undefined;
  getChannelByName(name: string): ChatChannelRecord | undefined;
  listCategories(): ChatCategoryRecord[];
  getCategory(id: string): ChatCategoryRecord | undefined;
  listMessagesByChannel(channelId: string): ChatMessageRecord[];
  listMessagesByThread(threadId: string): ChatMessageRecord[];
  getMessage(id: string): ChatMessageRecord | undefined;
  listThreadsByChannel(channelId: string): ChatThreadRecord[];
  getThread(id: string): ChatThreadRecord | undefined;
  getThreadByParentMessage(parentMessageId: string): ChatThreadRecord | undefined;
  listChannelObjectRefs(id: string): ObjectRef[];
  listThreadObjectRefs(id: string): ObjectRef[];
}

function scopeWhere(scope: ChatDbScope): { sql: string; params: Record<string, unknown> } {
  // json_each lets a single prepared statement accept a variable team list.
  return {
    sql: `(
      (org_id = @orgId AND (@orgWide = 1 OR team_id IN (SELECT value FROM json_each(@teamIdsJson))))
      OR (@includeLegacy = 1 AND org_id IS NULL)
    )`,
    params: {
      orgId: scope.orgId,
      orgWide: scope.mode === 'org-wide' ? 1 : 0,
      teamIdsJson: JSON.stringify(scope.teamIds ?? []),
      includeLegacy: scope.includeLegacy ? 1 : 0,
    },
  };
}

export function createTenantChatRepository(scope: ChatDbScope, dbOverride?: Database.Database): TenantChatRepository {
  const db = dbOverride ?? getEntityDatabase();
  const where = scopeWhere(scope);

  const listChannelsStmt = db.prepare(`SELECT * FROM chat_channels WHERE ${where.sql} ORDER BY category_id ASC, "order" ASC, name COLLATE NOCASE ASC`);
  const getChannelStmt = db.prepare(`SELECT * FROM chat_channels WHERE id = @id AND ${where.sql}`);
  const getChannelByNameStmt = db.prepare(`SELECT * FROM chat_channels WHERE lower(name) = lower(@name) AND ${where.sql}`);
  const listCategoriesStmt = db.prepare(`SELECT * FROM chat_categories WHERE ${where.sql} ORDER BY "order" ASC, name COLLATE NOCASE ASC`);
  const getScopedCategoryStmt = db.prepare(`SELECT * FROM chat_categories WHERE id = @id AND ${where.sql}`);

  const listMessagesByChannelStmt = db.prepare(`
    SELECT * FROM chat_messages
    WHERE channel_id = @channelId AND (thread_id IS NULL OR thread_id = '') AND ${where.sql}
    ORDER BY datetime(timestamp) ASC, datetime(created_at) ASC, id ASC
  `);
  const listMessagesByThreadStmt = db.prepare(`
    SELECT * FROM chat_messages
    WHERE thread_id = @threadId AND ${where.sql}
    ORDER BY datetime(timestamp) ASC, datetime(created_at) ASC, id ASC
  `);
  const getMessageStmt = db.prepare(`SELECT * FROM chat_messages WHERE id = @id AND ${where.sql}`);

  const listThreadsByChannelStmt = db.prepare(`SELECT * FROM chat_threads WHERE channel_id = @channelId AND ${where.sql} ORDER BY datetime(last_message_at) DESC, id DESC`);
  const getThreadStmt = db.prepare(`SELECT * FROM chat_threads WHERE id = @id AND ${where.sql}`);
  const getThreadByParentStmt = db.prepare(`SELECT * FROM chat_threads WHERE parent_message_id = @parentMessageId AND ${where.sql}`);

  const listChannelObjectRefsStmt = db.prepare(`SELECT * FROM chat_channels WHERE id = @id AND ${where.sql}`);
  const listThreadObjectRefsStmt = db.prepare(`SELECT * FROM chat_threads WHERE id = @id AND ${where.sql}`);

  return {
    listChannels: () => (listChannelsStmt.all(where.params) as Array<Record<string, unknown>>).map(mapChannelRow),
    getChannel: (id) => {
      const row = getChannelStmt.get({ ...where.params, id }) as Record<string, unknown> | undefined;
      return row ? mapChannelRow(row) : undefined;
    },
    getChannelByName: (name) => {
      const row = getChannelByNameStmt.get({ ...where.params, name }) as Record<string, unknown> | undefined;
      return row ? mapChannelRow(row) : undefined;
    },
    listCategories: () => (listCategoriesStmt.all(where.params) as Array<Record<string, unknown>>).map(mapCategoryRow),
    getCategory: (id) => {
      const row = getScopedCategoryStmt.get({ ...where.params, id }) as Record<string, unknown> | undefined;
      return row ? mapCategoryRow(row) : undefined;
    },
    listMessagesByChannel: (channelId) => (listMessagesByChannelStmt.all({ ...where.params, channelId }) as Array<Record<string, unknown>>).map(mapMessageRow),
    listMessagesByThread: (threadId) => (listMessagesByThreadStmt.all({ ...where.params, threadId }) as Array<Record<string, unknown>>).map(mapMessageRow),
    getMessage: (id) => {
      const row = getMessageStmt.get({ ...where.params, id }) as Record<string, unknown> | undefined;
      return row ? mapMessageRow(row) : undefined;
    },
    listThreadsByChannel: (channelId) => (listThreadsByChannelStmt.all({ ...where.params, channelId }) as Array<Record<string, unknown>>).map(mapThreadRow),
    getThread: (id) => {
      const row = getThreadStmt.get({ ...where.params, id }) as Record<string, unknown> | undefined;
      return row ? mapThreadRow(row) : undefined;
    },
    getThreadByParentMessage: (parentMessageId) => {
      const row = getThreadByParentStmt.get({ ...where.params, parentMessageId }) as Record<string, unknown> | undefined;
      return row ? mapThreadRow(row) : undefined;
    },
    listChannelObjectRefs: (id) => {
      const row = listChannelObjectRefsStmt.get({ ...where.params, id }) as Record<string, unknown> | undefined;
      return row ? mapChannelRow(row).linked_object_refs : [];
    },
    listThreadObjectRefs: (id) => {
      const row = listThreadObjectRefsStmt.get({ ...where.params, id }) as Record<string, unknown> | undefined;
      return row ? mapThreadRow(row).linked_object_refs : [];
    },
  };
}
